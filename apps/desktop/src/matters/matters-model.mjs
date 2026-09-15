// Session-only example data; no network, persistence, model inference, or DOM access.
const TABS = new Set(['care', 'understanding', 'comparison', 'stop'])
const clone = value => structuredClone(value)
const text = value => typeof value === 'string' ? value : null
const submitted = value => text(value)?.trim() || ''
const source = (matterId, suffix, title, kind, excerpt) => ({ id: `${matterId}-${suffix}`, matterId, title, kind, excerpt, url: null, example: true })
const quote = (matterId, suffix, value) => ({ id: `${matterId}-${suffix}`, matterId, text: value, example: true })

function fixture(id, title, lastStop, values = {}) {
  return {
    id, title, lastStop, contextHint: '', changed: false, relation: 'unreviewed',
    whyCare: '', originalUnderstanding: '', unresolved: lastStop, laterChange: '',
    currentJudgment: '', understanding: '', draft: '', understandingDraft: '',
    freshDraft: '', freshUnderstandingDraft: '',
    comparison: { title: '', challenges: '', uncertain: '', sourceId: '' },
    branch: null, quotes: [], sources: [], example: true, hasComparison: false, ...values,
  }
}

const FIXTURES = [
  fixture('collection', '收藏后为什么接不回来', '重新出现的理由，可能比分类更重要', {
    contextHint: '你当时是在重新设计桌面首页时留下它的。',
    whyCare: '收藏留下了文章，却没有留下当时为什么在意。',
    originalUnderstanding: '重新出现的理由，可能比分类更重要。',
    unresolved: '还没分清：是缺少个人表达，还是原文现场不足？',
    laterChange: '出现了一篇与你当前理解相反的文章。',
    hasComparison: true,
    comparison: {
      title: '真正的问题不是收藏太多，而是缺少重新进入的情境',
      challenges: '分类并不能自动恢复当时为什么在意。',
      uncertain: '个人表达是否一定是接续的必要条件。',
      sourceId: 'collection-comparison',
    },
    quotes: [
      quote('collection', 'quote-1', '如果只是保存了文章，却没有留下当时为什么在意……'),
      quote('collection', 'quote-2', '重新出现的理由，可能比分类更重要。'),
    ],
    sources: [
      source('collection', 'original', '知乎原文 · 为什么收藏总会被遗忘', '示例原文', '收藏留下了文章，却没有留下当时为什么在意。'),
      source('collection', 'workplace', 'Codex · harness · 首页设计讨论', '示例工作现场', '重新设计桌面首页时，讨论怎样从真实停点重新进入一件事。'),
      source('collection', 'comparison', '新的对照 · 重新进入的情境', '示例对照', '真正的问题不是收藏太多，而是缺少重新进入的情境。它仍不能确认个人表达是否是必要条件。'),
    ],
  }),
  fixture('work', '工作 UI 如何承接', '等待实际使用结果', {
    contextHint: '你当时在 Codex · harness 的首页原型里留下它。',
    whyCare: '工作界面需要承接正在做的事，而不是复制一个新的 Agent。',
    originalUnderstanding: '带入、参与做法、落实产物与得到使用结果不是同一程度。',
    unresolved: '等待实际使用结果，才能判断接续是否有帮助。',
    laterChange: '示例原型已经可操作，实际使用反馈仍未带回。',
    comparison: { title: '实现完成不等于实际使用有效', challenges: '一个可运行的原型，不能直接证明真实用户能够顺利接续。', uncertain: '仍需要观察具体工作中的使用结果。', sourceId: 'work-original' },
    quotes: [quote('work', 'quote-1', '工作实现完成，不能自动写成想法已经验证。')],
    sources: [source('work', 'original', 'Codex · harness · 工作接续原型', '示例工作现场', '在原生 Agent 当前工作旁边，呈现被带入的少量相关内容。')],
  }),
  fixture('fresh', '想重新看，不先被旧理解带走', '一段新的感受刚刚出现', {
    contextHint: '你想先重新阅读，留下这一次真实出现的感受。',
    whyCare: '能接回历史，也需要允许历史暂时不带路。',
    originalUnderstanding: '先恢复旧理解可以帮助继续，但不是每次都适用。',
    unresolved: '这次想先看见什么，再决定是否与过去比较？',
    laterChange: '一段新的感受刚刚出现，还没有整理成结论。',
    comparison: { title: '先表达这次感受，再决定是否比较历史', challenges: '旧理解存在，不代表这次必须沿着旧方向继续。', uncertain: '什么时候适合重新带回旧理解，仍由你判断。', sourceId: 'fresh-original' },
    quotes: [quote('fresh', 'quote-1', '这不只是隐藏历史界面，而是改变本次使用的上下文。')],
    sources: [source('fresh', 'original', '重新阅读 · 当下感受', '示例个人现场', '先不让旧理解带路，留出重新感受和判断的位置。')],
  }),
  fixture('handoff', '多 Agent 交接如何保留证据', '需要和可追溯现场不是一回事', {
    contextHint: '你在讨论多 Agent 交接时，区分了摘要与可回到的证据。',
    whyCare: '交接需要能够重新核验现场，而不只是相信上一段摘要。',
    originalUnderstanding: '摘要可以导航，不能代替真实输入、产物和验证。',
    unresolved: '需要和可追溯现场不是一回事，下一位怎样确认当前事实？',
    laterChange: '示例交接里仍有一处待回答的问题。',
    comparison: { title: '摘要完整，也可能无法重放关键判断', challenges: '交接内容多，不等于下一位能定位证据。', uncertain: '哪些证据是完成当前接续所需的最小集合？', sourceId: 'handoff-original' },
    quotes: [quote('handoff', 'quote-1', '把待回答问题和实际证据一起交接。')],
    sources: [source('handoff', 'original', '多 Agent 交接 · 证据与停点', '示例讨论现场', '摘要只作导航，原始输入与实际检查用于核验。')],
  }),
  fixture('ideas', '一些想法', '还不够成熟', {
    contextHint: '只是一些刚留下的想法，还不需要现在整理。',
    whyCare: '有一点东西先别丢，也不要急着整理成结论。',
    originalUnderstanding: '还没有形成自己的判断。',
    unresolved: '还不够成熟，可以先收着。', laterChange: '尚无新的材料或结果。',
    comparison: { title: '暂时不整理，也是一种有效停点', challenges: '模糊触动不一定要马上被加工成结论。', uncertain: '是否值得继续，可以等新的现场出现后再看。', sourceId: 'ideas-original' },
    sources: [source('ideas', 'original', '留下一点 · 模糊想法', '示例个人现场', '先保留一点，不强制标题、分类和结论。')],
  }),
  fixture('team', '团队方法怎样从实践中修订', '个人修改不能静默变成团队规则', {
    contextHint: '你在一次方法修订讨论里，留下了修改范围的问题。',
    whyCare: '个人试用发现需要保留范围，不应直接变成所有人的要求。',
    originalUnderstanding: '个人修改、项目采用和团队发布需要分别确认。',
    unresolved: '怎样让实践发现参与修订，同时保留采用范围？',
    laterChange: '示例中有一条个人发现，还没有经过团队采用。',
    comparison: { title: '一次局部成功不能自动泛化为团队规则', challenges: '发现有用不等于已经适用于所有场景。', uncertain: '适用条件、验证范围与采用决定仍未确认。', sourceId: 'team-original' },
    quotes: [quote('team', 'quote-1', '个人修改不能静默扩大为项目或团队规则。')],
    sources: [source('team', 'original', '团队方法 · 实践修订讨论', '示例讨论现场', '将发现、验证、采用和发布分别保留为明确决定。')],
  }),
]

