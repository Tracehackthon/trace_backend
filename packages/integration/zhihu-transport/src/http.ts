import type {IncomingMessage, ServerResponse} from 'node:http';
import {ZhihuTransportError} from './index.js';
import type {ZhihuProvider} from './provider.js';
import {record} from './normalize.js';

function error(code: string, message: string): never {throw new ZhihuTransportError(code, message);}
export function reply(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'", ...headers});
  res.end(typeof value === 'string' ? value : JSON.stringify(value));
}
function localOrigin(req: IncomingMessage, json: boolean) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') || !/^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/.test(req.headers.host ?? ''))
    error('LOCAL_ONLY', 'Zhihu broker only accepts loopback clients and hosts.');
  const origin = `http://${req.headers.host}`;
  if (json && (req.headers.origin !== origin || req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin'))
    error('ORIGIN_REQUIRED', 'Use the same-origin local endpoint.');
  return origin;
}
export async function body(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '') || req.headers['content-encoding']) error('JSON_REQUIRED', 'Uncompressed JSON is required.');
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    const cleanup = () => {clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', abort); req.off('aborted', abort);};
    const fail = () => {cleanup(); reject(new ZhihuTransportError('INVALID_BODY', 'Request must be a bounded UTF-8 JSON object.'));};
    const data = (chunk: Buffer) => {size += chunk.length; if (size > 8192) fail(); else chunks.push(chunk);};
    const end = () => {cleanup(); try {resolve(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))));} catch {reject(new ZhihuTransportError('INVALID_BODY', 'Invalid UTF-8 JSON.'));}};
    const abort = () => fail(), timer = setTimeout(fail, 10000);
    req.on('data', data); req.on('end', end); req.on('error', abort); req.on('aborted', abort);
  });
}
function empty(value: unknown) {if (!record(value) || Object.keys(value).length) error('INVALID_INPUT', 'This action takes an empty object.');}
function cookie(req: IncomingMessage) {
  const values = (req.headers.cookie ?? '').split(';').map(x => x.trim()).filter(x => x.startsWith('trace_zhihu_oauth='));
  return values.length === 1 ? values[0]!.slice('trace_zhihu_oauth='.length) : undefined;
}
export interface ZhihuServiceIdentity {
  protocol_version: number;
  protocol: 'trace.runtime.identity@1';
  product_id: 'trace';
  service_id: 'trace-product-service';
  service_role: 'product';
  runtime_version: string;
  installation_id: string | null;
  workspace_id: string | null;
  identity_state: 'verified' | 'legacy' | 'unverified';
  database_role: 'product-web';
  api_surface: Record<string, string[]>;
}
const ZHIHU_RUNTIME_API_SURFACE = Object.freeze({
  runtime: ['/api/runtime/identity'],
  zhihu: ['/api/zhihu/status', '/api/zhihu/oauth/start', '/api/zhihu/oauth/check', '/api/zhihu/oauth/disconnect', '/api/zhihu/oauth/connect', '/api/zhihu/oauth/result', '/api/zhihu/search', '/api/zhihu/user/read'],
  search: ['/api/search/capabilities', '/api/search/zhihu', '/api/search/global'],
});
function defaultServiceIdentity(): ZhihuServiceIdentity {
  const workspace = process.env.TRACE_WORKSPACE_ID;
  const installation = process.env.TRACE_INSTALLATION_ID;
  const verified = typeof workspace === 'string' && workspace.length > 0 && typeof installation === 'string' && installation.length > 0;
  return {protocol_version: 1, protocol: 'trace.runtime.identity@1', product_id: 'trace', service_id: 'trace-product-service', service_role: 'product', runtime_version: process.env.TRACE_RUNTIME_VERSION || '0.7.1',
    installation_id: verified ? installation! : null, workspace_id: verified ? workspace! : null, identity_state: verified ? 'verified' : 'unverified', database_role: 'product-web', api_surface: JSON.parse(JSON.stringify(ZHIHU_RUNTIME_API_SURFACE))};
}
/** Local-only broker, also used by MCP. Cloud multi-user hosting needs a separate
 * authenticated owner/session boundary; no wildcard CORS or remote proxy flags. */
