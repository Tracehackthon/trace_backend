/** Pure, session-only prototype state. No storage, network, or model calls. */
export const SCREENS = Object.freeze(['reading', 'resume', 'discussion', 'comparison', 'understanding', 'paused', 'reentry', 'handoff', 'work', 'results', 'revised']);
const RELATIONS = ['challenge', 'supplement', 'limitation', 'branch'];
const ROLES = ['trial', 'reference', 'exclude'];
const EXAMPLE_SOURCES = [
  { id: 'source-article', title: '为什么收藏之后，很少再回来？', kind: 'example-article', excerpt: '重新读到时，我们可能认得这些文字，却想不起自己的问题。', url: null },
  { id: 'source-comparison', title: '示例材料 · 原文片段', kind: 'example-comparison', excerpt: '我没有给每次收藏写备注。后来做同类问题时，沿原文和之前的问题，也能想起为什么存它。', url: null },
];
const DEMO_UNDERSTANDING = '我现在觉得，要区分恢复材料内容和恢复个人触动。\n\n原文可能帮助前者，我自己的表达可能帮助后者。\n\n还没分清：哪些个人触动无法只靠原文恢复？';
const DEMO_REVISION = '原文与当时的问题一起保留时，可能不写附言也能接回；\n哪些个人触动需要额外表达，仍要分情形看。';
const copy = (value) => structuredClone(value);
const string = (value) => typeof value === 'string' ? value : '';
const nonempty = (value) => string(value).trim().length > 0;
const unique = (values) => [...new Set(values)];

function blankMatter(id = null) {
  return { id, title: '', whyCare: '', stop: '', stopDraft: '', stopVersion: 0, originalText: '', understanding: '', understandingDraft: '', understandingVersion: 0, understandingDraftVersion: 0, sourceIds: [], captureSourceIds: [], branches: [], observations: [], revisions: [], results: [] };
}
function blankHandoff() {
  return { destination: { agent: '', project: '', task: '' }, selectedText: '', selectionEdited: false, role: 'trial', note: '', scope: 'current-task', confirmed: false, understandingVersion: 0, evidenceLevel: 'none' };
}
function blankResult() {
  return { fact: '', interpretation: '', unconfirmed: '', proposedUnderstanding: '', decision: 'pending', savedId: null, baseVersion: null, baseDraftVersion: null, baseStopVersion: null };
}
function blankSession() {
  return { contextMode: 'resume', contextEpoch: 0, composer: { text: '' }, focus: null, discussion: { messages: [], cases: [], possibility: '' }, comparison: null, suggestion: null, incoming: { text: '', sourceId: null, decision: 'pending' }, handoff: blankHandoff(), handoffSnapshot: null, handoffHistory: [], result: blankResult(), workFindings: [], suggestionUndo: null, revisionUndo: null, backStack: [] };
}
function current(state) { return state.matters.find((matter) => matter.id === state.selectedId); }
function session(state) { return state.sessions[state.selectedId]; }
function nextId(state, prefix) { return `${prefix}-${state.nextId++}`; }
function inform(state, notice) { state.notice = notice; return state; }
function sourceById(state, id) { return state.sources.find((source) => source.id === id); }
function availableSource(state, id) {
  const source = sourceById(state, id);
  return source && (!source.ownerMatterId || source.ownerMatterId === state.selectedId || current(state)?.sourceIds.includes(id)) ? source : null;
}
function discussionText(s) {
  if (s.contextMode === 'fresh') return s.discussion.messages.filter((entry) => entry.contextMode === 'fresh' && entry.contextEpoch === s.contextEpoch).map((entry) => entry.text).join('\n\n');
  return [...s.discussion.cases.map((entry) => entry.text), ...s.discussion.messages.map((entry) => entry.text), s.discussion.possibility].filter(Boolean).join('\n\n');
}
function selectHandoff(m, s) {
  const h = copy(s.handoff);
  if (!h.confirmed && !h.selectionEdited) {
    h.selectedText = m.understanding;
    h.understandingVersion = m.understandingVersion;
    h.selectionBasisUnderstanding = m.understanding;
  }
  return h;
}
function codepointBoundary(text, offset) {
  if (offset <= 0 || offset >= text.length) return true;
  const left = text.charCodeAt(offset - 1), right = text.charCodeAt(offset);
  return !(left >= 0xD800 && left <= 0xDBFF && right >= 0xDC00 && right <= 0xDFFF);
}
function addSource(state, m, source) {
  source.ownerMatterId = m?.id || state.selectedId;
  state.sources.push(source);
  if (m) m.sourceIds = unique([...m.sourceIds, source.id]);
  return source.id;
}
function editDraft(m, s, text) {
  if (m.understandingDraft === text) return;
  m.understandingDraft = text;
  m.understandingDraftVersion++;
  if (s.suggestion?.status === 'pending') s.suggestion.status = 'stale';
}
function validFocus(m, s, focus) {
  if (!focus || !['discussion', 'understanding', 'originalText'].includes(focus.field)) return false;
  const message = focus.objectId && s.discussion.messages.find(message => message.id === focus.objectId);
  const text = focus.field === 'understanding' ? m.understandingDraft : focus.field === 'originalText' ? m.originalText : message?.text ?? discussionText(s);
  return Number.isInteger(focus.start) && Number.isInteger(focus.end) && focus.start >= 0 && focus.end > focus.start && focus.end <= text.length && codepointBoundary(text, focus.start) && codepointBoundary(text, focus.end) && text.slice(focus.start, focus.end) === focus.text;
}
function saveResult(state, m, s) {
  if (s.result.savedId) return s.result.savedId;
  const id = nextId(state, 'result');
  m.results.push({ id, fact: s.result.fact, interpretation: s.result.interpretation, unconfirmed: s.result.unconfirmed, handoffId: s.handoffSnapshot?.id ?? null, understandingVersion: m.understandingVersion, origin: state.isDemo ? 'example' : 'user-provided', decision: 'result-only' });
  s.result.savedId = id;
  return id;
}
function canUndoRevision(m, s) {
  const u = s.revisionUndo;
  return !!u && m.understandingVersion === u.afterVersion && m.understandingDraftVersion === u.afterDraftVersion && m.stopVersion === u.afterStopVersion;
}
function canUndoSuggestion(m, s) {
  const u = s.suggestionUndo;
  return !!u && m.understandingDraftVersion === u.afterDraftVersion && m.understandingVersion === u.savedVersion && m.understandingDraft.slice(u.start, u.start + u.replacement.length) === u.replacement;
}
function navigate(state, target) {
  if (!SCREENS.includes(target)) return inform(state, '未识别的页面，当前内容没有改变。');
  const m = current(state);
  if (target !== 'reading' && !m) return inform(state, '先留下一点，或明确打开一件已有的事。');
  if (target === 'revised' && !m.revisions.some((entry) => !entry.undone)) return inform(state, '还没有保留理解修订；查看页面不会自动产生变化。');
  if (target === 'work' && !session(state).handoffSnapshot) return inform(state, '先确认本次带入；打开工作页不代表已经送达。');
  if (['comparison', 'handoff'].includes(target) && state.screen !== target) session(state).backStack.push(state.screen);
  state.screen = target;
  state.notice = '';
  return state;
}

