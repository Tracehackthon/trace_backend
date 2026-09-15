import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { fixture, answer } from './fixtures/agent-harness.mjs';
import { createExecutorRegistry } from '../apps/agent/profiles.mjs';

async function remote(t, handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    req.setEncoding('utf8'); for await (const chunk of req) body += chunk;
    const record = { headers: req.headers, body: JSON.parse(body) }; requests.push(record);
    const value = await handler(record, requests);
    if (res.writableEnded) return;
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { endpoint: `http://127.0.0.1:${server.address().port}/execute`, requests };
}

function configFile(t, document) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-agent-profiles-'));
  const file = path.join(root, 'profiles.json'); fs.writeFileSync(file, JSON.stringify(document));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return file;
}

const document = (profiles, defaultProfileId = profiles[0].id) => ({
  protocolVersion: 1, configVersion: 1, ownerId: 'fixture-owner', defaultProfileId, profiles,
});

test('server model profile runs bounded context tool loop without Codex and never exposes credentials or endpoint', async t => {
  const provider = await remote(t, ({ headers, body }, all) => {
    assert.equal(headers.authorization, 'Bearer MODEL_SECRET_SENTINEL');
    assert.equal(body.model, 'fixture-model'); assert.equal(body.stream, false);
    if (all.length === 1) {
      assert.ok(!JSON.stringify(body).includes('OLD_PRIVATE_SENTINEL'));
      return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'read-1', type: 'function',
        function: { name: 'trace_context_read', arguments: JSON.stringify({ id: 'matter:original' }) } }] } }] };
    }
    assert.ok(JSON.stringify(body.messages).includes('OLD_PRIVATE_SENTINEL'));
    return { choices: [{ message: { role: 'assistant', content: answer('模型协议闭环完成', {
      citations: [{ contextId: 'matter:original', quote: 'OLD_PRIVATE_SENTINEL' }] }) } }] };
  });
  const env = { MODEL_TOKEN: 'MODEL_SECRET_SENTINEL' };
  env.TRACE_AGENT_PROFILES_FILE = configFile(t, document([{ id: 'bounded-model', label: 'Bounded model', kind: 'model', enabled: true,
    version: 1, endpoint: provider.endpoint, model: 'fixture-model', credentialEnv: 'MODEL_TOKEN' }]));
  const registry = createExecutorRegistry({ env });
  const a = await fixture(t, { executorRegistry: registry });
  const capabilities = await a.request('/api/agent/capabilities');
  assert.equal(capabilities.json.defaultProfileId, 'bounded-model');
  assert.equal(capabilities.json.profiles[0].kind, 'model');
  assert.ok(!JSON.stringify(capabilities.json).includes(provider.endpoint));
  assert.ok(!JSON.stringify(capabilities.json).includes('MODEL_TOKEN'));
  assert.ok(!JSON.stringify(capabilities.json).includes('MODEL_SECRET_SENTINEL'));
  const check = await a.request('/api/agent/check', { profileId: 'bounded-model' });
  assert.equal(check.status, 200); assert.equal(check.json.profile.profileId, 'bounded-model'); assert.equal(provider.requests.length, 0);
  const created = await a.request('/api/agent/runs', a.envelope({ profileId: 'bounded-model' }));
  const run = await a.wait(created.json.run.runId);
  assert.equal(run.status, 'succeeded'); assert.equal(run.profile.kind, 'model');
  assert.equal(run.result.answer, '模型协议闭环完成'); assert.equal(provider.requests.length, 2);
  assert.ok(!JSON.stringify(run).includes('MODEL_SECRET_SENTINEL'));
  const events = await (await fetch(`${a.origin}/api/agent/runs/${run.runId}/events`)).text();
  assert.match(events, /"profileId":"bounded-model"/); assert.ok(!events.includes(provider.endpoint)); assert.ok(!events.includes('MODEL_SECRET_SENTINEL'));
});

