import { AgentError, demand, plain } from './protocol.mjs';

const MAX_REMOTE_BODY = 512 * 1024;

export function validateRemoteEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new AgentError('INVALID_PROFILE', '远程执行地址无效。', 500); }
  demand(!url.username && !url.password && !url.hash && !url.search, 'INVALID_PROFILE', '远程执行地址不能携带凭据、查询或片段。', 500);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  demand(url.protocol === 'https:' || url.protocol === 'http:' && loopback, 'INVALID_PROFILE', '远程执行只允许 HTTPS；本机测试可使用 loopback HTTP。', 500);
  return url.toString();
}

export function authHeaders(profile, env) {
  if (!profile.credentialEnv) return {};
  const credential = env[profile.credentialEnv];
  demand(typeof credential === 'string' && credential.length > 0 && credential.length <= 8192 && !/[\r\n\0]/.test(credential),
    'PROFILE_CREDENTIAL_UNAVAILABLE', '所选 Agent profile 的服务端凭据不可用。', 503);
  return profile.authScheme === 'x-api-key' ? { 'x-api-key': credential } : { authorization: `Bearer ${credential}` };
}

async function boundedJson(response) {
  demand(response.body, 'REMOTE_PROTOCOL_ERROR', '远程执行服务没有返回响应体。', 502);
  const reader = response.body.getReader();
  const chunks = []; let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_REMOTE_BODY) { await reader.cancel(); throw new AgentError('REMOTE_RESPONSE_TOO_LARGE', '远程执行响应超过大小限制。', 502); }
    chunks.push(value);
  }
  let result;
  try {
    const body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))));
    result = JSON.parse(body);
  } catch { throw new AgentError('REMOTE_PROTOCOL_ERROR', '远程执行服务返回了无效 JSON。', 502); }
  demand(plain(result), 'REMOTE_PROTOCOL_ERROR', '远程执行服务返回了无效对象。', 502);
  return result;
}

/** Exact server-configured endpoint, no redirects, bounded JSON, sanitized errors. */
export async function postRemoteJson({ endpoint, profile, env, body, signal, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'content-type': 'application/json', accept: 'application/json', ...authHeaders(profile, env) },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    if (signal?.aborted) throw new AgentError('CANCELLED', '请求已取消。', 409);
    throw new AgentError('REMOTE_UNAVAILABLE', '无法连接所选远程执行服务。', 503);
  }
  demand(response.status >= 200 && response.status < 300, 'REMOTE_REJECTED', '远程执行服务拒绝了请求。', 502);
  demand(/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? ''),
    'REMOTE_PROTOCOL_ERROR', '远程执行服务必须返回 application/json。', 502);
  return boundedJson(response);
}
