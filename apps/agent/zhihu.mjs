import {createRequire} from 'node:module';

const disabledStatus = Object.freeze({
  protocol_version: 1,
  provider: 'zhihu',
  enabled: false,
  reason: 'disabled',
  search_configured: false,
  user_content_configured: false,
  sources: ['zhihu', 'global'],
  oauth: {configured: false, status: 'not_authorized'},
  boundary: 'single-user-local-service',
  automatic_capture: false,
  full_text: false,
  credentials_exposed: false,
});

const disabledCapabilities = Object.freeze({
  protocol_version: 1,
  provider: 'zhihu',
  enabled: false,
  reason: 'disabled',
  content_mode: 'summary',
  sources: Object.freeze({
    zhihu: Object.freeze({route: '/api/search/zhihu', enabled: false}),
    global: Object.freeze({route: '/api/search/global', enabled: false}),
  }),
  boundary: 'single-user-loopback-same-origin',
});

function reply(response, status, value, headers = {}) {
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'", ...headers});
  response.end(JSON.stringify(value));
}

function disabledRequestAllowed(request, json) {
  const address = request.socket.remoteAddress;
  const host = request.headers.host;
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
  if (!loopback || typeof host !== 'string' || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) return false;
  const origin = `http://${host}`;
  return !json || request.headers.origin === origin && (!request.headers['sec-fetch-site'] || request.headers['sec-fetch-site'] === 'same-origin');
}

/** Keep the disabled product contract available without loading the optional
 * compiled provider package. The Web host can therefore expose capability
 * discovery and an explicit feature-disabled error before a build exists. */
function createDisabledZhihuBackend() {
  return {
    provider: null,
    async handle(request, response) {
      const pathname = (request.url ?? '').split('?')[0];
      if (!pathname.startsWith('/api/zhihu/') && !pathname.startsWith('/api/search/')) return false;
      if (!disabledRequestAllowed(request, request.method === 'POST')) {
        reply(response, 403, {error: {code: 'LOCAL_ONLY', reason: 'disabled', message: 'Zhihu disabled endpoints only accept local same-origin requests.'}});
        request.resume();
        return true;
      }
      if (request.method === 'GET' && pathname === '/api/zhihu/status') {
        reply(response, 200, disabledStatus);
        return true;
      }
      if (request.method === 'GET' && pathname === '/api/search/capabilities') {
        reply(response, 200, disabledCapabilities);
        return true;
      }
      // Do not parse or forward a disabled request. Returning one stable
      // machine-readable error lets the panel distinguish disabled from 404.
      reply(response, 503, {error: {code: 'FEATURE_DISABLED', reason: 'disabled', feature: 'zhihu', message: 'Zhihu search is disabled on this local backend.'}});
      request.resume();
      return true;
    },
    close() {},
  };
}

/** Lazy compiled boundary: disabled users can still run the dependency-free Web. */
export function createZhihuBackend(env = process.env) {
  if (env.TRACE_ZHIHU_ENABLED !== '1') return createDisabledZhihuBackend();
  const require = createRequire(import.meta.url);
  let createZhihuHttp, createZhihuProviderFromEnv;
  try {
    ({createZhihuHttp} = require('../../dist/packages/integration/zhihu-transport/src/http.js'));
    ({createZhihuProviderFromEnv} = require('../../dist/packages/integration/zhihu-transport/src/provider.js'));
  } catch {throw new Error('TRACE_ZHIHU_BUILD_REQUIRED: build the Trace runtime before enabling the Zhihu backend.');}
  return createZhihuHttp(createZhihuProviderFromEnv(env));
}
