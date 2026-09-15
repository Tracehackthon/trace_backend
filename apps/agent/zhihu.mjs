import {createRequire} from 'node:module';

/** Lazy compiled boundary: disabled users can still run the dependency-free Web. */
export function createZhihuBackend(env = process.env) {
  if (env.TRACE_ZHIHU_ENABLED !== '1') return {provider: null, handle: async () => false, close() {}};
  const require = createRequire(import.meta.url);
  let createZhihuHttp, createZhihuProviderFromEnv;
  try {
    ({createZhihuHttp} = require('../../dist/packages/integration/zhihu-transport/src/http.js'));
    ({createZhihuProviderFromEnv} = require('../../dist/packages/integration/zhihu-transport/src/provider.js'));
  } catch {throw new Error('TRACE_ZHIHU_BUILD_REQUIRED: build the Trace runtime before enabling the Zhihu backend.');}
  return createZhihuHttp(createZhihuProviderFromEnv(env));
}
