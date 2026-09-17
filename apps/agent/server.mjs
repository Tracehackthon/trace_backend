import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProductWorkspace } from '../../packages/product/workspace/src/workspace.mjs';
import { AGENT_API_SURFACE, createAgentBackend } from './backend.mjs';
import { buildServiceIdentity, DATABASE_ROLES, TRACE_AGENT_SERVICE_ID, resolveRuntimeRoot } from '../../runtime-identity.mjs';
import { loadRuntimeIdentity } from '../desktop/runtime-identity.mjs';

// Standalone local API: explicitly select the same product DB as the Web host.
if (!process.env.TRACE_WEB_STATE_FILE || !path.isAbsolute(process.env.TRACE_WEB_STATE_FILE)) throw new Error('Set TRACE_WEB_STATE_FILE to the existing product database absolute path.');
const port = Number(process.env.TRACE_AGENT_PORT || 4174);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid TRACE_AGENT_PORT.');
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../desktop');
const repositoryRoot = path.resolve(desktopRoot, '../..');
const configuredRuntimeRoot = process.env.TRACE_RUNTIME_ROOT;
if (configuredRuntimeRoot !== undefined && !path.isAbsolute(configuredRuntimeRoot)) throw new Error('TRACE_RUNTIME_ROOT must be an absolute runtime root');
const validatedRuntimeRoot = resolveRuntimeRoot(configuredRuntimeRoot ?? repositoryRoot, {explicit: configuredRuntimeRoot !== undefined}).root;
if (path.resolve(validatedRuntimeRoot).toLowerCase() !== path.resolve(repositoryRoot).toLowerCase()) throw new Error('TRACE_RUNTIME_ROOT does not match the Agent entrypoint runtime');
const runtime = loadRuntimeIdentity(desktopRoot);
const productWorkspace = createProductWorkspace({ file: process.env.TRACE_WEB_STATE_FILE,
  runtimeVersion: runtime.runtime_version,
  ...(process.env.TRACE_WORKSPACE_ID === undefined ? {} : {workspaceId: process.env.TRACE_WORKSPACE_ID}),
  ...(process.env.TRACE_INSTALLATION_ID === undefined ? {} : {installationId: process.env.TRACE_INSTALLATION_ID}),
  allowLegacyIdentity: process.env.TRACE_ALLOW_LEGACY_IDENTITY === '1',
  upgradeLegacyIdentity: process.env.TRACE_UPGRADE_LEGACY_IDENTITY === '1',
});
let agent;
try { agent = createAgentBackend({ productWorkspace }); } catch (error) { productWorkspace.close(); throw error; }
const fallbackAgentIdentity = buildServiceIdentity({serviceId: TRACE_AGENT_SERVICE_ID, serviceRole: 'agent', runtimeVersion: runtime.runtime_version,
  installationId: productWorkspace.identity.installation_id, workspaceId: productWorkspace.identity.workspace_id,
  identityState: productWorkspace.identity.verification_state, databaseRole: DATABASE_ROLES.agent, apiSurface: AGENT_API_SURFACE});
const agentIdentity = agent.serviceIdentity ?? fallbackAgentIdentity;
function rejectIdentityRequest(req, res) {
  const host = req.headers.host;
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if (!loopback || typeof host !== 'string' || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) {
    res.writeHead(403, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
    res.end(JSON.stringify({error: {code: 'LOCAL_ONLY', message: 'Agent identity handshake only accepts loopback hosts.'}})); return true;
  }
  const expected = `${req.socket.encrypted ? 'https' : 'http'}://${host}`;
  if (req.headers.origin !== undefined && req.headers.origin !== expected) {
    res.writeHead(403, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
    res.end(JSON.stringify({error: {code: 'ORIGIN_REQUIRED', message: 'Agent identity handshake must use the local same-origin endpoint.'}})); return true;
  }
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    res.writeHead(403, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
    res.end(JSON.stringify({error: {code: 'CROSS_SITE_REQUEST', message: 'Agent identity handshake rejects cross-site requests.'}})); return true;
  }
  return false;
}
const server = http.createServer(async (req, res) => {
  if (req.url?.split('?')[0] === '/api/runtime/identity') {
    if (rejectIdentityRequest(req, res)) return;
    if (req.method !== 'GET') { res.writeHead(405, {'content-type': 'application/json; charset=utf-8', allow: 'GET'}); res.end(JSON.stringify({error: {code: 'METHOD_NOT_ALLOWED', message: '只支持 GET 身份握手。'}})); return; }
    res.writeHead(200, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-trace-runtime-protocol': '1'}); res.end(JSON.stringify(agentIdentity)); return;
  }
  if (await agent.handle(req, res)) return;
  if (await productWorkspace.handle(req, res)) return;
  res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}');
});
let closing = false;
async function close() {
  if (closing) return; closing = true;
  const stopped = new Promise(resolve => server.close(resolve));
  await agent.close(); await stopped; productWorkspace.close();
}
server.on('error', async error => { console.error(error.code || 'SERVER_START_FAILED'); await close(); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Trace Agent API: http://127.0.0.1:${port} (enabled=${process.env.TRACE_AGENT_ENABLED === '1'})`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, close);
