import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root = path.resolve(process.cwd());
const installer = path.join(root, 'native', 'install.mjs');
const codexPluginInstaller = path.join(root, 'native', 'install-codex-plugin.mjs');
const packager = path.join(root, 'scripts', 'package.mjs');
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
    assert.equal(fs.existsSync(path.join(output, 'plugins', 'trace-codex', '.codex-plugin', 'plugin.json')), true);
    assert.equal(fs.existsSync(path.join(output, 'dist', 'apps', 'mcp', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'server', 'mcp.js')), true);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'release-manifest.json'), 'utf8'));
    assert.equal(manifest.files.some(file => file.path === 'docs/getting-started.md'), true);
    const installed = path.join(directory, 'installed');
    const installedRuntime = spawnSync(process.execPath, [installer, '--package', output, '--target', installed], {encoding: 'utf8'});
    assert.equal(installedRuntime.status, 0, installedRuntime.stderr);
    assert.equal(fs.existsSync(path.join(installed, 'plugins', 'trace-codex', '.mcp.json')), true);
    assert.equal(fs.existsSync(path.join(installed, 'dist', 'apps', 'mcp', 'node_modules', 'zod', 'v3', 'index.js')), true);
    const pluginPlan = spawnSync(process.execPath, [path.join(installed, 'native', 'install-codex-plugin.mjs'), '--runtime-root', installed, '--marketplace-root', path.join(directory, 'codex-marketplace'), '--dry-run'], {encoding: 'utf8'});
    assert.equal(pluginPlan.status, 0, pluginPlan.stderr);
    assert.equal(JSON.parse(pluginPlan.stdout).plugin, 'trace-codex');
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
    assert.equal(fs.existsSync(marketplace), false);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
