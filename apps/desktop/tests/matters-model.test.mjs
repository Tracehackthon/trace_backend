import test from 'node:test'
import assert from 'node:assert/strict'
import { createMattersState, reduceMatters as reduce, selectMattersView as view } from '../src/matters/matters-model.mjs'

const run = (state, ...actions) => actions.reduce(reduce, state)
const open = (id = 'collection') => reduce(createMattersState(), { type: 'OPEN', id })
const selected = state => state.matters.find(matter => matter.id === state.selectedId)
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze) }
  return value
}

test('factory returns six independent example matters and stable view shape', () => {
  const a = createMattersState(), b = createMattersState(), v = view(a)
  assert.equal(a.mode, 'overview')
  assert.deepEqual(a.matters.map(m => m.id), ['collection', 'work', 'fresh', 'handoff', 'ideas', 'team'])
  assert.equal(v.selected, v.matters.find(m => m.id === v.selectedId))
  for (const matter of v.matters) {
    for (const key of ['title', 'lastStop', 'contextHint', 'whyCare', 'originalUnderstanding', 'unresolved', 'laterChange', 'currentJudgment', 'draft', 'understandingDraft']) assert.equal(typeof matter[key], 'string')
    assert.equal(typeof matter.changed, 'boolean')
    assert.equal(matter.example, true)
    for (const key of ['title', 'challenges', 'uncertain', 'sourceId']) assert.equal(typeof matter.comparison[key], 'string')
    for (const source of matter.sources) { assert.equal(source.matterId, matter.id); assert.equal(source.url, null) }
  }
  a.matters[0].sources[0].excerpt = 'changed outside reducer'
  assert.notEqual(b.matters[0].sources[0].excerpt, a.matters[0].sources[0].excerpt)
})

test('OPEN / CONTINUE / TAB / BACK / OVERVIEW preserve facts and do not mark change', () => {
  const initial = createMattersState()
  let state = run(initial, { type: 'OPEN', id: 'collection' }, { type: 'CONTINUE', tab: 'comparison' })
  assert.equal(state.mode, 'deep'); assert.equal(state.deepTab, 'comparison')
  state = reduce(state, { type: 'TAB', tab: 'understanding' })
  assert.equal(state.deepTab, 'understanding')
  state = reduce(state, { type: 'BACK' }); assert.equal(state.mode, 'reentry')
  state = reduce(state, { type: 'BACK' }); assert.equal(state.mode, 'overview')
  state = reduce(state, { type: 'OVERVIEW' })
  assert.deepEqual(state.matters, initial.matters)
  assert.equal(state.selectedId, 'collection')
  assert.ok(state.matters.every(matter => !matter.changed && matter.branch === null))
})

test('judgment and understanding drafts remain isolated by matter ID', () => {
  let state = run(open(), { type: 'DRAFT', text: 'collection draft' }, { type: 'UNDERSTANDING_DRAFT', text: 'collection understanding' }, { type: 'OPEN', id: 'work' })
  assert.equal(view(state).selected.draft, '')
  assert.equal(view(state).selected.understandingDraft, '')
  state = run(state, { type: 'DRAFT', text: 'work draft' }, { type: 'UNDERSTANDING_DRAFT', text: 'work understanding' }, { type: 'OPEN', id: 'collection' })
  assert.equal(view(state).selected.draft, 'collection draft')
  assert.equal(view(state).selected.understandingDraft, 'collection understanding')
  assert.equal(state.matters.find(m => m.id === 'work').draft, 'work draft')
  assert.ok(state.matters.every(m => !m.changed))
})

test('source and quote ownership never crosses when switching entries', () => {
  let state = open('collection')
  const original = structuredClone(selected(state).sources)
  state = reduce(state, { type: 'OPEN', id: 'fresh' })
  assert.ok(view(state).selected.sources.every(source => source.matterId === 'fresh'))
  assert.ok(view(state).selected.quotes.every(quote => quote.matterId === 'fresh'))
  assert.equal(view(state).selected.whyCare.includes('收藏留下了文章'), false)
  assert.deepEqual(state.matters.find(m => m.id === 'collection').sources, original)
})