export function createMattersState() {
  return { mode: 'overview', selectedId: 'collection', query: '', deepTab: 'care', contextMode: 'resume', matters: clone(FIXTURES), notice: '', sequence: 0, freshContext: null }
}

const selectedIn = state => state.matters.find(matter => matter.id === state.selectedId)
const isFresh = state => state.contextMode === 'fresh' && state.freshContext?.matterId === state.selectedId
function replaceSelected(state, changes, shell = {}) {
  return { ...state, ...shell, matters: state.matters.map(matter => matter.id === state.selectedId ? { ...matter, ...changes } : matter) }
}
function navigate(state, changes) {
  return Object.entries(changes).every(([key, value]) => state[key] === value) ? state : { ...state, ...changes }
}

export function reduceMatters(state, action) {
  if (!action || typeof action.type !== 'string') return state
  if (action.type !== 'OPEN' && action.id !== undefined) return state
  const selected = selectedIn(state)
  switch (action.type) {
    case 'OPEN':
      if (!state.matters.some(matter => matter.id === action.id)) return state
      return navigate(state, { mode: 'reentry', selectedId: action.id, query: '', deepTab: 'care', contextMode: 'resume', freshContext: null, notice: '' })
    case 'BACK':
      return state.mode === 'deep'
        ? navigate(state, { mode: 'reentry', notice: '' })
        : navigate(state, { mode: 'overview', query: '', contextMode: 'resume', freshContext: null, notice: '' })
    case 'OVERVIEW':
      return navigate(state, { mode: 'overview', query: '', contextMode: 'resume', freshContext: null, notice: '' })
    case 'SEARCH': {
      if (text(action.query) === null) return state
      return navigate(state, { query: action.query, mode: action.query.trim() ? 'search' : 'overview', contextMode: 'resume', freshContext: null, notice: '' })
    }
    case 'CONTINUE':
      if (!selected || !TABS.has(action.tab)) return state
      return navigate(state, { mode: 'deep', deepTab: action.tab, notice: '' })
    case 'TAB':
      if (state.mode !== 'deep' || !TABS.has(action.tab)) return state
      return navigate(state, { deepTab: action.tab, notice: '' })
    case 'FRESH':
      if (!selected) return state
      if (isFresh(state)) return navigate(state, { mode: 'deep', deepTab: 'care' })
      return { ...state, mode: 'deep', deepTab: 'care', contextMode: 'fresh', freshContext: { matterId: selected.id, judgment: '', understanding: '' }, notice: '这次先不带回旧理解；原记录仍然保留。' }
    case 'DRAFT':
    case 'UNDERSTANDING_DRAFT': {
      if (!selected || text(action.text) === null) return state
      const key = action.type === 'DRAFT' ? (isFresh(state) ? 'freshDraft' : 'draft') : (isFresh(state) ? 'freshUnderstandingDraft' : 'understandingDraft')
      return selected[key] === action.text ? state : replaceSelected(state, { [key]: action.text })
    }
    case 'RELATE':
      if (!selected?.sources.some(source => source.id === selected.comparison?.sourceId) || !['challenge', 'irrelevant'].includes(action.relation) || selected.relation === action.relation) return state
      return replaceSelected(state, { relation: action.relation, changed: true }, { notice: action.relation === 'challenge' ? '已接为挑战；这不表示采用了材料的结论。' : '这次不作为对照；原材料仍然保留。' })
    case 'SAVE_JUDGMENT': {
      const value = submitted(action.text)
      if (!selected || !value) return state
      if (selected.currentJudgment === value) {
        const shell = { mode: 'overview', query: '', contextMode: 'resume', freshContext: null }
        const key = isFresh(state) ? 'freshDraft' : 'draft'
        return selected[key] ? replaceSelected(state, { [key]: '' }, shell) : navigate(state, shell)
      }
      const sequence = state.sequence + 1
      return replaceSelected(state, {
        currentJudgment: value, lastStop: value, changed: true,
        [isFresh(state) ? 'freshDraft' : 'draft']: '',
        branch: { title: value, subtitle: '你刚留下的判断 · 仍可继续修改' },
        quotes: [...selected.quotes, { id: `${selected.id}-judgment-${sequence}`, matterId: selected.id, text: value, example: false, kind: 'judgment' }],
      }, { mode: 'overview', query: '', contextMode: 'resume', freshContext: null, sequence, notice: '当前停点已更新；下次从这里接着。' })
    }
    case 'SAVE_UNDERSTANDING': {
      const value = submitted(action.text)
      if (!selected || !value) return state
      if (selected.understanding === value) {
        const shell = isFresh(state) && state.freshContext.understanding !== value ? { freshContext: { ...state.freshContext, understanding: value } } : {}
        const key = isFresh(state) ? 'freshUnderstandingDraft' : 'understandingDraft'
        return selected[key] ? replaceSelected(state, { [key]: '' }, shell) : navigate(state, shell)
      }
      const sequence = state.sequence + 1
      return replaceSelected(state, {
        understanding: value, changed: true, [isFresh(state) ? 'freshUnderstandingDraft' : 'understandingDraft']: '',
        quotes: [...selected.quotes, { id: `${selected.id}-understanding-${sequence}`, matterId: selected.id, text: value, example: false, kind: 'understanding' }],
      }, { sequence, notice: '已保存你的表达；没有替你采用其他段落。', ...(isFresh(state) ? { freshContext: { ...state.freshContext, understanding: value } } : {}) })
    }
    case 'CLEAR_NOTICE': return navigate(state, { notice: '' })
    default: return state
  }
}

