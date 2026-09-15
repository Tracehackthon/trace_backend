import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createHash, randomBytes} from 'node:crypto';
import {ZhihuHttpTransport} from '../dist/packages/integration/zhihu-transport/src/index.js';
import {ZhihuProvider} from '../dist/packages/integration/zhihu-transport/src/provider.js';
import {ZhihuOAuthSession} from '../dist/packages/integration/zhihu-transport/src/oauth.js';
import {createZhihuHttp} from '../dist/packages/integration/zhihu-transport/src/http.js';
import {createZhihuOAuthRelay} from '../dist/packages/integration/zhihu-transport/src/relay.js';
import {normalizeItems} from '../dist/packages/integration/zhihu-transport/src/normalize.js';
import {Client} from '../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const response = Data => Response.json({Code: 0, Data});
const item = {Title: '真实响应 fixture', ContentText: '这是<em>摘要</em>，不是全文。', AuthorName: '测试作者', Url: 'https://www.zhihu.com/question/1/answer/2?utm_source=trace'};
const profile = {platform_base_url: 'https://developer.zhihu.com', hackathon_base_url: 'https://api.zhihu.com', access_secret_env: 'ZHIHU_TEST_ONLY', access_secret: 'fixture-access', timeout_ms: 1000};
const oauthConfig = {app_id: '669', app_key: 'fixture-app-key', redirect_uri: 'http://127.0.0.1:4173/callback'};
const tokenResponse = () => Response.json({code: 20000, data: {access_token: 'fixture-user-token', expires_in: 3600}});
const errorCode = code => error => error.code === code;
async function localAuthorize(oauth) {
  const start = await oauth.start('http://127.0.0.1:4173');
  const connection = oauth.connect(new URL(start.login_url).searchParams.get('ticket'));
  const state = new URL(connection.url).searchParams.get('state');
  await oauth.complete(new URLSearchParams({state, authorization_code: 'fixture-code'}), connection.cookie);
}
async function serve(t, middleware) {
  const server = http.createServer(async (req, res) => {if (!await middleware.handle(req, res)) {res.writeHead(404); res.end();}});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {middleware.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));});
  return `http://127.0.0.1:${server.address().port}`;
}

test('transport: correct user params, lossless pagination, public/user credential separation', async () => {
  const calls = [], transport = new ZhihuHttpTransport({...profile, oauth_token: 'fixture-user', fetch_impl: async (url, options) => {
    calls.push({url: new URL(url), options}); return response({Items: []});
  }});
  await transport.search('中文 & 条件', 2); await transport.globalSearch('证据', 3, 'host=="example.com"', 'realtime');
  await transport.userContents('9007199254740993', 4); await transport.favlistContents('9007199254740995', '0', 3); await transport.favlists(0, 2);
  assert.equal(calls[0].url.searchParams.get('Query'), '中文 & 条件');
  assert.equal(calls[1].url.searchParams.get('SearchDB'), 'realtime');
  assert.equal(calls[2].url.searchParams.get('ContentType'), 'all'); assert.equal(calls[2].url.searchParams.get('Offset'), '9007199254740993');
  assert.equal(calls[3].url.searchParams.get('FavlistUrlToken'), '9007199254740995'); assert.equal(calls[3].url.searchParams.has('FavlistID'), false);
  assert.equal(calls[4].url.searchParams.has('Offset'), false);
  for (const [i, c] of calls.entries()) {
    assert.equal(c.options.redirect, 'error'); assert.equal(c.options.headers.get('Authorization'), 'Bearer fixture-access');
    assert.match(c.options.headers.get('X-Request-Timestamp'), /^\d+$/);
    assert.equal(c.options.headers.get('X-OAuth-Token'), i < 2 ? null : 'fixture-user');
  }
  await assert.rejects(transport.userContents(9007199254740992), errorCode('INVALID_OFFSET'));
  await assert.rejects(transport.userContents('9223372036854775808'), errorCode('INVALID_OFFSET'));
  await assert.rejects(transport.favlists('1'), errorCode('PAGING_UNSUPPORTED'));
  await assert.rejects(transport.collections('1'), errorCode('PAGING_UNSUPPORTED'));
  assert.equal(calls.length, 5);
});

