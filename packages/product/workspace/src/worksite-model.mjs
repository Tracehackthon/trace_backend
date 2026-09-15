// Explicit, isolated visual fixture. These are not observations about the real project.
function savedFixture() {
  const matters = [
    { id: 'demo-worksite-recall', title: '收藏后为什么接不回来', stop: '恢复当时的触动，是否需要自己的附言？', understanding: '也许需要补一句自己的感受。', version: 1 },
    { id: 'demo-worksite-light-capture', title: '允许只留下一点，不强制整理', stop: '保存时，哪些内容可以以后再补？', understanding: '可以先保存，不必马上补完标题、分类和理由。', version: 1 },
  ];
  const intake = [
    {
      id: 'demo-intake-light-capture', matterId: 'demo-worksite-light-capture',
      title: '允许只留下一点，不强制整理', sourceText: matters[1].understanding, sourceVersion: 1,
      source: { title: '我的理解 · 示例', excerpt: matters[1].understanding, url: null },
      relevance: '这次正在设计保存入口，它会影响哪些内容必须填写。',
      usePlan: '先完成保存，再允许补一句自己的感受。', role: 'reference', note: '',
    },
    {
      id: 'demo-intake-recall', matterId: 'demo-worksite-recall',
      title: '保存材料，不等于恢复当时的触动', sourceText: matters[0].understanding, sourceVersion: 1,
      source: { title: '收藏后为什么接不回来 · 示例', excerpt: '个人表达，还是原文现场？', url: null },
      relevance: '用于回看体验的判断：只留材料，之后能否接回当时的想法。',
      usePlan: '观察几天后能否接回当时为什么在意。', role: 'trial', note: '',
    },
  ];
  const evidence = [
    { id: 'demo-evidence-provided', stage: 'provided', text: '示例上下文记录中包含这两条带入。', source: { title: '本次带入记录 · 示例', excerpt: '两条理解作为本次任务的参考与尝试。', url: null }, isDemo: true },
    { id: 'demo-evidence-decision', stage: 'decision', text: '示例取舍：附言作为可选项，不阻挡保存。', source: { title: '保存入口取舍 · 示例', excerpt: '先完成保存，再允许补一句自己的感受。', url: null }, isDemo: true },
    { id: 'demo-evidence-artifact', stage: 'artifact', text: '示例检查：未填写附言，也可以完成保存。', source: { title: '保存流程检查记录 · 示例', excerpt: '附言可选；保存操作不依赖附言。', url: null }, isDemo: true },
  ];
  return {
    matters,
    works: [
      {
        id: 'demo-worksite-save', title: '实现「从知乎留下一点」', agent: 'Codex', project: 'harness',
        scope: 'current-task', connected: false, intake,
        decision: { id: 'demo-decision-optional-note', title: '附言作为可选项，不阻挡保存', description: '先完成保存，再允许补一句自己的感受。', artifact: { title: '保存交互原型 · 示例', url: null, isDemo: true }, intakeIds: intake.map(item => item.id) },
        impact: { relation: 'proposed', stages: { provided: true, decision: true, artifact: true, usage: false }, confirmed: ['未填写附言，也可以完成保存。'], unconfirmed: ['几天后，是否能恢复当时为什么在意。'], evidence, correction: '' },
      },
      {
        id: 'demo-worksite-return', title: '观察几天后的回看体验', agent: 'Codex', project: 'harness',
        scope: 'current-task', connected: false,
        intake: [{ ...intake[1], id: 'demo-intake-recall-later', role: 'contrast' }],
      },
    ],
  };
}

const DEMO_FINDING = '保存很轻，但回来时可能认不出当时为什么在意。';
const DEMO_RESULT = {
  matterId: 'demo-worksite-recall',
  fact: '这一次没有写附言，但借助原文和前后讨论，想起了当时为什么在意。',
  interpretation: '这次可能是原文和前后讨论保留了足够的现场信息。',
  unconfirmed: '哪些情况下，只有自己的一句话才能补上缺失？',
  proposedUnderstanding: '附言不一定每次都需要。先保留足以恢复现场的信息，再允许补充个人感受。',
  relation: 'unknown',
};


