import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {TraceRuntime} from '../dist/packages/core/runtime/src/index.js';
import {validateDataEnvelope} from '../dist/packages/core/data/src/index.js';
import {CapabilityPublisher} from '../dist/packages/core/capability/src/index.js';
import {backupSqlite, doctorSqlite, restoreSqlite} from '../dist/packages/core/operations/src/index.js';
import {activateCodexTurn} from '../dist/apps/codex/src/index.js';
import {buildZhihuCandidatePrecedent, captureZhihuAnswer} from '../dist/packages/integration/zhihu-precedent/src/index.js';
import {validateCapabilityCandidatePayload} from '../dist/packages/core/capability-candidate/src/index.js';

const fixtureRoot = path.join(process.cwd(), 'tests', 'fixtures');
const hash = value => createHash('sha256').update(value).digest('hex');
const load = name => JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));
const ref = record => ({record_id: record.record_id, revision: record.revision, kind: record.kind, schema_id: record.schema_id, schema_version: record.schema_version});

function sourceInput(source, runId) {
  const contentHash = hash(source.content);
  return {
    kind: 'source_snapshot', schema_id: 'trace.source.snapshot', schema_version: '0.1.0',
    subject: {type: 'source', id: source.source_id}, scope: {type: source.provider === 'mywiki-local' ? 'personal' : 'project', id: 'trace-user'},
    origin: {provider: source.provider, source_id: source.source_id, captured_at: source.captured_at, content_hash: contentHash, ...(source.url === null ? {} : {locator: source.url})},
    producer: {component: 'user-journey-fixture', version: '1.0.0', run_id: runId}, lineage: {parent_refs: [], source_refs: [], causation_id: `capture:${source.source_id}`, correlation_id: runId}, classification: source.provider === 'mywiki-local' ? 'private' : 'public',
    payload: {source_id: source.source_id, provider: source.provider, external_id: source.external_id, title: source.title, content: source.content, captured_at: source.captured_at, content_hash: contentHash, ...(source.url === null ? {} : {url: source.url}), content_mode: source.content_mode},
  };
}

function closeRuntime(runtime) {
  runtime.changes.store.close?.(); runtime.data.store.close?.(); runtime.continuity?.store.close?.();
}

