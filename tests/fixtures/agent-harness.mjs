import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createWebStore } from '../../apps/desktop/web-store.mjs';
import { createAgentStore } from '../../apps/agent/store.mjs';
import { createAgentService } from '../../apps/agent/service.mjs';
import { createAgentHttp } from '../../apps/agent/http.mjs';
import { TERMINAL } from '../../apps/agent/protocol.mjs';

export const answer = (value = '这是基于本次材料的回答。', extra = {}) => JSON.stringify({ answer: value, replacement: null, citations: [], uncertainties: [], ...extra });
export const output = raw => ({ raw, threadId: 'fixture-thread', turnId: 'fixture-turn', runtimeVersion: 'fixture-not-codex' });
export const chain = (type, fields = {}, matterId = 'm') => ({ type: 'chain.action', matterId, action: { type, ...fields } });
export async function fixture(t, { adapter, executorRegistry, timeoutMs = 1000, retrievalProvider } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-agent-test-'));
  const webStore = createWebStore({ file: path.join(root, 'web.sqlite') });
  const agentStore = createAgentStore({ file: path.join(root, 'agent.sqlite'), workspaceKey: 'fixture-workspace' });
  const calls = [];
  adapter ??= { check: async () => ({ authenticated: true, modelTurnTested: false }), execute: async args => {
    calls.push(args); args.onEvent('output.delta', { delta: '{"answer":', format: 'json-fragment', itemId: 'fixture-message' }); return output(answer());
  } };
  const service = createAgentService({ store: agentStore, readWorkspace: webStore.read, adapter, executorRegistry, timeoutMs, pollMs: 10, retrievalProvider });
  const agent = createAgentHttp({ service });
  const server = http.createServer(async (req, res) => {
    if (await agent.handle(req, res)) return;
    if (await webStore.handle(req, res)) return;
    res.writeHead(404); res.end('{}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    const stopped = new Promise(resolve => server.close(resolve)); await agent.close(); server.closeAllConnections(); await stopped; webStore.close();
  };
  t.after(async () => {
    await close(); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('trace-agent-test-'));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const request = async (route, body, headers = {}) => {
    if (headers.host) return new Promise((resolve, reject) => {
      const req = http.request(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { origin, 'content-type': 'application/json', ...headers } }, res => {
        let content = ''; res.setEncoding('utf8'); res.on('data', chunk => { content += chunk; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(content) }));
      }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
    const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { origin, 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    return { status: response.status, json: await response.json() };
  };
  const command = async operations => {
    const r = await request('/api/product/commands', { protocolVersion: 1, commandId: randomUUID(), expectedRevision: webStore.read().revision, operations: Array.isArray(operations) ? operations : [operations] });
    assert.equal(r.status, 200, JSON.stringify(r)); return r.json;
  };
  await command([{ type: 'capture.create', matterId: 'm', text: 'OLD_PRIVATE_SENTINEL 原先的表达' }, chain('UNDERSTANDING_DRAFT', { text: '我自己的理解🙂' }), chain('SAVE_UNDERSTANDING')]);
  const envelope = (extra = {}) => {
    const snap = webStore.read(), session = snap.host.chain.sessions.m;
    return { protocolVersion: 1, requestId: randomUUID(), matterId: 'm', expectedRevision: snap.revision, contextMode: session.contextMode,
      contextEpoch: session.contextEpoch, purpose: 'discuss', input: '本次问题', ...extra };
  };
  const wait = async id => {
    for (let i = 0; i < 500; i++) { const run = service.get(id); if (TERMINAL.has(run.status)) return run; await new Promise(resolve => setTimeout(resolve, 10)); }
    throw new Error('fixture run timeout');
  };
  return { root, origin, request, command, envelope, wait, calls, service, agentStore, webStore, close };
}
