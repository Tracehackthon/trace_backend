import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createProductWorkspace} from '../packages/product/workspace/src/workspace.mjs';
import {workflowHash} from '../packages/product/workspace/src/host-workflow.mjs';
import {createSensemakingWorker, analyzeSensemakingFixture} from '../apps/agent/sensemaking-worker.mjs';

function tmp(prefix = 'trace-host-workflow-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function setup() {
  const dir = tmp(); const web = path.join(dir, 'web.sqlite'); const agent = path.join(dir, 'agent.sqlite');
  const store = createProductWorkspace({file: web});
  // This fixture covers Host Workflow persistence.  Keep it user-level rather
  // than passing a synthetic project_ref that cannot satisfy the verified
  // descriptor/repository binding contract.
  store.hostSessions.attach({host: 'codex', sessionId: 'session-1', commandId: 'attach-1', projectRef: null});
  store.hostSessions.ingestEvent({host: 'codex', sessionId: 'session-1', turnId: 'turn-1', hook_event_name: 'UserPromptSubmit', prompt: '请在发布前检查 git 分支，确保有人承接流程，并说明当前项目约定与脏工作区处理方式'});
  store.hostSessions.ingestEvent({host: 'codex', sessionId: 'session-1', turnId: 'turn-1', hook_event_name: 'Stop', last_assistant_message: '已完成，等待下一步'});
  return {dir, web, agent, store};
}
function cleanup(value) {
  value.store?.close();
  // Windows may release SQLite handles a moment after DatabaseSync#close().
  // Retries keep the test cleanup deterministic without weakening assertions.
  fs.rmSync(value.dir, {recursive: true, force: true, maxRetries: 5, retryDelay: 25});
}
function git(repo, ...args) { return execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8'}).trim(); }
function gitRepo(dir, name = 'repo') {
  const repo = path.join(dir, name); fs.mkdirSync(repo); git(repo, 'init', '-b', 'main'); git(repo, 'config', 'user.email', 'trace@example.invalid'); git(repo, 'config', 'user.name', 'Trace Fixture'); fs.writeFileSync(path.join(repo, 'README.md'), 'fixture'); git(repo, 'add', '.'); git(repo, 'commit', '-m', 'initial'); return repo;
}

test('Stop creates one queued sensemaking job in web.sqlite without advancing workspace revision', () => {
  const fixture = setup();
  try {
    const jobs = fixture.store.hostWorkflow.listSensemakingJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, 'queued');
    assert.equal(jobs[0].attempt, 0);
    assert.equal(fixture.store.read().revision, 0);
    assert.match(jobs[0].input.user_prompt, /git/);
    const replay = fixture.store.hostSessions.ingestEvent({host: 'codex', session_id: 'session-1', turn_id: 'turn-1', hook_event_name: 'Stop', last_assistant_message: '已完成，等待下一步'});
    assert.deepEqual(replay.status, 'captured');
    assert.equal(fixture.store.hostWorkflow.listSensemakingJobs().length, 1);
  } finally { cleanup(fixture); }
});

test('offline worker drains, writes strict candidate/proposal once, and agent.sqlite excludes raw HostTurn text', () => {
  const fixture = setup();
  try {
    const worker = createSensemakingWorker({webFile: fixture.web, agentFile: fixture.agent});
    const result = worker.once();
    assert.equal(result.status, 'succeeded');
    assert.equal(result.finding.finding_kind, 'candidate');
    assert.equal(result.finding.target_kind, 'unresolved');
    assert.equal(result.proposal.target_kind, 'runtime-guard');
    assert.equal(worker.product.hostWorkflow.listFindings().length, 1);
    assert.equal(worker.product.hostWorkflow.listRoutingProposals().length, 1);
    assert.equal(worker.once().status, 'empty');
    const job = worker.product.hostWorkflow.listSensemakingJobs()[0];
    assert.equal(job.result_hash, result.job.result_hash);
    assert.equal(result.finding.input_hash, job.input_hash);
    assert.ok(result.finding.source_refs.some(ref => ref.type === 'sensemaking-run' && ref.run_id === result.run.id.replace(/-pending$/, '') || ref.type === 'sensemaking-run'));
    worker.close();
    const db = new DatabaseSync(fixture.agent, {readOnly: true});
    try {
      const payload = db.prepare('SELECT payload FROM sensemaking_runs').get().payload;
      assert.equal(payload.includes('请在发布前检查 git 分支'), false);
      assert.equal(payload.includes('已完成，等待下一步'), false);
    } finally { db.close(); }
  } finally { cleanup(fixture); }
});

