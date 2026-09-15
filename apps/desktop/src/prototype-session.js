import { createMattersState, reduceMatters, selectMattersView } from './matters/matters-model.mjs'

// One in-memory owner for both surfaces. No local/session storage and no hidden database.
export function createPrototypeSession() {
  let state = createMattersState()
  let captureSequence = 0
  let featuredId = 'collection'
  const mappings = { thought: 'collection', work: 'work', fresh: 'fresh', handoff: 'handoff', practice: 'work', result: 'work', insight: 'collection' }
  return {
    getState: () => state,
    view() { return { ...selectMattersView(state), featuredId } },
    dispatch(action) {
      state = reduceMatters(state, action)
      return this.view()
    },
    homeMatterId(entry) { return ['thought','insight'].includes(entry) ? featuredId : mappings[entry] },
    homeEntries() {
      return Object.fromEntries(['thought','work','fresh','handoff'].map(entry => {
        const matter = state.matters.find(item => item.id === this.homeMatterId(entry))
        return [entry, { matterId: matter.id, title: matter.title, subtitle: `${matter.changed ? '现在' : '上次'}停在：${matter.lastStop}` }]
      }))
    },
    capture(value) {
      const original = typeof value === 'string' ? value.trim() : ''
      if (!original) return null
      const id = `capture-${++captureSequence}`
      // A new input is a new thing, not a silent edit/association to the collection example.
      const matter = {
        id, title: original, lastStop: original, contextHint: '你刚刚在首页留下了这一点。',
        changed: false, relation: 'unreviewed', whyCare: original,
        originalUnderstanding: '', unresolved: '还没有形成判断，可以从刚留下的一点继续。',
        laterChange: '这是本次会话刚留下的内容，尚未带入新的对照。',
        currentJudgment: '', understanding: '', draft: '', understandingDraft: '',
        freshDraft: '', freshUnderstandingDraft: '',
        comparison: { title: '还没有新的对照', challenges: '先保留此刻的表达，再决定需要什么材料。', uncertain: '没有外部材料，不能判断它支持或挑战了什么。', sourceId: '' },
        branch: null, hasComparison: false, example: false,
        quotes: [{ id: `${id}-original`, matterId: id, text: original, example: false }],
        sources: [{ id: `${id}-home`, matterId: id, title: '首页 · 刚留下的一点', kind: '本次输入', excerpt: original, url: null, example: false }],
      }
      state = { ...state, matters: [...state.matters, matter] }
      featuredId = id
      return id
    },
  }
}