export const SCREENS = Object.freeze(['overview', 'intake', 'impact', 'finding', 'results']);
const ROLES = ['reference', 'trial', 'contrast', 'exclude'];
const RELATIONS = ['support', 'limit', 'challenge', 'unknown'];
const STAGES = ['provided', 'decision', 'artifact', 'usage'];
const copy = value => structuredClone(value);
const text = value => typeof value === 'string' ? value : '';
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const source = value => ({ title: text(value?.title), excerpt: text(value?.excerpt), url: typeof value?.url === 'string' ? value.url : null });
const blankResult = matterId => ({ id: null, matterId, fact: '', interpretation: '', unconfirmed: '', proposedUnderstanding: '', relation: 'unknown', decision: 'pending' });
const blankReview = () => ({ open: false, matterId: null, baseVersion: 0, before: '', after: '', stale: false });
const blankImpact = () => ({ relation: 'proposed', stages: { provided: false, decision: false, artifact: false, usage: false }, confirmed: [], unconfirmed: [], evidence: [], correction: '' });
const noDecision = () => ({ id: null, title: '尚无可核验的具体取舍', description: '连接工作或留下明确依据后，再核对理解怎样参与。', artifact: { title: '尚未连接产物', url: null, isDemo: false }, intakeIds: [] });
const blankFinding = work => ({ id: null, text: '', note: '', source: { title: `${work.agent || '未连接 Agent'} · ${work.project || '当前工作'}`, excerpt: work.title, url: null }, suggestedMatterId: null, relation: 'pending', saved: false, useInCurrentWork: false });

function makeSession(work, matterIds) {
  const intake = (Array.isArray(work.intake) ? work.intake : []).filter(item => nonempty(item?.id) && matterIds.has(item.matterId)).map(item => ({
    id: item.id, matterId: item.matterId, title: text(item.title), sourceText: text(item.sourceText), sourceVersion: Number.isSafeInteger(item.sourceVersion) && item.sourceVersion >= 0 ? item.sourceVersion : 0,
    source: source(item.source), relevance: text(item.relevance), usePlan: text(item.usePlan), role: ROLES.includes(item.role) ? item.role : 'reference', note: text(item.note),
  }));
  const ids = new Set(intake.map(item => item.id));
  if (ids.size !== intake.length) throw new TypeError('Duplicate intake ID within a work');
  const impact = { ...blankImpact(), ...copy(work.impact || {}) };
  impact.evidence = (Array.isArray(impact.evidence) ? impact.evidence : []).filter(item => STAGES.includes(item?.stage) && nonempty(item.text)).map(item => ({ id: text(item.id), stage: item.stage, text: item.text, source: source(item.source), isDemo: item.isDemo === true }));
  // An earlier stage never establishes a later one. A boolean alone is not evidence.
  impact.stages = Object.fromEntries(STAGES.map(stage => [stage, work.impact?.stages?.[stage] === true && impact.evidence.some(item => item.stage === stage)]));
  impact.confirmed = impact.evidence.length ? (Array.isArray(impact.confirmed) ? impact.confirmed : []).filter(nonempty) : [];
  impact.unconfirmed = (Array.isArray(impact.unconfirmed) ? impact.unconfirmed : []).filter(nonempty);
  impact.relation = ['proposed', 'confirmed', 'disputed'].includes(impact.relation) ? impact.relation : 'proposed';
  if (!impact.evidence.length && impact.relation === 'confirmed') impact.relation = 'proposed';
  impact.correction = text(impact.correction);
  const decision = work.decision ? {
    id: text(work.decision.id), title: text(work.decision.title), description: text(work.decision.description),
    artifact: { title: text(work.decision.artifact?.title), url: typeof work.decision.artifact?.url === 'string' ? work.decision.artifact.url : null, isDemo: work.decision.artifact?.isDemo === true },
    intakeIds: (work.decision.intakeIds || []).filter(id => ids.has(id)),
  } : noDecision();
  return {
    screen: 'overview', backStack: [], selectedIntakeId: intake[0]?.id ?? null, intake, decision, impact,
    composer: { text: '' }, finding: blankFinding(work), findings: [],
    result: blankResult(intake.at(-1)?.matterId ?? null), results: [], review: blankReview(), receipt: null, retry: null,
  };
}

