import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, answer, output, chain } from './fixtures/agent-harness.mjs';
import { createAgentStore } from '../apps/agent/store.mjs';
import { assembleContext, callContextTool } from '../apps/agent/context.mjs';
import { validateOutput } from '../apps/agent/protocol.mjs';

test('HTTP run, durable SSE replay and result keep canonical product state byte-identical', async t => {
  const a = await fixture(t), before = a.webStore.read(), body = a.envelope();
  const created = await a.request('/api/agent/runs', body); assert.equal(created.status, 202);
  const id = created.json.run.runId, finished = await a.wait(id);
  assert.equal(finished.status, 'succeeded'); assert.equal(finished.usableAsCurrent, true); assert.equal(finished.result.adoption, 'not_applied');
  assert.deepEqual(a.webStore.read(), before); assert.equal(a.calls.length, 1);
  const events = await (await fetch(`${a.origin}/api/agent/runs/${id}/events`)).text();
  assert.match(events, /event: output.delta/); assert.match(events, /event: run.succeeded/); assert.doesNotMatch(events, /OLD_PRIVATE_SENTINEL/);
  const replayEvents = await (await fetch(`${a.origin}/api/agent/runs/${id}/events`, { headers: { 'Last-Event-ID': '2' } })).text();
  assert.doesNotMatch(replayEvents, /id: [12]\n/);
  const replay = await a.request('/api/agent/runs', body); assert.equal(replay.status, 200); assert.equal(replay.json.replay, true);
  assert.equal(replay.json.run.runId, id); assert.equal(a.calls.length, 1);
  assert.equal((await a.request(`/api/agent/requests/${encodeURIComponent(body.requestId)}`)).json.runId, id);
  assert.equal((await a.request('/api/agent/runs', { ...body, input: 'changed' })).json.error.code, 'REQUEST_CONFLICT');
});

test('fresh excludes old text; only explicit selection and same-epoch successful lineage can enter', async t => {
  const a = await fixture(t);
  const old = await a.request('/api/agent/runs', a.envelope()); await a.wait(old.json.run.runId);
  await a.command(chain('FRESH_CONTEXT'));
  const wrong = await a.request('/api/agent/runs', a.envelope({ previousRunId: old.json.run.runId })); assert.equal(wrong.json.error.code, 'HISTORY_SCOPE_MISMATCH');
  const first = await a.request('/api/agent/runs', a.envelope({ input: 'NEW_EPOCH_INPUT' })); await a.wait(first.json.run.runId);
  const fresh = a.calls.at(-1).context;
  assert.equal(fresh.fragments.length, 0); assert.ok(!JSON.stringify(fresh).includes('OLD_PRIVATE_SENTINEL'));
  assert.throws(() => callContextTool(fresh, 'trace_context_read', { id: 'matter:original' }), /片段不在/);
  assert.deepEqual(callContextTool(fresh, 'trace_context_search', { query: 'OLD_PRIVATE_SENTINEL' }).matches, []);
  const next = await a.request('/api/agent/runs', a.envelope({ previousRunId: first.json.run.runId })); await a.wait(next.json.run.runId);
  assert.ok(JSON.stringify(a.calls.at(-1).context).includes('NEW_EPOCH_INPUT'));
  assert.ok(!JSON.stringify(a.calls.at(-1).context).includes('OLD_PRIVATE_SENTINEL'));
});

test('stale mode, epoch, revision and cross-matter history rejected before invoking provider', async t => {
  const a = await fixture(t), base = a.envelope();
  assert.equal((await a.request('/api/agent/runs', { ...base, contextEpoch: 1 })).json.error.code, 'CONTEXT_CONFLICT');
  assert.equal((await a.request('/api/agent/runs', { ...base, contextMode: 'fresh' })).json.error.code, 'CONTEXT_CONFLICT');
  assert.equal((await a.request('/api/agent/runs', { ...base, expectedRevision: 0 })).json.error.code, 'REVISION_CONFLICT');
  assert.equal((await a.request('/api/agent/runs', { ...base, matterId: 'missing' })).status, 404);
  assert.equal(a.calls.length, 0);
  await a.command({ type: 'capture.create', matterId: 'other', text: 'other' });
  const run = await a.request('/api/agent/runs', a.envelope()); await a.wait(run.json.run.runId);
  assert.equal((await a.request('/api/agent/runs', a.envelope({ matterId: 'other', previousRunId: run.json.run.runId }))).json.error.code, 'HISTORY_SCOPE_MISMATCH');
});