export function createChainState(options = {}) {
  const state = { schemaVersion: 1, nextId: 1, screen: 'reading', selectedId: null, isDemo: false, notice: '', matters: [], sessions: {}, sources: copy(EXAMPLE_SOURCES), unassignedMaterials: [], capture: { text: '', sourceIds: [], excerpt: '', excerptSourceId: null }, collapseUndo: null };
  if (options.fixture === 'saved') {
    const m = blankMatter('matter-saved');
    Object.assign(m, { title: '收藏后为什么接不回来', whyCare: '保存了内容，却恢复不了当时的想法。', stop: '还没分清：是缺少自己的表达，还是原文现场不够？', stopDraft: '还没分清：是缺少自己的表达，还是原文现场不够？', originalText: EXAMPLE_SOURCES[0].excerpt, understanding: DEMO_UNDERSTANDING, understandingDraft: DEMO_UNDERSTANDING, understandingVersion: 1, understandingDraftVersion: 1, sourceIds: ['source-article'], captureSourceIds: ['source-article'] });
    state.matters.push(m);
    state.sessions[m.id] = blankSession();
    state.sessions[m.id].handoff.destination = { agent: 'Codex', project: 'harness', task: '收藏入口原型' }; // Explicit demo fixture only.
    state.selectedId = m.id;
    state.screen = 'resume';
    state.isDemo = true;
  }
  if (options.selectedId && state.matters.some((m) => m.id === options.selectedId)) state.selectedId = options.selectedId;
  return state;
}