test('rejecting a comparison preserves source/quotes, but removes it from selected context', () => {
  const state = open(), before = selected(state)
  const next = reduce(state, { type: 'RELATE', relation: 'irrelevant' })
  assert.equal(selected(next).relation, 'irrelevant')
  assert.equal(selected(next).changed, true)
  assert.deepEqual(selected(next).sources, before.sources)
  assert.deepEqual(selected(next).quotes, before.quotes)
  assert.deepEqual(selected(next).comparison, before.comparison)
  assert.equal(view(next).context.comparison, null)
  assert.equal(view(next).context.sourceIds.includes(before.comparison.sourceId), false)
  assert.match(next.notice, /原材料仍然保留/)
  assert.equal(selected(next).lastStop, before.lastStop)
})

test('challenge is a relation decision, not adoption, judgment, or verification', () => {
  const state = open(), before = selected(state)
  const next = reduce(state, { type: 'RELATE', relation: 'challenge' })
  assert.equal(selected(next).relation, 'challenge')
  assert.equal(selected(next).currentJudgment, before.currentJudgment)
  assert.equal(selected(next).understanding, before.understanding)
  assert.equal(selected(next).lastStop, before.lastStop)
  assert.equal(view(next).context.comparisonAdopted, false)
  assert.equal(selected(next).branch, null)
  assert.match(next.notice, /不表示采用/)
  assert.equal(reduce(next, { type: 'RELATE', relation: 'challenge' }), next)
})

test('a rejected relation can be repaired without duplicating or deleting source material', () => {
  const initial = open(), next = run(initial, { type: 'RELATE', relation: 'irrelevant' }, { type: 'RELATE', relation: 'challenge' })
  assert.deepEqual(selected(next).sources, selected(initial).sources)
  assert.deepEqual(view(next).context.comparison, selected(initial).comparison)
  assert.equal(view(next).context.comparisonRelation, 'challenge')
})

test('FRESH excludes old judgment/context, preserves provenance, and isolates fresh drafts', () => {
  let state = run(open(), { type: 'DRAFT', text: 'old draft' }, { type: 'UNDERSTANDING_DRAFT', text: 'old understanding draft' })
  const before = structuredClone(selected(state))
  state = reduce(state, { type: 'FRESH' })
  const v = view(state)
  assert.equal(v.mode, 'deep'); assert.equal(v.contextMode, 'fresh')
  for (const key of ['lastStop', 'originalUnderstanding', 'unresolved', 'currentJudgment', 'understanding', 'draft', 'understandingDraft']) assert.equal(v.selected[key], '')
  for (const key of ['originalUnderstanding', 'lastStop', 'unresolved', 'currentJudgment', 'currentUnderstanding']) assert.equal(v.context[key], null)
  assert.deepEqual(selected(state), before)
  assert.deepEqual(v.selected.sources, before.sources)
  assert.equal(v.context.mode, 'fresh')
  state = run(state, { type: 'DRAFT', text: 'fresh draft' }, { type: 'UNDERSTANDING_DRAFT', text: 'fresh own words' })
  assert.equal(view(state).selected.draft, 'fresh draft')
  assert.equal(selected(state).draft, 'old draft')
  state = reduce(state, { type: 'BACK' })
  assert.equal(state.mode, 'reentry'); assert.equal(view(state).selected.originalUnderstanding, '')
  state = reduce(state, { type: 'OVERVIEW' })
  assert.equal(view(state).selected.lastStop, before.lastStop)
  assert.equal(view(state).selected.draft, 'old draft')
  assert.equal(view(state).selected.understandingDraft, 'old understanding draft')
  assert.equal(selected(state).changed, false)
})

test('FRESH may use new explicitly saved understanding, never silently adopts old text', () => {
  const before = open()
  const state = run(before, { type: 'FRESH' }, { type: 'SAVE_UNDERSTANDING', text: '这次我愿意留下的表达。' })
  assert.equal(state.contextMode, 'fresh')
  assert.equal(view(state).context.originalUnderstanding, null)
  assert.equal(view(state).context.currentUnderstanding, '这次我愿意留下的表达。')
  assert.equal(view(state).selected.understanding, '这次我愿意留下的表达。')
  assert.equal(selected(state).originalUnderstanding, selected(before).originalUnderstanding)
  assert.equal(selected(state).lastStop, selected(before).lastStop)
})

