import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(here, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function reservePort() {
  const server = http.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}

function modelReply(res, message) {
  res.writeHead(200, {'content-type': 'application/json'});
  res.end(JSON.stringify({choices: [{message}]}));
}

async function startDesktop({port, root, profiles}) {
  const child = spawn(process.execPath, ['--import', './tests/fixtures/zhihu-http-fixture.mjs', 'apps/desktop/server.mjs'], {
    cwd: runtimeRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false,
    env: {...process.env, TRACE_DESKTOP_PORT: String(port), TRACE_WEB_STATE_FILE: path.join(root, 'web.sqlite'),
      TRACE_AGENT_ENABLED: '1', TRACE_AGENT_STATE_FILE: path.join(root, 'agent.sqlite'), TRACE_AGENT_PROFILES_FILE: profiles,
      TRACE_ZHIHU_ENABLED: '1', TRACE_ZHIHU_FIXTURE: '1', ZHIHU_ACCESS_SECRET: 'fixture-only-not-a-real-credential'},
  });
  let log = ''; child.stdout.on('data', chunk => {log += chunk;}); child.stderr.on('data', chunk => {log += chunk;});
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try {if ((await fetch(origin + '/api/agent/capabilities')).ok) return {child, origin, log: () => log};} catch {}
    if (child.exitCode !== null) break; await delay(20);
  }
  throw new Error(`desktop did not start: ${log}`);
}

async function stopDesktop(desktop) {
  if (!desktop || desktop.child.exitCode !== null || desktop.child.signalCode !== null) return;
  const closed = once(desktop.child, 'close'); desktop.child.kill(); await closed;
}

