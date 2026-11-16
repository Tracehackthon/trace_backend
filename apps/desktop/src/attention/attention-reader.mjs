/**
 * A small, DOM-first reader surface for the Attention Canvas.
 *
 * The reader deliberately owns presentation state only.  It never calls a
 * Product Workspace command and never treats an Agent response as a saved
 * understanding.  Consumers can use the pure helpers in this file in a
 * reducer or a test, or mount the optional DOM adapter with
 * `mountAttentionReader`.
 */

export const READER_LANES = Object.freeze(['original', 'user', 'agent']);
export const READER_MODES = Object.freeze(['source', 'compare']);
export const READER_TABS = Object.freeze(['original', 'user', 'agent']);
export const READER_EVENTS = Object.freeze({
  closed: 'READER_CLOSED',
  selectionChanged: 'READER_SELECTION_ANCHOR_CHANGED',
  selectionCleared: 'READER_SELECTION_CLEARED',
  tabSelected: 'READER_TAB_SELECTED',
  compareRequested: 'READER_COMPARE_REQUESTED',
  compareSaveRequested: 'READER_COMPARE_SAVE_REQUESTED',
  userDraftChanged: 'READER_USER_DRAFT_CHANGED',
  userDraftSaveRequested: 'READER_USER_DRAFT_SAVE_REQUESTED',
  agentRequested: 'READER_AGENT_REQUESTED',
  agentCancelled: 'READER_AGENT_CANCEL_REQUESTED',
  agentRetried: 'READER_AGENT_RETRY_REQUESTED',
  agentToggled: 'READER_AGENT_TOGGLED',
  agentCopiedToDraft: 'READER_AGENT_COPIED_TO_DRAFT',
  agentAdoptRequested: 'READER_AGENT_ADOPT_REQUESTED',
  sourceLinkActivated: 'READER_SOURCE_LINK_ACTIVATED',
  sourceRetried: 'READER_SOURCE_RETRY_REQUESTED',
});

const SOURCE_STATUSES = new Set(['loading', 'ready', 'empty', 'error', 'unavailable', 'denied', 'changed', 'invalid']);
const AGENT_STATUSES = new Set(['idle', 'running', 'ready', 'empty', 'error', 'unavailable', 'stale', 'cancelled']);
const SAVE_STATUSES = new Set(['idle', 'saving', 'saved', 'error', 'stale']);
const SOURCE_STATUS_ALIASES = Object.freeze({available: 'ready', missing: 'empty', unresolved: 'unavailable', example: 'ready', 'work-return': 'ready'});
const AGENT_STATUS_ALIASES = Object.freeze({generating: 'running', unconfirmed: 'ready', failed: 'error', 'not-requested': 'idle', dismissed: 'empty', accepted: 'ready'});
const FOCUS_SAFE_PROTOCOLS = new Set(['http:', 'https:']);

const asText = value => value == null ? '' : String(value);
const asId = value => value == null || value === '' ? null : String(value);
const asStatus = (value, allowed, fallback) => allowed.has(value) ? value : fallback;
export const readerDraftCanSave = (value, saveStatus = 'idle') => Boolean(asText(value).trim()) && saveStatus !== 'saving';
const sourceStatus = (value, fallback) => {
  const raw = asText(value).trim().toLowerCase();
  return asStatus(SOURCE_STATUS_ALIASES[raw] ?? raw, SOURCE_STATUSES, fallback);
};
const agentStatus = (value, fallback) => {
  const raw = asText(value).trim().toLowerCase();
  return asStatus(AGENT_STATUS_ALIASES[raw] ?? raw, AGENT_STATUSES, fallback);
};
const bool = value => value === true;

