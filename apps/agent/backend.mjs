import path from 'node:path';
import fs from 'node:fs';
import { createAgentStore } from './store.mjs';
import { createAgentService } from './service.mjs';
import { createExecutorRegistry } from './profiles.mjs';
import { createAgentHttp } from './http.mjs';
import { demand, hash } from './protocol.mjs';
import { createSensemakingWorker } from './sensemaking-worker.mjs';
import { buildServiceIdentity, DATABASE_ROLES, TRACE_AGENT_SERVICE_ID } from '../../runtime-identity.mjs';

export const AGENT_API_SURFACE = Object.freeze({
  runtime: ['/api/runtime/identity'],
  agent: ['/api/agent/capabilities', '/api/agent/check', '/api/agent/runs', '/api/agent/runs/:id', '/api/agent/runs/:id/events', '/api/agent/runs/:id/cancel', '/api/agent/runs/:id/adoption', '/api/agent/requests/:id', '/api/agent/sensemaking/health', '/api/agent/sensemaking/drain'],
});

/** Agent-only backend. Content-source and account routes are mounted by the
 * desktop host, so Web clients can distinguish /api/search, /api/zhihu and
 * /api/agent without the Agent runtime owning provider HTTP. */
export function createAgentBackend({ productWorkspace, env = process.env, retrievalProvider = null } = {}) {
  if (env.TRACE_AGENT_ENABLED !== '1') return createAgentHttp();
  const file = path.resolve(env.TRACE_AGENT_STATE_FILE || path.join(path.dirname(productWorkspace.file), 'agent.sqlite'));
  demand(file.toLowerCase() !== path.resolve(productWorkspace.file).toLowerCase(), 'INVALID_AGENT_DB', 'Agent 数据库不能覆盖产品数据库。', 500);
  const productIdentity = typeof productWorkspace.getIdentity === 'function' ? productWorkspace.getIdentity() : productWorkspace.identity;
  demand(productIdentity && productIdentity.verification_state === 'verified', 'PRODUCT_IDENTITY_UNVERIFIED', 'Product 数据库身份未验证；Agent 不会在未绑定的工作区启动。', 503);
  const timeoutMs = Number(env.TRACE_AGENT_TIMEOUT_MS || 180000);
  demand(Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 600000, 'INVALID_CONFIG', 'TRACE_AGENT_TIMEOUT_MS 需为 1000—600000。', 500);
  const store = createAgentStore({ file, workspaceIdentity: productIdentity, legacyWorkspaceKey: hash(fs.realpathSync(productWorkspace.file)),
    runtimeVersion: productIdentity.runtime_version, allowLegacyIdentity: env.TRACE_ALLOW_LEGACY_IDENTITY === '1', upgradeLegacyIdentity: env.TRACE_UPGRADE_LEGACY_IDENTITY === '1' });
  try {
    const executorRegistry = createExecutorRegistry({ env });
    executorRegistry.describe(); // fail startup before accepting work when server-owned config is invalid
    const sensemakingMode = env.TRACE_SENSEMAKING_MODE ?? 'disabled';
    demand(['disabled', 'fixture-dev', 'profile', 'shadow'].includes(sensemakingMode), 'INVALID_CONFIG', 'TRACE_SENSEMAKING_MODE 只支持 disabled、fixture-dev、profile 或 shadow。', 500);
    let sensemakingWorker = null;
    if (sensemakingMode !== 'disabled') {
      if (['profile', 'shadow'].includes(sensemakingMode)) demand(typeof env.TRACE_SENSEMAKING_PROFILE_ID === 'string' && env.TRACE_SENSEMAKING_PROFILE_ID.trim(), 'INVALID_CONFIG', '真实 sensemaking profile 必须由 TRACE_SENSEMAKING_PROFILE_ID 明确配置。', 500);
      sensemakingWorker = createSensemakingWorker({productWorkspace, agentStore: store,
        mode: sensemakingMode === 'fixture-dev' ? 'fixture' : sensemakingMode,
        profileId: env.TRACE_SENSEMAKING_PROFILE_ID, env,
        pollMs: Number(env.TRACE_SENSEMAKING_POLL_MS || 1000)});
      sensemakingWorker.start({pollMs: Number(env.TRACE_SENSEMAKING_POLL_MS || 1000), maxConcurrent: 1});
    }
    const agentDatabaseIdentity = typeof store.getIdentity === 'function' ? store.getIdentity() : store.identity;
    const serviceIdentity = buildServiceIdentity({serviceId: TRACE_AGENT_SERVICE_ID, serviceRole: 'agent', runtimeVersion: agentDatabaseIdentity?.runtime_version ?? productIdentity.runtime_version,
      ...(agentDatabaseIdentity?.installation_id === null || agentDatabaseIdentity?.installation_id === undefined ? {} : {installationId: agentDatabaseIdentity.installation_id}),
      ...(agentDatabaseIdentity?.workspace_id === null || agentDatabaseIdentity?.workspace_id === undefined ? {} : {workspaceId: agentDatabaseIdentity.workspace_id}),
      identityState: agentDatabaseIdentity?.verification_state ?? 'unverified',
      databaseRole: DATABASE_ROLES.agent, apiSurface: AGENT_API_SURFACE});
    return createAgentHttp({ sensemakingWorker, serviceIdentity, service: createAgentService({ store, readWorkspace: productWorkspace.read,
      executeProduct: productWorkspace.execute, adoptCandidate: productWorkspace.adoptAgentCandidate,
      executorRegistry, timeoutMs, retrievalProvider }) });
  } catch (e) { store.close(); throw e; }
}