test('model profile fails closed on a provider-requested unregistered tool', async t => {
  const provider = await remote(t, () => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'bad', type: 'function',
    function: { name: 'shell', arguments: '{}' } }] } }] }));
  const env = { TRACE_AGENT_PROFILES_FILE: configFile(t, document([{ id: 'model', kind: 'model', enabled: true, version: 1,
    endpoint: provider.endpoint, model: 'fixture' }])) };
  const a = await fixture(t, { executorRegistry: createExecutorRegistry({ env }) });
  const before = a.webStore.read();
  const created = await a.request('/api/agent/runs', a.envelope({ profileId: 'model' }));
  const run = await a.wait(created.json.run.runId);
  assert.equal(run.status, 'failed'); assert.equal(run.error.code, 'TOOL_NOT_ALLOWED'); assert.equal(run.result, null);
  assert.deepEqual(a.webStore.read(), before); assert.equal(provider.requests.length, 1);
});

test('external Agent profile completes host-owned tool round trips and protocol check without Codex', async t => {
  const provider = await remote(t, ({ headers, body }) => {
    assert.equal(headers['x-api-key'], 'AGENT_SECRET_SENTINEL');
    if (body.operation === 'check') return { protocolVersion: 1, type: 'ready', runtimeVersion: 'fixture-agent/1', capabilities: { tools: true } };
    if (body.operation === 'start') {
      assert.ok(!JSON.stringify(body.context).includes('OLD_PRIVATE_SENTINEL'));
      return { protocolVersion: 1, type: 'tool_call', sessionId: 'external-session', runtimeVersion: 'fixture-agent/1',
        call: { id: 'tool-1', name: 'trace_context_read', arguments: { id: 'matter:original' } } };
    }
    assert.equal(body.operation, 'tool_result'); assert.equal(body.call.success, true);
    assert.match(body.call.result.text, /OLD_PRIVATE_SENTINEL/);
    return { protocolVersion: 1, type: 'completed', sessionId: 'external-session', runtimeVersion: 'fixture-agent/1',
      output: JSON.parse(answer('外部 Agent 闭环完成', { citations: [{ contextId: 'matter:original', quote: 'OLD_PRIVATE_SENTINEL' }] })) };
  });
  const env = { AGENT_TOKEN: 'AGENT_SECRET_SENTINEL' };
  env.TRACE_AGENT_PROFILES_FILE = configFile(t, document([{ id: 'custom-agent', kind: 'agent', enabled: true, version: 1,
    endpoint: provider.endpoint, credentialEnv: 'AGENT_TOKEN', authScheme: 'x-api-key', protocol: 'trace-external-agent-v1' }]));
  const registry = createExecutorRegistry({ env });
  const a = await fixture(t, { executorRegistry: registry });
  assert.equal((await a.request('/api/agent/check', { profileId: 'custom-agent' })).json.version, 'fixture-agent/1');
  const created = await a.request('/api/agent/runs', a.envelope({ profileId: 'custom-agent' }));
  const run = await a.wait(created.json.run.runId);
  assert.equal(run.status, 'succeeded'); assert.equal(run.profile.kind, 'agent'); assert.equal(run.result.answer, '外部 Agent 闭环完成');
  assert.ok(!JSON.stringify(run).includes('AGENT_SECRET_SENTINEL'));
});