/** Escape text before it is placed in the markup string produced by this file. */
export function escapeReaderHTML(value) {
  return asText(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

/**
 * Return a URL that is safe to display as a clickable source link.
 *
 * Relative URLs are intentionally not accepted: a reader should not silently
 * reinterpret a source locator against the host application's origin.  The
 * caller can still display the original locator as plain text.
 */
export function safeSourceUrl(value) {
  const raw = asText(value).trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!FOCUS_SAFE_PROTOCOLS.has(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Build an immutable-looking (but plain) text anchor.  `start`/`end` use the
 * JavaScript string offset convention used by Range and the Product chain.
 */
export function createSelectionAnchor({
  sourceId = null,
  text = '',
  quote = text,
  start = null,
  end = null,
  revision = null,
  objectId = null,
  lane = 'original',
} = {}) {
  const normalizedText = asText(text);
  const normalizedQuote = asText(quote);
  const startNumber = Number.isFinite(start) ? Math.max(0, Math.trunc(start)) : null;
  const endNumber = Number.isFinite(end)
    ? Math.max(startNumber == null ? 0 : startNumber, Math.trunc(end))
    : (startNumber == null ? null : startNumber + normalizedQuote.length);
  return {
    sourceId: asId(sourceId),
    objectId: asId(objectId),
    lane: READER_LANES.includes(lane) ? lane : 'original',
    quote: normalizedQuote,
    start: startNumber,
    end: endNumber,
    revision: revision == null ? null : revision,
  };
}

function normalizeAnchor(anchor) {
  if (!anchor || typeof anchor !== 'object') return null;
  return createSelectionAnchor(anchor);
}

function first(source, keys) {
  for (const key of keys) {
    if (source && source[key] != null) return asText(source[key]);
  }
  return '';
}

/** Normalize the several SourceSnapshot shapes used by the existing screens. */
export function normalizeReaderSource(source = {}) {
  const input = source && typeof source === 'object' ? source : {};
  const nestedOriginal = input.original && typeof input.original === 'object' ? input.original : {};
  const nestedSource = Array.isArray(input.sources) && input.sources[0] && typeof input.sources[0] === 'object' ? input.sources[0] : {};
  const fullText = first(input, ['fullText', 'full', 'originalText', 'text']) || first(nestedOriginal, ['fullText', 'full', 'originalText', 'text', 'excerpt']) || first(nestedSource, ['fullText', 'text', 'excerpt']);
  const fragmentText = first(input, ['fragmentText', 'fragment', 'excerpt']) || first(nestedOriginal, ['fragmentText', 'fragment', 'excerpt']) || first(nestedSource, ['fragmentText', 'fragment', 'excerpt']);
  const summaryText = first(input, ['summaryText', 'summary', 'abstract']) || first(nestedOriginal, ['summaryText', 'summary', 'abstract']);
  const userExcerpt = first(input, ['userExcerpt', 'captureExcerpt', 'userQuote', 'note']) || first(nestedOriginal, ['userExcerpt', 'captureExcerpt', 'userQuote', 'note']);
  const locatorValue = input.locator ?? input.url ?? input.href ?? nestedSource.locator ?? nestedSource.url ?? nestedSource.href;
  const locator = locatorValue && typeof locatorValue === 'object'
    ? first(locatorValue, ['url', 'href', 'value'])
    : asText(locatorValue);
  return {
    id: asId(input.id ?? input.sourceId ?? nestedOriginal.id ?? nestedOriginal.objectId ?? nestedSource.id ?? nestedSource.sourceId),
    matterId: asId(input.matterId ?? nestedOriginal.matterId ?? nestedSource.matterId),
    title: first(input, ['title', 'name']) || first(nestedOriginal, ['title', 'name']) || first(nestedSource, ['title', 'name']) || '原文材料',
    author: first(input, ['author', 'byline', 'creator']) || first(nestedOriginal, ['author', 'byline', 'creator']) || first(nestedSource, ['author', 'byline', 'creator']),
    sourceKind: first(input, ['sourceKind', 'kind', 'type']) || first(nestedOriginal, ['sourceKind', 'kind', 'type']) || first(nestedSource, ['sourceKind', 'kind', 'type']) || '用户材料',
    authorship: first(input, ['authorship', 'authorType']) || 'user',
    scope: first(input, ['scope']) || 'matter',
    lifecycle: first(input, ['lifecycle', 'state']) || 'snapshot',
    sourceStatus: sourceStatus(input.sourceStatus ?? input.accessStatus ?? input.status ?? nestedOriginal.status ?? nestedSource.accessStatus ?? nestedSource.status, fullText || fragmentText ? 'ready' : 'empty'),
    contentHash: first(input, ['contentHash', 'hash']),
    capturedAt: first(input, ['capturedAt', 'createdAt', 'retrievedAt']),
    locator,
    safeUrl: safeSourceUrl(locator),
    fullText,
    fragmentText,
    summaryText,
    userExcerpt,
  };
}

function normalizeAgent(agent = {}, state = {}) {
  const input = agent && typeof agent === 'object' ? agent : {};
  const status = agentStatus(input.status ?? state.agentStatus, 'idle');
  const candidates = Array.isArray(input.candidates)
    ? input.candidates.map(candidate => ({
      id: asId(candidate?.id ?? candidate?.proposalId),
      text: asText(candidate?.text ?? candidate?.output ?? candidate?.content ?? candidate?.replacement),
      label: asText(candidate?.label),
      patch: asText(candidate?.patch),
      patchHash: asText(candidate?.patchHash ?? candidate?.hash),
      status: asText(candidate?.status || 'candidate'),
      citations: Array.isArray(candidate?.citations) ? candidate.citations.map(normalizeCitation) : [],
    }))
    : [];
  return {
    status,
    purpose: asText(input.purpose ?? input.requestPurpose),
    output: asText(input.output ?? input.text ?? input.content),
    error: asText(input.error ?? input.message),
    requestId: asId(input.requestId),
    targetRevision: input.targetRevision ?? null,
    contextEpoch: input.contextEpoch ?? null,
    candidates,
    citations: Array.isArray(input.citations) ? input.citations.map(normalizeCitation) : [],
    expanded: bool(input.expanded ?? state.agentExpanded),
  };
}

function normalizeCitation(citation) {
  if (typeof citation === 'string') return {label: citation, url: safeSourceUrl(citation), text: citation};
  const item = citation && typeof citation === 'object' ? citation : {};
  const locator = first(item, ['url', 'href', 'locator']);
  return {
    label: first(item, ['label', 'title', 'source']) || locator,
    text: first(item, ['text', 'quote', 'excerpt']),
    url: safeSourceUrl(locator),
  };
}

function normalizeUser(user = {}, state = {}) {
  const input = user && typeof user === 'object' ? user : {};
  const understanding = input.understanding && typeof input.understanding === 'object' ? input.understanding : {};
  const stop = input.stop && typeof input.stop === 'object' ? input.stop : {};
  const savedText = asText(input.text ?? input.savedText ?? understanding.text ?? understanding.understanding ?? (typeof input.understanding === 'string' ? input.understanding : ''));
  const draft = asText(state.userDraft ?? input.draft ?? input.draftText ?? understanding.draft);
  // An empty draft is still meaningful after an explicit draft action, but a
  // normalized state object also carries `draft: ''` for every saved lane.
  // Treating the latter as an implicit draft made createReaderState non-
  // idempotent and caused a saved understanding to render as a draft on the
  // next projection pass.
  const hasDraft = input.status === 'draft' ||
    input.draft != null && input.draft !== '' ||
    input.draftText != null && input.draftText !== '' ||
    understanding.draft != null && understanding.draft !== '' ||
    state.userDraft != null && (state.userDraft !== '' || !savedText);
  return {
    savedText,
    draft,
    revision: input.revision ?? input.version ?? understanding.revision ?? understanding.version ?? null,
    status: asText(input.status === 'draft' || hasDraft && draft !== savedText ? 'draft' : savedText ? 'saved' : 'empty'),
    stop: asText(typeof input.stop === 'string' ? input.stop : input.stopPoint ?? stop.text ?? stop.draft),
  };
}

/**
 * Create the reader's presentation state.  The object is intentionally
 * serializable; a DOM element used for focus restoration is kept by the DOM
 * adapter, not in this state.
 */
export function createReaderState(input = {}) {
  const readerLanes = input.lanes && typeof input.lanes === 'object' ? input.lanes : {};
  const sourceInput = input.source ?? input.original ?? readerLanes.original?.original ?? readerLanes.original ?? {};
  const normalizedSource = normalizeReaderSource(sourceInput);
  const sourceStatusValue = input.sourceStatus ?? input.sourceAccessStatus;
  const normalizedSourceStatus = sourceStatus(sourceStatusValue, normalizedSource.sourceStatus);
  const source = {...normalizedSource, sourceStatus: normalizedSourceStatus};
  const selectedAnchor = normalizeAnchor(input.selectedAnchor ?? input.selection ?? input.anchor);
  const userInput = input.user ?? input.userUnderstanding ?? input.understanding ?? readerLanes.user ?? {};
  const agentInput = input.agent ?? readerLanes.agent ?? {};
  const user = normalizeUser(userInput, input);
  const agent = normalizeAgent(agentInput, input);
  const saveInput = input.save && typeof input.save === 'object' ? input.save : {};
  const saveStatus = asStatus(input.saveStatus ?? saveInput.status, SAVE_STATUSES, 'idle');
  const open = bool(input.open);
  const mode = READER_MODES.includes(input.mode) ? input.mode : 'source';
  const matterId = asId(input.matterId ?? sourceInput.matterId);
  const contextEpoch = input.contextEpoch ?? agent.contextEpoch ?? null;
  const returnFocusKey = asId(input.returnFocusKey ?? input.triggerId);
  return {
    open,
    mode,
    matterId,
    focus: input.focus && typeof input.focus === 'object' ? {...input.focus} : null,
    activeTab: READER_TABS.includes(input.activeTab) ? input.activeTab : 'original',
    source,
    sourceId: asId(input.sourceId ?? source.id),
    selectedAnchor,
    user,
    userDraft: user.draft,
    agent,
    agentStatus: agent.status,
    agentExpanded: agent.expanded,
    sourceStatus: normalizedSourceStatus,
    saveStatus,
    saveError: asText(input.saveError ?? saveInput.error),
    contextMode: input.contextMode === 'fresh' ? 'fresh' : 'resume',
    contextEpoch,
    returnFocusKey,
    draftKey: asText(input.draftKey || `${matterId || ''}:${returnFocusKey || source.id || ''}:${input.contextMode === 'fresh' ? 'fresh' : 'resume'}:${contextEpoch ?? ''}`),
    beforeClose: input.beforeClose && typeof input.beforeClose === 'object' ? {
      worldTransform: input.beforeClose.worldTransform ?? null,
      focus: input.beforeClose.focus ?? null,
      camera: input.beforeClose.camera ?? null,
    } : null,
    notice: input.notice && typeof input.notice === 'object' ? {...input.notice} : null,
  };
}

function withState(state) {
  return createReaderState(state);
}

/**
 * A pure state transition helper.  Events with a `READER_` prefix are safe to
 * pass directly from the DOM adapter; domain events are deliberately ignored.
 */
export function reduceReaderState(previous, event = {}) {
  const current = withState(previous);
  const type = asText(event.type || event.action).toUpperCase();
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : event;
  switch (type) {
    case 'OPEN':
    case 'OPEN_SOURCE':
    case 'READER_OPEN':
    case 'READER_OPEN_SOURCE': {
      const source = payload.source ?? payload.original ?? current.source;
      return withState({
        ...current,
        ...payload,
        open: true,
        mode: 'source',
        source,
        matterId: payload.matterId ?? source?.matterId ?? current.matterId,
        sourceId: payload.sourceId ?? source?.id ?? current.sourceId,
        selectedAnchor: payload.selectedAnchor ?? payload.anchor ?? current.selectedAnchor,
        returnFocusKey: payload.returnFocusKey ?? payload.triggerId ?? current.returnFocusKey,
        beforeClose: payload.beforeClose ?? current.beforeClose,
      });
    }
    case 'OPEN_COMPARE':
    case 'COMPARE_OPEN':
    case 'READER_OPEN_COMPARE':
    case 'READER_COMPARE_REQUESTED': {
      const source = payload.source ?? current.source;
      const selectedAnchor = payload.selectedAnchor ?? payload.anchor ?? current.selectedAnchor;
      if (!selectedAnchor?.quote) return current;
      return withState({
        ...current,
        ...payload,
        open: true,
        mode: 'compare',
        source,
        matterId: payload.matterId ?? source?.matterId ?? current.matterId,
        sourceId: payload.sourceId ?? source?.id ?? current.sourceId,
        selectedAnchor,
        activeTab: 'original',
        beforeClose: payload.beforeClose ?? current.beforeClose,
      });
    }
    case 'SET_SELECTION':
    case 'SELECTION_CHANGED':
    case 'READER_SELECTION_ANCHOR_CHANGED':
      return withState({...current, selectedAnchor: payload.anchor ?? payload.selectedAnchor ?? null});
    case 'CLEAR_SELECTION':
      return withState({...current, selectedAnchor: null});
    case 'SELECT_TAB':
    case 'READER_TAB_SELECTED':
      return withState({...current, activeTab: READER_TABS.includes(payload.tab) ? payload.tab : current.activeTab});
    case 'TOGGLE_AGENT':
    case 'READER_AGENT_TOGGLED':
    case 'READER_AGENT_EXPANDED':
      return withState({...current, agentExpanded: payload.expanded == null ? !current.agentExpanded : bool(payload.expanded), agent: {...current.agent, expanded: payload.expanded == null ? !current.agentExpanded : bool(payload.expanded)}});
    case 'SET_USER_DRAFT':
    case 'USER_DRAFT_CHANGED':
    case 'READER_USER_DRAFT_CHANGED':
      return withState({
        ...current,
        userDraft: asText(payload.text ?? payload.draft),
        user: {...current.user, draft: asText(payload.text ?? payload.draft), status: 'draft'},
      });
    case 'COPY_AGENT_TO_DRAFT':
    case 'READER_AGENT_COPIED_TO_DRAFT': {
      const text = asText(payload.text ?? payload.output ?? current.agent.output ?? current.agent.candidates[0]?.text);
      return withState({...current, userDraft: text, user: {...current.user, draft: text, status: 'draft'}});
    }
    case 'SET_AGENT_STATUS':
    case 'AGENT_STATUS_CHANGED':
    case 'READER_AGENT_STATUS_CHANGED':
      return withState({...current, agentStatus: agentStatus(payload.status, current.agentStatus), agent: {...current.agent, ...payload, status: agentStatus(payload.status, current.agentStatus)}});
    case 'SET_SAVE_STATUS':
    case 'SAVE_STATUS_CHANGED':
    case 'READER_SAVE_STATUS_CHANGED':
      return withState({...current, saveStatus: asStatus(payload.status, SAVE_STATUSES, current.saveStatus), saveError: asText(payload.error ?? current.saveError)});
    case 'CLOSE':
    case 'READER_CLOSE':
    case 'READER_CLOSED':
      return withState({...current, open: false, mode: 'source', activeTab: 'original', agentExpanded: false, agent: {...current.agent, expanded: false}});
    case 'NOTICE':
      return withState({...current, notice: payload.notice ?? null});
    default:
      return current;
  }
}

function stateToLaneStatus(state) {
  const source = state.source;
  const originalText = source.fullText || source.fragmentText || source.summaryText || source.userExcerpt;
  if (state.sourceStatus === 'loading') return {kind: 'loading', label: '正在核验原文…'};
  if (state.sourceStatus === 'unavailable') return {kind: 'unavailable', label: '来源暂不可用'};
  if (['error', 'denied', 'changed', 'invalid'].includes(state.sourceStatus)) return {kind: 'error', label: source.sourceStatus === 'denied' ? '来源未获授权' : source.sourceStatus === 'changed' ? '来源已变化' : source.sourceStatus === 'invalid' ? '来源定位不可用' : '原文暂时无法读取'};
  if (!originalText) return {kind: 'empty', label: '还没有可显示的原文摘录'};
  return {kind: 'ready', label: '原文可读'};
}

/**
 * Pure projection used by tests and non-DOM renderers.  Keeping this object
 * separate from markup makes the three lanes impossible to accidentally merge
 * while adapting the reader to another host.
 */
export function projectReader(stateInput = {}) {
  const state = withState(stateInput);
  const source = state.source;
  const originalStatus = stateToLaneStatus(state);
  const userStatus = state.user.status === 'draft' || state.user.draft && state.user.draft !== state.user.savedText ? 'draft' : state.user.savedText ? 'saved' : 'empty';
  const agent = state.agent;
  const agentStatus = agent.status === 'idle' && !agent.output && !agent.candidates.length ? 'not-requested' : agent.status;
  return {
    open: state.open,
    mode: state.mode,
    matterId: state.matterId,
    focus: state.focus,
    activeTab: state.activeTab,
    source: {
      id: source.id,
      title: source.title,
      author: source.author,
      sourceKind: source.sourceKind,
      authorship: source.authorship,
      scope: source.scope,
      lifecycle: source.lifecycle,
      sourceStatus: state.sourceStatus,
      contentHash: source.contentHash,
      capturedAt: source.capturedAt,
      locator: source.locator,
      safeUrl: source.safeUrl,
    },
    lanes: {
      original: {
        id: 'original',
        label: '原文 / 原现场',
        ariaLabel: '原文与原现场，只读',
        readOnly: true,
        status: originalStatus.kind,
        fullText: source.fullText,
        fragmentText: source.fragmentText,
        summaryText: source.summaryText,
        userExcerpt: source.userExcerpt,
      },
      user: {
        id: 'user',
        label: '我的理解 / 停点',
        ariaLabel: '我的理解',
        readOnly: false,
        status: userStatus,
        savedText: state.user.savedText,
        draft: state.user.draft,
        revision: state.user.revision,
        stop: state.user.stop,
      },
      agent: {
        id: 'agent',
        label: 'Agent 解读 / 建议',
        ariaLabel: 'Agent 解读与建议',
        readOnly: true,
        status: agentStatus,
        expanded: state.agentExpanded,
        purpose: agent.purpose,
        output: agent.output,
        error: agent.error,
        requestId: agent.requestId,
        targetRevision: agent.targetRevision,
        contextEpoch: agent.contextEpoch,
        candidates: agent.candidates,
        citations: agent.citations,
      },
    },
    selection: state.selectedAnchor,
    contextMode: state.contextMode,
    contextEpoch: state.contextEpoch,
    draftKey: state.draftKey,
    save: {status: state.saveStatus, error: state.saveError},
    returnFocusKey: state.returnFocusKey,
    beforeClose: state.beforeClose,
    notice: state.notice,
  };
}

export function readerFrame(stateInput = {}) {
  const state = withState(stateInput);
  return state.open ? (state.mode === 'compare' ? '04-compare-selection' : '03-reader-open') : '05-close-reset';
}

function statusBlock({kind, label, code = ''}, extra = '') {
  const role = kind === 'error' ? 'alert' : 'status';
  const live = kind === 'loading' ? ' aria-live="polite"' : '';
  return `<div class="attention-reader-status attention-reader-status--${escapeReaderHTML(kind)}" role="${role}"${live} data-reader-status="${escapeReaderHTML(kind)}">${escapeReaderHTML(label)}${extra}</div>`;
}

function sourceLink(source, label = '打开原文') {
  if (!source.safeUrl) {
    return source.locator
      ? `<span class="attention-reader-link attention-reader-link--unavailable" data-reader-link-status="unavailable">链接不可用</span>`
      : '';
  }
  return `<a class="attention-reader-link" data-reader-source-link href="${escapeReaderHTML(source.safeUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeReaderHTML(label)}（新窗口）">${escapeReaderHTML(label)}</a>`;
}

function originalSection(key, label, text, extraClass = '', showEmpty = false) {
  if (!text && !showEmpty) return '';
  const content = text ? escapeReaderHTML(text) : '此类摘录未提供。';
  return `<section class="attention-reader-original-section ${extraClass}${text ? '' : ' attention-reader-original-section--empty'}" data-original-view="${key}"><h3>${escapeReaderHTML(label)}</h3><p>${content}</p></section>`;
}

function citationMarkup(citation, index) {
  const label = citation.label || `依据 ${index + 1}`;
  const text = citation.text ? `<span>${escapeReaderHTML(citation.text)}</span>` : '';
  const link = citation.url ? `<a href="${escapeReaderHTML(citation.url)}" target="_blank" rel="noopener noreferrer">${escapeReaderHTML(label)}</a>` : `<span>${escapeReaderHTML(label)}</span>`;
  return `<li data-reader-citation="${index}">${link}${text}</li>`;
}

function tabsMarkup(model) {
  return `<div class="attention-reader-tabs" role="tablist" aria-label="阅读层次">
    ${READER_TABS.map(tab => {
      const lane = model.lanes[tab];
      const selected = model.activeTab === tab;
      return `<button type="button" class="attention-reader-tab attention-reader-tab--${tab}" data-reader-tab="${tab}" role="tab" aria-selected="${selected}" aria-controls="attention-reader-lane-${tab}" tabindex="${selected ? '0' : '-1'}">${escapeReaderHTML(lane.label)}</button>`;
    }).join('')}
  </div>`;
}

function originalLaneMarkup(model) {
  const lane = model.lanes.original;
  const source = model.source;
  const sections = [
    originalSection('full', '全文', lane.fullText, 'attention-reader-original-section--full', true),
    originalSection('fragment', '片段', lane.fragmentText, 'attention-reader-original-section--fragment', true),
    originalSection('summary', '摘要', lane.summaryText, 'attention-reader-original-section--summary', true),
    originalSection('user-excerpt', '用户摘录', lane.userExcerpt, 'attention-reader-original-section--user-excerpt', true),
  ].join('');
  const hasSnapshot = Boolean(lane.fullText || lane.fragmentText || lane.summaryText || lane.userExcerpt);
  let body = '';
  if (lane.status === 'loading') body = statusBlock({kind: 'loading', label: '正在核验原文…'}) + (hasSnapshot ? sections : '');
  else if (lane.status === 'error' || lane.status === 'unavailable') body = statusBlock({kind: lane.status, label: model.source.sourceStatus === 'denied' ? '来源未获授权，已保留允许显示的摘录。' : model.source.sourceStatus === 'changed' ? '来源已变化，已保留当前快照。' : lane.status === 'unavailable' ? '来源暂不可用，已保留允许显示的摘录。' : '原文暂时无法读取。'}, `<button type="button" class="attention-reader-button attention-reader-button--subtle" data-reader-action="retry-source">重试来源</button>`) + (hasSnapshot ? sections : '');
  else if (lane.status === 'empty') body = statusBlock({kind: 'empty', label: '还没有可显示的原文摘录。可以粘贴自己的材料。'});
  else body = sections;
  const selection = model.selection;
  const selectionMarkup = selection?.quote
    ? `<div class="attention-reader-selection" data-reader-selection="active"><span>已选原文</span><q>${escapeReaderHTML(selection.quote)}</q><button type="button" class="attention-reader-button attention-reader-button--text" data-reader-action="clear-selection">清除选区</button></div>`
    : `<p class="attention-reader-selection-hint" data-reader-selection="empty">可在原文中选中一句，再用这份材料作对照。</p>`;
  return `<section id="attention-reader-lane-original" class="attention-reader-lane attention-reader-lane--original" data-canvas-lane="original" aria-label="${escapeReaderHTML(lane.ariaLabel)}" role="tabpanel" data-reader-lane="original" tabindex="0">
    <div class="attention-reader-lane-heading"><div><span class="attention-reader-eyebrow">原文优先</span><h2>${escapeReaderHTML(source.title)}</h2></div><span class="attention-reader-readonly">只读</span></div>
    <p class="attention-reader-source-meta"><span data-reader-source-status="${escapeReaderHTML(source.sourceStatus)}">${escapeReaderHTML(source.sourceKind)}</span>${source.author ? ` · ${escapeReaderHTML(source.author)}` : ''}${source.capturedAt ? ` · ${escapeReaderHTML(source.capturedAt)}` : ''} · ${escapeReaderHTML(source.sourceStatus)}</p>
    <div class="attention-reader-original-body" data-reader-original-body tabindex="0" aria-label="原文正文">${body}</div>
    ${selectionMarkup}
    <div class="attention-reader-original-actions">${sourceLink(source)}<button type="button" class="attention-reader-button attention-reader-button--primary" data-reader-action="compare-selection" ${selection?.quote ? '' : 'disabled'}>用这份材料作对照</button></div>
  </section>`;
}

function userLaneMarkup(model) {
  const lane = model.lanes.user;
  const save = model.save;
  const statusLabel = lane.status === 'draft' ? '草稿 · 尚未保存' : lane.status === 'saved' ? `已保存${lane.revision != null ? ` · v${escapeReaderHTML(lane.revision)}` : ''}` : '尚未写下理解';
  return `<section id="attention-reader-lane-user" class="attention-reader-lane attention-reader-lane--user" data-canvas-lane="user" aria-label="${escapeReaderHTML(lane.ariaLabel)}" role="tabpanel" data-reader-lane="user" tabindex="0">
    <div class="attention-reader-lane-heading"><div><span class="attention-reader-eyebrow">用户层</span><h2>我的理解</h2></div><span class="attention-reader-lane-status attention-reader-lane-status--${lane.status}">${statusLabel}</span></div>
    ${lane.stop ? `<p class="attention-reader-stop"><strong>未决停点</strong>${escapeReaderHTML(lane.stop)}</p>` : ''}
    ${lane.savedText ? `<section class="attention-reader-saved-understanding"><h3>当前已保存理解</h3><p>${escapeReaderHTML(lane.savedText)}</p></section>` : `<p class="attention-reader-empty-copy">尚未写下理解。原文和 Agent 建议不会自动填入这里。</p>`}
    <label class="attention-reader-draft-label" for="attention-reader-user-draft">写下我的理解（草稿）</label>
    <textarea id="attention-reader-user-draft" class="attention-reader-draft" data-reader-user-draft data-reader-draft-key="${escapeReaderHTML(model.returnFocusKey || model.source.id || '')}" aria-label="我的理解" placeholder="只写下你自己的理解……">${escapeReaderHTML(lane.draft)}</textarea>
    ${save.status === 'saving' ? statusBlock({kind: 'loading', label: '正在保存草稿…'}) : save.status === 'error' ? statusBlock({kind: 'error', label: '草稿尚未保存。'}, `<span class="attention-reader-status-detail">${escapeReaderHTML(save.error)}</span><button type="button" class="attention-reader-button attention-reader-button--subtle" data-reader-action="save-user-draft">重试保存</button>`) : save.status === 'stale' ? statusBlock({kind: 'error', label: '这份理解已被另一版本更新。'}, '<span class="attention-reader-status-detail">请重新载入当前版本，再选择要保留的草稿。</span>') : ''}
    <p class="attention-reader-draft-note" data-reader-draft-status>${save.status === 'error' ? '保存失败，草稿仍保留。' : save.status === 'stale' ? '当前版本发生变化，未覆盖任何内容。' : lane.status === 'draft' ? '草稿尚未保存。' : '保存前只留在本次阅读中。'}</p>
    <div class="attention-reader-user-actions"><button type="button" class="attention-reader-button attention-reader-button--primary" data-reader-action="save-user-draft" ${readerDraftCanSave(lane.draft, save.status) ? '' : 'disabled'}>${save.status === 'saving' ? '保存中…' : '保存我的理解'}</button></div>
  </section>`;
}

function agentStatusMarkup(lane) {
  switch (lane.status) {
    case 'running': return statusBlock({kind: 'loading', label: '正在生成 Agent 解读…'}, `<span class="attention-reader-status-detail">${escapeReaderHTML(lane.purpose || '仅基于当前原文选区')}</span><button type="button" class="attention-reader-button attention-reader-button--subtle" data-reader-action="cancel-agent">取消生成</button>`);
    case 'error': return statusBlock({kind: 'error', label: 'Agent 解读失败，原文和你的草稿仍保留。'}, `<span class="attention-reader-status-detail">${escapeReaderHTML(lane.error)}</span><button type="button" class="attention-reader-button attention-reader-button--subtle" data-reader-action="retry-agent">重试解读</button>`);
    case 'unavailable': return statusBlock({kind: 'unavailable', label: '尚未连接 Agent；可以先自己写或手工对照。'}, `<button type="button" class="attention-reader-button attention-reader-button--subtle" data-reader-action="retry-agent">稍后重试</button>`);
    case 'stale': return statusBlock({kind: 'error', label: '这份 Agent 解读已过期，请重新选择原文。'});
    case 'empty': return statusBlock({kind: 'empty', label: '没有贴切的候选解读。可以调整选区或带入自己的材料。'});
    case 'not-requested': return statusBlock({kind: 'empty', label: '尚未请求 Agent 解读。'});
    default: return '';
  }
}

function agentLaneMarkup(model) {
  const lane = model.lanes.agent;
  const expanded = lane.expanded;
  let detail = '';
  if (expanded) {
    detail = `${lane.output ? `<div class="attention-reader-agent-output" data-reader-agent-output aria-live="polite"><p>${escapeReaderHTML(lane.output)}</p></div>` : ''}${lane.candidates.length ? `<div class="attention-reader-agent-candidates" data-reader-agent-candidates>${lane.candidates.map((candidate, index) => `<article class="attention-reader-agent-candidate" data-agent-candidate-id="${escapeReaderHTML(candidate.id || index)}"><span class="attention-reader-candidate-label">${escapeReaderHTML(candidate.label || '候选解读')} · 待确认</span><p>${escapeReaderHTML(candidate.text)}</p><div><button type="button" class="attention-reader-button attention-reader-button--subtle" data-reader-action="copy-agent-to-draft" data-agent-candidate-index="${index}" aria-pressed="false">复制为我的草稿</button><button type="button" class="attention-reader-button attention-reader-button--text" data-reader-action="adopt-agent" data-agent-candidate-index="${index}" aria-pressed="false">采纳这一处</button></div></article>`).join('')}</div>` : ''}${lane.citations.length ? `<section class="attention-reader-citations"><h3>依据与来源</h3><ul>${lane.citations.map(citationMarkup).join('')}</ul></section>` : ''}`;
  }
  const collapsed = lane.status === 'ready' || lane.output || lane.candidates.length
    ? `<p class="attention-reader-agent-collapsed-copy">有一份候选解读，展开后查看。候选不会自动成为我的理解。</p>`
    : '';
  return `<section id="attention-reader-lane-agent" class="attention-reader-lane attention-reader-lane--agent" data-canvas-lane="agent" aria-label="${escapeReaderHTML(lane.ariaLabel)}" role="tabpanel" data-reader-lane="agent" tabindex="0">
    <div class="attention-reader-lane-heading"><div><span class="attention-reader-eyebrow">辅助层</span><h2>Agent 解读</h2></div><span class="attention-reader-lane-status attention-reader-lane-status--${escapeReaderHTML(lane.status)}">${escapeReaderHTML(lane.status === 'not-requested' ? '尚未请求' : lane.status === 'ready' ? '候选 · 待确认' : lane.status)}</span></div>
    <p class="attention-reader-agent-boundary">候选建议 · 不会写入我的理解，也不会确认关系</p>
    ${agentStatusMarkup(lane)}
    ${expanded ? detail : collapsed}
    <button type="button" class="attention-reader-button attention-reader-agent-toggle" data-reader-action="toggle-agent" aria-expanded="${expanded}">${expanded ? '收起 Agent 解读' : '展开 Agent 解读'}</button>
    ${lane.status === 'not-requested' || lane.status === 'idle' ? '<button type="button" class="attention-reader-button attention-reader-button--subtle" data-reader-action="request-agent">请求这处解读</button>' : ''}
  </section>`;
}

function compareMarkup(model) {
  const anchor = model.selection;
  const lane = model.lanes;
  const agentDetail = lane.agent.expanded
    ? `<p>${escapeReaderHTML(lane.agent.output || lane.agent.candidates[0]?.text || '尚未请求')}</p><span>候选 · 待确认</span>`
    : '<p class="attention-reader-agent-collapsed-copy">Agent 解读已准备好，展开后查看；候选不会自动成为我的理解。</p><span>需要显式展开</span>';
  return `<section class="attention-reader-compare" data-reader-compare="selection" aria-label="选区对照">
    <div class="attention-reader-compare-selection"><span class="attention-reader-eyebrow">已选原文 · 待确认</span><q>${escapeReaderHTML(anchor?.quote || '尚未选择原文。')}</q><p>${anchor?.sourceId ? `来源 ${escapeReaderHTML(anchor.sourceId)}` : '当前来源'}</p></div>
    <div class="attention-reader-compare-lanes">
      <section class="attention-reader-compare-lane attention-reader-compare-lane--original" data-canvas-lane="original" aria-label="原文与原现场，只读"><h2>原文</h2><p>${escapeReaderHTML(anchor?.quote || lane.original.fragmentText || lane.original.fullText || '暂无选区')}</p><span>只读 · 不会被覆盖</span></section>
      <span class="attention-reader-compare-arrow" aria-hidden="true">↔</span>
      <section class="attention-reader-compare-lane attention-reader-compare-lane--user" data-canvas-lane="user" aria-label="我的理解"><h2>我的理解</h2><textarea data-reader-user-draft data-reader-draft-key="${escapeReaderHTML(model.returnFocusKey || model.source.id || '')}" aria-label="我的理解" placeholder="写下你自己的理解……">${escapeReaderHTML(lane.user.draft)}</textarea><span>${lane.user.draft.trim() ? '草稿 · 尚未保存' : '尚未写下理解'}</span></section>
      <span class="attention-reader-compare-arrow" aria-hidden="true">↔</span>
      <section class="attention-reader-compare-lane attention-reader-compare-lane--agent" data-canvas-lane="agent" aria-label="Agent 解读与建议"><h2>Agent 解读</h2>${agentDetail}<button type="button" class="attention-reader-button attention-reader-button--text" data-reader-action="toggle-agent" aria-expanded="${lane.agent.expanded}">${lane.agent.expanded ? '收起依据' : '展开依据'}</button></section>
    </div>
    <p class="attention-reader-compare-boundary" role="note">请确认两种理解是否符合你的预期。保存对照只记录关系，不会自动采纳 Agent 解读。</p>
    <footer class="attention-reader-compare-actions"><button type="button" class="attention-reader-button attention-reader-button--text" data-reader-action="close">暂不保存</button><button type="button" class="attention-reader-button attention-reader-button--primary" data-reader-action="save-compare">保存对照</button></footer>
  </section>`;
}

/** Return escaped HTML only; no DOM/global window is needed for this function. */
export function renderReaderMarkup(stateInput = {}, options = {}) {
  const model = projectReader(stateInput);
  if (!model.open) return '';
  const title = options.title || '原文阅读';
  const content = model.mode === 'compare' ? compareMarkup(model) : `${originalLaneMarkup(model)}${userLaneMarkup(model)}${agentLaneMarkup(model)}`;
  return `<div class="attention-reader-scrim" data-reader-scrim="true" aria-hidden="true"></div><aside class="attention-reader attention-reader--${model.mode}" data-attention-reader data-reader-mode="${model.mode}" data-reader-frame="${model.mode === 'compare' ? '04-compare-selection' : '03-reader-open'}" data-reader-active-tab="${model.activeTab}" role="dialog" aria-modal="true" aria-labelledby="attention-reader-heading" tabindex="-1"><header class="attention-reader-header"><div><span class="attention-reader-eyebrow">${escapeReaderHTML(model.mode === 'compare' ? '选区对照' : '原文阅读')}</span><h1 id="attention-reader-heading">${escapeReaderHTML(title)}</h1></div><button type="button" class="attention-reader-close" data-reader-action="close" aria-label="关闭原文阅读">×</button></header>${model.mode === 'source' ? tabsMarkup(model) : ''}<div class="attention-reader-scroll" data-reader-scroll>${content}</div>${model.notice ? `<div class="attention-reader-notice" role="${model.notice.kind === 'error' ? 'alert' : 'status'}">${escapeReaderHTML(model.notice.message || '')}</div>` : ''}</aside>`;
}

function eventEnvelope(type, payload, state) {
  return {
    type,
    payload: payload && typeof payload === 'object' ? {...payload} : {},
    reader: {
      matterId: state.matterId,
      focus: state.focus,
      sourceId: state.sourceId,
      mode: state.mode,
      selectedAnchor: state.selectedAnchor,
      contextMode: state.contextMode,
      contextEpoch: state.contextEpoch,
      draftKey: state.draftKey,
      beforeClose: state.beforeClose,
    },
  };
}

function isTextEntry(target) {
  if (!target || typeof target !== 'object') return false;
  const tag = asText(target.tagName).toLowerCase();
  return tag === 'textarea' || tag === 'input' || target.isContentEditable === true;
}

function safeFocus(element) {
  if (!element || typeof element.focus !== 'function') return false;
  if (typeof element.isConnected === 'boolean' && !element.isConnected) return false;
  const tag = asText(element.tagName).toLowerCase();
  if (tag === 'body' || tag === 'html') return false;
  if (element.closest?.('[inert], [aria-hidden="true"]')) return false;
  try { element.focus({preventScroll: true}); } catch { try { element.focus(); } catch { return false; } }
  return true;
}

function selectionAnchorFromDOM(doc, root, sourceId) {
  const selection = doc?.getSelection?.();
  if (!selection || selection.rangeCount === 0 || !selection.toString().trim()) return null;
  const body = root.querySelector?.('[data-reader-original-body]');
  if (!body) return null;
  const range = selection.getRangeAt(0);
  if (!body.contains(range.commonAncestorContainer)) return null;
  const quote = selection.toString();
  const before = doc.createRange?.();
  if (!before) return createSelectionAnchor({sourceId, quote});
  before.selectNodeContents(body);
  try { before.setEnd(range.startContainer, range.startOffset); } catch { return createSelectionAnchor({sourceId, quote}); }
  const start = before.toString().length;
  return createSelectionAnchor({sourceId, quote, start, end: start + quote.length});
}

/**
 * Mount the optional DOM adapter.  All writes are local to `root`; the only
 * outward side effect is a structured event sent to `onEvent`/`onAction`.
 */
export function mountAttentionReader({
  root,
  state = {},
  source,
  onEvent,
  onAction,
  document: documentOption,
  returnFocus,
  title = '原文阅读',
} = {}) {
  if (!root || typeof root !== 'object') throw new TypeError('mountAttentionReader requires a root element');
  const doc = documentOption || root.ownerDocument || globalThis.document;
  if (!doc) throw new TypeError('mountAttentionReader requires a document');
  let current = createReaderState({...state, source: source ?? state.source, open: state.open ?? false});
  let disposed = false;
  let triggerElement = returnFocus || null;
  let lastRenderedOpen = false;
  let bindingsInstalled = false;
  const abort = new AbortController();
  let modalKeydownAbort = null;
  let backgroundState = [];
  const listen = (target, type, handler, options = {}) => target?.addEventListener?.(type, handler, {...options, signal: abort.signal});
  const notify = (type, payload = {}) => {
    if (disposed) return;
    const event = eventEnvelope(type, payload, current);
    if (typeof onEvent === 'function') onEvent(event);
    else if (typeof onAction === 'function') onAction(event);
  };
  const findAction = target => target?.closest?.('[data-reader-action]');
  if (current.open && !triggerElement && doc.activeElement && !root.contains(doc.activeElement)) triggerElement = doc.activeElement;

  const focusableSelector = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'textarea:not([disabled])', 'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  const readerFocusables = () => {
    const dialog = root.querySelector?.('[data-attention-reader]');
    if (!dialog) return [];
    return Array.from(dialog.querySelectorAll?.(focusableSelector) ?? []).filter(element => {
      if (element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
      const style = doc.defaultView?.getComputedStyle?.(element);
      return style?.display !== 'none' && style?.visibility !== 'hidden';
    });
  };
  const setBackgroundModalState = active => {
    if (active) {
      if (backgroundState.length) return;
      const parent = root.parentElement;
      backgroundState = Array.from(parent?.children ?? []).filter(element => element !== root).map(element => ({
        element,
        ariaHidden: element.getAttribute?.('aria-hidden'),
        inert: Boolean(element.inert),
        hadInertAttribute: element.hasAttribute?.('inert') ?? false,
      }));
      for (const item of backgroundState) {
        item.element.setAttribute?.('aria-hidden', 'true');
        if ('inert' in item.element) item.element.inert = true;
        else item.element.setAttribute?.('inert', '');
      }
      return;
    }
    for (const item of backgroundState) {
      if (item.ariaHidden == null) item.element.removeAttribute?.('aria-hidden');
      else item.element.setAttribute?.('aria-hidden', item.ariaHidden);
      if ('inert' in item.element) item.element.inert = item.inert;
      else if (!item.hadInertAttribute) item.element.removeAttribute?.('inert');
    }
    backgroundState = [];
  };
  const restoreFocus = () => {
    const fallback = doc.querySelector?.('[data-canvas-root]') || root;
    const preferred = triggerElement && !root.contains?.(triggerElement) ? triggerElement : null;
    const restore = () => safeFocus(preferred) || safeFocus(fallback);
    if (!restore()) {
      const retry = () => { restore(); };
      if (typeof doc.defaultView?.requestAnimationFrame === 'function') doc.defaultView.requestAnimationFrame(retry);
      else if (typeof globalThis.queueMicrotask === 'function') globalThis.queueMicrotask(retry);
    }
    triggerElement = null;
  };
  const installModalKeydown = () => {
    if (modalKeydownAbort || !doc.addEventListener) return;
    modalKeydownAbort = new AbortController();
    doc.addEventListener('keydown', event => {
      if (!current.open || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        const previous = current;
        dispatch({type: 'CLOSE'}, {emit: false});
        if (previous.open) notify('READER_CLOSED', {reason: 'escape', returnFocusKey: previous.returnFocusKey, beforeClose: previous.beforeClose, selectedAnchor: previous.selectedAnchor});
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = readerFocusables();
      if (!focusables.length) return;
      const active = doc.activeElement;
      const currentIndex = focusables.indexOf(active);
      const step = event.shiftKey ? -1 : 1;
      const nextIndex = currentIndex < 0
        ? (event.shiftKey ? focusables.length - 1 : 0)
        : (currentIndex + step + focusables.length) % focusables.length;
      event.preventDefault();
      event.stopPropagation();
      safeFocus(focusables[nextIndex]);
    }, {capture: true, signal: modalKeydownAbort.signal});
  };
  const removeModalKeydown = () => {
    modalKeydownAbort?.abort();
    modalKeydownAbort = null;
  };

  const render = (focusTarget = null) => {
    if (disposed) return;
    root.classList.add('attention-reader-host');
    root.dataset.readerOpen = String(current.open);
    root.dataset.readerMode = current.mode;
    root.dataset.readerFrame = readerFrame(current);
    root.innerHTML = renderReaderMarkup(current, {title});
    if (!current.open) {
      removeModalKeydown();
      setBackgroundModalState(false);
      lastRenderedOpen = false;
      return;
    }
    lastRenderedOpen = true;
    setBackgroundModalState(true);
    installModalKeydown();
    if (!bindingsInstalled) {
      bindRenderedEvents();
      bindingsInstalled = true;
    }
    if (focusTarget) safeFocus(root.querySelector(focusTarget));
  };

  // Re-rendering a live projection replaces the reader's inner DOM.  Capture
  // the small set of focusable identities that can survive that replacement
  // so an external update does not throw an editor back to BODY.
  const focusSelector = () => {
    if (!current.open || !root.contains?.(doc.activeElement)) return null;
    const active = doc.activeElement;
    if (active?.matches?.('[data-reader-user-draft]')) return '[data-reader-user-draft]';
    if (active?.matches?.('[data-reader-action]')) {
      const action = active.getAttribute?.('data-reader-action');
      return action ? `[data-reader-action="${action}"]` : null;
    }
    if (active?.matches?.('[data-reader-tab]')) {
      const tab = active.getAttribute?.('data-reader-tab');
      return tab ? `[data-reader-tab="${tab}"]` : null;
    }
    return '[data-attention-reader]';
  };

  const dispatch = (event, {emit = true, focusTarget = null} = {}) => {
    if (disposed) return current;
    const type = asText(event?.type || event?.action).toUpperCase();
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : event || {};
    if (type === 'OPEN' || type === 'OPEN_SOURCE' || type === 'READER_OPEN' || type === 'READER_OPEN_SOURCE') {
      const explicitTrigger = payload.returnFocusElement || payload.returnFocus;
      if (explicitTrigger && typeof explicitTrigger.focus === 'function') triggerElement = explicitTrigger;
      else if (!triggerElement && doc.activeElement && !root.contains(doc.activeElement)) triggerElement = doc.activeElement;
    }
    if (type === 'CLOSE' || type === 'READER_CLOSE' || type === 'READER_CLOSED') {
      if (emit) notify('READER_CLOSE_REQUESTED', {returnFocusKey: current.returnFocusKey, selectedAnchor: current.selectedAnchor});
    }
    const wasOpen = current.open;
    current = reduceReaderState(current, {type, payload});
    if (emit && !['READER_CLOSE_REQUESTED'].includes(type)) {
      const outwardType = type.startsWith('READER_') ? type : `READER_${type}`;
      notify(outwardType, payload);
    }
    render(focusTarget || (!wasOpen && current.open ? '[data-reader-action="close"]' : null));
    if (wasOpen && !current.open) restoreFocus();
    return current;
  };

  function updateDraftFromTarget(target) {
    const text = asText(target?.value);
    current = reduceReaderState(current, {type: 'SET_USER_DRAFT', payload: {text}});
    if (root.querySelectorAll) root.querySelectorAll('[data-reader-user-draft]').forEach(field => { if (field !== target && field.value !== text) field.value = text; });
    // The reader keeps its DOM mounted while the user types.  Updating only
    // the status copy left the primary save button with the disabled state it
    // received during the previous render until the user changed tabs.  Keep
    // all save controls in sync with the local draft without re-rendering the
    // editor (which would steal the caret and IME composition state).
    const canSave = readerDraftCanSave(text, current.saveStatus);
    root.querySelectorAll?.('[data-reader-action="save-user-draft"]').forEach(button => {
      button.disabled = !canSave;
    });
    const status = root.querySelector('[data-reader-draft-status]');
    if (status) status.textContent = '草稿尚未保存。';
    notify('READER_USER_DRAFT_CHANGED', {matterId: current.matterId, text, sourceId: current.sourceId, anchor: current.selectedAnchor, draftKey: current.draftKey, contextMode: current.contextMode, contextEpoch: current.contextEpoch});
  }

  function bindRenderedEvents() {
    listen(root, 'click', event => {
      const actionElement = findAction(event.target);
      const tab = event.target?.closest?.('[data-reader-tab]');
      const sourceLinkElement = event.target?.closest?.('[data-reader-source-link]');
      const scrim = event.target?.closest?.('[data-reader-scrim]');
      if (scrim) {
        const previous = current;
        dispatch({type: 'CLOSE'}, {emit: false});
        if (previous.open) notify('READER_CLOSED', {reason: 'scrim', returnFocusKey: current.returnFocusKey, beforeClose: current.beforeClose, selectedAnchor: current.selectedAnchor});
        return;
      }
      if (tab) {
        const value = tab.getAttribute('data-reader-tab');
        current = reduceReaderState(current, {type: 'SELECT_TAB', payload: {tab: value}});
        notify('READER_TAB_SELECTED', {tab: value});
        render(`[data-reader-tab="${value}"]`);
        return;
      }
      if (sourceLinkElement) {
        notify('READER_SOURCE_LINK_ACTIVATED', {sourceId: current.sourceId, url: current.source.safeUrl});
        return;
      }
      if (!actionElement) return;
      const action = actionElement.getAttribute('data-reader-action');
      if (action === 'close') {
        dispatch({type: 'CLOSE'}, {emit: false});
        notify('READER_CLOSED', {returnFocusKey: current.returnFocusKey, beforeClose: current.beforeClose, selectedAnchor: current.selectedAnchor});
        return;
      }
      if (action === 'toggle-agent') {
        const expanded = !current.agentExpanded;
        dispatch({type: 'TOGGLE_AGENT', payload: {expanded}}, {emit: false, focusTarget: '[data-reader-action="toggle-agent"]'});
        notify('READER_AGENT_TOGGLED', {expanded});
        return;
      }
      if (action === 'compare-selection') {
        const anchor = current.selectedAnchor;
        if (!anchor?.quote) return;
        dispatch({type: 'OPEN_COMPARE', payload: {anchor}}, {emit: false, focusTarget: '[data-reader-action="save-compare"]'});
        notify('READER_COMPARE_REQUESTED', {sourceId: current.sourceId, anchor});
        return;
      }
      if (action === 'clear-selection') {
        dispatch({type: 'CLEAR_SELECTION'}, {emit: false});
        notify('READER_SELECTION_CLEARED', {});
        return;
      }
      if (action === 'save-user-draft') {
        notify('READER_USER_DRAFT_SAVE_REQUESTED', {matterId: current.matterId, text: current.userDraft, sourceId: current.sourceId, anchor: current.selectedAnchor, draftKey: current.draftKey, contextMode: current.contextMode, contextEpoch: current.contextEpoch});
        return;
      }
      if (action === 'save-compare') {
        notify('READER_COMPARE_SAVE_REQUESTED', {matterId: current.matterId, sourceId: current.sourceId, anchor: current.selectedAnchor, userDraft: current.userDraft, draftKey: current.draftKey});
        return;
      }
      if (action === 'copy-agent-to-draft') {
        const index = Number(actionElement.getAttribute('data-agent-candidate-index'));
        const candidate = Number.isInteger(index) ? current.agent.candidates[index] : null;
        const text = candidate?.text || current.agent.output;
        dispatch({type: 'COPY_AGENT_TO_DRAFT', payload: {text}}, {emit: false, focusTarget: '[data-reader-user-draft]'});
        notify('READER_AGENT_COPIED_TO_DRAFT', {text, proposalId: candidate?.id || null});
        return;
      }
      if (action === 'adopt-agent') {
        const index = Number(actionElement.getAttribute('data-agent-candidate-index'));
        const candidate = Number.isInteger(index) ? current.agent.candidates[index] : null;
        notify('READER_AGENT_ADOPT_REQUESTED', {proposalId: candidate?.id || null, patchHash: candidate?.patchHash || null, text: candidate?.text || current.agent.output, baseRevision: current.user.revision, targetAnchor: current.selectedAnchor, anchor: current.selectedAnchor});
        return;
      }
      if (action === 'request-agent') {
        notify('READER_AGENT_REQUESTED', {matterId: current.matterId, sourceId: current.sourceId, anchor: current.selectedAnchor, targetRevision: current.user.revision, contextMode: current.contextMode, contextEpoch: current.contextEpoch, draftKey: current.draftKey});
        return;
      }
      if (action === 'cancel-agent') {
        notify('READER_AGENT_CANCEL_REQUESTED', {requestId: current.agent.requestId, sourceId: current.sourceId});
        return;
      }
      if (action === 'retry-agent') {
        notify('READER_AGENT_RETRY_REQUESTED', {sourceId: current.sourceId, anchor: current.selectedAnchor});
        return;
      }
      if (action === 'retry-source') {
        notify('READER_SOURCE_RETRY_REQUESTED', {sourceId: current.sourceId, locator: current.source.locator});
      }
    });
    listen(root, 'input', event => {
      if (event.target?.matches?.('[data-reader-user-draft]')) updateDraftFromTarget(event.target);
    });
    listen(root, 'keydown', event => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape' && !isTextEntry(event.target)) {
        event.preventDefault();
        if (current.open) {
          dispatch({type: 'CLOSE'}, {emit: false});
          notify('READER_CLOSED', {reason: 'escape', returnFocusKey: current.returnFocusKey, beforeClose: current.beforeClose, selectedAnchor: current.selectedAnchor});
        }
        return;
      }
      if (event.key === 'Escape' && event.target?.matches?.('[data-reader-user-draft]')) return;
      if (event.key === 'Enter' && event.target?.matches?.('[data-reader-user-draft]') && !event.shiftKey) {
        event.preventDefault();
        notify('READER_USER_DRAFT_SAVE_REQUESTED', {matterId: current.matterId, text: current.userDraft, sourceId: current.sourceId, anchor: current.selectedAnchor, draftKey: current.draftKey, contextMode: current.contextMode, contextEpoch: current.contextEpoch});
      }
      if ((event.key === 'Tab' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') && event.target?.matches?.('[data-reader-tab]')) {
        const index = READER_TABS.indexOf(event.target.getAttribute('data-reader-tab'));
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const step = event.key === 'ArrowLeft' ? -1 : 1;
          const next = READER_TABS[(index + step + READER_TABS.length) % READER_TABS.length];
          current = reduceReaderState(current, {type: 'SELECT_TAB', payload: {tab: next}});
          notify('READER_TAB_SELECTED', {tab: next});
          render(`[data-reader-tab="${next}"]`);
        }
      }
    });
    listen(doc, 'selectionchange', () => {
      const anchor = selectionAnchorFromDOM(doc, root, current.sourceId);
      if (!anchor || !anchor.quote.trim()) return;
      current = reduceReaderState(current, {type: 'SET_SELECTION', payload: {anchor}});
      const button = root.querySelector('[data-reader-action="compare-selection"]');
      if (button) { button.disabled = false; }
      const selection = root.querySelector('[data-reader-selection]');
      if (selection) {
        selection.dataset.readerSelection = 'active';
        selection.innerHTML = `<span>已选原文</span><q>${escapeReaderHTML(anchor.quote)}</q><button type="button" class="attention-reader-button attention-reader-button--text" data-reader-action="clear-selection">清除选区</button>`;
      }
      notify('READER_SELECTION_ANCHOR_CHANGED', {anchor, sourceId: current.sourceId});
    });
  }

  render(current.open ? '[data-reader-action="close"]' : null);
  return {
    getState: () => current,
    getModel: () => projectReader(current),
    dispatch,
    open: (next = {}) => dispatch({type: 'OPEN_SOURCE', payload: {...next, open: true}}),
    openCompare: (anchor, next = {}) => dispatch({type: 'OPEN_COMPARE', payload: {...next, anchor, open: true}}),
    close: () => {
      const previous = current;
      dispatch({type: 'CLOSE'}, {emit: false});
      if (previous.open) notify('READER_CLOSED', {reason: 'api', returnFocusKey: current.returnFocusKey, beforeClose: current.beforeClose, selectedAnchor: current.selectedAnchor});
      return current;
    },
    update: next => {
      const patch = next && typeof next === 'object' ? next : {};
      const wasOpen = current.open;
      const preserveLocal = wasOpen && patch.preserveLocal !== false;
      const previousFocusSelector = preserveLocal ? focusSelector() : null;
      if (!wasOpen && patch.open) {
        const explicitTrigger = patch.returnFocusElement || patch.returnFocus;
        if (explicitTrigger && typeof explicitTrigger.focus === 'function') triggerElement = explicitTrigger;
        else if (!triggerElement && doc.activeElement && !root.contains(doc.activeElement)) triggerElement = doc.activeElement;
      }
      const patchSourceId = patch.sourceId ?? patch.source?.id ?? patch.source?.sourceId ?? current.sourceId;
      const contextChanged = patchSourceId !== current.sourceId || patch.matterId != null && patch.matterId !== current.matterId;
      const hasUserDraftPatch = Object.prototype.hasOwnProperty.call(patch, 'userDraft');
      const nextUserDraft = hasUserDraftPatch
        ? asText(patch.userDraft)
        : preserveLocal
          ? current.userDraft
          : asText(patch.user?.draft ?? current.userDraft);
      const nextActiveTab = Object.prototype.hasOwnProperty.call(patch, 'activeTab')
        ? patch.activeTab
        : current.activeTab;
      const nextAgentExpanded = Object.prototype.hasOwnProperty.call(patch, 'agentExpanded')
        ? bool(patch.agentExpanded)
        : preserveLocal
          ? current.agentExpanded
          : bool(patch.agent?.expanded ?? current.agentExpanded);
      const nextMode = contextChanged && preserveLocal
        ? 'source'
        : Object.prototype.hasOwnProperty.call(patch, 'mode') ? patch.mode : current.mode;
      const nextAnchor = contextChanged && preserveLocal
        ? null
        : Object.prototype.hasOwnProperty.call(patch, 'selectedAnchor')
          ? patch.selectedAnchor
          : Object.prototype.hasOwnProperty.call(patch, 'selection')
            ? patch.selection
            : current.selectedAnchor;
      const nextUser = patch.user
        ? {...current.user, ...patch.user, draft: nextUserDraft}
        : {...current.user, draft: nextUserDraft};
      const nextAgent = patch.agent
        ? {...current.agent, ...patch.agent, expanded: nextAgentExpanded}
        : {...current.agent, expanded: nextAgentExpanded};
      current = createReaderState({
        ...current,
        ...patch,
        open: patch.open ?? current.open,
        mode: nextMode,
        matterId: patch.matterId ?? current.matterId,
        focus: patch.focus ?? current.focus,
        activeTab: nextActiveTab,
        source: patch.source ?? current.source,
        sourceId: patch.sourceId ?? patch.source?.id ?? patch.source?.sourceId ?? current.sourceId,
        selectedAnchor: nextAnchor,
        user: nextUser,
        userDraft: nextUserDraft,
        agent: nextAgent,
        agentStatus: patch.agentStatus ?? current.agentStatus,
        agentExpanded: nextAgentExpanded,
        sourceStatus: patch.sourceStatus ?? current.sourceStatus,
        saveStatus: patch.saveStatus ?? current.saveStatus,
        saveError: patch.saveError ?? current.saveError,
        contextEpoch: patch.contextEpoch ?? current.contextEpoch,
        draftKey: patch.draftKey ?? current.draftKey,
      });
      render(!wasOpen && current.open ? '[data-reader-action="close"]' : (current.open ? previousFocusSelector : null));
      if (wasOpen && !current.open) restoreFocus();
      return current;
    },
    destroy: () => { disposed = true; removeModalKeydown(); setBackgroundModalState(false); abort.abort(); root.replaceChildren?.(); root.classList.remove('attention-reader-host'); },
  };
}

// Friendly aliases for hosts that prefer the shorter names.
export const reduceAttentionReader = reduceReaderState;
export const renderAttentionReader = renderReaderMarkup;
export const createAttentionReaderState = createReaderState;
export const projectAttentionReader = projectReader;
export const renderReaderModel = projectReader;
export const mountAttentionReaderRail = mountAttentionReader;
export const getReaderFrame = readerFrame;

export default Object.freeze({
  READER_LANES,
  READER_MODES,
  READER_TABS,
  READER_EVENTS,
  safeSourceUrl,
  createSelectionAnchor,
  createReaderState,
  reduceReaderState,
  projectReader,
  readerFrame,
  renderReaderMarkup,
  mountAttentionReader,
});
