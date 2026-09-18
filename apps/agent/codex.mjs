import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { AgentError, demand, hash, identity, integer, keys, plain, text, OUTPUT_SCHEMA, SENSEMAKING_OUTPUT_SCHEMA } from './protocol.mjs';
import { contextManifest, createRunToolBridge, TRACE_BOUNDED_ANALYSIS_INSTRUCTIONS, TRACE_NATIVE_CODEX_INSTRUCTIONS, TRACE_AGENT_RETRIEVAL_INSTRUCTIONS, TRACE_SENSEMAKING_INSTRUCTIONS } from './runtime.mjs';
import { CODEX_APP_SERVER_PROTOCOL_PROFILE, validateCodexAppServerInstallation, validateCodexAppServerVersion } from '../../native/codex-compatibility.mjs';

const INTERACTION_DECISIONS = Object.freeze(['accept', 'accept_for_session', 'decline', 'cancel']);
const INTERACTION_TTL_MS = 120000;

function safeInteractionText(value, max = 200) {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/[\r\n\t]+/g, ' ').trim();
  if (!compact || compact.length > max) return null;
  // Never place command-like text, absolute paths, URLs or secret-looking
  // material in the durable interaction event. The actual RPC payload stays
  // inside the owned Codex process and is never copied to Trace storage.
  if (/https?:\/\/|(?:[A-Za-z]:[\\/]|\/)|(?:token|secret|password|api[_-]?key|authorization)\s*[:=]/i.test(compact)) return null;
  return compact;
}

function projectRelativePath(value, projectCwd) {
  if (typeof value !== 'string' || !projectCwd) return null;
  try {
    const root = path.resolve(projectCwd), candidate = path.resolve(root, value);
    const relative = path.relative(root, candidate).replaceAll('\\', '/');
    if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return null;
    return relative;
  } catch { return null; }
}

function safePath(value, projectCwd) {
  if (typeof value === 'string') return projectRelativePath(value, projectCwd) ?? 'outside-project';
  if (plain(value)) {
    if (typeof value.path === 'string') return projectRelativePath(value.path, projectCwd) ?? 'outside-project';
    if (typeof value.pattern === 'string') return safeInteractionText(value.pattern, 160) ?? 'pattern';
    if (typeof value.value === 'string') return safeInteractionText(value.value, 80) ?? 'special';
  }
  return null;
}

function permissionSummary(value, projectCwd) {
  if (!plain(value)) return null;
  const result = {};
  const fileSystem = plain(value.fileSystem) ? value.fileSystem : null;
  if (fileSystem) {
    const fsSummary = {};
    for (const access of ['read', 'write']) {
      if (Array.isArray(fileSystem[access])) fsSummary[access] = fileSystem[access].slice(0, 32).map(entry => safePath(entry, projectCwd)).filter(Boolean);
    }
    if (Array.isArray(fileSystem.entries)) fsSummary.entries = fileSystem.entries.slice(0, 32).map(entry => ({
      access: ['read', 'write', 'deny'].includes(entry?.access) ? entry.access : 'unknown', path: safePath(entry?.path, projectCwd),
    }));
    if (Number.isSafeInteger(fileSystem.globScanMaxDepth)) fsSummary.globScanMaxDepth = fileSystem.globScanMaxDepth;
    if (Object.keys(fsSummary).length) result.fileSystem = fsSummary;
  }
  if (plain(value.network)) result.network = { enabled: value.network.enabled === true };
  return Object.keys(result).length ? result : null;
}

function safeNetworkHost(value) {
  if (typeof value !== 'string') return null;
  const host = value.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/, 1)[0];
  return /^[a-z0-9.-]{1,253}(?::\d{1,5})?$/i.test(host) ? host.toLowerCase() : null;
}

function summarizeCommandActions(actions, projectCwd) {
  if (!Array.isArray(actions)) return undefined;
  return actions.slice(0, 32).map(action => ({
    type: ['read', 'listFiles', 'search', 'unknown'].includes(action?.type) ? action.type : 'unknown',
    path: safePath(action?.path, projectCwd),
    query: action?.type === 'search' ? safeInteractionText(action?.query, 120) : undefined,
  }));
}

function deepSubset(granted, requested) {
  if (granted === requested) return true;
  if (granted === null || granted === undefined || requested === null || requested === undefined) return false;
  if (Array.isArray(granted)) return Array.isArray(requested) && granted.every(item => requested.some(candidate => deepSubset(item, candidate)));
  if (plain(granted)) return plain(requested) && Object.entries(granted).every(([key, value]) => Object.hasOwn(requested, key) && deepSubset(value, requested[key]));
  return false;
}

function interactionMethodKind(method) {
  if (method === 'item/tool/requestUserInput') return 'input';
  return 'approval';
}