test('SAVE_JUDGMENT updates the same stop, folds to overview, keeps text and next reopen', () => {
  let state = run(open(), { type: 'CONTINUE', tab: 'stop' }, { type: 'DRAFT', text: 'new draft' })
  const untouched = structuredClone(state.matters.slice(1)), value = '还需验证，个人表达是不是接续的必要条件'
  state = reduce(state, { type: 'SAVE_JUDGMENT', text: `  ${value}\n` })
  assert.equal(state.mode, 'overview')
  assert.equal(state.selectedId, 'collection')
  assert.equal(selected(state).lastStop, value)
  assert.equal(selected(state).currentJudgment, value)
  assert.equal(selected(state).changed, true)
  assert.equal(selected(state).draft, '')
  assert.equal(selected(state).branch.title, value)
  assert.deepEqual(state.matters.slice(1), untouched)
  assert.equal(selected(state).quotes.at(-1).text, value)
  assert.equal(selected(state).quotes.at(-1).example, false)
  state = reduce(state, { type: 'OPEN', id: 'collection' })
  assert.equal(view(state).selected.lastStop, value)
  assert.equal(view(state).selected.currentJudgment, value)
  assert.equal(view(state).context.lastStop, value)
})

test('saving own understanding does not rewrite original understanding or unrelated stop', () => {
  const state = open('work'), before = structuredClone(selected(state))
  const next = reduce(state, { type: 'SAVE_UNDERSTANDING', text: '一次可运行，不代表已经使用有效。' })
  assert.equal(selected(next).understanding, '一次可运行，不代表已经使用有效。')
  assert.equal(selected(next).originalUnderstanding, before.originalUnderstanding)
  assert.equal(selected(next).currentJudgment, before.currentJudgment)
  assert.equal(selected(next).lastStop, before.lastStop)
  assert.deepEqual(selected(next).sources, before.sources)
  assert.equal(selected(next).changed, true)
})

test('search uses real related records: reference query yields actual 1 / 2 / 3', () => {
  const state = reduce(createMattersState(), { type: 'SEARCH', query: '收藏 为什么接不回来' }), v = view(state)
  assert.equal(v.mode, 'search')
  assert.deepEqual(v.search.counts, { matters: 1, quotes: 2, sources: 3 })
  assert.equal(v.search.matters[0], v.matters[0])
  for (const item of [...v.search.quotes, ...v.search.sources]) {
    assert.equal(item.matterId, 'collection')
    const next = reduce(state, { type: 'OPEN', id: item.matterId })
    assert.equal(view(next).selected.lastStop, v.search.matters[0].lastStop)
  }
})

test('search categories have independent matching and exact empty counts', () => {
  const state = createMattersState()
  const quoteView = view(reduce(state, { type: 'SEARCH', query: '如果只是保存了文章' }))
  assert.deepEqual(quoteView.search.counts, { matters: 0, quotes: 1, sources: 0 })
  const sourceView = view(reduce(state, { type: 'SEARCH', query: '为什么收藏总会被遗忘' }))
  assert.deepEqual(sourceView.search.counts, { matters: 0, quotes: 0, sources: 1 })
  const empty = view(reduce(state, { type: 'SEARCH', query: '找不到-regression-876543' }))
  assert.deepEqual(empty.search.counts, { matters: 0, quotes: 0, sources: 0 })
  assert.deepEqual(empty.search.matters, [])
  assert.equal(view(reduce(state, { type: 'SEARCH', query: '  \n ' })).mode, 'overview')
})

test('search normalizes case/fullwidth/whitespace and recomputes changed user stop', () => {
  const state = createMattersState()
  assert.deepEqual(view(reduce(state, { type: 'SEARCH', query: 'ＣＯＤＥＸ  ＨＡＲＮＥＳＳ' })).search.counts, view(reduce(state, { type: 'SEARCH', query: 'codex harness' })).search.counts)
  const next = run(state, { type: 'OPEN', id: 'team' }, { type: 'SAVE_JUDGMENT', text: '唯一新停点-regression' }, { type: 'SEARCH', query: '唯一新停点-regression' })
  const found = view(next).search
  assert.deepEqual(found.counts, { matters: 1, quotes: 1, sources: 0 })
  assert.equal(found.matters[0].id, 'team')
  assert.equal(found.matters[0].lastStop, '唯一新停点-regression')
  assert.equal(found.quotes[0].matterId, 'team')
})

