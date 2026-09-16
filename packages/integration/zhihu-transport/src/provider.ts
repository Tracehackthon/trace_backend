import {ZhihuHttpTransport, ZhihuTransportError} from './index.js';
import {ZhihuOAuthSession} from './oauth.js';
import {normalizeItems, plainText, record, sourceUrl, type SearchSource} from './normalize.js';

function fail(code: string, message: string): never {throw new ZhihuTransportError(code, message);}
function shape(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).some(k => !allowed.includes(k))) fail('INVALID_INPUT', 'Unsupported Zhihu request fields.');
}
function count(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > max) fail('INVALID_INPUT', `Count must be between 1 and ${max}.`);
  return Number(value);
}
export class ZhihuProvider {
  readonly oauth: ZhihuOAuthSession;
  #secret: string; #fetch: typeof fetch; #now: () => number; #timeout: number;
  #busy = false; #cooldown = 0; #closed = false;
  #lifetime = new AbortController();
  constructor({access_secret = '', app_id, app_key, redirect_uri, loopback_forward = false, timeout_ms = 15000, fetch_impl = fetch, now = Date.now}:
    {access_secret?: string; app_id?: string; app_key?: string; redirect_uri?: string; loopback_forward?: boolean; timeout_ms?: number; fetch_impl?: typeof fetch; now?: () => number} = {}) {
    this.#secret = access_secret; this.#fetch = fetch_impl; this.#now = now; this.#timeout = timeout_ms;
    this.oauth = new ZhihuOAuthSession({...(app_id ? {app_id} : {}), ...(app_key ? {app_key} : {}), ...(redirect_uri ? {redirect_uri} : {}), loopback_forward, fetch_impl, now});
  }
  status() {const credentialConfigured = !!this.#secret.trim(); return {protocol_version: 1, enabled: !this.#closed, search_configured: credentialConfigured,
    user_content_configured: credentialConfigured,
    sources: ['zhihu', 'global'], oauth: this.oauth.status(), boundary: 'single-user-local-service',
    automatic_capture: false, full_text: false, credentials_exposed: false};}
  #transport(token?: string, signal?: AbortSignal) {
    if (this.#closed) fail('PROVIDER_CLOSED', 'Zhihu provider is closed.');
    if (!this.#secret.trim()) fail('AUTH_REQUIRED', 'Configure the backend Zhihu Access Secret first.');
    return new ZhihuHttpTransport({platform_base_url: 'https://developer.zhihu.com', hackathon_base_url: 'https://api.zhihu.com',
      access_secret_env: 'ZHIHU_ACCESS_SECRET', access_secret: this.#secret, timeout_ms: this.#timeout,
      fetch_impl: this.#fetch, ...(token ? {oauth_token: token} : {}), signal: signal ? AbortSignal.any([signal, this.#lifetime.signal]) : this.#lifetime.signal});
  }
  async #call<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#closed) fail('PROVIDER_CLOSED', 'Zhihu provider is closed.');
    if (this.#busy) fail('PROVIDER_BUSY', 'A Zhihu request is already running; queries are serial.');
    if (this.#cooldown > this.#now()) fail('RATE_LIMITED', 'Zhihu is rate limited; wait before making another request.');
    this.#busy = true;
    try {return await operation();}
    catch (e) {
      if (e instanceof ZhihuTransportError && ['RATE_LIMITED', 'ZHIHU_30001'].includes(e.code)) this.#cooldown = this.#now() + 60000;
      throw e;
    } finally {this.#busy = false;}
  }
  async search(input: unknown, signal?: AbortSignal) {
    shape(input, ['source', 'query', 'count', 'filter', 'search_db']);
    if (input.source !== 'zhihu' && input.source !== 'global') fail('INVALID_INPUT', 'Select zhihu or global explicitly.');
    if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 500 || /[\x00-\x1f\x7f]/.test(input.query)) fail('INVALID_INPUT', 'Query must be 1–500 text characters.');
    const source = input.source as SearchSource, query = input.query as string, limit = count(input.count, 3, source === 'zhihu' ? 10 : 20);
    if (source === 'zhihu' && (input.filter !== undefined || input.search_db !== undefined)) fail('INVALID_INPUT', 'Filter and SearchDB belong to global search only.');
    if (input.filter !== undefined && (typeof input.filter !== 'string' || input.filter.length > 200 || /[\r\n\x00]/.test(input.filter))) fail('INVALID_INPUT', 'Invalid global-search filter.');
    if (input.search_db !== undefined && !['all', 'realtime', 'static'].includes(String(input.search_db))) fail('INVALID_INPUT', 'Unsupported SearchDB.');
    return this.#call(async () => {
      const transport = this.#transport(undefined, signal);
      const result = source === 'zhihu' ? await transport.search(query, limit) : await transport.globalSearch(query, limit, input.filter as string | undefined, input.search_db as string | undefined);
      if (this.#closed || signal?.aborted) fail('CANCELLED', 'Zhihu request was cancelled.');
      const fetchedAt = new Date(this.#now()).toISOString(), items = normalizeItems(result.Data, source, fetchedAt, limit);
      return {protocol_version: 1, provider: 'zhihu', source, query, items, has_more: result.Data.HasMore === true,
        search_id: plainText(result.Data.SearchHashId, 200) || null, empty_reason: items.length ? null : plainText(result.Data.EmptyReason, 400) || 'no_results',
        content_mode: 'summary', fetched_at: fetchedAt, saved_to_trace: false,
        warnings: items.some(x => !x.url) ? ['Some results have no valid provider URL; do not invent a source link.'] : []};
    });
  }
  async userRead(input: unknown, signal?: AbortSignal) {
    shape(input, ['kind', 'limit', 'offset', 'favorite_id']);
    if (!['contents', 'favorites', 'favorite_lists', 'favorite_items', 'followees'].includes(String(input.kind))) fail('INVALID_INPUT', 'Unsupported authorized-user resource.');
    const limit = count(input.limit, 3, 20), offset = input.offset ?? '0';
    if (typeof offset !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(offset) || BigInt(offset) > 9223372036854775807n) fail('INVALID_INPUT', 'Offset must be a lossless Int64 string.');
    if (input.kind === 'favorite_items' ? typeof input.favorite_id !== 'string' || !/^[1-9]\d{0,18}$/.test(input.favorite_id) : input.favorite_id !== undefined)
      fail('INVALID_INPUT', 'Use a list-returned favorite_id only for favorite_items.');
    const token = this.oauth.accessToken(); // Required: no developer-account fallback.
    return this.#call(async () => {
      const transport = this.#transport(token, signal);
      try {
        const response = input.kind === 'contents' ? await transport.userContents(offset as string, limit)
          : input.kind === 'followees' ? await transport.followees(offset as string, limit)
          : input.kind === 'favorite_lists' ? await transport.favlists(offset as string, limit)
          : input.kind === 'favorite_items' ? await transport.favlistContents(input.favorite_id as string, offset as string, limit)
          : await transport.collections(offset as string, limit);
        // Reject late data from an account that was disconnected or replaced during I/O.
        if (this.oauth.accessToken() !== token) fail('USER_AUTH_CHANGED', 'Authorized account changed during the request.');
        const data = response.Data;
        if (!record(data) || !Array.isArray(data.Items)) fail('INVALID_RESPONSE', 'User API response is missing Items.');
        const fetchedAt = new Date(this.#now()).toISOString();
        const items = input.kind === 'followees' || input.kind === 'favorite_lists' ? data.Items.slice(0, limit).map(x => {
          if (!record(x)) fail('INVALID_RESPONSE', 'Invalid authorized-user item.');
          const rawId = x.UrlToken;
          const id = typeof rawId === 'string' ? rawId : typeof rawId === 'number' && Number.isSafeInteger(rawId) ? String(rawId) : null;
          return {id, title: plainText(x.Title ?? x.Name, 400), url: sourceUrl(x.Url, true), content_mode: 'metadata'};
        }) : normalizeItems(data, 'zhihu', fetchedAt, limit);
        const paging = data.Paging;
        let nextOffset: string | null = null;
        if (record(paging) && paging.IsEnd === false) {
          if (typeof paging.NextOffset !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(paging.NextOffset) || BigInt(paging.NextOffset) > 9223372036854775807n)
            fail('INVALID_RESPONSE', 'User paging requires a lossless NextOffset.');
          nextOffset = paging.NextOffset;
        }
        return {protocol_version: 1, owner: 'oauth_authorized_user', resource: input.kind, items, next_offset: nextOffset,
          fetched_at: fetchedAt, saved_to_trace: false, complete_history: false};
      } catch (e) {
        if (e instanceof ZhihuTransportError && (e.zhihu_code === 20001 || e.http_status === 401 || e.http_status === 403)) this.oauth.disconnect();
        throw e;
      }
    });
  }
  close() {this.#closed = true; this.#lifetime.abort(); this.oauth.disconnect();}
}
export function createZhihuProviderFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return new ZhihuProvider({access_secret: env.ZHIHU_ACCESS_SECRET ?? '',
    ...(env.ZHIHU_OAUTH_APP_ID ? {app_id: env.ZHIHU_OAUTH_APP_ID} : {}),
    ...(env.ZHIHU_OAUTH_APP_KEY ? {app_key: env.ZHIHU_OAUTH_APP_KEY} : {}),
    ...(env.ZHIHU_OAUTH_REDIRECT_URI ? {redirect_uri: env.ZHIHU_OAUTH_REDIRECT_URI} : {}),
    ...(env.TRACE_ZHIHU_OAUTH_LOOPBACK_FORWARD === '1' ? {loopback_forward: true} : {})});
}