export function reduceChain(previous, action = {}) {
  if (!previous || typeof action.type !== 'string') return previous;
  const known = ['OPEN', 'NAVIGATE', 'BACK', 'CAPTURE_DRAFT', 'CAPTURE_EXCERPT', 'TOGGLE_SOURCE', 'CAPTURE', 'COMPOSER_DRAFT', 'SEND', 'FOCUS', 'CLEAR_FOCUS', 'BRANCH', 'FOCUS_TO_UNDERSTANDING', 'FRESH_CONTEXT', 'RESUME_CONTEXT', 'OPEN_COMPARISON', 'RELATION_DRAFT', 'LINK_COMPARISON', 'REJECT_COMPARISON', 'UNDERSTANDING_DRAFT', 'SAVE_UNDERSTANDING', 'SUGGEST', 'ACCEPT_SUGGESTION', 'DISMISS_SUGGESTION', 'UNDO_SUGGESTION', 'STOP_DRAFT', 'COLLAPSE', 'UNDO_COLLAPSE', 'REOPEN', 'INCOMING_DRAFT', 'INCOMING_DECISION', 'HANDOFF_DRAFT', 'CONFIRM_HANDOFF', 'EXCLUDE_HANDOFF', 'WORK_FINDING', 'RESULT_DRAFT', 'KEEP_RESULT_ONLY', 'COMMIT_REVISION', 'UNDO_REVISION', 'TRY_AGAIN', 'CLEAR_NOTICE'];
  if (!known.includes(action.type)) return previous;
  const state = copy(previous);
  let m = current(state);
  let s = session(state);
  if (action.type === 'CLEAR_NOTICE') return inform(state, '');
  if (action.type === 'NAVIGATE') return navigate(state, action.screen);
  if (action.type === 'OPEN') {
    if (!state.matters.some((entry) => entry.id === action.id)) return inform(state, '没有找到这件事，当前草稿仍保留。');
    state.selectedId = action.id;
    state.collapseUndo = null;
    return navigate(state, action.screen || 'resume');
  }
  if (action.type === 'CAPTURE_DRAFT') { state.capture.text = string(action.text); return state; }
  if (action.type === 'CAPTURE_EXCERPT') {
    if (!availableSource(state, action.sourceId)) return inform(state, '未找到选段来源。');
    state.capture.excerpt = string(action.text);
    state.capture.excerptSourceId = nonempty(action.text) ? action.sourceId : null;
    if (nonempty(action.text)) state.capture.sourceIds = unique([...state.capture.sourceIds, action.sourceId]);
    return state;
  }
  if (action.type === 'TOGGLE_SOURCE') {
    if (!availableSource(state, action.id)) return inform(state, '未找到这份来源。');
    const has = state.capture.sourceIds.includes(action.id);
    state.capture.sourceIds = has ? state.capture.sourceIds.filter((id) => id !== action.id) : [...state.capture.sourceIds, action.id];
    if (has && state.capture.excerptSourceId === action.id) { state.capture.excerpt = ''; state.capture.excerptSourceId = null; }
    return state;
  }
  if (action.type === 'CAPTURE') {
    if (!nonempty(state.capture.text) && !state.capture.sourceIds.length && !nonempty(state.capture.excerpt)) return inform(state, '留一段文字或一份来源即可，不必起标题。');
    const id = nextId(state, 'matter');
    m = blankMatter(id);
    m.whyCare = state.capture.text;
    m.originalText = state.capture.excerpt || state.capture.text || '';
    m.sourceIds = [...state.capture.sourceIds];
    m.captureSourceIds = [...state.capture.sourceIds];
    state.matters.push(m);
    state.sessions[id] = blankSession();
    state.selectedId = id;
    state.capture = { text: '', sourceIds: [], excerpt: '', excerptSourceId: null };
    state.collapseUndo = null;
    state.screen = action.intent === 'discuss' ? 'resume' : 'paused';
    return inform(state, '已留在本次会话；还没有替你形成理解或历史停点。');
  }
  if (!m || !s) return inform(state, '先留下一点，当前没有可修改的事。');

  switch (action.type) {
    case 'BACK': {
      const target = s.backStack.pop() || 'resume';
      state.screen = SCREENS.includes(target) ? target : 'resume';
      return inform(state, '');
    }
    case 'COMPOSER_DRAFT': s.composer.text = string(action.text); return state;
    case 'SEND': {
      if (!nonempty(s.composer.text)) return inform(state, '先写一点再继续。');
      const focus = validFocus(m, s, s.focus) ? copy(s.focus) : null;
      s.discussion.messages.push({ id: nextId(state, 'message'), role: 'user', text: s.composer.text, focus, contextMode: s.contextMode, contextEpoch: s.contextEpoch });
      s.composer.text = '';
      state.screen = 'discussion';
      return inform(state, '你的表达已留在本次会话；原型不会伪造模型回复。');
    }
    case 'FOCUS': {
      const focus = { field: action.field, start: action.start, end: action.end, text: string(action.text), ...(action.objectId ? { objectId: action.objectId } : {}) };
      if (!validFocus(m, s, focus)) return inform(state, '选区已变化，请重新选择原文。');
      s.focus = focus; return inform(state, '');
    }
    case 'CLEAR_FOCUS': s.focus = null; return state;
    case 'BRANCH': {
      if (!validFocus(m, s, s.focus)) return inform(state, '先选择仍有效的一处内容。');
      m.branches.push({ id: nextId(state, 'branch'), text: s.focus.text, origin: { matterId: m.id, ...copy(s.focus), understandingVersion: m.understandingVersion } });
      return inform(state, '旁支已保留来处，主线没有被替换。');
    }
    case 'FOCUS_TO_UNDERSTANDING': {
      if (!validFocus(m, s, s.focus)) return inform(state, '先选择仍有效的一处内容。');
      const text = s.focus.text;
      editDraft(m, s, `${m.understandingDraft}${m.understandingDraft ? '\n\n' : ''}${text}`);
      s.focus = null;
      state.screen = 'understanding';
      return inform(state, '已接到个人草稿，尚未保存为当前理解。');
    }
    case 'FRESH_CONTEXT': s.contextMode = 'fresh'; s.contextEpoch++; s.focus = null; return inform(state, '本次上下文不带入旧理解、停点、来源或旧讨论；原记录保留。');
    case 'RESUME_CONTEXT': s.contextMode = 'resume'; return inform(state, '已恢复当前这件事的上下文。');
    case 'OPEN_COMPARISON': {
      if (!availableSource(state, action.sourceId)) return inform(state, '找不到这份对照材料。');
      const target = validFocus(m, s, s.focus) ? s.focus.text : m.stop || m.understanding || m.whyCare;
      s.comparison = { sourceId: action.sourceId, target, relation: 'challenge', reason: state.isDemo ? '它让“每次都要写附言”变得不那么确定。' : '请核对材料与当前具体位置的关系；这里尚未采用材料结论。', uncertain: state.isDemo ? '还不能说明：个人表达没有价值。' : '材料结论是否适用于这里，仍待判断。', decision: 'pending' };
      return navigate(state, 'comparison');
    }
    case 'RELATION_DRAFT': {
      if (!s.comparison) return state;
      if (action.relation !== undefined && !RELATIONS.includes(action.relation)) return inform(state, '请选择挑战、补充、限制或旁支。');
      if (action.relation !== undefined) s.comparison.relation = action.relation;
      if (action.target !== undefined) s.comparison.target = string(action.target);
      s.comparison.decision = 'pending'; return state;
    }
    case 'LINK_COMPARISON': {
      const c = s.comparison;
      if (!c || !sourceById(state, c.sourceId) || !nonempty(c.target)) return inform(state, '先核对具体接到哪一处。');
      m.sourceIds = unique([...m.sourceIds, c.sourceId]);
      const observation = { id: c.observationId || nextId(state, 'observation'), text: sourceById(state, c.sourceId).excerpt, sourceId: c.sourceId, relation: c.relation, target: c.target };
      m.observations = m.observations.filter((entry) => entry.id !== observation.id);
      m.observations.push(observation);
      c.observationId = observation.id;
      c.decision = 'linked';
      state.screen = s.backStack.pop() || 'discussion';
      return inform(state, '关系已接回具体位置；没有自动采用材料结论。');
    }
    case 'REJECT_COMPARISON': {
      if (!s.comparison) return state;
      const c = s.comparison;
      if (c.observationId) m.observations = m.observations.filter((entry) => entry.id !== c.observationId);
      if (!m.captureSourceIds.includes(c.sourceId) && !m.observations.some((entry) => entry.sourceId === c.sourceId)) m.sourceIds = m.sourceIds.filter((id) => id !== c.sourceId);
      c.decision = 'rejected';
      state.screen = s.backStack.pop() || 'discussion';
      return inform(state, '这次不关联，原始材料仍保留。');
    }
    case 'UNDERSTANDING_DRAFT': editDraft(m, s, string(action.text)); return state;
    case 'SAVE_UNDERSTANDING': {
      if (m.understanding !== m.understandingDraft) { m.understanding = m.understandingDraft; m.understandingVersion++; }
      return inform(state, '个人草稿已保存在本次会话；不自动成为工作要求。');
    }
    case 'SUGGEST': {
      const start = action.start, end = action.end;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > m.understandingDraft.length || !codepointBoundary(m.understandingDraft, start) || !codepointBoundary(m.understandingDraft, end) || typeof action.replacement !== 'string') return inform(state, '请选择草稿中的准确范围，再请求这一处的示例建议。');
      s.suggestion = { start, end, original: m.understandingDraft.slice(start, end), replacement: action.replacement, baseVersion: m.understandingVersion, baseDraftVersion: m.understandingDraftVersion, status: 'pending', origin: 'example-suggestion' };
      s.suggestionUndo = null;
      return inform(state, '这是原型的示例建议，只处理选中的一处。');
    }
    case 'ACCEPT_SUGGESTION': {
      const p = s.suggestion;
      if (!p || !['pending', 'stale'].includes(p.status)) return state;
      if (p.status === 'stale' || p.baseVersion !== m.understandingVersion || p.baseDraftVersion !== m.understandingDraftVersion || m.understandingDraft.slice(p.start, p.end) !== p.original) {
        p.status = 'stale'; return inform(state, '原文或版本已变化，建议没有覆盖你的新编辑。请重新选择。');
      }
      editDraft(m, s, m.understandingDraft.slice(0, p.start) + p.replacement + m.understandingDraft.slice(p.end));
      p.status = 'accepted';
      s.suggestionUndo = { start: p.start, original: p.original, replacement: p.replacement, afterDraftVersion: m.understandingDraftVersion, savedVersion: m.understandingVersion };
      return inform(state, '只修改了选中范围，尚未替你保存或带去工作。');
    }
    case 'DISMISS_SUGGESTION': if (s.suggestion) s.suggestion.status = 'dismissed'; return inform(state, '建议已放弃，自己的内容没有改动。');
    case 'UNDO_SUGGESTION': {
      if (!canUndoSuggestion(m, s)) return inform(state, '这处内容后来已编辑或保存；旧撤销不会覆盖新版本。');
      const u = s.suggestionUndo;
      editDraft(m, s, m.understandingDraft.slice(0, u.start) + u.original + m.understandingDraft.slice(u.start + u.replacement.length));
      s.suggestionUndo = null;
      if (s.suggestion) s.suggestion.status = 'dismissed';
      return inform(state, '这一处已恢复，其他内容未改变。');
    }
    case 'STOP_DRAFT': {
      const text = string(action.text);
      if (text !== m.stopDraft) { m.stopDraft = text; m.stop = text; m.stopVersion++; }
      return state;
    }
    case 'COLLAPSE': {
      if (state.screen !== 'paused') state.collapseUndo = { matterId: m.id, screen: state.screen };
      state.screen = 'paused'; return inform(state, '已收起，草稿和停点留在本次会话。');
    }
    case 'UNDO_COLLAPSE': {
      if (!state.collapseUndo || state.collapseUndo.matterId !== m.id) return state;
      state.screen = state.collapseUndo.screen;
      state.collapseUndo = null;
      return inform(state, '只恢复工作面，不回滚内容编辑。');
    }
    case 'REOPEN': state.screen = 'reentry'; return inform(state, '');
    case 'INCOMING_DRAFT': {
      const text = string(action.text);
      if (s.incoming.text === text) return state;
      s.incoming = { text, sourceId: null, decision: 'pending' }; return state;
    }
    case 'INCOMING_DECISION': {
      if (!['linked', 'unrelated', 'saved'].includes(action.decision)) return state;
      if (!nonempty(s.incoming.text)) return inform(state, '先带来一段新材料，再决定是否关联。');
      if (!s.incoming.sourceId) {
        s.incoming.sourceId = addSource(state, null, { id: nextId(state, 'source'), title: '本次带来的观察', kind: state.isDemo ? 'example-observation' : 'user-observation', excerpt: s.incoming.text, url: null });
      }
      const id = s.incoming.sourceId;
      m.observations = m.observations.filter((entry) => !(entry.sourceId === id && entry.origin === 'incoming'));
      state.unassignedMaterials = state.unassignedMaterials.filter((entry) => entry.sourceId !== id);
      if (action.decision === 'linked') {
        m.sourceIds = unique([...m.sourceIds, id]);
        m.observations.push({ id: nextId(state, 'observation'), text: s.incoming.text, sourceId: id, relation: 'pending-comparison', origin: 'incoming' });
      } else {
        m.sourceIds = m.sourceIds.filter((entry) => entry !== id);
        state.unassignedMaterials.push({ sourceId: id, text: s.incoming.text, decision: action.decision, originMatterId: m.id });
      }
      s.incoming.decision = action.decision;
      return inform(state, action.decision === 'linked' ? '新观察已接回，具体关系仍待比较。' : '材料已保留，没有强行关联或改写理解。');
    }
    case 'HANDOFF_DRAFT': {
      const patch = action.patch || {};
      const h = s.handoff;
      if (patch.scope !== undefined && patch.scope !== 'current-task') return inform(state, '这个原型只支持本次任务，不会扩大为长期要求。');
      if (patch.role !== undefined && !ROLES.includes(patch.role)) return inform(state, '请选择本次尝试、参考或排除。');
      if (patch.destination && typeof patch.destination === 'object') {
        for (const key of ['agent', 'project', 'task']) if (patch.destination[key] !== undefined) h.destination[key] = string(patch.destination[key]);
      }
      for (const key of ['selectedText', 'note', 'role']) if (patch[key] !== undefined) h[key] = string(patch[key]);
      if (patch.selectedText !== undefined) { h.selectionEdited = true; h.understandingVersion = m.understandingVersion; h.selectionBasisUnderstanding = m.understanding; }
      h.scope = 'current-task';
      h.confirmed = false;
      h.evidenceLevel = 'none';
      return state;
    }
    case 'CONFIRM_HANDOFF': {
      const h = selectHandoff(m, s);
      if (h.role === 'exclude') return reduceChain(state, { type: 'EXCLUDE_HANDOFF' });
      if (!Object.values(h.destination).every(nonempty) || !nonempty(h.selectedText)) return inform(state, '请确认 Agent、项目、任务及本次选中的内容。');
      if (s.handoff.confirmed && s.handoffSnapshot) { state.screen = 'work'; return state; }
      h.confirmed = true;
      // This is an in-prototype handoff, not proof of native Agent delivery.
      h.evidenceLevel = 'none';
      s.handoff = h;
      s.handoffSnapshot = { id: nextId(state, 'handoff'), matterId: m.id, ...copy(h), capturedUnderstanding: h.selectionBasisUnderstanding, currentVersionAtConfirmation: m.understandingVersion, stop: m.stop, origin: state.isDemo ? 'example' : 'prototype-confirmation', actualDelivery: false };
      s.handoffHistory.push(copy(s.handoffSnapshot));
      state.screen = 'work';
      return inform(state, '本次带入快照已确认；尚未向真实 Agent 发送。');
    }
    case 'EXCLUDE_HANDOFF': {
      s.handoff.role = 'exclude'; s.handoff.confirmed = false; s.handoff.evidenceLevel = 'none';
      if (s.handoffSnapshot) {
        const old = s.handoffHistory.find((entry) => entry.id === s.handoffSnapshot.id);
        if (old) old.excluded = true;
        s.handoffSnapshot = null;
      }
      return inform(state, '这次不使用；个人理解和已留事实仍保留。');
    }
    case 'WORK_FINDING': {
      if (!nonempty(action.text)) return inform(state, '先写下真实的新发现。');
      if (!s.handoffSnapshot) return inform(state, '先确认本次工作来处，再记录工作发现。');
      const finding = { id: nextId(state, 'finding'), text: action.text, origin: { matterId: m.id, handoffId: s.handoffSnapshot.id, destination: copy(s.handoffSnapshot.destination) } };
      s.workFindings.push(finding);
      const sourceId = addSource(state, m, { id: nextId(state, 'source'), title: '本次工作发现', kind: 'work-finding', excerpt: action.text, url: null });
      m.observations.push({ id: nextId(state, 'observation'), text: action.text, sourceId, relation: 'unjudged', origin: copy(finding.origin) });
      return inform(state, '发现已带着工作来处保留，不自动修订理解。');
    }
    case 'RESULT_DRAFT': {
      const patch = action.patch || {};
      let changed = false;
      for (const key of ['fact', 'interpretation', 'unconfirmed', 'proposedUnderstanding']) if (patch[key] !== undefined && s.result[key] !== string(patch[key])) { s.result[key] = string(patch[key]); changed = true; }
      if (s.result.baseVersion === null || patch.proposedUnderstanding !== undefined) { s.result.baseVersion = m.understandingVersion; s.result.baseDraftVersion = m.understandingDraftVersion; s.result.baseStopVersion = m.stopVersion; }
      if (changed) { s.result.decision = 'pending'; s.result.savedId = null; }
      return state;
    }
    case 'KEEP_RESULT_ONLY': {
      if (!nonempty(s.result.fact)) return inform(state, '还没有用户带回的事实，不制造结果。');
      saveResult(state, m, s);
      s.result.decision = 'result-only';
      return inform(state, '只保留结果；当前理解、草稿和停点均未改变。');
    }
    case 'COMMIT_REVISION': {
      if (!nonempty(s.result.fact) || !nonempty(s.result.proposedUnderstanding)) return inform(state, '需要实际带回的事实和你愿意留下的理解，才能修订。');
      if (s.result.decision === 'revised') return state;
      if (s.result.baseVersion !== m.understandingVersion || s.result.baseDraftVersion !== m.understandingDraftVersion || s.result.baseStopVersion !== m.stopVersion) return inform(state, '当前理解或停点后来已变化；请核对并重新编辑这次修订，不覆盖新内容。');
      const resultId = saveResult(state, m, s);
      if (m.understanding === s.result.proposedUnderstanding) { s.result.decision = 'result-only'; return inform(state, '与当前理解相同；结果已保留，没有制造一次变化。'); }
      const before = { understanding: m.understanding, draft: m.understandingDraft, stop: m.stop, stopDraft: m.stopDraft };
      const revision = { id: nextId(state, 'revision'), before: m.understanding, after: s.result.proposedUnderstanding, resultId, beforeVersion: m.understandingVersion, beforeStop: m.stop, afterStop: s.result.unconfirmed, undone: false };
      m.understanding = s.result.proposedUnderstanding;
      m.understandingDraft = m.understanding;
      m.understandingVersion++;
      m.understandingDraftVersion++;
      m.stop = s.result.unconfirmed;
      m.stopDraft = m.stop;
      m.stopVersion++;
      revision.afterVersion = m.understandingVersion;
      m.revisions.push(revision);
      m.results.find((entry) => entry.id === resultId).decision = 'revised';
      s.result.decision = 'revised';
      s.revisionUndo = { revisionId: revision.id, before, afterVersion: m.understandingVersion, afterDraftVersion: m.understandingDraftVersion, afterStopVersion: m.stopVersion };
      if (s.suggestion?.status === 'pending') s.suggestion.status = 'stale';
      state.screen = 'revised';
      return inform(state, '修订已落回同一件事；仅保存在本次会话，不自动成为工作要求。');
    }
    case 'UNDO_REVISION': {
      if (!canUndoRevision(m, s)) return inform(state, '修订之后已有更新；旧撤销不会覆盖后来的编辑或停点。');
      const u = s.revisionUndo;
      m.understanding = u.before.understanding;
      m.understandingDraft = u.before.draft;
      m.stop = u.before.stop;
      m.stopDraft = u.before.stopDraft;
      m.understandingVersion++;
      m.understandingDraftVersion++;
      m.stopVersion++;
      m.revisions.find((entry) => entry.id === u.revisionId).undone = true;
      s.revisionUndo = null;
      s.result.decision = 'result-only';
      state.screen = 'results';
      return inform(state, '理解已恢复此前版本；结果事实与修订来路仍保留。');
    }
    case 'TRY_AGAIN': {
      if (nonempty(s.result.fact)) saveResult(state, m, s);
      const destination = copy(s.handoff.destination);
      s.handoff = { ...blankHandoff(), destination };
      s.handoffSnapshot = null;
      s.result = blankResult();
      return navigate(state, 'handoff');
    }
    default: return state;
  }
}