test('API-only: product command -> public searches -> Agent retrieval/tools/SSE -> durable read after restart', {timeout: 30000}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-backend-api-flow-'));
  const modelRequests = [];
  const modelServer = http.createServer(async (req, res) => {
    let raw = ''; req.setEncoding('utf8'); for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); modelRequests.push(body);
    if (!body.tools.some(tool => tool.function.name === 'trace_zhihu_search')) return modelReply(res, {role: 'assistant', content: JSON.stringify({
      answer: '只建议修改用户明确选中的一处。', replacement: 'API 可以从输入走到来源、Agent、事件、用户确认和持久化证据', citations: [], uncertainties: [],
    })});
    const toolResults = body.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
    if (toolResults.length === 0) return modelReply(res, {role: 'assistant', content: null, tool_calls: [{id: 'zhihu-search', type: 'function',
      function: {name: 'trace_zhihu_search', arguments: JSON.stringify({query: '接口全链路的维护经验', count: 1})}}]});
    if (toolResults.length === 1) return modelReply(res, {role: 'assistant', content: null, tool_calls: [{id: 'global-search', type: 'function',
      function: {name: 'trace_global_search', arguments: JSON.stringify({query: 'backend API integration evidence', count: 1})}}]});
    const items = toolResults.map(result => result.items[0]);
    return modelReply(res, {role: 'assistant', content: JSON.stringify({
      answer: '接口链路取得了知乎和全网两类来源摘要；Agent 结果保持为未采纳候选，没有改写 Product Workspace。', replacement: null,
      citations: items.map(item => ({contextId: item.id, quote: '这是一条接口测试摘要。'})),
      uncertainties: ['全网结果来自受控上游；本测试验证接口和持久化链路，不宣称真实非知乎站点覆盖。'],
    })});
  });
  modelServer.listen(0, '127.0.0.1'); await once(modelServer, 'listening');
  const profiles = path.join(root, 'profiles.json');
  fs.writeFileSync(profiles, JSON.stringify({protocolVersion: 1, configVersion: 1, ownerId: 'api-flow-test', defaultProfileId: 'local-model', profiles: [{
    id: 'local-model', kind: 'model', enabled: true, version: 1,
    endpoint: `http://127.0.0.1:${modelServer.address().port}/v1/chat/completions`, model: 'api-flow-fixture',
  }]}));
  const port = await reservePort(); let desktop;
  t.after(async () => {
    await stopDesktop(desktop); modelServer.closeAllConnections(); await new Promise(resolve => modelServer.close(resolve));
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('trace-backend-api-flow-'));
    fs.rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  });
  desktop = await startDesktop({port, root, profiles}); const {origin} = desktop;
  const request = async (pathname, body) => {
    const response = await fetch(origin + pathname, {method: body === undefined ? 'GET' : 'POST',
      headers: {origin, ...(body === undefined ? {} : {'content-type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    return {status: response.status, body: await response.json()};
  };
  const initial = await request('/api/product/workspace'); assert.equal(initial.body.revision, 0); assert.equal(initial.body.host, null);
  const created = await request('/api/product/commands', {protocolVersion: 1, commandId: 'api-flow-create', expectedRevision: 0, operations: [
    {type: 'capture.create', matterId: 'api-flow-matter', text: '后端交互需要脱离页面独立验证。'},
    {type: 'chain.action', matterId: 'api-flow-matter', action: {type: 'UNDERSTANDING_DRAFT', text: '接口必须能从输入走到来源、Agent、事件和持久化证据。'}},
    {type: 'chain.action', matterId: 'api-flow-matter', action: {type: 'SAVE_UNDERSTANDING'}},
  ]});
  assert.equal(created.status, 200); assert.equal(created.body.revision, 1); assert.equal(created.body.receipt.status, 'committed');
  const zhihu = await request('/api/search/zhihu', {query: '接口全链路', count: 1});
  const global = await request('/api/search/global', {query: 'backend API integration', count: 1});
  assert.equal(zhihu.status, 200); assert.equal(zhihu.body.source, 'zhihu'); assert.equal(zhihu.body.items.length, 1);
  assert.equal(global.status, 200); assert.equal(global.body.source, 'global'); assert.equal(global.body.items.length, 1);
  const capabilities = await request('/api/agent/capabilities');
  assert.deepEqual(capabilities.body.searchSources, ['zhihu', 'global']); assert.equal(capabilities.body.defaultProfileId, 'local-model'); assert.equal(capabilities.body.candidateAdoption, true);
  const runCreated = await request('/api/agent/runs', {protocolVersion: 1, requestId: 'api-flow-agent-run', expectedRevision: 1,
    matterId: 'api-flow-matter', contextMode: 'resume', contextEpoch: 0, purpose: 'discuss',
    input: '结合明确允许的两类来源，说明这个后端链路是否完整。', retrieval: {sources: ['zhihu', 'global']}});
  assert.equal(runCreated.status, 202); const runId = runCreated.body.run.runId;
  const eventsResponse = await fetch(`${origin}/api/agent/runs/${runId}/events`, {headers: {origin}});
  assert.equal(eventsResponse.status, 200); const events = await eventsResponse.text();
  assert.match(events, /event: tool\.completed/); assert.match(events, /event: run\.succeeded/);
  const completed = await request(`/api/agent/runs/${runId}`);
  assert.equal(completed.body.status, 'succeeded'); assert.equal(completed.body.usableAsCurrent, true);
  assert.equal(completed.body.result.adoption, 'not_applied'); assert.deepEqual(completed.body.result.sources.map(source => source.source), ['zhihu', 'global']);
  assert.equal(modelRequests.length, 3); assert.ok(modelRequests.every(call => call.tools.some(tool => tool.function.name === 'trace_zhihu_search')));
  const unchanged = await request('/api/product/workspace');
  assert.equal(unchanged.body.revision, 1); assert.equal(unchanged.body.host.chain.matters[0].understanding, '接口必须能从输入走到来源、Agent、事件和持久化证据。');
  const selected='接口必须能从输入走到来源、Agent、事件和持久化证据';
  const reviseCreated=await request('/api/agent/runs',{protocolVersion:1,requestId:'api-flow-revise-run',expectedRevision:1,
    matterId:'api-flow-matter',contextMode:'resume',contextEpoch:0,purpose:'revise',input:'只改这一处，让闭环包含用户确认。',
    selection:{field:'understandingDraft',start:0,end:selected.length,text:selected}});
  assert.equal(reviseCreated.status,202);const reviseId=reviseCreated.body.run.runId;
  const reviseEvents=await (await fetch(`${origin}/api/agent/runs/${reviseId}/events`,{headers:{origin}})).text();assert.match(reviseEvents,/event: run\.succeeded/);
  const revised=await request(`/api/agent/runs/${reviseId}`);assert.equal(revised.body.result.kind,'revision_candidate');
  const adopted=await request(`/api/agent/runs/${reviseId}/adoption`,{action:'accept',commandId:'api-flow-agent-adopt',expectedRevision:1});
  assert.equal(adopted.status,200);assert.equal(adopted.body.run.result.adoption,'applied');assert.equal(adopted.body.product.revision,2);
  assert.equal(adopted.body.product.host.chain.matters[0].understanding,'接口必须能从输入走到来源、Agent、事件和持久化证据。');
  assert.equal(adopted.body.product.host.chain.matters[0].understandingDraft,'API 可以从输入走到来源、Agent、事件、用户确认和持久化证据。');
  await stopDesktop(desktop); desktop = await startDesktop({port, root, profiles});
  const restoredProduct = await (await fetch(desktop.origin + '/api/product/workspace')).json();
  const restoredRun = await (await fetch(`${desktop.origin}/api/agent/runs/${runId}`)).json();
  const restoredRevisionRun=await (await fetch(`${desktop.origin}/api/agent/runs/${reviseId}`)).json();
  assert.equal(restoredProduct.revision, 2); assert.equal(restoredRun.status, 'succeeded'); assert.equal(restoredRun.usableAsCurrent, false);
  assert.equal(restoredRevisionRun.result.adoption,'applied');assert.equal(restoredProduct.host.chain.matters[0].understandingDraft,'API 可以从输入走到来源、Agent、事件、用户确认和持久化证据。');
  // Stop the authoritative owners before copying the stable SQLite main/WAL/SHM
  // set, so the evidence cannot change midway through the copy.
  await stopDesktop(desktop);
  const evidence = {protocolVersion: 1, transport: 'HTTP+SSE', frontendUsed: false,
    product: {initialRevision: 0, committedRevision: created.body.revision, adoptedRevision:adopted.body.product.revision,restoredRevision: restoredProduct.revision,
      understanding: restoredProduct.host.chain.matters[0].understanding,understandingDraft:restoredProduct.host.chain.matters[0].understandingDraft},
    searches: [{route: '/api/search/zhihu', source: zhihu.body.source, url: zhihu.body.items[0].url},
      {route: '/api/search/global', source: global.body.source, url: global.body.items[0].url}],
    agent: {runId, status: restoredRun.status, profile: restoredRun.profile, sourceKinds: restoredRun.result.sources.map(source => source.source),
      adoption: restoredRun.result.adoption, usableAsCurrent: restoredRun.usableAsCurrent, modelTurns: modelRequests.length,
      sseEvents: [...events.matchAll(/^event: (.+)$/gm)].map(match => match[1])},
    agentAdoption:{runId:reviseId,status:restoredRevisionRun.status,adoption:restoredRevisionRun.result.adoption,effect:adopted.body.product.receipt.effect},
    persistence: {webSqlite: fs.statSync(path.join(root, 'web.sqlite')).size, agentSqlite: fs.statSync(path.join(root, 'agent.sqlite')).size}};
  if (process.env.TRACE_API_FLOW_EVIDENCE) {
    const target = path.resolve(process.env.TRACE_API_FLOW_EVIDENCE); fs.mkdirSync(target, {recursive: true});
    fs.writeFileSync(path.join(target, 'api-flow.json'), JSON.stringify(evidence, null, 2));
    for (const [sourceName, targetName] of [['web.sqlite', 'api-flow-web.sqlite'], ['agent.sqlite', 'api-flow-agent.sqlite']]) {
      for (const suffix of ['', '-wal', '-shm']) {
        const source = path.join(root, sourceName + suffix), destination = path.join(target, targetName + suffix);
        if (fs.existsSync(destination)) fs.rmSync(destination);
        if (fs.existsSync(source)) fs.copyFileSync(source, destination);
      }
    }
  }
  t.diagnostic(JSON.stringify(evidence));
});
