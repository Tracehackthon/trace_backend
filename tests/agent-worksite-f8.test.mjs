import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';

import {createAgentService} from '../apps/agent/service.mjs';
import {createAgentHttp} from '../apps/agent/http.mjs';
import {createAgentStore} from '../apps/agent/store.mjs';
import {createProductWorkspace} from '../packages/product/workspace/src/workspace.mjs';

const projectName = 'f8-fixture-project';

function fixtureExecutor() {
  return {
    capabilities: {tools: false, streaming: false, cancellation: true, output: 'trace-result-v1'},
    async execute({request, onEvent}) {
      onEvent('runtime.connected', {threadId: 'fixture-thread'});
      return {
        raw: JSON.stringify({
          answer: '受控 Agent 已核对本次工作上下文。',
          replacement: request.purpose === 'revise' ? '经用户确认后才更新的工作现场理解。' : null,
          citations: [], uncertainties: ['受控 fixture 未运行真实模型。'],
        }),
        threadId: 'fixture-thread', turnId: 'fixture-turn', runtimeVersion: 'fixture',
      };
    },
    async check() { return {runtime: 'fixture', modelTurnTested: false}; },
  };
}

function fixtureRegistry(executor) {
  const binding = {profileId: 'fixture', label: 'F8 fixture', kind: 'fixture', ownerId: 'test', version: 1, revision: 'fixture', capabilities: executor.capabilities};
  return {
    describe: () => ({defaultProfileId: 'fixture', profiles: [binding]}),
    bind: profileId => { assert.ok(profileId === undefined || profileId === 'fixture'); return {binding, executor}; },
    resolve: value => { assert.equal(value.profileId, 'fixture'); return {binding: value, executor}; },
    isCurrent: value => value?.profileId === 'fixture' && value?.revision === 'fixture',
    check: async () => ({profile: binding, runtime: 'fixture', modelTurnTested: false}),
  };
}

