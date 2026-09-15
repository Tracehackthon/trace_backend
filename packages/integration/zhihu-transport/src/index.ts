import {captureZhihuContent, type ZhihuContentInput} from '../../zhihu-precedent/src/index.js';
import {requireText as text} from '../../../core/protocol/src/index.js';

export const ZHIHU_TRANSPORT_ID = 'trace.zhihu-http-transport' as const;
export const ZHIHU_TRANSPORT_VERSION = '0.1.0' as const;

export interface ZhihuTransportProfile {
  platform_base_url: string;
  hackathon_base_url: string;
  access_secret_env: string;
  timeout_ms: number;
  user_agent?: string;
}

export interface ZhihuTransportOptions extends ZhihuTransportProfile {
  access_secret?: string;
  oauth_token?: string;
  fetch_impl?: typeof fetch;
  signal?: AbortSignal;
}

export interface ZhihuApiEnvelope<T> {
  Code: number;
  Message?: string;
  Data: T;
}

export interface ZhihuSearchItem {
  Title?: string;
  ContentType?: string;
  ContentID?: string | number;
  ContentText?: string;
  Url?: string;
  AuthorName?: string;
  AuthorUrlToken?: string;
  AnswerCount?: number;
  FollowerCount?: number;
  CommentCount?: number;
  EditTime?: string;
  Authority?: string;
  Ranking?: number;
  [key: string]: unknown;
}

export interface ZhihuSearchData {HasMore?: boolean; SearchHashId?: string; Items?: ZhihuSearchItem[]; EmptyReason?: string; [key: string]: unknown;}
export interface ZhihuHotItem {Rank?: number; Title?: string; Url?: string; Excerpt?: string; [key: string]: unknown;}
export interface ZhihuUserContent {id?: string | number; type?: string; title?: string; url?: string; excerpt?: string; created_time?: number; updated_time?: number; [key: string]: unknown;}
export interface ZhihuListData {Items?: Record<string, unknown>[]; Paging?: {IsEnd?: boolean; NextOffset?: string}; data?: ZhihuUserContent[]; paging?: {is_end?: boolean; totals?: number; next?: string; previous?: string}; [key: string]: unknown;}
export interface HackathonWork {work_id?: string; title?: string; description?: string; cover_url?: string; author?: unknown; url?: string; [key: string]: unknown;}

const PATHS = {
  search: '/api/v1/content/zhihu_search',
  globalSearch: '/api/v1/content/global_search',
  hotList: '/api/v1/content/hot_list',
  userContents: '/api/v1/user/contents',
  followees: '/api/v1/user/followees',
  favlists: '/api/v1/user/favlists',
  favlistContents: '/api/v1/user/favlist_contents',
  collections: '/api/v1/user/collections',
  hackathonStoryList: '/km-indep-home/hackathon/v2/story/list',
  hackathonStoryDetail: '/km-indep-home/hackathon/v2/story',
  hackathonKnowledgeList: '/km-indep-home/hackathon/v2/knowledge/list',
  hackathonKnowledgeDetail: '/km-indep-home/hackathon/v2/knowledge',
} as const;

function number(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${field} must be an integer between ${min} and ${max}`);
  return Number(value);
}
function workIdValue(value: string): string { const id = text(value, 'work_id', 200); if (/[\/?#\r\n]/.test(id)) throw new Error('work_id must be a single list-derived path segment'); return id; }

function baseUrl(value: string, field: string, allowedHost: string): URL {
  const url = new URL(text(value, field, 500));
  if (url.protocol !== 'https:' || url.hostname !== allowedHost || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(`${field} must be an https://${allowedHost} origin`);
  return url;
}

function offsetValue(value: number | string): string {
  const s = String(value);
  if (!/^(0|[1-9]\d{0,18})$/.test(s) || BigInt(s) > 9223372036854775807n || (typeof value === 'number' && !Number.isSafeInteger(value)))
    throw new ZhihuTransportError('INVALID_OFFSET', 'Offset must be a lossless nonnegative Int64 string.');
  return s;
}

export class ZhihuTransportError extends Error {
  readonly code: string;
  readonly http_status?: number;
  readonly zhihu_code?: number;
  constructor(code: string, message: string, details: {http_status?: number; zhihu_code?: number} = {}) {
    super(message); this.name = 'ZhihuTransportError'; this.code = code;
    if (details.http_status !== undefined) this.http_status = details.http_status;
    if (details.zhihu_code !== undefined) this.zhihu_code = details.zhihu_code;
  }
}