test('selection validation and revision candidates bind to exact original; never auto-apply', async t => {
  const a = await fixture(t, { adapter: { execute: async () => output(answer('仅建议改这一处', { replacement: '另一种说法' })) } });
  const before = a.webStore.read();
  const invalid = await a.request('/api/agent/runs', a.envelope({ purpose: 'revise' })); assert.equal(invalid.json.error.code, 'SELECTION_REQUIRED');
  const selection = { field: 'understandingDraft', start: 0, end: 2, text: '我自' };
  assert.equal((await a.request('/api/agent/runs', a.envelope({ purpose: 'revise', selection: { ...selection, text: '错误' } }))).json.error.code, 'SELECTION_CONFLICT');
  // Cannot split the UTF-16 surrogate pair of the final emoji.
  assert.equal((await a.request('/api/agent/runs', a.envelope({ purpose: 'revise', selection: { field: 'understandingDraft', start: 6, end: 7, text: '\ud83d' } }))).json.error.code, 'SELECTION_CONFLICT');
  const run = await a.request('/api/agent/runs', a.envelope({ purpose: 'revise', selection })); const done = await a.wait(run.json.run.runId);
  assert.equal(done.status, 'succeeded'); assert.deepEqual(done.result.target.selection, selection);
  assert.equal(done.result.kind, 'revision_candidate'); assert.deepEqual(a.webStore.read(), before);
});

test('invalid outputs / fabricated citations fail closed without changing original', async t => {
  let response = answer('x', { citations: [{ contextId: 'missing', quote: 'fabricated' }] });
  const a = await fixture(t, { adapter: { execute: async () => output(response) } });
  const before = a.webStore.read();
  for (const [raw, code] of [[response, 'INVALID_CITATION'], ['not json', 'INVALID_OUTPUT'], [answer('x', { replacement: 'unsolicited replacement' }), 'INVALID_OUTPUT']]) {
    response = raw; const run = await a.request('/api/agent/runs', a.envelope()), done = await a.wait(run.json.run.runId);
    assert.equal(done.status, 'failed'); assert.equal(done.error.code, code); assert.equal(done.result, null);
  }
  assert.deepEqual(a.webStore.read(), before);
});

test('cancel is terminal and idempotent; late provider success cannot resurrect run', async t => {
  let finish; const started = new Promise(resolve => { finish = resolve; });
  const a = await fixture(t, { adapter: { execute: async ({ signal }) => { await started; assert.equal(signal.aborted, true); return output(answer('late')); } } });
  const run = await a.request('/api/agent/runs', a.envelope()), id = run.json.run.runId;
  const cancel = await a.request(`/api/agent/runs/${id}/cancel`, {}); assert.equal(cancel.json.status, 'cancelled');
  finish(); await delay(20);
  const after = await a.request(`/api/agent/runs/${id}/cancel`, {}); assert.equal(after.json.status, 'cancelled'); assert.equal(after.json.result, null);
  assert.equal(after.json.lastEventId, cancel.json.lastEventId);
});

test('workspace change stops in-flight request; prior completed results report unusable', async t => {
  let finish; const gate = new Promise(resolve => { finish = resolve; });
  const a = await fixture(t, { adapter: { execute: async () => { await gate; return output(answer('old')); } } });
  t.after(() => finish());
  const run = await a.request('/api/agent/runs', a.envelope());
  await a.command(chain('FRESH_CONTEXT'));
  const stale = await a.wait(run.json.run.runId); assert.equal(stale.status, 'stale'); assert.equal(stale.result, null);
  finish(); await delay(20);
  assert.equal(a.service.get(run.json.run.runId).status, 'stale');
});

test('concurrency, timeout and privacy-safe adapter error behavior', async t => {
  const a = await fixture(t, { timeoutMs: 40, adapter: { execute: async ({ signal }) => {
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); throw new Error('SECRET_API_KEY in unsafe provider error');
  } } });
  const first = await a.request('/api/agent/runs', a.envelope());
  assert.equal((await a.request('/api/agent/runs', a.envelope())).status, 429);
  const done = await a.wait(first.json.run.runId); assert.equal(done.status, 'timed_out'); assert.ok(!JSON.stringify(done).includes('SECRET'));
});

test('same-origin boundary, strict schema, content type, bounded body and cursor validation', async t => {
  const a = await fixture(t);
  for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }, { host: 'evil.example' }, { 'sec-fetch-site': 'cross-site' }])
    assert.equal((await a.request('/api/agent/runs', a.envelope(), headers)).status, 403, JSON.stringify(headers));
  assert.equal((await a.request('/api/agent/runs', a.envelope(), { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await a.request('/api/agent/runs', 'x'.repeat(100000))).status, 413);
  assert.equal((await a.request('/api/agent/runs', '{bad')).status, 400);
  for (const extra of [{ cwd: '/' }, { model: 'other' }, { provider: 'http://evil' }, { token: 'x' }, { autoApply: true }, { input: 'a'.repeat(16001) }])
    assert.equal((await a.request('/api/agent/runs', a.envelope(extra))).status, 400);
  assert.equal(a.calls.length, 0);
  const run = await a.request('/api/agent/runs', a.envelope()); await a.wait(run.json.run.runId);
  assert.equal((await a.request(`/api/agent/runs/${run.json.run.runId}/events?after=99999`)).status, 400);
  assert.equal((await a.request('/api/agent/capabilities')).json.autoApply, false);
});

