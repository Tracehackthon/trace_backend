import { EventEmitter } from 'node:events';
import { AgentError, demand, hash, TERMINAL, validateRequest, validateOutput } from './protocol.mjs';
import { assembleContext } from './context.mjs';

export function createAgentService({ store, readWorkspace, adapter, timeoutMs = 180000, maxConcurrent = 1, pollMs = 250 }) {
  const bus = new EventEmitter(), jobs = new Map(); let closed = false, storageFailed = false;
  bus.setMaxListeners(64);
  const get = id => { const run = store.get(id); demand(run, 'RUN_NOT_FOUND', '没有这个运行记录。', 404); return run; };
  const isCurrent = run => {
    const snapshot = readWorkspace(), session = snapshot.host?.chain.sessions[run.request.matterId];
    // Conservative v1 CAS: even an unrelated workspace edit invalidates a run.
    // This avoids binding a result to a deleted/recreated object with reused IDs.
    return snapshot.revision === run.context.baseRevision && session?.contextMode === run.request.contextMode
      && session.contextEpoch === run.request.contextEpoch;
  };
  function publicRun(run) {
    let current = false;
    try { current = isCurrent(run); } catch { /* unavailable store never grants usability */ }
    return { protocolVersion: 1, runId: run.id, requestId: run.request.requestId, matterId: run.request.matterId,
      purpose: run.request.purpose, contextMode: run.request.contextMode, contextEpoch: run.request.contextEpoch,
      baseRevision: run.context.baseRevision, contextHash: run.context.contextHash, status: run.status,
      createdAt: run.createdAt, startedAt: run.startedAt, finishedAt: run.finishedAt, lastEventId: run.lastEventId,
      contextManifest: run.context.fragments.map(({ id, role, revision }) => ({ id, role, revision })), omitted: run.context.omitted,
      result: run.result, error: run.error, runtime: run.runtime, usableAsCurrent: run.status === 'succeeded' && current,
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
      demand(isCurrent(run), 'STALE_CONTEXT', '请求开始前工作区已变化。', 409);
      run = update(id, { status: 'running', startedAt: new Date().toISOString() }, 'run.running', { status: 'running' });
      const safeStop = (...args) => { try { stop(...args); } catch { storageFailed = true; controller.abort(); } };
      timer = setTimeout(() => safeStop(id, 'timed_out', 'RUN_TIMEOUT', '本次执行超时；未自动重试，原文未改变。'), timeoutMs);
      invalidation = setInterval(() => {
        try { if (!isCurrent(run)) safeStop(id, 'stale', 'STALE_CONTEXT', '事项、版本或上下文已变化，停止旧请求。'); }
        catch { safeStop(id, 'failed', 'WORKSPACE_UNAVAILABLE', '无法核验当前工作区，执行已停止。'); }
      }, pollMs);
      const output = await adapter.execute({ request: run.request, context: run.context, signal: controller.signal,
        isCurrent: () => !closed && isCurrent(run), onEvent: (type, data) => {
          if (controller.signal.aborted || TERMINAL.has(get(id).status)) return;
          demand(isCurrent(run), 'STALE_CONTEXT', '流式结果对应的版本已变化。', 409);
          demand(['runtime.connected', 'runtime.started', 'output.delta', 'tool.completed'].includes(type), 'INVALID_ADAPTER_EVENT', '未支持的 Adapter 事件。', 502);
          const runtime = type.startsWith('runtime.') ? { ...(get(id).runtime ?? {}), ...data } : get(id).runtime;
          update(id, { runtime }, type, data);
        } });
      if (controller.signal.aborted || TERMINAL.has(get(id).status)) return;
      demand(isCurrent(run), 'STALE_CONTEXT', '完成时工作区已变化，结果不可作为当前建议。', 409);
      const deliveredContext = { ...run.context, fragments: (output.providedFragments ?? []).filter(f =>
        run.context.fragments.some(allowed => f.id === allowed.id && typeof f.text === 'string' && allowed.text.includes(f.text))) };
      const result = validateOutput(output.raw, deliveredContext, run.request);
      update(id, { status: 'succeeded', finishedAt: new Date().toISOString(), result, runtime: { ...(get(id).runtime ?? {}),
        threadId: output.threadId, turnId: output.turnId, runtimeVersion: output.runtimeVersion } }, 'run.succeeded', { status: 'succeeded', result });
    } catch (cause) {
      try { if (!TERMINAL.has(get(id).status)) {
        const error = cause instanceof AgentError ? cause : new AgentError('AGENT_EXECUTION_FAILED', '执行失败；原文未改变。', 502);
        stop(id, error.code === 'STALE_CONTEXT' ? 'stale' : 'failed', error.code, error.message);
      } } catch { storageFailed = true; controller.abort(); }
    } finally { clearTimeout(timer); clearInterval(invalidation); jobs.delete(id); }
  }
  return {
    get: id => { demand(!storageFailed, 'AGENT_STORAGE_UNAVAILABLE', '运行记录写入失败；执行已停止，请恢复存储后重启服务。', 503); return publicRun(get(id)); },
    byRequest(requestId) { const run = store.find(requestId); demand(run, 'RUN_NOT_FOUND', '没有该请求的运行记录。', 404); return publicRun(run); },
    create(body) {
      demand(!closed, 'AGENT_CLOSED', 'Agent 服务已关闭。', 503);
      demand(!storageFailed, 'AGENT_STORAGE_UNAVAILABLE', '运行记录存储不可用，未启动新模型请求。', 503);
      const request = validateRequest(body), previous = store.find(request.requestId);
      if (previous) { demand(previous.requestHash === hash(request), 'REQUEST_CONFLICT', '相同 requestId 不能提交不同输入。', 409); return { run: publicRun(previous), replay: true }; }
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
      const context = assembleContext(snapshot, request, history), run = store.create(request, context), controller = new AbortController();
      const job = { controller, promise: null }; jobs.set(run.id, job);
      job.promise = Promise.resolve().then(() => execute(run.id, controller));
      return { run: publicRun(run), replay: false };
    },
    cancel(id) { return stop(id, 'cancelled', 'USER_CANCELLED', '用户取消了本次执行。'); },
    events: (id, after) => { get(id); return store.events(id, after); },
    subscribe(id, listener) { get(id); bus.on(id, listener); return () => bus.off(id, listener); },
    async check(signal) { demand(!closed, 'AGENT_CLOSED', 'Agent 服务已关闭。', 503); return adapter.check({ signal }); },
    async close() {
      if (closed) return; closed = true;
      const active = [...jobs.entries()];
      for (const [id, job] of active) { try { stop(id, 'interrupted', 'SERVICE_STOPPED', '服务停止，未自动重复执行。'); } catch { job.controller.abort(); } }
      await Promise.allSettled(active.map(([, job]) => job.promise)); bus.removeAllListeners(); store.close();
    },
  };
}
