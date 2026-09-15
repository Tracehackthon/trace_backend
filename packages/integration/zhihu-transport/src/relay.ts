import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {ZhihuTransportError} from './index.js';
import {record} from './normalize.js';
import {body, reply} from './http.js';

const random = () => randomBytes(32).toString('base64url');
const digest = (s: string) => createHash('sha256').update(s).digest('base64url');
const valid = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function demand(ok: unknown, code = 'OAUTH_RELAY_INVALID'): asserts ok {
  if (!ok) throw new ZhihuTransportError(code, 'Authorization relay request is invalid, expired or not bound to this browser.');
}
type Transaction = {state: string; challenge: string; expires: number; cookie?: string; code?: string; error?: string};

/** HTTPS reverse-proxy target: short-lived codes only, never App Key or tokens.
 * One long-lived process; not a distributed/serverless session store. */
export function createZhihuOAuthRelay({app_id, redirect_uri, now = Date.now}: {app_id: string; redirect_uri: string; now?: () => number}) {
  const callback = new URL(redirect_uri);
  demand(/^\d{1,32}$/.test(app_id) && callback.protocol === 'https:' && !callback.username && !callback.password
    && !callback.search && !callback.hash && /^\/[A-Za-z0-9/_-]+$/.test(callback.pathname) && !callback.pathname.startsWith('/api/trace-oauth/'), 'INVALID_OAUTH_CONFIG');
  const pending = new Map<string, Transaction>(); let closed = false, windowStart = now(), created = 0;
  const prune = () => {for (const [id, tx] of pending) if (tx.expires <= now()) pending.delete(id);};
  const cleanup = setInterval(prune, 1000); cleanup.unref();
  const cookieName = (id: string) => `trace_zhihu_relay_${id}`;
  const cookieHeader = (id: string, value: string, age: number) => `${cookieName(id)}=${value}; Secure; HttpOnly; SameSite=Lax; Path=${callback.pathname}; Max-Age=${age}`;
  const single = (params: URLSearchParams, key: string) => {demand(params.getAll(key).length <= 1); return params.get(key);};
  return {
    async handle(req: IncomingMessage, res: ServerResponse) {
      const rawPath = (req.url ?? '').split('?')[0]!;
      if (rawPath !== callback.pathname && !rawPath.startsWith('/api/trace-oauth/')) return false;
      let callbackRequest = false;
      try {
        demand(!closed, 'OAUTH_RELAY_CLOSED'); prune();
        // Public origin comes only from deployment configuration, not forwarded headers.
        const url = new URL(req.url ?? '', callback.origin); demand(url.origin === callback.origin);
        callbackRequest = url.pathname === callback.pathname && req.method === 'GET';
        if (req.method === 'GET' && url.pathname === '/api/trace-oauth/result') {
          reply(res, 200, '知乎回调已处理。请回到发起授权的本机 Trace 或 Codex，检查连接状态；本页不显示授权码或 Token。未成功时请重新发起授权。', {'content-type': 'text/plain; charset=utf-8'}); return true;
        }
        if (req.method === 'GET' && url.pathname === '/api/trace-oauth/connect') {
          const id = single(url.searchParams, 'id'); demand(valid(id));
          const tx = pending.get(id); demand(tx && !tx.cookie);
          const cookie = random(); tx.cookie = digest(cookie);
          const authorize = new URL('https://openapi.zhihu.com/authorize');
          authorize.search = new URLSearchParams({app_id, redirect_uri, response_type: 'code', state: tx.state}).toString();
          reply(res, 303, '', {location: authorize.href, 'set-cookie': cookieHeader(id, cookie, 300)}); return true;
        }
        if (callbackRequest) {
          const state = single(url.searchParams, 'state');
          if (!state) {
            // A cookie can identify which transaction failed, never authorize a
            // code exchange in place of the absent OAuth state.
            const cookies = (req.headers.cookie ?? '').split(';').map(s => s.trim());
            const bound = [...pending].filter(([id, tx]) => {
              const values = cookies.filter(s => s.startsWith(`${cookieName(id)}=`));
              return tx.cookie && values.length === 1 && equal(digest(values[0]!.slice(cookieName(id).length + 1)), tx.cookie);
            });
            if (bound.length === 1) bound[0]![1].error = 'OAUTH_STATE_MISSING';
            demand(false, 'OAUTH_STATE_MISSING');
          }
          demand(valid(state), 'OAUTH_STATE_MISMATCH');
          const entry = [...pending].find(([, tx]) => equal(tx.state, state)); demand(entry);
          const [id, tx] = entry;
          const cookies = (req.headers.cookie ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${cookieName(id)}=`));
          demand(tx.cookie && cookies.length === 1 && equal(digest(cookies[0]!.slice(cookieName(id).length + 1)), tx.cookie) && !tx.code && !tx.error, 'OAUTH_BROWSER_MISMATCH');
          const primary = single(url.searchParams, 'authorization_code'), alias = single(url.searchParams, 'code');
          if (single(url.searchParams, 'error')) tx.error = 'OAUTH_DENIED';
          else {
            demand(!(primary && alias && primary !== alias), 'OAUTH_CODE_CONFLICT');
            const code = primary ?? alias;
            demand(code && code.length <= 4096 && !/[\x00-\x20\x7f]/.test(code), 'OAUTH_CODE_MISSING'); tx.code = code;
          }
          reply(res, 303, '', {location: '/api/trace-oauth/result', 'set-cookie': cookieHeader(id, '', 0)}); return true;
        }
        demand(req.method === 'POST', 'METHOD_NOT_ALLOWED');
        // Server-to-server JSON only. No browser cross-site POST or CORS preflight.
        demand(req.headers.origin === undefined && req.headers['sec-fetch-site'] === undefined, 'OAUTH_RELAY_SERVER_ONLY');
        const input = await body(req); demand(record(input));
        if (url.pathname === '/api/trace-oauth/requests') {
          demand(Object.keys(input).every(k => ['app_id', 'redirect_uri', 'state', 'challenge'].includes(k))
            && input.app_id === app_id && input.redirect_uri === redirect_uri && valid(input.state) && valid(input.challenge));
          if (now() - windowStart >= 60000) {windowStart = now(); created = 0;}
          demand(pending.size < 200 && ++created <= 60, 'OAUTH_RELAY_BUSY');
          demand(![...pending.values()].some(tx => tx.state === input.state));
          const id = random(); pending.set(id, {state: input.state, challenge: input.challenge, expires: now() + 300000});
          reply(res, 201, {request_id: id, expires_in: 300}); return true;
        }
        const match = /^\/api\/trace-oauth\/requests\/([A-Za-z0-9_-]{43})\/redeem$/.exec(url.pathname);
        demand(match && Object.keys(input).length === 1 && valid(input.verifier));
        const id = match[1]!, tx = pending.get(id); demand(tx && equal(digest(input.verifier), tx.challenge));
        if (!tx.code && !tx.error) {reply(res, 200, {status: 'pending'}); return true;}
        pending.delete(id); // At-most-once delivery; ambiguity needs a fresh authorization.
        if (tx.error) {reply(res, 200, {status: 'denied', state: tx.state, error: tx.error}); return true;}
        reply(res, 200, {status: 'ready', state: tx.state, code: tx.code});
      } catch (e) {
        req.resume();
        if (!res.headersSent) {
          if (callbackRequest) reply(res, 303, '', {location: '/api/trace-oauth/result'});
          else reply(res, e instanceof ZhihuTransportError && e.code === 'OAUTH_RELAY_BUSY' ? 429 : 400,
            {error: {code: e instanceof ZhihuTransportError ? e.code : 'OAUTH_RELAY_INVALID', message: 'Authorization relay request was not accepted.'}});
        }
      }
      return true;
    },
    close() {closed = true; clearInterval(cleanup); pending.clear();},
  };
}