/** Pure, in-memory prototype store. Supplied IDs are preserved; no connector is invoked. */
export function createWorksiteState(options = {}) {
  const seed = options.fixture === 'saved' ? savedFixture() : { matters: [], works: [{ id: 'local-work', title: '尚未接入工作', agent: '', project: '', connected: false }] };
  const inputMatters = Array.isArray(options.matters) ? options.matters : seed.matters;
  const inputWorks = Array.isArray(options.works) ? options.works : seed.works;
  const matters = Object.create(null);
  for (const item of inputMatters) {
    if (!nonempty(item?.id)) continue;
    if (own(matters, item.id)) throw new TypeError('Duplicate matter ID');
    matters[item.id] = { id: item.id, title: text(item.title), stop: text(item.stop), understanding: text(item.understanding), version: Number.isSafeInteger(item.version) && item.version >= 0 ? item.version : 0, revisions: [] };
  }
  const works = Object.create(null);
  const sessions = Object.create(null);
  for (const item of inputWorks) {
    if (!nonempty(item?.id)) continue;
    if (own(works, item.id)) throw new TypeError('Duplicate work ID');
    works[item.id] = { id: item.id, title: text(item.title), agent: text(item.agent), project: text(item.project), scope: 'current-task', connected: item.connected === true };
    sessions[item.id] = makeSession(item, new Set(Object.keys(matters)));
  }
  const selectedWorkId = own(works, options.selectedWorkId) ? options.selectedWorkId : Object.keys(works)[0] ?? null;
  return { schemaVersion: 1, isDemo: options.fixture === 'saved' || options.isDemo === true, selectedWorkId, works, sessions, matters, notice: '', sequence: 0 };
}

/** Each preview gets its own store. Navigation in a live session never loads a fixture. */
export function createWorksiteDemo(screen = 'overview') {
  const state = createWorksiteState({ fixture: 'saved' });
  const session = state.sessions[state.selectedWorkId];
  session.screen = SCREENS.includes(screen) ? screen : 'overview';
  if (screen === 'finding') {
    session.composer.text = DEMO_FINDING;
    session.finding = { ...blankFinding(state.works[state.selectedWorkId]), text: DEMO_FINDING, suggestedMatterId: 'demo-worksite-recall' };
  }
  if (screen === 'results') session.result = { ...session.result, ...DEMO_RESULT };
  return state;
}

function notice(state, message) { return { ...state, notice: message }; }
function move(session, screen) {
  if (session.screen === screen) return;
  session.backStack.push(session.screen);
  session.screen = screen;
}
function reviewStale(state, session) {
  const review = session.review;
  if (!review.open) return false;
  const matter = state.matters[review.matterId];
  return !matter || matter.version !== review.baseVersion || matter.understanding !== review.before || session.result.matterId !== review.matterId;
}
function nextId(state, kind) { state.sequence += 1; return `${kind}:${state.sequence}`; }
function saveResult(state, session, decision) {
  if (session.result.id) return session.results.find(item => item.id === session.result.id);
  session.result.id = nextId(state, 'result');
  session.result.decision = decision;
  const result = { ...copy(session.result), workId: state.selectedWorkId, isDemo: state.isDemo };
  session.results.push(result);
  return result;
}
function validResult(state, session) {
  return nonempty(session.result.fact) && own(state.matters, session.result.matterId);
}
function saveFinding(state, session) {
  if (!session.finding.id) session.finding.id = nextId(state, 'finding');
  session.finding.saved = true;
  const record = { ...copy(session.finding), workId: state.selectedWorkId, isDemo: state.isDemo };
  const index = session.findings.findIndex(item => item.id === record.id);
  if (index < 0) session.findings.push(record); else session.findings[index] = record;
}
function canUndo(state, session) {
  const receipt = session.receipt;
  if (!receipt || receipt.undone) return false;
  const matter = state.matters[receipt.matterId];
  return !!matter && receipt.workId === state.selectedWorkId && matter.version === receipt.version && matter.understanding === receipt.after;
}

