import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAgentBackend } from '../apps/agent/backend.mjs';

test('disabled backend does not access product storage or launch Codex', async () => {
  const webStore = new Proxy({}, { get() { throw new Error('must not read storage while disabled'); } });
  const backend = createAgentBackend({ webStore, env: {} }); await backend.close();
});

test('real Web server mounts backend without changing page; missing CLI fails safely in separate run ledger', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-agent-server-'));
  const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [fileURLToPath(new URL('../apps/desktop/server.mjs', import.meta.url))], {
    env: { ...process.env, TRACE_DESKTOP_PORT: String(port), TRACE_WEB_STATE_FILE: path.join(root, 'web.sqlite'), TRACE_AGENT_ENABLED: '1',
      TRACE_AGENT_STATE_FILE: path.join(root, 'agent.sqlite'), TRACE_CODEX_BIN: path.join(root, 'does-not-exist-codex'), TRACE_AGENT_RUNTIME_ROOT: path.join(root, 'scratch') },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  let diagnostic = ''; child.stdout.on('data', p => { diagnostic += p; }); child.stderr.on('data', p => { diagnostic += p; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'close'); child.kill(); await stopped; }
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('trace-agent-server-'));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin + '/api/agent/capabilities')).ok) { ready = true; break; } } catch {}
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(ready, true, diagnostic);
  const page = await (await fetch(origin)).text();
  assert.equal(page, fs.readFileSync(fileURLToPath(new URL('../apps/desktop/index.html', import.meta.url)), 'utf8'));
  assert.equal((await fetch(origin + '/agent/codex.mjs')).status, 404);
  const post = async (url, data) => { const r = await fetch(origin + url, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(data) }); return { status: r.status, body: await r.json() }; };
  const check = await post('/api/agent/check', {}); assert.equal(check.status, 503); assert.equal(check.body.error.code, 'CODEX_UNAVAILABLE');
  assert.equal((await post('/api/product/commands', { protocolVersion: 1, commandId: 'seed', expectedRevision: 0, operations: [{ type: 'capture.create', matterId: 'm', text: '只有这个合成表达' }] })).status, 200);
  const before = await (await fetch(origin + '/api/product/workspace')).json();
  const created = await post('/api/agent/runs', { protocolVersion: 1, requestId: 'real-server-request', expectedRevision: 1, matterId: 'm',
    contextMode: 'resume', contextEpoch: 0, purpose: 'discuss', input: '不应改变正文' }); assert.equal(created.status, 202);
  let run;
  for (let i = 0; i < 100; i++) {
    run = await (await fetch(origin + '/api/agent/runs/' + created.body.run.runId)).json();
    if (run.status === 'failed') break; await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(run.status, 'failed'); assert.equal(run.error.code, 'CODEX_UNAVAILABLE');
  assert.deepEqual(await (await fetch(origin + '/api/product/workspace')).json(), before);
  assert.equal(fs.existsSync(path.join(root, 'agent.sqlite')), true);
});
