import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCapabilityCandidateRecord, validateCapabilityCandidatePayload, assertPublishableCapabilityCandidate} from '../dist/packages/core/capability-candidate/src/index.js';

const ref = (record_id, kind = 'candidate_precedent') => ({record_id, revision: 1, kind, schema_id: `trace.${kind}`, schema_version: '0.1.0'});
const base = {
  candidate_id: 'capability-candidate-test-001', capability_id: 'trace-test-skill', claim: '只将采用后的判断编译成 Skill。', rationale: '保持前例、判断和执行产物的责任边界。',
  semantic_delta: {before: '前例直接发布', after: '先生成语义候选并等待采用'},
  judgment_change: {claim: 'candidate_precedent 不是 Skill', reason: '前例需要经过内部判断和行为验证', confidence: 'high'},
  mechanism: {problem: '直接发布', cause: '缺少候选层', failure_modes: ['污染', '漂移']},
  scope: {applies_to: ['Codex Skill 发布'], does_not_apply_to: ['普通格式化']},
  counterexamples: ['一次成功不代表稳定能力'],
  activation_contract: {triggers: ['能力候选'], required_context: ['source_refs', 'Change Set'], forbidden_context: ['raw-chat-transcript']},
  input_contract: {required: ['source_refs', 'change_id'], optional: ['知乎前例']},
  output_contract: {artifacts: ['capability_candidate', 'SKILL.md'], user_visible: ['判断变化', '保存边界']},
  acceptance_contract: {structural: ['lineage 完整'], behavioral: ['第二个案例可复放'], user_visible: ['显示候选具体内容']},
  evidence_refs: [ref('precedent-001'), ref('source-001', 'source_snapshot')], precedent_refs: [ref('precedent-001')], adoption_status: 'pending',
  record_scope: {type: 'project', id: 'trace'}, origin: {provider: 'test', source_id: 'candidate-001', captured_at: '2026-09-09T00:00:00.000Z', content_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},
  producer: {component: 'test', version: '1.0.0', run_id: 'run-001'}, classification: 'internal', causation_id: 'test-causation', correlation_id: 'run-001', change_id: 'change-001',
};

test('capability candidate retains semantic delta, evidence and separate precedent lineage', () => {
  const record = buildCapabilityCandidateRecord(base);
  assert.equal(record.kind, 'capability_candidate');
  assert.deepEqual(record.lineage.parent_refs.map(item => item.record_id), ['precedent-001']);
  assert.deepEqual(record.lineage.source_refs.map(item => item.record_id), ['source-001']);
  const payload = validateCapabilityCandidatePayload(record.payload);
  assert.equal(payload.semantic_delta.after, '先生成语义候选并等待采用');
  assert.deepEqual(payload.precedent_record_ids, ['precedent-001@1']);
  assert.equal(payload.adoption_status, 'pending');
});

test('candidate cannot be published before explicit adoption', () => {
  const pending = buildCapabilityCandidateRecord(base);
  assert.throws(() => assertPublishableCapabilityCandidate({...pending, record_id: 'capability-001', revision: 1}), /adopted/);
  const adopted = {...pending, record_id: 'capability-001', revision: 2, status: 'adopted', payload: {...pending.payload, adoption_status: 'adopted'}};
  assert.equal(assertPublishableCapabilityCandidate(adopted).adoption_status, 'adopted');
});

