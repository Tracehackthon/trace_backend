/** Pure comparison session and reference host. No network, persistence, DOM, or model calls. */
export const SCREENS = Object.freeze(['search', 'candidates', 'compare', 'returned']);
export const DIRECTION_OPTIONS = Object.freeze([
  { value: 'counterexample', label: '找个反例' },
  { value: 'experience', label: '看看别人怎么做' },
  { value: 'condition', label: '换一种条件' },
]);
export const SCOPE_OPTIONS = Object.freeze([
  { value: 'prior', label: '既往思考' },
  { value: 'public', label: '知乎公开内容' },
  { value: 'authorized', label: '授权资料' },
  { value: 'imported', label: '已有材料' },
]);
export const RELATION_OPTIONS = Object.freeze([
  { value: 'limitation', label: '限制' }, { value: 'supplement', label: '补充' },
  { value: 'challenge', label: '挑战' }, { value: 'possibility', label: '另一种可能' },
  { value: 'branch', label: '旁支' },
]);
const clone = (value) => structuredClone(value);
const string = (value) => typeof value === 'string' ? value : '';
const nonempty = (value) => string(value).trim().length > 0;
const values = (options) => options.map(({ value }) => value);
const member = (options, value) => values(options).includes(value);
const DEMO_FOCUS = '收藏时必须留下自己的表达，之后才能接回来。';
const DEMO_QUESTION = '写下自己的表达，是以后接回来的必要条件吗？';
const DEMO_AFTER = '留下自己的表达，是恢复当时思考的一种方式；如果原现场能被有效恢复，也可能重新接上。';
const DEMO_UNRESOLVED = '没有持续任务时，怎样恢复当时的思考现场？';
const DEMO_CANDIDATES = [
  { id: 'demo-project', title: '没写附言，也能重新找回', kind: 'demo', sourceType: '项目实践',
    excerpt: '我没有为每次收藏写附言。再次处理同一个项目时，问题和原来的阅读现场一起被想了起来。',
    summary: '在持续的项目中，再次使用让原来的阅读现场浮现。',
    context: '本地演示材料，不对应真实文章、作者或外部搜索结果。示例处境是持续推进的同一项目，重新出现的问题成为恢复阅读现场的线索。它没有提供脱离任务时仍能恢复思考的证据。',
    url: null, scopes: ['prior', 'public'],
    relationship: { type: 'limitation', target: DEMO_FOCUS, summary: '可能限制：必须写下个人表达', reason: '可能限制“必须写下个人表达”的绝对说法；需要核对任务条件是否相同。', uncertain: '没有任务牵引时是否仍有效，尚不能说明。' },
    comparison: { same: '都在解决收藏后怎样重新使用。', different: '对方有持续的项目任务，这里还包括日常碎片阅读。', unknown: '没有任务牵引时是否仍有效。' } },
  { id: 'demo-reading', title: '写过理由，后来还是接不上', kind: 'demo', sourceType: '日常阅读',
    excerpt: '我在收藏时写了一句“这个观点很重要”，但后来仍想不起当时具体在问什么。',
    summary: '留下的是一句评价，没有留下当时的问题。',
    context: '本地演示材料。示例中的附言只是重要性评价，并未记下疑问或个人处境；它不代表所有附言都不能帮助恢复思考。',
    url: null, scopes: ['prior', 'public'],
    relationship: { type: 'supplement', target: DEMO_FOCUS, summary: '可能补充：表达里需要留下什么', reason: '可能补充：表达里需要留下什么，而不只是是否写过。', uncertain: '什么内容足以恢复思考，还需要具体情形。' },
    comparison: { same: '都尝试通过附言恢复收藏时的思考。', different: '附言只评价重要性，没有保留当时的问题。', unknown: '留下问题以后是否就一定能接回。' } },
  { id: 'demo-task', title: '任务出现后，旧收藏才有了用处', kind: 'demo', sourceType: '使用经历',
    excerpt: '等到再次遇见一个具体问题，我才开始查找旧材料；那时才知道它能参与哪一处判断。',
    summary: '重新遇到具体问题，才开始寻找旧材料。',
    context: '本地演示材料。这里描述新任务带来的重新查找，不足以证明恢复了原来的触动，也不能推断新任务出现之前材料没有价值。',
    url: null, scopes: ['prior', 'public'],
    relationship: { type: 'possibility', target: DEMO_FOCUS, summary: '可能有关：再次出现的情境', reason: '可能有关：再次出现的情境也可能成为接续入口。', uncertain: '重新找到材料与恢复原来的思考是否相同，仍未分清。' },
    comparison: { same: '都希望旧材料在以后继续起作用。', different: '这里由新任务启动寻找，不一定恢复旧问题。', unknown: '重新使用是否等于接回原来的思考。' } },
];

