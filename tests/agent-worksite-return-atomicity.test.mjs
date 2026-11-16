import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createAgentService} from '../apps/agent/service.mjs';
import {createAgentStore} from '../apps/agent/store.mjs';
import {createProductWorkspace} from '../packages/product/workspace/src/workspace.mjs';

function makeAdapter() {
  return {
    capabilities: {tools: false, streaming: false, cancellation: true, output: 'trace-result-v1'},
    async execute() {
      return {
        raw: JSON.stringify({answer: 'atomic result', replacement: null, citations: [], uncertainties: []}),
        threadId: 'atomic-thread', turnId: 'atomic-turn', runtimeVersion: 'fixture',
      };
    },
    async check() { return {runtime: 'fixture', modelTurnTested: false}; },
  };
}

function makeRegistry(adapter) {
  const binding = {profileId: 'fixture', label: 'Fixture', kind: 'fixture', ownerId: 'atomicity', version: 1,
    revision: 'fixture', capabilities: adapter.capabilities};
  return {
    describe: () => ({defaultProfileId: 'fixture', profiles: [binding]}),
    bind: () => ({binding, executor: adapter}),
    resolve: current => ({binding: current, executor: adapter}),
    isCurrent: current => current?.revision === 'fixture',
    check: async () => ({profile: binding, runtime: 'fixture'}),
  };
}

