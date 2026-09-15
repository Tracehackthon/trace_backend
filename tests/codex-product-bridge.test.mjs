import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createWebStore} from '../apps/desktop/web-store.mjs';

const projectDir = path.resolve(process.cwd());

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-codex-product-'));
  const store = createWebStore({file: path.join(directory, 'web.sqlite')});
  const server = http.createServer(async (req, res) => { if (!await store.handle(req, res)) { res.writeHead(404); res.end('{}'); } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    store.close();
    fs.rmSync(directory, {recursive: true, force: true});
  });
  async function request(route, body) {
    const response = await fetch(`${origin}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {origin, 'content-type': 'application/json'},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    return {status: response.status, json: await response.json()};
  }
  let revision = 0, sequence = 0;
  async function command(operations) {
    const response = await request('/api/product/commands', {
      protocolVersion: 1, commandId: `seed:${++sequence}`, expectedRevision: revision,
      operations: Array.isArray(operations) ? operations : [operations],
    });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    revision = response.json.revision;
    return response.json;
  }
  const chain = (type, extra = {}) => ({type: 'chain.action', matterId: 'matter-codex', action: {type, ...extra}});
  await command([
    {type: 'capture.create', matterId: 'matter-codex', text: '需要把 Trace 的上下文真正交给 Codex。'},
    chain('UNDERSTANDING_DRAFT', {text: 'Codex 只接收本次确认的内容，并带回可复核结果。'}),
    chain('SAVE_UNDERSTANDING'),
    {type: 'handoff.create', matterId: 'matter-codex', workId: 'work-codex', destination: {agent: 'Codex', project: path.basename(projectDir), task: '实现 Codex 接入'}, role: 'trial', note: '先验证一条窄链路'},
  ]);
  return {origin, request, command, revision: () => revision};
}

function receive(commandId = 'codex-receive:one', overrides = {}) {
  return {protocolVersion: 1, commandId, workId: 'work-codex', sessionId: 'codex-session-1', projectDir, ...overrides};
}

test('Codex receives a bounded snapshot with a server receipt, then returns only to review', async t => {
  const app = await fixture(t);
  const delivered = await app.request('/api/product/codex/receive', receive());
  assert.equal(delivered.status, 200, JSON.stringify(delivered.json));
  assert.equal(delivered.json.receipt.status, 'received');
  assert.equal(delivered.json.receipt.sessionId, 'codex-session-1');
  assert.equal(delivered.json.receipt.projectDir, projectDir);
  assert.match(delivered.json.receipt.contextHash, /^[a-f0-9]{64}$/);
  assert.equal(delivered.json.context.boundaries.scope, 'current-task');
  assert.equal(delivered.json.context.context.intake.length, 1);
  assert.equal(delivered.json.context.context.intake[0].role, 'trial');
  assert.equal(delivered.json.context.context.intake[0].instruction.includes('待检验'), true);
  const recovered = await app.request('/api/product/codex/receive', receive('codex-receive:new-attempt'));
  assert.equal(recovered.status, 200);
  assert.deepEqual(recovered.json.receipt, delivered.json.receipt);
  assert.equal(recovered.json.revision, delivered.json.revision);

  const saved = await app.request('/api/product/workspace');
  const beforeUnderstanding = saved.json.host.chain.matters[0].understanding;
  assert.equal(saved.json.host.worksite.works['work-codex'].connected, true);
  assert.equal(saved.json.host.worksite.works['work-codex'].connection.contextHash, delivered.json.receipt.contextHash);

  const returnedBody = {
    protocolVersion: 1,
    commandId: 'codex-return:one',
    workId: 'work-codex',
    sessionId: 'codex-session-1',
    projectDir,
    deliveryId: delivered.json.receipt.deliveryId,
    contextHash: delivered.json.receipt.contextHash,
    result: {
      matterId: 'matter-codex',
      summary: 'Codex 接入已实现',
      fact: '协议测试通过，回执已由本机服务持久化。',
      interpretation: 'MCP 能作为 Codex 与 Trace 产品工作区之间的窄适配层。',
      unconfirmed: '尚未由用户采用候选理解。',
      proposedUnderstanding: 'Codex 接入应保留真实回执与人工复核边界。',
      artifacts: [{title: '协议测试', kind: 'test', path: 'tests/codex-product-bridge.test.mjs'}],
    },
  };
  const returned = await app.request('/api/product/codex/return', returnedBody);
  assert.equal(returned.status, 200, JSON.stringify(returned.json));
  assert.equal(returned.json.receipt.status, 'returned_for_review');
  assert.equal(returned.json.receipt.understandingChanged, false);
  assert.equal(Object.hasOwn(returned.json.receipt, 'result'), false);

  const after = await app.request('/api/product/workspace');
  const matter = after.json.host.chain.matters[0], session = after.json.host.worksite.sessions['work-codex'];
  assert.equal(matter.understanding, beforeUnderstanding);
  assert.equal(session.result.fact, returnedBody.result.fact);
  assert.equal(session.result.decision, 'pending');
  assert.equal(session.codexReturns.length, 1);
  assert.deepEqual(session.codexReturns[0].result, returnedBody.result);
  assert.equal(after.json.host.worksite.works['work-codex'].connection.status, 'returned_for_review');

  const replay = await app.request('/api/product/codex/return', returnedBody);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.json.receipt, returned.json.receipt);
  assert.equal((await app.request('/api/product/workspace')).json.host.worksite.sessions['work-codex'].codexReturns.length, 1);
  const changed = structuredClone(returnedBody); changed.result.fact = '试图覆盖第一次结果';
  assert.equal((await app.request('/api/product/codex/return', changed)).json.error.code, 'COMMAND_CONFLICT');
});

test('Codex delivery rejects wrong project, session, hash, matter and excluded context without mutation', async t => {
  const app = await fixture(t), initialRevision = app.revision();
  const wrongProject = await app.request('/api/product/codex/receive', receive('wrong-project', {projectDir: path.join(path.dirname(projectDir), 'other-project')}));
  assert.equal(wrongProject.status, 409);
  assert.equal(wrongProject.json.error.code, 'PROJECT_MISMATCH');
  assert.equal((await app.request('/api/product/workspace')).json.revision, initialRevision);

  const delivered = await app.request('/api/product/codex/receive', receive());
  const baseReturn = {
    protocolVersion: 1, commandId: 'bad-return', workId: 'work-codex', sessionId: 'codex-session-1', projectDir,
    deliveryId: delivered.json.receipt.deliveryId, contextHash: delivered.json.receipt.contextHash,
    result: {matterId: 'matter-codex', fact: '真实结果'},
  };
  assert.equal((await app.request('/api/product/codex/receive', receive('other-session', {sessionId: 'codex-session-2'}))).json.error.code, 'WORK_ALREADY_DELIVERED');
  assert.equal((await app.request('/api/product/codex/return', {...baseReturn, contextHash: '0'.repeat(64)})).json.error.code, 'DELIVERY_MISMATCH');
  assert.equal((await app.request('/api/product/codex/return', {...baseReturn, commandId: 'wrong-matter', result: {matterId: 'not-in-delivery', fact: '错误归属'}})).json.error.code, 'MATTER_MISMATCH');
  const current = await app.request('/api/product/workspace');
  assert.equal(current.json.host.worksite.sessions['work-codex'].codexReturns, undefined);
  assert.equal(current.json.host.chain.matters[0].understandingVersion, 1);
});

test('excluded intake is never delivered and malformed return fields are rejected', async t => {
  const app = await fixture(t);
  const state = await app.request('/api/product/workspace');
  const intakeId = state.json.host.worksite.sessions['work-codex'].intake[0].id;
  await app.command({type: 'worksite.action', workId: 'work-codex', action: {type: 'SET_INTAKE_ROLE', id: intakeId, role: 'exclude'}});
  const empty = await app.request('/api/product/codex/receive', receive());
  assert.equal(empty.status, 422);
  assert.equal(empty.json.error.code, 'EMPTY_CODEX_CONTEXT');
  assert.equal((await app.request('/api/product/workspace')).json.host.worksite.works['work-codex'].connected, false);

  const malformed = await app.request('/api/product/codex/return', {
    protocolVersion: 1, commandId: 'malformed', workId: 'work-codex', sessionId: 'codex-session-1', projectDir,
    deliveryId: 'missing', contextHash: '0'.repeat(64), result: {matterId: 'matter-codex', fact: 'x', receipt: {forged: true}},
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.json.error.code, 'INVALID_RESULT');
});