test('routing proposal decision is CAS/idempotent and activation is offered separately from used', () => {
  const fixture = setup();
  try {
    const worker = createSensemakingWorker({webFile: fixture.web, agentFile: fixture.agent}); worker.once();
    const proposal = worker.product.hostWorkflow.listRoutingProposals()[0];
    const trial = worker.product.hostWorkflow.decideRouting({proposalId: proposal.proposal_id, action: 'trial', expectedRevision: 0, commandId: 'route-trial'});
    assert.equal(trial.proposal.status, 'trial');
    assert.deepEqual(worker.product.hostWorkflow.decideRouting({proposalId: proposal.proposal_id, action: 'trial', expectedRevision: 0, commandId: 'route-trial'}), trial);
    assert.throws(() => worker.product.hostWorkflow.decideRouting({proposalId: proposal.proposal_id, action: 'adopt', expectedRevision: 0, commandId: 'route-stale'}), error => error.code === 'ROUTING_REVISION_CONFLICT');
    const adopted = worker.product.hostWorkflow.decideRouting({proposalId: proposal.proposal_id, action: 'adopt', expectedRevision: 1, commandId: 'route-adopt'});
    assert.equal(adopted.proposal.status, 'adopted');
    const activation = worker.product.hostWorkflow.queryActivation({host: 'codex', sessionId: 'session-1', includeTrial: true});
    const activationReplay = worker.product.hostWorkflow.queryActivation({host: 'codex', sessionId: 'session-1', includeTrial: true});
    assert.deepEqual(activationReplay, activation);
    assert.equal(activation.offered_not_used, true);
    assert.equal(activation.items.some(item => item.status === 'adopted'), true);
    assert.equal(activation.items[0].provenance_refs.some(ref => ref.type === 'host-turn'), true);
    const marked = worker.product.hostWorkflow.markActivation({receiptId: activation.receipt.receipt_id, status: 'used', expectedRevision: 0, commandId: 'activation-used'});
    assert.equal(marked.status, 'used');
    assert.deepEqual(worker.product.hostWorkflow.markActivation({receiptId: activation.receipt.receipt_id, status: 'used', expectedRevision: 0, commandId: 'activation-used'}), marked);
    worker.close();
  } finally { cleanup(fixture); }
});

test('explicit finding can be routed through the deterministic router without changing its captured semantics', () => {
  const fixture = tmp(); const store = createProductWorkspace({file: path.join(fixture, 'web.sqlite')});
  try {
    store.hostSessions.attach({host: 'codex', sessionId: 'explicit-session', commandId: 'explicit-attach'});
    store.hostSessions.ingestEvent({host: 'codex', sessionId: 'explicit-session', turnId: 'explicit-turn', hook_event_name: 'UserPromptSubmit', prompt: '记录仓库分支的流程改进'});
    const captured = store.hostSessions.captureWorkflowFinding({host: 'codex', sessionId: 'explicit-session', turnId: 'explicit-turn', commandId: 'explicit-finding', observation: '分支命名和脏工作区需要在任务开始前检查', desiredBehavior: '先运行只读 RepositoryPreflight，再决定是否创建分支'});
    const proposal = store.hostWorkflow.createRoutingProposal({host: 'codex', sessionId: 'explicit-session', findingId: captured.finding.finding_id});
    assert.equal(proposal.target_kind, 'runtime-guard');
    assert.equal(proposal.scope, 'personal');
    assert.deepEqual(proposal.source_refs, [{type: 'host-turn', host: 'codex', session_id: 'explicit-session', turn_id: 'explicit-turn'}]);
    assert.equal(store.hostSessions.listWorkflowFindings({session_id: 'explicit-session'})[0].status, 'captured');
    store.hostWorkflow.decideRouting({proposalId: proposal.proposal_id, action: 'adopt', expectedRevision: 0, commandId: 'explicit-adopt'});
    assert.equal(store.hostWorkflow.queryActivation({host: 'codex', sessionId: 'explicit-session'}).items[0].scope, 'personal');
    assert.throws(() => store.hostWorkflow.createRoutingProposal({host: 'codex', sessionId: 'other-session', findingId: captured.finding.finding_id}), error => error.code === 'FINDING_SESSION_CONFLICT');
  } finally { cleanup({store, dir: fixture}); }
});