function safeInteraction({ interactionId, runId, profileId, threadId, turnId, itemId, requestId, method, params, createdAt, expiresAt, projectCwd }) {
  const kind = interactionMethodKind(method);
  const safe = { interactionId, runId: runId ?? null, profileId: profileId ?? null, threadId: threadId ?? null, turnId: turnId ?? null, itemId: itemId ?? null, requestId: String(requestId), method, kind, state: 'waiting', recoverable: true, revision: null, createdAt, expiresAt };
  const reason = safeInteractionText(params?.reason ?? params?.message);
  if (reason) safe.reason = reason;
  if (params?.kind === 'writeStdin' || params?.kind === 'command') safe.requestKind = params.kind;
  const commandActions = summarizeCommandActions(params?.commandActions, projectCwd);
  if (commandActions) safe.commandActions = commandActions;
  const additional = permissionSummary(params?.additionalPermissions ?? params?.permissions, projectCwd);
  if (additional) safe.permissions = additional;
  const host = safeNetworkHost(params?.networkApprovalContext?.host ?? params?.networkApprovalContext?.hostname);
  if (host) safe.network = { host };
  if (plain(params?.fileChanges)) {
    const files = Object.keys(params.fileChanges).slice(0, 32).map(file => ({ path: safePath(file, projectCwd), action: 'change' }));
    if (files.length) safe.fileChanges = files;
  }
  if (Array.isArray(params?.questions)) {
    safe.questions = params.questions.slice(0, 16).map(question => ({
      id: typeof question?.id === 'string' ? question.id.slice(0, 128) : null,
      header: safeInteractionText(question?.header, 120),
      question: safeInteractionText(question?.question, 500),
      optionCount: Array.isArray(question?.options) ? Math.min(question.options.length, 32) : 0,
      isSecret: question?.is_secret === true || question?.isSecret === true,
    })).filter(question => question.id);
  }
  return safe;
}

function boundedAnswer(value, max = 16000) {
  demand(typeof value === 'string' && value.length <= max && !value.includes('\0'), 'INVALID_INTERACTION_RESPONSE', '交互回答无效。', 400);
  return value;
}

function responseForInteraction(interaction, params, body) {
  const decision = body?.decision;
  if (interaction.method === 'item/tool/requestUserInput') {
    demand(keys(body, ['interactionId', 'expectedRevision', 'idempotencyKey', 'answers']), 'INVALID_INTERACTION_RESPONSE', '输入回答字段无效。', 400);
    demand(plain(body.answers) && Object.keys(body.answers).length <= 32, 'INVALID_INTERACTION_RESPONSE', '输入回答数量无效。', 400);
    const known = new Set((params?.questions ?? []).map(question => question?.id).filter(identity));
    const answers = {};
    for (const [id, value] of Object.entries(body.answers)) {
      demand(known.has(id) && plain(value) && keys(value, ['answers']) && Array.isArray(value.answers) && value.answers.length <= 16, 'INVALID_INTERACTION_RESPONSE', '输入回答不属于当前问题。', 400);
      answers[id] = { answers: value.answers.map(answer => boundedAnswer(answer)) };
    }
    demand(Object.keys(answers).length > 0, 'INVALID_INTERACTION_RESPONSE', '至少需要回答一个问题。', 400);
    return { answers };
  }
  if (interaction.method === 'mcpServer/elicitation/request') {
    demand(keys(body, ['interactionId', 'expectedRevision', 'idempotencyKey', 'decision', 'content']), 'INVALID_INTERACTION_RESPONSE', 'MCP 交互字段无效。', 400);
    demand(INTERACTION_DECISIONS.includes(decision), 'INVALID_INTERACTION_RESPONSE', '审批决定无效。', 400);
    const action = decision === 'accept' || decision === 'accept_for_session' ? 'accept' : decision === 'decline' ? 'decline' : 'cancel';
    if (action === 'accept') demand(body.content === undefined || plain(body.content), 'INVALID_INTERACTION_RESPONSE', 'MCP 交互内容必须是对象。', 400);
    return { action, ...(action === 'accept' && body.content !== undefined ? { content: body.content } : {}) };
  }
  demand(keys(body, ['interactionId', 'expectedRevision', 'idempotencyKey', 'decision', 'permissions']), 'INVALID_INTERACTION_RESPONSE', '审批字段无效。', 400);
  demand(INTERACTION_DECISIONS.includes(decision), 'INVALID_INTERACTION_RESPONSE', '审批决定无效。', 400);
  if (interaction.method === 'item/permissions/requestApproval') {
    demand(decision !== 'accept_for_session', 'INVALID_INTERACTION_RESPONSE', '权限审批不支持会话级永久授权。', 400);
    if (decision === 'accept') {
      const requested = params?.permissions ?? params?.additionalPermissions;
      const granted = body.permissions === undefined ? structuredClone(requested) : body.permissions;
      demand(plain(granted) && keys(granted, ['fileSystem', 'network']) && (granted.fileSystem === null || plain(granted.fileSystem))
        && (granted.network === null || plain(granted.network)), 'INVALID_INTERACTION_RESPONSE', '权限范围无效。', 400);
      demand(plain(requested) && deepSubset(granted, requested), 'INVALID_INTERACTION_RESPONSE', '授予的权限超出了本次请求范围。', 400);
      return { permissions: granted, scope: 'turn' };
    }
    return { permissions: { fileSystem: null, network: null }, scope: 'turn' };
  }
  if (interaction.method === 'applyPatchApproval' || interaction.method === 'execCommandApproval') {
    // Legacy v1 ReviewDecision is defined by Codex's app-server protocol as
    // approved / approved_for_session / abort / timed_out or
    // { denied: { rejection } }; do not send the newer item/* decision enum.
    const legacy = decision === 'accept' ? 'approved' : decision === 'accept_for_session' ? 'approved_for_session'
      : decision === 'decline' ? { denied: { rejection: 'Trace 用户拒绝了本次请求。' } } : 'abort';
    return { decision: legacy };
  }
  return { decision: decision === 'accept_for_session' ? 'acceptForSession' : decision };
}


