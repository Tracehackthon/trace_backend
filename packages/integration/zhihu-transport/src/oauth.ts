import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {ZhihuTransportError} from './index.js';
import {record} from './normalize.js';

type OAuthConfig = {app_id?: string; app_key?: string; redirect_uri?: string; loopback_forward?: boolean; fetch_impl?: typeof fetch; now?: () => number};
const digest = (s: string) => createHash('sha256').update(s).digest();
const equal = (value: string | null | undefined, hash: Buffer) => typeof value === 'string' && value.length <= 1000 && timingSafeEqual(digest(value), hash);
function fail(code: string, message: string): never {throw new ZhihuTransportError(code, message);}
const single = (p: URLSearchParams, k: string) => {
  if (p.getAll(k).length > 1) fail('OAUTH_DUPLICATE_PARAMETER', 'OAuth callback contains duplicate parameters.');
  return p.get(k);
};

/** A single-user local connection. Tokens/codes never leave this server object or
 * survive restart. Missing state is deliberately NOT treated as compatibility. */
export class ZhihuOAuthSession {
  #config: OAuthConfig; #fetch: typeof fetch; #now: () => number;
  #token: {value: string; expiresAt: number} | null = null;
  #pending: {ticket: Buffer; expiresAt: number; state?: Buffer; cookie?: Buffer; exchanging?: boolean; loopbackForward?: boolean} | null = null;
  #generation = 0; #exchange: AbortController | null = null;
  #relay: {id: string; verifier: string; state: string; cookie: string; origin: string} | null = null;
  #checking = false;
  constructor(config: OAuthConfig = {}) {
    this.#config = config; this.#fetch = config.fetch_impl ?? fetch; this.#now = config.now ?? Date.now;
    if (config.redirect_uri) {
      let u: URL; try {u = new URL(config.redirect_uri);} catch {throw new ZhihuTransportError('INVALID_OAUTH_CONFIG', 'Invalid OAuth redirect URI.');}
      if (u.username || u.password || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === '127.0.0.1')))
        fail('INVALID_OAUTH_CONFIG', 'OAuth redirect must be HTTPS or a registered HTTP 127.0.0.1 callback without query parameters.');
      if (u.pathname === '/' || u.pathname.endsWith('/connect')) fail('INVALID_OAUTH_CONFIG', 'OAuth needs a dedicated registered callback path.');
    }
  }
  get configured() {return !!(this.#config.app_id?.trim() && this.#config.app_key?.trim() && this.#config.redirect_uri);}
  get redirectUri() {return this.#config.redirect_uri ?? null;}
  status() {
    if (this.#token && this.#token.expiresAt <= this.#now()) this.#token = null;
    if (this.#pending && this.#pending.expiresAt <= this.#now()) {this.#pending = null; this.#relay = null; this.#generation++; this.#exchange?.abort();}
    return {configured: this.configured, status: this.#token ? 'authorized' : this.#pending ? 'pending_user_authorization' : 'not_authorized',
      expires_at: this.#token ? new Date(this.#token.expiresAt).toISOString() : null, storage: 'server_memory_only', state_required: true,
      identity_verified: false, notice: 'OAuth authorizes user-data access; this is not a verified Trace account identity.'};
  }
  async start(origin: string) {
    this.status();
    if (!this.configured) fail('OAUTH_NOT_CONFIGURED', 'Configure the application ID, backend app key and registered callback first.');
    const callbackOrigin = new URL(this.#config.redirect_uri!).origin;
    if (callbackOrigin !== origin && !callbackOrigin.startsWith('https://')) fail('OAUTH_CALLBACK_MISMATCH', 'A remote callback requires HTTPS.');
    if (this.#token) fail('OAUTH_ALREADY_AUTHORIZED', 'Disconnect the existing local connection before changing accounts.');
    this.#exchange?.abort(); this.#generation++; this.#relay = null;
    const generation = this.#generation;
    const ticket = randomBytes(32).toString('base64url');
    this.#pending = {ticket: digest(ticket), expiresAt: this.#now() + 5 * 60000,
      loopbackForward: callbackOrigin !== origin && this.#config.loopback_forward === true};
    if (callbackOrigin !== origin) {
      if (this.#config.loopback_forward === true)
        return {status: 'user_action_required', login_url: `${origin}/api/zhihu/oauth/connect?ticket=${ticket}`, expires_in: 300};
      const connection = this.connect(ticket), state = new URL(connection.url).searchParams.get('state')!;
      const verifier = randomBytes(32).toString('base64url');
      try {
        const response = await this.relayRequest(callbackOrigin, '/api/trace-oauth/requests', {
          app_id: this.#config.app_id, redirect_uri: this.#config.redirect_uri, state,
          challenge: digest(verifier).toString('base64url'),
        });
        if (generation !== this.#generation) fail('OAUTH_CANCELLED', 'Authorization was cancelled.');
        if (!record(response) || typeof response.request_id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(response.request_id))
          fail('OAUTH_RELAY_UNAVAILABLE', 'The registered callback needs the Trace OAuth relay service.');
        this.#relay = {id: response.request_id, verifier, state, cookie: connection.cookie, origin: callbackOrigin};
        return {status: 'user_action_required', login_url: `${callbackOrigin}/api/trace-oauth/connect?id=${response.request_id}`, expires_in: 300};
      } catch (e) {if (generation === this.#generation) this.#pending = null; throw e;}
    }
    return {status: 'user_action_required', login_url: `${origin}/api/zhihu/oauth/connect?ticket=${ticket}`, expires_in: 300};
  }
  private async relayRequest(origin: string, route: string, data: unknown): Promise<unknown> {
    try {
      const response = await this.#fetch(`${origin}${route}`, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: {'content-type': 'application/json', accept: 'application/json'}, body: JSON.stringify(data)});
      if (!response.ok) fail('OAUTH_RELAY_UNAVAILABLE', 'The callback relay is unavailable or this authorization expired. Start again.');
      let size = 0; const chunks: Uint8Array[] = [];
      if (response.body) for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.length; if (size > 16384) fail('OAUTH_RELAY_UNAVAILABLE', 'Invalid callback relay response.'); chunks.push(chunk);
      }
      return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
    } catch (e) {if (e instanceof ZhihuTransportError) throw e; fail('OAUTH_RELAY_UNAVAILABLE', 'The callback relay did not return valid JSON. No automatic retry.');}
  }
  async check() {
    this.status(); const relay = this.#relay, generation = this.#generation;
    if (!relay) return this.status();
    if (this.#checking) fail('OAUTH_BUSY', 'An authorization check is already running.');
    this.#checking = true;
    try {
      const response = await this.relayRequest(relay.origin, `/api/trace-oauth/requests/${relay.id}/redeem`, {verifier: relay.verifier});
      if (generation !== this.#generation) fail('OAUTH_CANCELLED', 'Authorization was cancelled.');
      if (record(response) && response.status === 'pending') return this.status();
      this.#relay = null;
      if (record(response) && response.state === relay.state && response.status === 'denied') {
        if (response.error === 'OAUTH_STATE_MISSING') fail('OAUTH_STATE_MISSING', 'Zhihu did not return state. Authorization stopped; confirm state support with the platform.');
        fail('OAUTH_DENIED', 'The user or platform did not authorize this request.');
      }
      if (!record(response) || response.state !== relay.state || typeof response.code !== 'string')
        fail('OAUTH_RELAY_INVALID', 'Authorization relay proof was not valid. Start again.');
      return await this.complete(new URLSearchParams({state: relay.state, authorization_code: response.code}), relay.cookie);
    } catch (e) {
      if (generation === this.#generation) {this.#relay = null; this.#pending = null;}
      throw e;
    } finally {this.#checking = false;}
  }
  connect(ticket: string | null) {
    this.status(); const p = this.#pending;
    if (!p || p.state || !equal(ticket, p.ticket)) fail('OAUTH_TICKET_INVALID', 'The authorization link is invalid or expired; start again.');
    const nonce = randomBytes(32).toString('base64url');
    const state = p.loopbackForward ? `trace-local-v1.${nonce}` : nonce, cookie = randomBytes(32).toString('base64url');
    p.state = digest(state); p.cookie = digest(cookie);
    const u = new URL('https://openapi.zhihu.com/authorize');
    u.search = new URLSearchParams({app_id: this.#config.app_id!, redirect_uri: this.#config.redirect_uri!, response_type: 'code', state}).toString();
    return {url: u.href, cookie};
  }
  async complete(params: URLSearchParams, cookie: string | undefined) {
    this.status(); const p = this.#pending;
    if (!p?.state || !p.cookie || p.exchanging || !equal(cookie, p.cookie)) fail('OAUTH_BROWSER_MISMATCH', 'Callback is not bound to the browser that started authorization.');
    const state = single(params, 'state');
    if (!state) fail('OAUTH_STATE_MISSING', 'Zhihu did not return state. Authorization stopped; confirm state support with the platform.');
    if (!equal(state, p.state)) fail('OAUTH_STATE_MISMATCH', 'OAuth callback state does not match.');
    if (single(params, 'error')) {this.#pending = null; fail('OAUTH_DENIED', 'The user or platform did not authorize this request.');}
    const primary = single(params, 'authorization_code'), alias = single(params, 'code');
    if (primary && alias && primary !== alias) fail('OAUTH_CODE_CONFLICT', 'Callback code aliases disagree.');
    const code = primary ?? alias;
    if (!code || code.length > 4096 || /[\x00-\x20\x7f]/.test(code)) fail('OAUTH_CODE_MISSING', 'OAuth callback has no valid authorization code.');
    p.exchanging = true;
    const generation = this.#generation, controller = new AbortController(); this.#exchange = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await this.#fetch('https://openapi.zhihu.com/access_token', {method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {'content-type': 'application/x-www-form-urlencoded', accept: 'application/json'},
        body: new URLSearchParams({app_id: this.#config.app_id!, app_key: this.#config.app_key!, grant_type: 'authorization_code', redirect_uri: this.#config.redirect_uri!, code})});
      if (!r.ok) fail('OAUTH_EXCHANGE_FAILED', 'OAuth token exchange failed; start a new authorization, do not replay the code.');
      let size = 0; const chunks: Uint8Array[] = [];
      if (r.body) for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {size += chunk.length; if (size > 16384) fail('OAUTH_INVALID_RESPONSE', 'OAuth response exceeded its limit.'); chunks.push(chunk);}
      const body: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
      if (record(body) && (body.code !== undefined || body.Code !== undefined) && ![0, 20000].includes(Number(body.code ?? body.Code)))
        fail('OAUTH_EXCHANGE_FAILED', 'OAuth platform rejected the token exchange.');
      const value = record(body) && typeof body.access_token === 'string' ? body : record(body) && record(body.data) ? body.data : record(body) && record(body.Data) ? body.Data : null;
      if (!value || typeof value.access_token !== 'string' || !value.access_token.trim() || value.access_token.length > 4096 || /[\r\n]/.test(value.access_token)
        || !Number.isSafeInteger(value.expires_in) || Number(value.expires_in) <= 0 || Number(value.expires_in) > 31 * 86400)
        fail('OAUTH_INVALID_RESPONSE', 'OAuth response requires a token and a valid expires_in.');
      if (generation !== this.#generation || controller.signal.aborted) fail('OAUTH_CANCELLED', 'Authorization was cancelled.');
      this.#token = {value: value.access_token as string, expiresAt: this.#now() + Number(value.expires_in) * 1000};
      this.#pending = null; return this.status();
    } catch (e) {
      if (generation === this.#generation) this.#pending = null;
      if (e instanceof ZhihuTransportError) throw e;
      fail(controller.signal.aborted ? 'OAUTH_CANCELLED' : 'OAUTH_EXCHANGE_FAILED', 'OAuth exchange did not complete; no automatic retry.');
    } finally {clearTimeout(timer); if (this.#exchange === controller) this.#exchange = null;}
  }
  accessToken() {this.status(); if (!this.#token) fail('USER_AUTH_REQUIRED', 'Authorize the user with Zhihu first; never fall back to the developer account.'); return this.#token.value;}
  disconnect() {this.#generation++; this.#exchange?.abort(); this.#pending = null; this.#relay = null; this.#token = null;
    return {status: 'disconnected', local_only: true, provider_token_revoked: false};}
}
