const PROTOCOL_VERSION = 1;
const PRODUCT_ID = 'trace';
const PRODUCT_SERVICE_ID = 'trace-product-service';
const IDENTITY_PROTOCOL = 'trace.runtime.identity@1';
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SAFE_ID = /^[^\x00-\x1f\x7f]{1,256}$/;
let identityPromise;

class BrowserRuntimeIdentityError extends Error {
  constructor(code, message, status = 502) { super(message); this.name = 'TraceRuntimeIdentityError'; this.code = code; this.status = status; }
}

function advertisedRoutes(value) {
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.values(value).flatMap(advertisedRoutes);
}

function routeMatches(advertised, requested) {
  if (advertised === requested) return true;
  if (typeof advertised !== 'string' || typeof requested !== 'string') return false;
  const left = advertised.split('/'); const right = requested.split('/');
  return left.length === right.length && left.every((part, index) => part.startsWith(':') || part === right[index]);
}

function validate(value, route) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BrowserRuntimeIdentityError('SERVICE_IDENTITY_INVALID', '本机服务没有返回有效身份。');
  if (value.protocol_version !== PROTOCOL_VERSION || value.protocol !== IDENTITY_PROTOCOL) throw new BrowserRuntimeIdentityError('PROTOCOL_MISMATCH', '本机 Trace 服务协议版本不兼容。');
  if (value.product_id !== PRODUCT_ID || value.service_id !== PRODUCT_SERVICE_ID) throw new BrowserRuntimeIdentityError('SERVICE_IDENTITY_MISMATCH', '当前端口不是 Trace Product 服务。');
  if (value.service_role !== 'product' || value.database_role !== 'product-web') throw new BrowserRuntimeIdentityError('SERVICE_IDENTITY_MISMATCH', '当前端口没有持有 Trace Product 数据库。');
  if (typeof value.runtime_version !== 'string' || !SEMVER.test(value.runtime_version)) throw new BrowserRuntimeIdentityError('RUNTIME_VERSION_INVALID', '本机 Trace runtime 版本无效。');
  if (!['verified', 'legacy', 'unverified'].includes(value.identity_state)) throw new BrowserRuntimeIdentityError('SERVICE_IDENTITY_INVALID', '本机 Trace 服务身份状态无效。');
  if (value.identity_state !== 'verified') throw new BrowserRuntimeIdentityError('IDENTITY_UNVERIFIED', 'Trace workspace identity 未验证；没有读取或写入状态。', 503);
  const safe = value => typeof value === 'string' && SAFE_ID.test(value) && value.trim() === value && !['__proto__', 'constructor', 'prototype'].includes(value);
  if (!safe(value.workspace_id) || !safe(value.installation_id)) {
    throw new BrowserRuntimeIdentityError('IDENTITY_MISSING', 'Trace 服务没有提供有效 workspace/installation identity。');
  }
  if (route !== undefined && !advertisedRoutes(value.api_surface).some(advertised => routeMatches(advertised, route))) throw new BrowserRuntimeIdentityError('SERVICE_API_MISMATCH', `Trace 服务没有声明接口 ${route}。`);
  return value;
}

/** Browser clients must handshake before any Product/Agent/provider read or write. */
export function ensureRuntimeIdentity(route) {
  if (identityPromise === undefined) {
    const pending = fetch('/api/runtime/identity', {method: 'GET', cache: 'no-store', redirect: 'error', credentials: 'same-origin', headers: {'accept': 'application/json', 'x-trace-runtime-protocol': String(PROTOCOL_VERSION)}})
      .then(async response => {
        const value = await response.json().catch(() => null);
        if (!response.ok) throw new BrowserRuntimeIdentityError('SERVICE_HANDSHAKE_REQUIRED', `本机 Trace 服务身份握手失败（${response.status}）。`, response.status);
        return validate(value);
      });
    let settled;
    settled = pending.finally(() => { if (identityPromise === settled) identityPromise = undefined; });
    identityPromise = settled;
  }
  return identityPromise.then(identity => validate(identity, route));
}

export {BrowserRuntimeIdentityError};
