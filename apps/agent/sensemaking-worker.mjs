import path from 'node:path';
import crypto from 'node:crypto';
import {createProductWorkspace} from '../../packages/product/workspace/src/workspace.mjs';
import {workflowHash, validateSensemakingResult} from '../../packages/product/workspace/src/host-workflow.mjs';
import {DEFAULT_HOST_PRIVACY_POLICY, detectSensemakingOverlap, privacySafeError, redactHostText, redactSensemakingInput} from '../../packages/product/workspace/src/host-privacy.mjs';
import {createAgentStore} from './store.mjs';
import {AgentError, SENSEMAKING_OUTPUT_SCHEMA} from './protocol.mjs';
import {createExecutorRegistry} from './profiles.mjs';

const MAX_TEXT = 1_000_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_MAX_INPUT_BYTES = 768 * 1024;
const DEFAULT_MAX_STEPS = 1;
const DEFAULT_POLL_MS = 1_000;
const MARKERS = Object.freeze({
  'runtime-guard': /\b(git|branch|worktree|repository|release|hotfix)\b|分支|仓库|脏工作区|发布|切分支/i,
  hook: /hook|sessionstart|sessionend|promptsubmit|host session|宿主|附着|跟随|捕获/i,
  'capability-candidate': /skill|capability|能力|技能/i,
  'product-issue': /bug|issue|error|故障|错误|产品问题/i,
  'project-policy': /project policy|项目规范|仓库约定|团队规范/i,
  'personal-policy': /personal|个人偏好|以后都|总是/i,
  'current-task': /task|任务|承接|本轮|当前/i,
});

function fail(code, message, status = 422) { throw new AgentError(code, message, status); }
function boundedText(value, field, max = MAX_TEXT) {
  if (typeof value !== 'string' || value.length > max || /[\x00\x7f]/.test(value)) fail('INVALID_SENSEMAKING_INPUT', `${field} 不符合边界`);
  return value;
}
function hash(value) { return workflowHash(value); }
function normalizePath(value, field) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) fail('INVALID_PATH', `${field} 必须是绝对路径`, 400);
  return path.resolve(value);
}
function parseResult(raw, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    let encoded;
    try { encoded = JSON.stringify(raw); } catch { fail('INVALID_SENSEMAKING_RESULT', 'sensemaking executor 返回了不可序列化结果', 502); }
    if (Buffer.byteLength(encoded, 'utf8') > maxOutputBytes) fail('SENSEMAKING_OUTPUT_LIMIT', 'sensemaking executor 返回结果超过 profile 输出预算', 502);
    return structuredClone(raw);
  }
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > maxOutputBytes) fail('INVALID_SENSEMAKING_RESULT', 'sensemaking executor 必须返回有界 JSON', 502);
  try { return JSON.parse(raw); } catch { fail('INVALID_SENSEMAKING_RESULT', 'sensemaking executor 没有返回有效 JSON', 502); }
}
function expectedRuntime(binding) {
  // `serviceIdentity` is part of the server-owned profile binding and, for
  // Codex, includes the exact verified app-server version.  A provider may
  // append a bounded implementation revision (the fixture uses `/test`),
  // but changing the registered identity must fail closed.
  return typeof binding?.serviceIdentity === 'string' && binding.serviceIdentity.length > 0
    ? binding.serviceIdentity : null;
}
function safeProfileIdentity(binding) {
  if (!binding || typeof binding !== 'object') return null;
  return {profile_id: binding.profileId ?? null, kind: binding.kind ?? null, owner_id: binding.ownerId ?? null,
    version: binding.version ?? null, revision: binding.revision ?? null, model: binding.model ?? null, protocol: binding.protocol ?? null,
    service_identity: binding.serviceIdentity ?? binding.service_identity ?? null, serviceIdentity: binding.serviceIdentity ?? binding.service_identity ?? null,
    sensemaking: binding.sensemaking ?? null};
}

/** Offline bounded fixture analyzer. It deliberately emits generic language,
 * never a copy of the host prompt/final, and remains available for tests and
 * local development when no paid/remote profile is configured. */