test('transport: errors are not empty results or echoed credentials; bodies, timeout and cancellation are bounded', async () => {
  for (const [fetch_impl, code] of [
    [async () => Response.json({Code: 20001, Message: 'fixture-access private upstream'}), 'ZHIHU_20001'],
    [async () => new Response('fixture-access', {status: 429}), 'RATE_LIMITED'],
    [async () => new Response('x'.repeat(1024 * 1024 + 1)), 'RESPONSE_TOO_LARGE'],
    [async () => new Response('not json'), 'INVALID_JSON'],
    [async () => {throw Error('fixture-access');}, 'NETWORK_ERROR'],
  ]) {
    await assert.rejects(new ZhihuHttpTransport({...profile, fetch_impl}).search('x'), e => e.code === code && !e.message.includes('fixture-access'));
  }
  const abortedFetch = (_url, options) => new Promise((resolve, reject) => {
    if (options.signal.aborted) reject(options.signal.reason); else options.signal.addEventListener('abort', () => reject(options.signal.reason));
  });
  await assert.rejects(new ZhihuHttpTransport({...profile, timeout_ms: 100, fetch_impl: abortedFetch}).search('x'), errorCode('TIMEOUT'));
  await assert.rejects(new ZhihuHttpTransport({...profile, signal: AbortSignal.abort(), fetch_impl: abortedFetch}).search('x'), errorCode('CANCELLED'));
});

test('normalization: actual URLs and authors survive; no guessed article links or trusted HTML', () => {
  const [first, missing] = normalizeItems({Items: [item, {Title: 'no url', ContentID: '1', Summary: '<script>bad()</script>摘要', Author: {Name: '作者'}}]}, 'zhihu', '2026-09-15', 3);
  assert.equal(first.url, item.Url); assert.equal(first.excerpt, '这是摘要，不是全文。'); assert.equal(first.author, '测试作者');
  assert.equal(first.content_mode, 'summary'); assert.match(first.id, /^external:/); assert.equal(missing.url, null); assert.equal(missing.excerpt, '摘要');
  assert.equal(normalizeItems({items: [{title: 'web', url: 'https://example.com/page?utm_x=y', summary: 'evidence'}]}, 'global', '', 1)[0].url, 'https://example.com/page?utm_x=y');
  for (const url of ['javascript:alert(1)', 'https://user:pass@zhihu.com', 'https://zhihu.com.evil.invalid']) assert.equal(normalizeItems({Items: [{...item, Url: url}]}, 'zhihu', '', 1)[0].url, null);
  assert.throws(() => normalizeItems({}, 'zhihu', '', 3), errorCode('INVALID_RESPONSE'));
});

test('OAuth local: browser/state binding, duplicate aliases, 20000 token envelope, replay and expiry', async () => {
  let calls = 0, now = Date.now();
  const oauth = new ZhihuOAuthSession({...oauthConfig, now: () => now, fetch_impl: async (url, options) => {
    calls++; assert.equal(url, 'https://openapi.zhihu.com/access_token'); assert.equal(options.redirect, 'error');
    assert.equal(options.body.get('redirect_uri'), oauthConfig.redirect_uri); assert.equal(options.body.get('app_id'), '669'); return tokenResponse();
  }});
  const start = await oauth.start('http://127.0.0.1:4173'), ticket = new URL(start.login_url).searchParams.get('ticket');
  const connect = oauth.connect(ticket), state = new URL(connect.url).searchParams.get('state');
  assert.throws(() => oauth.connect(ticket), errorCode('OAUTH_TICKET_INVALID'));
  await assert.rejects(oauth.complete(new URLSearchParams({code: 'x'}), connect.cookie), errorCode('OAUTH_STATE_MISSING'));
  await assert.rejects(oauth.complete(new URLSearchParams({state: 'wrong', code: 'x'}), connect.cookie), errorCode('OAUTH_STATE_MISMATCH'));
  await assert.rejects(oauth.complete(new URLSearchParams({state, code: 'x'}), 'wrong'), errorCode('OAUTH_BROWSER_MISMATCH'));
  await assert.rejects(oauth.complete(new URLSearchParams(`state=${state}&state=${state}&code=x`), connect.cookie), errorCode('OAUTH_DUPLICATE_PARAMETER'));
  await assert.rejects(oauth.complete(new URLSearchParams({state, code: 'x', authorization_code: 'y'}), connect.cookie), errorCode('OAUTH_CODE_CONFLICT'));
  assert.equal(calls, 0);
  await oauth.complete(new URLSearchParams({state, code: 'x', authorization_code: 'x'}), connect.cookie);
  assert.equal(oauth.status().status, 'authorized'); assert.equal(calls, 1);
  assert.equal(JSON.stringify(oauth), '{}'); assert.ok(!JSON.stringify(oauth.status()).includes('fixture-'));
  await assert.rejects(oauth.complete(new URLSearchParams({state, code: 'x'}), connect.cookie), errorCode('OAUTH_BROWSER_MISMATCH'));
  now += 3600001; assert.equal(oauth.status().status, 'not_authorized'); assert.throws(() => oauth.accessToken(), errorCode('USER_AUTH_REQUIRED'));
});