async function createFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-agent-worksite-f8-'));
  const product = createProductWorkspace({file: path.join(dir, 'web.sqlite')});
  const executor = fixtureExecutor();
  const store = createAgentStore({file: path.join(dir, 'agent.sqlite'), workspaceKey: 'f8-workspace'});
  const service = createAgentService({
    store, readWorkspace: product.read, executeProduct: product.execute,
    returnAgentWorksiteResult: product.returnAgentWorksiteResult,
    executorRegistry: fixtureRegistry(executor), adapter: executor,
  });
  const agent = createAgentHttp({service});
  const server = http.createServer(async (req, res) => {
    if (await product.handle(req, res)) return;
    if (await agent.handle(req, res)) return;
    res.writeHead(404, {'content-type': 'application/json'}); res.end('{}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await agent.close();
    product.close();
    fs.rmSync(dir, {recursive: true, force: true});
  });
  const request = async (route, body) => {
    const response = await fetch(origin + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {origin, ...(body === undefined ? {} : {'content-type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    return {status: response.status, body: await response.json()};
  };
  const command = body => request('/api/product/commands', body);
  return {origin, request, command, product};
}

async function waitForRun(app, runId) {
  for (let i = 0; i < 100; i++) {
    const value = await app.request(`/api/agent/runs/${runId}`);
    if (['succeeded', 'failed', 'stale', 'cancelled', 'timed_out', 'interrupted'].includes(value.body.status)) return value.body;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('fixture run did not finish');
}

test('worksite Agent context and F8 return are identity-bound, review-only, and CAS durable', async t => {
  const app = await createFixture(t);
  let revision = 0;
  const seeded = await app.command({protocolVersion: 1, commandId: 'f8-seed', expectedRevision: revision, operations: [
    {type: 'capture.create', matterId: 'f8-matter', text: '工作现场原始表达'},
    {type: 'chain.action', matterId: 'f8-matter', action: {type: 'UNDERSTANDING_DRAFT', text: '工作现场当前理解'}},
    {type: 'chain.action', matterId: 'f8-matter', action: {type: 'SAVE_UNDERSTANDING'}},
    {type: 'handoff.create', matterId: 'f8-matter', workId: 'f8-work', destination: {agent: 'Agent', project: projectName, task: 'F8 工作现场'}, role: 'trial', note: '受控上下文'},
  ]});
  assert.equal(seeded.status, 200, JSON.stringify(seeded.body)); revision = seeded.body.revision;
  const snapshot = (await app.request('/api/product/workspace')).body;
  const work = snapshot.host.worksite.works['f8-work'];
  const session = snapshot.host.worksite.sessions['f8-work'];
  const matter = snapshot.host.chain.matters.find(item => item.id === 'f8-matter');
  const context = {
    protocolVersion: 1, requestId: 'f8-run-1', expectedRevision: revision, matterId: matter.id,
    contextMode: snapshot.host.chain.sessions[matter.id].contextMode,
    contextEpoch: snapshot.host.chain.sessions[matter.id].contextEpoch,
    purpose: 'revise', input: '只形成工作现场候选，不直接写入当前理解。', profileId: 'fixture',
    workId: work.id, role: 'trial',
    intake: session.intake.filter(item => item.role !== 'exclude').map(item => ({
      id: item.id, matterId: item.matterId, title: item.title, sourceText: item.sourceText,
      sourceVersion: item.sourceVersion, role: item.role, note: item.note,
    })),
    findings: [], project: work.project, projectIdentity: work.project,
    selection: {field: 'understandingDraft', start: 0, end: matter.understandingDraft.length, text: matter.understandingDraft},
  };
  const created = await app.request('/api/agent/runs', context);
  assert.equal(created.status, 202, JSON.stringify(created.body));
  const run = await waitForRun(app, created.body.run.runId);
  assert.equal(run.status, 'succeeded', JSON.stringify(run));
  assert.equal(run.workId, 'f8-work');
  assert.equal(run.project, projectName);
  assert.equal(run.role, 'trial');
  assert.equal(run.intake.length, 1);
  assert.deepEqual(run.findings, []);
  const resumedCreate = await app.request('/api/agent/runs', {...context, requestId: 'f8-run-resume', previousRunId: run.runId, threadId: run.runtime.threadId});
  assert.equal(resumedCreate.status, 202, JSON.stringify(resumedCreate.body));
  const resumed = await waitForRun(app, resumedCreate.body.run.runId);
  assert.equal(resumed.status, 'succeeded', JSON.stringify(resumed));
  const wrongResume = await app.request('/api/agent/runs', {...context, requestId: 'f8-run-wrong-resume', project: 'another-project', projectIdentity: 'another-project', previousRunId: run.runId, threadId: run.runtime.threadId});
  assert.equal(wrongResume.status, 409, JSON.stringify(wrongResume.body));
  assert.equal(run.adoptionAvailable, false, 'worksite results never expose chain candidate adoption');
  const forbidden = await app.request(`/api/agent/runs/${run.runId}/adoption`, {
    action: 'accept', commandId: 'f8-forbidden-adoption', expectedRevision: revision,
  });
  assert.equal(forbidden.status, 409);
  assert.equal(forbidden.body.error.code, 'WORKSITE_ADOPTION_FORBIDDEN');

  // A result can only return to the exact worksite/project identity.
  const wrong = await app.request(`/api/agent/runs/${run.runId}/worksite`, {
    commandId: 'f8-wrong-project', expectedRevision: revision, workId: 'f8-work', matterId: 'f8-matter',
    project: 'another-project', projectIdentity: 'another-project',
  });
  assert.equal(wrong.status, 409, JSON.stringify(wrong.body));
  assert.equal((await app.request('/api/product/workspace')).body.revision, revision);

  const returned = await app.request(`/api/agent/runs/${run.runId}/worksite`, {
    commandId: 'f8-return', expectedRevision: revision, workId: 'f8-work', matterId: 'f8-matter',
    project: projectName, projectIdentity: projectName,
  });
  assert.equal(returned.status, 200, JSON.stringify(returned.body));
  assert.equal(returned.body.receipt.status, 'returned_for_review');
  revision = returned.body.product.revision;
  assert.equal(returned.body.product.host.chain.matters[0].understanding, '工作现场当前理解');
  assert.equal(returned.body.product.host.worksite.sessions['f8-work'].result.decision, 'pending');
  assert.equal(returned.body.product.host.worksite.works['f8-work'].connection.status, 'returned_for_review');

  const opened = await app.command({protocolVersion: 1, commandId: 'f8-open-review', expectedRevision: revision, operations: [
    {type: 'worksite.action', workId: 'f8-work', action: {type: 'OPEN_REVISION_REVIEW'}},
  ]});
  assert.equal(opened.status, 200, JSON.stringify(opened.body)); revision = opened.body.revision;
  const confirmed = await app.command({protocolVersion: 1, commandId: 'f8-confirm-review', expectedRevision: revision, operations: [
    {type: 'worksite.action', workId: 'f8-work', action: {type: 'CONFIRM_REVISION'}},
  ]});
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.host.chain.matters[0].understanding, '经用户确认后才更新的工作现场理解。');
  assert.equal(confirmed.body.host.worksite.works['f8-work'].connection.status, 'revised');
});

test('worksite Agent request and resume reject cross-work/matter/project identities', async t => {
  const app = await createFixture(t);
  const invalid = await app.request('/api/agent/runs', {
    protocolVersion: 1, requestId: 'f8-invalid', expectedRevision: 0, matterId: 'missing-matter', contextMode: 'resume', contextEpoch: 0,
    purpose: 'discuss', input: 'must fail closed', profileId: 'fixture', workId: 'wrong-work', role: 'trial', intake: [], findings: [],
    project: 'wrong-project', projectIdentity: 'wrong-project',
  });
  assert.equal(invalid.status, 404);
  assert.equal(invalid.body.error.code, 'WORKSITE_NOT_FOUND');
});
