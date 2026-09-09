import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outArg = process.argv.indexOf('--out');
const configured = outArg >= 0 ? process.argv[outArg + 1] : process.env.TRACE_SOURCE_EXPORT_DIR;
const replace = process.argv.includes('--replace');
const keepArg = process.argv.indexOf('--keep-backups');
const keepRaw = keepArg >= 0 ? process.argv[keepArg + 1] : (process.env.TRACE_SOURCE_EXPORT_KEEP_BACKUPS ?? '3');
const keepBackups = Number(keepRaw);
if (!configured || !path.isAbsolute(configured)) throw new Error('Provide an absolute source export with --out ABS or TRACE_SOURCE_EXPORT_DIR');
if (!Number.isInteger(keepBackups) || keepBackups < 0 || keepBackups > 20) throw new Error('--keep-backups / TRACE_SOURCE_EXPORT_KEEP_BACKUPS must be an integer from 0 to 20');
const output = path.resolve(configured);
if (output === root || output.startsWith(`${root}${path.sep}`)) throw new Error('Source export must be outside the active runtime root');
if (fs.existsSync(output) && fs.readdirSync(output).length > 0 && !replace) throw new Error(`Source export output is not empty: ${output}; use --replace explicitly`);

const staging = `${output}.staging-${process.pid}`;
if (fs.existsSync(staging)) throw new Error(`Source export staging exists: ${staging}`);
fs.mkdirSync(staging, {recursive: true});

const entries = [
  '.changeset', '.gitignore', 'apps', 'AUDIT_20260909.md', 'docs', 'GIT_REMOTE_SETUP.md', 'MIGRATION_STATUS.md', 'README.md',
  'mise.toml', 'native', 'package.json', 'packages', 'patches', 'pnpm-lock.yaml',
  'pnpm-workspace.yaml', 'profiles', 'python', 'schemas', 'scripts', 'snapshots',
  'templates', 'tests', 'tsconfig.build.json', 'tsconfig.json',
];
const excluded = new Set(['node_modules', 'dist', '.pytest_cache', '.pnpm-store', 'release', 'tmp']);
const preservedLocalEntries = new Set(['.git', '.workbuddy-ai']);
const generatedEntries = ['node_modules', 'dist', '.pytest_cache', '.pnpm-store', 'release', 'tmp'];

function isSafeEntry(entry) {
  return typeof entry === 'string'
    && entry.length > 0
    && !path.isAbsolute(entry)
    && !entry.includes('/')
    && !entry.includes('\\')
    && entry !== '.'
    && entry !== '..';
}

function readPreviousManagedEntries() {
  const manifestFile = path.join(output, 'SOURCE_EXPORT_MANIFEST.json');
  if (!fs.existsSync(manifestFile)) return [];
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (Array.isArray(manifest.managed_entries)) {
      return manifest.managed_entries.filter(isSafeEntry);
    }
    // Export manifests before v0.2 did not list top-level ownership. Recover
    // it from their file inventory without ever considering user-local roots.
    if (Array.isArray(manifest.files)) {
      return [...new Set(manifest.files
        .map((file) => typeof file?.path === 'string' ? file.path.split('/')[0] : undefined)
        .filter(isSafeEntry))];
    }
  } catch {
    // An unreadable old manifest must not make us touch unlisted paths.
  }
  return [];
}

