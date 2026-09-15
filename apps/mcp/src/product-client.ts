import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';

export interface TraceProductArtifact {
  title: string;
  kind: 'file' | 'test' | 'link' | 'note';
  path?: string;
  url?: string;
  digest?: string;
}

export interface TraceProductReturnInput {
  projectDir: string;
  workId: string;
  deliveryId: string;
  contextHash: string;
  matterId: string;
  fact: string;
  summary?: string;
  interpretation?: string;
  unconfirmed?: string;
  proposedUnderstanding?: string;
  artifacts?: TraceProductArtifact[];
}

interface ProductClientOptions {
  baseUrl?: string;
  sessionId?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface ProductErrorBody { error?: {code?: unknown; message?: unknown}; }

export class TraceProductClientError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

export function resolveBaseUrl(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new TraceProductClientError('INVALID_PRODUCT_URL', 'TRACE_PRODUCT_URL must be a valid loopback URL'); }
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if (parsed.protocol !== 'http:' || !loopback || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) {
    throw new TraceProductClientError('INVALID_PRODUCT_URL', 'TRACE_PRODUCT_URL must be an HTTP loopback origin without credentials or a path');
  }
  return parsed.origin;
}

export function currentCodexSessionId(environment: NodeJS.ProcessEnv = process.env): string {
  const value = environment.CODEX_THREAD_ID ?? environment.CODEX_SESSION_ID;
  if (!value || value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new TraceProductClientError('CODEX_SESSION_UNAVAILABLE', 'Codex did not provide a usable task/session identity to the Trace MCP process');
  }
  return value;
}

function returnCommandId(sessionId: string, input: TraceProductReturnInput): string {
  const digest = createHash('sha256').update(JSON.stringify({sessionId, ...input})).digest('hex');
  return `codex-return:${digest}`;
}

export class TraceProductClient {
  readonly baseUrl: string;
  readonly sessionId: string;
  readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ProductClientOptions = {}) {
    this.baseUrl = resolveBaseUrl(options.baseUrl ?? process.env.TRACE_PRODUCT_URL ?? 'http://127.0.0.1:4173');
    this.sessionId = options.sessionId ?? currentCodexSessionId();
    this.timeoutMs = Math.max(250, Math.min(30_000, Math.floor(options.timeoutMs ?? 5_000)));
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request(route: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${route}`, {
        method: 'POST',
        headers: {'content-type': 'application/json', origin: this.baseUrl, 'x-trace-host': 'codex-mcp'},
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      throw new TraceProductClientError(timedOut ? 'PRODUCT_TIMEOUT' : 'PRODUCT_UNAVAILABLE', timedOut
        ? 'Trace product service did not respond before the local timeout'
        : 'Trace product service is not reachable; start or restart the local Trace desktop service');
    } finally { clearTimeout(timer); }
    let value: unknown;
    try { value = JSON.parse(await response.text()); } catch { throw new TraceProductClientError('INVALID_PRODUCT_RESPONSE', 'Trace product service returned invalid JSON', response.status); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TraceProductClientError('INVALID_PRODUCT_RESPONSE', 'Trace product service returned an invalid response shape', response.status);
    if (!response.ok) {
      const error = (value as ProductErrorBody).error;
      throw new TraceProductClientError(typeof error?.code === 'string' ? error.code : 'PRODUCT_REQUEST_FAILED', typeof error?.message === 'string' ? error.message : `Trace product request failed (${response.status})`, response.status);
    }
    return value as Record<string, unknown>;
  }

  receive(input: {projectDir: string; workId?: string}): Promise<Record<string, unknown>> {
    if (!path.isAbsolute(input.projectDir)) throw new TraceProductClientError('INVALID_PROJECT_DIR', 'project_dir must be absolute');
    const commandId = `codex-receive:${this.sessionId}:${randomUUID()}`;
    return this.request('/api/product/codex/receive', {
      protocolVersion: 1,
      commandId,
      sessionId: this.sessionId,
      projectDir: path.resolve(input.projectDir),
      ...(input.workId === undefined ? {} : {workId: input.workId}),
    });
  }

  returnResult(input: TraceProductReturnInput): Promise<Record<string, unknown>> {
    if (!path.isAbsolute(input.projectDir)) throw new TraceProductClientError('INVALID_PROJECT_DIR', 'project_dir must be absolute');
    const result = {
      matterId: input.matterId,
      fact: input.fact,
      ...(input.summary === undefined ? {} : {summary: input.summary}),
      ...(input.interpretation === undefined ? {} : {interpretation: input.interpretation}),
      ...(input.unconfirmed === undefined ? {} : {unconfirmed: input.unconfirmed}),
      ...(input.proposedUnderstanding === undefined ? {} : {proposedUnderstanding: input.proposedUnderstanding}),
      ...(input.artifacts === undefined ? {} : {artifacts: input.artifacts}),
    };
    return this.request('/api/product/codex/return', {
      protocolVersion: 1,
      commandId: returnCommandId(this.sessionId, input),
      workId: input.workId,
      sessionId: this.sessionId,
      projectDir: path.resolve(input.projectDir),
      deliveryId: input.deliveryId,
      contextHash: input.contextHash,
      result,
    });
  }
}
