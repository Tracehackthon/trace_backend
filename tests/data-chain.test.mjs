import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DataLedger, DATA_PROTOCOL_ID, DATA_PROTOCOL_VERSION, validateDataEnvelope} from '../dist/packages/core/data/src/index.js';
import {AppendOnlyStore, appendJsonl} from '../dist/packages/core/storage/src/index.js';

function digest(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-data-chain-'));
  const ledger = new DataLedger(new AppendOnlyStore(path.join(dir, 'data.jsonl')));
  const now = new Date().toISOString();
  const sourceContent = 'Synthetic Zhihu answer used only for deterministic Trace data-chain replay.';
  const sourceHash = digest(sourceContent);
  const base = {
    scope: {type: 'project', id: 'trace'},
    classification: 'public',
    producer: {component: 'trace.synthetic-fixture', version: '0.1.0', run_id: 'synthetic-run-1'},
  };
  const source = ledger.create({
    ...base,
    kind: 'source_snapshot',
    schema_id: 'trace.external-source.zhihu',
    schema_version: '0.1.0',
    subject: {type: 'zhihu.answer', id: 'answer-1001'},
    origin: {provider: 'synthetic-zhihu-api', source_id: 'zhihu:answer:1001', captured_at: now, content_hash: sourceHash, locator: 'https://example.invalid/zhihu/answer-1001'},
    lineage: {parent_refs: [], source_refs: [], causation_id: 'capture:1001', correlation_id: 'chain:1'},
    payload: {source_id: 'zhihu:answer:1001', provider: 'zhihu', external_id: '1001', title: 'Synthetic answer', content: sourceContent, captured_at: now, content_hash: sourceHash},
  });
  const ref = record => ({record_id: record.record_id, revision: record.revision, kind: record.kind, schema_id: record.schema_id, schema_version: record.schema_version});
  const normalized = ledger.create({
    ...base,
    kind: 'normalized_result',
    status: 'normalized',
    schema_id: 'trace.zhihu.result',
    schema_version: '0.1.0',
    subject: {type: 'zhihu.result', id: 'result-1001'},
    origin: {provider: 'trace-normalizer', source_id: source.record_id, captured_at: now, content_hash: digest({source: source.record_id, item: 'candidate'})},
    lineage: {parent_refs: [], source_refs: [ref(source)], change_id: 'change-normalize-1001', causation_id: 'normalize:1001', correlation_id: 'chain:1'},
    payload: {source_record_id: source.record_id, schema_version: '0.1.0', items: [{claim: 'A synthetic reusable claim'}], normalized_at: now},
  });
  const precedent = ledger.create({
    ...base,
    kind: 'candidate_precedent',
    status: 'candidate',
    schema_id: 'trace.candidate-precedent',
    schema_version: '0.1.0',
    subject: {type: 'candidate-precedent', id: 'precedent-1001'},
    origin: {provider: 'trace-precedent', source_id: normalized.record_id, captured_at: now, content_hash: digest('precedent-1001')},
    lineage: {parent_refs: [ref(normalized)], source_refs: [ref(source)], change_id: 'change-precedent-1001', causation_id: 'precedent:1001', correlation_id: 'chain:1'},
    payload: {candidate_id: 'precedent-1001', claim: 'A synthetic reusable claim', evidence_record_ids: [source.record_id, normalized.record_id], adoption_status: 'candidate', rationale: 'Evidence is traceable to source and normalized result.'},
  });
  const capability = ledger.create({
    ...base,
    kind: 'capability_candidate',
    status: 'candidate',
    schema_id: 'trace.capability-candidate',
    schema_version: '0.1.0',
    subject: {type: 'capability', id: 'zhihu-evidence-to-precedent'},
    origin: {provider: 'trace-capability', source_id: precedent.record_id, captured_at: now, content_hash: digest('capability-1001')},
    lineage: {parent_refs: [ref(precedent)], source_refs: [ref(source)], change_id: 'change-capability-1001', causation_id: 'capability:1001', correlation_id: 'chain:1'},
    payload: {capability_id: 'zhihu-evidence-to-precedent', activation_contract: {trigger: 'source evidence'}, input_contract: {source_record_ids: [source.record_id]}, output_contract: {precedent_record_id: precedent.record_id}, acceptance_contract: {required: ['lineage', 'evidence']}, evidence_record_ids: [source.record_id, precedent.record_id]},
  });
  const promptPack = ledger.create({
    ...base,
    kind: 'prompt_pack',
    status: 'validated',
    schema_id: 'trace.codex.activation-pack',
    schema_version: '0.1.0',
    subject: {type: 'activation-pack', id: 'pack-1001'},
    origin: {provider: 'trace-pack-compiler', source_id: capability.record_id, captured_at: now, content_hash: digest('pack-1001')},
    lineage: {parent_refs: [ref(capability)], source_refs: [], change_id: 'change-pack-1001', causation_id: 'pack:1001', correlation_id: 'chain:1'},
    payload: {pack_id: 'pack-1001', capability_record_id: capability.record_id, sections: [{id: 'contract', text: 'Preserve source and evidence references.'}], runtime_budget: {max_input_tokens: 2000}},
  });
  const artifact = ledger.create({
    ...base,
    kind: 'artifact',
    status: 'published',
    schema_id: 'trace.skill-artifact',
    schema_version: '0.1.0',
    subject: {type: 'skill', id: 'zhihu-evidence-to-precedent'},
    origin: {provider: 'trace-publisher', source_id: promptPack.record_id, captured_at: now, content_hash: digest('artifact-content-1001')},
    lineage: {parent_refs: [ref(promptPack)], source_refs: [], change_id: 'change-publish-1001', causation_id: 'publish:1001', correlation_id: 'chain:1'},
    payload: {artifact_id: 'skill:zhihu-evidence-to-precedent', artifact_version: '0.1.0', manifest: {entry: 'SKILL.md', capability_record_id: capability.record_id}, content_hash: digest('artifact-content-1001')},
  });
  const runtimeEvent = ledger.create({
    ...base,
    kind: 'runtime_event',
    status: 'validated',
    schema_id: 'trace.runtime-event',
    schema_version: '0.1.0',
    subject: {type: 'codex.run', id: 'run-1001'},
    origin: {provider: 'codex', source_id: artifact.record_id, captured_at: now, content_hash: digest('runtime-event-1001')},
    lineage: {parent_refs: [ref(promptPack), ref(artifact)], source_refs: [ref(source)], change_id: 'change-runtime-1001', causation_id: 'runtime:1001', correlation_id: 'chain:1'},
    payload: {run_id: 'run-1001', event_name: 'skill.published', input_refs: [promptPack.record_id], output_refs: [artifact.record_id], outcome: 'accepted'},
  });
  return {dir, ledger, source, normalized, precedent, capability, promptPack, artifact, runtimeEvent};
}

