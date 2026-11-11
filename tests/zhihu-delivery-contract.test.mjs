import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createZhihuBackend } from '../apps/agent/zhihu.mjs';

async function serve(t, backend) {
  const server = http.createServer(async (req, res) => {
    if (!await backend.handle(req, res) && !res.headersSent) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    backend.close();
    await new Promise(resolve => server.close(resolve));
  });
  return { origin };
}

async function request(origin, route, body) {
  const response = await fetch(origin + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(body === undefined ? {} : { origin }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, body: await response.json() };
}

test('disabled Zhihu keeps structured status/capabilities and feature-disabled search errors', async t => {
  const backend = createZhihuBackend({ TRACE_ZHIHU_ENABLED: '0' });
  const { origin } = await serve(t, backend);

  const status = await request(origin, '/api/zhihu/status');
  assert.equal(status.response.status, 200);
  assert.equal(status.body.enabled, false);
  assert.equal(status.body.reason, 'disabled');
  assert.equal(status.body.search_configured, false);
  assert.equal(status.body.credentials_exposed, false);

  const capabilities = await request(origin, '/api/search/capabilities');
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.body.enabled, false);
  assert.equal(capabilities.body.reason, 'disabled');
  assert.deepEqual(capabilities.body.sources, {
    zhihu: { route: '/api/search/zhihu', enabled: false },
    global: { route: '/api/search/global', enabled: false },
  });
  assert.doesNotMatch(JSON.stringify({ status: status.body, capabilities: capabilities.body }), /access[_-]?secret|app[_-]?key|token/i);

  for (const route of ['/api/search/zhihu', '/api/search/global']) {
    const result = await request(origin, route, { query: 'disabled contract' });
    assert.equal(result.response.status, 503);
    assert.equal(result.body.error.code, 'FEATURE_DISABLED');
    assert.equal(result.body.error.reason, 'disabled');
  }
});

test('enabled without a credential remains structured and fails closed without upstream I/O', async t => {
  const backend = createZhihuBackend({ TRACE_ZHIHU_ENABLED: '1', ZHIHU_ACCESS_SECRET: '' });
  const { origin } = await serve(t, backend);
  const status = await request(origin, '/api/zhihu/status');
  assert.equal(status.response.status, 200);
  assert.equal(status.body.enabled, true);
  assert.equal(status.body.search_configured, false);
  assert.equal(status.body.credentials_exposed, false);
  assert.doesNotMatch(JSON.stringify(status.body), /access[_-]?secret|app[_-]?key|token/i);

  const result = await request(origin, '/api/search/zhihu', { query: 'no credential' });
  assert.equal(result.response.status, 401);
  assert.equal(result.body.error.code, 'AUTH_REQUIRED');
});

test('enabled fixture exposes the same structured contract and bounded search result', async t => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.origin !== 'https://developer.zhihu.com') return previousFetch(input, options);
    return Response.json({Code: 0, Data: {Items: [{Title: 'fixture result', ContentText: 'fixture summary', Url: 'https://www.zhihu.com/question/1'}]}});
  };
  const backend = createZhihuBackend({ TRACE_ZHIHU_ENABLED: '1', ZHIHU_ACCESS_SECRET: 'fixture-only' });
  const { origin } = await serve(t, backend);
  t.after(() => { globalThis.fetch = previousFetch; });

  const status = await request(origin, '/api/zhihu/status');
  assert.equal(status.response.status, 200);
  assert.equal(status.body.enabled, true);
  assert.equal(status.body.search_configured, true);
  assert.equal(status.body.credentials_exposed, false);
  assert.doesNotMatch(JSON.stringify(status.body), /fixture-only|access[_-]?secret|app[_-]?key|token/i);
  const capabilities = await request(origin, '/api/search/capabilities');
  assert.equal(capabilities.body.enabled, true);
  assert.equal(capabilities.body.sources.zhihu.enabled, true);
  const result = await request(origin, '/api/search/zhihu', { query: 'fixture contract', count: 1 });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.source, 'zhihu');
  assert.equal(result.body.items.length, 1);
});