test('empty or malformed saves, invalid IDs/actions/relations/tabs are exact no-op', () => {
  const state = open()
  for (const action of [null, {}, { type: 'UNKNOWN' }, { type: 'OPEN', id: 'absent' }, { type: 'OPEN', id: '__proto__' }, { type: 'DRAFT', id: 'absent', text: 'must not apply' }, { type: 'SAVE_JUDGMENT', text: ' \n ' }, { type: 'SAVE_JUDGMENT' }, { type: 'SAVE_UNDERSTANDING', text: 123 }, { type: 'DRAFT', text: null }, { type: 'UNDERSTANDING_DRAFT', text: {} }, { type: 'SEARCH', query: null }, { type: 'RELATE', relation: 'adopted' }, { type: 'CONTINUE', tab: 'wrong' }, { type: 'TAB', tab: 'comparison' }]) assert.equal(reduce(state, action), state)
})

test('returning and re-saving identical content never create extra change nodes or quotes', () => {
  const initial = open(), next = reduce(initial, { type: 'SAVE_JUDGMENT', text: 'same exact judgment' })
  assert.equal(reduce(next, { type: 'SAVE_JUDGMENT', text: 'same exact judgment' }), next)
  const later = run(next, { type: 'OPEN', id: 'collection' }, { type: 'BACK' })
  assert.deepEqual(later.matters, next.matters)
  assert.equal(later.sequence, next.sequence)
})

test('explicitly saving an unchanged stop still folds back without inventing another revision', () => {
  const saved = reduce(open(), { type: 'SAVE_JUDGMENT', text: 'unchanged judgment' })
  const reopened = run(saved, { type: 'OPEN', id: 'collection' }, { type: 'FRESH' }, { type: 'DRAFT', text: 'unchanged judgment' })
  const next = reduce(reopened, { type: 'SAVE_JUDGMENT', text: 'unchanged judgment' })
  assert.equal(next.mode, 'overview')
  assert.equal(next.contextMode, 'resume')
  assert.equal(selected(next).freshDraft, '')
  assert.equal(next.sequence, saved.sequence)
  assert.deepEqual(selected(next).quotes, selected(saved).quotes)
  assert.deepEqual(selected(next).branch, selected(saved).branch)
})

test('fresh explicit resave of identical own understanding may enter context without duplicate revision', () => {
  const saved = reduce(open(), { type: 'SAVE_UNDERSTANDING', text: 'same own words' })
  const fresh = reduce(saved, { type: 'FRESH' })
  assert.equal(view(fresh).context.currentUnderstanding, null)
  const next = reduce(fresh, { type: 'SAVE_UNDERSTANDING', text: 'same own words' })
  assert.equal(view(next).context.currentUnderstanding, 'same own words')
  assert.equal(next.sequence, saved.sequence)
  assert.deepEqual(selected(next).quotes, selected(saved).quotes)
})

test('reducers and selectors are pure and view edits cannot mutate model state', () => {
  const state = freeze(open()), before = structuredClone(state)
  for (const action of [{ type: 'FRESH' }, { type: 'DRAFT', text: 'x' }, { type: 'UNDERSTANDING_DRAFT', text: 'y' }, { type: 'RELATE', relation: 'challenge' }, { type: 'SAVE_JUDGMENT', text: 'z' }, { type: 'SAVE_UNDERSTANDING', text: 'own words' }, { type: 'SEARCH', query: '收藏' }]) {
    assert.deepEqual(reduce(state, action), reduce(state, action))
    assert.deepEqual(state, before)
  }
  const v = view(state); v.selected.sources[0].excerpt = 'outside mutation'; v.selected.comparison.title = 'outside mutation'
  assert.deepEqual(state, before)
})

test('HTML-like text remains literal in drafts, saved fields, search and quote data', () => {
  const payload = '<img src=x onerror="alert(1)"> & <script>not code</script>'
  let state = reduce(open(), { type: 'DRAFT', text: payload })
  assert.equal(view(state).selected.draft, payload)
  state = run(state, { type: 'SAVE_JUDGMENT', text: payload }, { type: 'SEARCH', query: '<script>' })
  assert.equal(view(state).selected.currentJudgment, payload)
  assert.equal(view(state).search.quotes[0].text, payload)
  assert.equal(view(state).search.matters[0].lastStop, payload)
})

test('CLEAR_NOTICE does not alter facts and is idempotent', () => {
  const state = reduce(open(), { type: 'RELATE', relation: 'irrelevant' })
  const next = reduce(state, { type: 'CLEAR_NOTICE' })
  assert.equal(next.notice, ''); assert.deepEqual(next.matters, state.matters)
  assert.equal(reduce(next, { type: 'CLEAR_NOTICE' }), next)
})
