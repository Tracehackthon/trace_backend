import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildContextSkillPackage, validateContextSkillPackage} from '../dist/packages/core/context/src/index.js';
import {applyProjectInitialize, proposeProjectInitialize, receiveContextSkillPackage} from '../dist/packages/product/application/src/index.js';
import {TraceRuntime} from '../dist/packages/core/runtime/src/index.js';

const hash = character => character.repeat(64);

function sample(overrides = {}) {
  return {
    host_session_id: 'codex-task-context-1',
    project: {project_id: 'trace-project', project_label: 'Trace Project'},
    instructions: 'Use the locked collaboration model.\nRead source entry points only when relevant.',
    activation_lock: {lock_id: 'activation-test', version: '0.1.0'},
    collaboration_model: {model_id: 'model-test', version: '1.2.3', sha256: hash('a')},
    source_activation: {manifest_id: 'source-map-test', version: '2.0.0', source_id: 'source-test', sha256: hash('b'), entry_point_count: 2, available: true},
    generated_at: '2026-09-15T00:00:00.000Z',
    ...overrides,
  };
}

test('context Skill packages are canonical, bounded, task-bound, and hash verified', () => {
  const contextPackage = buildContextSkillPackage(sample());
  assert.equal(contextPackage.protocol_id, 'trace.context-skill-package');
  assert.equal(contextPackage.protocol_version, '0.1.0');
  assert.equal(contextPackage.artifact_kind, 'context-pack');
  assert.equal(contextPackage.session_binding.session_id, 'codex-task-context-1');
  assert.match(contextPackage.skill.skill_md, /^---\nname: trace-project-context\ndescription:/);
  assert.match(contextPackage.skill.skill_md, /Use the locked collaboration model\./);
  assert.deepEqual(validateContextSkillPackage(contextPackage), contextPackage);

  assert.throws(
    () => validateContextSkillPackage({...contextPackage, unexpected: true}),
    error => error?.code === 'UNKNOWN_FIELD',
  );
  assert.throws(
    () => validateContextSkillPackage({...contextPackage, skill: {...contextPackage.skill, instructions: 'tampered'}}),
    error => error?.code === 'HASH_MISMATCH',
  );
  assert.throws(
    () => validateContextSkillPackage({...contextPackage, boundaries: contextPackage.boundaries.slice(1)}),
    error => error?.code === 'INVALID_FIELD',
  );
  assert.throws(
    () => buildContextSkillPackage(sample({instructions: 'x'.repeat(12_001)})),
    error => error?.code === 'INVALID_FIELD',
  );
  assert.throws(
    () => buildContextSkillPackage(sample({host_session_id: 'bad\nsession'})),
    error => error?.code === 'INVALID_FIELD',
  );
});

test('product application receives one locked context Skill package and persists an idempotent activation receipt', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-context-skill-'));
  try {
    const proposal = proposeProjectInitialize({project_dir: project, source_mode: 'local'});
    applyProjectInitialize({
      project_dir: project,
      source_mode: 'local',
      proposal_id: proposal.proposal_id,
      approval: `adopt:${proposal.proposal_id}`,
    });

    const received = receiveContextSkillPackage({project_dir: project, host_session_id: 'codex-real-context-task'});
    assert.equal(received.receipt.status, 'received');
    assert.equal(received.receipt.session_id, 'codex-real-context-task');
    assert.equal(received.receipt.project_id, path.basename(project).toLowerCase());
    assert.equal(received.receipt.package_id, received.package.package_id);
    assert.equal(received.receipt.content_sha256, received.package.content_sha256);
    assert.equal(received.package.provenance.source_activation.available, true);
    assert.match(received.package.skill.instructions, /Trace collaboration context \(versioned, user-visible\):/);
    assert.match(received.package.skill.instructions, /navigation for relevant work/);
    assert.deepEqual(validateContextSkillPackage(received.package), received.package);
    const serialized = JSON.stringify(received);
    assert.equal(serialized.includes(project), false, 'package and receipt must not return the project or source absolute root');
    assert.equal(serialized.includes(path.join(project, '.trace', 'source')), false);

    const repeated = receiveContextSkillPackage({project_dir: project, host_session_id: 'codex-real-context-task'});
    assert.equal(repeated.package.package_id, received.package.package_id);
    assert.equal(repeated.package.content_sha256, received.package.content_sha256);
    assert.equal(repeated.receipt.receipt_id, received.receipt.receipt_id);

    let runtime = new TraceRuntime({sqliteStateFile: path.join(project, '.trace', 'state', 'trace.sqlite')});
    assert.equal(runtime.listContinuity().length, 2, 'exact replay keeps one thread and one activation receipt');
    runtime.close();

    fs.rmSync(path.join(project, '.trace', 'source', 'wiki'), {recursive: true, force: true});
    const unavailable = receiveContextSkillPackage({project_dir: project, host_session_id: 'codex-real-context-task-2'});
    assert.equal(unavailable.package.provenance.source_activation.available, false);
    assert.match(unavailable.package.skill.instructions, /not available; do not imply source access/);
    assert.notEqual(unavailable.package.package_id, received.package.package_id, 'session and source availability are bound into package identity');

    runtime = new TraceRuntime({sqliteStateFile: path.join(project, '.trace', 'state', 'trace.sqlite')});
    assert.equal(runtime.listContinuity().length, 4);
    runtime.close();

    fs.rmSync(path.join(project, '.trace', 'profiles', 'collaboration-model.json'));
    fs.rmSync(path.join(project, '.trace', 'profiles', 'source-activation.json'));
    fs.rmSync(path.join(project, '.trace', 'instance', 'activation.lock.json'));
    assert.throws(
      () => receiveContextSkillPackage({project_dir: project, host_session_id: 'codex-legacy-task'}),
      error => error?.code === 'PROFILE_MIGRATION_REQUIRED',
    );
  } finally {
    fs.rmSync(project, {recursive: true, force: true});
  }
});