async function makeHarness(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-agent-worksite-atomicity-'));
  let product = createProductWorkspace({file: path.join(root, 'web.sqlite')});
  let store = createAgentStore({file: path.join(root, 'agent.sqlite'), workspaceKey: 'atomicity'});
  const adapter = makeAdapter();
  const registry = makeRegistry(adapter);
  let service = createAgentService({store, readWorkspace: () => product.read(), executeProduct: product.execute,
    returnAgentWorksiteResult: product.returnAgentWorksiteResult, executorRegistry: registry, adapter, pollMs: 1});
  t.after(async () => {
    await service.close();
    product.close();
    fs.rmSync(root, {recursive: true, force: true});
  });

  let revision = product.read().revision;
  const command = operations => {
    const result = product.execute({protocolVersion: 1, commandId: `seed-${revision + 1}`, expectedRevision: revision, operations});
    revision = result.revision;
    return result;
  };
  command([
    {type: 'capture.create', matterId: 'atomic-matter', text: 'input'},
    {type: 'chain.action', matterId: 'atomic-matter', action: {type: 'UNDERSTANDING_DRAFT', text: 'understanding'}},
    {type: 'chain.action', matterId: 'atomic-matter', action: {type: 'SAVE_UNDERSTANDING'}},
    {type: 'handoff.create', matterId: 'atomic-matter', workId: 'atomic-work',
      destination: {agent: 'Agent', project: 'atomicity-project', task: 'work'}, role: 'trial', note: 'n'},
  ]);
  const snapshot = product.read();
  const work = snapshot.host.worksite.works['atomic-work'];
  const session = snapshot.host.worksite.sessions['atomic-work'];
  const chainSession = snapshot.host.chain.sessions['atomic-matter'];
  const request = {
    protocolVersion: 1, requestId: 'atomic-request', expectedRevision: revision, matterId: 'atomic-matter',
    contextMode: chainSession.contextMode, contextEpoch: chainSession.contextEpoch, purpose: 'discuss', input: 'ask', profileId: 'fixture',
    workId: 'atomic-work', role: 'trial',
    intake: session.intake.filter(item => item.role !== 'exclude').map(item => ({id: item.id, matterId: item.matterId,
      title: item.title, sourceText: item.sourceText, sourceVersion: item.sourceVersion, role: item.role, note: item.note})),
    findings: [], project: work.project, projectIdentity: work.project,
  };
  const created = service.create(request);
  let run;
  for (let attempt = 0; attempt < 100; attempt++) {
    run = service.get(created.run.runId);
    if (run.status === 'succeeded') break;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.equal(run.status, 'succeeded');
  const base = {workId: 'atomic-work', matterId: 'atomic-matter', project: work.project, projectIdentity: work.project};
  return {
    root, adapter, registry, base, runId: run.runId, product, store, service,
    replace(nextProduct, nextStore, nextService) { product = nextProduct; store = nextStore; service = nextService; },
    returnBody(commandId, expectedRevision) { return {...base, commandId, expectedRevision}; },
  };
}

test('same run cannot be returned through a second command without mutating Product or Agent state', async t => {
  const fixture = await makeHarness(t);
  const first = fixture.service.returnWorksite(fixture.runId, fixture.returnBody('atomic-return-1', fixture.product.read().revision));
  const productAfterFirst = fixture.product.read();
  const runAfterFirst = fixture.service.get(fixture.runId);

  assert.throws(() => fixture.service.returnWorksite(fixture.runId,
    fixture.returnBody('atomic-return-2', productAfterFirst.revision)), error => {
    assert.equal(error.code, 'WORKSITE_RETURN_CONFLICT');
    assert.equal(error.status, 409);
    return true;
  });

  assert.deepEqual(fixture.product.read(), productAfterFirst);
  assert.deepEqual(fixture.service.get(fixture.runId), runAfterFirst);
  assert.equal(fixture.product.read().host.worksite.sessions['atomic-work'].agentReturns.length, 1);
  assert.equal(fixture.product.read().host.worksite.sessions['atomic-work'].agentReturns[0].commandId, first.receipt.commandId);
});

test('same command replay is idempotent and remains durable across Product/Agent restart', async t => {
  const fixture = await makeHarness(t);
  const commandId = 'atomic-replay';
  const firstExpectedRevision = fixture.product.read().revision;
  const first = fixture.service.returnWorksite(fixture.runId, fixture.returnBody(commandId, firstExpectedRevision));
  const productAfterFirst = fixture.product.read();
  const runAfterFirst = fixture.service.get(fixture.runId);
  const productFile = path.join(fixture.root, 'web.sqlite');
  const agentFile = path.join(fixture.root, 'agent.sqlite');
  await fixture.service.close();
  fixture.product.close();

  const product = createProductWorkspace({file: productFile});
  const store = createAgentStore({file: agentFile, workspaceKey: 'atomicity'});
  const service = createAgentService({store, readWorkspace: product.read, executeProduct: product.execute,
    returnAgentWorksiteResult: product.returnAgentWorksiteResult, executorRegistry: fixture.registry,
    adapter: fixture.adapter, pollMs: 1});
  fixture.replace(product, store, service);

  const replay = service.returnWorksite(fixture.runId, fixture.returnBody(commandId, firstExpectedRevision));
  assert.deepEqual(replay.receipt, first.receipt);
  assert.deepEqual(product.read(), productAfterFirst);
  assert.deepEqual(service.get(fixture.runId), runAfterFirst);

  assert.throws(() => service.returnWorksite(fixture.runId,
    fixture.returnBody('atomic-replay-other', productAfterFirst.revision)), error => {
    assert.equal(error.code, 'WORKSITE_RETURN_CONFLICT');
    assert.equal(error.status, 409);
    return true;
  });
  assert.deepEqual(product.read(), productAfterFirst);
});

test('concurrent different commands allow only one Product commit', async t => {
  const fixture = await makeHarness(t);
  const expectedRevision = fixture.product.read().revision;
  const outcomes = await Promise.allSettled([
    Promise.resolve().then(() => fixture.service.returnWorksite(fixture.runId, fixture.returnBody('atomic-concurrent-1', expectedRevision))),
    Promise.resolve().then(() => fixture.service.returnWorksite(fixture.runId, fixture.returnBody('atomic-concurrent-2', expectedRevision))),
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(item => item.status === 'rejected').length, 1);
  const rejected = outcomes.find(item => item.status === 'rejected').reason;
  assert.ok(['REVISION_CONFLICT', 'WORKSITE_RETURN_CONFLICT'].includes(rejected.code), rejected.code);
  const snapshot = fixture.product.read();
  assert.equal(snapshot.revision, expectedRevision + 1);
  assert.equal(snapshot.host.worksite.sessions['atomic-work'].agentReturns.length, 1);
});