export function selectChainView(state) {
  const m = current(state) || blankMatter();
  const s = session(state) || blankSession();
  const sources = m.sourceIds.map((id) => sourceById(state, id)).filter(Boolean);
  const context = s.contextMode === 'fresh'
    ? { whyCare: '', understanding: '', stop: '', sources: [], messages: s.discussion.messages.filter((entry) => entry.contextMode === 'fresh' && entry.contextEpoch === s.contextEpoch), newMaterial: s.incoming.decision === 'pending' ? s.incoming.text : '' }
    : { whyCare: m.whyCare, understanding: m.understanding, stop: m.stop, sources, messages: s.discussion.messages, newMaterial: s.incoming.decision === 'pending' || s.incoming.decision === 'linked' ? s.incoming.text : '' };
  const { sourceIds, ...matter } = m;
  const discussion = s.contextMode === 'fresh' ? { cases: [], possibility: '', messages: context.messages, text: discussionText(s) } : { ...s.discussion, text: discussionText(s) };
  return copy({ screen: state.screen, selectedId: state.selectedId, contextMode: s.contextMode, notice: state.notice, isDemo: state.isDemo, matters: state.matters.map((entry) => ({ id: entry.id, title: entry.title, stop: entry.stop, hasDraft: nonempty(entry.understandingDraft), hasUnsavedDraft: entry.understanding !== entry.understandingDraft })), matter: { ...matter, sources }, capture: state.capture, composer: s.composer, focus: s.focus, discussion, context, comparison: s.comparison, suggestion: s.suggestion, incoming: s.incoming, handoff: selectHandoff(m, s), handoffSnapshot: s.handoffSnapshot, handoffHistory: s.handoffHistory, result: s.result, workFindings: s.workFindings, availableSources: state.sources.filter((entry) => availableSource(state, entry.id)), unassignedMaterials: state.unassignedMaterials.filter((entry) => entry.originMatterId === state.selectedId), undo: { collapse: state.collapseUndo?.matterId === m.id, revision: canUndoRevision(m, s), suggestion: canUndoSuggestion(m, s) } });
}

