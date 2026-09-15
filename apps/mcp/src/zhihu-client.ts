import {resolveBaseUrl, TraceProductClientError} from './product-client.js';

export class TraceZhihuClient {
  private readonly baseUrl: string;
  constructor(baseUrl = process.env.TRACE_PRODUCT_URL ?? 'http://127.0.0.1:4173') {this.baseUrl = resolveBaseUrl(baseUrl);}
  async call(route: 'status' | 'oauth/start' | 'oauth/check' | 'oauth/disconnect' | 'user/read', body?: unknown): Promise<Record<string, unknown>> {
    return this.request(`/api/zhihu/${route}`, body);
  }
  /** Public content search is separate from account/OAuth routes. The source
   * is encoded by the route and can never be silently changed by a payload. */
  async search(source: 'zhihu' | 'global', body: unknown): Promise<Record<string, unknown>> {
    return this.request(`/api/search/${source}`, body);
  }
  private async request(path: string, body?: unknown): Promise<Record<string, unknown>> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: controller.signal,
        headers: {origin: this.baseUrl, 'content-type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
      let size = 0; const chunks: Uint8Array[] = [];
      if (response.body) for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {size += chunk.length; if (size > 256 * 1024) throw new Error('oversize'); chunks.push(chunk);}
      const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))) as Record<string, unknown>;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid response');
      if (!response.ok) {
        const raw = value.error as {code?: unknown} | undefined;
        const code = typeof raw?.code === 'string' && /^[A-Z_0-9]{1,80}$/.test(raw.code) ? raw.code : 'ZHIHU_REQUEST_FAILED';
        throw new TraceProductClientError(code, `Trace Zhihu service reported ${code}. Check configuration or complete user authorization.`, response.status);
      }
      return value;
    } catch (e) {if (e instanceof TraceProductClientError) throw e;
      throw new TraceProductClientError(controller.signal.aborted ? 'ZHIHU_TIMEOUT' : 'ZHIHU_UNAVAILABLE', 'Start the local Trace backend with Zhihu enabled; no automatic retry.');
    } finally {clearTimeout(timer);}
  }
}
