import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const nativeRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultPackageRoot = path.resolve(nativeRoot, '..');

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function absolute(value, field) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${field} must be an absolute path`);
  return path.resolve(value);
}

function safeRelative(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) throw new Error(`Invalid manifest path: ${String(value)}`);
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`Unsafe manifest path: ${value}`);
  return normalized;
}

function inside(root, relative) {
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes root: ${relative}`);
  return target;
}

function noSymlink(file) {
  let cursor = file;
  while (true) {
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink is not allowed: ${file}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

function parseArgs(argv) {
  const options = {packageRoot: defaultPackageRoot, target: undefined, replace: false, dryRun: false};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--package') options.packageRoot = absolute(argv[++index], '--package');
    else if (arg === '--target') options.target = absolute(argv[++index], '--target');
    else if (arg === '--replace') options.replace = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node native/install.mjs --target ABS [--package ABS] [--replace] [--dry-run]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.target) throw new Error('Missing --target ABS');
  return options;
}

function loadManifest(packageRoot) {
  const manifestFile = path.join(packageRoot, 'release-manifest.json');
  noSymlink(manifestFile);
  if (!fs.existsSync(manifestFile)) throw new Error(`Missing release manifest: ${manifestFile}`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.manifest_id !== 'trace.runtime.distribution' || typeof manifest.manifest_version !== 'string' || typeof manifest.runtime_version !== 'string' || manifest.runtime_version.length === 0) throw new Error('Unsupported release manifest');
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('Release manifest has no files');
  const seen = new Set();
  const files = manifest.files.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid release manifest file entry');
    const relative = safeRelative(entry.path);
    if (relative === 'release-manifest.json' || seen.has(relative)) throw new Error(`Manifest file path is duplicated or reserved: ${relative}`);
    seen.add(relative);
    if (!/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isInteger(entry.bytes) || entry.bytes < 0) throw new Error(`Invalid file integrity metadata: ${relative}`);
    const source = inside(packageRoot, relative);
    noSymlink(source);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`Manifest file is missing: ${source}`);
    if (fs.statSync(source).size !== entry.bytes || sha256(source) !== entry.sha256) throw new Error(`Package file integrity failed: ${relative}`);
    return {path: relative, sha256: entry.sha256, bytes: entry.bytes};
  });
  return {manifest, manifestFile, files};
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
}

function install(options) {
  const packageRoot = options.packageRoot;
  const target = options.target;
  const {manifest, manifestFile, files} = loadManifest(packageRoot);
  const manifestHash = sha256(manifestFile);
  const plan = {status: 'validated', package_root: packageRoot, target, runtime_version: manifest.runtime_version, files: files.length, manifest_sha256: manifestHash, replace: options.replace};
  if (options.dryRun) return {...plan, dry_run: true};
  if (fs.existsSync(target) && !options.replace) throw new Error(`Target exists; use --replace explicitly: ${target}`);
  const staging = `${target}.staging-${process.pid}`;
  const previous = fs.existsSync(target) ? `${target}.previous-${Date.now()}-${process.pid}` : undefined;
  if (fs.existsSync(staging) || (previous !== undefined && fs.existsSync(previous))) throw new Error('Install staging or previous target already exists');
  let movedPrevious = false;
  try {
    fs.mkdirSync(staging, {recursive: true});
    for (const file of files) copyFile(inside(packageRoot, file.path), inside(staging, file.path));
    copyFile(manifestFile, path.join(staging, 'release-manifest.json'));
    const receipt = {protocol_id: 'trace.native-install', protocol_version: '0.1.0', status: 'installed', package_root: packageRoot, target_root: target, runtime_version: manifest.runtime_version, manifest_sha256: manifestHash, previous_target: previous ?? null, files: files.map(file => ({path: file.path, sha256: file.sha256, bytes: file.bytes})), installed_at: new Date().toISOString()};
    fs.writeFileSync(path.join(staging, '.trace-install-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
    if (previous !== undefined) {
      fs.renameSync(target, previous);
      movedPrevious = true;
    }
    fs.renameSync(staging, target);
    return {...plan, status: 'installed', target, previous_target: previous ?? null, receipt: path.join(target, '.trace-install-receipt.json')};
  } catch (error) {
    fs.rmSync(staging, {recursive: true, force: true});
    if (movedPrevious && previous !== undefined && !fs.existsSync(target)) fs.renameSync(previous, target);
    throw error;
  }
}

try {
  console.log(JSON.stringify(install(parseArgs(process.argv.slice(2)))));
} catch (error) {
  console.error(JSON.stringify({status: 'failed', error: error instanceof Error ? error.message : String(error)}));
  process.exitCode = 1;
}