/** Explicit preview fixture only. Never called by NAVIGATE or user mutations. */
export function createChainDemo(screen = 'resume') {
  if (!SCREENS.includes(screen)) screen = 'resume';
  if (screen === 'reading') {
    let state = createChainState(); state.isDemo = true;
    state = reduceChain(state, { type: 'CAPTURE_EXCERPT', sourceId: 'source-article', text: EXAMPLE_SOURCES[0].excerpt });
    return reduceChain(state, { type: 'CAPTURE_DRAFT', text: '是不是收藏的时候，应该补一句自己的感受？' });
  }
  let state = createChainState({ fixture: 'saved' });
  const s = session(state);
  s.discussion.cases = [{ id: 'case-data', text: '留下一段以后要引用的数据。' }, { id: 'case-experience', text: '留下一句话，因为它让你想起某段经历。' }];
  s.discussion.messages = [{ id: 'message-example', role: 'user', text: '第二种好像更需要我自己写点什么。', focus: null, contextMode: 'resume' }];
  s.discussion.possibility = '一种可能：以后需要找回的是内容，还是你当时的个人触动。';
  if (screen === 'discussion') {
    const text = discussionText(s), selected = s.discussion.messages[0].text;
    state = reduceChain(state, { type: 'FOCUS', field: 'discussion', start: text.indexOf(selected), end: text.indexOf(selected) + selected.length, text: selected });
    state = reduceChain(state, { type: 'COMPOSER_DRAFT', text: '但原文能不能也帮我想起来？' });
  }
  if (screen === 'comparison') state = reduceChain(state, { type: 'OPEN_COMPARISON', sourceId: 'source-comparison' });
  if (screen === 'understanding') {
    const original = '我自己的表达可能帮助后者。', start = current(state).understandingDraft.indexOf(original);
    state = reduceChain(state, { type: 'SUGGEST', start, end: start + original.length, replacement: '自己的表达可能帮助后者，但不是每次都需要。' });
  }
  if (['paused', 'reentry', 'handoff', 'work', 'results', 'revised'].includes(screen)) state = reduceChain(state, { type: 'STOP_DRAFT', text: '哪些个人触动无法只靠原文恢复？' });
  if (['reentry', 'handoff', 'work', 'results', 'revised'].includes(screen)) state = reduceChain(state, { type: 'INCOMING_DRAFT', text: '今天看回一段没写附言的收藏，我想起了当时的问题。' });
  if (['handoff', 'work', 'results', 'revised'].includes(screen)) state = reduceChain(state, { type: 'HANDOFF_DRAFT', patch: { selectedText: '保留完整原文，附言可选。', note: '想观察：不强制附言，回来时还能否认出当时的问题？' } });
  if (['work', 'results', 'revised'].includes(screen)) {
    state = reduceChain(state, { type: 'CONFIRM_HANDOFF' });
    session(state).handoff.evidenceLevel = 'artifact-demo';
    session(state).handoffSnapshot.evidenceLevel = 'artifact-demo';
    state = reduceChain(state, { type: 'WORK_FINDING', text: '这个交互很轻，但回来时可能还认不出来。' });
  }
  if (['results', 'revised'].includes(screen)) state = reduceChain(state, { type: 'RESULT_DRAFT', patch: { fact: '这次没有写附言，也接回了当时的问题。', interpretation: '可能与原文和当时问题一起保留有关。', unconfirmed: '哪些个人触动需要额外表达？', proposedUnderstanding: DEMO_REVISION } });
  if (screen === 'revised') state = reduceChain(state, { type: 'COMMIT_REVISION' });
  if (screen === 'paused') state = reduceChain(state, { type: 'COLLAPSE' });
  state.screen = screen;
  if (screen !== 'revised' && screen !== 'paused') state.notice = '';
  return state;
}
