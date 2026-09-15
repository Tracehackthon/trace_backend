import http from 'node:http';
import {createRequire} from 'node:module';

// No credentials are read here. Disable query/body access logging at the proxy.
const {createZhihuOAuthRelay} = createRequire(import.meta.url)('../../dist/packages/integration/zhihu-transport/src/relay.js');
const relay = createZhihuOAuthRelay({app_id: process.env.ZHIHU_OAUTH_APP_ID, redirect_uri: process.env.ZHIHU_OAUTH_REDIRECT_URI});
const port = Number(process.env.TRACE_OAUTH_RELAY_PORT || 4175);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid TRACE_OAUTH_RELAY_PORT');
const server = http.createServer(async (req, res) => {
  if (!await relay.handle(req, res)) {res.writeHead(404); res.end();}
});
server.requestTimeout = 15000; server.headersTimeout = 10000;
server.listen(port, '127.0.0.1', () => console.log(`Trace OAuth code relay: http://127.0.0.1:${port} (HTTPS proxy required)`));
const stop = () => {relay.close(); server.close(); server.closeIdleConnections();};
process.once('SIGTERM', stop); process.once('SIGINT', stop);