// This policy was exercised against the wire request of this exact runtime.
// An unknown CLI must be requalified, not silently inherit new native tools.
export const VERIFIED_CODEX_VERSION = CODEX_APP_SERVER_PROTOCOL_PROFILE.default_version;
export const VERIFIED_CODEX_VERSIONS = CODEX_APP_SERVER_PROTOCOL_PROFILE.tested_versions;
export const CODEX_EXECUTION_MODES = Object.freeze(['bounded-analysis', 'native']);
export const BOUNDED_ANALYSIS_MODE = 'bounded-analysis';
export const NATIVE_CODEX_MODE = 'native';
export const BOUNDED_CONFIG = Object.freeze({
  ...Object.fromEntries(['hooks', 'plugins', 'apps', 'memories', 'shell_tool', 'unified_exec', 'browser_use', 'browser_use_external',
    'computer_use', 'image_generation', 'view_image', 'multi_agent', 'multi_agent_v2', 'code_mode',
    'skill_search', 'workspace_dependencies', 'goals', 'sleep_tool', 'tool_suggest', 'shell_snapshot', 'remote_plugin',
    'skill_mcp_dependency_install', 'request_permissions_tool'].map(name => [`features.${name}`, false])),
  // Catalogs with tool_mode=code_mode_only need the isolated orchestration host
  // even when native filesystem/shell/browser capabilities are disabled.
  'features.code_mode_host': true,
  'agents.enabled': false,
  'features.skip_host_skill_discovery': true, project_doc_max_bytes: 0, web_search: 'disabled',
  'history.persistence': 'none', 'analytics.enabled': false, 'otel.log_user_prompt': false,
  notify: [], approval_policy: 'never', sandbox_mode: 'read-only',
});
function toml(value) {
  if (Array.isArray(value)) return `[${value.map(toml).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}=${toml(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function boundedCodexEnv(env, redactEnvKeys = []) {
  const childEnv = { ...env };
  for (const key of Object.keys(childEnv)) if (/^CODEX_(?:THREAD|SESSION|TURN|TASK|INTERNAL|CALLER|MANAGED)/.test(key) || /^ZHIHU_/i.test(key)) delete childEnv[key];
  for (const key of redactEnvKeys) delete childEnv[key];
  return childEnv;
}

/** Newline JSON-RPC, bounded frames, concurrent notifications/server requests,
 * no raw prompts, provider errors, stderr or credentials in public diagnostics. */
export class CodexConnection {
  constructor({ executable, cwd, env, config, rpcTimeoutMs = 30000, spawnProcess = spawn }) {
    this.pending = new Map(); this.sequence = 0; this.closed = false; this.buffer = ''; this.rpcTimeoutMs = rpcTimeoutMs;
    this.onNotification = () => {}; this.onRequest = async () => { throw new AgentError('TOOL_NOT_ALLOWED', '不支持此宿主请求。'); };
    this.child = spawnProcess(executable, ['app-server', '--stdio', ...Object.entries(config).flatMap(([k, v]) => ['-c', `${k}=${toml(v)}`])],
      { cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.receive(chunk));
    this.child.stderr.on('data', () => {}); // Drain, but do not persist private runtime diagnostics.
    this.child.stdin.on('error', () => this.fail(new AgentError('CODEX_DISCONNECTED', 'Codex 连接已断开。', 502)));
    this.child.on('error', () => this.fail(new AgentError('CODEX_UNAVAILABLE', '无法启动 Codex；请检查 CLI 可执行文件。', 503)));
    this.child.on('close', () => { clearTimeout(this.killTimer); this.fail(new AgentError('CODEX_DISCONNECTED', 'Codex 进程已退出。', 502)); });
  }
  send(value) { if (!this.closed) this.child.stdin.write(`${JSON.stringify(value)}\n`); }
  rpc(method, params) {
    if (this.closed) return Promise.reject(this.failure ?? new AgentError('CODEX_DISCONNECTED', 'Codex 连接已断开。', 502));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new AgentError('CODEX_RPC_TIMEOUT', 'Codex 握手或协议请求超时。', 504)); }, this.rpcTimeoutMs);
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params });
    });
  }
  receive(chunk) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 2 * 1024 * 1024) return this.fail(new AgentError('CODEX_FRAME_TOO_LARGE', 'Codex 事件超过大小限制。', 502));
    let offset;
    while ((offset = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, offset); this.buffer = this.buffer.slice(offset + 1);
      if (!line.trim()) continue;
      let value;
      try { value = JSON.parse(line); } catch { this.fail(new AgentError('CODEX_PROTOCOL_ERROR', 'Codex 返回无效协议事件。', 502)); return; }
      if (!plain(value) || !(typeof value.method === 'string' || value.id !== undefined)) {
        this.fail(new AgentError('CODEX_PROTOCOL_ERROR', 'Codex 返回无效 RPC 对象。', 502)); return;
      }
      if (value.id !== undefined && !value.method) {
        const p = this.pending.get(value.id); if (!p) continue;
        this.pending.delete(value.id); clearTimeout(p.timer);
        if (value.error) p.reject(new AgentError('CODEX_RPC_ERROR', 'Codex 拒绝了协议请求；请核验版本、登录或运行配置。', 502)); else p.resolve(value.result);
      } else if (value.id !== undefined) {
        Promise.resolve().then(() => this.onRequest(value.method, value.params, value.id)).then(result => this.send({ id: value.id, result }),
          () => this.send({ id: value.id, error: { code: -32601, message: 'This capability is not available in Trace bounded mode.' } }));
      } else {
        try { this.onNotification(value.method, value.params); }
        catch (error) { this.fail(error instanceof AgentError ? error : new AgentError('CODEX_PROTOCOL_ERROR', 'Codex 事件处理失败。', 502)); }
      }
    }
  }
  fail(error, graceful = false) {
    if (this.closed) return;
    this.closed = true; this.failure = error;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.onFailure?.(error);
    if (graceful) {
      this.child.stdin.end();
      this.killTimer = setTimeout(() => this.child.kill(), 1000); this.killTimer.unref?.();
    } else this.child.kill();
  }
  async close() {
    const exited = this.child.exitCode !== null || this.child.signalCode !== null;
    const wait = exited ? Promise.resolve() : once(this.child, 'close').catch(() => {});
    this.fail(new AgentError('CODEX_DISCONNECTED', 'Codex 连接关闭。', 502), true);
    this.child.stdin.end();
    let timer;
    await Promise.race([wait, new Promise(resolve => { timer = setTimeout(resolve, 2000); })]); clearTimeout(timer);
  }
}

export function createCodexAdapter({ executable = process.env.TRACE_CODEX_BIN || 'codex', model = process.env.TRACE_CODEX_MODEL,
  runtimeRoot = path.join(os.tmpdir(), 'trace-agent-runtime'), env = process.env, rpcTimeoutMs = 30000,
  redactEnvKeys = [], mode = BOUNDED_ANALYSIS_MODE, projectCwd, cwd: configuredCwd, spawnProcess = spawn,
  // Library-only test/provider configuration. Never accepted from HTTP callers.
  providerConfig = {}, interactionTtlMs = INTERACTION_TTL_MS } = {}) {
  demand(CODEX_EXECUTION_MODES.includes(mode), 'INVALID_CODEX_MODE', `Codex execution mode 必须是 ${CODEX_EXECUTION_MODES.join(' 或 ')}。`, 500);
  const nativeMode = mode === NATIVE_CODEX_MODE;
  demand(Number.isSafeInteger(interactionTtlMs) && interactionTtlMs >= 1000 && interactionTtlMs <= 600000, 'INVALID_CONFIG', 'interactionTtlMs 必须在 1000—600000 之间。', 500);
  const configuredProjectCwd = projectCwd ?? configuredCwd;
  if (nativeMode) demand(typeof configuredProjectCwd === 'string' && path.isAbsolute(configuredProjectCwd),
    'CODEX_PROJECT_CWD_REQUIRED', 'native Codex profile 必须配置绝对 projectCwd。', 500);
  runtimeRoot = path.resolve(runtimeRoot);
  // Native mode must use only the configured project cwd; it does not need or
  // create a scratch root. Bounded mode owns its disposable run directories.
  if (!nativeMode) fs.mkdirSync(runtimeRoot, { recursive: true });
  const activeControls = new Map();
  async function open(signal) {
    demand(!signal?.aborted, 'CANCELLED', '请求已取消。', 409);
    let cwd, generatedCwd = false;
    if (nativeMode) {
      try { cwd = fs.realpathSync(configuredProjectCwd); }
      catch { throw new AgentError('CODEX_PROJECT_CWD_UNAVAILABLE', 'native Codex 选定的项目目录不可用。', 503); }
      try { demand(fs.statSync(cwd).isDirectory(), 'CODEX_PROJECT_CWD_UNAVAILABLE', 'native Codex 选定的项目目录不是目录。', 503); }
      catch (error) { if (error instanceof AgentError) throw error; throw new AgentError('CODEX_PROJECT_CWD_UNAVAILABLE', 'native Codex 选定的项目目录不可用。', 503); }
    } else {
      cwd = fs.mkdtempSync(path.join(runtimeRoot, 'run-')); generatedCwd = true;
      fs.mkdirSync(path.join(cwd, '.git')); // Stop project-local config/rule discovery at this empty root.
    }
    const childEnv = boundedCodexEnv(env, redactEnvKeys);
    const connection = new CodexConnection({ executable, cwd, env: childEnv, rpcTimeoutMs, spawnProcess,
      config: nativeMode ? { ...providerConfig } : { ...providerConfig, ...BOUNDED_CONFIG } });
    const abort = () => {
      connection.onAbort?.();
      connection.fail(new AgentError('CANCELLED', '请求已取消。', 409), true);
    };
    signal?.addEventListener('abort', abort, { once: true });
    const dispose = async () => {
      signal?.removeEventListener('abort', abort); await connection.close();
      // Delete only this function's generated bounded child, never a selected
      // native project root.
      if (generatedCwd && path.dirname(cwd) === runtimeRoot && path.basename(cwd).startsWith('run-')) {
        try { fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* Empty scratch may be held by Windows; no user content is written there. */ }
      }
    };
    try {
      const initialized = await connection.rpc('initialize', { clientInfo: { name: 'trace_agent', title: 'Trace Agent', version: '0.1.0' }, capabilities: { experimentalApi: true } });
      let version;
      try {
        // Native installations consume a user-local qualification record when
        // one exists (or when explicitly configured). It rechecks the binary,
        // generated schema, persisted no-model probe and this live initialize
        // response. Keep the historical fixture gate only for old test/dev
        // hosts that have no qualification record at all; it never widens an
        // unknown build and therefore remains fail-closed.
        const qualificationRecordPath = env.TRACE_CODEX_QUALIFICATION_RECORD
          ?? path.join(os.homedir(), '.trace-runtime', 'codex-app-server-qualification.json');
        // A library/test provider may inject a fake transport.  Do not let a
        // user's home qualification record silently change that provider's
        // fixture semantics; only an explicit record path opts it in.  The
        // real child-process transport consumes the default user-local record.
        const useQualification = nativeMode && (Boolean(env.TRACE_CODEX_QUALIFICATION_RECORD)
          || (spawnProcess === spawn && fs.existsSync(qualificationRecordPath)));
        if (useQualification) {
          const qualification = validateCodexAppServerInstallation({ initializeResult: initialized,
            initializeParams: { capabilities: { experimentalApi: true } }, executable, env: childEnv,
            qualificationRecordPath, expectedCwd: cwd });
          version = qualification.verified_version;
        } else if (nativeMode && spawnProcess === spawn) {
          demand(false, 'CODEX_QUALIFICATION_REQUIRED', 'native Codex 尚未完成本机资格验证；请先运行 pnpm qualify:codex-app-server。', 503);
        } else {
          version = validateCodexAppServerVersion(initialized.userAgent).verified_version;
        }
      } catch (error) {
        // Keep the actionable setup error visible to callers.  The generic
        // compatibility error is reserved for a qualification record that
        // exists but no longer verifies against the live installation.
        if (error instanceof AgentError && error.code === 'CODEX_QUALIFICATION_REQUIRED') throw error;
        demand(false, 'CODEX_VERSION_UNVERIFIED', error instanceof Error && error.message
          ? `Codex 兼容性资格未通过：${error.message}`
          : `当前仅验证 Codex ${VERIFIED_CODEX_VERSIONS.join('、')}；请先运行协议资格验证。`, 503);
      }
      connection.send({ method: 'initialized', params: {} });
      return { connection, cwd, dispose, version, generatedCwd };
    } catch (error) { await dispose(); throw error; }
  }
  return {
    async check({ signal } = {}) {
      const host = await open(signal);
      try {
        const info = await host.connection.rpc('account/read', { refreshToken: false });
        return { runtime: 'codex-app-server', version: host.version, authenticated: !!info.account,
          authType: info.account?.type ?? null, modelTurnTested: false, executionMode: mode,
          ...(nativeMode ? { nativeProjectCwdConfigured: true, persistentThreads: true, approvalPolicy: 'on-request' }
            : { boundedPolicy: 'trace-bounded-v1' }) };
      } finally { await host.dispose(); }
    },
    async execute({ request, context, signal, onEvent, isCurrent, retrieval, runId = null, profile = null }) {
      demand(nativeMode || request.threadId === undefined, 'CODEX_THREAD_NOT_ALLOWED', 'bounded-analysis 不恢复持久 Codex thread。', 400);
      const host = await open(signal), rpc = host.connection;
      let threadId, turnId, completed = false, outputBytes = 0;
      const texts = new Map(); let finish, fail;
      const interactions = new Map();
      const cleanupInteractions = (error = new AgentError('CODEX_DISCONNECTED', 'Codex 连接已断开。', 502)) => {
        for (const entry of interactions.values()) {
          clearTimeout(entry.timer);
          entry.reject(error);
        }
        interactions.clear();
      };
      const publicInteraction = interaction => structuredClone(interaction);
      const registerInteraction = (method, params, rpcRequestId) => {
        demand(nativeMode, 'TOOL_NOT_ALLOWED', '此模式不授予额外交互权限。', 403);
        const createdAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + interactionTtlMs).toISOString();
        const interaction = safeInteraction({ interactionId: randomUUID(), runId, profileId: profile?.profileId ?? request.profileId ?? null,
          threadId: params?.threadId ?? threadId ?? null, turnId: params?.turnId ?? turnId ?? null, itemId: params?.itemId ?? null,
          requestId: rpcRequestId, method, params, createdAt, expiresAt, projectCwd: host.cwd });
        let resolve, reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        const timer = setTimeout(() => {
          if (!interactions.has(interaction.interactionId)) return;
          interactions.delete(interaction.interactionId);
          interaction.state = 'expired'; interaction.recoverable = false;
          onEvent('runtime.interaction.resolved', { interaction: publicInteraction(interaction), state: 'expired' });
          reject(new AgentError('INTERACTION_EXPIRED', '用户交互已超时；本次执行已停止。', 409));
        }, interactionTtlMs);
        timer.unref?.();
        interactions.set(interaction.interactionId, { interaction, params, method, resolve, reject, timer, promise });
        onEvent(method === 'item/tool/requestUserInput' ? 'runtime.input.required' : 'runtime.approval.required', {
          state: 'waiting', recoverable: true, interaction: publicInteraction(interaction), method,
          threadId: interaction.threadId, turnId: interaction.turnId, itemId: interaction.itemId,
        });
        return { interaction, promise };
      };
      const findInteraction = interactionId => {
        const entry = interactions.get(interactionId);
        demand(entry, 'INTERACTION_NOT_FOUND', '交互请求不存在、已处理或已失效。', 409);
        return entry;
      };
      const validateInteraction = (interactionId, body) => {
        const entry = findInteraction(interactionId);
        return responseForInteraction(entry.interaction, entry.params, body);
      };
      const resolveInteraction = (interactionId, body) => {
        const entry = findInteraction(interactionId);
        const payload = responseForInteraction(entry.interaction, entry.params, body);
        interactions.delete(interactionId); clearTimeout(entry.timer);
        entry.interaction.state = 'resolved'; entry.interaction.recoverable = false;
        onEvent('runtime.interaction.resolved', { interaction: publicInteraction(entry.interaction), state: 'resolved' });
        entry.resolve(payload);
        return { interaction: publicInteraction(entry.interaction), payloadHash: hash(payload) };
      };
      const inspectInteraction = interactionId => publicInteraction(findInteraction(interactionId).interaction);
      const control = {
        runId,
        inspectInteraction,
        validateInteraction: (interactionId, body) => validateInteraction(interactionId, body),
        respondInteraction: (interactionId, body) => resolveInteraction(interactionId, body),
      };
      activeControls.set(runId, control);
      const emit = (type, data = {}) => onEvent(type, nativeMode
        ? { ...data, threadId: data.threadId ?? threadId ?? null, turnId: data.turnId ?? turnId ?? null }
        : data);
      const tools = createRunToolBridge({ context, retrieval, signal, isCurrent, onEvent: emit });
      const sensemaking = request.purpose === 'sensemaking';
      const approvalMethods = new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval',
        'item/permissions/requestApproval', 'mcpServer/elicitation/request', 'applyPatchApproval', 'execCommandApproval']);
      const inputMethods = new Set(['item/tool/requestUserInput']);
      const done = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
      done.catch(() => {}); // Failure can precede the awaited turn/start response.
      rpc.onFailure = error => { cleanupInteractions(error); fail(error); };
      rpc.onAbort = () => {
        if (!completed && threadId && turnId && !rpc.closed) rpc.send({ id: ++rpc.sequence, method: 'turn/interrupt', params: { threadId, turnId } });
      };
      const current = () => demand(!signal.aborted && isCurrent(), 'STALE_CONTEXT', '目标版本或上下文已变化。', 409);
      rpc.onRequest = async (method, params, rpcRequestId) => {
        current();
        if (sensemaking) throw new AgentError('TOOL_NOT_ALLOWED', 'sensemaking profile 不开放工具。', 403);
        if (nativeMode && (approvalMethods.has(method) || inputMethods.has(method))) {
          const registered = registerInteraction(method, params, rpcRequestId);
          return await registered.promise;
        }
        if (method !== 'item/tool/call') throw new AgentError('TOOL_NOT_ALLOWED', '此模式不授予额外权限或交互式工具。', 403);
        demand(threadId && params.threadId === threadId && (!turnId || params.turnId === turnId) && !completed,
          'TOOL_SCOPE_MISMATCH', '工具调用的会话不匹配。', 403);
        const outcome = await tools.call(params.tool, params.arguments);
        current();
        return { contentItems: [{ type: 'inputText', text: JSON.stringify(outcome.result) }], success: outcome.success };
      };
      rpc.onNotification = (method, params) => {
        if (!threadId || params?.threadId !== threadId || completed) return;
        if (turnId && params.turnId && params.turnId !== turnId) return;
        if (method === 'turn/started') { turnId = params.turn.id; emit('runtime.started', { threadId, turnId }); }
        if (method === 'item/agentMessage/delta') {
          current();
          demand(typeof params.delta === 'string', 'CODEX_PROTOCOL_ERROR', '消息片段无效。', 502);
          outputBytes += Buffer.byteLength(params.delta);
          const outputLimit = Number.isSafeInteger(request.maxOutputBytes) ? Math.min(128 * 1024, Math.max(1, request.maxOutputBytes)) : 128 * 1024;
          demand(outputBytes <= outputLimit, 'OUTPUT_LIMIT', '输出超过本次预算。', 502);
          texts.set(params.itemId, (texts.get(params.itemId) ?? '') + params.delta);
          emit('output.delta', { itemId: params.itemId, delta: params.delta, format: 'json-fragment' });
        }
        if (nativeMode && (method === 'item/started' || method === 'item/completed')) {
          const item = params.item ?? {};
          emit('runtime.item', { phase: method === 'item/started' ? 'started' : 'completed',
            threadId, turnId: params.turnId ?? turnId ?? null, itemId: params.itemId ?? item.id ?? null,
            itemType: typeof item.type === 'string' ? item.type : null });
        }
        if (method === 'item/completed' && params.item?.type === 'agentMessage') {
          const outputLimit = Number.isSafeInteger(request.maxOutputBytes) ? Math.min(128 * 1024, Math.max(1, request.maxOutputBytes)) : 128 * 1024;
          demand(typeof params.item.text === 'string' && Buffer.byteLength(params.item.text) <= outputLimit, 'OUTPUT_LIMIT', '最终输出超过预算。', 502);
          texts.set(params.item.id, params.item.text);
        }
        if (!nativeMode && method === 'item/started' && ['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'collabAgentToolCall', 'imageView'].includes(params.item?.type)) {
          throw new AgentError('RUNTIME_POLICY_VIOLATION', '运行时尝试使用本模式未开放的能力，执行已停止。', 502);
        }
        if (method === 'turn/completed') {
          completed = true;
          if (params.turn.status === 'completed') finish({ raw: [...texts.values()].at(-1) ?? '', threadId, turnId: params.turn.id,
            // Profile bindings identify the Codex app-server, not merely the
            // CLI semver.  Keep the legacy runtime identity for ordinary
            // Agent runs, while making the strict sensemaking worker's
            // provider identity agree with profiles.safeProfile().
            runtimeVersion: sensemaking ? `codex-app-server/${host.version}` : host.version,
            providedFragments: tools.providedFragments });
          else fail(new AgentError(params.turn.status === 'interrupted' ? 'CANCELLED' : 'CODEX_TURN_FAILED', 'Codex 未完成本次生成；原文未改变。', 502));
        }
      };
      try {
        let threadConfig = {};
        if (!nativeMode) {
          const config = await rpc.rpc('config/read', { cwd: host.cwd, includeLayers: false });
          const skills = await rpc.rpc('skills/list', { cwds: [host.cwd], forceReload: true });
          demand(Array.isArray(skills.data) && skills.data.every(e => Array.isArray(e.skills) && e.errors?.length === 0),
            'CODEX_POLICY_UNVERIFIED', '无法完整核验 Skill 清单，未启动模型。', 503);
          threadConfig = {
            mcp_servers: Object.fromEntries(Object.keys(config.config.mcp_servers ?? {}).map(name => [name, { enabled: false }])),
            'skills.config': skills.data.flatMap(e => e.skills).map(s => ({ path: s.path, enabled: false })),
          };
        }
        current();
        const instructions = sensemaking ? TRACE_SENSEMAKING_INSTRUCTIONS
          : nativeMode ? TRACE_NATIVE_CODEX_INSTRUCTIONS
          : retrieval?.tools.length ? TRACE_AGENT_RETRIEVAL_INSTRUCTIONS : TRACE_BOUNDED_ANALYSIS_INSTRUCTIONS;
        const threadParams = nativeMode
          ? { threadId: request.threadId, cwd: host.cwd, approvalPolicy: 'on-request', ...(model ? { model } : {}),
            baseInstructions: instructions, developerInstructions: instructions,
            dynamicTools: sensemaking ? [] : tools.definitions }
          : { cwd: host.cwd, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only',
            ...(model ? { model } : {}), config: threadConfig, baseInstructions: instructions, developerInstructions: instructions,
            selectedCapabilityRoots: [], environments: [], dynamicTools: sensemaking ? [] : tools.definitions };
        if (nativeMode && request.threadId) {
          delete threadParams.threadId;
          const resumed = await rpc.rpc('thread/resume', { threadId: request.threadId, cwd: host.cwd, approvalPolicy: 'on-request',
            ...(model ? { model } : {}) });
          demand(resumed?.thread?.id === request.threadId, 'CODEX_PROTOCOL_ERROR', 'Codex resume 返回了不匹配的 thread。', 502);
          demand(resumed.thread.ephemeral !== true, 'CODEX_PROTOCOL_ERROR', 'native Codex resume 返回了 ephemeral thread。', 502);
          if (resumed.cwd) demand(path.resolve(resumed.cwd) === path.resolve(host.cwd), 'CODEX_PROJECT_SCOPE_MISMATCH', 'Codex thread 不属于选定项目目录。', 403);
          threadId = resumed.thread.id;
          emit('runtime.connected', { threadId, runtimeVersion: host.version, mode, resumed: true });
        } else {
          delete threadParams.threadId;
          const started = await rpc.rpc('thread/start', threadParams);
          demand(started?.thread?.id, 'CODEX_PROTOCOL_ERROR', 'Codex thread/start 没有返回 thread 身份。', 502);
          if (nativeMode) demand(started.thread.ephemeral !== true, 'CODEX_PROTOCOL_ERROR', 'native Codex thread 意外是 ephemeral。', 502);
          if (started.cwd) demand(path.resolve(started.cwd) === path.resolve(host.cwd), 'CODEX_PROJECT_SCOPE_MISMATCH', 'Codex thread 不属于选定项目目录。', 403);
          threadId = started.thread.id;
          emit('runtime.connected', { threadId, runtimeVersion: host.version, model: started.model, mode, resumed: false });
        }
        current();
        const manifest = contextManifest(context);
        const turn = await rpc.rpc('turn/start', { threadId, effort: 'medium',
          input: [{ type: 'text', text: JSON.stringify({ purpose: request.purpose, input: request.input, context: manifest }), text_elements: [] }],
          ...(nativeMode ? {} : { sandboxPolicy: { type: 'readOnly', networkAccess: false } }),
          outputSchema: sensemaking ? SENSEMAKING_OUTPUT_SCHEMA : OUTPUT_SCHEMA });
        turnId ??= turn.turn.id;
        return await done;
      } finally {
        if (!completed && threadId && turnId && !rpc.closed) {
          // Attempt the narrow interrupt first; disposal also terminates our own process.
          rpc.send({ id: ++rpc.sequence, method: 'turn/interrupt', params: { threadId, turnId } });
        }
        cleanupInteractions(new AgentError('CODEX_DISCONNECTED', 'Codex 连接已关闭；未完成的交互不会自动恢复。', 502));
        if (activeControls.get(runId) === control) activeControls.delete(runId);
        await host.dispose();
      }
    },
    inspectInteraction(runId, interactionId) {
      const control = activeControls.get(runId);
      demand(control && control.runId === runId, 'INTERACTION_SCOPE_MISMATCH', '交互不属于当前运行。', 403);
      return control.inspectInteraction(interactionId);
    },
    validateInteraction(runId, interactionId, body) {
      const control = activeControls.get(runId);
      demand(control && control.runId === runId, 'INTERACTION_SCOPE_MISMATCH', '交互不属于当前运行。', 403);
      return control.validateInteraction(interactionId, body);
    },
    respondInteraction(runId, interactionId, body) {
      const control = activeControls.get(runId);
      demand(control && control.runId === runId, 'INTERACTION_SCOPE_MISMATCH', '交互不属于当前运行。', 403);
      return control.respondInteraction(interactionId, body);
    },
  };
}