test('cancelling an external Agent run aborts the active request and sends bounded remote cancellation', async t => {
  let toolStarted, cancelled, releaseTool;
  const toolGate = new Promise(resolve => { toolStarted = resolve; });
  const cancelGate = new Promise(resolve => { cancelled = resolve; });
  const holdTool = new Promise(resolve => { releaseTool = resolve; });
  const provider = await remote(t, async ({ body }) => {
    if (body.operation === 'start') return { protocolVersion: 1, type: 'tool_call', sessionId: 'cancel-session', runtimeVersion: 'fixture-agent/1',
      call: { id: 'tool-1', name: 'trace_context_read', arguments: { id: 'matter:original' } } };
    if (body.operation === 'tool_result') { toolStarted(); await holdTool; return {}; }
    if (body.operation === 'cancel') { releaseTool(); cancelled(); return { protocolVersion: 1, type: 'cancelled' }; }
    throw new Error('unexpected operation');
  });
  const env = { TRACE_AGENT_PROFILES_FILE: configFile(t, document([{ id: 'cancel-agent', kind: 'agent', enabled: true, version: 1,
    endpoint: provider.endpoint }])) };
  const a = await fixture(t, { executorRegistry: createExecutorRegistry({ env }), timeoutMs: 1000 });
  const created = await a.request('/api/agent/runs', a.envelope({ profileId: 'cancel-agent' }));
  await toolGate;
  const stopped = await a.request(`/api/agent/runs/${created.json.run.runId}/cancel`, {});
  assert.equal(stopped.json.status, 'cancelled');
  await Promise.race([cancelGate, new Promise((_, reject) => setTimeout(() => reject(new Error('remote cancellation not received')), 1000))]);
  assert.equal(a.service.get(created.json.run.runId).status, 'cancelled');
});

test('profile mutation revokes an in-flight executor and prevents late success', async t => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const profile = { id: 'mutable', kind: 'model', enabled: true, version: 1, endpoint: 'http://127.0.0.1:9/unused', model: 'fixture' };
  const file = configFile(t, document([profile]));
  const env = { TRACE_AGENT_PROFILES_FILE: file };
  const registry = createExecutorRegistry({ env, factories: { model: () => ({
    check: async () => ({ configured: true }),
    execute: async ({ signal }) => { await Promise.race([blocked, new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))]); return {
      raw: answer('late'), threadId: 'late', turnId: 'late', runtimeVersion: 'fixture', providedFragments: [] }; },
  }) } });
  const a = await fixture(t, { executorRegistry: registry, timeoutMs: 1000 });
  const before = a.webStore.read();
  const created = await a.request('/api/agent/runs', a.envelope({ profileId: 'mutable' }));
  for (let i = 0; i < 100 && a.service.get(created.json.run.runId).status !== 'running'; i++) await new Promise(resolve => setTimeout(resolve, 5));
  fs.writeFileSync(file, JSON.stringify(document([{ ...profile, version: 2 }])));
  const run = await a.wait(created.json.run.runId); release();
  assert.equal(run.status, 'stale'); assert.equal(run.error.code, 'PROFILE_CHANGED'); assert.equal(run.result, null);
  assert.deepEqual(a.webStore.read(), before);
});

test('profile schema rejects inline secrets, credential URLs, missing secret env and arbitrary remote HTTP', t => {
  const cases = [
    [{ id: 'bad', kind: 'model', version: 1, endpoint: 'https://model.invalid/v1', model: 'm', apiKey: 'inline' }],
    [{ id: 'bad', kind: 'agent', version: 1, endpoint: 'https://user:secret@agent.invalid/run' }],
    [{ id: 'bad', kind: 'agent', version: 1, endpoint: 'http://agent.invalid/run' }],
  ];
  for (const profiles of cases) {
    const registry = createExecutorRegistry({ env: { TRACE_AGENT_PROFILES_FILE: configFile(t, document(profiles)) } });
    assert.throws(() => registry.describe(), /profile|地址|HTTPS/i);
  }
  const file = configFile(t, document([{ id: 'missing', kind: 'model', version: 1, endpoint: 'https://model.invalid/v1', model: 'm', credentialEnv: 'MISSING_TOKEN' }]));
  const registry = createExecutorRegistry({ env: { TRACE_AGENT_PROFILES_FILE: file } });
  assert.throws(() => registry.bind('missing'), error => error.code === 'PROFILE_CREDENTIAL_UNAVAILABLE');
});
