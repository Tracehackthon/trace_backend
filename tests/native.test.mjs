import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const root = path.resolve(process.cwd());
const installer = path.join(root, 'native', 'install.mjs');
const codexPluginInstaller = path.join(root, 'native', 'install-codex-plugin.mjs');
const packager = path.join(root, 'scripts', 'package.mjs');
const traceMcpLauncher = path.join(root, 'plugins', 'trace-codex', 'scripts', 'launch-trace-mcp.mjs');
const hash = value => createHash('sha256').update(value).digest('hex');

test('native installer validates a release manifest and preserves replaced targets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-native-'));
  const packageRoot = path.join(dir, 'package');
  const target = path.join(dir, 'installed');
  fs.mkdirSync(path.join(packageRoot, 'dist'), {recursive: true});
  fs.writeFileSync(path.join(packageRoot, 'dist', 'runtime.txt'), 'runtime-v1\n', 'utf8');
  const content = fs.readFileSync(path.join(packageRoot, 'dist', 'runtime.txt'));
  const manifest = {
    manifest_id: 'trace.runtime.distribution', manifest_version: '0.1.0', runtime_version: '0.6.0',
    files: [{path: 'dist/runtime.txt', sha256: hash(content), bytes: content.length}],
  };
  fs.writeFileSync(path.join(packageRoot, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const dryRun = spawnSync(process.execPath, [installer, '--package', packageRoot, '--target', target, '--dry-run'], {encoding: 'utf8'});
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).dry_run, true);
  assert.equal(fs.existsSync(target), false);

  const first = spawnSync(process.execPath, [installer, '--package', packageRoot, '--target', target], {encoding: 'utf8'});
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).status, 'installed');
  assert.equal(fs.readFileSync(path.join(target, 'dist', 'runtime.txt'), 'utf8'), 'runtime-v1\n');
  assert.equal(fs.existsSync(path.join(target, '.trace-install-receipt.json')), true);

  const refused = spawnSync(process.execPath, [installer, '--package', packageRoot, '--target', target], {encoding: 'utf8'});
  assert.notEqual(refused.status, 0);

  const replaced = spawnSync(process.execPath, [installer, '--package', packageRoot, '--target', target, '--replace'], {encoding: 'utf8'});
  assert.equal(replaced.status, 0, replaced.stderr);
  const previous = JSON.parse(replaced.stdout).previous_target;
  assert.ok(previous);
  assert.equal(fs.existsSync(previous), true);
  assert.equal(fs.readFileSync(path.join(target, 'dist', 'runtime.txt'), 'utf8'), 'runtime-v1\n');
});
test('distribution retains product documentation and the trace launcher', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-package-'));
  const output = path.join(directory, 'release');
  try {
    const packaged = spawnSync(process.execPath, [packager, '--out', output], {encoding: 'utf8'});
    assert.equal(packaged.status, 0, packaged.stderr);
    assert.equal(fs.existsSync(path.join(output, 'docs', 'getting-started.md')), true);
    assert.equal(fs.existsSync(path.join(output, 'docs', 'daily-workflow.md')), true);
    assert.equal(fs.existsSync(path.join(output, 'native', 'launcher', 'trace.mjs')), true);
    assert.equal(fs.existsSync(path.join(output, 'native', 'launcher', 'trace.cmd')), true);
    assert.equal(fs.existsSync(path.join(output, 'native', 'install-codex-plugin.mjs')), true);
    assert.equal(fs.existsSync(path.join(output, 'Connect-Trace-to-Codex.cmd')), true);
    assert.match(fs.readFileSync(path.join(output, 'Connect-Trace-to-Codex.cmd'), 'utf8'), /native\\install-codex-plugin\.mjs/);
    assert.equal(fs.existsSync(path.join(output, 'plugins', 'trace-codex', '.codex-plugin', 'plugin.json')), true);
    assert.equal(fs.existsSync(path.join(output, 'dist', 'apps', 'mcp', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'server', 'mcp.js')), true);
    const packagedBundleReadme = fs.readFileSync(path.join(output, 'bundle', 'codex', 'README.md'), 'utf8');
    assert.match(packagedBundleReadme, /\]\(\.\.\/\.\.\/docs\/host-native-retrieval\.md\)/, 'packaged bundle links must resolve inside the distribution');
    assert.equal(fs.existsSync(path.join(output, 'bundle', 'codex', '..', '..', 'docs', 'host-native-retrieval.md')), true);
    const packagedBundleIndex = fs.readFileSync(path.join(output, 'bundle', 'README.md'), 'utf8');
    assert.match(packagedBundleIndex, /\]\(\.\.\/docs\/versioning\.md\)/, 'packaged bundle index links must resolve inside the distribution');
    assert.equal(fs.existsSync(path.join(output, 'bundle', '..', 'docs', 'versioning.md')), true);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'release-manifest.json'), 'utf8'));
    const sqlJsEntries = manifest.files
      .filter(file => file.path.startsWith('dist/node_modules/sql.js/'))
      .map(file => file.path)
      .sort();
    assert.deepEqual(sqlJsEntries, [
      'dist/node_modules/sql.js/dist/sql-asm.js',
      'dist/node_modules/sql.js/dist/sql-wasm.js',
      'dist/node_modules/sql.js/dist/sql-wasm.wasm',
      'dist/node_modules/sql.js/package.json',
    ], 'the runtime package must contain only sql.js runtime assets');
    assert.equal(sqlJsEntries.some(file => /dist\/node_modules\/sql\.js\/(?:\.|.*(?:test|docs?|\.devcontainer)(?:\/|$))/i.test(file)), false, 'sql.js development assets must not enter the runtime manifest');
    assert.equal(fs.existsSync(path.join(output, 'dist', 'node_modules', 'sql.js', '.devcontainer')), false, 'sql.js dot-prefixed development assets must not be staged');
    const sqliteProbe = spawnSync(process.execPath, ['--input-type=module', '-e', [
      `process.env.TRACE_SQLITE_DRIVER = 'sql.js';`,
      `const {openSqlite} = await import(${JSON.stringify(pathToFileURL(path.join(output, 'dist', 'packages', 'core', 'storage', 'src', 'sqlite-driver.js')).href)});`,
      `const database = ${JSON.stringify(path.join(directory, 'sqljs-fallback.sqlite'))};`,
      `const opened = openSqlite(database, {driver: 'sql.js'});`,
      `if (opened.driver.kind !== 'sql.js') throw new Error('fallback driver was not selected');`,
      `opened.db.exec('CREATE TABLE probe (value TEXT)');`,
      `opened.db.prepare('INSERT INTO probe (value) VALUES (?)').run('packaged');`,
      `const row = opened.db.prepare('SELECT value FROM probe').get();`,
      `if (row?.value !== 'packaged') throw new Error('packaged sql.js fallback did not persist a row');`,
      `opened.db.close();`,
    ].join('\n')], {cwd: output, encoding: 'utf8', env: {...process.env, TRACE_SQLITE_DRIVER: 'sql.js'}});
    assert.equal(sqliteProbe.status, 0, `packaged sql.js fallback failed: ${sqliteProbe.stderr || sqliteProbe.stdout}`);
    assert.equal(manifest.files.some(file => file.path === 'docs/getting-started.md'), true);
    assert.equal(manifest.manifest_version, '0.2.0');
    assert.ok(['release-ready', 'development-dirty'].includes(manifest.distribution_eligibility));
    assert.equal(manifest.distribution_eligibility, manifest.source_identity.clean ? 'release-ready' : 'development-dirty');
    assert.match(manifest.source_identity.content_sha256, /^[0-9a-f]{64}$/);
    assert.ok(manifest.api_surface.host.includes('/api/product/host/capability/publish'));
    assert.equal(manifest.host_compatibility.codex_plugin.id, 'codex-plugin-marketplace-v1');
    assert.equal(fs.existsSync(path.join(output, 'apps', 'desktop', 'runtime-identity.mjs')), true);
    const installed = path.join(directory, 'installed');
    const installedRuntime = spawnSync(process.execPath, [installer, '--package', output, '--target', installed], {encoding: 'utf8'});
    assert.equal(installedRuntime.status, 0, installedRuntime.stderr);
    assert.equal(fs.existsSync(path.join(installed, 'plugins', 'trace-codex', '.mcp.json')), true);
    assert.equal(fs.existsSync(path.join(installed, 'dist', 'apps', 'mcp', 'node_modules', 'zod', 'v3', 'index.js')), true);
    const pluginPlan = spawnSync(process.execPath, [path.join(installed, 'native', 'install-codex-plugin.mjs'), '--runtime-root', installed, '--marketplace-root', path.join(directory, 'codex-marketplace'), '--dry-run'], {encoding: 'utf8'});
    assert.equal(pluginPlan.status, 0, pluginPlan.stderr);
    const plan = JSON.parse(pluginPlan.stdout);
    assert.equal(plan.plugin, 'trace-codex');
    assert.equal(plan.runtime_kind, 'packaged');
    assert.equal(plan.runtime_version, manifest.runtime_version);
    const fake = fakeCodexCommand(directory);
    const pluginInstalled = spawnSync(process.execPath, [path.join(installed, 'native', 'install-codex-plugin.mjs'), '--runtime-root', installed, '--marketplace-root', path.join(directory, 'codex-marketplace'), '--codex-command', fake.command, '--codex-arg', fake.argument, '--confirm', 'true'], {encoding: 'utf8', env: {...process.env, FAKE_CODEX_STATE: fake.stateFile}});
    assert.equal(pluginInstalled.status, 0, pluginInstalled.stderr);
    const installedMcp = JSON.parse(fs.readFileSync(path.join(directory, 'codex-marketplace', 'plugins', 'trace-codex', '.mcp.json'), 'utf8'));
    assert.equal(installedMcp.mcpServers.trace.env.TRACE_RUNTIME_ROOT, installed);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('Codex plugin installer is explicit and its dry run never alters a user marketplace', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-codex-plugin-installer-'));
  const marketplace = path.join(directory, 'marketplace');
  try {
    const dryRun = spawnSync(process.execPath, [codexPluginInstaller, '--runtime-root', root, '--marketplace-root', marketplace, '--dry-run'], {encoding: 'utf8'});
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const plan = JSON.parse(dryRun.stdout);
    assert.equal(plan.status, 'planned');
    assert.equal(plan.dry_run, true);
    assert.equal(plan.automatic_upgrade, false);
    assert.equal(plan.runtime_kind, 'source');
    assert.equal(plan.runtime_version, '0.7.1');
    assert.match(plan.plugin_version, /^\d+\.\d+\.\d+/);
    assert.equal(fs.existsSync(marketplace), false);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('Codex plugin installer restores the marketplace directory when Codex registration fails', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-plugin-install-rollback-'));
  const marketplace = path.join(directory, 'marketplace');
  const invoke = replace => spawnSync(process.execPath, [codexPluginInstaller, '--runtime-root', root, '--marketplace-root', marketplace, '--codex-command', process.execPath, '--confirm', 'true', ...(replace ? ['--replace'] : [])], {encoding: 'utf8'});
  try {
    const firstFailure = invoke(false);
    assert.notEqual(firstFailure.status, 0);
    assert.equal(JSON.parse(firstFailure.stderr).code, 'CODEX_COMMAND_FAILED');
    assert.equal(fs.existsSync(marketplace), false, 'a first install failure must remove its managed marketplace directory');

    fs.mkdirSync(marketplace, {recursive: true});
    fs.writeFileSync(path.join(marketplace, 'preserve-on-rollback.txt'), 'old marketplace marker', 'utf8');
    const replacementFailure = invoke(true);
    assert.notEqual(replacementFailure.status, 0);
    assert.equal(JSON.parse(replacementFailure.stderr).code, 'CODEX_COMMAND_FAILED');
    assert.equal(fs.readFileSync(path.join(marketplace, 'preserve-on-rollback.txt'), 'utf8'), 'old marketplace marker');
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});

test('Codex plugin installer never removes an existing marketplace when staging fails before the swap', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-plugin-stage-failure-'));
  const runtime = path.join(directory, 'broken-runtime');
  const marketplace = path.join(directory, 'marketplace');
  try {
    // A lookalike directory must be rejected before staging.  It has the
    // plugin and MCP entry names but no Trace runtime/package manifest.
    fs.mkdirSync(path.join(runtime, 'plugins', 'trace-codex', '.codex-plugin'), {recursive: true});
    fs.mkdirSync(path.join(runtime, 'dist', 'apps', 'mcp', 'src'), {recursive: true});
    fs.writeFileSync(path.join(runtime, 'plugins', 'trace-codex', '.codex-plugin', 'plugin.json'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(runtime, 'dist', 'apps', 'mcp', 'src', 'main.js'), '', 'utf8');
    fs.mkdirSync(marketplace, {recursive: true});
    fs.writeFileSync(path.join(marketplace, 'sentinel'), 'preserve this marketplace', 'utf8');

    const failed = spawnSync(process.execPath, [codexPluginInstaller, '--runtime-root', runtime, '--marketplace-root', marketplace, '--replace', '--confirm', 'true'], {encoding: 'utf8'});
    assert.notEqual(failed.status, 0);
    assert.equal(JSON.parse(failed.stderr).code, 'RUNTIME_ROOT_INVALID');
    assert.equal(fs.readFileSync(path.join(marketplace, 'sentinel'), 'utf8'), 'preserve this marketplace');
    assert.deepEqual(fs.readdirSync(directory).filter(name => name.startsWith('marketplace.previous-')), [], 'the old marketplace must not be moved before staging succeeds');
    assert.deepEqual(fs.readdirSync(directory).filter(name => name.startsWith('marketplace.staging-')), [], 'failed staging is cleaned up without touching the old marketplace');
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});

test('Trace MCP launcher rejects a lookalike TRACE_RUNTIME_ROOT before starting it', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-mcp-root-validation-'));
  const runtime = path.join(directory, 'lookalike-runtime');
  const sentinel = path.join(directory, 'started');
  try {
    fs.mkdirSync(path.join(runtime, 'dist', 'apps', 'mcp', 'src'), {recursive: true});
    fs.writeFileSync(path.join(runtime, 'dist', 'apps', 'mcp', 'src', 'main.js'), `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'started');\n`, 'utf8');
    const failed = spawnSync(process.execPath, [traceMcpLauncher], {encoding: 'utf8', env: {...process.env, TRACE_RUNTIME_ROOT: runtime}});
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /could not validate its installed runtime/i);
    assert.equal(fs.existsSync(sentinel), false, 'launcher must validate the runtime before starting its MCP entry');
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});

function fakeCodexCommand(directory) {
  const stateFile = path.join(directory, 'fake-codex-state.json');
  const scriptFile = path.join(directory, 'fake-codex.mjs');
  fs.writeFileSync(stateFile, JSON.stringify({marketplace: false, plugin: false}), 'utf8');
  const source = [
    "import fs from 'node:fs';",
    "const stateFile = process.env.FAKE_CODEX_STATE;",
    "const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));",
    "const args = process.argv.slice(2);",
    "const fail = process.env.FAKE_CODEX_FAIL;",
    "const save = () => fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');",
    "if (args.join(' ') === 'plugin marketplace list --json') { process.stdout.write(JSON.stringify({marketplaces: state.marketplace ? [{name: 'trace-runtime-local'}] : []})); }",
    "else if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') { if (fail === 'marketplace-add') { process.stderr.write('marketplace add failed'); process.exit(17); } state.marketplace = true; save(); process.stdout.write('added'); }",
    "else if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'remove') { state.marketplace = false; save(); process.stdout.write('removed'); }",
    "else if (args[0] === 'plugin' && args[1] === 'remove') { state.plugin = false; save(); process.stdout.write('removed'); }",
    "else if (args[0] === 'plugin' && args[1] === 'add') { if (fail === 'plugin-add' && !state.plugin_add_failed) { state.plugin_add_failed = true; save(); process.stderr.write('plugin add failed'); process.exit(18); } state.plugin = true; save(); process.stdout.write('installed'); }",
    "else { process.stderr.write('unexpected fake codex command'); process.exit(19); }",
  ].join('\n');
  fs.writeFileSync(scriptFile, source, 'utf8');
  return {command: process.execPath, stateFile, argument: scriptFile};
}

test('Codex plugin installer restores a replaced plugin after plugin add fails', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-plugin-add-rollback-'));
  const marketplace = path.join(directory, 'marketplace');
  const fake = fakeCodexCommand(directory);
  const invoke = failure => spawnSync(process.execPath, [codexPluginInstaller, '--runtime-root', root, '--marketplace-root', marketplace, '--codex-command', fake.command, '--codex-arg', fake.argument, '--confirm', 'true', ...(fs.existsSync(marketplace) ? ['--replace'] : [])], {encoding: 'utf8', env: {...process.env, FAKE_CODEX_STATE: fake.stateFile, ...(failure ? {FAKE_CODEX_FAIL: failure} : {})}});
  try {
    const installed = invoke(); assert.equal(installed.status, 0, installed.stderr);
    assert.equal(fs.existsSync(path.join(marketplace, '.agents', 'plugins', 'marketplace.json')), true, 'Codex local marketplaces require the .agents/plugins manifest location');
    fs.writeFileSync(path.join(marketplace, 'old-marketplace-marker.txt'), 'old', 'utf8');
    const failed = invoke('plugin-add');
    assert.notEqual(failed.status, 0);
    assert.equal(JSON.parse(failed.stderr).code, 'CODEX_COMMAND_FAILED');
    assert.equal(fs.readFileSync(path.join(marketplace, 'old-marketplace-marker.txt'), 'utf8'), 'old');
    const recovered = JSON.parse(fs.readFileSync(fake.stateFile, 'utf8'));
    assert.equal(recovered.marketplace, true); assert.equal(recovered.plugin, true);
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});