export function analyzeSensemakingFixture(input, {runId = null} = {}) {
  if (!input || typeof input !== 'object') fail('INVALID_SENSEMAKING_INPUT', 'sensemaking input 必须是对象');
  const prompt = boundedText(input.user_prompt ?? '', 'user_prompt');
  const final = input.final_assistant_message === null || input.final_assistant_message === undefined ? '' : boundedText(input.final_assistant_message, 'final_assistant_message');
  const combined = `${prompt}\n${final}`;
  const targetHint = Object.entries(MARKERS).find(([, pattern]) => pattern.test(combined))?.[0] ?? null;
  const source = {host: input.host, session_id: input.session_id, turn_id: input.turn_id, run_id: runId, input_hash: input.input_hash ?? hash(input)};
  if (targetHint === null || (prompt.trim().length === 0 && final.trim().length === 0)) {
    return {
      schema_id: 'trace.sensemaking-result', schema_version: 1, kind: 'noop', confidence: 0,
      observation: null, desired_behavior: null, scope: 'unknown', target_kind: 'unresolved', target_hint: null,
      understanding_delta: null, open_questions: [], source,
    };
  }
  const desired = targetHint === 'runtime-guard'
    ? '在继续实现或发布前，根据任务意图与项目约定执行只读仓库预检；脏工作区先阻断，默认不自动切分支。'
    : targetHint === 'hook'
      ? '宿主会话只有在用户明确附着后才接收，生命周期事件必须可重放且不回显私有正文。'
      : '将这次明确的流程改进先路由成可审阅提案，再由用户决定采用或试用。';
  return {
    schema_id: 'trace.sensemaking-result', schema_version: 1, kind: 'candidate', confidence: 0.75,
    observation: 'HostTurn 包含一个可供审核的流程改进信号；原始宿主正文保留在 Product Workspace 的私有 HostTurn 边界内。',
    desired_behavior: desired, scope: 'unknown', target_kind: 'unresolved', target_hint: targetHint,
    understanding_delta: null, open_questions: ['该改进适用于当前任务、项目，还是个人范围？', '采用前需要哪些最新运行证据？'],
    source,
  };
}

function validateLimits({timeoutMs, leaseMs, maxInputBytes, maxOutputBytes, maxSteps, maxAttempts}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) fail('INVALID_SENSEMAKING_PROFILE', 'timeoutMs 必须在 1000..120000', 400);
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) fail('INVALID_JOB_LEASE', 'leaseMs 必须在 1000..300000', 400);
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1_024 || maxInputBytes > 2 * 1024 * 1024) fail('INVALID_SENSEMAKING_PROFILE', 'maxInputBytes 超出范围', 400);
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1_024 || maxOutputBytes > 128 * 1024) fail('INVALID_SENSEMAKING_PROFILE', 'maxOutputBytes 超出范围', 400);
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 0 || maxSteps > 12) fail('INVALID_SENSEMAKING_PROFILE', 'maxSteps 超出范围', 400);
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) fail('INVALID_SENSEMAKING_PROFILE', 'maxAttempts 超出范围', 400);
}

/**
 * A provider-neutral worker. In `profile` mode it binds an existing
 * ExecutorRegistry profile and calls its executor contract; it never imports a
 * provider SDK. In `fixture` mode it uses the offline analyzer. `disabled` is
 * explicit and never silently falls back to a paid/remote profile.
 */