export class ZhihuHttpTransport {
  private readonly platform: URL;
  private readonly hackathon: URL;
  private readonly secret?: string;
  private readonly oauthToken?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly signal: AbortSignal | undefined;

  constructor(options: ZhihuTransportOptions) {
    this.platform = baseUrl(options.platform_base_url, 'platform_base_url', 'developer.zhihu.com');
    this.hackathon = baseUrl(options.hackathon_base_url, 'hackathon_base_url', 'api.zhihu.com');
    const secret = options.access_secret ?? process.env[options.access_secret_env];
    if (secret !== undefined && secret.trim().length === 0) throw new ZhihuTransportError('INVALID_AUTH', 'access_secret cannot be empty');
    if (secret !== undefined) this.secret = secret;
    if (options.oauth_token !== undefined) this.oauthToken = text(options.oauth_token, 'oauth_token', 4096);
    this.fetchImpl = options.fetch_impl ?? fetch;
    this.timeoutMs = number(options.timeout_ms, 'timeout_ms', 100, 120_000);
    this.userAgent = options.user_agent?.trim() || `${ZHIHU_TRANSPORT_ID}/${ZHIHU_TRANSPORT_VERSION}`;
    this.signal = options.signal;
  }

  async search(query: string, count = 10): Promise<ZhihuApiEnvelope<ZhihuSearchData>> {
    return this.requestPlatform<ZhihuSearchData>(PATHS.search, {Query: text(query, 'query', 500), Count: number(count, 'count', 1, 10)});
  }
  async globalSearch(query: string, count = 20, filter?: string, searchDb?: string): Promise<ZhihuApiEnvelope<ZhihuSearchData>> {
    return this.requestPlatform<ZhihuSearchData>(PATHS.globalSearch, {Query: text(query, 'query', 500), Count: number(count, 'count', 1, 20), ...(filter === undefined ? {} : {Filter: text(filter, 'filter', 200)}), ...(searchDb === undefined ? {} : {SearchDB: text(searchDb, 'search_db', 200)})});
  }
  async hotList(limit = 10): Promise<ZhihuApiEnvelope<{Items: ZhihuHotItem[]}>> {
    return this.requestPlatform<{Items: ZhihuHotItem[]}>(PATHS.hotList, {Limit: number(limit, 'limit', 1, 50)});
  }
  async userContents(offset: number | string = 0, limit = 10): Promise<ZhihuApiEnvelope<ZhihuListData>> { return this.requestPlatform<ZhihuListData>(PATHS.userContents, {ContentType: 'all', SortField: 'ts', SortOrder: 'desc', Offset: offsetValue(offset), Limit: number(limit, 'limit', 1, 50)}); }
  async followees(offset: number | string = 0, limit = 10): Promise<ZhihuApiEnvelope<ZhihuListData>> { return this.requestPlatform<ZhihuListData>(PATHS.followees, {Offset: offsetValue(offset), Limit: number(limit, 'limit', 1, 50)}); }
  async favlists(offset: number | string = 0, limit = 10): Promise<ZhihuApiEnvelope<ZhihuListData>> { if (offsetValue(offset) !== '0') throw new ZhihuTransportError('PAGING_UNSUPPORTED', 'Favorite lists do not support pagination.'); return this.requestPlatform<ZhihuListData>(PATHS.favlists, {Limit: number(limit, 'limit', 1, 50)}); }
  async favlistContents(favlistId: string, offset: number | string = 0, limit = 10): Promise<ZhihuApiEnvelope<ZhihuListData>> { return this.requestPlatform<ZhihuListData>(PATHS.favlistContents, {FavlistUrlToken: offsetValue(favlistId), Offset: offsetValue(offset), Limit: number(limit, 'limit', 1, 50)}); }
  async collections(offset: number | string = 0, limit = 10): Promise<ZhihuApiEnvelope<ZhihuListData>> { if (offsetValue(offset) !== '0') throw new ZhihuTransportError('PAGING_UNSUPPORTED', 'Recent collections have no history pagination.'); return this.requestPlatform<ZhihuListData>(PATHS.collections, {Limit: number(limit, 'limit', 1, 50)}); }

  async hackathonStoryList(): Promise<unknown> { return this.requestHackathon(PATHS.hackathonStoryList, {}); }
  async hackathonStoryDetail(workId: string): Promise<unknown> { return this.requestHackathon(`${PATHS.hackathonStoryDetail}/${encodeURIComponent(workIdValue(workId))}`, {}); }
  async hackathonKnowledgeList(): Promise<unknown> { return this.requestHackathon(PATHS.hackathonKnowledgeList, {}); }
  async hackathonKnowledgeDetail(workId: string): Promise<unknown> { return this.requestHackathon(`${PATHS.hackathonKnowledgeDetail}/${encodeURIComponent(workIdValue(workId))}`, {}); }

