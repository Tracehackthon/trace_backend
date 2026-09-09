import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputArg = process.argv.indexOf('--out');
const configured = outputArg >= 0 ? process.argv[outputArg + 1] : process.env.TRACE_PACKAGE_DIR;
if (!configured) throw new Error('Provide an absolute package output with --out ABS or TRACE_PACKAGE_DIR');
if (!path.isAbsolute(configured)) throw new Error('Package output must be absolute');
const output = path.resolve(configured);
if (fs.existsSync(output) && fs.readdirSync(output).length > 0) throw new Error(`Package output is not empty: ${output}`);
fs.mkdirSync(output, {recursive: true});
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(output, 'runtime.json'), JSON.stringify({runtime_version: packageInfo.version, node_engine: packageInfo.engines?.node ?? 'unknown'}, null, 2) + '\n', 'utf8');

function copy(relative, target = relative) {
  const source = path.join(root, relative);
  if (!fs.existsSync(source)) throw new Error(`Missing package input: ${source}`);
  const destination = path.join(output, target);
  const copyRecursive = (from, to) => {
    const stat = fs.statSync(from);
    if (stat.isDirectory()) {
      fs.mkdirSync(to, {recursive: true});
      for (const entry of fs.readdirSync(from)) copyRecursive(path.join(from, entry), path.join(to, entry));
    } else {
      fs.mkdirSync(path.dirname(to), {recursive: true});
      fs.copyFileSync(from, to);
    }
  };
  copyRecursive(source, destination);
}

copy('dist', 'dist');
copy('templates', 'templates');
copy('profiles', 'profiles');
copy('packages/bundle', 'bundle');
copy('schemas', 'schemas');
copy('python/sdk', 'python-sdk');
copy('native', 'native');
// The Node 22–24.1 runtime selects this pure-JS/WASM fallback before loading
// experimental node:sqlite. Materialize its JS assets so native distribution
// installation never depends on node-gyp or a platform-specific prebuild.
copy('node_modules/sql.js', 'node_modules/sql.js');
const sqlJsPackage = path.join(root, 'node_modules', 'sql.js', 'package.json');
const sqlJsInfo = JSON.parse(fs.readFileSync(sqlJsPackage, 'utf8'));
copy('README.md', 'README.md');
copy('MIGRATION_STATUS.md', 'MIGRATION_STATUS.md');
copy('AUDIT_20260909.md', 'AUDIT_20260909.md');

const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.name !== 'release-manifest.json') {
      const relative = path.relative(output, absolute).replaceAll(path.sep, '/');
      files.push({path: relative, sha256: createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'), bytes: fs.statSync(absolute).size});
    }
  }
}
walk(output);
const manifest = {
  manifest_id: 'trace.runtime.distribution',
  manifest_version: '0.1.0',
  runtime_version: packageInfo.version,
  node_engine: packageInfo.engines?.node ?? 'unknown',
  sqlite_driver_bundle: {fallback: 'sql.js', version: sqlJsInfo.version, selected_on_node_before: '24.2.0'},
  state_modes: ['sqlite', 'separate-jsonl-development'],
  files,
  created_at: new Date().toISOString(),
};
fs.writeFileSync(path.join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({status: 'packaged', output, files: files.length, manifest: path.join(output, 'release-manifest.json')}) + '\n');
