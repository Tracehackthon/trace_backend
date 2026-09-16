import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { AgentError, demand, plain, OUTPUT_SCHEMA, SENSEMAKING_OUTPUT_SCHEMA } from './protocol.mjs';
import { contextManifest, createRunToolBridge, TRACE_AGENT_INSTRUCTIONS, TRACE_AGENT_RETRIEVAL_INSTRUCTIONS, TRACE_SENSEMAKING_INSTRUCTIONS } from './runtime.mjs';

// This policy was exercised against the wire request of this exact runtime.
// An unknown CLI must be requalified, not silently inherit new native tools.
export const VERIFIED_CODEX_VERSION = '0.153.4';
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
        Promise.resolve().then(() => this.onRequest(value.method, value.params)).then(result => this.send({ id: value.id, result }),
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
  redactEnvKeys = [],
  // Library-only test/provider configuration. Never accepted from HTTP callers.
  providerConfig = {} } = {}) {
  runtimeRoot = path.resolve(runtimeRoot); fs.mkdirSync(runtimeRoot, { recursive: true });
  async function open(signal) {
    demand(!signal?.aborted, 'CANCELLED', '请求已取消。', 409);
    const cwd = fs.mkdtempSync(path.join(runtimeRoot, 'run-'));
    fs.mkdirSync(path.join(cwd, '.git')); // Stop project-local config/rule discovery at this empty root.
    const childEnv = boundedCodexEnv(env, redactEnvKeys);
    const connection = new CodexConnection({ executable, cwd, env: childEnv, rpcTimeoutMs,
      config: { ...providerConfig, ...BOUNDED_CONFIG } });
    const abort = () => {
      connection.onAbort?.();
      connection.fail(new AgentError('CANCELLED', '请求已取消。', 409), true);
    };
    signal?.addEventListener('abort', abort, { once: true });
    const dispose = async () => {
      signal?.removeEventListener('abort', abort); await connection.close();
      // Delete only this function's generated child, never a configured root.
      if (path.dirname(cwd) === runtimeRoot && path.basename(cwd).startsWith('run-')) {
        try { fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* Empty scratch may be held by Windows; no user content is written there. */ }
      }
    };
    try {
      const initialized = await connection.rpc('initialize', { clientInfo: { name: 'trace_agent', title: 'Trace Agent', version: '0.1.0' }, capabilities: { experimentalApi: true } });
      const version = /^(?:trace_agent|Codex Desktop|codex_cli_rs|codex)\/(\d+\.\d+\.\d+)\b/i.exec(initialized.userAgent ?? '')?.[1];
      demand(version === VERIFIED_CODEX_VERSION, 'CODEX_VERSION_UNVERIFIED', `当前仅验证 Codex ${VERIFIED_CODEX_VERSION}；其他版本须先运行协议隔离测试。`, 503);
      connection.send({ method: 'initialized', params: {} });
      return { connection, cwd, dispose, version };
    } catch (error) { await dispose(); throw error; }
  }
  return {
    async check({ signal } = {}) {
      const host = await open(signal);
      try {
        const info = await host.connection.rpc('account/read', { refreshToken: false });
        return { runtime: 'codex-app-server', version: host.version, authenticated: !!info.account,
          authType: info.account?.type ?? null, modelTurnTested: false, boundedPolicy: 'trace-bounded-v1' };
      } finally { await host.dispose(); }
    },
    async execute({ request, context, signal, onEvent, isCurrent, retrieval }) {
      const host = await open(signal), rpc = host.connection;
      let threadId, turnId, completed = false, outputBytes = 0;
      const texts = new Map(); let finish, fail;
      const tools = createRunToolBridge({ context, retrieval, signal, isCurrent, onEvent });
      const sensemaking = request.purpose === 'sensemaking';
      const done = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
      done.catch(() => {}); // Failure can precede the awaited turn/start response.
      rpc.onFailure = fail;
      rpc.onAbort = () => {
        if (!completed && threadId && turnId && !rpc.closed) rpc.send({ id: ++rpc.sequence, method: 'turn/interrupt', params: { threadId, turnId } });
      };
      const current = () => demand(!signal.aborted && isCurrent(), 'STALE_CONTEXT', '目标版本或上下文已变化。', 409);
      rpc.onRequest = async (method, params) => {
        current();
        if (sensemaking) throw new AgentError('TOOL_NOT_ALLOWED', 'sensemaking profile 不开放工具。', 403);
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
        if (method === 'turn/started') { turnId = params.turn.id; onEvent('runtime.started', { threadId, turnId }); }
        if (method === 'item/agentMessage/delta') {
          current();
          demand(typeof params.delta === 'string', 'CODEX_PROTOCOL_ERROR', '消息片段无效。', 502);
          outputBytes += Buffer.byteLength(params.delta);
          const outputLimit = Number.isSafeInteger(request.maxOutputBytes) ? Math.min(128 * 1024, Math.max(1, request.maxOutputBytes)) : 128 * 1024;
          demand(outputBytes <= outputLimit, 'OUTPUT_LIMIT', '输出超过本次预算。', 502);
          texts.set(params.itemId, (texts.get(params.itemId) ?? '') + params.delta);
          onEvent('output.delta', { itemId: params.itemId, delta: params.delta, format: 'json-fragment' });
        }
        if (method === 'item/completed' && params.item?.type === 'agentMessage') {
          const outputLimit = Number.isSafeInteger(request.maxOutputBytes) ? Math.min(128 * 1024, Math.max(1, request.maxOutputBytes)) : 128 * 1024;
          demand(typeof params.item.text === 'string' && Buffer.byteLength(params.item.text) <= outputLimit, 'OUTPUT_LIMIT', '最终输出超过预算。', 502);
          texts.set(params.item.id, params.item.text);
        }
        if (method === 'item/started' && ['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'collabAgentToolCall', 'imageView'].includes(params.item?.type)) {
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
        const config = await rpc.rpc('config/read', { cwd: host.cwd, includeLayers: false });
        const skills = await rpc.rpc('skills/list', { cwds: [host.cwd], forceReload: true });
        demand(Array.isArray(skills.data) && skills.data.every(e => Array.isArray(e.skills) && e.errors?.length === 0),
          'CODEX_POLICY_UNVERIFIED', '无法完整核验 Skill 清单，未启动模型。', 503);
        const threadConfig = {
          mcp_servers: Object.fromEntries(Object.keys(config.config.mcp_servers ?? {}).map(name => [name, { enabled: false }])),
          'skills.config': skills.data.flatMap(e => e.skills).map(s => ({ path: s.path, enabled: false })),
        };
        current();
        const instructions = sensemaking ? TRACE_SENSEMAKING_INSTRUCTIONS : retrieval?.tools.length ? TRACE_AGENT_RETRIEVAL_INSTRUCTIONS : TRACE_AGENT_INSTRUCTIONS;
        const started = await rpc.rpc('thread/start', { cwd: host.cwd, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only',
          ...(model ? { model } : {}), config: threadConfig, baseInstructions: instructions, developerInstructions: instructions,
          selectedCapabilityRoots: [], environments: [], dynamicTools: sensemaking ? [] : tools.definitions });
        threadId = started.thread.id;
        onEvent('runtime.connected', { threadId, runtimeVersion: host.version, model: started.model });
        current();
        const manifest = contextManifest(context);
        const turn = await rpc.rpc('turn/start', { threadId, effort: 'medium',
          input: [{ type: 'text', text: JSON.stringify({ purpose: request.purpose, input: request.input, context: manifest }), text_elements: [] }],
          sandboxPolicy: { type: 'readOnly', networkAccess: false }, outputSchema: sensemaking ? SENSEMAKING_OUTPUT_SCHEMA : OUTPUT_SCHEMA });
        turnId ??= turn.turn.id;
        return await done;
      } finally {
        if (!completed && threadId && turnId && !rpc.closed) {
          // Attempt the narrow interrupt first; disposal also terminates our own process.
          rpc.send({ id: ++rpc.sequence, method: 'turn/interrupt', params: { threadId, turnId } });
        }
        await host.dispose();
      }
    },
  };
}
