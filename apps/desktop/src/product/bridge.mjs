// Web host adaptation. Derived from the locked artifacts; no IO or external AI.
import { createChainState, reduceChain, selectChainView } from './chain-model.mjs';
import { createComparisonState, reduceComparison, selectComparisonView, applyComparisonRequest } from './comparison-model.mjs';
import { createWorksiteState, reduceWorksite, selectWorksiteView } from './worksite-model.mjs';

const copy = value => structuredClone(value);
const nonempty = value => typeof value === 'string' && !!value.trim();
const own = (object, key) => Object.hasOwn(object, key);
const matter = (host, id) => host.chain.matters.find(item => item.id === id);
const failure = (host, code, message) => ({ ...host, error: { code, message } });
const withoutMatters = ({ matters, ...local }) => local;
const keyOK = value => nonempty(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const titleOf = item => item.title || String(item.originalText || '').split(/\r?\n/)[0];

export function createBridge() {
  const chain = createChainState();
  chain.sources = []; // Default chain includes two demo sources even with fixture:'empty'.
  return { schemaVersion: 1, chain, comparisons: {}, worksite: withoutMatters(createWorksiteState({ matters: [], works: [] })),
    workGuards: {}, route: { view: 'home' }, error: null };
}

/** Host-issued IDs, never title-based lookup. No understanding is inferred. */
export function captureInput(host, { matterId, text, source } = {}) {
  if (!keyOK(matterId) || matter(host, matterId)) return failure(host, 'invalid_identity', '事项 ID 无效或已存在。');
  if (!nonempty(text) && !nonempty(source?.excerpt)) return failure(host, 'empty_capture', '先留下一点文字或来源摘录。');
  if (source && (!keyOK(source.id) || !nonempty(source.excerpt) || source.url != null || host.chain.sources.some(s => s.id === source.id)))
    return failure(host, 'invalid_source', '来源必须有唯一 ID 和实际摘录；本适配不读取链接。');
  const next = copy(host);
  while (next.chain.matters.some(item => item.id === `matter-${next.chain.nextId}`)) next.chain.nextId++;
  if (source) {
    next.chain.sources.push({ ...copy(source), kind: 'user', ownerMatterId: matterId, url: null });
    // CAPTURE_EXCERPT checks ownership against selection before the new matter exists.
    const pending = next.chain.sources.at(-1);
    delete pending.ownerMatterId;
    next.chain = reduceChain(next.chain, { type: 'CAPTURE_EXCERPT', text: source.excerpt, sourceId: source.id });
  }
  next.chain = reduceChain(next.chain, { type: 'CAPTURE_DRAFT', text: typeof text === 'string' ? text : '' });
  next.chain = reduceChain(next.chain, { type: 'CAPTURE', intent: 'discuss' });
  // The existing reducer cannot accept external IDs. Rename only at creation,
  // before any dependent work, source observation, revision or comparison exists.
  const generatedId = next.chain.selectedId;
  const captured = matter(next, generatedId);
  captured.id = matterId;
  captured.originalExpressionId = `${matterId}:original`;
  captured.originalTextVersion = 1;
  captured.origin = 'user';
  next.chain.sessions[matterId] = next.chain.sessions[generatedId];
  if (matterId !== generatedId) delete next.chain.sessions[generatedId];
  next.chain.selectedId = matterId;
  if (source) next.chain.sources.find(s => s.id === source.id).ownerMatterId = matterId;
  next.route = { view: 'chain', matterId, screen: 'resume', contextMode: 'resume' };
  next.error = null;
  return next;
}

/** Existing chain actions, explicitly addressed to an object rather than a UI selection. */
export function dispatchChain(host, { matterId, action, expectedUnderstandingVersion } = {}) {
  const current = matter(host, matterId);
  if (!current) return failure(host, 'unknown_matter', '没有找到这件事；保持原页面与草稿。');
  if (expectedUnderstandingVersion !== undefined && expectedUnderstandingVersion !== current.understandingVersion)
    return failure(host, 'version_conflict', '理解已有后来修改；未覆盖新版本。');
  if (!action || ['CAPTURE', 'CAPTURE_DRAFT', 'CAPTURE_EXCERPT', 'TOGGLE_SOURCE'].includes(action.type))
    return failure(host, 'unsupported_action', '新输入请使用明确的宿主捕获入口。');
  if (action.type === 'OPEN' && action.id !== matterId) return failure(host, 'matter_mismatch', '打开对象与事项 ID 不一致。');
  // Do not let the old chain result/handoff screen create a second work/result owner.
  if (['COMMIT_REVISION', 'UNDO_REVISION', 'KEEP_RESULT_ONLY', 'RESULT_DRAFT', 'WORK_FINDING'].includes(action.type))
    return failure(host, 'use_worksite', '结果与工作修订统一交给工作现场宿主。');
  if (action.type === 'SAVE_UNDERSTANDING' && !nonempty(current.understandingDraft))
    return failure(host, 'empty_understanding', '空草稿不会静默清空已保存理解。');
  const next = copy(host);
  next.chain.selectedId = matterId;
  next.chain = reduceChain(next.chain, action);
  if (['SEND', 'FRESH_CONTEXT', 'RESUME_CONTEXT'].includes(action.type)) {
    const before = selectChainView({ ...host.chain, selectedId: matterId }).discussion.text;
    const after = selectChainView(next.chain).discussion.text;
    if (before !== after) next.chain.sessions[matterId].discussionVersion = (host.chain.sessions[matterId].discussionVersion || 0) + 1;
  }
  next.error = null;
  return next;
}

export function selectChain(host, matterId) {
  if (!matter(host, matterId)) return null;
  const view = selectChainView({ ...host.chain, selectedId: matterId });
  const current = matter(host, matterId);
  view.matter.title = titleOf(current);
  view.matters = view.matters.map(item => ({ ...item, title: titleOf(matter(host, item.id)) }));
  view.notice = host.error?.message || view.notice;
  view.hostError = copy(host.error);
  view.matter.observations.push(...(current.links || []).map(link => ({ id: link.id, sourceId: link.sourceId,
    text: link.source.excerpt, relation: link.relationship.type, target: copy(link.focus), origin: 'compare-host' })));
  for (const session of Object.values(host.worksite.sessions))
    view.matter.results.push(...session.results.filter(result => result.matterId === matterId).map(copy));
  return view;
}

function comparisonMatter(current, focus, basis) {
  return { id: current.id, title: titleOf(current), understanding: current.understanding,
    version: current.understandingVersion, focus: copy(focus), ...(basis ? { basis: copy(basis) } : {}), unresolved: current.stop,
    links: copy(current.links || []), revisions: copy(current.revisions.filter(r => r.kind === 'comparison')),
    comparisonRequests: copy(current.comparisonRequests || []) };
}

function basisContent(host, matterId, anchor) {
  const current = matter(host, matterId);
  if (!current) return null;
  const session = host.chain.sessions[matterId];
  if (anchor.field === 'understanding' || anchor.field === 'originalText') {
    const objectId = anchor.field === 'understanding' ? `${matterId}:understanding` : current.originalExpressionId || `${matterId}:original`;
    if ((anchor.objectId || anchor.expressionId) && (anchor.objectId || anchor.expressionId) !== objectId) return null;
    return { field: anchor.field, objectId, text: anchor.field === 'understanding' ? current.understanding : current.originalText,
      contentVersion: anchor.field === 'understanding' ? current.understandingVersion : current.originalTextVersion || 1 };
  }
  if (anchor.field === 'discussion') {
    const view = selectChainView({ ...host.chain, selectedId: matterId });
    const objectId = anchor.objectId || anchor.expressionId;
    const message = objectId && view.discussion.messages.find(message => message.id === objectId);
    if (message) return { field: anchor.field, objectId: message.id, text: message.text, contentVersion: message.contentVersion || 1 };
    const aggregateId = `${matterId}:discussion:${session.contextMode}:${session.contextEpoch}`;
    if (objectId && objectId !== aggregateId) return null;
    return { field: anchor.field, objectId: aggregateId, text: view.discussion.text, contentVersion: session.discussionVersion || 0 };
  }
  if (anchor.field === 'source') {
    const source = host.chain.sources.find(source => source.id === (anchor.sourceId || anchor.objectId));
    if (!source || source.ownerMatterId !== matterId && !current.sourceIds.includes(source.id)) return null;
    return { field: anchor.field, objectId: source.id, text: source.excerpt, contentVersion: source.contentVersion || 1 };
  }
  return null;
}

/** Derive real content versions and UTF-16 offsets for UI entry points. Null means no valid selection. */
export function selectComparisonAnchor(host, matterId, options = {}) {
  const current = matter(host, matterId);
  if (!current) return null;
  const basis = basisContent(host, matterId, { ...options, field: options.field || (nonempty(current.understanding) ? 'understanding' : 'originalText') });
  if (!basis || !nonempty(basis.text)) return null;
  const start = options.start ?? 0, end = options.end ?? basis.text.length;
  const text = basis.text.slice(start, end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > basis.text.length ||
    options.text !== undefined && options.text !== text) return null;
  return { field: basis.field, objectId: basis.objectId, expressionId: basis.objectId,
    ...(basis.field === 'source' ? { sourceId: basis.objectId } : {}), start, end, text, baseVersion: basis.contentVersion };
}

/** Comparison basis is separate from saved understanding; original input can be compared immediately. */
export function openComparison(host, { sessionId, matterId, anchor, returnTarget } = {}) {
  const current = matter(host, matterId);
  if (!current) return failure(host, 'unknown_matter', '没有找到原事项。');
  if (!keyOK(sessionId) || own(host.comparisons, sessionId)) return failure(host, 'invalid_session', '对照会话 ID 必须唯一。');
  anchor ||= selectComparisonAnchor(host, matterId);
  const basis = anchor && basisContent(host, matterId, anchor);
  if (!basis) return failure(host, 'unsupported_basis', '没有找到可比较的原表达、讨论或来源。');
  if (anchor.baseVersion !== basis.contentVersion) return failure(host, 'version_conflict', '原选区内容版本已变化。');
  if (anchor.field === 'understanding' && current.understandingDraft !== current.understanding) return failure(host, 'draft_conflict', '原处仍有未保存草稿，未覆盖或冒充已保存理解。');
  if (returnTarget && returnTarget.matterId !== matterId) return failure(host, 'return_mismatch', '返回位置必须属于同一件事。');
  const focus = { start: anchor.start, end: anchor.end, text: anchor.text };
  let model;
  try { model = createComparisonState({ matter: comparisonMatter(current, focus, { ...basis, focus }), candidates: [], sessionId }); }
  catch { return failure(host, 'invalid_anchor', '选区原文或边界不再匹配。'); }
  const next = copy(host);
  next.comparisons[sessionId] = { model, matterId, anchor: copy(anchor),
    draftVersion: current.understandingDraftVersion,
    returnTarget: copy(returnTarget || { view: 'chain', matterId, screen: anchor.field === 'understanding' ? 'understanding' : 'discussion', anchor, contextMode: host.chain.sessions[matterId].contextMode }) };
  next.route = { view: 'compare', matterId, sessionId, anchor: copy(anchor), returnTarget: copy(next.comparisons[sessionId].returnTarget) };
  next.error = null;
  return next;
}

export function dispatchComparison(host, { sessionId, action } = {}) {
  const session = host.comparisons[sessionId];
  if (!session) return failure(host, 'unknown_session', '没有找到本次对照。');
  if (action?.type === 'COMMIT_RESULT') return failure(host, 'host_receipt_only', '页面动作不能伪造宿主成功回执。');
  if (action?.type === 'SEARCH') return failure(host, 'capability_missing', '尚未连接搜索；可以粘贴已有材料，不返回演示候选。');
  const next = copy(host);
  const local = next.comparisons[sessionId];
  local.model = reduceComparison(local.model, action);
  if (action?.type === 'IMPORT_MATERIAL') {
    const candidate = selectComparisonView(local.model).selectedCandidate;
    if (candidate && !next.chain.sources.some(source => source.id === candidate.id))
      next.chain.sources.push({ id: candidate.id, title: candidate.title, kind: candidate.kind, excerpt: candidate.excerpt,
        context: candidate.context, sourceType: candidate.sourceType, url: null, ownerMatterId: local.matterId, origin: 'user-pasted' });
  }
  next.error = null;
  return next;
}

export function selectComparison(host, sessionId) {
  const local = host.comparisons[sessionId];
  if (!local) return null;
  const view = selectComparisonView(local.model);
  // The imported module hardcodes isDemo:true even for user-only input.
  // This facade has no demo provider/catalog and never mutates the raw reducer's labels.
  return { ...view, notice: host.error?.message || view.notice, isDemo: false, search: { ...view.search, isDemo: false, provider: 'unconnected',
    capabilityAvailable: false }, currentUnderstandingVersion: matter(host, local.matterId)?.understandingVersion,
    returnTarget: copy(local.returnTarget), hostError: copy(host.error) };
}

/** In-memory transaction boundary; a real persistence owner must persist BEFORE delivering the outcome. */
export function applyPendingComparison(host, { sessionId, requestId } = {}) {
  const local = host.comparisons[sessionId];
  const request = local?.model.request;
  const reject = (code, message) => ({ host: failure(host, code, message), outcome: { ok: false, receipt: null, error: { code, message } } });
  if (!request || request.id !== requestId) return reject('unknown_request', '本次请求已取消或不属于当前对照。');
  const current = matter(host, local.matterId);
  if (!current || request.matterId !== local.matterId) return reject('matter_mismatch', '请求不属于原事项。');
  if (request.kind !== 'undo') {
    const source = host.chain.sources.find(s => s.id === request.source?.id);
    if (!source || source.ownerMatterId !== current.id || source.excerpt !== request.source.excerpt || source.kind !== request.source.kind)
      return reject('source_conflict', '原材料缺失或来处不一致；未关联也未修订。');
  }
  const known = (current.comparisonRequests || []).find(receipt => receipt.requestId === request.id);
  const mutatesUnderstanding = request.kind !== 'link';
  if (!known && (mutatesUnderstanding || local.anchor.field === 'understanding') && current.understandingVersion !== request.baseVersion)
    return reject('version_conflict', '理解已有后来修改，保留本次对照草稿。');
  if (!known && mutatesUnderstanding && (current.understandingDraftVersion !== local.draftVersion || current.understandingDraft !== current.understanding))
    return reject('draft_conflict', '原处草稿后来编辑过，未覆盖它。');
  let focus = local.model.matter.basis?.focus || local.model.matter.focus;
  if (known) {
    focus = local.anchor.field === 'understanding' ? { start: known.target.start, end: known.target.start + known.after.length, text: known.after } : focus;
    // Replay is read-only. A later version may no longer contain the old anchor;
    // provide a valid current read shape only to the helper's idempotency branch.
    if (local.anchor.field === 'understanding' && current.understanding.slice(focus.start, focus.end) !== focus.text)
      focus = { start: 0, end: current.understanding.length, text: current.understanding };
  }
  const basis = basisContent(host, current.id, local.anchor);
  if (!basis) return reject('basis_conflict', '原表达或来源已不可用，未按旧选区提交。');
  const projection = comparisonMatter(current, focus, { ...basis, focus });
  const outcome = applyComparisonRequest(projection, request);
  if (!outcome.ok) return { host: failure(host, outcome.error.code, outcome.error.message), outcome };
  const next = copy(host);
  if (!known) {
    const target = matter(next, current.id);
    target.links = copy(outcome.matter.links);
    target.comparisonRequests = copy(outcome.matter.comparisonRequests);
    target.sourceIds = [...new Set([...target.sourceIds, ...outcome.matter.links.map(link => link.sourceId)])];
    target.revisions = [...target.revisions.filter(r => r.kind !== 'comparison'), ...copy(outcome.matter.revisions)];
    if (target.understandingVersion !== outcome.matter.version) {
      target.understanding = outcome.matter.understanding;
      target.understandingVersion = outcome.matter.version;
      target.understandingDraft = target.understanding;
      target.understandingDraftVersion++;
    }
  }
  next.error = null;
  return { host: next, outcome: copy(outcome) };
}

/** ACK affects only the comparison view. It can never replace authoritative matter content. */
export function deliverComparisonResult(host, { sessionId, requestId, outcome } = {}) {
  const local = host.comparisons[sessionId];
  if (!local || local.model.request?.id !== requestId) return host;
  const next = copy(host);
  const current = matter(next, local.matterId);
  const committed = current?.comparisonRequests?.find(r => r.requestId === requestId);
  const proven = outcome?.ok && committed && committed.requestFingerprint === outcome.receipt?.requestFingerprint &&
    current.understandingVersion === outcome.matter?.version && current.understanding === outcome.matter?.understanding;
  const result = outcome?.ok && !proven
    ? { ok: false, error: { code: 'late_or_unproven_receipt', message: '回执已过期或不在宿主提交记录中；当前理解未被旧结果覆盖。' } }
    : outcome;
  next.comparisons[sessionId].model = reduceComparison(local.model, { type: 'COMMIT_RESULT', requestId, ...result });
  if (proven) next.comparisons[sessionId].draftVersion = current.understandingDraftVersion;
  next.error = result?.ok ? null : (result?.error || { code: 'invalid_receipt', message: '回执无效。' });
  return next;
}

export function commitComparison(host, ids) {
  const applied = applyPendingComparison(host, ids);
  return deliverComparisonResult(applied.host, { ...ids, outcome: applied.outcome });
}

/** Recover an interrupted UI ACK from the authoritative command ledger, never replay a mutation on load. */
export function recoverPendingComparisons(host) {
  let next = host;
  for (const sessionId of Object.keys(host.comparisons)) {
    const local = next.comparisons[sessionId];
    const request = local.model.request;
    if (!request) continue;
    const current = matter(next, local.matterId);
    const committed = current?.comparisonRequests?.find(receipt => receipt.requestId === request.id);
    let outcome;
    if (!committed) {
      outcome = { ok: false, error: { code: 'interrupted_uncommitted_request', message: '上次提交没有已保存的成功回执；已解除等待，编辑草稿保留，请重新确认。' } };
    } else if (request.kind !== 'link' && current.understandingVersion !== committed.afterVersion) {
      outcome = { ok: false, error: { code: 'superseded_committed_request', message: '上次提交已留有回执，但理解后来又有变化；已解除等待，未用旧回执覆盖当前版本。' } };
    } else {
      // The known-receipt branch validates the full request fingerprint and source.
      // Ignore its returned host entirely: load recovery only changes session UI state.
      outcome = applyPendingComparison(next, { sessionId, requestId: request.id }).outcome;
    }
    next = deliverComparisonResult(next, { sessionId, requestId: request.id, outcome });
  }
  return next;
}

export function returnFromComparison(host, sessionId) {
  const local = host.comparisons[sessionId];
  if (!local) return failure(host, 'unknown_session', '没有找到原返回位置。');
  if (local.model.request) return failure(host, 'pending_request', '仍在等待宿主确认，尚未显示为完成。');
  const current = matter(host, local.matterId);
  if (!current) return failure(host, 'unknown_matter', '原事项已不可用，保留对照与返回位置。');
  const next = copy(host);
  const receipt = local.model.receipt;
  const candidate = local.anchor.field === 'understanding' && receipt && current.understandingVersion === receipt.afterVersion
    ? { ...local.anchor, start: receipt.target.start, end: receipt.target.start + receipt.after.length,
      text: receipt.after, baseVersion: receipt.afterVersion }
    : local.anchor;
  const basis = basisContent(host, current.id, candidate);
  const exact = basis && candidate.baseVersion === basis.contentVersion &&
    basis.text.slice(candidate.start, candidate.end) === candidate.text && (candidate.field !== 'understanding' || current.understandingDraft === current.understanding);
  next.route = { ...copy(local.returnTarget), matterId: current.id, anchor: exact ? copy(candidate) : null,
    anchorStatus: exact ? 'restored' : 'stale', currentUnderstandingVersion: current.understandingVersion };
  next.chain = reduceChain(next.chain, { type: 'OPEN', id: current.id, screen: local.returnTarget.screen || (candidate.field === 'understanding' ? 'understanding' : 'discussion') });
  if (exact && ['originalText', 'understanding', 'discussion'].includes(candidate.field)) next.chain = reduceChain(next.chain,
    { type: 'FOCUS', field: candidate.field, objectId: candidate.objectId, start: candidate.start, end: candidate.end, text: candidate.text });
  else next.chain = reduceChain(next.chain, { type: 'CLEAR_FOCUS' });
  next.error = exact ? null : { code: 'stale_anchor', message: '已回到同一件事的当前版本；原选区失效，未跳到另一段。' };
  return next;
}

function workProjection(host) {
  const current = Object.fromEntries(host.chain.matters.map(m => [m.id, { id: m.id, title: titleOf(m), stop: m.stop,
    understanding: m.understanding, version: m.understandingVersion, revisions: [] }]));
  return { ...copy(host.worksite), matters: current };
}

/** Confirmed snapshot is historical, not another current understanding object. */
export function createWorkFromHandoff(host, { matterId, workId, destination, role = 'reference', note = '', selectedText } = {}) {
  if (!matter(host, matterId)) return failure(host, 'unknown_matter', '没有找到带入事项。');
  if (!keyOK(workId) || own(host.worksite.works, workId)) return failure(host, 'invalid_work', '工作 ID 必须唯一。');
  if (!destination || !['agent', 'project', 'task'].every(key => nonempty(destination[key])) || !['reference', 'trial'].includes(role))
    return failure(host, 'invalid_destination', '请明确本次 Agent、项目、任务与参与方式。');
  let next = dispatchChain(host, { matterId, action: { type: 'HANDOFF_DRAFT', patch: { destination, role, note, scope: 'current-task', ...(selectedText === undefined ? {} : { selectedText }) } } });
  next = dispatchChain(next, { matterId, action: { type: 'CONFIRM_HANDOFF' } });
  const view = selectChain(next, matterId);
  const snapshot = view.handoffSnapshot;
  if (!snapshot) return failure(host, 'empty_handoff', '没有可确认的带入内容；未建立工作。');
  const seeded = createWorksiteState({ matters: [{ id: matterId, title: view.matter.title, stop: view.matter.stop,
    understanding: view.matter.understanding, version: view.matter.understandingVersion }], works: [{ id: workId,
    title: destination.task, agent: destination.agent, project: destination.project, connected: false,
    intake: [{ id: snapshot.id, matterId, title: view.matter.title, sourceText: snapshot.selectedText,
      sourceVersion: snapshot.understandingVersion, role, note,
      source: { title: '用户明确确认的本次带入', excerpt: snapshot.selectedText, url: null } }] }] });
  next.worksite.works[workId] = seeded.works[workId];
  next.worksite.sessions[workId] = seeded.sessions[workId];
  next.worksite.selectedWorkId = workId;
  next.route = { view: 'worksite', matterId, workId, screen: 'overview' };
  next.error = null;
  return next;
}

/** Project current matters for one reducer call, commit permitted differences, then discard projection. */
export function dispatchWorksite(host, { workId, action } = {}) {
  if (!own(host.worksite.works, workId)) return failure(host, 'unknown_work', '没有找到本次工作。');
  const local = host.worksite.sessions[workId];
  const bound = new Set(local.intake.map(item => item.matterId));
  if (action?.type === 'SELECT_WORK' && action.id !== workId) return failure(host, 'work_mismatch', '工作动作归属不一致。');
  if (action?.type === 'RESULT_DRAFT' && action.patch?.matterId !== undefined && !bound.has(action.patch.matterId))
    return failure(host, 'matter_mismatch', '结果不能静默接到未带入的另一件事。');
  if (['OPEN_REVISION_REVIEW', 'KEEP_RESULT_ONLY', 'CONFIRM_REVISION', 'TRY_AGAIN'].includes(action?.type) && !bound.has(local.result.matterId))
    return failure(host, 'matter_mismatch', '结果归属与本次带入不一致。');
  if (['CONFIRM_REVISION', 'UNDO_REVISION'].includes(action?.type)) {
    const targetId = action.type === 'CONFIRM_REVISION' ? local.review.matterId : local.receipt?.matterId;
    const current = matter(host, targetId);
    const guard = host.workGuards[workId];
    if (current && guard && (current.understandingDraftVersion !== guard.draftVersion || current.understandingDraft !== current.understanding))
      return failure(host, 'draft_conflict', '原事项已有草稿编辑，未用工作结果覆盖。');
  }
  const projection = workProjection(host);
  projection.selectedWorkId = workId;
  const reduced = reduceWorksite(projection, action);
  const next = copy(host);
  next.worksite = withoutMatters(reduced);
  for (const current of next.chain.matters) {
    const changed = reduced.matters[current.id];
    if (!changed || changed.version === current.understandingVersion) continue;
    if (!['CONFIRM_REVISION', 'UNDO_REVISION'].includes(action?.type) || !bound.has(current.id))
      return failure(host, 'unexpected_mutation', '模块产生了未授权的事项变化，已拒绝整笔提交。');
    current.understanding = changed.understanding;
    current.understandingVersion = changed.version;
    current.understandingDraft = changed.understanding;
    current.understandingDraftVersion++;
    current.revisions.push(...changed.revisions.map(revision => ({ ...copy(revision), origin: 'worksite', workId })));
  }
  if (action?.type === 'OPEN_REVISION_REVIEW' && next.worksite.sessions[workId].review.open) {
    const current = matter(next, next.worksite.sessions[workId].review.matterId);
    next.workGuards[workId] = { matterId: current.id, draftVersion: current.understandingDraftVersion };
  }
  if (['CONFIRM_REVISION', 'UNDO_REVISION'].includes(action?.type) && next.worksite.sessions[workId].receipt) {
    const current = matter(next, next.worksite.sessions[workId].receipt.matterId);
    next.workGuards[workId] = { matterId: current.id, draftVersion: current.understandingDraftVersion };
  }
  if (action?.type === 'TRY_AGAIN' && next.worksite.sessions[workId].retry?.id !== local.retry?.id) {
    const retry = next.worksite.sessions[workId].retry;
    if (retry) {
      // A retry is a new confirmation against the latest understanding, not reuse
      // of the old confirmed/selectionEdited handoff. Historical snapshots remain.
      next.chain = reduceChain(next.chain, { type: 'OPEN', id: retry.matterId, screen: 'handoff' });
      next.chain = reduceChain(next.chain, { type: 'TRY_AGAIN' });
      const work = next.worksite.works[workId];
      next.chain = reduceChain(next.chain, { type: 'HANDOFF_DRAFT', patch: { destination: { agent: work.agent, project: work.project, task: work.title } } });
      next.route = { view: 'chain', matterId: retry.matterId, screen: 'handoff', returnTarget: { view: 'worksite', workId, matterId: retry.matterId, screen: 'results' } };
    }
  }
  next.error = null;
  return next;
}

export function selectWorksite(host, workId) {
  if (!own(host.worksite.works, workId)) return null;
  const view = selectWorksiteView({ ...workProjection(host), selectedWorkId: workId });
  return { ...view, notice: host.error?.message || view.notice, hostError: copy(host.error) };
}
