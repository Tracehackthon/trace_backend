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
  const model = JSON.parse(fs.readFileSync(path.join(project, '.trace', 'profiles', 'collaboration-model.json'), 'utf8'));
  const sourceMap = JSON.parse(fs.readFileSync(path.join(project, '.trace', 'profiles', 'source-activation.json'), 'utf8'));
  const activationLock = JSON.parse(fs.readFileSync(path.join(project, '.trace', 'instance', 'activation.lock.json'), 'utf8'));
  assert.equal(model.model_id, 'trace.cognitive-collaboration-starter');
  assert.equal(sourceMap.source_id, 'project-cognitive-source');
  assert.equal(sourceMap.entry_points.length, 0, 'a cold-start map must not impersonate a personal knowledge base');
  assert.match(activationLock.collaboration_model.sha256, /^[a-f0-9]{64}$/);
  assert.match(activationLock.source_activation.sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(activationLock).includes(project), false, 'the committable lock must not contain local source paths');
});

test('project init external mode keeps the external root in local profile only', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-project-'));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-source-'));
  const profile = path.join(source, 'profile.json');
  fs.writeFileSync(profile, JSON.stringify({
    source_id: 'external-source', root: source, user_id: 'test-user', formal_prefix: 'wiki',
    collaboration_model: {
      protocol_id: 'trace.collaboration-model', protocol_version: '0.1.0', model_id: 'test.personal-collaboration', version: '1.0.0', display_name: 'Test Personal Collaboration', scope: 'personal',
      principles: ['Use the user-provided collaboration contract only when it is relevant.'],
      open_discussion: ['Let an unfinished thought continue before converting it into a checklist.'],
      explicit_execution: ['Execute an explicit request and preserve the proposal/adoption boundary.'],
      epistemic_practice: ['Separate source evidence from inference.'],
      boundaries: ['PRIVATE_MODEL_TEXT_MUST_STAY_LOCAL_TO_PROFILE_FILES.'],
    },
    activation_manifest: {
      protocol_id: 'trace.source-activation', protocol_version: '0.1.0', manifest_id: 'test.personal-source-map', version: '1.0.0', source_id: 'external-source', display_name: 'Test Cognitive Source', summary: 'A user-selected local map.', activation_profiles: ['open-discussion'],
      entry_points: [{id: 'collaboration', label: 'Collaboration stance', kind: 'capability', purpose: 'Use when discussing collaboration.', triggers: ['collaboration'], locator: 'wiki/collaboration.md'}],
    },
  }));
  const run = spawnSync(process.execPath, [cli, 'project', 'init', '--project-dir', project, '--user-id', 'test-user', '--template', 'trace.codex-starter', '--source-mode', 'external', '--source-profile', profile, '--confirm', 'true'], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const descriptor = JSON.parse(fs.readFileSync(path.join(project, '.trace', 'project.json'), 'utf8'));
  assert.equal(descriptor.source_root, '.trace/profiles/source.profile.json');
  assert.equal(JSON.stringify(descriptor).includes(source), false);
  const lock = JSON.parse(fs.readFileSync(path.join(project, '.trace', 'instance', 'trace.lock.json'), 'utf8'));
  assert.deepEqual(lock.selected_source, {source_id: 'external-source', profile_hash: lock.selected_source.profile_hash, scope_type: 'personal'});
  const model = JSON.parse(fs.readFileSync(path.join(project, '.trace', 'profiles', 'collaboration-model.json'), 'utf8'));
  const sourceMap = JSON.parse(fs.readFileSync(path.join(project, '.trace', 'profiles', 'source-activation.json'), 'utf8'));
  const activationLock = JSON.parse(fs.readFileSync(path.join(project, '.trace', 'instance', 'activation.lock.json'), 'utf8'));
  assert.equal(model.model_id, 'test.personal-collaboration');
  assert.equal(sourceMap.entry_points[0].locator, 'wiki/collaboration.md');
  assert.equal(JSON.stringify(activationLock).includes('PRIVATE_MODEL_TEXT_MUST_STAY_LOCAL_TO_PROFILE_FILES'), false);
  assert.equal(JSON.stringify(activationLock).includes(source), false);
});

test('project init refuses a non-empty existing .trace without leaving staging files', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-project-'));
  fs.mkdirSync(path.join(project, '.trace'), {recursive: true});
  fs.writeFileSync(path.join(project, '.trace', 'marker.txt'), 'keep');
  const run = spawnSync(process.execPath, [cli, 'project', 'init', '--project-dir', project, '--user-id', 'test-user', '--template', 'trace.codex-empty', '--confirm', 'true'], {encoding: 'utf8'});
  assert.notEqual(run.status, 0);
  assert.match(run.stdout, /INSTANCE_EXISTS/);
  assert.deepEqual(fs.readdirSync(project).filter(name => name.startsWith('.trace-init-')), []);
  assert.equal(fs.readFileSync(path.join(project, '.trace', 'marker.txt'), 'utf8'), 'keep');
});
