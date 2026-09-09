import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {TraceRuntime} from '../dist/packages/core/runtime/src/index.js';
import {buildActivationPack} from '../dist/packages/core/context/src/index.js';
import {buildTemplateLock, previewTemplate, validateTemplateManifest} from '../dist/packages/template/contract/src/index.js';
import {migrateJsonlToSqlite} from '../dist/packages/core/migration/src/index.js';
import {buildCodexActivation, buildCodexActivationReceipt} from '../dist/apps/codex/src/index.js';

function hash(value) { return createHash('sha256').update(value).digest('hex'); }

function sourceInput() {
  const content = 'synthetic local source for productization';
  const contentHash = hash(content);
  return {
    kind: 'source_snapshot',
    schema_id: 'trace.source.snapshot',
    schema_version: '0.1.0',
    subject: {type: 'source', id: 'synthetic-source'},
    scope: {type: 'personal', id: 'test-user'},
    origin: {provider: 'synthetic', source_id: 'synthetic-source', captured_at: new Date().toISOString(), content_hash: contentHash},
    producer: {component: 'productization-test', version: '1.0.0', run_id: 'test-run'},
    lineage: {parent_refs: [], source_refs: [], causation_id: 'test-cause', correlation_id: 'test-correlation'},
    classification: 'private',
    payload: {source_id: 'synthetic-source', provider: 'synthetic', external_id: 'source-1', title: 'Synthetic source', content, captured_at: new Date().toISOString(), content_hash: contentHash},
  };
}

test('SQLite runtime stores data and user-visible continuity receipts separately from JSONL concerns', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-productization-'));
  const db = path.join(dir, 'trace.db');
  const runtime = new TraceRuntime({sqliteStateFile: db});
  const thread = runtime.createThread({title: 'Agent collaboration', current_summary: 'Reviewing a possible collaboration issue', open_questions: ['Is this a version problem?'], next_action: 'Collect another case'});
  const source = runtime.createData(sourceInput());
  const turn = runtime.appendDiscussionTurn({thread_id: thread.record_id, user_input_summary: 'Two agents changed one skill', output_summary: 'Possible capability version drift', delta_type: 'new_candidate', context_refs: ['source'], persisted_refs: [source.record_id + '@1'], open_questions: ['Need a second case']});
  const receipt = runtime.createReceipt({thread_id: thread.record_id, receipt_kind: 'persistence', summary: 'Saved one candidate; did not publish or update Wiki', persisted_refs: [turn.record_id + '@1'], not_persisted: ['full chat transcript'], required_user_action: 'Continue validation', next_prompts: ['Find a second case']});
  assert.equal(runtime.listContinuity(thread.record_id).length, 3);
  assert.equal(receipt.payload.required_user_action, 'Continue validation');
  assert.equal(runtime.listData('source_snapshot').length, 1);
  assert.equal(fs.existsSync(db), true);
  runtime.changes.store.close?.();
  runtime.data.store.close?.();
  runtime.continuity?.store.close?.();
});

test('activation packs and starter templates are previewable and lockable', () => {
  const pack = buildActivationPack({purpose: 'continue collaboration topic', summary: 'Use only the selected evidence and show a persistence receipt', source_refs: [{record_id: 'src-local', revision: 3, label: 'Local collaboration source'}], read_pointers: [{path: 'wiki/capabilities/collaboration/共同思考协作能力.md', purpose: 'Confirm collaboration boundary', priority: 'must', stop_condition: 'The current responsibility rule is confirmed'}]});
  assert.equal(pack.protocol_id, 'trace.context-record');
  assert.equal(pack.budget.max_tokens, 6000);
  const manifest = validateTemplateManifest(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'templates/codex-starter/manifest.json'), 'utf8')));
  const preview = previewTemplate(manifest);
  assert.equal(preview.requires_confirmation, true);
  assert.ok(preview.additions.some(item => item.includes('agent-collaboration-governance')));
  const lock = buildTemplateLock(manifest, '0.6.0', 'instance-test');
  assert.equal(lock.template.id, 'trace.codex-starter');
  assert.equal(lock.local_overrides.length, 0);
  const activation = buildCodexActivation({thread_id: 'thread-test', purpose: 'continue', summary: 'Bounded context', source_refs: [{record_id: 'src-local', revision: 3, label: 'Local'}]});
  assert.equal(activation.pack.thread_id, 'thread-test');
  assert.match(activation.user_notice, /不会因此自动写入/);
  assert.equal(buildCodexActivationReceipt({thread_id: 'thread-test', activated_refs: ['src-local@3']}).receipt_kind, 'activation');
});

test('JSONL to SQLite migration is staged and keeps source files untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-migrate-'));
  const changes = path.join(dir, 'changes.jsonl');
  const data = path.join(dir, 'data.jsonl');
  const target = path.join(dir, 'trace.db');
  const runtime = new TraceRuntime({changeStateFile: changes, dataStateFile: data});
  const source = runtime.createData(sourceInput());
  const original = fs.readFileSync(data, 'utf8');
  const report = migrateJsonlToSqlite({changeStateFile: changes, dataStateFile: data, sqliteStateFile: target});
  assert.equal(report.verified, true);
  assert.equal(report.data_revisions, 1);
  assert.equal(fs.readFileSync(data, 'utf8'), original);
  const migrated = new TraceRuntime({sqliteStateFile: target});
  assert.equal(migrated.listData('source_snapshot')[0].record_id, source.record_id);
  runtime.changes.store.close?.();
  runtime.data.store.close?.();
  migrated.changes.store.close?.();
  migrated.data.store.close?.();
  migrated.continuity?.store.close?.();
});