export function createZhihuHttp(provider: ZhihuProvider | null = null, options: {serviceIdentity?: ZhihuServiceIdentity} = {}) {
  const serviceIdentity = options.serviceIdentity ?? defaultServiceIdentity();
  const callbackPath = provider?.oauth.redirectUri ? new URL(provider.oauth.redirectUri).pathname : '/api/zhihu/oauth/callback';
  const loopbackCallbackPath = '/api/zhihu/oauth/loopback-callback';
  let closed = false;
  return {
    provider,
    async handle(req: IncomingMessage, res: ServerResponse) {
      const rawPath = (req.url ?? '').split('?')[0]!;
      // Keep search as a first-class Web domain. `/api/zhihu/*` is reserved
      // for provider configuration, OAuth and explicitly authorized user data;
      // callers must not select an unrelated source with a body field.
      if (rawPath !== '/api/runtime/identity' && !rawPath.startsWith('/api/zhihu/') && !rawPath.startsWith('/api/search/') && rawPath !== callbackPath) return false;
      try {
        const origin = localOrigin(req, req.method === 'POST');
        const url = new URL(req.url!, origin);
        if (url.origin !== origin || closed) error('PROVIDER_CLOSED', 'The local provider is not available.');
        const pathname = url.pathname;
        if (pathname === '/api/runtime/identity') {
          if (req.method !== 'GET') {reply(res, 405, {error: {code: 'METHOD_NOT_ALLOWED'}}, {allow: 'GET'}); return true;}
          reply(res, 200, serviceIdentity, {'x-trace-runtime-protocol': '1'}); return true;
        }
        if (req.method === 'GET' && pathname === '/api/zhihu/status') {reply(res, 200, provider?.status() ?? {enabled: false, search_configured: false, oauth: {configured: false, status: 'not_authorized'}}); return true;}
        if (req.method === 'GET' && pathname === '/api/search/capabilities') {
          reply(res, 200, {protocol_version: 1, enabled: !!provider, provider: 'zhihu', content_mode: 'summary',
            sources: {zhihu: {route: '/api/search/zhihu', enabled: !!provider}, global: {route: '/api/search/global', enabled: !!provider}},
            boundary: 'single-user-loopback-same-origin'}); return true;
        }
        if (!provider) {reply(res, 503, {error: {code: 'ZHIHU_DISABLED', message: 'Enable TRACE_ZHIHU_ENABLED=1 on the local backend.'}}); return true;}
        if (req.method === 'GET' && pathname === '/api/zhihu/oauth/connect') {
          if (url.searchParams.getAll('ticket').length !== 1) error('OAUTH_TICKET_INVALID', 'Invalid authorization link.');
          const result = provider.oauth.connect(url.searchParams.get('ticket'));
          reply(res, 303, '', {location: result.url, 'set-cookie': `trace_zhihu_oauth=${result.cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=300`}); return true;
        }
        if (req.method === 'GET' && pathname === callbackPath) {
          if (url.origin !== new URL(provider.oauth.redirectUri!).origin) error('OAUTH_CALLBACK_MISMATCH', 'Callback origin differs from registration.');
          await provider.oauth.complete(url.searchParams, cookie(req));
          reply(res, 303, '', {location: '/api/zhihu/oauth/result', 'set-cookie': 'trace_zhihu_oauth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'}); return true;
        }
        if (req.method === 'GET' && pathname === loopbackCallbackPath) {
          const states = url.searchParams.getAll('state');
          if (states.length !== 1 || !/^trace-local-v1\.[A-Za-z0-9_-]{43}$/.test(states[0]!)) error('OAUTH_STATE_MISMATCH', 'OAuth callback is not a Trace local handoff.');
          await provider.oauth.complete(url.searchParams, cookie(req));
          reply(res, 303, '', {location: '/api/zhihu/oauth/result', 'set-cookie': 'trace_zhihu_oauth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'}); return true;
        }
        if (req.method === 'GET' && pathname === '/api/zhihu/oauth/result') {
          reply(res, 200, url.searchParams.get('error') === 'OAUTH_STATE_MISSING' ? '知乎没有返回校验用的 state，已停止授权。请与平台确认回调支持后重新发起，不会跳过校验。'
            : url.searchParams.has('error') ? '本次授权回调未通过校验。请回到 Trace 检查连接或重新发起授权。'
            : provider.oauth.status().status === 'authorized' ? '知乎授权已连接到当前本机 Trace。可以关闭此页，回到 Codex 或 Trace；不会自动读取收藏。' : '当前没有有效知乎授权。请返回 Trace 重新发起授权。', {'content-type': 'text/plain; charset=utf-8'}); return true;
        }
        if (req.method !== 'POST') {reply(res, 405, {error: {code: 'METHOD_NOT_ALLOWED'}}); return true;}
        const input = await body(req);
        if (pathname === '/api/zhihu/oauth/start') {empty(input); reply(res, 200, await provider.oauth.start(origin));}
        else if (pathname === '/api/zhihu/oauth/check') {empty(input); reply(res, 200, await provider.oauth.check());}
        else if (pathname === '/api/zhihu/oauth/disconnect') {empty(input); reply(res, 200, provider.oauth.disconnect());}
        else if (pathname === '/api/search/zhihu' || pathname === '/api/search/global' || pathname === '/api/zhihu/search' || pathname === '/api/zhihu/user/read') {
          const aborter = new AbortController(), abort = () => aborter.abort(); res.once('close', abort);
          try {
            if (pathname === '/api/search/zhihu' || pathname === '/api/search/global') {
              if (!record(input)) error('INVALID_INPUT', 'Search input must be an object.');
              // The path, rather than client-provided `source`, selects the
              // provider operation. Reject duplicate/misleading source fields.
              if (Object.prototype.hasOwnProperty.call(input, 'source')) error('INVALID_INPUT', 'Select the search source through its route.');
              reply(res, 200, await provider.search({...input, source: pathname.endsWith('/zhihu') ? 'zhihu' : 'global'}, aborter.signal));
            } else reply(res, 200, pathname === '/api/zhihu/search' ? await provider.search(input, aborter.signal) : await provider.userRead(input, aborter.signal));
          }
          finally {res.off('close', abort);}
        } else reply(res, 404, {error: {code: 'NOT_FOUND'}});
      } catch (e) {
        req.resume();
        const known = e instanceof ZhihuTransportError;
        const code = known ? e.code : 'ZHIHU_REQUEST_FAILED';
        const status = /LOCAL_ONLY|ORIGIN_REQUIRED|MISMATCH/.test(code) ? 403 : /AUTH_REQUIRED/.test(code) ? 401 : /RATE_LIMIT|BUSY|30001/.test(code) ? 429 : /CONFIGURED|CLOSED/.test(code) ? 503 : 400;
        if (!res.headersSent) {
          if (req.method === 'GET' && rawPath === callbackPath && code.startsWith('OAUTH_'))
            reply(res, 303, '', {location: `/api/zhihu/oauth/result?error=${code === 'OAUTH_STATE_MISSING' ? code : 'OAUTH_CALLBACK_FAILED'}`});
          else reply(res, status, {error: {code, message: known ? e.message : 'The Zhihu request did not complete.'}});
        }
      }
      return true;
    },
    close() {closed = true; provider?.close();},
  };
}
