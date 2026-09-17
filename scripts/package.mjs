import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assertCleanSourceIdentity, inspectSourceIdentity} from './source-identity.mjs';
import {CODEX_PLUGIN_PROTOCOL_PROFILE} from '../native/codex-compatibility.mjs';
import {runtimeApiSurface} from '../apps/desktop/runtime-identity.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputArg = process.argv.indexOf('--out');
const configured = outputArg >= 0 ? process.argv[outputArg + 1] : process.env.TRACE_PACKAGE_DIR;
if (!configured) throw new Error('Provide an absolute package output with --out ABS or TRACE_PACKAGE_DIR');
if (!path.isAbsolute(configured)) throw new Error('Package output must be absolute');
const output = path.resolve(configured);
if (fs.existsSync(output) && fs.readdirSync(output).length > 0) throw new Error(`Package output is not empty: ${output}`);
fs.mkdirSync(output, {recursive: true});
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const sourceIdentity = inspectSourceIdentity(root);
if (process.argv.includes('--require-clean') || process.env.TRACE_REQUIRE_CLEAN === '1') assertCleanSourceIdentity(sourceIdentity);
const distributionEligibility = sourceIdentity.clean ? 'release-ready' : 'development-dirty';
fs.writeFileSync(path.join(output, 'runtime.json'), JSON.stringify({
  runtime_version: packageInfo.version,
  node_engine: packageInfo.engines?.node ?? 'unknown',
  distribution_eligibility: distributionEligibility,
  source_identity: sourceIdentity,
  api_surface: runtimeApiSurface(),
  host_compatibility: {codex_plugin: CODEX_PLUGIN_PROTOCOL_PROFILE},
}, null, 2) + '\n', 'utf8');

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
// Only the supported Codex integration belongs in the distributable runtime.
// `trace-harness-plugin` is an exploration host (and carries its own Electron
// development tree); shipping it would add hundreds of megabytes and would
// accidentally treat an internal prototype as a release surface.
copy('plugins/trace-codex', 'plugins/trace-codex');
copy('marketplace.json', 'marketplace.json');
// `packages/bundle/codex/README.md` is readable from the source checkout,
// where it lives three levels below the repository docs.  The packaged copy
// lives at `bundle/codex`, so normalize those links to the distribution
// layout instead of shipping links that point outside the release directory.
const packagedBundleReadme = path.join(output, 'bundle', 'codex', 'README.md');
if (fs.existsSync(packagedBundleReadme)) {
  const text = fs.readFileSync(packagedBundleReadme, 'utf8');
  fs.writeFileSync(packagedBundleReadme, text.replaceAll('(../../../docs/', '(../../docs/'), 'utf8');
}
// The bundle index moves from `packages/bundle` in the source checkout to
// `bundle` in the distribution, so its versioning link loses one `..`.
const packagedBundleIndex = path.join(output, 'bundle', 'README.md');
if (fs.existsSync(packagedBundleIndex)) {
  const text = fs.readFileSync(packagedBundleIndex, 'utf8');
  fs.writeFileSync(packagedBundleIndex, text.replaceAll('(../../docs/', '(../docs/'), 'utf8');
}
// The desktop installer hosts its renderer itself, but it still needs the
// product/search/Agent loopback APIs on a true first launch. Keep this narrow
// server source beside the compiled runtime so Electron can start it with its
// bundled Node runtime without requiring a developer checkout.
copy('apps/desktop/server.mjs', 'apps/desktop/server.mjs');
copy('apps/desktop/runtime-port.mjs', 'apps/desktop/runtime-port.mjs');
copy('apps/desktop/runtime-identity.mjs', 'apps/desktop/runtime-identity.mjs');
copy('apps/agent', 'apps/agent');
copy('packages/product/workspace/src', 'packages/product/workspace/src');
// The Node 22–24.1 runtime selects this pure-JS/WASM fallback before loading
// experimental node:sqlite. Do not copy the npm checkout wholesale: sql.js
// includes dot-prefixed development containers plus documentation/test assets
// which electron-builder does not preserve consistently in extraResources.
// Keep the package metadata, the audited asm.js entry used by Trace, and the
// normal wasm entry/sidecar so the packaged dependency remains valid for its
// declared `main`/exports without carrying the development tree.
for (const relative of [
  'node_modules/sql.js/package.json',
  'node_modules/sql.js/dist/sql-asm.js',
  'node_modules/sql.js/dist/sql-wasm.js',
  'node_modules/sql.js/dist/sql-wasm.wasm',
]) copy(relative, relative);
const sqlJsPackage = path.join(root, 'node_modules', 'sql.js', 'package.json');
const sqlJsInfo = JSON.parse(fs.readFileSync(sqlJsPackage, 'utf8'));
copy('README.md', 'README.md');
copy('Connect-Trace-to-Codex.cmd', 'Connect-Trace-to-Codex.cmd');
copy('docs', 'docs');
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
  manifest_version: '0.2.0',
  runtime_version: packageInfo.version,
  node_engine: packageInfo.engines?.node ?? 'unknown',
  distribution_eligibility: distributionEligibility,
  source_identity: sourceIdentity,
  api_surface: runtimeApiSurface(),
  host_compatibility: {codex_plugin: CODEX_PLUGIN_PROTOCOL_PROFILE},
  sqlite_driver_bundle: {fallback: 'sql.js', version: sqlJsInfo.version, selected_on_node_before: '24.2.0'},
  state_modes: ['sqlite', 'separate-jsonl-development'],
  files,
  created_at: new Date().toISOString(),
};
fs.writeFileSync(path.join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({status: 'packaged', output, files: files.length, manifest: path.join(output, 'release-manifest.json')}) + '\n');
