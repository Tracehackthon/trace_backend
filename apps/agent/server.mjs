import http from 'node:http';
import path from 'node:path';
import { createWebStore } from '../desktop/web-store.mjs';
import { createAgentBackend } from './backend.mjs';

// Standalone local API: explicitly select the same product DB as the Web host.
if (!process.env.TRACE_WEB_STATE_FILE || !path.isAbsolute(process.env.TRACE_WEB_STATE_FILE)) throw new Error('Set TRACE_WEB_STATE_FILE to the existing product database absolute path.');
const port = Number(process.env.TRACE_AGENT_PORT || 4174);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid TRACE_AGENT_PORT.');
const webStore = createWebStore({ file: process.env.TRACE_WEB_STATE_FILE });
let agent;
try { agent = createAgentBackend({ webStore }); } catch (error) { webStore.close(); throw error; }
const server = http.createServer(async (req, res) => {
  if (await agent.handle(req, res)) return;
  if (await webStore.handle(req, res)) return;
  res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}');
});
let closing = false;
async function close() {
  if (closing) return; closing = true;
  const stopped = new Promise(resolve => server.close(resolve));
  await agent.close(); await stopped; webStore.close();
}
server.on('error', async error => { console.error(error.code || 'SERVER_START_FAILED'); await close(); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Trace Agent API: http://127.0.0.1:${port} (enabled=${process.env.TRACE_AGENT_ENABLED === '1'})`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, close);
