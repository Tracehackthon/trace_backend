import path from 'node:path';
import fs from 'node:fs';
import { createAgentStore } from './store.mjs';
import { createAgentService } from './service.mjs';
import { createCodexAdapter } from './codex.mjs';
import { createAgentHttp } from './http.mjs';
import { demand, hash } from './protocol.mjs';

export function createAgentBackend({ webStore, env = process.env } = {}) {
  if (env.TRACE_AGENT_ENABLED !== '1') return createAgentHttp();
  const file = path.resolve(env.TRACE_AGENT_STATE_FILE || path.join(path.dirname(webStore.file), 'agent.sqlite'));
  demand(file.toLowerCase() !== path.resolve(webStore.file).toLowerCase(), 'INVALID_AGENT_DB', 'Agent 数据库不能覆盖产品数据库。', 500);
  const timeoutMs = Number(env.TRACE_AGENT_TIMEOUT_MS || 180000);
  demand(Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 600000, 'INVALID_CONFIG', 'TRACE_AGENT_TIMEOUT_MS 需为 1000—600000。', 500);
  const store = createAgentStore({ file, workspaceKey: hash(fs.realpathSync(webStore.file)) });
  try {
    const adapter = createCodexAdapter({ executable: env.TRACE_CODEX_BIN || 'codex', model: env.TRACE_CODEX_MODEL,
      ...(env.TRACE_AGENT_RUNTIME_ROOT ? { runtimeRoot: env.TRACE_AGENT_RUNTIME_ROOT } : {}), env });
    return createAgentHttp({ service: createAgentService({ store, readWorkspace: webStore.read, adapter, timeoutMs }) });
  } catch (e) { store.close(); throw e; }
}
