import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = path.resolve(process.cwd());
const cli = path.join(root, 'dist', 'apps', 'cli', 'src', 'main.js');

test('project init creates a local source boundary without personal paths', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-project-'));
  const run = spawnSync(process.execPath, [cli, 'project', 'init', '--project-dir', project, '--user-id', 'test-user', '--template', 'trace.codex-starter', '--source-mode', 'local', '--confirm', 'true'], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const output = JSON.parse(run.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.descriptor.source_root, '.trace/source');
  assert.equal(fs.existsSync(path.join(project, '.trace', 'source', 'wiki')), true);
  assert.equal(fs.existsSync(path.join(project, '.trace', 'state')), true);
  const descriptor = JSON.parse(fs.readFileSync(path.join(project, '.trace', 'project.json'), 'utf8'));
  assert.equal(descriptor.source_root, '.trace/source');
  assert.equal(JSON.stringify(descriptor).includes(project), false);
  const profile = JSON.parse(fs.readFileSync(path.join(project, '.trace', 'profiles', 'source.profile.json'), 'utf8'));
  assert.equal(profile.root, path.join(project, '.trace', 'source'));
});

test('project init external mode keeps the external root in local profile only', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-project-'));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-source-'));
  const profile = path.join(source, 'profile.json');
  fs.writeFileSync(profile, JSON.stringify({source_id: 'external-source', root: source, user_id: 'test-user', formal_prefix: 'wiki'}));
  const run = spawnSync(process.execPath, [cli, 'project', 'init', '--project-dir', project, '--user-id', 'test-user', '--template', 'trace.codex-starter', '--source-mode', 'external', '--source-profile', profile, '--confirm', 'true'], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const descriptor = JSON.parse(fs.readFileSync(path.join(project, '.trace', 'project.json'), 'utf8'));
  assert.equal(descriptor.source_root, '.trace/profiles/source.profile.json');
  assert.equal(JSON.stringify(descriptor).includes(source), false);
  const lock = JSON.parse(fs.readFileSync(path.join(project, '.trace', 'instance', 'trace.lock.json'), 'utf8'));
  assert.deepEqual(lock.selected_source, {source_id: 'external-source', profile_hash: lock.selected_source.profile_hash, scope_type: 'personal'});
});
