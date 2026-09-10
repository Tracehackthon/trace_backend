/**
 * TypeScript emits apps/mcp outside its workspace package directory, so pnpm's
 * workspace junctions are no longer on Node's resolution path. Materialize
 * the reachable ESM runtime graph beside the emitted MCP entry. This keeps
 * native packages physical/symlink-free without copying unused SDK HTTP code.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const appModules = path.join(root, 'apps', 'mcp', 'node_modules');
const outputModules = path.join(root, 'dist', 'apps', 'mcp', 'node_modules');
const mcpEntry = path.join(root, 'dist', 'apps', 'mcp', 'src', 'main.js');
const copied = new Set();
const packageRoots = new Map();

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function targetFor(nodeModules, name) {
  const segments = name.split('/');
  const valid = (segments.length === 1 && /^[A-Za-z0-9._-]+$/.test(segments[0]))
    || (segments.length === 2 && /^@[A-Za-z0-9._-]+$/.test(segments[0]) && /^[A-Za-z0-9._-]+$/.test(segments[1]));
  if (!valid) throw new Error(`Unsafe dependency name: ${name}`);
  return path.join(nodeModules, ...segments);
}
function packageParts(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? {name: parts.slice(0, 2).join('/'), subpath: parts.slice(2).join('/')} : {name: parts[0], subpath: parts.slice(1).join('/')};
}
function packageRootFor(name, from) {
  const key = `${name}\u0000${path.resolve(from)}`;
  if (packageRoots.has(key)) return packageRoots.get(key);
  const direct = targetFor(from, name);
  if (fs.existsSync(path.join(direct, 'package.json'))) { const found = fs.realpathSync(direct); packageRoots.set(key, found); return found; }
  let cursor = path.resolve(from);
  while (true) {
    const candidate = targetFor(path.join(cursor, 'node_modules'), name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) { const found = fs.realpathSync(candidate); packageRoots.set(key, found); return found; }
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error(`Cannot locate package root for ${name} resolved from ${from}`);
    cursor = parent;
  }
}
function exportTarget(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return exportTarget(value.import) ?? exportTarget(value.node) ?? exportTarget(value.default) ?? exportTarget(value.require);
}
function packageEntry(packageRoot, packageName, subpath) {
  const manifest = readJson(path.join(packageRoot, 'package.json'));
  const key = subpath ? `./${subpath}` : '.';
  let exportValue = manifest.exports && typeof manifest.exports === 'object' && !Array.isArray(manifest.exports)
    ? manifest.exports[key] ?? (key === '.' ? manifest.exports : undefined) : undefined;
  let wildcard = undefined;
  if (exportValue === undefined && manifest.exports && typeof manifest.exports === 'object' && !Array.isArray(manifest.exports)) {
    for (const [pattern, value] of Object.entries(manifest.exports)) {
      if (!pattern.includes('*')) continue;
      const [prefix, suffix] = pattern.split('*');
      if (key.startsWith(prefix) && key.endsWith(suffix)) { exportValue = value; wildcard = key.slice(prefix.length, key.length - suffix.length); break; }
    }
  }
  const exportedRaw = exportTarget(exportValue);
  const exported = wildcard === undefined || exportedRaw === undefined ? exportedRaw : exportedRaw.replace('*', wildcard);
  const candidate = exported ?? (!subpath ? (manifest.module ?? manifest.main ?? 'index.js') : subpath);
  const base = path.resolve(packageRoot, candidate);
  const files = path.extname(base) ? [base] : [base, `${base}.js`, path.join(base, 'index.js')];
  const file = files.find(item => fs.existsSync(item) && fs.statSync(item).isFile());
  if (!file || !file.startsWith(`${packageRoot}${path.sep}`)) throw new Error(`MCP dependency entry is unavailable: ${packageName}${subpath ? `/${subpath}` : ''}`);
  return fs.realpathSync(file);
}
function localImport(source, specifier) {
  const base = path.resolve(path.dirname(source), specifier);
  const candidates = path.extname(specifier) ? [base] : [base, `${base}.js`, path.join(base, 'index.js')];
  for (const candidate of candidates) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
  throw new Error(`Cannot resolve local MCP import ${specifier} from ${source}`);
}
function copyFile(source, target) {
  const id = `${source}\u0000${target}`;
  if (copied.has(id)) return false;
  copied.add(id);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.copyFileSync(source, target);
  return true;
}
function specifiers(source) {
  const text = fs.readFileSync(source, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  return [...new Set([...text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\()(['"])([^'"\n]+)\1/g)].map(match => match[2]))];
}
function packageTargetRoot(name) { return targetFor(outputModules, name); }
function materializePackageFile(source, packageRoot, packageName) {
  const relative = path.relative(packageRoot, source);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Dependency file escapes package root: ${source}`);
  const target = path.join(packageTargetRoot(packageName), relative);
  if (!copyFile(source, target)) return;
  copyFile(path.join(packageRoot, 'package.json'), path.join(packageTargetRoot(packageName), 'package.json'));
  for (const specifier of specifiers(source)) {
    if (specifier.startsWith('node:')) continue;
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      materializePackageFile(localImport(source, specifier), packageRoot, packageName);
    } else {
      const parts = packageParts(specifier);
      const dependencyRoot = packageRootFor(parts.name, path.dirname(source));
      materializePackageFile(packageEntry(dependencyRoot, parts.name, parts.subpath), dependencyRoot, parts.name);
    }
  }
}
function materializeFromEntry(entry) {
  for (const specifier of specifiers(entry)) {
    if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) continue;
    const parts = packageParts(specifier);
    const dependencyRoot = packageRootFor(parts.name, appModules);
    materializePackageFile(packageEntry(dependencyRoot, parts.name, parts.subpath), dependencyRoot, parts.name);
  }
}

if (!fs.existsSync(appModules)) throw new Error(`MCP workspace dependencies are not installed: ${appModules}`);
if (!fs.existsSync(mcpEntry)) throw new Error(`MCP output is missing: ${mcpEntry}`);
fs.rmSync(outputModules, {recursive: true, force: true});
materializeFromEntry(mcpEntry);
process.stdout.write(JSON.stringify({status: 'materialized', output: outputModules, files: copied.size}) + '\n');