test('OAuth disconnect during exchange rejects late token; malformed and rejected tokens never authorize', async () => {
  let release;
  const oauth = new ZhihuOAuthSession({...oauthConfig, fetch_impl: () => new Promise(resolve => {release = resolve;})});
  const pending = localAuthorize(oauth); while (!release) await new Promise(resolve => setImmediate(resolve));
  oauth.disconnect(); release(tokenResponse()); await assert.rejects(pending, errorCode('OAUTH_CANCELLED'));
  assert.equal(oauth.status().status, 'not_authorized');
  for (const data of [{access_token: 'x'}, {access_token: 'x', expires_in: -1}, {code: 40000, access_token: 'x', expires_in: 100}]) {
    const invalid = new ZhihuOAuthSession({...oauthConfig, fetch_impl: async () => Response.json(data)});
    await assert.rejects(localAuthorize(invalid)); assert.equal(invalid.status().status, 'not_authorized');
  }
});

test('provider: user data requires explicit OAuth; public search is independent and metadata remains bounded', async () => {
  const calls = [];
  const provider = new ZhihuProvider({...oauthConfig, access_secret: 'fixture-access', fetch_impl: async (url, options) => {
    if (String(url).endsWith('/access_token')) return tokenResponse();
    calls.push({url: String(url), options}); return response({Items: [item], Paging: {IsEnd: false, NextOffset: '9007199254740993'}});
  }});
  await assert.rejects(provider.userRead({kind: 'contents'}), errorCode('USER_AUTH_REQUIRED')); assert.equal(calls.length, 0);
  const found = await provider.search({source: 'global', query: 'x'}); assert.equal(found.items[0].url, item.Url);
  await localAuthorize(provider.oauth);
  const personal = await provider.userRead({kind: 'contents', limit: 1}); assert.equal(personal.next_offset, '9007199254740993');
  assert.equal(personal.owner, 'oauth_authorized_user'); assert.equal(personal.saved_to_trace, false);
  await provider.search({source: 'zhihu', query: 'x'});
  assert.equal(calls[1].options.headers.get('X-OAuth-Token'), 'fixture-user-token'); assert.equal(calls[2].options.headers.get('X-OAuth-Token'), null);
  provider.oauth.disconnect(); await assert.rejects(provider.userRead({kind: 'contents'}), errorCode('USER_AUTH_REQUIRED'));
  provider.close(); await assert.rejects(provider.search({source: 'zhihu', query: 'x'}), errorCode('PROVIDER_CLOSED'));
});

test('provider: limits serial I/O, stops after rate limiting and rejects late disconnected user data', async () => {
  let resolve, calls = 0, now = Date.now();
  const provider = new ZhihuProvider({...oauthConfig, access_secret: 'fixture-access', now: () => now, fetch_impl: async (url) => {
    if (String(url).endsWith('/access_token')) return tokenResponse(); calls++; return new Promise(r => {resolve = r;});
  }});
  const pending = provider.search({source: 'zhihu', query: 'x'});
  await assert.rejects(provider.search({source: 'zhihu', query: 'x'}), errorCode('PROVIDER_BUSY'));
  resolve(new Response('', {status: 429})); await assert.rejects(pending, errorCode('RATE_LIMITED'));
  await assert.rejects(provider.search({source: 'zhihu', query: 'x'}), errorCode('RATE_LIMITED')); assert.equal(calls, 1);
  now += 61000; await localAuthorize(provider.oauth);
  const user = provider.userRead({kind: 'contents'}); provider.oauth.disconnect(); resolve(response({Items: [item]}));
  await assert.rejects(user, errorCode('USER_AUTH_REQUIRED')); assert.equal(calls, 2);
});