export function reduceWorksite(state, action = {}) {
  if (!state || state.schemaVersion !== 1 || !action || typeof action.type !== 'string') return state;
  if (action.type === 'CLEAR_NOTICE') return state.notice ? { ...state, notice: '' } : state;
  if (action.type === 'SELECT_WORK') {
    if (!own(state.works, action.id)) return notice(state, '没有找到这项工作，当前内容未改变。');
    return action.id === state.selectedWorkId ? state : { ...state, selectedWorkId: action.id, notice: '' };
  }
  if (!state.selectedWorkId || !own(state.sessions, state.selectedWorkId)) return notice(state, '尚未接入工作。');
  const next = copy(state);
  const session = next.sessions[next.selectedWorkId];
  next.notice = '';
  switch (action.type) {
    case 'NAVIGATE':
      if (!SCREENS.includes(action.screen)) return state;
      move(session, action.screen);
      break;
    case 'BACK':
      session.review.open = false;
      session.screen = session.backStack.pop() || 'overview';
      break;
    case 'OPEN_INTAKE':
      if (!session.intake.some(item => item.id === action.id)) return notice(state, '这条带入不属于当前工作。');
      session.selectedIntakeId = action.id;
      move(session, 'intake');
      break;
    case 'SET_INTAKE_ROLE':
    case 'SET_INTAKE_NOTE': {
      const item = session.intake.find(entry => entry.id === action.id);
      if (!item) return notice(state, '这条带入不属于当前工作。');
      if (action.type === 'SET_INTAKE_ROLE') {
        if (!ROLES.includes(action.role)) return state;
        item.role = action.role;
        next.notice = action.role === 'exclude' ? '仅本次不使用；原理解和过去的影响记录保留。' : '已调整本次用途；未修改长期理解。';
      } else {
        if (typeof action.text !== 'string') return state;
        item.note = action.text;
      }
      break;
    }
    case 'COMPOSER_DRAFT':
      if (typeof action.text !== 'string') return state;
      session.composer.text = action.text;
      break;
    case 'OPEN_FINDING':
      if (!nonempty(session.composer.text)) return notice(state, '先写下一点现场发现。');
      // Composer opens a new capture, never an edit of an earlier saved finding.
      session.finding = { ...blankFinding(next.works[next.selectedWorkId]), text: session.composer.text, suggestedMatterId: session.result.matterId };
      move(session, 'finding');
      break;
    case 'FINDING_DRAFT': {
      if (!action.patch || typeof action.patch !== 'object') return state;
      const changed = ['text', 'note'].some(key => typeof action.patch[key] === 'string' && action.patch[key] !== session.finding[key]);
      if (!changed) return state;
      if (session.finding.saved) { session.finding.id = null; session.finding.saved = false; session.finding.useInCurrentWork = false; }
      for (const key of ['text', 'note']) if (typeof action.patch[key] === 'string') session.finding[key] = action.patch[key];
      break;
    }
    case 'SET_FINDING_RELATION':
      if (!['linked', 'unrelated'].includes(action.decision)) return state;
      if (action.decision === 'linked' && !own(next.matters, action.matterId)) return notice(state, '没有找到要关联的事；原始发现仍保留。');
      session.finding.relation = action.decision;
      session.finding.suggestedMatterId = action.decision === 'linked' ? action.matterId : null;
      if (session.finding.saved) saveFinding(next, session);
      next.notice = action.decision === 'unrelated' ? '暂不关联；原话和来源仍保留。' : '仅确认关联，未采用为当前理解。';
      break;
    case 'KEEP_FINDING':
    case 'USE_FINDING_IN_WORK':
      if (!nonempty(session.finding.text)) return notice(state, '空白发现不能保存。');
      if (action.type === 'USE_FINDING_IN_WORK') session.finding.useInCurrentWork = true;
      saveFinding(next, session);
      next.notice = action.type === 'USE_FINDING_IN_WORK' ? '已纳入本次工作上下文；未向 Agent 发送，也未发布为长期规则。' : '已留在本次会话；原话和出处保留。';
      break;
    case 'DISPUTE_IMPACT':
      session.impact.relation = 'disputed';
      session.impact.correction = text(action.text);
      next.notice = '已标记影响关系存疑；原始依据与四种程度没有被删改。';
      break;
    case 'RESULT_DRAFT': {
      if (!action.patch || typeof action.patch !== 'object') return state;
      if (own(action.patch, 'matterId') && !own(next.matters, action.patch.matterId)) return notice(state, '没有找到结果要接回的事。');
      if (own(action.patch, 'relation') && !RELATIONS.includes(action.patch.relation)) return state;
      const fields = ['matterId', 'fact', 'interpretation', 'unconfirmed', 'proposedUnderstanding', 'relation'];
      const changed = fields.some(key => typeof action.patch[key] === 'string' && action.patch[key] !== session.result[key]);
      if (!changed) return state;
      // Persisted evidence is immutable. Further editing starts another pending result.
      if (session.result.decision !== 'pending') { session.result.id = null; session.result.decision = 'pending'; }
      for (const key of fields) if (typeof action.patch[key] === 'string') session.result[key] = action.patch[key];
      if (session.review.open) session.review.stale = true;
      break;
    }
    case 'KEEP_RESULT_ONLY':
      if (!validResult(next, session)) return notice(state, '请先填写实际发生的事实，并明确接回哪件事。');
      if (session.result.decision === 'revised') return notice(state, '该结果已确认过修订；如需恢复理解，请撤销那次修订。');
      saveResult(next, session, 'result-only');
      session.review = blankReview();
      next.notice = '结果已留在本次会话；当前理解没有改变。';
      break;
    case 'OPEN_REVISION_REVIEW': {
      if (!validResult(next, session)) return notice(state, '先补充实际发生的事实，再查看修改差异。');
      if (!nonempty(session.result.proposedUnderstanding)) return notice(state, '先写下建议怎样修改；还不会立即生效。');
      if (session.result.decision === 'revised') return notice(state, '这份结果已经确认过修订，不会重复提交。');
      const matter = next.matters[session.result.matterId];
      session.review = { ...blankReview(), open: true, matterId: matter.id, baseVersion: matter.version, before: matter.understanding, after: session.result.proposedUnderstanding,
        resultSnapshot: copy(session.result) };
      break;
    }
    case 'REVISION_DRAFT':
      if (!session.review.open || typeof action.text !== 'string') return state;
      session.review.after = action.text;
      break;
    case 'CANCEL_REVISION_REVIEW':
      session.review = blankReview();
      break;
    case 'CONFIRM_REVISION': {
      if (!session.review.open) return state;
      const review = session.review;
      if (review.stale || reviewStale(next, session)) {
        session.review.stale = true;
        next.notice = '理解或本次结果已变化；请关闭并重新查看差异，不能覆盖新内容。';
        break;
      }
      if (!validResult(next, session) || !nonempty(review.after)) return notice(state, '事实与修改内容都不能为空。');
      if (review.after === review.before) return notice(state, '前后内容相同，不生成修订；可以只留下结果。');
      const matter = next.matters[review.matterId];
      const result = saveResult(next, session, 'revised');
      result.decision = 'revised';
      session.result.decision = 'revised';
      const receipt = { id: nextId(next, 'revision'), workId: next.selectedWorkId, matterId: matter.id, resultId: result.id, before: review.before, after: review.after, baseVersion: matter.version, version: matter.version + 1, undone: false, isDemo: next.isDemo };
      matter.understanding = review.after;
      matter.version = receipt.version;
      matter.revisions.push({ ...copy(receipt), kind: 'revision' });
      session.receipt = receipt;
      session.review = blankReview();
      next.notice = '已确认本次会话的理解修改；原始事实仍保留，可撤销。';
      break;
    }
    case 'UNDO_REVISION': {
      if (!session.receipt || session.receipt.undone) return state;
      if (!canUndo(next, session)) return notice(state, '该理解已有后续变化；不会用旧撤销覆盖新内容。');
      const receipt = session.receipt;
      const matter = next.matters[receipt.matterId];
      matter.understanding = receipt.before;
      matter.version += 1;
      receipt.undone = true;
      receipt.undoVersion = matter.version;
      matter.revisions.push({ id: nextId(next, 'undo'), kind: 'undo', revisionId: receipt.id, resultId: receipt.resultId, before: receipt.after, after: receipt.before, version: matter.version });
      const result = session.results.find(item => item.id === receipt.resultId);
      if (result) { result.decision = 'result-only'; result.revertedRevisionId = receipt.id; }
      if (session.result.id === receipt.resultId) session.result.decision = 'result-only';
      next.notice = '理解内容已恢复，版本继续递增；结果事实与修订记录保留。';
      break;
    }
    case 'TRY_AGAIN':
      if (!validResult(next, session)) return notice(state, '请先保留实际发生的事实，再决定怎样试一次。');
      saveResult(next, session, session.result.decision === 'revised' ? 'revised' : 'result-only');
      session.review = blankReview();
      session.retry = { id: nextId(next, 'retry'), workId: next.selectedWorkId, matterId: session.result.matterId, resultId: session.result.id, observation: session.result.unconfirmed, status: 'planned', sent: false, scope: 'current-task', understandingVersion: next.matters[session.result.matterId].version };
      next.notice = '已留下本次再试计划；未采用建议修改，也未自动创建或发送外部任务。';
      break;
    default:
      return state;
  }
  return next;
}

