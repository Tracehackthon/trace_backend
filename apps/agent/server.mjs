import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createProductWorkspace } from '../../packages/product/workspace/src/workspace.mjs';
import { createAgentBackend } from './backend.mjs';
import { acquireStateOwner } from '../desktop/state-owner.mjs';

// Standalone local API: explicitly select the same product DB as the Web host.
if (!process.env.TRACE_WEB_STATE_FILE || !path.isAbsolute(process.env.TRACE_WEB_STATE_FILE)) throw new Error('Set TRACE_WEB_STATE_FILE to the existing product database absolute path.');
const port = Number(process.env.TRACE_AGENT_PORT || 4174);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid TRACE_AGENT_PORT.');
const productFile = path.resolve(process.env.TRACE_WEB_STATE_FILE);
let productWorkspace, agent, releaseOwner;
const server = http.createServer(async (req, res) => {
  if (!productWorkspace || !agent) { res.writeHead(503); res.end('Trace is starting or stopping'); return; }
  if (await agent.handle(req, res)) return;
  if (await productWorkspace.handle(req, res)) return;
  res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}');
});
let closingPromise;
async function close() {
  if (closingPromise) return closingPromise;
  closingPromise = (async () => {
    const stopped = new Promise(resolve => server.close(resolve));
    let firstError;
    try { await agent?.close(); } catch (error) { firstError = error; }
    await stopped;
    try { productWorkspace?.close(); } catch (error) { firstError ??= error; }
    releaseOwner?.();
    if (firstError) throw firstError;
  })();
  return closingPromise;
}
server.on('error', error => {
  console.error(error.code || 'SERVER_START_FAILED');
  void close().catch(console.error).finally(() => { process.exitCode = 1; });
});
server.listen(port, '127.0.0.1', () => {
  try {
    if (!fs.existsSync(productFile)) throw new Error('Standalone Agent requires an existing product database.');
    releaseOwner = acquireStateOwner(productFile);
    productWorkspace = createProductWorkspace({ file: productFile });
    agent = createAgentBackend({ productWorkspace });
    console.log(`Trace Agent API: http://127.0.0.1:${port} (enabled=${process.env.TRACE_AGENT_ENABLED === '1'})`);
  } catch (error) {
    console.error(error);
    void close().catch(console.error).finally(() => { process.exitCode = 1; });
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().catch(error => { console.error(error); process.exitCode = 1; }); });
