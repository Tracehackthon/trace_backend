import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AgentError} from '../apps/agent/protocol.mjs';
import {createAgentService} from '../apps/agent/service.mjs';
import {createAgentStore} from '../apps/agent/store.mjs';
import {createProductWorkspace} from '../packages/product/workspace/src/workspace.mjs';

const output = () => ({raw: JSON.stringify({answer: 'native worksite fixture', replacement: null, citations: [], uncertainties: []}),
  threadId: 'native-worksite-thread', turnId: 'native-worksite-turn', runtimeVersion: 'fixture'});

function nativeFixtureAdapter(initialIdentity) {
  let configuredIdentity = initialIdentity;
  const adapter = {
    capabilities: {tools: false, streaming: false, cancellation: true, output: 'trace-result-v1', nativeWorkspace: true},
    setConfiguredIdentity(value) { configuredIdentity = value; },
    validateProjectBinding(request) {
      if (request.workId !== undefined && request.projectIdentity !== configuredIdentity)
        throw new AgentError('CODEX_PROJECT_SCOPE_MISMATCH', 'native Codex project cwd 与工作现场项目身份不一致。', 403);
    },
    async check() { return {runtime: 'fixture-native', modelTurnTested: false}; },
    async execute({request}) { this.validateProjectBinding(request); return output(); },
  };
  return adapter;
}

async function waitForRun(service, runId) {
  for (let i = 0; i < 100; i++) {
    const run = service.get(runId);
    if (['succeeded', 'failed', 'stale', 'cancelled', 'timed_out', 'interrupted'].includes(run.status)) return run;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('fixture run did not finish');
}

test('native worksite project binding rejects a second project on resume and return', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-native-service-binding-'));
  const projectA = path.join(root, 'project-a');
  const projectB = path.join(root, 'project-b');
  fs.mkdirSync(projectA, {recursive: true}); fs.mkdirSync(projectB, {recursive: true});
  const identityA = path.normalize(fs.realpathSync.native(projectA));
  const identityB = path.normalize(fs.realpathSync.native(projectB));
  const product = createProductWorkspace({file: path.join(root, 'web.sqlite')});
  const store = createAgentStore({file: path.join(root, 'agent.sqlite'), workspaceKey: 'native-binding'});
  const adapter = nativeFixtureAdapter(identityA);
  const service = createAgentService({store, readWorkspace: product.read, executeProduct: product.execute,
    returnAgentWorksiteResult: product.returnAgentWorksiteResult, adapter, pollMs: 5});
  t.after(async () => { await service.close(); product.close(); fs.rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 50}); });

  let revision = product.read().revision;
  const command = body => { const result = product.execute({protocolVersion: 1, commandId: body.commandId, expectedRevision: revision, operations: body.operations});
    revision = result.revision; return result; };
  command({commandId: 'native-bind-seed', operations: [
    {type: 'capture.create', matterId: 'native-matter', text: 'native worksite input'},
    {type: 'chain.action', matterId: 'native-matter', action: {type: 'UNDERSTANDING_DRAFT', text: 'native understanding'}},
    {type: 'chain.action', matterId: 'native-matter', action: {type: 'SAVE_UNDERSTANDING'}},
    {type: 'handoff.create', matterId: 'native-matter', workId: 'native-work',
      destination: {agent: 'Agent', project: identityA, task: 'Native binding'}, role: 'trial', note: 'binding fixture'},
  ]});
  const snapshot = product.read();
  const work = snapshot.host.worksite.works['native-work'];
  const session = snapshot.host.worksite.sessions['native-work'];
  const matter = snapshot.host.chain.matters.find(value => value.id === 'native-matter');
  const chainSession = snapshot.host.chain.sessions[matter.id];
  const base = {protocolVersion: 1, requestId: 'native-worksite-first', expectedRevision: revision, matterId: matter.id,
    contextMode: chainSession.contextMode, contextEpoch: chainSession.contextEpoch, purpose: 'discuss', input: 'native worksite request',
    profileId: 'fixture', workId: work.id, role: 'trial',
    intake: session.intake.filter(item => item.role !== 'exclude').map(item => ({id: item.id, matterId: item.matterId, title: item.title,
      sourceText: item.sourceText, sourceVersion: item.sourceVersion, role: item.role, note: item.note})),
    findings: [], project: work.project, projectIdentity: identityA};

  const first = service.create(base);
  const finished = await waitForRun(service, first.run.runId);
  assert.equal(finished.status, 'succeeded');

  const beforeMissingReturn = product.read();
  assert.throws(() => service.returnWorksite(first.run.runId, {commandId: 'native-worksite-missing-identity', expectedRevision: revision,
    workId: work.id, matterId: matter.id}), error => error.code === 'INVALID_WORKSITE_RETURN');
  assert.equal(product.read().revision, beforeMissingReturn.revision, 'missing return identity must not mutate Product Workspace');

  // Simulate a native profile whose fixed cwd now resolves to a different project.
  adapter.setConfiguredIdentity(identityB);
  assert.throws(() => service.create({...base, requestId: 'native-worksite-resume', previousRunId: first.run.runId,
    threadId: finished.runtime.threadId}), error => error.code === 'CODEX_PROJECT_SCOPE_MISMATCH');
  const beforeReturn = product.read();
  assert.throws(() => service.returnWorksite(first.run.runId, {commandId: 'native-worksite-return', expectedRevision: revision,
    workId: work.id, matterId: matter.id, project: work.project, projectIdentity: identityA}),
  error => error.code === 'CODEX_PROJECT_SCOPE_MISMATCH');
  assert.equal(product.read().revision, beforeReturn.revision, 'rejected native return must not mutate Product Workspace');
});
