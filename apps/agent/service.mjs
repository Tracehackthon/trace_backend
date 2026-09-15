import { EventEmitter } from 'node:events';
import { AgentError, demand, hash, TERMINAL, validateRequest, validateOutput } from './protocol.mjs';
import { assembleContext } from './context.mjs';
import { createRetrievalSession } from './retrieval.mjs';

const fixedRegistry = adapter => ({
  describe: () => ({ defaultProfileId: 'fixture', profiles: [{ profileId: 'fixture', label: 'Fixture', kind: 'agent', ownerId: 'fixture', version: 1,
    revision: 'fixture', capabilities: adapter.capabilities ?? { tools: true, streaming: true, cancellation: true, output: 'trace-result-v1' } }] }),
  bind: profileId => {
    demand(profileId === undefined || profileId === 'fixture', 'PROFILE_NOT_FOUND', '所选 Agent profile 不存在。', 404);
    return { binding: { profileId: 'fixture', label: 'Fixture', kind: 'agent', ownerId: 'fixture', version: 1, revision: 'fixture',
      capabilities: adapter.capabilities ?? { tools: true, streaming: true, cancellation: true, output: 'trace-result-v1' } }, executor: adapter };
  },
  resolve: binding => {
    demand(binding?.profileId === 'fixture' && binding.revision === 'fixture', 'PROFILE_CHANGED', '运行绑定的 Agent profile 已变化。', 409);
    return { binding, executor: adapter };
  },
  isCurrent: binding => binding?.profileId === 'fixture' && binding.revision === 'fixture',
  check: async (profileId, signal) => ({ profile: fixedRegistry(adapter).bind(profileId).binding, ...(await adapter.check({ signal })) }),
});

