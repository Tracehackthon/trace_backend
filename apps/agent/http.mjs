import { AgentError, demand, identity, keys, TERMINAL, PURPOSES } from './protocol.mjs';
import { VERIFIED_CODEX_VERSION } from './codex.mjs';

const MAX_BODY = 96 * 1024;
function reply(res, status, value, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin', ...extra });
  res.end(JSON.stringify(value));
}
function origin(req, write) {
  demand(['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress), 'LOCAL_ONLY', 'Agent 接口仅支持本机调用。', 403);
  demand(typeof req.headers.host === 'string' && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(req.headers.host), 'UNTRUSTED_HOST', '不接受外部 Host。', 403);
  const expected = new URL(`${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`).origin;
  if (write || req.headers.origin !== undefined) demand(req.headers.origin === expected, 'ORIGIN_REQUIRED', '必须从当前本机服务的同源入口调用。', 403);
  if (req.headers['sec-fetch-site'] !== undefined) demand(req.headers['sec-fetch-site'] === 'same-origin' || !write && req.headers['sec-fetch-site'] === 'none', 'CROSS_SITE_REQUEST', '不接受跨站调用。', 403);
}
async function readBody(req) {
  demand(/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(req.headers['content-type'] ?? ''), 'JSON_REQUIRED', '需要 application/json。', 415);
  demand(!req.headers['content-encoding'] || req.headers['content-encoding'] === 'identity', 'ENCODING_NOT_SUPPORTED', '不接受压缩请求。', 415);
  if (req.headers['content-length'] !== undefined) demand(Number(req.headers['content-length']) <= MAX_BODY, 'BODY_TOO_LARGE', '请求过大。', 413);
  return new Promise((resolve, reject) => {
    let bytes = 0; const chunks = [];
    const done = (error, value) => {
      clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', fail);
      error ? reject(error) : resolve(value);
    };
    const fail = () => done(new AgentError('REQUEST_ABORTED', '请求中断。', 400));
    const data = chunk => { bytes += chunk.length; if (bytes > MAX_BODY) done(new AgentError('BODY_TOO_LARGE', '请求过大。', 413)); else chunks.push(chunk); };
    const end = () => { try { done(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { done(new AgentError('INVALID_JSON', '需要有效 UTF-8 JSON。', 400)); } };
    const timer = setTimeout(() => done(new AgentError('REQUEST_TIMEOUT', '请求接收超时。', 408)), 10000);
    req.on('data', data); req.on('end', end); req.on('error', fail); req.on('aborted', fail);
  });
}

/** Reusable Node HTTP middleware; no UI dependency, CORS wildcard, shell/cwd,
 * auth-token, arbitrary model, or arbitrary provider override in request bodies. */
export function createAgentHttp({ service = null, maxStreams = 16 } = {}) {
  const streams = new Set(); let checking = false, closed = false;
  return {
    async handle(req, res) {
      const pathname = String(req.url ?? '').split('?')[0];
      if (pathname !== '/api/agent' && !pathname.startsWith('/api/agent/')) return false;
      try {
        origin(req, req.method !== 'GET');
        demand(!closed, 'AGENT_CLOSED', 'Agent 接口已关闭。', 503);
        if (pathname === '/api/agent/capabilities' && req.method === 'GET') {
          reply(res, 200, { protocolVersion: 1, enabled: !!service, runtime: 'codex-app-server', verifiedVersion: VERIFIED_CODEX_VERSION,
            purposes: PURPOSES, contextTools: ['trace_context_read', 'trace_context_search'], streaming: 'sse',
            cancellation: true, externalRetrieval: false, fileExecution: false, autoApply: false, authenticationChecked: false,
            boundary: 'single-user-loopback-same-origin' }); return true;
        }
        demand(service, 'AGENT_DISABLED', 'Agent 后端未启用；请设置 TRACE_AGENT_ENABLED=1 后启动后端。', 503);
        const runMatch = /^\/api\/agent\/runs\/([a-zA-Z0-9-]+)(?:\/(events|cancel))?$/.exec(pathname);
        const requestMatch = /^\/api\/agent\/requests\/([^/]+)$/.exec(pathname);
        const allowed = pathname === '/api/agent/runs' || pathname === '/api/agent/check' || runMatch?.[2] === 'cancel' ? 'POST' : runMatch || requestMatch ? 'GET' : null;
        demand(allowed, 'NOT_FOUND', '没有这个 Agent 接口。', 404);
        if (req.method !== allowed) { reply(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '不支持这个方法。' } }, { allow: allowed }); return true; }
        if (pathname === '/api/agent/check') {
          demand(keys(await readBody(req), []), 'INVALID_REQUEST', '连接检查不接受参数。', 400);
          demand(!checking, 'CHECK_BUSY', '正在检查连接。', 429); checking = true;
          const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 35000);
          res.once('close', abort);
          try { reply(res, 200, await service.check(controller.signal)); }
          finally { clearTimeout(timer); res.off('close', abort); checking = false; }
        } else if (pathname === '/api/agent/runs') {
          const result = service.create(await readBody(req)); reply(res, result.replay ? 200 : 202, result, { location: `/api/agent/runs/${result.run.runId}` });
        } else if (requestMatch) {
          let id; try { id = decodeURIComponent(requestMatch[1]); } catch {}
          demand(identity(id), 'INVALID_REQUEST_ID', '请求 ID 无效。', 400); reply(res, 200, service.byRequest(id));
        } else if (runMatch[2] === 'cancel') {
          demand(keys(await readBody(req), []), 'INVALID_REQUEST', '取消接口只接受空对象。', 400); reply(res, 200, service.cancel(runMatch[1]));
        } else if (runMatch[2] !== 'events') reply(res, 200, service.get(runMatch[1]));
        else {
          const runId = runMatch[1], run = service.get(runId), url = new URL(req.url, 'http://127.0.0.1');
          const cursor = req.headers['last-event-id'] ?? url.searchParams.get('after') ?? '0';
          demand(typeof cursor === 'string' && /^(0|[1-9]\d*)$/.test(cursor) && Number.isSafeInteger(Number(cursor)) && Number(cursor) <= run.lastEventId,
            'INVALID_CURSOR', '事件游标无效或超过已保存事件。', 400);
          demand(streams.size < maxStreams, 'STREAM_LIMIT', '事件连接过多，请先关闭旧连接。', 429);
          let after = Number(cursor), heartbeat, unsubscribe;
          const close = () => { clearInterval(heartbeat); unsubscribe?.(); streams.delete(close); if (!res.writableEnded) res.end(); };
          const send = e => {
            if (e.sequence <= after || res.destroyed || res.writableEnded) return;
            if (res.writableLength > 1024 * 1024) { close(); return; } // reconnect using Last-Event-ID
            after = e.sequence;
            res.write(`id: ${e.sequence}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
            if (e.type.startsWith('run.') && TERMINAL.has(e.data.status)) close();
          };
          res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
            'x-accel-buffering': 'no', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' });
          res.flushHeaders(); streams.add(close); res.once('close', close);
          unsubscribe = service.subscribe(runId, send);
          for (;;) { const page = service.events(runId, after); if (!page.length) break; for (const e of page) send(e); if (res.writableEnded || page.length < 512) break; }
          if (TERMINAL.has(run.status) || res.writableEnded) close();
          else heartbeat = setInterval(() => { if (res.writableLength > 1024 * 1024) close(); else res.write(': keep-alive\n\n'); }, 15000);
        }
      } catch (cause) {
        req.resume(); const error = cause instanceof AgentError ? cause : new AgentError('AGENT_UNAVAILABLE', 'Agent 后端暂不可用，原文未改变。', 503);
        if (!res.headersSent) reply(res, error.status, { error: { code: error.code, message: error.message } }); else if (!res.writableEnded) res.end();
      }
      return true;
    },
    async close() { if (closed) return; closed = true; for (const close of [...streams]) close(); await service?.close(); },
  };
}