function copyRecursive(source, destination) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Symlink is not allowed in source export: ${source}`);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, {recursive: true});
    for (const entry of fs.readdirSync(source)) {
      if (excluded.has(entry)) continue;
      copyRecursive(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.copyFileSync(source, destination);
}

for (const entry of entries) {
  const source = path.join(root, entry);
  if (!fs.existsSync(source)) {
    if (entry === 'AUDIT_20260909.md') continue;
    throw new Error(`Missing source export input: ${source}`);
  }
  copyRecursive(source, path.join(staging, entry));
}

const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else files.push({path: path.relative(staging, absolute).replaceAll(path.sep, '/'), sha256: createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'), bytes: fs.statSync(absolute).size});
  }
}
walk(staging);
const runtime = JSON.parse(fs.readFileSync(path.join(staging, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(staging, 'SOURCE_EXPORT_MANIFEST.json'), JSON.stringify({
  manifest_id: 'trace.runtime.source-export',
  manifest_version: '0.2.0',
  runtime_version: runtime.version,
  managed_entries: entries,
  backup_policy: {max_managed_backups: keepBackups},
  files,
  created_at: new Date().toISOString(),
}, null, 2) + '\n', 'utf8');

// Do not rename the output root: it may contain a running local tool that has
// a file handle under .workbuddy-ai. Move only known source-export entries.
// This keeps Git and local tool state in place and makes the backup contain
// source only, not dependency/build trees that can be regenerated.
const backup = `${output}.previous-${Date.now()}`;
const previousEntries = readPreviousManagedEntries();
const managedEntries = [...new Set([...previousEntries, ...entries, 'SOURCE_EXPORT_MANIFEST.json'])]
  .filter((entry) => isSafeEntry(entry) && !preservedLocalEntries.has(entry));
const movedEntries = [];
const deployedEntries = [];
let cleanupWarnings = [];

function sourceBackupDirectories() {
  const parent = path.dirname(output);
  const prefix = `${path.basename(output)}.previous-`;
  return fs.readdirSync(parent, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && entry.name.startsWith(prefix))
    .map(entry => path.join(parent, entry.name))
    .filter(directory => {
      const manifestFile = path.join(directory, 'SOURCE_EXPORT_MANIFEST.json');
      if (!fs.existsSync(manifestFile)) return false;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        // v0.2+ is produced by the entry-level exporter and is source-only.
        // Older root-move backups are deliberately outside automatic pruning.
        return manifest.manifest_id === 'trace.runtime.source-export'
          && typeof manifest.manifest_version === 'string'
          && /^0\.[2-9]\./.test(manifest.manifest_version);
      } catch { return false; }
    })
    .sort((left, right) => path.basename(right).localeCompare(path.basename(left)));
}

function pruneManagedSourceBackups() {
  const stale = sourceBackupDirectories().slice(keepBackups);
  const removed = [];
  for (const directory of stale) {
    try {
      fs.rmSync(directory, {recursive: true, force: true});
      removed.push(directory);
    } catch (error) {
      cleanupWarnings.push({entry: path.basename(directory), message: `backup retention: ${error.message}`});
    }
  }
  return removed;
}

try {
  if (!fs.existsSync(output)) {
    fs.renameSync(staging, output);
    deployedEntries.push(...entries, 'SOURCE_EXPORT_MANIFEST.json');
  } else {
    fs.mkdirSync(backup, {recursive: true});
    for (const entry of managedEntries) {
      const current = path.join(output, entry);
      if (!fs.existsSync(current)) continue;
      const saved = path.join(backup, entry);
      fs.renameSync(current, saved);
      movedEntries.push(entry);
    }

    for (const entry of [...entries, 'SOURCE_EXPORT_MANIFEST.json']) {
      const source = path.join(staging, entry);
      if (!fs.existsSync(source)) continue;
      fs.renameSync(source, path.join(output, entry));
      deployedEntries.push(entry);
    }
    fs.rmSync(staging, {recursive: true, force: true});
  }
} catch (error) {
  for (const entry of deployedEntries.reverse()) {
    const deployed = path.join(output, entry);
    if (fs.existsSync(deployed)) fs.rmSync(deployed, {recursive: true, force: true});
  }
  for (const entry of movedEntries.reverse()) {
    const saved = path.join(backup, entry);
    if (fs.existsSync(saved)) fs.renameSync(saved, path.join(output, entry));
  }
  throw new Error(`Source export failed and attempted rollback. Staging: ${staging}; backup: ${backup}; cause: ${error.message}`);
}

for (const entry of generatedEntries) {
  const generated = path.join(output, entry);
  if (!fs.existsSync(generated)) continue;
  try {
    fs.rmSync(generated, {recursive: true, force: true});
  } catch (error) {
    cleanupWarnings.push({entry, message: error.message});
  }
}
const prunedBackups = pruneManagedSourceBackups();

process.stdout.write(JSON.stringify({
  status: 'exported',
  output,
  backup: fs.existsSync(backup) ? backup : null,
  runtime_version: runtime.version,
  files: files.length,
  manifest: path.join(output, 'SOURCE_EXPORT_MANIFEST.json'),
  keep_backups: keepBackups,
  pruned_backups: prunedBackups,
  cleanup_warnings: cleanupWarnings,
}) + '\n');
