import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configuration, checkPort } from '../scripts/start-local.mjs';

const entry = fileURLToPath(new URL('../scripts/start-local.mjs', import.meta.url));
const defaultState = fileURLToPath(new URL('../../.trace/state/web.sqlite', import.meta.url));
function isolated(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-local-entry-'));
  t.after(() => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('trace-local-entry-'));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return dir;
}
async function reserve() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return server;
}
test('default matches existing Web storage and does not enable Agent', () => {
  assert.deepEqual(configuration([], {}), { port: 4173, state: defaultState, agent: false, check: false });
});
test('explicit overrides work without altering environment', () => {
  const env = { TRACE_WEB_STATE_FILE: defaultState, TRACE_DESKTOP_PORT: '4181', TRACE_AGENT_ENABLED: '0' };
  const original = { ...env };
  assert.deepEqual(configuration(['--agent', '--check'], env), { port: 4181, state: defaultState, agent: true, check: true });
  assert.deepEqual(env, original);
  assert.equal(configuration([], { TRACE_AGENT_ENABLED: '1' }).agent, true);
});
test('invalid config fails instead of switching port or selecting another database', () => {
  for (const port of ['', '0', '65536', 'NaN', '4173.5', ' 4173']) assert.throws(() => configuration([], { TRACE_DESKTOP_PORT: port }));
  assert.throws(() => configuration([], { TRACE_WEB_STATE_FILE: 'relative/web.sqlite' }));
  assert.throws(() => configuration([], { TRACE_AGENT_ENABLED: 'yes' }));
  assert.throws(() => configuration(['--agents'], {}));
  assert.throws(() => configuration([], {}, '22.12.0'));
  assert.throws(() => configuration([], {}, '20.19.0'));
});
test('help is available without loading database or validating server config', () => {
  const result = spawnSync(process.execPath, [entry, '--help', '--agent'], { encoding: 'utf8', env: { ...process.env, TRACE_DESKTOP_PORT: 'invalid' }, windowsHide: true });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /npm start -- --agent/);
  assert.doesNotMatch(result.stderr, /SQLite/);
});
test('occupied port check preserves the existing listener', async () => {
  const server = await reserve();
  try { await assert.rejects(checkPort(server.address().port), /已占用/); assert.equal(server.listening, true); }
  finally { await new Promise(resolve => server.close(resolve)); }
});
test('check mode creates no files and never starts Codex even when enabled', async t => {
  const dir = isolated(t); const server = await reserve(); const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const result = spawnSync(process.execPath, [entry, '--agent', '--check'], { encoding: 'utf8', windowsHide: true,
    env: { ...process.env, TRACE_DESKTOP_PORT: String(port), TRACE_AGENT_ENABLED: '0', TRACE_WEB_STATE_FILE: path.join(dir, 'new', 'web.sqlite'), TRACE_CODEX_BIN: path.join(dir, 'missing') } });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /未检查数据库/);
  assert.deepEqual(fs.readdirSync(dir), []);
});
test('new entry starts the real host on isolated storage without changing the page', async t => {
  const dir = isolated(t); const server = await reserve(); const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const child = spawn(process.execPath, [entry, '--agent'], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TRACE_DESKTOP_PORT: String(port), TRACE_WEB_STATE_FILE: path.join(dir, 'web.sqlite'),
      TRACE_AGENT_STATE_FILE: path.join(dir, 'agent.sqlite'), TRACE_AGENT_ENABLED: '0', TRACE_CODEX_BIN: path.join(dir, 'missing') } });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (output.includes('Trace Web:')) { ready = true; break; }
      if (child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(ready, true, output);
    const origin = `http://127.0.0.1:${port}`;
    const capabilities = await (await fetch(`${origin}/api/agent/capabilities`)).json();
    assert.equal(capabilities.enabled, true); assert.equal(capabilities.authenticationChecked, false);
    assert.equal(await (await fetch(origin)).text(), fs.readFileSync(new URL('../apps/desktop/index.html', import.meta.url), 'utf8'));
    const check = await fetch(`${origin}/api/agent/check`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(check.status, 503); assert.equal((await check.json()).error.code, 'CODEX_UNAVAILABLE');
    assert.ok(fs.existsSync(path.join(dir, 'web.sqlite'))); assert.ok(fs.existsSync(path.join(dir, 'agent.sqlite')));
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'close'); child.kill(); await stopped; }
  }
});
