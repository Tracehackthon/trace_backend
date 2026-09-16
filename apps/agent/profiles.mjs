import fs from 'node:fs';
import path from 'node:path';
import { AgentError, demand, hash, identity, integer, keys, text } from './protocol.mjs';
import { assertExecutor } from './runtime.mjs';
import { validateRemoteEndpoint } from './remote-http.mjs';
import { createCodexAdapter, VERIFIED_CODEX_VERSION } from './codex.mjs';
import { createModelAdapter } from './model.mjs';
import { createExternalAgentAdapter, EXTERNAL_AGENT_PROTOCOL } from './external-agent.mjs';

const PROFILE_LIMIT = 16;
const COMMON = ['id', 'label', 'kind', 'enabled', 'version'];
const AUTH = ['endpoint', 'credentialEnv', 'authScheme'];
const SENSEMAKING = ['sensemaking'];

function validateSensemakingConfig(value) {
  if (value === undefined) return;
  demand(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_PROFILE', 'sensemaking profile 配置必须是对象。', 500);
  const allowed = new Set(['timeoutMs', 'maxSteps', 'maxInputBytes', 'maxOutputBytes', 'maxAttempts', 'toolSet']);
  demand(Object.keys(value).every(key => allowed.has(key)), 'INVALID_PROFILE', 'sensemaking profile 配置包含未知字段。', 500);
  const bounds = [['timeoutMs', 1000, 120000], ['maxInputBytes', 1024, 2 * 1024 * 1024], ['maxOutputBytes', 1024, 128 * 1024], ['maxAttempts', 1, 10]];
  for (const [key, min, max] of bounds) if (value[key] !== undefined) demand(integer(value[key]) && value[key] >= min && value[key] <= max, 'INVALID_PROFILE', `sensemaking.${key} 超出允许边界。`, 500);
  if (value.maxSteps !== undefined) demand(integer(value.maxSteps) && value.maxSteps >= 0 && value.maxSteps <= 12, 'INVALID_PROFILE', 'sensemaking.maxSteps 超出允许边界。', 500);
  if (value.toolSet !== undefined) demand(Array.isArray(value.toolSet) && value.toolSet.length <= 4 && value.toolSet.every(item => item === 'trace_context_read' || item === 'trace_context_search'), 'INVALID_PROFILE', 'sensemaking.toolSet 只能是受控只读工具。', 500);
}

function validateCommon(profile) {
  demand(identity(profile.id) && profile.id.length <= 80 && ['codex', 'model', 'agent'].includes(profile.kind)
    && (profile.label === undefined || identity(profile.label) && profile.label.length <= 120)
    && (profile.enabled === undefined || typeof profile.enabled === 'boolean')
    && integer(profile.version) && profile.version > 0, 'INVALID_PROFILE', 'Agent profile 的 id、kind 或 version 无效。', 500);
}

function validateAuth(profile) {
  profile.endpoint = validateRemoteEndpoint(profile.endpoint);
  demand(profile.credentialEnv === undefined || /^[A-Z][A-Z0-9_]{0,127}$/.test(profile.credentialEnv),
    'INVALID_PROFILE', 'credentialEnv 必须是服务端环境变量名。', 500);
  demand(profile.authScheme === undefined || ['bearer', 'x-api-key'].includes(profile.authScheme),
    'INVALID_PROFILE', 'authScheme 只支持 bearer 或 x-api-key。', 500);
  profile.authScheme ??= 'bearer';
}

function validateProfile(value) {
  demand(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_PROFILE', 'Agent profile 必须是对象。', 500);
  const profile = structuredClone(value); validateCommon(profile);
  validateSensemakingConfig(profile.sensemaking);
  if (profile.kind === 'codex') {
    demand(keys(profile, [...COMMON, ...SENSEMAKING, 'executable', 'model', 'runtimeRoot'])
      && (profile.executable === undefined || text(profile.executable, 1000) && profile.executable.trim())
      && (profile.model === undefined || identity(profile.model))
      && (profile.runtimeRoot === undefined || path.isAbsolute(profile.runtimeRoot)),
    'INVALID_PROFILE', 'Codex profile 配置无效。', 500);
  } else if (profile.kind === 'model') {
    demand(keys(profile, [...COMMON, ...SENSEMAKING, ...AUTH, 'model']) && identity(profile.model),
      'INVALID_PROFILE', 'Model profile 需要固定的 endpoint 和 model。', 500);
    validateAuth(profile);
  } else {
    demand(keys(profile, [...COMMON, ...SENSEMAKING, ...AUTH, 'protocol']) && (profile.protocol === undefined || profile.protocol === EXTERNAL_AGENT_PROTOCOL),
      'INVALID_PROFILE', `Agent profile 只支持 ${EXTERNAL_AGENT_PROTOCOL}。`, 500);
    profile.protocol = EXTERNAL_AGENT_PROTOCOL; validateAuth(profile);
  }
  profile.enabled ??= true;
  return profile;
}

function legacyDocument(env) {
  return { protocolVersion: 1, configVersion: 1, ownerId: 'local-user', defaultProfileId: 'local-codex', profiles: [{
    id: 'local-codex', label: 'Local Codex', kind: 'codex', enabled: true, version: 1,
    ...(env.TRACE_CODEX_BIN ? { executable: env.TRACE_CODEX_BIN } : {}),
    ...(env.TRACE_CODEX_MODEL ? { model: env.TRACE_CODEX_MODEL } : {}),
    ...(env.TRACE_AGENT_RUNTIME_ROOT ? { runtimeRoot: env.TRACE_AGENT_RUNTIME_ROOT } : {}),
  }] };
}

function loadDocument(env) {
  if (!env.TRACE_AGENT_PROFILES_FILE) return legacyDocument(env);
  demand(path.isAbsolute(env.TRACE_AGENT_PROFILES_FILE), 'INVALID_PROFILE_CONFIG', 'TRACE_AGENT_PROFILES_FILE 必须是绝对路径。', 500);
  let raw;
  try {
    const stat = fs.statSync(env.TRACE_AGENT_PROFILES_FILE);
    demand(stat.isFile() && stat.size <= 64 * 1024, 'INVALID_PROFILE_CONFIG', 'Agent profile 文件必须是不超过 64 KiB 的普通文件。', 500);
    raw = fs.readFileSync(env.TRACE_AGENT_PROFILES_FILE, 'utf8');
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError('INVALID_PROFILE_CONFIG', '无法读取 Agent profile 文件。', 500);
  }
  let document;
  try { document = JSON.parse(raw); } catch { throw new AgentError('INVALID_PROFILE_CONFIG', 'Agent profile 文件不是有效 JSON。', 500); }
  demand(keys(document, ['protocolVersion', 'configVersion', 'ownerId', 'defaultProfileId', 'profiles'])
    && document.protocolVersion === 1 && integer(document.configVersion) && document.configVersion > 0
    && identity(document.ownerId) && identity(document.defaultProfileId) && Array.isArray(document.profiles)
    && document.profiles.length > 0 && document.profiles.length <= PROFILE_LIMIT,
  'INVALID_PROFILE_CONFIG', 'Agent profile 文件结构无效。', 500);
  const profiles = document.profiles.map(validateProfile);
  demand(new Set(profiles.map(profile => profile.id)).size === profiles.length, 'INVALID_PROFILE_CONFIG', 'Agent profile id 不能重复。', 500);
  demand(profiles.some(profile => profile.id === document.defaultProfileId && profile.enabled),
    'INVALID_PROFILE_CONFIG', '默认 Agent profile 不存在或未启用。', 500);
  return { ...document, profiles };
}

function safeProfile(document, profile) {
  const capabilities = profile.kind === 'codex'
    ? { tools: true, streaming: true, cancellation: true, output: 'trace-result-v1' }
    : { tools: true, streaming: false, cancellation: true, output: 'trace-result-v1' };
  return { profileId: profile.id, label: profile.label ?? profile.id, kind: profile.kind, ownerId: document.ownerId,
    version: profile.version, revision: hash({ configVersion: document.configVersion, ownerId: document.ownerId, profile }), capabilities,
    serviceIdentity: profile.kind === 'model' ? 'openai-chat-completions-v1' : profile.kind === 'agent' ? EXTERNAL_AGENT_PROTOCOL : `codex-app-server/${VERIFIED_CODEX_VERSION}`,
    ...(profile.kind === 'codex' ? { verifiedRuntimeVersion: VERIFIED_CODEX_VERSION } : {}),
    ...(profile.kind === 'model' ? { model: profile.model } : {}),
    ...(profile.kind === 'agent' ? { protocol: profile.protocol } : {}),
    ...(profile.sensemaking === undefined ? {} : {sensemaking: structuredClone(profile.sensemaking)}) };
}

/** Reloaded server-side profiles. Public descriptors never contain endpoints,
 * executable paths, credential environment names, or credential values. */
export function createExecutorRegistry({ env = process.env, factories = {} } = {}) {
  const make = {
    codex: factories.codex ?? ((profile, document) => createCodexAdapter({ executable: profile.executable, model: profile.model,
      ...(profile.runtimeRoot ? { runtimeRoot: profile.runtimeRoot } : {}),
      redactEnvKeys: document.profiles.map(candidate => candidate.credentialEnv).filter(Boolean), env })),
    model: factories.model ?? (profile => createModelAdapter({ profile, env })),
    agent: factories.agent ?? (profile => createExternalAgentAdapter({ profile, env })),
  };
  const locate = profileId => {
    const document = loadDocument(env), selectedId = profileId ?? document.defaultProfileId;
    demand(identity(selectedId), 'INVALID_PROFILE_ID', 'Agent profileId 无效。', 400);
    const profile = document.profiles.find(candidate => candidate.id === selectedId);
    demand(profile, 'PROFILE_NOT_FOUND', '所选 Agent profile 不存在。', 404);
    demand(profile.enabled, 'PROFILE_REVOKED', '所选 Agent profile 已停用。', 403);
    if (profile.credentialEnv) demand(typeof env[profile.credentialEnv] === 'string' && env[profile.credentialEnv].length > 0
      && env[profile.credentialEnv].length <= 8192 && !/[\r\n\0]/.test(env[profile.credentialEnv]),
      'PROFILE_CREDENTIAL_UNAVAILABLE', '所选 Agent profile 的服务端凭据不可用。', 503);
    return { document, profile, binding: safeProfile(document, profile) };
  };
  return {
    describe() {
      const document = loadDocument(env);
      return { defaultProfileId: document.defaultProfileId,
        profiles: document.profiles.filter(profile => profile.enabled).map(profile => safeProfile(document, profile)) };
    },
    bind(profileId) {
      const found = locate(profileId);
      return { binding: found.binding, executor: assertExecutor(make[found.profile.kind](found.profile, found.document)) };
    },
    resolve(binding) {
      const found = locate(binding?.profileId);
      demand(found.binding.ownerId === binding.ownerId && found.binding.kind === binding.kind
        && found.binding.version === binding.version && found.binding.revision === binding.revision,
      'PROFILE_CHANGED', '运行绑定的 Agent profile 已变化；旧执行不能继续。', 409);
      return { binding: found.binding, executor: assertExecutor(make[found.profile.kind](found.profile, found.document)) };
    },
    isCurrent(binding) {
      try {
        const found = locate(binding?.profileId);
        return found.binding.ownerId === binding.ownerId && found.binding.kind === binding.kind
          && found.binding.version === binding.version && found.binding.revision === binding.revision;
      } catch { return false; }
    },
    async check(profileId, signal) {
      const selected = this.bind(profileId);
      return { profile: selected.binding, ...(await selected.executor.check({ signal })) };
    },
  };
}