test('repository guard is read-only by default, blocks dirty worktrees, and applies only adopted runtime-guard CAS', () => {
  const fixture = setup();
  const repo = gitRepo(fixture.dir);
  try {
    const worker = createSensemakingWorker({webFile: fixture.web, agentFile: fixture.agent}); worker.once();
    const proposal = worker.product.hostWorkflow.listRoutingProposals()[0];
    worker.product.hostWorkflow.decideRouting({proposalId: proposal.proposal_id, action: 'adopt', expectedRevision: 0, commandId: 'guard-adopt'});
    const preflight = worker.product.hostWorkflow.repositoryPreflight({commandId: 'guard-preflight', proposalId: proposal.proposal_id, repoRoot: repo, executionMode: 'local', taskIntent: 'implement branch guard'});
    assert.equal(preflight.action, 'create-branch');
    assert.match(preflight.proposed_branch, /^feature\//);
    assert.equal(git(repo, 'branch', '--show-current'), 'main');
    const applied = worker.product.hostWorkflow.repositoryGuardApply({commandId: 'guard-apply', preflightId: preflight.preflight_id, proposalId: proposal.proposal_id, expectedStateHash: preflight.state_hash, approval: `adopt:${proposal.proposal_id}`});
    assert.equal(applied.status, 'applied');
    assert.equal(git(repo, 'branch', '--show-current'), preflight.proposed_branch);
    assert.equal(applied.no_remote_mutation, true);
    assert.deepEqual(worker.product.hostWorkflow.repositoryGuardApply({commandId: 'guard-apply', preflightId: preflight.preflight_id, proposalId: proposal.proposal_id, expectedStateHash: preflight.state_hash, approval: `adopt:${proposal.proposal_id}`}), applied);
    worker.close();

    const dirtyRepo = gitRepo(fixture.dir, 'dirty'); fs.writeFileSync(path.join(dirtyRepo, 'dirty.txt'), 'uncommitted');
    const second = createProductWorkspace({file: fixture.web});
    const blocked = second.hostWorkflow.repositoryPreflight({commandId: 'dirty-preflight', repoRoot: dirtyRepo, executionMode: 'local', taskIntent: 'new task'});
    assert.equal(blocked.action, 'block-dirty'); second.close();
  } finally { cleanup(fixture); }
});

test('fixture analyzer emits noop for ordinary turns and never copies input into result', () => {
  const result = analyzeSensemakingFixture({host: 'codex', session_id: 's', turn_id: 't', user_prompt: '请解释一个普通概念', final_assistant_message: '说明如下'}, {runId: 'r'});
  assert.equal(result.kind, 'noop');
  assert.equal(result.observation, null);
  assert.equal(JSON.stringify(result).includes('请解释一个普通概念'), false);
});

test('repository preflight fails closed for an unborn repository and infers release/hotfix conventions', () => {
  const fixture = tmp();
  try {
    const unborn = path.join(fixture, 'unborn'); fs.mkdirSync(unborn); git(unborn, 'init', '-b', 'main');
    const store = createProductWorkspace({file: path.join(fixture, 'web.sqlite')});
    try {
      const blocked = store.hostWorkflow.repositoryPreflight({commandId: 'unborn-preflight', repoRoot: unborn, executionMode: 'local', taskIntent: 'implement branch guard'});
      assert.equal(blocked.action, 'ask-user');
      assert.equal(blocked.proposed_branch, null);
      const initialized = gitRepo(fixture, 'initialized');
      const release = store.hostWorkflow.repositoryPreflight({commandId: 'release-preflight', repoRoot: initialized, executionMode: 'local', taskIntent: 'release v1.2.3'});
      assert.match(release.proposed_branch ?? '', /^release\//);
      const hotfix = store.hostWorkflow.repositoryPreflight({commandId: 'hotfix-preflight', repoRoot: initialized, executionMode: 'local', taskIntent: 'hotfix production issue'});
      assert.match(hotfix.proposed_branch ?? '', /^hotfix\//);
    } finally { store.close(); }
  } finally { cleanup({dir: fixture}); }
});

test('worker rejects analyzer output that echoes a HostTurn and keeps the job retryable', () => {
  const fixture = setup();
  let worker;
  try {
    worker = createSensemakingWorker({webFile: fixture.web, agentFile: fixture.agent, analyzer: (input, {runId}) => ({
      schema_id: 'trace.sensemaking-result', schema_version: 1, kind: 'candidate', confidence: 1,
      observation: input.user_prompt, desired_behavior: '不应落库', scope: 'unknown', target_kind: 'unresolved', target_hint: null,
      understanding_delta: null, open_questions: [], source: {host: input.host, session_id: input.session_id, turn_id: input.turn_id, run_id: runId, input_hash: workflowHash(input)},
    })});
    assert.throws(() => worker.once(), error => error.code === 'SENSEMAKING_RESULT_PRIVACY');
    const job = worker.product.hostWorkflow.listSensemakingJobs()[0];
    assert.equal(job.status, 'failed');
    assert.equal(job.error_message.includes('请在发布前检查 git 分支'), false);
  } finally {
    worker?.close();
    cleanup(fixture);
  }
});