test('complete Codex user journey preserves lineage and prevents context/data contamination', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-user-journey-'));
  const db = path.join(dir, 'trace.sqlite'); const runId = 'journey-agent-collaboration-001';
  const zhihu = load('zhihu-agent-collaboration.json'); const local = load('local-cognition-agent-collaboration.json');
  const runtime = new TraceRuntime({sqliteStateFile: db});

  // 1. Capture two deliberately separate sources: a bounded public fixture and
  // a private local cognition source. They must not be merged into one payload.
  const zhihuRecord = runtime.createData(captureZhihuAnswer(zhihu, {run_id: runId, scope: {type: 'project', id: 'trace'}}));
  const localRecord = runtime.createData(sourceInput(local, runId));
  assert.notEqual(zhihuRecord.record_id, localRecord.record_id);
  assert.equal(zhihuRecord.payload.provider, 'zhihu');
  assert.equal(localRecord.payload.provider, 'mywiki-local');

  // 2. Start a user-visible thread and activate only bounded references.
  const thread = runtime.createThread({thread_id: 'thread-agent-collaboration-001', title: 'Agent 协作问题：上下文与能力版本漂移', current_summary: '比较知乎公开经验与本地 Trace 协作治理，判断问题是否来自上下文边界或能力版本。', open_questions: ['候选是否有两类来源证据？', '发布能力前是否需要行为验证？'], next_action: '先显示激活来源，再讨论候选'});
  const activation = activateCodexTurn(runtime, {
    event_type: 'codex.turn.started', thread_id: thread.record_id, purpose: '诊断 Agent 协作中的上下文污染和能力漂移',
    summary: '只读取两个来源的受控摘要和指定指针；不要把完整聊天、未采纳候选或其他私人来源注入。',
    source_refs: [
      {record_id: zhihuRecord.record_id, revision: 1, label: '知乎公开经验摘要', locator: zhihu.url},
      {record_id: localRecord.record_id, revision: 1, label: 'Trace 本地协作治理'},
    ],
    read_pointers: [
      {path: zhihu.url, purpose: '确认公开经验中关于上下文变长和工具失败的边界', priority: 'must', stop_condition: '得到一条可追溯的公开观察'},
      {path: 'wiki/capabilities/collaboration/共同思考协作能力.md', purpose: '确认 Agent 只能提出候选，用户负责采用和发布', priority: 'must', stop_condition: '确认采用与发布分离'},
    ],
    forbidden_scopes: ['raw-chat-transcript', 'unadopted-candidate', 'un授权-private-source'], max_tokens: 5000,
  });
  assert.equal(activation.pack.source_refs.length, 2);
  assert.equal(activation.pack.source_refs[0].record_id, zhihuRecord.record_id);
  assert.equal(activation.pack.source_refs[1].record_id, localRecord.record_id);
  assert.equal(JSON.stringify(activation.pack).includes(zhihu.content), false, 'activation must not inline public source content');
  assert.equal(JSON.stringify(activation.pack).includes(local.content), false, 'activation must not inline private source content');
  assert.deepEqual(activation.pack.forbidden_scopes, ['raw-chat-transcript', 'unadopted-candidate', 'un授权-private-source']);
  assert.match(activation.user_notice, /不会因此自动写入/);
  assert.ok(runtime.listContinuity(thread.record_id).some(record => record.kind === 'activation_receipt'));

  // 3. Record two turns. The raw transcript is explicitly excluded from the
  // persistence receipt; only summaries and exact record references remain.
  runtime.appendDiscussionTurn({thread_id: thread.record_id, user_input_summary: '两个 Agent 对同一协作能力产生不同结果。', output_summary: '初步判断可能是上下文边界和能力版本没有分离。', delta_type: 'new_candidate', context_refs: [zhihuRecord.record_id + '@1', localRecord.record_id + '@1'], open_questions: ['需要形成一个可验证候选']});
  runtime.appendDiscussionTurn({thread_id: thread.record_id, user_input_summary: '继续比较公开经验和本地治理原则。', output_summary: '形成候选：激活只传来源指针和预算，发布必须经过用户采纳与行为验证。', delta_type: 'revision', context_refs: [zhihuRecord.record_id + '@1', localRecord.record_id + '@1'], open_questions: ['需要验证发布回滚']});

  // 4. Create a Change Set whose input lineage is the two source records.
  const change = runtime.createChange({change_kind: 'artifact', subject: {type: 'capability', id: 'agent-collaboration-governance'}, base: {version: '0.1.0'}, proposed: {version: '0.2.0', rule: 'bounded activation and explicit adoption'}, impact: ['context-boundary', 'capability-publication', 'rollback'], compatibility: {backward_compatible: true, migration_required: false, impact_level: 'medium'}, requested_by: 'user:trace', scope: {type: 'project', id: 'trace'}, lineage: {input_refs: [ref(zhihuRecord), ref(localRecord)], output_refs: [], parent_change_ids: [], causation_id: 'thread-agent-collaboration-001', correlation_id: runId}, note: 'Candidate derived from two separate sources; no raw transcript is an input.'});
  assert.equal(change.record.status, 'proposed');

  // 5. Create a candidate precedent with explicit change lineage, then attach
  // it back to the Change Set before validation.
  const candidate = runtime.createData(buildZhihuCandidatePrecedent(zhihu, {source_ref: ref(zhihuRecord), source_refs: [ref(localRecord)], change_id: change.record.change_id, run_id: runId, claim: 'Agent activation must use bounded source refs and read pointers; publication requires user adoption and behavior evidence.', rationale: 'The public fixture reports long-context/tool failures; local governance separates activation from adoption.', scope: {type: 'project', id: 'trace'}}));
  const analyzed = runtime.updateChange(change.record.change_id, {expected_revision: 1, status: 'analyzed', lineage: {output_refs: [ref(candidate)]}, note: 'Candidate output is linked before validation.'});
  assert.equal(analyzed.revision, 2);
  const validatedChange = runtime.updateChange(change.record.change_id, {expected_revision: 2, status: 'validated', validation: {schema: 'passed', replay: 'passed'}});
  assert.equal(validatedChange.status, 'validated');
  const validatedCandidate = runtime.data.update(candidate.record_id, {expected_revision: 1, status: 'validated'});
  const adoptedCandidate = runtime.data.update(candidate.record_id, {expected_revision: validatedCandidate.revision, status: 'adopted'});
  assert.equal(adoptedCandidate.status, 'adopted');

  // 6. Compile the adopted precedent into a semantic capability candidate.
  // This is the WikiSkill-inspired middle layer: a precedent is evidence, not
  // yet a Skill. The candidate keeps the cognitive delta, scope, counterexample
  // and user-visible acceptance contract before any filesystem publication.
  const capabilityCandidate = runtime.createCapabilityCandidate({
    candidate_id: 'capability-candidate-agent-collaboration-0.2.0', capability_id: 'agent-collaboration-governance',
    claim: 'Agent 协作能力必须经过候选语义层、用户采用和行为验证后才能发布。',
    rationale: '知乎前例只能提供公开经验；本地认知源提供 Trace 的采用与发布边界，二者不能直接编译成 Skill。',
    semantic_delta: {before: '将一次成功的 Agent 协作经验直接写成 Skill。', after: '先形成 capability_candidate，展示判断变化和适用边界，再由用户采用后编译 Skill。'},
    judgment_change: {claim: 'candidate_precedent 不能直接成为可执行能力。', reason: '外部前例和内部判断的语义责任不同，直接发布会绕过用户采用和验证。', confidence: 'high'},
    mechanism: {problem: '前例直接进入能力发布。', cause: '缺少独立的语义候选和 gating 阶段。', failure_modes: ['外部经验污染内部认知', '一次成功固化为错误能力', '发布后无法解释来源']},
    scope: {applies_to: ['Codex Agent 协作', '知乎前例与 MyWiKi 认知源合流', 'Trace Skill 发布'], does_not_apply_to: ['未经讨论的聊天', '没有证据的推断', '普通代码格式化']},
    counterexamples: ['知乎高赞内容不等于适用于当前产品。', '一次 Agent 成功不等于能力在第二个案例中稳定。'],
    activation_contract: {triggers: ['上下文污染', '能力版本漂移', '候选前例'], required_context: ['受控 source_refs', 'Change Set', '用户可见候选摘要'], forbidden_context: ['raw-chat-transcript', 'unadopted-candidate', 'un授权-private-source']},
    input_contract: {required: ['source_refs', 'candidate_precedent_ref', 'change_id'], optional: ['知乎外部源', '本地认知源']},
    output_contract: {artifacts: ['capability_candidate', 'SKILL.md', '发布回执'], user_visible: ['判断变化', '适用范围', '保存与未保存内容']},
    acceptance_contract: {structural: ['候选数据有完整 lineage', 'Skill provenance 指向候选版本'], behavioral: ['第二个 Agent 协作案例可复放', '候选未采用时不能发布'], user_visible: ['用户能看到候选具体内容', '用户能知道 Skill 从哪一版候选产生']},
    evidence_refs: [ref(adoptedCandidate), ref(localRecord)], precedent_refs: [ref(adoptedCandidate)], adoption_status: 'pending',
    record_scope: {type: 'project', id: 'trace'},
    origin: {provider: 'trace-capability-proposer', source_id: 'capability-candidate-agent-collaboration-0.2.0', captured_at: '2026-09-09T00:00:00.000Z', content_hash: hash('capability-candidate-agent-collaboration-0.2.0')},
    producer: {component: 'trace.capability-candidate', version: '0.1.0', run_id: runId}, classification: 'internal',
    causation_id: `capability-candidate:${change.record.change_id}`, correlation_id: runId, change_id: change.record.change_id,
  });
  assert.equal(validateCapabilityCandidatePayload(capabilityCandidate.payload).semantic_delta.after.includes('capability_candidate'), true);
  const adoptedCapabilityCandidate = runtime.data.update(capabilityCandidate.record_id, {expected_revision: 1, status: 'adopted', payload: {...capabilityCandidate.payload, adoption_status: 'adopted'}});
  assert.equal(adoptedCapabilityCandidate.status, 'adopted');
  assert.equal(adoptedCapabilityCandidate.payload.adoption_status, 'adopted');

  const adoptedChange = runtime.updateChange(change.record.change_id, {expected_revision: 3, status: 'adopted', decided_by: 'user:trace', lineage: {output_refs: [ref(candidate), ref(capabilityCandidate)]}});
  assert.equal(adoptedChange.adoption.status, 'adopted');

  // 7. Publish a capability through preview -> stage -> validate -> publish,
  // gated by the exact adopted capability_candidate revision.
  const sourceRoot = path.join(dir, 'capability-source'); const targetRoot = path.join(dir, 'codex-capabilities', 'agent-collaboration-governance'); const candidateDir = path.join(dir, 'candidates', 'agent-collaboration-governance-0.2.0'); const receipt = path.join(dir, 'receipts', 'agent-collaboration-governance-0.2.0.json');
  const capabilityFile = path.join(sourceRoot, 'SKILL.md'); fs.mkdirSync(sourceRoot, {recursive: true}); fs.writeFileSync(capabilityFile, '---\nname: agent-collaboration-governance\ndescription: 治理上下文边界、候选采用与能力发布。\nmetadata:\n  version: 0.2.0\n---\n\nUse bounded activation, explicit adoption, and behavior verification.\n', 'utf8');
  const provenance = {source_kind: 'mixed', source_refs: [ref(localRecord), ref(candidate)], capability_candidate_ref: ref(adoptedCapabilityCandidate), change_id: change.record.change_id, source_revision: 'local-cognition@1+precedent@3+capability-candidate@2'};
  const contentContract = {protocol_id: 'trace.capability-content', protocol_version: '0.1.0', entrypoint: {path: 'SKILL.md', name: 'agent-collaboration-governance', description: '治理上下文边界、候选采用与能力发布。'}, triggers: {positive: ['上下文污染', '能力版本漂移', '候选前例'], negative: ['普通代码格式化']}, workflow: {inputs: ['用户主题', 'source_refs'], steps: ['显示来源与边界', '形成候选', '验证行为', '等待用户采用'], outputs: ['候选前例', '能力版本', '发布回执'], failure_modes: ['来源缺失', '行为验证失败', '目标文件发生漂移'], stop_conditions: ['缺少用户采用', '出现未授权私人来源']}, acceptance: {structural: ['SKILL.md frontmatter 可解析', '来源引用和 Change Set 可核验'], behavioral: ['第二个 Agent 协作案例仍保留 source_refs', '回滚不删除认知源'], user_visible: ['显示本轮保存了什么', '显示未保存什么']}, security: {secret_policy: 'never_include', network_policy: 'host-managed', forbidden_scopes: ['raw-chat-transcript', 'unadopted-candidate']}, provenance};
  const spec = {capability_id: 'agent-collaboration-governance', version: '0.2.0', display_name: 'Agent 协作治理', description: '治理上下文边界、候选采用与能力发布。', artifact_kind: 'skill', source_root: sourceRoot, target_root: targetRoot, files: [{source: 'SKILL.md'}], host_compatibility: ['codex'], runtime_compatibility: {'trace-runtime': '>=0.6.0'}, dependencies: [], provenance, content_contract: contentContract, protocol_registry_ref: 'trace.capability-publish@0.1.0'};
  const publisher = new CapabilityPublisher({resolveCapabilityCandidate: candidateRef => runtime.data.get(candidateRef.record_id, candidateRef.revision)});
  const preview = publisher.preview(spec, candidateDir); assert.deepEqual(preview.additions, ['SKILL.md']); assert.equal(preview.requires_confirmation, true);
  publisher.stage(spec, candidateDir); publisher.validate(candidateDir); const published = publisher.publish(candidateDir, '用户明确采纳 agent-collaboration-governance 0.2.0', receipt); assert.equal(published.status, 'published'); assert.equal(fs.existsSync(path.join(targetRoot, 'SKILL.md')), true);
  const publishedCandidate = runtime.data.update(candidate.record_id, {expected_revision: adoptedCandidate.revision, status: 'published'}); assert.equal(publishedCandidate.status, 'published');
  const publishedCapabilityCandidate = runtime.data.update(capabilityCandidate.record_id, {expected_revision: adoptedCapabilityCandidate.revision, status: 'published'}); assert.equal(publishedCapabilityCandidate.status, 'published');
  const promoted = runtime.updateChange(change.record.change_id, {expected_revision: adoptedChange.revision, status: 'promoted', validation: {behavior: 'passed'}, promotion_target: 'codex:agent-collaboration-governance@0.2.0'}); assert.equal(promoted.promotion.status, 'promoted');

  const persistence = runtime.createReceipt({thread_id: thread.record_id, receipt_kind: 'persistence', summary: '已保存两个来源的引用、候选前例、语义能力候选和发布回执；未保存完整聊天转录或未采纳候选。', persisted_refs: [candidate.record_id + '@4', capabilityCandidate.record_id + '@3', change.record.change_id + '@5'], not_persisted: ['raw-chat-transcript', 'unadopted-candidate', 'un授权-private-source'], required_user_action: '用户可查看判断变化、候选、证据和能力版本；如继续讨论，请从候选验证问题开始。', next_prompts: ['检查 Codex 当前激活版本', '用第二个 Agent 协作案例复放']});
  assert.deepEqual(persistence.payload.not_persisted, ['raw-chat-transcript', 'unadopted-candidate', 'un授权-private-source']);
  assert.equal(JSON.stringify(persistence).includes(zhihu.content), false, 'persistence receipt must not duplicate source content');
  assert.equal(JSON.stringify(persistence).includes('两个 Agent 对同一协作能力产生不同结果'), false, 'persistence receipt must not contain raw transcript');

  // 8. Authoritative verification: lineage, schema, doctor and persisted state.
  const chain = runtime.verifyDataChain(capabilityCandidate.record_id); assert.equal(chain.complete, true); assert.ok(chain.record_ids.includes(zhihuRecord.record_id)); assert.ok(chain.record_ids.includes(localRecord.record_id)); assert.ok(chain.record_ids.includes(candidate.record_id));
  assert.doesNotThrow(() => validateDataEnvelope(publishedCandidate));
  const doctor = doctorSqlite(db); assert.notEqual(doctor.status, 'failed'); assert.equal(doctor.checks.some(check => check.status === 'error'), false);
  assert.equal(runtime.listData('source_snapshot').length, 2); assert.equal(runtime.listData('candidate_precedent')[0].status, 'published'); assert.equal(runtime.listData('capability_candidate')[0].status, 'published');
  closeRuntime(runtime);

  // 9. Backup -> restore -> doctor proves the complete state can be replayed.
  const backup = path.join(dir, 'backups', 'trace.sqlite'); const backupReport = backupSqlite(db, backup); assert.equal(backupReport.status, 'created');
  const restored = path.join(dir, 'restored', 'trace.sqlite'); const restoreReport = restoreSqlite(backup, restored); assert.equal(restoreReport.verified, true); const restoredDoctor = doctorSqlite(restored); assert.notEqual(restoredDoctor.status, 'failed');
  const restoredRuntime = new TraceRuntime({sqliteStateFile: restored}); assert.equal(restoredRuntime.listData('source_snapshot').length, 2); assert.equal(restoredRuntime.listContinuity(thread.record_id).filter(record => record.kind === 'persistence_receipt').length, 1); closeRuntime(restoredRuntime);

  // 10. Rollback remains explicit and does not touch Trace sources or records.
  const rollback = publisher.rollback(receipt); assert.equal(rollback.status, 'rolled_back'); assert.equal(fs.existsSync(path.join(targetRoot, 'SKILL.md')), false); assert.equal(fs.existsSync(db), true);
});