export function createSensemakingWorker({
  webFile, agentFile, productWorkspace = null, agentStore = null,
  profileId = process.env.TRACE_SENSEMAKING_PROFILE_ID ?? 'fixture-sensemaking',
  mode = process.env.TRACE_SENSEMAKING_MODE ?? (profileId === 'fixture-sensemaking' ? 'fixture' : 'profile'),
  profileVersion = '1', modelVersion = 'fixture-1',
  leaseMs = DEFAULT_LEASE_MS, maxAttempts = 3,
  timeoutMs = Number(process.env.TRACE_SENSEMAKING_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  maxInputBytes = DEFAULT_MAX_INPUT_BYTES, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES, maxSteps = DEFAULT_MAX_STEPS,
  pollMs = Number(process.env.TRACE_SENSEMAKING_POLL_MS ?? DEFAULT_POLL_MS),
  analyzer = analyzeSensemakingFixture, executorRegistry = null, env = process.env,
  privacyPolicy = DEFAULT_HOST_PRIVACY_POLICY, ownerId = `sensemaking-worker:${process.pid}:${crypto.randomUUID()}`,
  faultInjector = null,
} = {}) {
  if (!['fixture', 'profile', 'shadow', 'disabled'].includes(mode)) fail('INVALID_SENSEMAKING_PROFILE', 'mode 必须是 fixture、profile、shadow 或 disabled', 400);
  validateLimits({timeoutMs, leaseMs, maxInputBytes, maxOutputBytes, maxSteps, maxAttempts});
  if (!Number.isSafeInteger(pollMs) || pollMs < 100 || pollMs > 60_000) fail('INVALID_WORKER_CONFIG', 'pollMs 必须在 100..60000', 400);
  if (typeof analyzer !== 'function') fail('INVALID_SENSEMAKING_PROFILE', 'analyzer 必须是本地受控应用服务');
  const ownWorkspace = productWorkspace === null;
  const ownAgent = agentStore === null;
  const webPath = webFile === undefined ? productWorkspace?.file : normalizePath(webFile, 'webFile');
  const agentPath = agentFile === undefined ? agentStore?.file : normalizePath(agentFile, 'agentFile');
  if (!productWorkspace && !webPath) fail('INVALID_PATH', '需要 webFile 或 productWorkspace', 400);
  if (!agentStore && !agentPath) fail('INVALID_AGENT_DB', '需要 agentFile 或 agentStore', 400);
  if (webPath && path.basename(webPath).toLowerCase() === 'trace.sqlite') fail('WRONG_DATABASE', 'sensemaking 必须从 Product Workspace web.sqlite 读取', 400);
  if (agentPath && ['web.sqlite', 'trace.sqlite'].includes(path.basename(agentPath).toLowerCase())) fail('INVALID_AGENT_DB', 'sensemaking run 必须使用独立 agent.sqlite', 400);
  const workspace = productWorkspace ?? createProductWorkspace({file: webPath, hostWorkflowFaultInjector: faultInjector});
  let agent;
  try {
    agent = agentStore ?? createAgentStore({file: agentPath, workspaceKey: `web:${crypto.createHash('sha256').update(path.resolve(workspace.file), 'utf8').digest('hex')}`});
  } catch (error) { if (ownWorkspace) workspace.close(); throw error; }
  let registry = executorRegistry;
  let binding = null;
  let executor = null;
  let selectedProfileId = profileId;
  let selectedProfileVersion = String(profileVersion);
  let selectedModelVersion = String(modelVersion);
  let effectiveTimeoutMs = timeoutMs;
  let effectiveMaxInputBytes = maxInputBytes;
  let effectiveMaxOutputBytes = maxOutputBytes;
  let effectiveMaxSteps = maxSteps;
  let effectiveMaxAttempts = maxAttempts;
  if (mode === 'profile' || mode === 'shadow') {
    registry ??= createExecutorRegistry({env});
    const selected = registry.bind(selectedProfileId);
    binding = selected.binding; executor = selected.executor;
    selectedProfileVersion = String(binding.version);
    selectedModelVersion = String(binding.serviceIdentity ?? binding.model ?? binding.protocol ?? binding.revision);
    const configured = binding.sensemaking ?? {};
    effectiveTimeoutMs = configured.timeoutMs ?? timeoutMs;
    effectiveMaxInputBytes = configured.maxInputBytes ?? maxInputBytes;
    effectiveMaxOutputBytes = configured.maxOutputBytes ?? maxOutputBytes;
    effectiveMaxSteps = configured.maxSteps ?? maxSteps;
    effectiveMaxAttempts = configured.maxAttempts ?? maxAttempts;
    validateLimits({timeoutMs: effectiveTimeoutMs, leaseMs, maxInputBytes: effectiveMaxInputBytes, maxOutputBytes: effectiveMaxOutputBytes, maxSteps: effectiveMaxSteps, maxAttempts: effectiveMaxAttempts});
  } else if (mode === 'fixture') {
    selectedProfileId = 'fixture-sensemaking';
  }
  let closed = false;
  let started = false;
  let running = false;
  let timer = null;
  let activePromise = null;
  let lastError = null;
  let lastStartedAt = null;
  let lastFinishedAt = null;
  let processed = 0;
  let activePollMs = pollMs;

  function closeOwned() { if (ownAgent) agent.close(); if (ownWorkspace) workspace.close(); }
  function close() { if (closed) return; closed = true; started = false; if (timer) clearTimeout(timer); timer = null; closeOwned(); }
  function assertOpen() { if (closed) fail('WORKER_CLOSED', 'sensemaking worker 已关闭', 503); }
  function profileSnapshot() { return mode === 'fixture' ? {profile_id: selectedProfileId, profile_version: selectedProfileVersion, model_version: selectedModelVersion, kind: 'fixture', mode} : mode === 'disabled' ? null : safeProfileIdentity(binding); }
  function health() {
    assertOpen();
    const jobs = workspace.hostWorkflow.listSensemakingJobs();
    return {protocolVersion: 1, component: 'trace-sensemaking-worker', status: started ? 'running' : 'idle', mode,
      owner_id: ownerId, profile: profileSnapshot(), queue_depth: jobs.filter(job => ['queued', 'running'].includes(job.status) || job.status === 'failed' && job.attempt < job.max_attempts).length,
      failed_count: jobs.filter(job => job.status === 'failed').length, active: running ? 1 : 0, max_concurrency: 1,
      lease_ms: leaseMs, poll_ms: activePollMs, limits: {timeout_ms: effectiveTimeoutMs, max_input_bytes: effectiveMaxInputBytes, max_output_bytes: effectiveMaxOutputBytes, max_steps: effectiveMaxSteps, max_attempts: effectiveMaxAttempts, tools: []}, processed, last_error: lastError, last_started_at: lastStartedAt, last_finished_at: lastFinishedAt};
  }
  function recordEvent(run, type, data = {}) {
    if (!run || !['runtime.connected', 'runtime.started', 'output.delta', 'tool.completed'].includes(type)) return run;
    const safeData = type === 'output.delta' ? {format: data.format ?? 'json-fragment', bytes: typeof data.delta === 'string' ? Buffer.byteLength(data.delta, 'utf8') : 0}
      : type === 'tool.completed' ? {tool: data.tool ?? null, success: data.success === true, contextIds: Array.isArray(data.contextIds) ? data.contextIds.slice(0, 32) : []} : data;
    try { return agent.updateSensemaking(run.id, {}, type === 'output.delta' ? 'sensemaking.output.received' : `sensemaking.${type}`, safeData).run; } catch { return run; }
  }
  function profileIdentityCheck(output) {
    if (!binding || !registry?.isCurrent(binding)) fail('PROFILE_CHANGED', 'sensemaking 执行期间 Agent profile 已变化或撤权', 409);
    if (!output || typeof output.runtimeVersion !== 'string' || output.runtimeVersion.length === 0 || output.runtimeVersion.length > 256) fail('PROVIDER_IDENTITY_DRIFT', 'sensemaking executor 没有返回稳定的 runtime identity', 502);
    const expected = expectedRuntime(binding);
    if (expected && output.runtimeVersion !== expected && !output.runtimeVersion.startsWith(`${expected}/`)) fail('PROVIDER_IDENTITY_DRIFT', 'sensemaking executor runtime identity 与 profile 不匹配', 502);
  }
  function assertInputSize(input) {
    const encoded = JSON.stringify(input);
    if (Buffer.byteLength(encoded, 'utf8') > effectiveMaxInputBytes) fail('SENSEMAKING_INPUT_LIMIT', 'sensemaking 输入超过 profile 预算', 413);
  }
  function jobInput(job) {
    if (!job.input || typeof job.input !== 'object') fail('SENSEMAKING_INPUT_INVALID', 'sensemaking job 输入损坏', 503);
    return {...job.input, input_hash: job.input_hash};
  }
  function privacyView(job) {
    const input = jobInput(job); assertInputSize(input);
    return {input, ...redactSensemakingInput(input, privacyPolicy)};
  }
  function persistPrivacy(job, leaseToken, value, status = 'accepted', overlap = null) {
    return workspace.hostWorkflow.recordSensemakingPrivacy({job_id: job.job_id, lease_token: leaseToken, owner_id: ownerId,
      policy_id: value.receipt.policy_id, policy_version: value.receipt.policy_version, input_hash: job.input_hash,
      redaction: value.receipt, overlap, status});
  }
  function assertOutputPrivacy(result) {
    const encoded = JSON.stringify(result);
    const receipt = redactHostText(encoded, 'final_assistant_message', privacyPolicy);
    if (receipt.text !== encoded) fail('SENSEMAKING_RESULT_PRIVACY', 'sensemaking 结果包含未授权 secret、PII 或绝对路径', 502);
    return {output_sha256: receipt.original_sha256, omitted: receipt.omitted};
  }
  function completeFixture(job, run, safe) {
    // The fixture receives the same redacted fields as a real executor.  Do
    // not make it depend on a worker-added hash field: the analyzer's
    // `workflowHash(input)` fallback must resolve to the Product job hash so
    // the strict HostTurnRef check remains useful for existing fixtures.
    const fixtureInput = {...safe.modelInput}; delete fixtureInput.input_hash;
    let result = analyzer(fixtureInput, {runId: run.id, profileId: selectedProfileId, profileVersion: selectedProfileVersion, modelVersion: selectedModelVersion});
    result = parseResult(result, effectiveMaxOutputBytes);
    if (result.schema_id !== 'trace.sensemaking-result' || result.schema_version !== 1 || !['candidate', 'noop'].includes(result.kind)) fail('INVALID_SENSEMAKING_RESULT', '本地 analyzer 返回的结果 schema 无效', 502);
    validateSensemakingResult(result, job, run.id);
    const outputPrivacy = assertOutputPrivacy(result);
    const overlap = detectSensemakingOverlap(result, job.input, privacyPolicy);
    if (overlap.matched) fail('SENSEMAKING_RESULT_PRIVACY', 'sensemaking 结果与私有 HostTurn 高比例重合', 502);
    persistPrivacy(job, job.lease_token, {...safe, receipt: {...safe.receipt, output: outputPrivacy}}, 'accepted', overlap);
    return {result, runtimeVersion: 'trace-fixture-sensemaking-v1'};
  }
  async function completeProfile(job, run, safe) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs); timeout.unref?.();
    const renew = setInterval(() => { try { workspace.hostWorkflow.renewSensemakingJob({job_id: job.job_id, lease_token: job.lease_token, owner_id: ownerId, lease_ms: leaseMs}); } catch {} }, Math.max(1_000, Math.floor(leaseMs / 2))); renew.unref?.();
    let output;
    try {
      if (!registry?.isCurrent(binding)) fail('PROFILE_CHANGED', 'sensemaking profile 在执行前已变化或撤权', 409);
      const context = {baseRevision: 0, contextEpoch: 0, contextHash: job.input_hash, fragments: [], omitted: {count: 0}};
      const request = {requestId: job.job_id, runId: run.id, purpose: 'sensemaking', input: safe.modelInput, profileId: binding.profileId,
        maxSteps: effectiveMaxSteps, maxOutputBytes: effectiveMaxOutputBytes, maxInputBytes: effectiveMaxInputBytes,
        usageBudget: {timeoutMs: effectiveTimeoutMs, maxSteps: effectiveMaxSteps, maxInputBytes: effectiveMaxInputBytes, maxOutputBytes: effectiveMaxOutputBytes, tools: []},
        sensemakingSchema: SENSEMAKING_OUTPUT_SCHEMA};
      output = await executor.execute({request, context, signal: controller.signal, retrieval: null, profile: binding,
        isCurrent: () => !closed && registry.isCurrent(binding), onEvent: (type, data) => { run = recordEvent(run, type, data); }});
      profileIdentityCheck(output);
      const raw = output?.raw;
      if (typeof raw === 'string' && Buffer.byteLength(raw, 'utf8') > effectiveMaxOutputBytes) fail('SENSEMAKING_OUTPUT_LIMIT', 'sensemaking provider 输出超过 profile 预算', 502);
      const result = parseResult(raw ?? output?.result ?? output, effectiveMaxOutputBytes);
      validateSensemakingResult(result, job, run.id);
      const outputPrivacy = assertOutputPrivacy(result);
      const overlap = detectSensemakingOverlap(result, job.input, privacyPolicy);
      if (overlap.matched) fail('SENSEMAKING_RESULT_PRIVACY', 'sensemaking 结果与私有 HostTurn 高比例重合', 502);
      persistPrivacy(job, job.lease_token, {...safe, receipt: {...safe.receipt, output: outputPrivacy}}, 'accepted', overlap);
      return {result, runtimeVersion: output.runtimeVersion};
    } finally { clearTimeout(timeout); clearInterval(renew); }
  }
  function processJob(job) {
    lastStartedAt = new Date().toISOString();
    let run = agent.findSensemaking(job.job_id);
    if (run !== null && run.inputHash !== job.input_hash) {
      try { workspace.hostWorkflow.failSensemakingJob({job_id: job.job_id, lease_token: job.lease_token, owner_id: ownerId, error_code: 'SENSEMAKING_INPUT_CONFLICT', error_message: 'Agent run 与 Product job 输入哈希不一致'}); } catch {}
      fail('SENSEMAKING_INPUT_CONFLICT', 'Product job 与 agent run 的输入哈希不一致', 409);
    }
    run ??= agent.createSensemaking({jobId: job.job_id, host: job.host, sessionId: job.session_id, turnId: job.turn_id, inputHash: job.input_hash,
      attempt: job.attempt, profileId: selectedProfileId, profileVersion: selectedProfileVersion, modelVersion: selectedModelVersion});
    let safe = null;
    const finish = completed => {
      const result = completed.result;
      const resultHash = hash(result);
      const executionMode = job.execution_mode === 'shadow' || mode === 'shadow' ? 'shadow' : 'normal';
      run = agent.updateSensemaking(run.id, {status: result.kind === 'noop' ? 'noop' : 'succeeded', resultHash, result, finishedAt: new Date().toISOString(), error: null, runtime: {runtimeVersion: completed.runtimeVersion, profile: profileSnapshot(), executionMode}}, 'sensemaking.completed', {status: result.kind === 'noop' ? 'noop' : 'succeeded', result_hash: resultHash, runtime_version: completed.runtimeVersion, execution_mode: executionMode}).run;
      const completedJob = workspace.hostWorkflow.finishSensemakingJob({job_id: job.job_id, lease_token: job.lease_token, owner_id: ownerId, result, run_id: run.id, route: executionMode !== 'shadow'});
      if (run.status !== 'committed') run = agent.updateSensemaking(run.id, {status: 'committed'}, 'sensemaking.committed', {product_status: completedJob.job.status, shadow: executionMode === 'shadow'}).run;
      processed += 1; lastFinishedAt = new Date().toISOString(); lastError = null;
      return {status: completedJob.job.status, job: completedJob.job, run, finding: completedJob.finding, proposal: completedJob.proposal, replay: completedJob.replay === true};
    };
    const onFailure = error => {
      const code = error?.code ?? 'SENSEMAKING_FAILED';
      const message = privacySafeError(error, job.input);
      // A failed schema/provider/echo check is still a privacy decision. If
      // the executor did not reach the accepted receipt write, retain only
      // the redaction metadata and a bounded rejection reason before closing
      // the Product job; never persist the rejected model payload.
      try {
        if (safe && workspace.hostWorkflow.listSensemakingPrivacyReceipts({job_id: job.job_id}).length === 0) {
          workspace.hostWorkflow.recordSensemakingPrivacy({job_id: job.job_id, lease_token: job.lease_token, owner_id: ownerId,
            policy_id: safe.receipt.policy_id, policy_version: safe.receipt.policy_version, input_hash: job.input_hash,
            redaction: safe.receipt, overlap: {matched: false, rejected: true, reason: code}, status: 'rejected'});
        }
      } catch { /* The Product failure receipt below remains authoritative. */ }
      try { if (run && !['succeeded', 'noop', 'committed'].includes(run.status)) run = agent.updateSensemaking(run.id, {status: 'failed', error: {code, message}}, 'sensemaking.failed', {code}).run; } catch {}
      try { if (job.lease_token) workspace.hostWorkflow.failSensemakingJob({job_id: job.job_id, lease_token: job.lease_token, owner_id: ownerId, error_code: code, error_message: message}); } catch {}
      lastError = {code, message}; lastFinishedAt = new Date().toISOString(); throw error;
    };
    try {
      // Keep input-policy failures inside the same failure path as provider
      // failures.  Otherwise a malformed/private job would retain a running
      // lease until expiry and could look healthy to the resident worker.
      safe = privacyView(job);
      const execute = mode === 'fixture' ? () => completeFixture(job, run, safe) : mode === 'disabled' ? () => fail('SENSEMAKING_DISABLED', 'sensemaking worker 已禁用', 503) : () => completeProfile(job, run, safe);
      const value = execute();
      return value && typeof value.then === 'function' ? value.then(finish, onFailure) : finish(value);
    } catch (error) { return onFailure(error); }
  }
  function once() {
    assertOpen();
    if (mode === 'disabled') return {status: 'disabled', job: null, run: null, finding: null, proposal: null};
    const job = workspace.hostWorkflow.claimSensemakingJob({leaseMs, maxAttempts: effectiveMaxAttempts, ownerId, profileId: selectedProfileId, profileVersion: selectedProfileVersion, modelVersion: selectedModelVersion, executionMode: mode === 'shadow' ? 'shadow' : 'normal'});
    if (!job) return {status: 'empty', job: null, run: null, finding: null, proposal: null};
    return processJob(job);
  }
  function drain({limit = 16} = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) fail('INVALID_WORKER_LIMIT', 'limit 必须在 1..1000', 400);
    if (mode === 'disabled') return {status: 'disabled', processed: 0, results: []};
    const results = [];
    const next = index => {
      if (index >= limit) return {status: 'drained', processed: results.filter(item => item.status !== 'empty').length, results};
      const result = once();
      if (result && typeof result.then === 'function') return result.then(value => { results.push(value); return value.status === 'empty' ? {status: 'drained', processed: results.filter(item => item.status !== 'empty').length, results} : next(index + 1); });
      results.push(result); if (result.status === 'empty') return {status: 'drained', processed: results.filter(item => item.status !== 'empty').length, results};
      return next(index + 1);
    };
    return next(0);
  }
  function schedule(delay) { if (!started || closed || timer) return; timer = setTimeout(() => { timer = null; void tick(); }, delay); timer.unref?.(); }
  async function tick() {
    if (!started || closed || running) return;
    running = true;
    try {
      activePromise = Promise.resolve(once());
      const value = await activePromise;
      // An empty queue should park the resident worker until the next poll;
      // repeatedly scheduling zero-delay ticks would otherwise spin a CPU
      // while the Product Workspace is idle.
      schedule(value?.status === 'empty' ? activePollMs : 0);
    }
    catch { schedule(activePollMs); }
    finally { activePromise = null; running = false; }
  }
  function start({pollMs: requestedPollMs = pollMs, maxConcurrent = 1} = {}) {
    assertOpen();
    if (!Number.isSafeInteger(requestedPollMs) || requestedPollMs < 100 || requestedPollMs > 60_000) fail('INVALID_WORKER_CONFIG', 'pollMs 必须在 100..60000', 400);
    if (maxConcurrent !== 1) fail('INVALID_WORKER_CONFIG', '当前 worker 只支持 maxConcurrent=1', 400);
    activePollMs = requestedPollMs;
    started = true; void tick(); return health();
  }
  async function stop() {
    started = false; if (timer) clearTimeout(timer); timer = null;
    if (activePromise) { try { await activePromise; } catch {} }
    return health();
  }
  return Object.freeze({once, drain, start, stop, health, close, product: workspace, agent, get ownerId() { return ownerId; }});
}
