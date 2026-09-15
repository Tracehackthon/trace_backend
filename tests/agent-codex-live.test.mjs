import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCodexAdapter } from '../apps/agent/codex.mjs';
import { fixture, chain } from './fixtures/agent-harness.mjs';
import { TERMINAL } from '../apps/agent/protocol.mjs';

// Explicit opt-in: authenticates using the local Codex login and consumes model
// usage. Only synthetic fixture content is sent; never the user's product DB.
test('LIVE: HTTP -> real Codex -> scoped tool -> structured candidate; fresh is a new isolated thread',
  { skip: process.env.TRACE_AGENT_LIVE !== '1', timeout: 420000 }, async t => {
    const adapter = createCodexAdapter(), check = await adapter.check();
    assert.equal(check.authenticated, true, 'Run codex login first');
    const a = await fixture(t, { adapter, timeoutMs: 180000 }), sentinel = `TRACE_SENTINEL_${randomUUID()}`;
    await a.command({ type: 'capture.create', matterId: 'synthetic-live', text: sentinel });
    const before = a.webStore.read();
    async function finish(id) {
      for (let i = 0; i < 190; i++) { const r = a.service.get(id); if (TERMINAL.has(r.status)) return r; await new Promise(resolve => setTimeout(resolve, 1000)); }
      throw new Error('Live run did not terminate');
    }
    const first = await a.request('/api/agent/runs', a.envelope({ matterId: 'synthetic-live',
      input: '请先调用 trace_context_read 读取 matter:original。把所读的原始表达逐字放进 answer，并在 citations 引用这个片段；不要执行其他操作。' }));
    assert.equal(first.status, 202, JSON.stringify(first));
    const r1 = await finish(first.json.run.runId);
    t.diagnostic(JSON.stringify({ phase: 'resume', status: r1.status, error: r1.error, runtime: r1.runtime, result: r1.result,
      toolEvents: a.service.events(r1.runId, 0).filter(e => e.type === 'tool.completed') }));
    assert.equal(r1.status, 'succeeded'); assert.ok(r1.result.answer.includes(sentinel));
    assert.ok(a.service.events(r1.runId, 0).some(e => e.type === 'tool.completed' && e.data.tool === 'trace_context_read' && e.data.success));
    assert.deepEqual(a.webStore.read(), before);
    await a.command(chain('FRESH_CONTEXT', {}, 'synthetic-live'));
    const freshSnapshot = a.webStore.read(), s = freshSnapshot.host.chain.sessions['synthetic-live'];
    const second = await a.request('/api/agent/runs', a.envelope({ matterId: 'synthetic-live', contextMode: s.contextMode, contextEpoch: s.contextEpoch,
      input: '先调用 trace_context_read 尝试读取 matter:original。如果本次上下文没有提供，明确说明没有提供旧表达，不要猜测，不要调用其他读取工具。replacement 为 null，citations 为空。' }));
    assert.equal(second.status, 202, JSON.stringify(second));
    const r2 = await finish(second.json.run.runId);
    t.diagnostic(JSON.stringify({ phase: 'fresh', status: r2.status, error: r2.error, runtime: r2.runtime, answer: r2.result?.answer }));
    assert.equal(r2.status, 'succeeded'); assert.ok(!JSON.stringify(r2.result).includes(sentinel));
    assert.equal(r2.contextManifest.length, 0); assert.notEqual(r1.runtime.threadId, r2.runtime.threadId);
    assert.ok(a.service.events(r2.runId, 0).some(e => e.type === 'tool.completed' && e.data.success === false));
    assert.deepEqual(a.webStore.read(), freshSnapshot);
  });