  async captureSearchItem(item: ZhihuSearchItem, options: {run_id: string; captured_at?: string; scope?: ZhihuContentInput['scope']; classification?: ZhihuContentInput['classification']}): Promise<ReturnType<typeof captureZhihuContent>> {
    const contentId = item.ContentID === undefined ? undefined : String(item.ContentID);
    const url = item.Url; // Never guess an answer/article ID into a question URL.
    const content = item.ContentText ?? item.Title;
    return captureZhihuContent({...(contentId === undefined ? {} : {external_id: contentId}), ...(item.Title === undefined ? {} : {title: item.Title}), ...(url === undefined ? {} : {url}), ...(content === undefined ? {} : {content}), ...(item.ContentType === undefined ? {} : {content_type: item.ContentType}), captured_at: options.captured_at ?? new Date().toISOString()}, {run_id: options.run_id, ...(options.scope === undefined ? {} : {scope: options.scope}), ...(options.classification === undefined ? {} : {classification: options.classification})});
  }

  private async requestPlatform<T>(pathname: string, query: Record<string, string | number>): Promise<ZhihuApiEnvelope<T>> { return this.requestJson<ZhihuApiEnvelope<T>>(new URL(pathname, this.platform), query, true); }
  private async requestHackathon(pathname: string, query: Record<string, string | number>): Promise<unknown> { return this.requestJson<unknown>(new URL(pathname, this.hackathon), query, false); }
  private async requestJson<T>(url: URL, query: Record<string, string | number>, authenticated: boolean): Promise<T> {
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const headers = new Headers({'Accept': 'application/json', 'User-Agent': this.userAgent});
    if (authenticated) {
      if (!this.secret) throw new ZhihuTransportError('AUTH_REQUIRED', 'Zhihu Access Secret is not configured; set the configured environment variable');
      headers.set('Authorization', `Bearer ${this.secret}`);
      headers.set('X-Request-Timestamp', String(Math.floor(Date.now() / 1000)));
      headers.set('Content-Type', 'application/json');
      if (this.oauthToken && url.pathname.startsWith('/api/v1/user/')) headers.set('X-OAuth-Token', this.oauthToken);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response, body: unknown;
    try {
      response = await this.fetchImpl(url, {method: 'GET', headers, redirect: 'error', signal: this.signal ? AbortSignal.any([this.signal, controller.signal]) : controller.signal});
      if (!response.ok) throw new ZhihuTransportError(response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR', `Zhihu returned HTTP ${response.status}`, {http_status: response.status});
      let bytes = 0; const chunks: Uint8Array[] = [];
      if (response.body) for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        bytes += chunk.byteLength;
        if (bytes > 1024 * 1024) throw new ZhihuTransportError('RESPONSE_TOO_LARGE', 'Zhihu response exceeded 1 MiB.');
        chunks.push(chunk);
      }
      try { body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))); }
      catch { throw new ZhihuTransportError('INVALID_JSON', 'Zhihu returned invalid JSON.'); }
    } catch (error) {
      if (error instanceof ZhihuTransportError) throw error;
      if (this.signal?.aborted) throw new ZhihuTransportError('CANCELLED', 'Zhihu request cancelled.');
      if (controller.signal.aborted) throw new ZhihuTransportError('TIMEOUT', 'Zhihu request timed out.');
      throw new ZhihuTransportError('NETWORK_ERROR', 'Zhihu connection failed; no automatic retry.');
    } finally { clearTimeout(timer); }
    if (!body || typeof body !== 'object') throw new ZhihuTransportError('INVALID_RESPONSE', 'Zhihu response must be a JSON object', {http_status: response.status});
    if (authenticated) {
      const envelope = body as Record<string, unknown>;
      if (!Number.isInteger(envelope.Code)) throw new ZhihuTransportError('INVALID_RESPONSE', 'Zhihu response is missing numeric Code', {http_status: response.status});
      if (envelope.Code !== 0) throw new ZhihuTransportError(`ZHIHU_${String(envelope.Code)}`, 'Zhihu API rejected the request.', {http_status: response.status, zhihu_code: Number(envelope.Code)});
      if (!('Data' in envelope)) throw new ZhihuTransportError('INVALID_RESPONSE', 'Zhihu response is missing Data', {http_status: response.status});
      return body as T;
    }
    return body as T;
  }
}