const roleInstruction = {
  reference: '作为本次参考，不覆盖当前明确要求。',
  trial: '作为待检验的本次尝试，不当作已经成立的结论。',
  contrast: '只用于比较条件和差异，不据此约束当前实现。',
};

/** Detached read model: mutating the returned view cannot mutate the store. */
export function selectWorksiteView(state) {
  const work = state.works[state.selectedWorkId] || null;
  const session = state.sessions[state.selectedWorkId] || makeSession({ title: '尚未接入工作' }, new Set());
  const context = session.intake.filter(item => item.role !== 'exclude').map(item => ({ id: item.id, matterId: item.matterId, text: item.sourceText, sourceVersion: item.sourceVersion, role: item.role, instruction: roleInstruction[item.role], note: item.note }));
  const counts = Object.fromEntries(ROLES.map(role => [role, session.intake.filter(item => item.role === role).length]));
  const usedFindings = session.findings.filter(item => item.useInCurrentWork);
  return copy({
    screen: session.screen, isDemo: state.isDemo, notice: state.notice, selectedWorkId: state.selectedWorkId, selectedIntakeId: session.selectedIntakeId,
    works: Object.values(state.works).map(({ id, title, agent, project }) => ({ id, title, agent, project })), work,
    matters: Object.values(state.matters).map(({ id, title, stop, understanding, version }) => ({ id, title, stop, understanding, version })),
    intake: session.intake, contextIntakeIds: context.map(item => item.id), context, contextSummary: { ...counts, included: context.length, findings: usedFindings.length },
    contextFindings: usedFindings,
    selectedIntake: session.intake.find(item => item.id === session.selectedIntakeId) || null,
    decision: session.decision, impact: session.impact, composer: session.composer, finding: session.finding, findings: session.findings,
    result: session.result, results: session.results,
    review: { open: session.review.open, matterId: session.review.matterId, baseVersion: session.review.baseVersion, before: session.review.before, after: session.review.after, stale: session.review.stale || reviewStale(state, session) },
    receipt: session.receipt, undo: { revision: canUndo(state, session) }, retry: session.retry,
  });
}