test('synthetic source → result → precedent → capability → prompt → artifact → runtime chain preserves every reference', () => {
  const f = fixture();
  const report = f.ledger.verifyChain(f.runtimeEvent.record_id);
  assert.equal(report.complete, true);
  assert.equal(report.edge_count, 10);
  assert.equal(report.record_ids.length, 7);
  assert.equal(f.ledger.list().length, 7);
  const persisted = fs.readFileSync(path.join(f.dir, 'data.jsonl'), 'utf8').trim().split('\n').map(line => validateDataEnvelope(JSON.parse(line)));
  assert.deepEqual(persisted.map(item => item.record_id), [f.source, f.normalized, f.precedent, f.capability, f.promptPack, f.artifact, f.runtimeEvent].map(item => item.record_id));
  assert.ok(persisted.every(item => item.protocol_id === DATA_PROTOCOL_ID && item.protocol_version === DATA_PROTOCOL_VERSION));
  assert.equal(persisted.find(item => item.record_id === f.capability.record_id).payload.output_contract.precedent_record_id, f.precedent.record_id);
});

test('required fields, missing parents, hash tampering, and revision gaps fail closed', () => {
  const f = fixture();
  assert.throws(() => validateDataEnvelope({...f.source, accidental_field: true}), /unsupported fields/);
  assert.throws(() => f.ledger.create({
    kind: 'capability_candidate', schema_id: 'broken', schema_version: '0.1.0', subject: {type: 'capability', id: 'broken'}, scope: {type: 'project', id: 'trace'}, classification: 'public',
    origin: {provider: 'test', source_id: 'broken', captured_at: new Date().toISOString(), content_hash: digest('broken')}, producer: {component: 'test', version: '1', run_id: 'broken'}, lineage: {parent_refs: [], source_refs: [], change_id: 'change-broken', causation_id: 'broken', correlation_id: 'broken'}, payload: {capability_id: 'broken'},
  }), /missing|at least one parent/);
  assert.throws(() => f.ledger.create({
    kind: 'normalized_result', schema_id: 'broken', schema_version: '0.1.0', subject: {type: 'result', id: 'broken'}, scope: {type: 'project', id: 'trace'}, classification: 'public',
    origin: {provider: 'test', source_id: 'broken', captured_at: new Date().toISOString(), content_hash: digest('broken')}, producer: {component: 'test', version: '1', run_id: 'broken'}, lineage: {parent_refs: [{record_id: 'missing', revision: 1, kind: 'source_snapshot', schema_id: 'trace.external-source.zhihu', schema_version: '0.1.0'}], source_refs: [], change_id: 'change-broken', causation_id: 'broken', correlation_id: 'broken'}, payload: {source_record_id: 'missing', schema_version: '0.1.0', items: [], normalized_at: new Date().toISOString()},
  }), /Missing data reference/);
  const state = path.join(f.dir, 'tampered.jsonl');
  fs.copyFileSync(path.join(f.dir, 'data.jsonl'), state);
  const lines = fs.readFileSync(state, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  lines[0].payload.title = 'tampered';
  fs.writeFileSync(state, lines.map(line => JSON.stringify(line)).join('\n') + '\n');
  assert.throws(() => new DataLedger(new AppendOnlyStore(state)).list(), /INTEGRITY_MISMATCH|payload_hash/);
  const gaps = path.join(f.dir, 'gaps.jsonl');
  appendJsonl(gaps, {record_id: 'gap', revision: 2});
  assert.throws(() => new AppendOnlyStore(gaps).latest(), /Missing revision/);
  appendJsonl(gaps, {record_id: 'gap', revision: 1, value: 'a'});
  appendJsonl(gaps, {record_id: 'gap', revision: 1, value: 'b'});
  assert.throws(() => new AppendOnlyStore(gaps).latest(), /Conflicting duplicate revision/);
});

test('data updates append a new revision without rewriting the evidence revision referenced by descendants', () => {
  const f = fixture();
  const updated = f.ledger.update(f.normalized.record_id, {
    expected_revision: 1,
    status: 'validated',
    producer: {component: 'trace.synthetic-fixture', version: '0.1.1', run_id: 'synthetic-run-2'},
    payload: {...f.normalized.payload, items: [{claim: 'A synthetic reusable claim'}, {claim: 'A second normalized item'}], normalized_at: new Date().toISOString()},
  });
  assert.equal(updated.revision, 2);
  assert.equal(f.ledger.list('normalized_result')[0].revision, 2);
  assert.equal(f.ledger.verifyChain(updated.record_id).complete, true);
  assert.equal(f.ledger.get(f.normalized.record_id, 1).payload.items.length, 1);
  assert.equal(f.ledger.get(f.normalized.record_id, 2).payload.items.length, 2);
  assert.equal(f.ledger.verifyChain(f.runtimeEvent.record_id).record_ids.length, 7);
});