function boundary(text, offset) {
  if (offset <= 0 || offset >= text.length) return true;
  const left = text.charCodeAt(offset - 1), right = text.charCodeAt(offset);
  return !(left >= 0xD800 && left <= 0xDBFF && right >= 0xDC00 && right <= 0xDFFF);
}
function validFocus(text, focus) {
  return !!focus && Number.isInteger(focus.start) && Number.isInteger(focus.end) &&
    focus.start >= 0 && focus.end > focus.start && focus.end <= text.length &&
    boundary(text, focus.start) && boundary(text, focus.end) && nonempty(focus.text) &&
    text.slice(focus.start, focus.end) === focus.text;
}
function basisOf(matter) {
  return matter.basis || { field: 'understanding', objectId: `${matter.id}:understanding`, text: matter.understanding,
    contentVersion: matter.version, focus: matter.focus };
}
function basisTarget(matter) {
  const basis = basisOf(matter);
  return { field: basis.field, objectId: basis.objectId, contentVersion: basis.contentVersion, ...clone(basis.focus) };
}
function validBasis(basis) {
  return !!basis && ['originalText', 'discussion', 'understanding', 'source'].includes(basis.field) &&
    nonempty(basis.objectId) && typeof basis.text === 'string' && Number.isSafeInteger(basis.contentVersion) && basis.contentVersion >= 0 &&
    validFocus(basis.text, basis.focus);
}
function exactTarget(left, right) {
  return left?.field === right?.field && left?.start === right?.start && left?.end === right?.end && left?.text === right?.text;
}
function validMatter(matter) {
  return !!matter && nonempty(matter.id) && typeof matter.understanding === 'string' &&
    Number.isSafeInteger(matter.version) && matter.version >= 0 &&
    validBasis(basisOf(matter)) && Array.isArray(matter.links) && Array.isArray(matter.revisions);
}
function demoMatter() {
  return { id: 'demo-collection', title: '收藏后为什么接不回来', understanding: DEMO_FOCUS,
    version: 1, focus: { start: 0, end: DEMO_FOCUS.length, text: DEMO_FOCUS },
    unresolved: DEMO_UNRESOLVED, links: [], revisions: [] };
}
function normalizedCandidate(candidate, focus, fallbackId, defaultFixture = false) {
  if (!candidate || !nonempty(candidate.title) || !nonempty(candidate.excerpt)) return null;
  const kind = ['demo', 'hypothetical', 'user'].includes(candidate.kind) ? candidate.kind : 'demo';
  const relation = candidate.relationship || {};
  return {
    id: nonempty(candidate.id) ? candidate.id : fallbackId,
    title: candidate.title, kind, sourceType: string(candidate.sourceType) || (kind === 'user' ? '粘贴摘录' : '本地示例'),
    excerpt: candidate.excerpt, summary: string(candidate.summary) || candidate.excerpt,
    context: string(candidate.context) || (kind === 'user' ? '这是你主动粘贴的摘录；未读取外部原文。' : '本地演示内容，不对应真实作者或搜索结果。'),
    url: null,
    scopes: Array.isArray(candidate.scopes) ? candidate.scopes.filter((scope) => member(SCOPE_OPTIONS, scope)) : (kind === 'user' ? ['imported'] : ['prior', 'public']),
    relationship: { type: member(RELATION_OPTIONS, relation.type) ? relation.type : 'possibility', target: string(relation.target) || focus.text,
      ...(defaultFixture && nonempty(relation.summary) ? { summary: relation.summary } : {}),
      reason: string(relation.reason) || '关系尚待你判断，不因文字相似而自动接入。', uncertain: string(relation.uncertain) || '材料是否适用于这处理解，尚不能说明。' },
    comparison: { same: string(candidate.comparison?.same) || '请先核对两边具体讨论的对象。',
      different: string(candidate.comparison?.different) || '条件差异尚未确认。', unknown: string(candidate.comparison?.unknown) || '不能据此确认原理解已经成立或失效。' },
    decision: 'pending',
  };
}