test('relay + local OAuth: remote HTTPS callback end-to-end, proof redemption, no code/token in browser or status', async t => {
  const redirect_uri = 'https://trace.example.test/callback';
  const relay = createZhihuOAuthRelay({app_id: '669', redirect_uri}), origin = await serve(t, relay);
  let exchanges = 0;
  const oauth = new ZhihuOAuthSession({...oauthConfig, redirect_uri, fetch_impl: async (url, options) => {
    if (String(url).endsWith('/access_token')) {exchanges++; assert.equal(options.body.get('code'), 'fixture-code'); assert.equal(options.body.get('redirect_uri'), redirect_uri); return tokenResponse();}
    return fetch(origin + new URL(url).pathname, options);
  }});
  const start = await oauth.start('http://127.0.0.1:4173'), login = new URL(start.login_url);
  assert.equal(login.origin, 'https://trace.example.test'); assert.equal((await oauth.check()).status, 'pending_user_authorization');
  const browser = await fetch(origin + login.pathname + login.search, {redirect: 'manual'});
  const cookie = browser.headers.get('set-cookie').split(';')[0], authorize = new URL(browser.headers.get('location'));
  assert.match(browser.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Lax/);
  assert.equal(authorize.searchParams.get('redirect_uri'), redirect_uri);
  const id = login.searchParams.get('id');
  const stolen = await fetch(`${origin}/api/trace-oauth/requests/${id}/redeem`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({verifier: randomBytes(32).toString('base64url')})}); assert.equal(stolen.status, 400);
  const state = authorize.searchParams.get('state');
  for (const [query, headers] of [[`state=wrong&code=fixture-code`, {cookie}], [`state=${state}&code=fixture-code`, {}]]) {
    const rejected = await fetch(`${origin}/callback?${query}`, {headers, redirect: 'manual'}); assert.equal(rejected.status, 303);
    assert.ok(!rejected.headers.get('location').includes('fixture-code')); assert.equal((await oauth.check()).status, 'pending_user_authorization');
  }
  const callback = await fetch(`${origin}/callback?state=${state}&authorization_code=fixture-code`, {headers: {cookie}, redirect: 'manual'});
  assert.equal(callback.headers.get('location'), '/api/trace-oauth/result'); assert.equal(await callback.text(), '');
  const result = await oauth.check(); assert.equal(result.status, 'authorized'); assert.equal(exchanges, 1);
  assert.ok(!JSON.stringify(result).includes('fixture-')); await oauth.check(); assert.equal(exchanges, 1);
  assert.equal((await fetch(start.login_url.replace(login.origin, origin), {redirect: 'manual'})).status, 400);
});

test('relay: duplicate callbacks and mismatched aliases cannot overwrite code; transactions expire', async t => {
  let now = Date.now(); const redirect_uri = 'https://trace.example.test/callback';
  const origin = await serve(t, createZhihuOAuthRelay({app_id: '669', redirect_uri, now: () => now}));
  const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url');
  const post = (route, data, headers = {}) => fetch(origin + route, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(data)});
  const args = {app_id: '669', redirect_uri, state, challenge: createHash('sha256').update(verifier).digest('base64url')};
  assert.equal((await post('/api/trace-oauth/requests', args, {origin: 'https://evil.test'})).status, 400);
  const {request_id: id} = await (await post('/api/trace-oauth/requests', args)).json();
  const connect = await fetch(`${origin}/api/trace-oauth/connect?id=${id}`, {redirect: 'manual'}), cookie = connect.headers.get('set-cookie').split(';')[0];
  const callback = query => fetch(`${origin}/callback?state=${state}&${query}`, {headers: {cookie}, redirect: 'manual'});
  await callback('code=a&authorization_code=b'); assert.equal((await (await post(`/api/trace-oauth/requests/${id}/redeem`, {verifier})).json()).status, 'pending');
  await callback('code=a'); await callback('code=b');
  assert.equal((await (await post(`/api/trace-oauth/requests/${id}/redeem`, {verifier})).json()).code, 'a');
  assert.equal((await post(`/api/trace-oauth/requests/${id}/redeem`, {verifier})).status, 400);
  const second = await (await post('/api/trace-oauth/requests', args)).json(); now += 300001;
  assert.equal((await post(`/api/trace-oauth/requests/${second.request_id}/redeem`, {verifier})).status, 400);
});

