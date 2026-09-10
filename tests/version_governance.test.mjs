import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = path.resolve(process.cwd());

test('release governance uses main and validates separate runtime, package and protocol tracks', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'audit-versions.mjs')], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'healthy');
  assert.equal(report.release_branch, 'main');
  assert.equal(report.runtime_version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
  assert.equal(report.protocol_tracks['trace.continuity'], '0.2.0');
  assert.ok(report.workspace_packages > 10);
});
