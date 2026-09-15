import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexConnection, BOUNDED_CONFIG } from '../apps/agent/codex.mjs';
import { hash } from '../apps/agent/protocol.mjs';

function fixture(t, timeout = 1000) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.exitCode = null; child.signalCode = null; child.kill = () => { child.signalCode = 'SIGTERM'; queueMicrotask(() => child.emit('close')); };
  child.stdin.on('finish', () => { child.exitCode = 0; queueMicrotask(() => child.emit('close')); });
  const sent = []; child.stdin.on('data', b => sent.push(...b.toString().trim().split('\n').map(JSON.parse)));
  const connection = new CodexConnection({ executable: 'fixture', cwd: 'fixture', env: {}, config: BOUNDED_CONFIG, rpcTimeoutMs: timeout,
    spawnProcess: (file, args, options) => { assert.equal(options.shell, false); assert.equal(options.windowsHide, true); assert.deepEqual(args.slice(0, 2), ['app-server', '--stdio']); return child; } });
  t.after(() => connection.close());
  return { connection, child, sent, receive: x => child.stdout.write(JSON.stringify(x) + '\n') };
}

test('JSON-RPC handles interleaved notifications, out-of-order replies and Unicode split across byte chunks', async t => {
  const a = fixture(t), events = [];
  a.connection.onNotification = (method, p) => events.push({ method, p });
  const p1 = a.connection.rpc('one', {}), p2 = a.connection.rpc('two', {});
  a.receive({ id: 2, result: { two: true } });
  const buffer = Buffer.from(JSON.stringify({ method: 'delta', params: { text: '中文🙂' } }) + '\n');
  for (let i = 0; i < buffer.length; i++) a.child.stdout.write(buffer.subarray(i, i + 1));
  a.receive({ id: 1, result: { one: true } });
  assert.deepEqual(await p1, { one: true }); assert.deepEqual(await p2, { two: true }); assert.equal(events[0].p.text, '中文🙂');
});

test('server requests are answered or denied without blocking the RPC stream or leaking errors', async t => {
  const a = fixture(t);
  a.connection.onRequest = async method => { if (method === 'known') return { success: true }; throw new Error('PRIVATE_SECRET'); };
  a.receive({ id: 'server1', method: 'known', params: {} }); a.receive({ id: 'server2', method: 'unknown', params: {} });
  await delay(0);
  assert.equal(a.sent[0].result.success, true); assert.equal(a.sent[1].error.code, -32601); assert.ok(!JSON.stringify(a.sent).includes('PRIVATE_SECRET'));
});

test('timeouts and provider errors are sanitized; malformed frames and process exit reject pending work', async t => {
  const a = fixture(t, 10);
  await assert.rejects(a.connection.rpc('timeout', {}), { code: 'CODEX_RPC_TIMEOUT' });
  const failed = a.connection.rpc('fail', {}); a.receive({ id: 2, error: { code: 500, message: 'SECRET_TOKEN' } });
  await assert.rejects(failed, e => e.code === 'CODEX_RPC_ERROR' && !e.message.includes('SECRET'));
  const malformed = a.connection.rpc('malformed', {}); a.child.stdout.write('{broken\n');
  await assert.rejects(malformed, { code: 'CODEX_PROTOCOL_ERROR' });
  const b = fixture(t), pending = b.connection.rpc('waiting', {}); b.child.emit('close');
  await assert.rejects(pending, { code: 'CODEX_DISCONNECTED' });
});

test('oversized frames terminate only the owned transport', async t => {
  const a = fixture(t), p = a.connection.rpc('waiting', {}); a.child.stdout.write('x'.repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(p, { code: 'CODEX_FRAME_TOO_LARGE' }); assert.equal(a.child.signalCode, 'SIGTERM');
});

test('valid JSON that is not an RPC object fails without an uncaught stream exception', async t => {
  for (const value of [null, [], 'text', 7, {}]) {
    const a = fixture(t), pending = a.connection.rpc('waiting', {}); a.receive(value);
    await assert.rejects(pending, { code: 'CODEX_PROTOCOL_ERROR' });
  }
});

test('record hashes remain stable across JSON persistence of optional metadata', () => {
  const value = { runtime: { model: undefined, threadId: 't' }, optional: undefined, values: [undefined, 'x'] };
  assert.equal(hash(value), hash(JSON.parse(JSON.stringify(value))));
});