const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
function searchMatters(matters, query) {
  const tokens = normalize(query).split(' ').filter(Boolean)
  const matches = (...fields) => tokens.length > 0 && tokens.every(token => normalize(fields.join(' ')).includes(token))
  const found = { matters: [], quotes: [], sources: [] }
  if (tokens.length) for (const matter of matters) {
    if (matches(matter.title, matter.lastStop, matter.contextHint, matter.whyCare, matter.originalUnderstanding, matter.understanding, matter.currentJudgment, matter.unresolved, matter.laterChange)) found.matters.push(matter)
    for (const item of matter.quotes) if (matches(item.text, matter.title)) found.quotes.push({ ...item, matterTitle: matter.title })
    for (const item of matter.sources) if (matches(item.title, item.kind, item.excerpt, matter.title)) found.sources.push({ ...item, matterTitle: matter.title })
  }
  return { ...found, counts: { matters: found.matters.length, quotes: found.quotes.length, sources: found.sources.length } }
}

export function selectMattersView(state) {
  const matters = clone(state.matters)
  const selected = matters.find(matter => matter.id === state.selectedId) ?? null
  const fresh = isFresh(state) && ['deep', 'reentry'].includes(state.mode)
  // The source state is preserved. The active presentation and context consumer both
  // receive a projection without prior judgments; hiding a panel alone is insufficient.
  if (selected && fresh) Object.assign(selected, {
    lastStop: '', originalUnderstanding: '', unresolved: '', currentJudgment: '',
    understanding: state.freshContext.understanding,
    draft: selected.freshDraft, understandingDraft: selected.freshUnderstandingDraft,
  })
  const context = selected ? {
    matterId: selected.id, mode: fresh ? 'fresh' : 'resume',
    whyCare: selected.whyCare,
    originalUnderstanding: fresh ? null : selected.originalUnderstanding,
    currentUnderstanding: selected.understanding || null,
    currentJudgment: fresh ? null : selected.currentJudgment || null,
    lastStop: fresh ? null : selected.lastStop,
    unresolved: fresh ? null : selected.unresolved,
    sourceIds: selected.sources.filter(item => selected.relation !== 'irrelevant' || item.id !== selected.comparison.sourceId).map(item => item.id),
    comparison: selected.relation === 'irrelevant' ? null : clone(selected.comparison),
    comparisonRelation: selected.relation,
    comparisonAdopted: false,
  } : null
  return { mode: state.mode, selectedId: state.selectedId, query: state.query, deepTab: state.deepTab, contextMode: state.contextMode, matters, selected, search: searchMatters(matters, state.query), notice: state.notice, context, example: true }
}