/** A fresh session always begins before searching. Supplied candidates are a local catalog, not search results. */
export function createComparisonState({ matter = demoMatter(), candidates = DEMO_CANDIDATES, sessionId = 'comparison' } = {}) {
  if (!validMatter(matter)) throw new TypeError('matter requires a valid comparison basis, integer version and exact focus; understanding may be empty.');
  const focus = basisOf(matter).focus;
  const catalog = [], seen = new Set();
  for (const [index, item] of (Array.isArray(candidates) ? candidates : []).entries()) {
    const candidate = normalizedCandidate(item, focus, `local-${index + 1}`, candidates === DEMO_CANDIDATES);
    if (!candidate || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    // A host-specific selection must not inherit the fixture sentence as its relation target.
    if (candidate.relationship.target === DEMO_FOCUS) candidate.relationship.target = focus.text;
    catalog.push(candidate);
  }
  return { schemaVersion: 1, sessionId: string(sessionId) || 'comparison', nextId: 1,
    screen: 'search', isDemo: candidates === DEMO_CANDIDATES, notice: '', matter: clone(matter), catalog, candidateIds: [], selectedId: null,
    fixtureQuestion: matter.id === 'demo-collection',
    query: { question: matter.id === 'demo-collection' ? DEMO_QUESTION : focus.text,
      direction: 'counterexample', instructions: matter.id === 'demo-collection' ? '找找没有写附言，却仍能重新使用内容的情况。' : '', scopes: ['prior', 'public'] },
    search: { status: 'idle', isDemo: true, provider: 'local-demo', request: null },
    drafts: {}, notes: {}, revision: { open: false, candidateId: null, draft: '', before: '', baseVersion: matter.version },
    request: null, receipt: null };
}
function inform(state, notice) { state.notice = notice; return state; }
function selected(state) { return state.catalog.find(({ id }) => id === state.selectedId); }
function entry(map, key) { return Object.hasOwn(map, key) ? map[key] : ''; }
function setEntry(map, key, value) { Object.defineProperty(map, key, { value, enumerable: true, writable: true, configurable: true }); }
function noteFor(state) { return entry(state.drafts, state.selectedId); }
function canUndo(state) {
  const receipt = state.receipt;
  if (!receipt || !['revise', 'create'].includes(receipt.kind) || state.request) return false;
  const revision = state.matter.revisions.find((entry) => entry.id === receipt.revisionId);
  return !!revision && !revision.undoneBy && state.matter.version === revision.afterVersion &&
    (state.matter.basis?.field !== undefined && state.matter.basis.field !== 'understanding' ||
    state.matter.focus.start === revision.target.start && state.matter.focus.end === revision.target.start + revision.after.length &&
    state.matter.focus.text === revision.after) &&
    state.matter.understanding.slice(revision.target.start, revision.target.start + revision.after.length) === revision.after;
}
function hash(text) {
  let result = 2166136261;
  for (let index = 0; index < text.length; index++) result = Math.imul(result ^ text.charCodeAt(index), 16777619);
  return (result >>> 0).toString(16).padStart(8, '0');
}
function sourceOf(candidate) {
  return { id: candidate.id, title: candidate.title, kind: candidate.kind, sourceType: candidate.sourceType,
    excerpt: candidate.excerpt, context: candidate.context, url: null };
}
function requestFor(state, kind, extra = {}) {
  const candidate = selected(state);
  const basis = basisTarget(state.matter);
  const payload = { kind, matterId: state.matter.id, baseVersion: state.matter.version,
    ...(state.matter.basis ? { basis } : {}),
    target: state.matter.basis ? clone(basis) : { field: 'understanding', ...clone(state.matter.focus) },
    ...(candidate ? { source: sourceOf(candidate), relationship: clone(candidate.relationship), note: noteFor(state) } : {}), ...extra };
  return { id: `${state.sessionId}:${state.matter.id}:${state.nextId++}:${hash(JSON.stringify(payload))}`, ...payload };
}
function searchCatalog(state) {
  const { question, instructions, direction, scopes } = state.query;
  const queryText = `${question} ${instructions}`.toLowerCase();
  const fixtureTerms = ['收藏', '附言', '表达', '原文', '现场', '任务', '阅读', '接回', '材料'];
  const hasFixtureTopic = fixtureTerms.some((term) => queryText.includes(term));
  const matches = state.catalog.filter((candidate) => {
    if (!candidate.scopes.some((scope) => scopes.includes(scope))) return false;
    if (candidate.id.startsWith('demo-')) return hasFixtureTopic;
    const source = `${candidate.title} ${candidate.excerpt} ${candidate.context}`.toLowerCase();
    return queryText.split(/[\s，。？！、；：,.?!;:]+/u).some((term) => term.length > 1 && source.includes(term)) ||
      fixtureTerms.some((term) => queryText.includes(term) && source.includes(term));
  });
  const first = direction === 'experience' ? 'demo-task' : direction === 'condition' ? 'demo-reading' : 'demo-project';
  return matches.sort((left, right) => (left.id === first ? -1 : right.id === first ? 1 : 0)).map(({ id }) => id);
}
function knownAction(type) {
  return ['QUERY_PATCH', 'SEARCH', 'ADJUST_SEARCH', 'IMPORT_MATERIAL', 'OPEN_CANDIDATE', 'BACK_TO_CANDIDATES',
    'COMPARISON_DRAFT', 'SAVE_COMPARISON_NOTE', 'RELATION_PATCH', 'LINK', 'REJECT', 'OPEN_REVISION', 'REVISION_DRAFT',
    'CANCEL_REVISION', 'CONFIRM_REVISION', 'UNDO_REVISION', 'COMMIT_RESULT', 'CLEAR_NOTICE'].includes(type);
}
/** Only COMMIT_RESULT can replace the host snapshot; requests alone never claim a mutation succeeded. */
export function reduceComparison(previous, action = {}) {
  if (!previous || !knownAction(action.type)) return previous;
  const state = clone(previous);
  if (action.type === 'CLEAR_NOTICE') return inform(state, '');
  if (state.request && action.type !== 'COMMIT_RESULT') return inform(state, '正在等待原事项确认；这次提交尚未完成。');
  const candidate = selected(state);
  switch (action.type) {
    case 'QUERY_PATCH': {
      const patch = action.patch || {};
      if (patch.direction !== undefined && !member(DIRECTION_OPTIONS, patch.direction)) return inform(state, '未识别的查找方向，原条件保留。');
      if (patch.scopes !== undefined && (!Array.isArray(patch.scopes) || patch.scopes.some((scope) => !member(SCOPE_OPTIONS, scope)))) return inform(state, '未识别的查找范围，原条件保留。');
      for (const key of ['question', 'instructions']) if (patch[key] !== undefined) state.query[key] = string(patch[key]);
      if (patch.question !== undefined) state.fixtureQuestion = false;
      if (patch.direction !== undefined) state.query.direction = patch.direction;
      if (patch.scopes !== undefined) state.query.scopes = [...new Set(patch.scopes)];
      state.search.status = 'idle';
      return inform(state, '');
    }
    case 'SEARCH': {
      if (!nonempty(state.query.question)) return inform(state, '先写下这次想弄清楚的问题。');
      state.search.request = clone(state.query);
      state.candidateIds = searchCatalog(state);
      state.search.status = state.candidateIds.length ? 'ready' : 'empty';
      state.screen = 'candidates'; state.selectedId = null; state.revision.open = false;
      return inform(state, state.candidateIds.length ? '这些是本地演示候选，未进行外部搜索；关系仍待确认。' : '本地演示材料中没有匹配；这不代表外部没有材料。可以调整条件或粘贴已有摘录。');
    }
    case 'ADJUST_SEARCH': state.screen = 'search'; state.revision.open = false; return inform(state, '调整只影响本次查找条件，不修改原事项。');
    case 'IMPORT_MATERIAL': {
      const material = action.material || {};
      if (!nonempty(material.excerpt)) return inform(state, '请粘贴一段实际摘录；仅填链接不会读取外部内容。');
      if (material.url != null) return inform(state, '本原型不读取链接。请保留实际摘录，来源链接留空。');
      const imported = normalizedCandidate({ ...material, id: `${state.sessionId}:user-${state.nextId++}`,
        title: nonempty(material.title) ? material.title : '我带入的一段材料', kind: 'user', scopes: ['imported'],
        relationship: undefined, comparison: undefined }, basisOf(state.matter).focus);
      state.catalog.push(imported); state.candidateIds = [...new Set([...state.candidateIds, imported.id])];
      state.selectedId = imported.id; state.screen = 'compare'; state.search.status = 'ready'; state.revision.open = false;
      return inform(state, '已带入你粘贴的材料；未读取外网，尚未接到原事项。');
    }
    case 'OPEN_CANDIDATE':
      if (!state.candidateIds.includes(action.id)) return inform(state, '未找到这份当前候选，原草稿保留。');
      state.selectedId = action.id; state.screen = 'compare'; state.revision.open = false;
      return inform(state, '');
    case 'BACK_TO_CANDIDATES': state.screen = 'candidates'; state.revision.open = false; return inform(state, '');
    case 'COMPARISON_DRAFT':
      if (!candidate) return inform(state, '先打开一份候选。');
      setEntry(state.drafts, candidate.id, string(action.text)); return inform(state, '');
    case 'SAVE_COMPARISON_NOTE':
      if (!candidate || !nonempty(noteFor(state))) return inform(state, '先写一点自己的判断。');
      setEntry(state.notes, candidate.id, noteFor(state));
      return inform(state, '判断已留在本次比较中；没有修改理解或确认材料关系。');
    case 'RELATION_PATCH': {
      if (!candidate) return inform(state, '先打开一份候选。');
      const patch = action.patch || {};
      if (patch.type !== undefined && !member(RELATION_OPTIONS, patch.type)) return inform(state, '请选择补充、挑战、限制、另一种可能或旁支。');
      if ((patch.type !== undefined && patch.type !== candidate.relationship.type) ||
        (patch.target !== undefined && string(patch.target) !== candidate.relationship.target)) delete candidate.relationship.summary;
      if (patch.type !== undefined) candidate.relationship.type = patch.type;
      if (patch.target !== undefined) candidate.relationship.target = string(patch.target);
      return inform(state, '关系只是本次草稿；尚未更改已接关系。');
    }
    case 'LINK':
      if (!candidate || !nonempty(candidate.relationship.target)) return inform(state, '先核对具体接到哪一处。');
      if (candidate.decision === 'rejected') return inform(state, '这份候选本次已拒绝；重新查找或带入后再作新的选择。');
      state.request = requestFor(state, 'link');
      return inform(state, '等待原事项确认关联；理解文本尚未改变。');
    case 'REJECT':
      if (!candidate) return inform(state, '先打开一份候选。');
      if (candidate.decision === 'linked') return inform(state, '这份材料已关联，本次未解除关系；请回原事项明确修复关联。');
      candidate.decision = 'rejected'; state.screen = 'candidates'; state.revision.open = false;
      return inform(state, '本次不关联，源材料和原理解均保留。');
    case 'OPEN_REVISION': {
      if (!candidate || candidate.decision === 'rejected') return inform(state, '先选择本次仍要比较的材料。');
      const basis = basisOf(state.matter);
      const creating = basis.field !== 'understanding' && !nonempty(state.matter.understanding);
      const target = creating ? { field: 'understanding', start: 0, end: 0, text: '' }
        : basis.field === 'understanding' ? { field: 'understanding', ...clone(basis.focus) } : action.target;
      if (!creating && (!target || target.field !== 'understanding' || !validFocus(state.matter.understanding, target)))
        return inform(state, '已经有个人理解，请明确选择要修改的理解片段；原表达选区不会被当成写入位置。');
      state.revision = { open: true, candidateId: candidate.id, mode: creating ? 'create' : 'replace', target: clone(target),
        draft: creating ? '' : target.text, before: creating ? '' : target.text, baseVersion: state.matter.version };
      return inform(state, creating ? '这里尚无个人理解。写下你现在愿意留下的判断，确认后才会建立；原表达保持不变。' : '只编辑明确选中的理解片段；确认后仍需原事项提交成功。');
    }
    case 'REVISION_DRAFT':
      if (!state.revision.open) return inform(state, '先打开局部修改确认面。');
      state.revision.draft = string(action.text); return inform(state, '');
    case 'CANCEL_REVISION': state.revision.open = false; return inform(state, '已取消局部修改，原理解没有改变。');
    case 'CONFIRM_REVISION':
      if (!candidate || !state.revision.open || state.revision.candidateId !== candidate.id) return inform(state, '先打开局部修改并核对前后内容。');
      if (!nonempty(state.revision.draft) || state.revision.draft === state.revision.before) return inform(state, '当前没有可提交的局部修改。');
      if (!nonempty(candidate.relationship.target)) return inform(state, '先明确这份材料与哪一处理解有关。');
      if (state.revision.baseVersion !== state.matter.version ||
        (state.revision.mode === 'create' ? nonempty(state.matter.understanding) : !validFocus(state.matter.understanding, state.revision.target)))
        return inform(state, '理解版本已变化，请重新核对这一处。');
      state.request = requestFor(state, state.revision.mode === 'create' ? 'create' : 'revise',
        { target: clone(state.revision.target), before: state.revision.before, after: state.revision.draft });
      return inform(state, '等待原事项确认修改；尚未显示已更新。');
    case 'UNDO_REVISION':
      if (!canUndo(state)) return inform(state, '这次修订已不可直接撤销；不会覆盖后来的编辑。');
      {
        const revision = state.matter.revisions.find(entry => entry.id === state.receipt.revisionId);
        state.request = requestFor(state, 'undo', { revisionId: revision.id,
          target: { field: 'understanding', start: revision.target.start, end: revision.target.start + revision.after.length, text: revision.after } });
      }
      return inform(state, '等待原事项确认撤销；保留已接材料与新事实。');
    case 'COMMIT_RESULT': {
      if (!state.request || action.requestId !== state.request.id) return previous;
      const request = state.request;
      state.request = null;
      if (!action.ok) {
        // The current host state may have advanced. Do not silently rebase the old edit onto it.
        if (validMatter(action.matter) && action.matter.id === state.matter.id) state.matter = clone(action.matter);
        return inform(state, string(action.error?.message) || string(action.error) || '原事项没有接受这次提交；草稿保留，请核对当前版本。');
      }
      if (!validMatter(action.matter) || action.matter.id !== request.matterId || !validReceipt(action.receipt, request, action.matter)) {
        return inform(state, '提交回执与原事项当前状态不一致；未宣称更新成功，请重新核验宿主。');
      }
      state.matter = clone(action.matter); state.receipt = clone(action.receipt); state.revision.open = false;
      if (request.kind === 'link') {
        const linked = state.catalog.find(({ id }) => id === request.source.id);
        if (linked) linked.decision = 'linked';
        state.screen = 'compare';
        return inform(state, '材料已接到这一处；原理解文本与版本没有改变。');
      }
      if (['revise', 'create'].includes(request.kind)) {
        const linked = state.catalog.find(({ id }) => id === request.source.id);
        if (linked) linked.decision = 'linked';
        state.screen = 'returned';
        return inform(state, request.kind === 'create' ? '原事项已确认：新的个人理解已留下，原表达未改动。' : '原事项已确认：只更新这一处，材料作为本次修订依据保留。');
      }
      state.screen = 'compare';
      return inform(state, '已撤销这一次局部修订；已接材料、未决部分与后来新增的事实仍保留。');
    }
    default: return previous;
  }
}

function validReceipt(receipt, request, matter) {
  if (!receipt || receipt.requestId !== request.id || receipt.kind !== request.kind || receipt.matterId !== request.matterId ||
    receipt.requestFingerprint !== fingerprint(request) || (request.kind !== 'link' && receipt.beforeVersion !== request.baseVersion) ||
    receipt.before !== request.target.text || receipt.target?.start !== request.target.start ||
    receipt.target?.end !== request.target.end || receipt.target?.text !== request.target.text) return false;
  if (request.kind === 'link') return matter.links.some((link) => link.id === receipt.linkId && link.sourceId === request.source.id &&
    link.source?.excerpt === request.source.excerpt && link.relationship?.type === request.relationship.type && link.relationship?.target === request.relationship.target) &&
    receipt.before === receipt.after && receipt.beforeVersion === receipt.afterVersion;
  if (['revise', 'create'].includes(request.kind)) {
    const revision = matter.revisions.find((entry) => entry.id === receipt.revisionId);
    return !!revision && !revision.undoneBy && revision.before === request.before && revision.after === request.after &&
      receipt.after === request.after && matter.version === receipt.afterVersion && receipt.afterVersion === request.baseVersion + 1 &&
      matter.understanding.slice(receipt.target.start, receipt.target.start + receipt.after.length) === receipt.after;
  }
  return matter.revisions.some((entry) => entry.id === request.revisionId && entry.id === receipt.revisionId && entry.undoneBy === request.id && entry.before === receipt.after) &&
    matter.version === receipt.afterVersion && receipt.afterVersion === request.baseVersion + 1 &&
    matter.understanding.slice(receipt.target.start, receipt.target.start + receipt.after.length) === receipt.after;
}

/** Stable public view. Consumers never need catalog/draft maps or any reducer-private fields. */
export function selectComparisonView(state) {
  const candidate = selected(state);
  const candidates = state.candidateIds.map((id) => state.catalog.find((item) => item.id === id)).filter(Boolean).map((item) => ({ ...clone(item),
    sourceLabel: `${item.kind === 'user' ? '你带入的材料' : item.kind === 'hypothetical' ? '假设情形' : '演示材料'} · ${item.sourceType}`,
    relationLabel: RELATION_OPTIONS.find(({ value }) => value === item.relationship.type)?.label || '另一种可能' }));
  const selectedCandidate = candidates.find((item) => item.id === state.selectedId) || null;
  const basis = basisOf(state.matter);
  return { screen: state.screen, isDemo: state.isDemo, notice: state.notice,
    matter: { id: state.matter.id, title: state.matter.title, understanding: state.matter.understanding,
      version: state.matter.version, focus: clone(basis.focus), basis: clone(basis), unresolved: clone(state.matter.unresolved ?? '') },
    query: { ...clone(state.query), shortQuestion: state.fixtureQuestion && state.query.question === DEMO_QUESTION ? '不写附言，也能接回来吗？' : state.query.question }, search: clone(state.search), candidates,
    selectedId: state.selectedId, selectedCandidate, comparisonDraft: noteFor(state), savedComparisonNote: entry(state.notes, state.selectedId),
    comparison: candidate ? { ...clone(candidate.comparison), confirmed: false } : null,
    revision: { open: state.revision.open, draft: state.revision.draft, before: state.revision.before, after: state.revision.draft,
      mode: state.revision.mode || (basis.field !== 'understanding' && !nonempty(state.matter.understanding) ? 'create' : 'replace'),
      target: clone(state.revision.target || null), requiresUnderstandingTarget: basis.field !== 'understanding' && nonempty(state.matter.understanding),
      baseVersion: state.revision.baseVersion, canConfirm: state.revision.open && !state.request && nonempty(state.revision.draft) &&
        state.revision.draft !== state.revision.before && state.revision.baseVersion === state.matter.version &&
        (state.revision.mode === 'create' ? !nonempty(state.matter.understanding) : validFocus(state.matter.understanding, state.revision.target)) && nonempty(candidate?.relationship.target) },
    request: clone(state.request), receipt: clone(state.receipt), canUndo: canUndo(state), pending: !!state.request,
    directionOptions: clone(DIRECTION_OPTIONS), scopeOptions: clone(SCOPE_OPTIONS), relationOptions: clone(RELATION_OPTIONS),
  };
}

function fingerprint(request) {
  const { id, ...payload } = request;
  // Store full canonical payload, not just a collision-prone numeric digest, for replay identity.
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(payload));
}
function fail(matter, code, message) { return { ok: false, matter: clone(matter), receipt: null, error: { code, message } }; }
function validSource(source) {
  return !!source && nonempty(source.id) && nonempty(source.title) && nonempty(source.excerpt) &&
    ['demo', 'hypothetical', 'user'].includes(source.kind) && source.url === null;
}
function linkFor(matter, request) {
  const target = request.basis || request.target;
  const existingSource = matter.links.find((link) => link.sourceId === request.source.id);
  if (existingSource && (existingSource.source?.excerpt !== request.source.excerpt || existingSource.source?.kind !== request.source.kind)) return { error: 'source_conflict' };
  const existing = matter.links.find((link) => link.sourceId === request.source.id &&
    link.focus?.field === target.field && link.focus?.start === target.start && link.focus?.end === target.end && link.focus?.text === target.text &&
    (!target.objectId || link.focus?.objectId === target.objectId) &&
    link.relationship?.type === request.relationship.type && link.relationship?.target === request.relationship.target);
  if (existing) return { link: existing, added: false };
  const link = { id: `comparison-link:${request.id}`, sourceId: request.source.id, source: clone(request.source),
    focus: clone(target), baseVersion: request.baseVersion, relationship: clone(request.relationship), note: string(request.note), requestId: request.id };
  matter.links.push(link);
  return { link, added: true };
}

