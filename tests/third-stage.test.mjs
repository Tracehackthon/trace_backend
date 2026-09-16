import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createProductWorkspace} from '../packages/product/workspace/src/workspace.mjs';
import {createSensemakingWorker} from '../apps/agent/sensemaking-worker.mjs';
import {detectSensemakingOverlap, redactHostText, redactSensemakingInput, privacySafeError} from '../packages/product/workspace/src/host-privacy.mjs';

function tmp(prefix = 'trace-third-stage-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function git(dir, ...args) { return execFileSync('git', ['-C', dir, ...args], {encoding: 'utf8'}).trim(); }
function repo(root) {
  const value = path.join(root, 'repo'); fs.mkdirSync(value); git(value, 'init', '-b', 'main'); git(value, 'config', 'user.email', 'trace@example.invalid'); git(value, 'config', 'user.name', 'Trace Fixture'); fs.writeFileSync(path.join(value, 'README.md'), 'fixture'); git(value, 'add', '.'); git(value, 'commit', '-m', 'initial'); return value;
}
function shaFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function attachTurn(store, prompt = '请把这次 skill 能力改进变成可验证候选') {
  store.hostSessions.attach({host: 'codex', sessionId: 's', commandId: 'attach'});
  store.hostSessions.ingestEvent({host: 'codex', sessionId: 's', turnId: 't', hook_event_name: 'UserPromptSubmit', prompt});
  store.hostSessions.ingestEvent({host: 'codex', sessionId: 's', turnId: 't', hook_event_name: 'Stop', last_assistant_message: '已停止'});
}

test('privacy policy redacts credentials/PII/path and detects unicode whitespace plus fragment echoes', () => {
  const input = {host: 'codex', session_id: 's', turn_id: 't', user_prompt: 'api_key=sk-test-0123456789012345 email a@example.invalid phone +86 138 0013 8000 path C:\\Users\\Alice\\secret.txt', final_assistant_message: null, safe_evidence: [], related_findings: [], input_hash: 'a'.repeat(64)};
  const safe = redactSensemakingInput(input);
  assert.match(safe.modelInput.user_prompt, /REDACTED:credential/);
  assert.match(safe.modelInput.user_prompt, /REDACTED:email/);
  assert.match(safe.modelInput.user_prompt, /REDACTED:path/);
  assert.ok(Object.keys(safe.receipt.fields.user_prompt.omitted).length >= 3);
  const source = '这是一段需要保密的长流程片段，不能从 HostTurn 原样回显到候选结果。它包含足够多的字符用于检测多个独立片段拼接。';
  const normalized = source.replace(/\s+/gu, ' ');
  const overlap = detectSensemakingOverlap({parts: [normalized.slice(0, 20), normalized.slice(20, 40), normalized.slice(40)]}, {user_prompt: source, final_assistant_message: null});
  assert.equal(overlap.matched, true);
  assert.equal(overlap.kind, 'fragment-reconstruction');
  const whitespace = detectSensemakingOverlap({text: '这 是 一 段 需要保密的长流程片段，不能从 HostTurn 原样回显到候选结果。'}, {user_prompt: source, final_assistant_message: null});
  assert.equal(whitespace.matched, true);
  assert.equal(detectSensemakingOverlap({text: '普通的说明文字，不含用户私有原文'}, {user_prompt: source, final_assistant_message: null}).matched, false);
  assert.equal(redactHostText('run_id=9c7e1d2a-2d53-4b70-9df3-5f64c8e2a917', 'final_assistant_message').omitted.phone ?? 0, 0);
  assert.equal(privacySafeError(new Error(source), {user_prompt: source, final_assistant_message: null}), 'privacy boundary rejected private HostTurn text');
});

test('profile executor contract is server-selected, strict, and shadow results do not route', async () => {
  const root = tmp(); const web = path.join(root, 'web.sqlite'); const agent = path.join(root, 'agent.sqlite');
  const store = createProductWorkspace({file: web}); attachTurn(store);
  const binding = {profileId: 'fixture-profile', kind: 'agent', ownerId: 'server', version: 7, revision: 'rev-7', serviceIdentity: 'trace-external-agent-v1', protocol: 'trace-external-agent-v1', sensemaking: {timeoutMs: 5_000, maxSteps: 1, maxInputBytes: 64 * 1024, maxOutputBytes: 8 * 1024, maxAttempts: 2, toolSet: []}};
  const registry = {bind(id) { assert.equal(id, 'fixture-profile'); return {binding, executor: {async execute({request}) { return {runtimeVersion: 'trace-external-agent-v1/test', raw: JSON.stringify({schema_id: 'trace.sensemaking-result', schema_version: 1, kind: 'candidate', confidence: .5, observation: '安全的候选观察', desired_behavior: '先试用再决定', scope: 'unknown', target_kind: 'unresolved', target_hint: 'hook', understanding_delta: null, open_questions: [], source: {host: request.input.host, session_id: request.input.session_id, turn_id: request.input.turn_id, run_id: request.runId, input_hash: request.input.input_hash}})}}}}; }, isCurrent() { return true; }};
  const worker = createSensemakingWorker({webFile: web, agentFile: agent, mode: 'shadow', profileId: 'fixture-profile', executorRegistry: registry});
  try {
    const value = await worker.once();
    assert.equal(value.status, 'succeeded');
    assert.equal(value.job.execution_mode, 'shadow');
    assert.equal(value.proposal, null);
    assert.equal(worker.product.hostWorkflow.listRoutingProposals().length, 0);
    assert.equal(worker.health().profile.serviceIdentity, 'trace-external-agent-v1');
  } finally { worker.close(); store.close(); fs.rmSync(root, {recursive: true, force: true}); }
});

test('repository guard journal reconciles git-success/receipt-crash without automatic rollback', () => {
  const root = tmp(); const repository = repo(root); let crashed = true;
  const store = createProductWorkspace({file: path.join(root, 'web.sqlite'), hostWorkflowFaultInjector: {afterGit() { if (crashed) { crashed = false; throw new Error('injected crash after git'); } }}});
  try {
    attachTurn(store, '记录 git 分支命名和发布 guard');
    const finding = store.hostSessions.captureWorkflowFinding({host: 'codex', sessionId: 's', turnId: 't', commandId: 'finding', observation: '任务开始前先检查 git 分支并建议命名'});
    const proposal = store.hostWorkflow.createRoutingProposal({findingId: finding.finding.finding_id});
    store.hostWorkflow.decideRouting({proposalId: proposal.proposal_id, action: 'adopt', expectedRevision: 0, commandId: 'adopt'});
    const preflight = store.hostWorkflow.repositoryPreflight({commandId: 'preflight', proposalId: proposal.proposal_id, repoRoot: repository, executionMode: 'local', taskIntent: 'implement branch guard'});
    assert.throws(() => store.hostWorkflow.repositoryGuardApply({commandId: 'guard', preflightId: preflight.preflight_id, proposalId: proposal.proposal_id, expectedStateHash: preflight.state_hash, approval: `adopt:${proposal.proposal_id}`}), /injected crash/);
    const journal = store.hostWorkflow.listRepositoryJournals()[0]; assert.equal(journal.state, 'prepared'); assert.equal(git(repository, 'branch', '--show-current'), preflight.proposed_branch);
    assert.equal(store.hostWorkflow.repositoryGuardRecoveryPreview({journal_id: journal.journal_id}).action, 'commit_receipt');
    const recovered = store.hostWorkflow.repositoryGuardReconcile({journal_id: journal.journal_id, command_id: 'reconcile'});
    assert.equal(recovered.status, 'applied');
    assert.equal(store.hostWorkflow.listRepositoryJournals()[0].state, 'receipt_committed');
  } finally { store.close(); fs.rmSync(root, {recursive: true, force: true}); }
});

test('adopted capability candidate remains producer_required until existing publisher evidence, then trial/validate/publish/rollback are CAS receipts', () => {
  const root = tmp(); const target = path.join(root, 'target'); const candidate = path.join(root, 'candidate'); fs.mkdirSync(target); fs.mkdirSync(candidate);
  const store = createProductWorkspace({file: path.join(root, 'web.sqlite')});
  try {
    attachTurn(store); const finding = store.hostSessions.captureWorkflowFinding({host: 'codex', sessionId: 's', turnId: 't', commandId: 'finding', observation: '把 skill 能力候选保留为可试用的流程'});
    const proposal = store.hostWorkflow.createRoutingProposal({findingId: finding.finding.finding_id}); const adopted = store.hostWorkflow.decideRouting({proposalId: proposal.proposal_id, action: 'adopt', expectedRevision: 0, commandId: 'adopt'}); let orchestration = adopted.capability_orchestration;
    let value = store.hostWorkflow.capabilityStage({orchestrationId: orchestration.orchestration_id, expectedRevision: orchestration.revision, commandId: 'producer-needed'}); assert.equal(value.status, 'producer_required'); orchestration = value.orchestration;
    const manifest = {protocol_id: 'trace.capability-publish', protocol_version: '0.2.0', capability_id: orchestration.candidate.capability_id, version: '0.1.0', target_root: target, files: {}, sources: {}}; fs.writeFileSync(path.join(candidate, 'candidate.json'), JSON.stringify(manifest));
    value = store.hostWorkflow.capabilityStage({orchestrationId: orchestration.orchestration_id, expectedRevision: orchestration.revision, commandId: 'producer-staged', candidateDir: candidate, manifestSha256: shaFile(path.join(candidate, 'candidate.json'))}); assert.equal(value.status, 'staged'); orchestration = value.orchestration;
    value = store.hostWorkflow.capabilityTrialCreate({orchestrationId: orchestration.orchestration_id, expectedRevision: orchestration.revision, commandId: 'trial', capabilityVersion: '0.1.0', capabilityHash: 'b'.repeat(64), scenario: '当前任务', task: '执行候选', expected: '按约定执行', evidenceRefs: ['host-turn:s/t']}); assert.equal(value.status, 'trial_queued');
    orchestration = value.orchestration;
    const trial = value.trial;
    value = store.hostWorkflow.capabilityTrialComplete({trialId: trial.trial_id, expectedRevision: trial.revision, commandId: 'trial-complete', outcome: 'support', observed: '受控 fixture 验证通过', evidenceRefs: ['host-turn:s/t']}); assert.equal(value.status, 'completed');
    value = store.hostWorkflow.capabilityValidate({orchestrationId: orchestration.orchestration_id, expectedRevision: orchestration.revision, commandId: 'validate', validation: {schema: 'passed', replay: 'passed', behavior: 'passed', rollback: 'passed', source_hashes: 'passed'}}); assert.equal(value.status, 'validated'); orchestration = value.orchestration;
    const published = store.hostWorkflow.capabilityPublish({orchestrationId: orchestration.orchestration_id, expectedRevision: orchestration.revision, commandId: 'publish', producerStatus: 'published', publicationReceipt: {candidate_sha256: orchestration.manifest_sha256}, rollbackReceipt: 'publisher-rollback-receipt', approval: `publish:${orchestration.orchestration_id}`}); assert.equal(published.status, 'published');
    const rolledBack = store.hostWorkflow.capabilityRollback({orchestrationId: orchestration.orchestration_id, expectedRevision: published.orchestration.revision, commandId: 'rollback', producerStatus: 'rolled_back', rollbackReceipt: 'publisher-rollback-complete'}); assert.equal(rolledBack.status, 'rolled_back');
  } finally { store.close(); fs.rmSync(root, {recursive: true, force: true}); }
});