test('remote callback missing state is reported to its initiating backend, never exchanged using cookie alone', async t => {
  const redirect_uri = 'https://trace.example.test/callback', origin = await serve(t, createZhihuOAuthRelay({app_id: '669', redirect_uri}));
  const oauth = new ZhihuOAuthSession({...oauthConfig, redirect_uri, fetch_impl: (url, options) => {
    assert.ok(!String(url).includes('/access_token')); return fetch(origin + new URL(url).pathname, options);
  }});
  const start = await oauth.start('http://127.0.0.1:4173'), url = new URL(start.login_url);
  const connect = await fetch(origin + url.pathname + url.search, {redirect: 'manual'}), cookie = connect.headers.get('set-cookie').split(';')[0];
  const callback = await fetch(origin + '/callback?authorization_code=fixture-code', {headers: {cookie}, redirect: 'manual'});
  assert.equal(callback.status, 303); await assert.rejects(oauth.check(), errorCode('OAUTH_STATE_MISSING'));
  assert.equal(oauth.status().status, 'not_authorized');
});

test('local HTTP + real MCP stdio: bounded search tools, explicit auth check and no credential inputs', async t => {
  const provider = new ZhihuProvider({access_secret: 'fixture-access', fetch_impl: async () => response({Items: [item]})});
  const origin = await serve(t, createZhihuHttp(provider));
  assert.equal((await fetch(origin + '/api/zhihu/search', {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'})).status, 403);
  const post = (pathname, body) => fetch(origin + pathname, {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: JSON.stringify(body)});
  const capability = await (await fetch(origin + '/api/search/capabilities')).json();
  assert.deepEqual(capability.sources, {zhihu: {route: '/api/search/zhihu', enabled: true}, global: {route: '/api/search/global', enabled: true}});
  const publicZhihu = await (await post('/api/search/zhihu', {query: '经验', count: 1})).json(); assert.equal(publicZhihu.source, 'zhihu');
  const publicGlobal = await (await post('/api/search/global', {query: '证据', count: 1})).json(); assert.equal(publicGlobal.source, 'global');
  const misleadingSource = await post('/api/search/zhihu', {source: 'global', query: '经验'}); assert.equal(misleadingSource.status, 400);
  const transport = new StdioClientTransport({command: process.execPath, args: ['dist/apps/mcp/src/main.js'], stderr: 'pipe', env: {...process.env, TRACE_PRODUCT_URL: origin}});
  const client = new Client({name: 'zhihu-test', version: '1.0.0'}); await client.connect(transport); t.after(() => client.close());
  const tools = (await client.listTools()).tools.filter(x => /zhihu|global_search/.test(x.name));
  assert.equal(tools.length, 7); assert.ok(!JSON.stringify(tools.map(x => x.inputSchema)).match(/app_key|access_token|secret/));
  const call = async (name, args = {}) => JSON.parse((await client.callTool({name, arguments: args})).content.find(x => x.type === 'text').text);
  const found = await call('trace_zhihu_search', {query: '经验', count: 1}); assert.equal(found.ok, true); assert.ok(JSON.stringify(found).includes(item.Url));
  const global = await call('trace_global_search', {query: '证据', count: 1}); assert.equal(global.ok, true);
  assert.equal((await call('trace_zhihu_user_read', {kind: 'contents'})).ok, false);
  assert.equal((await call('trace_zhihu_login_check')).ok, true);
  assert.ok(!JSON.stringify(found).includes('fixture-access'));
});
