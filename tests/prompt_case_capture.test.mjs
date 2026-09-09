import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {TraceRuntime} from '../dist/packages/core/runtime/src/index.js';
import {hashTransientPrompt} from '../dist/packages/core/case-capture/src/index.js';
import {openSqlite} from '../dist/packages/core/storage/src/index.js';

const producer = {component: 'trace-test', version: '1.0.0', run_id: 'prompt-case-test'};
const scope = {type: 'personal', id: 'user-test'};

function trace() { return {correlation_id: 'corr-prompt-case', causation_id: 'cause-prompt-case'}; }
function sourceRef(record) { return {record_id: record.record_id, revision: record.revision, kind: record.kind, schema_id: record.schema_id, schema_version: record.schema_version}; }

test('prompt case only persists a user-selected content mode after explicit approval', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-prompt-case-'));
  const database = path.join(directory, 'trace.sqlite');
  const rawPrompt = 'RAW_PROMPT_DO_NOT_PERSIST_UNTIL_APPROVED_64bade';
  const runtime = new TraceRuntime({sqliteStateFile: database});

  const proposal = runtime.proposePromptCase({
    prompt_hash: hashTransientPrompt(rawPrompt), capture_mode: 'summary', intent_summary: 'Request a repeatable review of multi-agent handoff.', rationale: 'The outcome may become a reusable precedent.', scope, producer, ...trace(),
  });
  assert.equal(JSON.stringify(proposal).includes(rawPrompt), false);
  assert.equal(proposal.status, 'candidate');
  assert.throws(() => runtime.capturePromptCase({proposal_ref: proposal.proposal_ref, approval: 'approve:wrong', selected_content: 'Safe, user-written summary.', producer, ...trace()}), error => error?.code === 'USER_CONFIRMATION_REQUIRED');

  const result = runtime.capturePromptCase({proposal_ref: proposal.proposal_ref, approval: `approve:${proposal.proposal_ref.record_id}`, selected_content: 'Safe, user-written summary.', producer, ...trace()});
  assert.equal(result.proposal.status, 'adopted');
  assert.equal(result.capture_mode, 'summary');
  assert.equal(result.classification, 'private');
  const snapshot = runtime.data.get(result.source_snapshot_ref.record_id, result.source_snapshot_ref.revision);
  assert.equal(snapshot.payload.content, 'Safe, user-written summary.');
  assert.equal(JSON.stringify(snapshot).includes(rawPrompt), false);
  runtime.close();

  const opened = openSqlite(database, {readOnly: true});
  try {
    const allPayloads = opened.db.prepare('SELECT payload FROM data_records').all();
    assert.equal(JSON.stringify(allPayloads).includes(rawPrompt), false, 'raw input never crosses proposal storage');
  } finally { opened.db.close(); }
});

test('full_private prompt data is persistable only through the separate approved capture boundary', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-prompt-case-private-'));
  const database = path.join(directory, 'trace.sqlite');
  const rawPrompt = 'FULL_PRIVATE_PROMPT_EXPLICITLY_CHOSEN_7c9df1';
  const runtime = new TraceRuntime({sqliteStateFile: database});
  const proposal = runtime.proposePromptCase({prompt_hash: hashTransientPrompt(rawPrompt), capture_mode: 'full_private', intent_summary: 'Keep exact wording for a private replay case.', rationale: 'Exact wording matters to this private case.', scope, producer, ...trace()});
  assert.throws(() => runtime.capturePromptCase({proposal_ref: proposal.proposal_ref, approval: `approve:${proposal.proposal_ref.record_id}`, selected_content: 'different content', producer, ...trace()}), error => error?.code === 'PROMPT_HASH_MISMATCH');
  const result = runtime.capturePromptCase({proposal_ref: proposal.proposal_ref, approval: `approve:${proposal.proposal_ref.record_id}`, selected_content: rawPrompt, producer, ...trace()});
  const snapshot = runtime.data.get(result.source_snapshot_ref.record_id, result.source_snapshot_ref.revision);
  assert.equal(snapshot.classification, 'private');
  assert.equal(snapshot.payload.content, rawPrompt);
  runtime.close();
});

test('an approved prompt source plus an outcome can become a candidate precedent', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-prompt-precedent-'));
  const database = path.join(directory, 'trace.sqlite');
  const runtime = new TraceRuntime({sqliteStateFile: database});
  const proposal = runtime.proposePromptCase({prompt_hash: hashTransientPrompt('reusable prompt'), capture_mode: 'redacted_excerpt', intent_summary: 'A redacted collaboration problem.', rationale: 'Candidate precedent evidence.', redacted_preview: 'Agent A omitted [redacted] handoff state.', scope, producer, ...trace()});
  const captured = runtime.capturePromptCase({proposal_ref: proposal.proposal_ref, approval: `approve:${proposal.proposal_ref.record_id}`, selected_content: 'Agent A omitted [redacted] handoff state.', producer, ...trace()});
  const outcome = runtime.createData({kind: 'source_snapshot', schema_id: 'trace.test-outcome', schema_version: '0.1.0', subject: {type: 'outcome', id: 'outcome-001'}, scope, origin: {provider: 'test', source_id: 'outcome-001', captured_at: new Date().toISOString(), content_hash: 'a'.repeat(64)}, producer, lineage: {parent_refs: [], source_refs: [], ...trace()}, classification: 'internal', payload: {source_id: 'outcome-001', provider: 'test', external_id: 'outcome-001', title: 'Observed outcome', content: 'A user-visible receipt resolved the handoff ambiguity.', captured_at: new Date().toISOString(), content_hash: 'a'.repeat(64)}});
  const change = runtime.createChange({change_kind: 'runtime', subject: {type: 'prompt-case', id: 'candidate-001'}, base: {}, proposed: {}, impact: ['candidate precedent'], compatibility: {backward_compatible: true, migration_required: false, impact_level: 'low'}, requested_by: 'test-user', scope, lineage: {input_refs: [], output_refs: [], parent_change_ids: [], ...trace()}});
  const precedent = runtime.createPromptCasePrecedent({candidate_id: 'candidate-001', prompt_source_ref: captured.source_snapshot_ref, outcome_refs: [sourceRef(outcome)], claim: 'Visible receipts prevent agent handoff ambiguity.', rationale: 'The captured outcome showed the user could continue with a concrete next action.', scope, origin: {provider: 'trace-test', source_id: 'candidate-001', captured_at: new Date().toISOString(), content_hash: 'b'.repeat(64)}, producer, classification: 'internal', change_id: change.record.change_id, ...trace()});
  assert.equal(precedent.kind, 'candidate_precedent');
  assert.equal(precedent.payload.prompt_case_source_ref, `${captured.source_snapshot_ref.record_id}@${captured.source_snapshot_ref.revision}`);
  assert.equal(runtime.verifyDataChain(precedent.record_id).complete, true);
  runtime.close();
});
