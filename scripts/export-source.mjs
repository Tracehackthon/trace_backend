import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outArg = process.argv.indexOf('--out');
const configured = outArg >= 0 ? process.argv[outArg + 1] : process.env.TRACE_SOURCE_EXPORT_DIR;
const replace = process.argv.includes('--replace');
if (!configured || !path.isAbsolute(configured)) throw new Error('Provide an absolute source export with --out ABS or TRACE_SOURCE_EXPORT_DIR');
const output = path.resolve(configured);
if (output === root || output.startsWith(`${root}${path.sep}`)) throw new Error('Source export must be outside the active runtime root');
if (fs.existsSync(output) && fs.readdirSync(output).length > 0 && !replace) throw new Error(`Source export output is not empty: ${output}; use --replace explicitly`);

const staging = `${output}.staging-${process.pid}`;
if (fs.existsSync(staging)) throw new Error(`Source export staging exists: ${staging}`);
fs.mkdirSync(staging, {recursive: true});
const preservedGit = fs.existsSync(path.join(output, '.git')) ? `${output}.git-preserve-${Date.now()}` : undefined;
if (preservedGit) fs.renameSync(path.join(output, '.git'), preservedGit);

const entries = [
  '.changeset', '.gitignore', 'apps', 'AUDIT_20260909.md', 'GIT_REMOTE_SETUP.md', 'MIGRATION_STATUS.md', 'README.md',
  'mise.toml', 'native', 'package.json', 'packages', 'patches', 'pnpm-lock.yaml',
  'pnpm-workspace.yaml', 'profiles', 'python', 'schemas', 'scripts', 'snapshots',
  'templates', 'tests', 'tsconfig.build.json', 'tsconfig.json',
];
const excluded = new Set(['node_modules', 'dist', '.pytest_cache', '.pnpm-store', 'release', 'tmp']);

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
fs.writeFileSync(path.join(staging, 'SOURCE_EXPORT_MANIFEST.json'), JSON.stringify({manifest_id: 'trace.runtime.source-export', manifest_version: '0.1.0', runtime_version: runtime.version, files, created_at: new Date().toISOString()}, null, 2) + '\n', 'utf8');

if (fs.existsSync(output)) fs.renameSync(output, `${output}.previous-${Date.now()}`);
fs.renameSync(staging, output);
if (preservedGit) fs.renameSync(preservedGit, path.join(output, '.git'));
process.stdout.write(JSON.stringify({status: 'exported', output, runtime_version: runtime.version, files: files.length, manifest: path.join(output, 'SOURCE_EXPORT_MANIFEST.json')}) + '\n');