test('Agent ledger rejects another writer, persists receipts and marks crash leftovers interrupted on reopen', async t => {
  const a = await fixture(t), body = a.envelope(), context = assembleContext(a.webStore.read(), body);
  assert.throws(() => createAgentStore({ file: a.agentStore.file, workspaceKey: 'fixture-workspace' }), /占用/);
  const queued = a.agentStore.create(body, context), file = a.agentStore.file;
  await a.close();
  const reopened = createAgentStore({ file, workspaceKey: 'fixture-workspace' });
  try {
    const recovered = reopened.find(body.requestId); assert.equal(recovered.id, queued.id); assert.equal(recovered.status, 'interrupted');
    assert.equal(recovered.error.code, 'PROCESS_RESTARTED'); assert.equal(reopened.events(queued.id).at(-1).type, 'run.interrupted');
  } finally { reopened.close(); }
  assert.throws(() => createAgentStore({ file, workspaceKey: 'different-workspace' }), /不同工作区/);
});

test('explicit source authorization, size budget, quotes and fresh selection are enforced in context tools', async t => {
  const a = await fixture(t), snapshot = a.webStore.read();
  const host = snapshot.host;
  host.chain.sources.push({ id: 'source-allowed', ownerMatterId: 'm', excerpt: '可引用的现场', status: 'active', url: 'https://user:secret@private.invalid' },
    { id: 'source-other', ownerMatterId: 'other', excerpt: '别人的文字' });
  host.chain.sessions.m.contextMode = 'fresh';
  const request = a.envelope({ contextMode: 'fresh', sourceIds: ['source-allowed'] });
  const context = assembleContext(snapshot, request);
  assert.ok(!JSON.stringify(context).includes('secret')); assert.ok(!JSON.stringify(context).includes('OLD_PRIVATE_SENTINEL'));
  assert.equal(callContextTool(context, 'trace_context_read', { id: 'source:source-allowed' }).text, '可引用的现场');
  assert.throws(() => assembleContext(snapshot, { ...request, sourceIds: ['source-other'] }), /不属于/);
  host.chain.sources[0].status = 'revoked';
  assert.throws(() => assembleContext(snapshot, request), /不属于/);
  assert.throws(() => callContextTool(context, 'shell', {}), /工具/);
  assert.equal(validateOutput(answer('有证据', { citations: [{ contextId: 'source:source-allowed', quote: '现场' }] }), context, request).citations.length, 1);
  assert.throws(() => validateOutput(answer('假引文', { citations: [{ contextId: 'source:source-allowed', quote: '并不存在' }] }), context, request), /引用必须/);
});

test('citations cannot quote an allowed-but-unread fragment or unseen part of a search excerpt', async t => {
  let delivery = [];
  const a = await fixture(t, { adapter: { execute: async () => ({ ...output(answer('有引用', {
    citations: [{ contextId: 'matter:original', quote: 'OLD_PRIVATE_SENTINEL' }] })), providedFragments: delivery }) } });
  for (const fragments of [[], [{ id: 'matter:original', text: '原先的表达' }]]) {
    delivery = fragments; const created = await a.request('/api/agent/runs', a.envelope()), run = await a.wait(created.json.run.runId);
    assert.equal(run.status, 'failed'); assert.equal(run.error.code, 'INVALID_CITATION');
  }
  delivery = [{ id: 'matter:original', text: 'OLD_PRIVATE_SENTINEL 原先的表达' }];
  const created = await a.request('/api/agent/runs', a.envelope()); assert.equal((await a.wait(created.json.run.runId)).status, 'succeeded');
});

test('event persistence failure still aborts the owned provider and stops accepting new work', async t => {
  let signal, started;
  const ready = new Promise(resolve => { started = resolve; });
  const a = await fixture(t, { adapter: { execute: async args => {
    signal = args.signal; started(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); throw new Error('provider stopped');
  } } });
  const run = await a.request('/api/agent/runs', a.envelope()); await ready;
  const update = a.agentStore.update;
  try {
    a.agentStore.update = () => { throw new Error('simulated disk write failure'); };
    assert.equal((await a.request(`/api/agent/runs/${run.json.run.runId}/cancel`, {})).status, 503);
    assert.equal(signal.aborted, true); await delay(10);
    assert.equal((await a.request(`/api/agent/runs/${run.json.run.runId}`)).json.error.code, 'AGENT_STORAGE_UNAVAILABLE');
    assert.equal((await a.request('/api/agent/runs', a.envelope())).json.error.code, 'AGENT_STORAGE_UNAVAILABLE');
  } finally { a.agentStore.update = update; }
});
