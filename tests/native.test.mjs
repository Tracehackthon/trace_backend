import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root = path.resolve(process.cwd());
const installer = path.join(root, 'native', 'install.mjs');
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
