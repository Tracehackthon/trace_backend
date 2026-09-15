import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, answer, output, chain} from './fixtures/agent-harness.mjs';
import {createRetrievalSession} from '../apps/agent/retrieval.mjs';
import {validateRequest} from '../apps/agent/protocol.mjs';
import {ZhihuProvider} from '../dist/packages/integration/zhihu-transport/src/provider.js';

const provider = () => new ZhihuProvider({access_secret: 'fixture-only', fetch_impl: async () => Response.json({Code: 0, Data: {Items: [{Title: '来自接口', ContentText: '可核验的来源摘要', Url: 'https://www.zhihu.com/question/1/answer/2'}]}})});

test('Agent request: explicit retrieval only, unavailable before model, credentials/custom URLs rejected', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/agent/runs', f.envelope({retrieval: {sources: ['zhihu']}}))).status, 503); assert.equal(f.calls.length, 0);
  for (const retrieval of [{sources: []}, {sources: ['zhihu', 'zhihu']}, {sources: ['files']}, {sources: ['global'], secret: 'x'}])
    assert.throws(() => validateRequest(f.envelope({retrieval})), e => e.code === 'INVALID_RETRIEVAL');
  const created = f.service.create(f.envelope()), result = await f.wait(created.run.runId);
  assert.equal(result.status, 'succeeded'); assert.deepEqual(f.calls[0].retrieval.tools, []); assert.equal(f.calls[0].context.externalRetrieval, 'disabled');
});

test('Agent search -> actual source registry -> quote validation -> host-authored sources in persisted result', async t => {
  const p = provider(); t.after(() => p.close());
  const adapter = {execute: async ({retrieval, context}) => {
    assert.deepEqual(context.externalRetrieval.sources, ['zhihu']);
    assert.deepEqual(retrieval.tools.map(x => x.name), ['trace_zhihu_search']);
    const result = await retrieval.call('trace_zhihu_search', {query: '经验', count: 1});
    return {...output(answer('找到一条摘要。', {citations: [{contextId: result.items[0].id, quote: result.items[0].excerpt}]})),
      sources: [{id: 'model-forged', url: 'https://evil.invalid'}]};
  }};
  const f = await fixture(t, {adapter, retrievalProvider: p});
  const caps = await f.request('/api/agent/capabilities'); assert.equal(caps.json.externalRetrieval, true);
  const created = f.service.create(f.envelope({retrieval: {sources: ['zhihu']}})), result = await f.wait(created.run.runId);
  assert.equal(result.status, 'succeeded'); assert.equal(result.result.sources.length, 1);
  assert.equal(result.result.sources[0].url, 'https://www.zhihu.com/question/1/answer/2'); assert.equal(result.result.sources[0].excerpt, result.result.citations[0].quote);
  assert.ok(!JSON.stringify(result.result).includes('model-forged')); assert.equal(result.canonicalStateChanged, false);
  assert.deepEqual(f.agentStore.get(result.runId).result.sources, result.result.sources);
});

test('Agent: forged citations fail, fresh run stays empty until its opted-in search, source permission is hashed', async t => {
  const p = provider(); t.after(() => p.close());
  const adapter = {execute: async ({context}) => {
    assert.equal(context.fragments.length, 0);
    return {...output(answer('forged', {citations: [{contextId: 'external:invented', quote: 'not delivered'}]})), providedFragments: [{id: 'external:invented', text: 'not delivered'}]};
  }};
  const f = await fixture(t, {adapter, retrievalProvider: p}); await f.command(chain('FRESH_CONTEXT'));
  const request = f.envelope({retrieval: {sources: ['global']}}), first = f.service.create(request);
  assert.equal((await f.wait(first.run.runId)).error.code, 'INVALID_CITATION');
  const second = f.service.create(f.envelope({retrieval: {sources: ['zhihu']}}));
  assert.notEqual(second.run.contextHash, first.run.contextHash); await f.wait(second.run.runId);
});

test('retrieval capability: three-call budget, denied sources, cancelled late response cannot become evidence', async () => {
  let count = 0; const p = provider(), controller = new AbortController();
  const session = createRetrievalSession({provider: {search: async (...args) => {count++; return p.search(...args);}}, sources: ['zhihu'], signal: controller.signal});
  await assert.rejects(session.call('trace_global_search', {query: 'x'}), e => e.code === 'RETRIEVAL_NOT_ALLOWED');
  for (let i = 0; i < 3; i++) await session.call('trace_zhihu_search', {query: 'x'});
  await assert.rejects(session.call('trace_zhihu_search', {query: 'x'}), e => e.code === 'RETRIEVAL_BUDGET'); assert.equal(count, 3);
  let release;
  const late = createRetrievalSession({provider: {search: () => new Promise(r => {release = r;})}, sources: ['zhihu'], signal: controller.signal});
  const work = late.call('trace_zhihu_search', {query: 'x'}); controller.abort(); release({items: [{id: 'late', excerpt: 'late'}]});
  await assert.rejects(work, e => e.code === 'STALE_CONTEXT'); assert.deepEqual(late.evidence(), []); p.close();
});