/**
 * Pure illustrative host transaction. A real host must apply the same guards atomically against its current matter.
 * understanding version changes only for revision/undo; all unrelated fields and material links survive undo.
 */
export function applyComparisonRequest(currentMatter, request) {
  if (!validMatter(currentMatter)) return fail(currentMatter, 'invalid_matter', '原事项或选区无效，未进行修改。');
  if (!request || !nonempty(request.id) || !['link', 'revise', 'create', 'undo'].includes(request.kind)) return fail(currentMatter, 'invalid_request', '无法识别这次提交，未进行修改。');
  if (request.matterId !== currentMatter.id) return fail(currentMatter, 'matter_mismatch', '提交不属于当前这件事。');
  if (currentMatter.comparisonRequests !== undefined && !Array.isArray(currentMatter.comparisonRequests)) return fail(currentMatter, 'invalid_receipts', '原事项的提交记录无效，未进行修改。');
  const known = (currentMatter.comparisonRequests || []).find((entry) => entry.requestId === request.id);
  if (known) {
    if (known.requestFingerprint !== fingerprint(request)) return fail(currentMatter, 'request_id_collision', '同一个提交标识对应不同内容，未进行修改。');
    return { ok: true, matter: clone(currentMatter), receipt: { ...clone(known), replayed: true }, error: null };
  }
  const basis = basisOf(currentMatter);
  if (request.kind !== 'link' && request.baseVersion !== currentMatter.version || request.kind === 'link' && basis.field === 'understanding' && request.baseVersion !== currentMatter.version)
    return fail(currentMatter, 'version_conflict', '原理解已有后来修改；这次未覆盖它，请重新核对。');
  if (request.basis && request.kind !== 'undo') {
    const target = basisTarget(currentMatter);
    if (!exactTarget(request.basis, target) || request.basis.objectId !== target.objectId || request.basis.contentVersion !== target.contentVersion)
      return fail(currentMatter, 'basis_conflict', '比较依据或原选区版本已变化，未按旧位置提交。');
  }
  if (request.kind === 'link') {
    if (!exactTarget(request.target, { field: basis.field, ...basis.focus }))
      return fail(currentMatter, 'focus_conflict', '关联指向的片段与比较依据不一致。');
  } else if (request.kind === 'create') {
    if (nonempty(currentMatter.understanding) || request.target?.field !== 'understanding' || request.target.start !== 0 || request.target.end !== 0 || request.target.text !== '' || request.before !== '')
      return fail(currentMatter, 'create_conflict', '这里已有理解或创建目标不匹配，未覆盖现有内容。');
  } else if (request.target?.field !== 'understanding' || !validFocus(currentMatter.understanding, request.target) ||
      (request.kind === 'revise' && basis.field === 'understanding' && !exactTarget(request.target, { field: 'understanding', ...basis.focus })) ||
      (!currentMatter.basis && !exactTarget(request.target, { field: 'understanding', ...currentMatter.focus }))) {
    return fail(currentMatter, 'focus_conflict', '理解写入选区无效，未按原表达位置覆盖理解。');
  }
  const matter = clone(currentMatter);
  let receipt;
  if (request.kind === 'undo') {
    const revision = matter.revisions.find((entry) => entry.id === request.revisionId);
    if (!revision || revision.kind !== 'comparison') return fail(currentMatter, 'unknown_revision', '找不到本次对照产生的修订。');
    if (revision.undoneBy) return fail(currentMatter, 'already_undone', '该修订已撤销，不再重复回退。');
    if (request.target.start !== revision.target.start || request.target.end !== revision.target.start + revision.after.length || request.target.text !== revision.after)
      return fail(currentMatter, 'focus_conflict', '撤销指向的片段不是本次修订，未修改其他位置。');
    if (matter.version !== revision.afterVersion || matter.understanding.slice(revision.target.start, revision.target.start + revision.after.length) !== revision.after)
      return fail(currentMatter, 'undo_conflict', '后来的理解已变化，不能用旧撤销覆盖。');
    const start = revision.target.start, end = start + revision.after.length;
    matter.understanding = matter.understanding.slice(0, start) + revision.before + matter.understanding.slice(end);
    matter.version++;
    matter.focus = { start, end: start + revision.before.length, text: revision.before };
    if (matter.basis?.field === 'understanding') matter.basis = { ...matter.basis, text: matter.understanding, contentVersion: matter.version, focus: clone(matter.focus) };
    revision.undoneBy = request.id;
    revision.undoneAtVersion = matter.version;
    receipt = { requestId: request.id, requestFingerprint: fingerprint(request), matterId: matter.id, kind: 'undo',
      before: revision.after, after: revision.before, target: { field: 'understanding', start, end, text: revision.after },
      beforeVersion: request.baseVersion, afterVersion: matter.version, revisionId: revision.id,
      linkedSource: clone(revision.source), sourceTitle: revision.source.title, sourceKind: revision.source.kind,
      relationship: clone(revision.relationship), note: revision.note, linkId: revision.linkId, preservedMaterials: true };
  } else {
    if (!validSource(request.source) || !member(RELATION_OPTIONS, request.relationship?.type) || !nonempty(request.relationship?.target))
      return fail(currentMatter, 'invalid_relation', '材料来源或具体关系不完整，尚未接入。');
    if (['revise', 'create'].includes(request.kind) && (request.before !== request.target.text || !nonempty(request.after) || request.after === request.before))
      return fail(currentMatter, 'invalid_revision', '修改前后内容或选区不一致，未进行修改。');
    const { link, added, error } = linkFor(matter, request);
    if (error) return fail(currentMatter, error, '同一材料标识的原摘录已不同；不会覆盖原材料。');
    receipt = { requestId: request.id, requestFingerprint: fingerprint(request), matterId: matter.id, kind: request.kind,
      before: request.target.text, after: request.target.text, target: clone(request.target), beforeVersion: matter.version,
      afterVersion: matter.version, linkedSource: clone(request.source), sourceTitle: request.source.title, sourceKind: request.source.kind,
      linkId: link.id, linkAdded: added,
      relationship: clone(request.relationship), note: string(request.note), revisionId: null };
    if (['revise', 'create'].includes(request.kind)) {
      const { start, end } = request.target;
      matter.understanding = matter.understanding.slice(0, start) + request.after + matter.understanding.slice(end);
      matter.version++;
      matter.focus = { start, end: start + request.after.length, text: request.after };
      if (matter.basis?.field === 'understanding') matter.basis = { ...matter.basis, text: matter.understanding, contentVersion: matter.version, focus: clone(matter.focus) };
      receipt.after = request.after; receipt.afterVersion = matter.version; receipt.revisionId = `comparison-revision:${request.id}`;
      matter.revisions.push({ id: receipt.revisionId, kind: 'comparison', requestId: request.id,
        target: clone(request.target), basis: clone(request.basis || null), operation: request.kind, before: request.before, after: request.after,
        beforeVersion: request.baseVersion, afterVersion: matter.version, source: clone(request.source), linkId: link.id,
        relationship: clone(request.relationship), note: string(request.note), undoneBy: null });
    }
  }
  matter.comparisonRequests = [...(matter.comparisonRequests || []), clone(receipt)];
  return { ok: true, matter, receipt, error: null };
}

/** Fixtures traverse the same request/commit pipeline; they are never a shortcut for real host success. */
export function createComparisonDemo(screen = 'search') {
  let state = createComparisonState({ sessionId: 'demo-preview' });
  if (!SCREENS.includes(screen) || screen === 'search') return state;
  state = reduceComparison(state, { type: 'SEARCH' });
  if (screen === 'candidates') return state;
  state = reduceComparison(state, { type: 'OPEN_CANDIDATE', id: state.candidateIds[0] });
  state = reduceComparison(state, { type: 'COMPARISON_DRAFT', text: '它不算直接反例，但“必须写一句”可能太绝对了。' });
  if (screen === 'compare') return state;
  state = reduceComparison(state, { type: 'OPEN_REVISION' });
  state = reduceComparison(state, { type: 'REVISION_DRAFT', text: DEMO_AFTER });
  state = reduceComparison(state, { type: 'CONFIRM_REVISION' });
  const result = applyComparisonRequest(state.matter, state.request);
  return reduceComparison(state, { type: 'COMMIT_RESULT', requestId: state.request.id, ...result });
}
