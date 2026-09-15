import path from 'node:path';
import fs from 'node:fs';
import { createAgentStore } from './store.mjs';
import { createAgentService } from './service.mjs';
import { createExecutorRegistry } from './profiles.mjs';
import { createAgentHttp } from './http.mjs';
import { demand, hash } from './protocol.mjs';

/** Agent-only backend. Content-source and account routes are mounted by the
 * desktop host, so Web clients can distinguish /api/search, /api/zhihu and
 * /api/agent without the Agent runtime owning provider HTTP. */
export function createAgentBackend({ productWorkspace, env = process.env, retrievalProvider = null } = {}) {
  if (env.TRACE_AGENT_ENABLED !== '1') return createAgentHttp();
  const file = path.resolve(env.TRACE_AGENT_STATE_FILE || path.join(path.dirname(productWorkspace.file), 'agent.sqlite'));
  demand(file.toLowerCase() !== path.resolve(productWorkspace.file).toLowerCase(), 'INVALID_AGENT_DB', 'Agent 数据库不能覆盖产品数据库。', 500);
  const timeoutMs = Number(env.TRACE_AGENT_TIMEOUT_MS || 180000);
  demand(Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 600000, 'INVALID_CONFIG', 'TRACE_AGENT_TIMEOUT_MS 需为 1000—600000。', 500);
  const store = createAgentStore({ file, workspaceKey: hash(fs.realpathSync(productWorkspace.file)) });
  try {
    const executorRegistry = createExecutorRegistry({ env });
    executorRegistry.describe(); // fail startup before accepting work when server-owned config is invalid
    return createAgentHttp({ service: createAgentService({ store, readWorkspace: productWorkspace.read,
      executeProduct: productWorkspace.execute, adoptCandidate: productWorkspace.adoptAgentCandidate,
      executorRegistry, timeoutMs, retrievalProvider }) });
  } catch (e) { store.close(); throw e; }
}