export function createAgentService({ store, readWorkspace, executorRegistry, adapter, retrievalProvider = null, timeoutMs = 180000, maxConcurrent = 1, pollMs = 250 }) {
  demand(executorRegistry || adapter, 'INVALID_EXECUTOR', '缺少 Agent executor registry。', 500);
  executorRegistry ??= fixedRegistry(adapter);
  const bus = new EventEmitter(), jobs = new Map(); let closed = false, storageFailed = false;
  bus.setMaxListeners(64);
  const get = id => { const run = store.get(id); demand(run, 'RUN_NOT_FOUND', '没有这个运行记录。', 404); return run; };
  const isWorkspaceCurrent = run => {
    const snapshot = readWorkspace(), session = snapshot.host?.chain.sessions[run.request.matterId];
    // Conservative v1 CAS: even an unrelated workspace edit invalidates a run.
    // This avoids binding a result to a deleted/recreated object with reused IDs.
    return snapshot.revision === run.context.baseRevision && session?.contextMode === run.request.contextMode
      && session.contextEpoch === run.request.contextEpoch;
  };
  function publicRun(run) {
    let current = false;
    try { current = isWorkspaceCurrent(run) && executorRegistry.isCurrent(run.profile); } catch { /* unavailable store never grants usability */ }
    return { protocolVersion: 1, runId: run.id, requestId: run.request.requestId, matterId: run.request.matterId,
      purpose: run.request.purpose, contextMode: run.request.contextMode, contextEpoch: run.request.contextEpoch,
      baseRevision: run.context.baseRevision, contextHash: run.context.contextHash, status: run.status,
      createdAt: run.createdAt, startedAt: run.startedAt, finishedAt: run.finishedAt, lastEventId: run.lastEventId,
      contextManifest: run.context.fragments.map(({ id, role, revision }) => ({ id, role, revision })), omitted: run.context.omitted,
      profile: run.profile, result: run.result, error: run.error, runtime: run.runtime, usableAsCurrent: run.status === 'succeeded' && current,
      canonicalStateChanged: false };
  }
  function update(id, patch, type, data) {
    let outcome;
    try { outcome = store.update(id, patch, type, data); }
    catch (error) { storageFailed = true; throw error; }
    if (outcome.event) bus.emit(id, outcome.event);
    return outcome.run;
  }
  function stop(id, status, code, message) {
    const run = get(id);
    if (!TERMINAL.has(run.status)) {
      try { update(id, { status, finishedAt: new Date().toISOString(), result: null, error: { code, message } }, `run.${status}`, { status, error: { code, message } }); }
      finally { jobs.get(id)?.controller.abort(); }
    }
    return publicRun(get(id));
  }
  async function execute(id, controller) {
    let timer, invalidation;
    try {
      let run = get(id);
      if (controller.signal.aborted) return;
      demand(isWorkspaceCurrent(run), 'STALE_CONTEXT', '请求开始前工作区已变化。', 409);
      const selected = executorRegistry.resolve(run.profile);
      run = update(id, { status: 'running', startedAt: new Date().toISOString() }, 'run.running', { status: 'running' });
      const safeStop = (...args) => { try { stop(...args); } catch { storageFailed = true; controller.abort(); } };
      timer = setTimeout(() => safeStop(id, 'timed_out', 'RUN_TIMEOUT', '本次执行超时；未自动重试，原文未改变。'), timeoutMs);
      invalidation = setInterval(() => {
        try {
          if (!isWorkspaceCurrent(run)) safeStop(id, 'stale', 'STALE_CONTEXT', '事项、版本或上下文已变化，停止旧请求。');
          else if (!executorRegistry.isCurrent(run.profile)) safeStop(id, 'stale', 'PROFILE_CHANGED', 'Agent profile 已变化或撤权，停止旧请求。');
        }
        catch { safeStop(id, 'failed', 'WORKSPACE_UNAVAILABLE', '无法核验当前工作区，执行已停止。'); }
      }, pollMs);
      const retrieval = createRetrievalSession({provider: retrievalProvider, sources: run.request.retrieval?.sources,
        signal: controller.signal, isCurrent: () => !closed && isWorkspaceCurrent(run) && executorRegistry.isCurrent(run.profile)});
      const output = await selected.executor.execute({ request: run.request, context: run.context, signal: controller.signal, retrieval,
        profile: run.profile, isCurrent: () => !closed && isWorkspaceCurrent(run) && executorRegistry.isCurrent(run.profile), onEvent: (type, data) => {
          if (controller.signal.aborted || TERMINAL.has(get(id).status)) return;
          demand(isWorkspaceCurrent(run) && executorRegistry.isCurrent(run.profile), 'STALE_CONTEXT', '流式结果对应的版本或执行配置已变化。', 409);
          demand(['runtime.connected', 'runtime.started', 'output.delta', 'tool.completed'].includes(type), 'INVALID_ADAPTER_EVENT', '未支持的 Adapter 事件。', 502);
          const runtime = type.startsWith('runtime.') ? { ...(get(id).runtime ?? {}), ...data } : get(id).runtime;
          update(id, { runtime }, type, data);
        } });
      if (controller.signal.aborted || TERMINAL.has(get(id).status)) return;
      demand(isWorkspaceCurrent(run) && executorRegistry.isCurrent(run.profile), 'STALE_CONTEXT', '完成时工作区或执行配置已变化，结果不可作为当前建议。', 409);
      const sources = retrieval.evidence();
      const deliveredContext = { ...run.context, fragments: [...(output.providedFragments ?? []).filter(f =>
        run.context.fragments.some(allowed => f.id === allowed.id && typeof f.text === 'string' && allowed.text.includes(f.text))),
        ...sources.map(s => ({id: s.id, text: s.excerpt}))] };
      const result = validateOutput(output.raw, deliveredContext, run.request);
      if (run.request.retrieval) result.sources = sources;
      update(id, { status: 'succeeded', finishedAt: new Date().toISOString(), result, runtime: { ...(get(id).runtime ?? {}),
        threadId: output.threadId, turnId: output.turnId, runtimeVersion: output.runtimeVersion } }, 'run.succeeded', { status: 'succeeded', result });
    } catch (cause) {
      try { if (!TERMINAL.has(get(id).status)) {
        const error = cause instanceof AgentError ? cause : new AgentError('AGENT_EXECUTION_FAILED', '执行失败；原文未改变。', 502);
        stop(id, ['STALE_CONTEXT', 'PROFILE_CHANGED', 'PROFILE_REVOKED', 'PROFILE_CREDENTIAL_UNAVAILABLE'].includes(error.code) ? 'stale' : 'failed', error.code, error.message);
      } } catch { storageFailed = true; controller.abort(); }
    } finally { clearTimeout(timer); clearInterval(invalidation); jobs.delete(id); }
  }
  return {
    get searchSources() {return retrievalProvider?.status().search_configured ? ['zhihu', 'global'] : [];},
    get executorCapabilities() { return executorRegistry.describe(); },
    get: id => { demand(!storageFailed, 'AGENT_STORAGE_UNAVAILABLE', '运行记录写入失败；执行已停止，请恢复存储后重启服务。', 503); return publicRun(get(id)); },
    byRequest(requestId) { const run = store.find(requestId); demand(run, 'RUN_NOT_FOUND', '没有该请求的运行记录。', 404); return publicRun(run); },
    create(body) {
      demand(!closed, 'AGENT_CLOSED', 'Agent 服务已关闭。', 503);
      demand(!storageFailed, 'AGENT_STORAGE_UNAVAILABLE', '运行记录存储不可用，未启动新模型请求。', 503);
      let request = validateRequest(body); const previous = store.find(request.requestId);
      if (previous) {
        request = { ...request, profileId: request.profileId ?? previous.request.profileId };
        demand(previous.requestHash === hash(request), 'REQUEST_CONFLICT', '相同 requestId 不能提交不同输入。', 409);
        return { run: publicRun(previous), replay: true };
      }
      const selected = executorRegistry.bind(request.profileId);
      request = { ...request, profileId: selected.binding.profileId };
      demand(!request.retrieval || retrievalProvider?.status().search_configured, 'RETRIEVAL_UNAVAILABLE', '本机知乎检索未配置；没有启动模型请求。', 503);
      demand(jobs.size < maxConcurrent, 'AGENT_BUSY', '已有 Agent 请求运行；请等待或明确取消。', 429);
      const snapshot = readWorkspace(), history = []; let ancestorId = request.previousRunId;
      for (let depth = 0; ancestorId && depth < 6; depth++) {
        const ancestor = get(ancestorId);
        demand(ancestor.status === 'succeeded' && ancestor.request.matterId === request.matterId
          && ancestor.request.contextMode === request.contextMode && ancestor.request.contextEpoch === request.contextEpoch
          && ancestor.context.baseRevision === snapshot.revision, 'HISTORY_SCOPE_MISMATCH', '旧请求不属于本次事项、版本或上下文 epoch。', 409);
        history.unshift({ runId: ancestor.id, input: ancestor.request.input, answer: ancestor.result.answer });
        ancestorId = ancestor.request.previousRunId;
      }
      const context = assembleContext(snapshot, request, history), run = store.create(request, context, selected.binding), controller = new AbortController();
      const job = { controller, promise: null }; jobs.set(run.id, job);
      job.promise = Promise.resolve().then(() => execute(run.id, controller));
      return { run: publicRun(run), replay: false };
    },
    cancel(id) { return stop(id, 'cancelled', 'USER_CANCELLED', '用户取消了本次执行。'); },
    events: (id, after) => { get(id); return store.events(id, after); },
    subscribe(id, listener) { get(id); bus.on(id, listener); return () => bus.off(id, listener); },
    async check(profileId, signal) { demand(!closed, 'AGENT_CLOSED', 'Agent 服务已关闭。', 503); return executorRegistry.check(profileId, signal); },
    async close() {
      if (closed) return; closed = true;
      const active = [...jobs.entries()];
      for (const [id, job] of active) { try { stop(id, 'interrupted', 'SERVICE_STOPPED', '服务停止，未自动重复执行。'); } catch { job.controller.abort(); } }
      await Promise.allSettled(active.map(([, job]) => job.promise)); bus.removeAllListeners(); store.close();
    },
  };
}
