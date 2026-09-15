import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {TraceRuntime} from '../dist/packages/core/runtime/src/index.js';
import {validateContinuityEnvelope} from '../dist/packages/core/continuity/src/index.js';

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-decision-'));
  const runtime = new TraceRuntime({sqliteStateFile: path.join(directory, 'trace.sqlite')});
  runtime.createThread({thread_id: 'thread-path', title: '决策路径测试', current_summary: '开始'});
  return runtime;
}

test('decision trail records forks, taken branches with rationale, and revision chains', () => {
  const runtime = setup();
  const fork = runtime.createDecisionPoint({thread_id: 'thread-path', prompt: '如何处理这份草案？', options: ['全部采纳', '逐条协商修改', '放弃']});
  assert.equal(fork.payload.status, 'pending');
  assert.equal(fork.payload.round, 1);
  assert.equal(runtime.pendingDecisions('thread-path').length, 1);

  // A decided fork must reference a real branch and carry its rationale.
  // (Protocol errors surface through the SQLite CAS wrapper message.)
  assert.throws(() => runtime.resolveDecisionPoint(fork.record_id, {expected_revision: fork.revision, chosen: '不存在的分支', rationale: 'x'}), /must be one of its options/);
  assert.throws(() => runtime.resolveDecisionPoint(fork.record_id, {expected_revision: fork.revision, chosen: '放弃', rationale: ''}), /rationale/);

  // Revision supersedes the fork and links a child round instead of overwriting.
  const child = runtime.reviseDecisionPoint(fork.record_id, {expected_revision: fork.revision, prompt: '如何处理这份草案（第二版）？', options: ['全部采纳', '放弃'], rationale: '用户要求去掉第二条'});
  assert.equal(child.payload.round, 2);
  assert.equal(child.payload.parent_decision_id, fork.record_id);
  const superseded = runtime.listContinuity('thread-path').find(record => record.record_id === fork.record_id);
  assert.equal(superseded.payload.status, 'superseded');
  assert.equal(superseded.payload.rationale, '用户要求去掉第二条');
  assert.throws(() => runtime.resolveDecisionPoint(fork.record_id, {expected_revision: superseded.revision, chosen: '放弃', rationale: 'x'}), /already superseded/);

  const decided = runtime.resolveDecisionPoint(child.record_id, {expected_revision: child.revision, chosen: '全部采纳', rationale: '第二版可以接受'});
  assert.equal(decided.payload.status, 'decided');

  const path = runtime.decisionPath('thread-path');
  assert.equal(path.nodes.length, 2);
  assert.equal(path.pending.length, 0);
  assert.deepEqual(path.taken, [{record_id: child.record_id, chosen: '全部采纳', rationale: '第二版可以接受'}]);
  assert.equal(path.nodes[0].status, 'superseded');
  assert.equal(path.nodes[1].parent_decision_id, fork.record_id);
  runtime.close();
});

test('continuity 0.1.0 and 0.2.0 records upcast to 0.3.0 fail-open-free', () => {
  const base = {
    protocol_id: 'trace.continuity', record_id: 'continuity-thread-legacy', revision: 1, kind: 'thread', thread_id: 'thread-legacy',
    visibility: 'summary', payload: {title: '旧记录', status: 'open', current_summary: 'legacy', candidate_refs: [], adopted_refs: [], open_questions: []},
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const from02 = validateContinuityEnvelope({...base, protocol_version: '0.2.0', correlation_id: 'c', causation_id: 'k'});
  assert.equal(from02.protocol_version, '0.3.0');
  const from01 = validateContinuityEnvelope({...base, protocol_version: '0.1.0'});
  assert.equal(from01.protocol_version, '0.3.0');
  assert.equal(typeof from01.correlation_id, 'string');
  assert.throws(() => validateContinuityEnvelope({...base, protocol_version: '0.9.0', correlation_id: 'c', causation_id: 'k'}), error => error?.code === 'PROTOCOL_MIGRATION_REQUIRED');
});
