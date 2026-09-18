import {fetchProductServiceIdentity, resolveBaseUrl, TraceProductClientError, validateProductServiceIdentity, type TraceServiceIdentity} from './product-client.js';

export class TraceZhihuClient {
  private readonly baseUrl: string;
  private identityPromise: Promise<TraceServiceIdentity> | undefined;
  constructor(baseUrl = process.env.TRACE_PRODUCT_URL ?? 'http://127.0.0.1:4173') {this.baseUrl = resolveBaseUrl(baseUrl);}
  async call(route: 'status' | 'oauth/start' | 'oauth/check' | 'oauth/disconnect' | 'user/read', body?: unknown): Promise<Record<string, unknown>> {
    return this.request(`/api/zhihu/${route}`, body);
  }
  /** Public content search is separate from account/OAuth routes. The source
   * is encoded by the route and can never be silently changed by a payload. */
  async search(source: 'zhihu' | 'global', body: unknown): Promise<Record<string, unknown>> {
    return this.request(`/api/search/${source}`, body);
  }
  private async ensureHandshake(route: string): Promise<void> {
    // The standalone provider adapter does not own a Product SQLite file, so
    // it may advertise an explicit `unverified` service state.  The desktop
    // host mounts the same routes behind its verified Product handshake; when
    // that endpoint is available its IDs are still compared below.
    if (this.identityPromise === undefined) {
      const pending = fetchProductServiceIdentity(this.baseUrl, {timeoutMs: 20_000, requireVerified: false});
      let settled!: Promise<TraceServiceIdentity>;
      settled = pending.finally(() => { if (this.identityPromise === settled) this.identityPromise = undefined; });
      this.identityPromise = settled;
    }
    const identity = await this.identityPromise;
    validateProductServiceIdentity(identity, {
      ...(process.env.TRACE_WORKSPACE_ID === undefined ? {} : {workspaceId: process.env.TRACE_WORKSPACE_ID}),
      ...(process.env.TRACE_INSTALLATION_ID === undefined ? {} : {installationId: process.env.TRACE_INSTALLATION_ID}),
      ...(process.env.TRACE_EXPECTED_RUNTIME_VERSION === undefined ? {} : {runtimeVersion: process.env.TRACE_EXPECTED_RUNTIME_VERSION}),
      requireVerified: false,
      requiredRoute: route,
    });
  }
  private async request(path: string, body?: unknown): Promise<Record<string, unknown>> {
    await this.ensureHandshake(path);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: controller.signal,
        headers: {origin: this.baseUrl, 'content-type': 'application/json', 'x-trace-runtime-protocol': '1'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
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
