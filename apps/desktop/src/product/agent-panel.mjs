import {h} from './library.mjs';

const terminal = ['succeeded', 'failed', 'cancelled', 'stale', 'timed_out', 'interrupted'];
const purposeLabels = {discuss:'一起分清', explain:'解释这一处', compare:'比较不同条件', revise:'建议修改选中部分'};
const streamEvents = ['run.queued', 'run.running', 'run.succeeded', 'run.failed', 'run.cancelled', 'run.stale', 'run.timed_out', 'run.interrupted',
  'runtime.connected', 'runtime.started', 'runtime.item', 'runtime.approval.required', 'runtime.input.required',
  'runtime.interaction.resolved', 'runtime.interaction.accepted', 'output.delta', 'tool.completed'];
const safeUrl = value => { try { const u = new URL(value); return ['http:','https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; } };
const text = value => typeof value === 'string' ? value : value == null ? '' : String(value);
const truncate = (value, limit = 600) => { const result = text(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ''); return result.length > limit ? `${result.slice(0, limit)}…` : result; };

/** Runtime interaction payloads are display-only and may contain paths or secrets. */
function redact(value, limit = 600) {
  return truncate(value, limit)
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[已隐藏]')
    .replace(/((?:token|secret|password|passwd|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[已隐藏]')
    .replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, '[本机路径]')
    .replace(/(?:\/Users|\/home|\/private\/var\/folders)\/[^\s/]+(?:\/[^\s]*)?/g, '[本机路径]');
}
function redactPath(value) {
  const safe = redact(value, 260); if (!safe || safe === '[本机路径]') return safe;
  const parts = safe.split(/[\\/]/).filter(Boolean); return parts.length > 1 ? `…/${parts.at(-1)}` : safe;
}

const pathLike = value => /(?:^[A-Za-z]:[\\/]|^\\\\|^\/(?:Users|home|private)\/|\\\\|\/)/.test(text(value));
const technicalIdLike = value => /^(?:(?:matter|run|thread|work|session|interaction|request)[-_:.])?[0-9a-f]{8,}(?:[-:.][0-9a-f]+)*$/i.test(text(value).trim());

/**
 * Technical identifiers are useful when a user explicitly opens diagnostics,
 * but they are not user-facing labels.  Keep only a short prefix/suffix in the
 * disclosure so support can correlate a screenshot without exposing a full
 * UUID, thread id, or local path.
 */
export function diagnosticValue(value, kind = 'id') {
  const raw = text(value).trim();
  if (!raw) return '未提供';
  if (kind === 'path' || pathLike(raw)) return '本机路径已隐藏';
  const safe = redact(raw, 240);
  if (!safe || safe.includes('[本机路径]')) return '本机路径已隐藏';
  if (safe.length <= 8) return '已隐藏';
  return `${safe.slice(0, 4)}…${safe.slice(-4)}`;
}

function semanticLabel(value, fallback) {
  const raw = text(value).trim();
  if (!raw || pathLike(raw) || technicalIdLike(raw)) return fallback;
  return truncate(redact(raw, 96), 72) || fallback;
}

function appendDiagnostics(parent, run = {}, identity = {}) {
  const details = parent.ownerDocument.createElement('details');
  details.className = 'web-agent-diagnostics';
  const summary = parent.ownerDocument.createElement('summary');
  summary.textContent = '诊断信息';
  details.append(summary);
  const note = parent.ownerDocument.createElement('p');
  note.className = 'web-agent-diagnostics-note';
  note.textContent = '仅用于支持排查；完整标识与本机路径已隐藏。';
  details.append(note);
  const list = parent.ownerDocument.createElement('dl');
  const sourceIdentity = run.__agent?.identity || identity || {};
  const fields = [
    ['事项标识', diagnosticValue(run.matterId ?? sourceIdentity.matterId)],
    ['工作标识', diagnosticValue(run.workId ?? sourceIdentity.workId)],
    ['运行标识', diagnosticValue(run.runId)],
    ['线程标识', diagnosticValue(run.runtime?.threadId ?? run.__agent?.threadId)],
    ['项目位置', diagnosticValue(run.projectIdentity ?? sourceIdentity.projectIdentity ?? run.project ?? sourceIdentity.project, 'path')],
  ];
  for (const [label, value] of fields) {
    const term = parent.ownerDocument.createElement('dt'); term.textContent = label;
    const description = parent.ownerDocument.createElement('dd'); description.textContent = value;
    list.append(term, description);
  }
  details.append(list); parent.append(details);
  return details;
}

/** Return only safe, display-oriented fields from an app-server interaction. */
export function sanitizeInteraction(interaction = {}) {
  const kind = interaction.kind === 'input' || interaction.method === 'item/tool/requestUserInput' ? 'input' : 'approval';
  const commandActions = Array.isArray(interaction.commandActions) ? interaction.commandActions.slice(0, 12).map(action => ({
    name: redact(action?.name, 120), path: redactPath(action?.path), command: redact(action?.command, 260),
  })) : [];
  const permissions = interaction.permissions && typeof interaction.permissions === 'object' ? {
    fileSystemEntries: Array.isArray(interaction.permissions.fileSystem?.entries)
      ? interaction.permissions.fileSystem.entries.slice(0, 12).map(entry => ({access: redact(entry?.access, 60), path: redactPath(entry?.path?.path ?? entry?.path)})) : [],
    network: interaction.permissions.network ? {enabled: interaction.permissions.network.enabled === true} : null,
  } : null;
  const questions = Array.isArray(interaction.questions) ? interaction.questions.slice(0, 32).map(question => ({
    id: text(question?.id), header: redact(question?.header, 160), question: redact(question?.question, 600),
    isSecret: question?.isSecret === true, options: Array.isArray(question?.options) ? question.options.slice(0, 16).map(option => redact(option?.label ?? option, 160)) : [],
  })) : [];
  return {
    interactionId: text(interaction.interactionId), revision: Number.isSafeInteger(interaction.revision) ? interaction.revision : null,
    kind, state: ['waiting', 'resolved', 'expired'].includes(interaction.state) ? interaction.state : 'waiting',
    recoverable: interaction.recoverable === true, reason: redact(interaction.reason, 900), commandActions, permissions, questions,
    network: interaction.network?.host ? {host: redact(interaction.network.host, 180)} : null,
  };
}

/** Build the only two interaction POST contracts used by the browser UI. */
export function interactionResponse({runId, kind, interactionId, expectedRevision, idempotencyKey = crypto.randomUUID(), decision, answers, permissions, content} = {}) {
  const body = {interactionId, expectedRevision, idempotencyKey};
  if (kind === 'input') body.answers = answers && typeof answers === 'object' ? answers : {};
  else {
    body.decision = decision;
    if (permissions !== undefined) body.permissions = permissions;
    if (content !== undefined) body.content = content;
  }
  return {path: `/api/agent/runs/${encodeURIComponent(runId)}/${kind === 'input' ? 'input' : 'approval'}`, body};
}

function identityOf(value = {}) {
  return {matterId: text(value.matterId), workId: value.workId == null ? null : text(value.workId),
    project: value.project == null ? null : text(value.project), projectIdentity: value.projectIdentity == null ? null : text(value.projectIdentity)};
}
function sameIdentity(a, b) {
  const left = identityOf(a), right = identityOf(b);
  const leftProject = left.projectIdentity ?? left.project, rightProject = right.projectIdentity ?? right.project;
  return left.matterId === right.matterId && left.workId === right.workId && left.project === right.project && leftProject === rightProject;
}

/** Build the explicit worksite Agent request envelope. Non-worksite panels do
 * not receive these fields, so the generic Agent protocol stays narrow. */
export function createWorksiteAgentPayload(base = {}, context = null) {
  if (!context?.workId) return {...base};
  const project = typeof context.project === 'string' ? context.project : context.project?.name ?? context.project?.identity ?? '';
  const projectIdentity = typeof context.projectIdentity === 'string' ? context.projectIdentity : context.projectIdentity?.identity ?? context.projectIdentity?.name ?? project;
  return {...base,
    workId: text(context.workId), role: text(context.role || 'mixed'),
    intake: Array.isArray(context.intake) ? context.intake.map(item => ({id: text(item.id), matterId: text(item.matterId), title: text(item.title),
      sourceText: text(item.sourceText ?? item.text), sourceVersion: Number.isSafeInteger(item.sourceVersion) ? item.sourceVersion : 0,
      role: text(item.role || 'reference'), note: text(item.note)})) : [],
    findings: Array.isArray(context.findings) ? context.findings.map(item => ({id: text(item.id), ...(item.matterId ? {matterId: text(item.matterId)} : {}),
      text: text(item.text), note: text(item.note), ...(item.relation ? {relation: text(item.relation)} : {}), useInCurrentWork: item.useInCurrentWork !== false})) : [],
    project, projectIdentity,
  };
}

/**
 * EventSource reconnects with the browser's Last-Event-ID header. The
 * explicit `after` cursor also makes manual reconnect/recovery durable.
 */
export function createDurableEventStream({runId, after = 0, EventSourceImpl = globalThis.EventSource, onEvent = () => {}, onStatus = () => {}} = {}) {
  if (typeof EventSourceImpl !== 'function') throw new TypeError('EventSource is unavailable');
  let cursor = Number.isSafeInteger(after) && after >= 0 ? after : 0, source = null, closed = false;
  const url = () => `/api/agent/runs/${encodeURIComponent(runId)}/events?after=${cursor}`;
  const dispatch = event => {
    const numeric = Number(event?.lastEventId); if (Number.isSafeInteger(numeric) && numeric > cursor) cursor = numeric;
    let packet = {}; try { packet = JSON.parse(event?.data || '{}'); } catch { onStatus('error', new Error('Agent 事件不是有效 JSON。')); return; }
    const data = packet && typeof packet === 'object' && packet.data && typeof packet.data === 'object' ? packet.data : packet;
    const type = packet?.type || event?.type, sequence = Number.isSafeInteger(packet?.sequence) ? packet.sequence : cursor;
    onEvent({type, data, sequence, lastEventId: cursor});
    if (type?.startsWith('run.') && terminal.includes(data?.status)) { source?.close?.(); onStatus('closed'); }
  };
  const connect = () => {
    if (closed) return; onStatus('connecting', cursor);
    try { source = new EventSourceImpl(url()); } catch (error) { onStatus('error', error); return; }
    for (const type of streamEvents) source.addEventListener?.(type, dispatch);
    source.onopen = () => onStatus('open', cursor); source.onerror = () => { if (!closed) onStatus('reconnecting', cursor); };
  };
  connect();
  return {
    close() { closed = true; source?.close?.(); source = null; onStatus('closed'); },
    reconnect() { if (closed) return; source?.close?.(); connect(); },
    get cursor() { return cursor; },
  };
}

/** State/controller seam shared by the browser panel and fake native SSE tests. */
export function createAgentPanelController({request, identity = {}, EventSourceImpl = globalThis.EventSource} = {}) {
  if (typeof request !== 'function') throw new TypeError('createAgentPanelController requires request');
  const binding = identityOf(identity), listeners = new Set(); let stream = null;
  let state = {run: null, interaction: null, resumeSource: null, resumeAvailable: false, worksiteReturn: null, status: 'idle', cursor: 0, error: null};
  const emit = () => { for (const listener of listeners) listener(state); };
  const canResume = run => { const sourceIdentity = run?.__agent?.identity; return !!run && run.matterId === binding.matterId && !!run.runtime?.threadId && !!sourceIdentity && sameIdentity(sourceIdentity, binding) && run.status === 'succeeded'; };
  const runIdentity = run => run?.workId === undefined ? binding : identityOf({matterId: run.matterId, workId: run.workId, project: run.project, projectIdentity: run.projectIdentity});
  const assertRunIdentity = run => {
    if (run?.workId !== undefined && !sameIdentity(runIdentity(run), binding)) throw new Error('运行返回的事项、工作或项目身份与当前工作现场不一致，已拒绝恢复。');
    return run;
  };
  const decorate = (run, meta = {}) => { assertRunIdentity(run); const source = meta.identity ?? run?.__agent?.identity ?? runIdentity(run); return {...run,
    __agent: {identity: identityOf(source), previousRunId: meta.previousRunId ?? run?.__agent?.previousRunId ?? null, threadId: meta.threadId ?? run?.runtime?.threadId ?? run?.__agent?.threadId ?? null}}; };
  let worksiteReturnInFlight = false;
  const returnWorksite = async run => {
    if (worksiteReturnInFlight || state.worksiteReturn || !run?.workId || run.status !== 'succeeded') return;
    worksiteReturnInFlight = true;
    try {
      const value = await request(`/api/agent/runs/${encodeURIComponent(run.runId)}/worksite`, {
        action: 'returned_for_review', commandId: `agent-worksite-return:${run.runId}`, expectedRevision: run.baseRevision,
        workId: run.workId, matterId: run.matterId, project: run.project, projectIdentity: run.projectIdentity ?? run.project,
      });
      state = {...state, worksiteReturn: value, run: {...state.run, worksiteReturn: value.receipt}}; emit();
    } catch (error) { state = {...state, error}; emit(); }
    finally { worksiteReturnInFlight = false; }
  };
  const setRun = (run, meta = {}) => {
    if (!run || typeof run !== 'object') throw new TypeError('Agent run is invalid');
    const decorated = decorate(run, meta); state = {...state, run: decorated, interaction: decorated.runtime?.pendingInteraction ?? null,
      worksiteReturn: decorated.worksiteReturn ? {receipt: decorated.worksiteReturn} : state.worksiteReturn,
      resumeAvailable: canResume(decorated), error: null, cursor: Number.isSafeInteger(decorated.lastEventId) ? decorated.lastEventId : state.cursor}; emit();
    void returnWorksite(decorated); return decorated;
  };
  const attach = run => {
    stream?.close?.();
    try {
      stream = createDurableEventStream({runId: run.runId, after: Number.isSafeInteger(run.lastEventId) ? run.lastEventId : 0, EventSourceImpl,
        onStatus: (status, value) => { state = {...state, status, cursor: stream?.cursor ?? state.cursor, error: status === 'error' ? value : null}; emit(); },
        onEvent: event => {
          const data = event.data || {}; const current = state.run; if (!current || current.runId !== run.runId) return; const nextRuntime = {...(current.runtime || {})};
          if (event.type === 'runtime.approval.required' || event.type === 'runtime.input.required') {
            const interaction = {...(data.interaction || {}), runId: current.runId, revision: Number.isSafeInteger(data.interaction?.revision) ? data.interaction.revision : event.sequence, state: 'waiting', recoverable: true, kind: event.type === 'runtime.input.required' ? 'input' : 'approval'};
            nextRuntime.pendingInteraction = interaction; state = {...state, interaction, run: {...current, runtime: nextRuntime, lastEventId: event.sequence}, cursor: event.sequence, status: 'waiting', error: null};
          } else if (event.type === 'runtime.interaction.resolved') {
            const resolvedId = data.interactionId ?? data.interaction?.interactionId, resolvedState = data.state ?? data.interaction?.state ?? 'resolved';
            const interaction = state.interaction && state.interaction.interactionId === resolvedId ? {...state.interaction, state: resolvedState, recoverable: false} : state.interaction;
            if (nextRuntime.pendingInteraction?.interactionId === resolvedId) nextRuntime.pendingInteraction = null;
            state = {...state, interaction, run: {...current, runtime: nextRuntime, lastEventId: event.sequence}, cursor: event.sequence, status: resolvedState === 'expired' ? 'expired' : 'resolved'};
          } else {
            const status = event.type.startsWith('run.') ? (data.status || event.type.slice(4)) : state.status;
            const terminalInteraction = event.type.startsWith('run.') && terminal.includes(status) && state.interaction?.state === 'waiting'
              ? {...state.interaction, state: 'expired', recoverable: false} : state.interaction;
            if (terminalInteraction !== state.interaction) nextRuntime.pendingInteraction = null;
            state = {...state, interaction: terminalInteraction, run: {...current, runtime: nextRuntime, ...(data.status ? {status: data.status} : {}), ...(data.result ? {result: data.result} : {}), ...(data.error ? {error: data.error} : {}), lastEventId: event.sequence}, cursor: event.sequence, status};
          }
          state.resumeAvailable = canResume(state.run); emit();
          if (event.type.startsWith('run.') && terminal.includes(state.run.status)) {
            // run.succeeded carries the validated result but not runtime.threadId;
            // refresh the authoritative record before exposing the resume action.
            void request(`/api/agent/runs/${encodeURIComponent(state.run.runId)}`).then(value => {
              if (!state.run || state.run.runId !== run.runId) return;
              const latest = value.run ?? value;
              setRun(latest, {identity: state.run.__agent?.identity, previousRunId: state.run.__agent?.previousRunId, threadId: latest.runtime?.threadId});
              state = {...state, status: latest.status}; emit();
            }).catch(error => { state = {...state, error}; emit(); });
          }
        }});
    } catch (error) { state = {...state, status: 'error', error}; emit(); }
  };
  const load = async (runId, meta = {}) => { const value = await request(`/api/agent/runs/${encodeURIComponent(runId)}`), run = setRun(value.run ?? value, meta); if (!terminal.includes(run.status)) attach(run); return run; };
  const start = async (body, meta = {}) => {
    if (body?.matterId !== binding.matterId || body?.workId !== undefined && body.workId !== binding.workId
      || body?.projectIdentity !== undefined && body.projectIdentity !== (binding.projectIdentity ?? binding.project)
      || body?.project !== undefined && body.project !== binding.project) throw new Error('当前 Agent 运行与事项、工作或项目身份不一致，未启动。');
    const value = await request('/api/agent/runs', body), run = setRun(value.run ?? value, {...meta, identity: meta.identity ?? binding, threadId: body.threadId, previousRunId: body.previousRunId});
    state = {...state, resumeSource: null, status: terminal.includes(run.status) ? run.status : 'queued'}; emit(); if (!terminal.includes(run.status)) attach(run); return value;
  };
  const prepareResume = () => { if (!state.resumeAvailable) throw new Error('这次运行没有可核验的同一项目、工作和事项身份，不能恢复。'); state = {...state, resumeSource: state.run, error: null}; emit(); return state.run; };
  const resume = async (body, meta = {}) => {
    if (body?.matterId !== undefined && body.matterId !== binding.matterId) throw new Error('恢复请求与当前事项身份不一致，未启动。');
    const source = state.resumeSource; if (!source || !sameIdentity(source.__agent?.identity, binding) || source.matterId !== binding.matterId || !source.runtime?.threadId) throw new Error('恢复前必须先选择当前绑定的可恢复运行。');
    return start({...body, matterId: binding.matterId, ...(source.workId === undefined ? {} : {workId: source.workId, role: source.role, intake: source.intake, findings: source.findings,
      project: source.project, projectIdentity: source.projectIdentity}), threadId: source.runtime.threadId, previousRunId: source.runId},
      {...meta, identity: source.__agent.identity, threadId: source.runtime.threadId, previousRunId: source.runId});
  };
  const respond = async (kind, body) => {
    const run = state.run, pending = state.interaction; if (!run || !pending || pending.state !== 'waiting' || pending.interactionId !== body?.interactionId) throw new Error('这项 Agent 交互已处理或已失效，请重新打开运行记录。');
    const value = await request(`/api/agent/runs/${encodeURIComponent(run.runId)}/${kind === 'input' ? 'input' : 'approval'}`, body); state = {...state, interaction: {...pending, state: 'resolved', recoverable: false}, status: 'resolving'}; emit(); return value;
  };
  return {subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, getState: () => state, setRun, load, start, prepareResume, resume, respond, reconnect: () => stream?.reconnect?.(), close: () => { stream?.close?.(); stream = null; listeners.clear(); }};
}

/** Same-origin Agent controller. Streaming fragments remain progress evidence; only terminal output becomes a result card. */
export function mountAgentPanel(root, {workspace, matterId, selection = null, sourceIds = [], workIdentity = {}, worksiteContext = null, onWorkspace} = {}) {
  let capabilities, busy = false, closed = false, workspaceRevision = workspace?.revision;
  const session = workspace?.host?.chain?.sessions?.[matterId]; if (!session) throw new TypeError('mountAgentPanel requires a current Product Workspace matter');
  const identity = identityOf({matterId, ...workIdentity, ...(worksiteContext?.projectIdentity ? {projectIdentity: worksiteContext.projectIdentity} : {})}); root.classList.add('web-agent-dialog');
  const matterRecord = workspace?.host?.chain?.matters?.find(item => item.id === matterId);
  const workRecord = identity.workId ? workspace?.host?.worksite?.works?.[identity.workId] : null;
  const matterLabel = semanticLabel(matterRecord?.title || matterRecord?.originalText || matterRecord?.whyCare, '当前这件事');
  const workLabel = semanticLabel(workRecord?.title, '本次工作');
  const projectLabel = semanticLabel(workRecord?.project || identity.project, '当前项目');
  root.insertAdjacentHTML('beforeend', `<p>让 Trace 调用已配置的 Agent 来讨论、解释或比较。结果先作为候选返回，不会自动写进「我的理解」。</p>
    <p data-agent-scope class="web-agent-scope" role="status">当前事项：${h(matterLabel)}${identity.workId ? ` · ${h(workLabel)}` : ''}${identity.project ? ` · ${h(projectLabel)}` : ''}</p>
    <p data-agent-capability role="status" aria-live="polite">正在检查 Agent Runtime…</p>
    <section data-agent-recovery class="web-agent-recovery" hidden aria-label="可恢复的 Agent 运行"></section>
    <section data-agent-interaction hidden aria-live="polite"></section>
    <form data-agent-form>
      <label>怎么帮助<select name="purpose">${Object.entries(purposeLabels).map(([value,label])=>`<option value="${value}" ${value==='revise'&&!selection?'disabled':''}>${label}</option>`).join('')}</select></label>
      <label>使用哪个 Agent<select name="profile" disabled><option>正在读取…</option></select></label>
      <fieldset data-retrieval hidden><legend>本次允许联网（默认不选）</legend><label><input type="checkbox" name="zhihu"> 知乎搜索</label><label><input type="checkbox" name="global"> 全网搜索</label></fieldset>
      ${selection ? `<p class="web-agent-selection"><small>已选中理解草稿中的一处</small><q>${h(selection.text)}</q></p>` : ''}
      <label>这次想问什么<textarea name="input" rows="4" maxlength="16000" required placeholder="例如：这里还混在一起的两个条件是什么？"></textarea></label>
      <footer><button type="button" data-cancel-run hidden>停止这次运行</button><button class="web-primary" type="submit" disabled>开始</button></footer>
    </form>
    <p data-agent-status role="status" aria-live="polite"></p><section data-agent-result></section>`);
  const find = selector => root.querySelector(selector), status = find('[data-agent-status]'), result = find('[data-agent-result]'), interaction = find('[data-agent-interaction]'), recovery = find('[data-agent-recovery]');
  const form = find('[data-agent-form]'), submit = form.querySelector('[type=submit]'), cancel = find('[data-cancel-run]');
  const runRefsKey = `trace:agent-runs:${identity.matterId}:${identity.workId || 'matter'}`; let resumeSource = null, storedRuns = [];
  const request = async (path, body) => { const response = await fetch(path, {method: body === undefined ? 'GET' : 'POST', cache: 'no-store', headers: body === undefined ? {} : {'content-type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})}); let value; try { value = await response.json(); } catch { throw Error(`Agent Runtime 返回了无法读取的响应（${response.status}）。`); } if (!response.ok) throw Error(value.error?.message || `Agent Runtime 请求失败（${response.status}）。`); return value; };
  const controller = createAgentPanelController({request, identity, EventSourceImpl: globalThis.EventSource});
  const line = (tag, value, className) => { const node = document.createElement(tag); if (className) node.className = className; node.textContent = text(value); return node; };
  function readStoredRuns() { try { const value = JSON.parse(sessionStorage.getItem(runRefsKey) || '[]'); return Array.isArray(value) ? value.slice(0, 8) : []; } catch { return []; } }
  function storeRun(run) { if (!run?.runId) return; const entry = {runId: run.runId, identity, previousRunId: run.__agent?.previousRunId ?? null, threadId: run.runtime?.threadId ?? run.__agent?.threadId ?? null}; storedRuns = [entry, ...storedRuns.filter(item => item.runId !== entry.runId)].slice(0, 8); try { sessionStorage.setItem(runRefsKey, JSON.stringify(storedRuns)); } catch {} }
  const syncSubmitState = () => { submit.disabled = busy || !capabilities?.enabled || !text(form.elements.input?.value).trim(); };
  function setBusy(value) { busy = value; cancel.hidden = !value; for (const field of form.querySelectorAll('select,input,textarea')) field.disabled = value || field.dataset.unavailable === 'true' || field.name === 'profile' && !capabilities?.enabled; syncSubmitState(); submit.textContent = resumeSource ? '继续这次运行' : '开始'; }
  function identitySummary(run) { return `${purposeLabels[run?.purpose] || 'Agent 运行'} · ${run?.workId ? '本次工作' : '当前事项'}`; }
  function renderInteraction(current, run) {
    interaction.replaceChildren(); interaction.hidden = !current; if (!current) return; const safe = sanitizeInteraction(current), card = document.createElement('article'); card.className = `web-agent-interaction web-agent-interaction-${safe.kind}`;
    card.append(line('small', safe.kind === 'input' ? 'Agent 需要你补充输入' : 'Agent 请求一次性审批', 'web-agent-interaction-label')); if (safe.reason) card.append(line('p', safe.reason, 'web-agent-interaction-reason')); if (safe.network?.host) card.append(line('p', `网络目标：${safe.network.host}`, 'web-agent-interaction-detail'));
    if (safe.commandActions.length) { card.append(line('h4', '将要执行的受控动作')); const list = document.createElement('ul'); for (const action of safe.commandActions) { const item = document.createElement('li'); item.append(line('strong', action.name || '命令')); if (action.path) item.append(line('span', ` · ${action.path}`)); if (action.command) item.append(line('p', action.command)); list.append(item); } card.append(list); }
    if (safe.permissions?.fileSystemEntries?.length) { card.append(line('h4', '需要的权限范围')); const list = document.createElement('ul'); for (const entry of safe.permissions.fileSystemEntries) list.append(line('li', `${entry.access || '访问'} · ${entry.path || '受控目录'}`)); card.append(list); }
    if (safe.state !== 'waiting' || !safe.recoverable) { card.append(line('p', safe.state === 'expired' ? '这项交互已过期；没有替你批准。' : '这项交互已处理，Agent 正在继续或已停止。', 'web-agent-interaction-state')); interaction.append(card); return; }
    if (safe.kind === 'input') {
      const inputForm = document.createElement('form'); inputForm.className = 'web-agent-input-form';
      for (const question of safe.questions) { const label = document.createElement('label'); label.textContent = question.header || question.question || question.id; const control = document.createElement(question.isSecret ? 'input' : 'textarea'); if (!question.isSecret) control.rows = 2; else control.type = 'password'; control.required = true; control.name = question.id; control.dataset.questionId = question.id; control.autocomplete = 'off'; if (question.isSecret) { control.dataset.secret = 'true'; control.setAttribute('aria-label', `${question.header || question.id}（敏感）`); } label.append(control); if (question.question) label.append(line('small', question.question, 'web-agent-question')); inputForm.append(label); }
      const footer = document.createElement('footer'), send = line('button', '提交输入'); send.type = 'submit'; send.className = 'web-primary'; footer.append(send); inputForm.append(footer);
      inputForm.onsubmit = async event => { event.preventDefault(); send.disabled = true; const answers = {}; for (const field of inputForm.querySelectorAll('[data-question-id]')) answers[field.dataset.questionId] = {answers: [String(field.value || '')]}; try { const payload = interactionResponse({runId: run.runId, kind: 'input', interactionId: safe.interactionId, expectedRevision: safe.revision, answers}); await controller.respond('input', payload.body); } catch (error) { send.disabled = false; status.textContent = error.message; } };
      card.append(inputForm);
    } else {
      const footer = document.createElement('footer'), accept = line('button', '批准这一次'); accept.type = 'button'; accept.className = 'web-primary'; const decline = line('button', '拒绝'); decline.type = 'button'; const cancelApproval = line('button', '取消运行'); cancelApproval.type = 'button';
      const sendApproval = async decision => { for (const button of [accept, decline, cancelApproval]) button.disabled = true; try { const payload = interactionResponse({runId: run.runId, kind: 'approval', interactionId: safe.interactionId, expectedRevision: safe.revision, decision}); await controller.respond('approval', payload.body); } catch (error) { for (const button of [accept, decline, cancelApproval]) button.disabled = false; status.textContent = error.message; } };
      accept.onclick = () => void sendApproval('accept'); decline.onclick = () => void sendApproval('decline'); cancelApproval.onclick = () => void sendApproval('cancel'); footer.append(accept, decline, cancelApproval); card.append(footer);
    }
    interaction.append(card);
  }
  function renderResult(current) {
    result.replaceChildren(); if (!current) return; const info = document.createElement('div'); info.className = 'web-agent-run-info'; info.append(line('small', identitySummary(current))); appendDiagnostics(info, current, identity); result.append(info);
    if (current.status !== 'succeeded') { if (current.status === 'running' || current.status === 'queued') return; result.append(line('p', current.error?.message || '本次运行没有产生可用结果。', 'web-agent-error')); return; } if (!current.result) return;
    const card = document.createElement('article'); card.className = 'web-agent-answer'; card.append(line('small', `${purposeLabels[current.purpose] || current.purpose} · ${current.profile?.label || current.profile?.profileId || 'Agent'}`)); card.append(line('h3', current.result.kind === 'revision_candidate' ? 'Agent 给出了一处修改候选' : 'Agent 的回答')); card.append(line('p', current.result.answer));
    if (current.result.replacement !== null) { const box = document.createElement('section'); box.className = 'web-agent-replacement'; box.append(line('strong', '候选替换为')); box.append(line('p', current.result.replacement)); card.append(box); }
    if (current.result.citations?.length) { card.append(line('h4', '引用')); const list = document.createElement('ul'); for (const citation of current.result.citations) list.append(line('li', `${citation.quote} · ${citation.contextId}`)); card.append(list); }
    if (current.result.sources?.length) { card.append(line('h4', '本次联网来源')); for (const source of current.result.sources) { const item = document.createElement('div'); item.className = 'web-agent-source'; item.append(line('strong', source.title || source.id)); item.append(line('p', source.excerpt || '')); const url = safeUrl(source.url); if (url) { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = '查看原文 ↗'; item.append(a); } card.append(item); } }
    if (current.result.uncertainties?.length) { card.append(line('h4', '仍不确定')); const list = document.createElement('ul'); for (const value of current.result.uncertainties) list.append(line('li', value)); card.append(list); }
    const actions = document.createElement('footer'); if (!current.workId && current.result.kind === 'revision_candidate' && current.result.adoption === 'not_applied') { const accept = line('button', current.usableAsCurrent ? '接受这一处' : '事项已变化，不能接受'); accept.type = 'button'; accept.className = 'web-primary'; accept.disabled = !current.usableAsCurrent || !capabilities?.candidateAdoption; accept.dataset.adopt = 'accept'; actions.append(accept); const dismiss = line('button', '放弃候选'); dismiss.type = 'button'; dismiss.dataset.adopt = 'dismiss'; actions.append(dismiss); } else if (!current.workId && current.result.adoption === 'applied') { const undo = line('button', '撤销这次采纳'); undo.type = 'button'; undo.dataset.adopt = 'undo'; actions.append(undo); }
    if (controller.getState().resumeAvailable) { const resume = line('button', '继续这次 Agent 运行'); resume.type = 'button'; resume.dataset.resume = 'true'; actions.append(resume); } if (actions.children.length) card.append(actions); result.append(card);
  }
  function renderRecovery() { recovery.replaceChildren(); const refs = storedRuns.filter(item => sameIdentity(item.identity, identity)); recovery.hidden = !refs.length; if (!refs.length) return; recovery.append(line('h3', '可恢复的 Agent 运行')); for (const ref of refs) { const item = document.createElement('article'); item.className = 'web-agent-recovery-item'; const copy = document.createElement('div'); copy.append(line('small', '最近一次 Agent 运行')); appendDiagnostics(copy, {runId: ref.runId, matterId: ref.identity?.matterId, workId: ref.identity?.workId, project: ref.identity?.project, projectIdentity: ref.identity?.projectIdentity, runtime: {threadId: ref.threadId}}, ref.identity); item.append(copy); const button = line('button', '打开运行'); button.type = 'button'; button.onclick = async () => { button.disabled = true; try { await controller.load(ref.runId, {identity: ref.identity, previousRunId: ref.previousRunId, threadId: ref.threadId}); resumeSource = null; renderRecovery(); } catch (error) { status.textContent = error.message; } finally { button.disabled = false; } }; item.append(button); recovery.append(item); } }
  let appliedWorksiteReturn = null;
  function syncState(next) {
    if (closed) return;
    const current = next.run;
    if (current) storeRun(current);
    if (next.worksiteReturn && next.worksiteReturn !== appliedWorksiteReturn) {
      appliedWorksiteReturn = next.worksiteReturn;
      if (next.worksiteReturn.product) { workspaceRevision = next.worksiteReturn.product.revision; onWorkspace?.(next.worksiteReturn.product); }
    }
    if (current?.__agent?.previousRunId) resumeSource = next.resumeSource;
    if (!next.resumeSource && current?.status !== 'succeeded') resumeSource = null;
    setBusy(!!current && !terminal.includes(current.status)); renderInteraction(next.interaction, current); renderResult(current); renderRecovery();
    if (next.status === 'reconnecting') status.textContent = `事件连接暂时中断；将使用 Last-Event-ID #${next.cursor || 0} 继续接收。`;
    else if (next.interaction?.state === 'waiting') status.textContent = next.interaction.kind === 'input' ? 'Agent 正在等待你的输入。' : 'Agent 正在等待你明确批准；不会自动批准。';
    else if (next.worksiteReturn?.receipt?.status === 'returned_for_review') status.textContent = 'Agent 结果已回到当前工作现场复核区；请先打开修订预览，再由你确认。';
    else if (current && terminal.includes(current.status)) status.textContent = `本次运行：${current.status}`;
    else if (current) status.textContent = 'Agent 已连接，正在处理…';
  }
  const unsubscribe = controller.subscribe(syncState);
  form.addEventListener('input', () => syncSubmitState());
  form.onsubmit = async event => { event.preventDefault(); if (busy || !capabilities?.enabled) return; const data = new FormData(form), purpose = String(data.get('purpose')), input = String(data.get('input') || '').trim(), retrieval = ['zhihu', 'global'].filter(name => data.get(name) === 'on'); if (!input) { status.textContent = '请先写下这次想问 Agent 的内容。'; form.elements.input.focus(); syncSubmitState(); return; } result.replaceChildren(); setBusy(true); status.textContent = resumeSource ? '正在显式续接同一 Agent 线程…' : '正在创建一次有身份的 Agent 运行…'; const base = {protocolVersion: 1, requestId: crypto.randomUUID(), expectedRevision: workspaceRevision, matterId, contextMode: session.contextMode, contextEpoch: session.contextEpoch, purpose, input, profileId: String(data.get('profile') || ''), ...(sourceIds.length ? {sourceIds: sourceIds.slice(0, 8) } : {}), ...(purpose === 'revise' && selection ? {selection} : {}), ...(retrieval.length ? {retrieval: {sources: retrieval}} : {})}; const body = createWorksiteAgentPayload(base, worksiteContext); try { if (resumeSource) await controller.resume(body, {identity}); else await controller.start(body, {identity}); resumeSource = null; form.elements.input.value = ''; syncSubmitState(); } catch (error) { setBusy(false); status.textContent = error.message; } };
  cancel.onclick = async () => { const current = controller.getState().run; if (!current || !busy) return; cancel.disabled = true; try { await request(`/api/agent/runs/${encodeURIComponent(current.runId)}/cancel`, {}); await controller.load(current.runId, {identity}); } catch (error) { status.textContent = error.message; } finally { cancel.disabled = false; } };
  result.onclick = async event => { const resume = event.target.closest('[data-resume]'); if (resume) { try { controller.prepareResume(); resumeSource = controller.getState().resumeSource; submit.focus(); status.textContent = '已选择同一事项、工作和项目；输入新问题后才会续接，不会自动批准。'; setBusy(false); } catch (error) { status.textContent = error.message; } return; } const button = event.target.closest('[data-adopt]'), current = controller.getState().run; if (!button || !current) return; button.disabled = true; try { const action = button.dataset.adopt, body = action === 'dismiss' ? {action} : {action, commandId: crypto.randomUUID(), expectedRevision: workspaceRevision}; const changed = await request(`/api/agent/runs/${encodeURIComponent(current.runId)}/adoption`, body); controller.setRun(changed.run, {identity, previousRunId: current.__agent?.previousRunId, threadId: current.__agent?.threadId}); if (changed.product) { workspaceRevision = changed.product.revision; onWorkspace?.(changed.product); } status.textContent = action === 'accept' ? '候选已应用到草稿，尚未替你保存为当前理解。' : action === 'undo' ? '这次采纳已撤销；其他后来内容没有被覆盖。' : '候选已放弃，原内容没有变化。'; } catch (error) { button.disabled = false; status.textContent = error.message; } };
  storedRuns = readStoredRuns(); renderRecovery();
  void request('/api/agent/capabilities').then(value => { if (closed) return; capabilities = value; const profile = form.elements.profile; profile.replaceChildren(); for (const item of value.profiles || []) { const option = document.createElement('option'); option.value = item.profileId; option.textContent = `${item.label} · ${item.kind}`; option.selected = item.profileId === value.defaultProfileId; profile.append(option); } find('[data-agent-capability]').textContent = value.enabled ? `Agent Runtime 已启用 · ${value.profiles.length} 个服务端 profile · 自动写入关闭` : 'Agent Runtime 尚未启用。启动本机后端时设置 TRACE_AGENT_ENABLED=1。'; const retrievalField = find('[data-retrieval]'); retrievalField.hidden = !value.externalRetrieval; for (const name of ['zhihu', 'global']) form.elements[name].dataset.unavailable = String(!value.searchSources?.includes(name)); const current = controller.getState().run; setBusy(!!current && !terminal.includes(current.status)); renderRecovery(); }).catch(error => { find('[data-agent-capability]').textContent = error.message; setBusy(false); });
  root.traceCleanup = () => { closed = true; unsubscribe(); controller.close(); };
}
