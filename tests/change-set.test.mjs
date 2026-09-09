import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {TraceRuntime} from '../dist/packages/core/runtime/src/index.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-runtime-ts-'));
  const changeState = path.join(dir, 'state', 'change-sets.jsonl');
  const dataState = path.join(dir, 'state', 'data.jsonl');
  const runtime = new TraceRuntime({changeStateFile: changeState, dataStateFile: dataState});
  const input = {
    change_kind: 'protocol',
    subject: {type: 'trace.external-source.zhihu', id: 'trace.external-source.zhihu'},
    base: {protocol_version: '0.1.0'},
    proposed: {protocol_version: '0.2.0'},
    impact: ['zhihu-adapter', 'candidate-precedent'],
    compatibility: {backward_compatible: false, migration_required: true, impact_level: 'high'},
    requested_by: 'user',
    scope: {type: 'personal', id: 'trace'},
    lineage: {input_refs: [], output_refs: [], parent_change_ids: [], causation_id: 'test:change', correlation_id: 'test:run'},
  };
  return {dir, state: changeState, dataState, runtime, input};
}

test('create is idempotent and writes protocol identity', () => {
  const f = fixture();
  const first = f.runtime.createChange(f.input);
  const second = f.runtime.createChange(f.input);
  assert.equal(first.status, 'created');
  assert.equal(second.status, 'no_change');
  assert.equal(first.record.change_id, second.record.change_id);
  assert.equal(first.record.protocol_id, 'trace.change-set');
  assert.equal(first.record.revision, 1);
  assert.equal(fs.readFileSync(f.state, 'utf8').trim().split('\n').length, 1);
});

test('change records cannot be created without explicit data lineage', () => {
  const f = fixture();
  const {lineage: _ignored, ...withoutLineage} = f.input;
  assert.throws(() => f.runtime.createChange(withoutLineage), /lineage/);
  assert.throws(() => f.runtime.createChange({...f.input, accidental_field: true}), /unsupported fields/);
});

test('validation, adoption, promotion, and rollback gates are explicit', () => {
  const f = fixture();
  const created = f.runtime.createChange(f.input).record;
  const analyzed = f.runtime.updateChange(created.change_id, {expected_revision: 1, status: 'analyzed'});
  assert.throws(() => f.runtime.updateChange(created.change_id, {expected_revision: 2, status: 'validated'}), /validated requires/);
  const validated = f.runtime.updateChange(created.change_id, {expected_revision: 2, status: 'validated', validation: {schema: 'passed', replay: 'passed'}});
  const adopted = f.runtime.updateChange(created.change_id, {expected_revision: 3, status: 'adopted', decided_by: 'user'});
  const promoted = f.runtime.updateChange(created.change_id, {expected_revision: 4, status: 'promoted', validation: {behavior: 'passed'}, promotion_target: 'codex-baseline-20260909'});
  assert.equal(analyzed.status, 'analyzed');
  assert.equal(validated.status, 'validated');
  assert.equal(adopted.adoption.status, 'adopted');
  assert.equal(promoted.promotion.target, 'codex-baseline-20260909');
  assert.throws(() => f.runtime.updateChange(created.change_id, {expected_revision: 5, status: 'rolled_back'}), /rolled_back requires/);
  const rolledBack = f.runtime.updateChange(created.change_id, {expected_revision: 5, status: 'rolled_back', rollback_target: 'codex-baseline-20260908', rollback_reason: 'behavior regression'});
  assert.equal(rolledBack.rollback.status, 'rolled_back');
});

test('CAS rejects stale writers without appending a competing revision', () => {
  const f = fixture();
  const created = f.runtime.createChange(f.input).record;
  f.runtime.updateChange(created.change_id, {expected_revision: 1, status: 'analyzed'});
  assert.throws(() => f.runtime.updateChange(created.change_id, {expected_revision: 1, status: 'rejected'}), /Expected revision 1, found 2/);
  assert.equal(f.runtime.listChanges()[0].revision, 2);
});

test('hand-edited persisted rows fail closed instead of becoming trusted state', () => {
  const f = fixture();
  f.runtime.createChange(f.input);
  fs.appendFileSync(f.state, JSON.stringify({change_id: 'change-tampered', revision: 1, status: 'promoted'}) + '\n');
  assert.throws(() => f.runtime.listChanges(), /Unsupported Change Set protocol/);
});

test('CLI and RPC-facing JSON shape are usable without repository defaults', () => {
  const f = fixture();
  const cli = path.resolve('dist/apps/cli/src/main.js');
  const args = ['change', 'create', '--change-state-file', f.state, '--data-state-file', f.dataState, '--change-kind', 'result', '--subject-type', 'zhihu.result', '--subject-id', 'zhihu.result', '--base', '{"schema_version":1}', '--proposed', '{"schema_version":2}', '--impact', 'result-schema', '--compatibility', '{"backward_compatible":false,"migration_required":true,"impact_level":"medium"}', '--requested-by', 'user', '--scope-type', 'personal', '--scope-id', 'trace', '--lineage', '{"input_refs":[],"output_refs":[],"parent_change_ids":[],"causation_id":"cli:test","correlation_id":"cli:run"}'];
  const child = spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8'});
  assert.equal(child.status, 0, child.stderr);
  const output = JSON.parse(child.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.record.protocol_id, 'trace.change-set');
  assert.equal(output.record.change_kind, 'result');
  const contentHash = crypto.createHash('sha256').update('cli-source').digest('hex');
  const dataArgs = ['data', 'create', '--change-state-file', f.state, '--data-state-file', f.dataState, '--kind', 'source_snapshot', '--schema-id', 'trace.external-source.zhihu', '--schema-version', '0.1.0', '--subject-type', 'zhihu.answer', '--subject-id', 'cli-source', '--scope-type', 'personal', '--scope-id', 'trace', '--classification', 'public', '--origin', JSON.stringify({provider: 'synthetic', source_id: 'cli-source', captured_at: new Date().toISOString(), content_hash: contentHash}), '--producer', JSON.stringify({component: 'cli-test', version: '1', run_id: 'cli-data-run'}), '--lineage', JSON.stringify({parent_refs: [], source_refs: [], causation_id: 'cli-data:capture', correlation_id: 'cli-data:run'}), '--payload', JSON.stringify({source_id: 'cli-source', provider: 'zhihu', external_id: 'cli-source', title: 'CLI source', content: 'cli-source', captured_at: new Date().toISOString(), content_hash: contentHash})];
  const dataChild = spawnSync(process.execPath, [cli, ...dataArgs], {encoding: 'utf8'});
  assert.equal(dataChild.status, 0, dataChild.stderr);
  const dataOutput = JSON.parse(dataChild.stdout);
  assert.equal(dataOutput.ok, true);
  assert.equal(dataOutput.record.kind, 'source_snapshot');
});

