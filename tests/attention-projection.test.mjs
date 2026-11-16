import test from 'node:test'
import assert from 'node:assert/strict'

import * as B from '../packages/product/workspace/src/bridge.mjs'
import {createDemoWorkspace} from '../packages/product/workspace/src/demo-workspace.mjs'
import {
  projectAttentionCanvas,
  selectAttentionProjection,
  ATTENTION_NODE_TYPES,
} from '../apps/desktop/src/attention/attention-projection.mjs'

const clone = value => structuredClone(value)

function oneMatterHost() {
  let host = B.createBridge()
  host = B.captureInput(host, {matterId: 'matter-test', text: '这是用户留下的原话。'})
  host = B.dispatchChain(host, {matterId: 'matter-test', action: {type: 'UNDERSTANDING_DRAFT', text: '这是我的理解。'}})
  host = B.dispatchChain(host, {matterId: 'matter-test', action: {type: 'SAVE_UNDERSTANDING'}})
  host = B.dispatchChain(host, {matterId: 'matter-test', action: {type: 'STOP_DRAFT', text: '还有一个未决问题。'}})
  return host
}

test('empty workspace projects to an honest empty canvas without demo content', () => {
  const host = B.createBridge()
  const before = JSON.stringify(host)
  const projection = projectAttentionCanvas(host)

  assert.equal(projection.statuses.workspace, 'empty')
  assert.equal(projection.matterId, null)
  assert.deepEqual(projection.nodes, [])
  assert.deepEqual(projection.edges, [])
  assert.deepEqual(projection.reader.lanes.agent.candidates, [])
  assert.equal(projection.reader.lanes.agent.status, 'not-requested')
  assert.equal(JSON.stringify(host), before)
})

test('real demo fixture preserves canonical IDs and explicit content types', () => {
  const host = createDemoWorkspace()
  const projection = projectAttentionCanvas(host)
  const types = new Set(projection.nodes.map(item => item.type))

  assert.equal(projection.statuses.workspace, 'ready')
  assert.deepEqual(projection.matterIds, ['matter-demo-handoff', 'matter-demo-review', 'matter-demo-writing'])
  for (const type of ['matter', 'original', 'understanding', 'source']) assert.equal(types.has(type), true, type)
  assert.equal(projection.nodes.some(item => item.id === 'matter:matter-demo-writing'), true)
  assert.equal(projection.nodes.some(item => item.id === 'original:matter-demo-writing'), true)
  assert.equal(projection.nodes.some(item => item.id === 'understanding:matter-demo-writing'), true)
  assert.equal(projection.nodes.some(item => item.text === '这是一段 Agent 自动生成的结论。'), false)
  assert.equal(projection.reader.lanes.agent.status, 'not-requested')
  assert.equal(projection.nodes.every(item => ATTENTION_NODE_TYPES.includes(item.type)), true)
})

test('a referenced but unavailable source remains unresolved and is not fabricated', () => {
  const host = oneMatterHost()
  host.chain.matters[0].sourceIds = ['missing-source']
  const projection = projectAttentionCanvas(host, {matterId: 'matter-test'})

  assert.equal(projection.nodes.some(item => item.type === 'source'), false)
  assert.equal(projection.unresolved.includes('source'), true)
  assert.equal(projection.reader.sourceProvenance.some(item => item.sourceId === 'missing-source' && item.status === 'missing'), true)
  assert.equal(projection.reader.lanes.original.sources.length, 0)
})

test('Agent suggestion is an unconfirmed candidate and never replaces user understanding', () => {
  const host = oneMatterHost()
  const session = host.chain.sessions['matter-test']
  session.suggestion = {
    start: 0,
    end: 2,
    original: '这是',
    replacement: 'Agent 候选',
    baseVersion: 1,
    baseDraftVersion: 1,
    status: 'pending',
    origin: {type: 'agent-run', runId: 'run-test', resultHash: 'hash-test'},
  }
  const beforeUnderstanding = host.chain.matters[0].understanding
  const projection = projectAttentionCanvas(host, {matterId: 'matter-test'})
  const candidate = projection.nodes.find(item => item.type === 'agent-candidate')

  assert.ok(candidate)
  assert.equal(candidate.status, 'unconfirmed')
  assert.equal(candidate.authorship, 'agent')
  assert.equal(candidate.provenance.type, 'agent-run')
  assert.equal(projection.reader.lanes.agent.status, 'unconfirmed')
  assert.equal(projection.reader.lanes.user.understanding.text, beforeUnderstanding)
  assert.equal(projection.nodes.some(item => item.type === 'understanding' && item.text === 'Agent 候选'), false)
  assert.equal(projection.unresolved.includes('agent'), true)
})

test('returned work result and revision keep their work provenance', () => {
  const host = oneMatterHost()
  host.chain.matters[0].revisions = [{id: 'revision-test', before: '这是旧理解。', after: '这是修订后的理解。', beforeVersion: 1, afterVersion: 2, undone: false}]
  host.chain.matters[0].understanding = '这是修订后的理解。'
  host.chain.matters[0].understandingVersion = 2
  host.worksite = {
    schemaVersion: 1,
    selectedWorkId: 'work-test',
    works: {
      'work-test': {id: 'work-test', title: '测试工作', agent: 'Codex', project: 'harness', connected: true},
    },
    sessions: {
      'work-test': {
        connection: {hostType: 'codex', status: 'returned_for_review', sessionId: 'codex-session-test'},
        intake: [{id: 'intake-test', matterId: 'matter-test', sourceText: '这是我的理解。', sourceVersion: 1, role: 'reference'}],
        results: [{id: 'result-test', matterId: 'matter-test', fact: '实际发生的事实。', interpretation: '我的解释。', unconfirmed: '还未确认的问题。', decision: 'result-only'}],
        result: {matterId: 'matter-test', fact: '', decision: 'pending'},
        findings: [],
      },
    },
  }
  const projection = projectAttentionCanvas(host, {matterId: 'matter-test'})
  const work = projection.nodes.find(item => item.type === 'work')
  const result = projection.nodes.find(item => item.type === 'result')
  const revision = projection.nodes.find(item => item.type === 'revision' && item.objectId === 'revision-test')

  assert.ok(work)
  assert.ok(result)
  assert.ok(revision)
  assert.equal(work.status, 'returned')
  assert.equal(result.status, 'returned')
  assert.equal(result.provenance.workId, 'work-test')
  assert.equal(revision.status, 'confirmed')
  assert.equal(projection.returned.includes(work.id), true)
  assert.equal(projection.returned.includes(result.id), true)
  assert.equal(projection.reader.work.status, 'returned')
  assert.equal(projection.reader.results.nodes[0].fact, '实际发生的事实。')
  assert.equal(projection.edges.some(edge => edge.from === work.id && edge.to === result.id && edge.relation === 'returns'), true)
})

test('IDs and default world positions are stable across input ordering; UI overrides do not mutate host', () => {
  const host = createDemoWorkspace()
  const reversed = clone(host)
  reversed.chain.matters.reverse()
  reversed.chain.sources.reverse()
  const first = selectAttentionProjection(host)
  const second = projectAttentionCanvas(reversed)
  const positions = projection => Object.fromEntries(projection.nodes.map(item => [item.id, item.position]))

  assert.deepEqual(first.nodes.map(item => item.id), second.nodes.map(item => item.id))
  assert.deepEqual(positions(first), positions(second))

  const before = JSON.stringify(host)
  const overridden = projectAttentionCanvas(host, {positionOverrides: {'matter:matter-demo-writing': {x: 999, y: 777}}})
  const moved = overridden.nodes.find(item => item.id === 'matter:matter-demo-writing')
  assert.deepEqual(moved.position, {x: 999, y: 777, width: 200, height: 92})
  assert.equal(moved.layoutSource, 'ui-override')
  assert.equal(JSON.stringify(host), before)
})

test('focus metadata resolves to the canonical object without borrowing camera/layout state', () => {
  const host = oneMatterHost()
  const projection = projectAttentionCanvas(host, {matterId: 'matter-test', focus: 'original:matter-test'})

  assert.equal(projection.focus.status, 'resolved')
  assert.equal(projection.focus.matterId, 'matter-test')
  assert.equal(projection.focus.objectKind, 'original')
  assert.equal(projection.focus.nodeId, 'original:matter-test')
  assert.equal(Object.hasOwn(projection.focus, 'x'), false)
  assert.equal(Object.hasOwn(projection.focus, 'position'), false)
})

test('anonymous Agent candidates keep identity when mutable output changes', () => {
  const host = oneMatterHost()
  const session = host.chain.sessions['matter-test']
  session.suggestion = {
    start: 0,
    end: 2,
    original: '这是',
    replacement: '初版候选',
    status: 'pending',
  }
  const first = projectAttentionCanvas(host, {matterId: 'matter-test'})
    .nodes.find(item => item.type === 'agent-candidate')
  assert.ok(first)

  // Streaming/retry updates are allowed to change the candidate text/status,
  // but they must not turn one candidate into a new DOM identity.
  session.suggestion.replacement = '重试后的候选'
  session.suggestion.status = 'stale'
  const second = projectAttentionCanvas(host, {matterId: 'matter-test'})
    .nodes.find(item => item.type === 'agent-candidate')
  assert.ok(second)
  assert.equal(second.id, first.id)
})

test('anonymous duplicate Agent candidates use deterministic occurrence anchors instead of colliding IDs', () => {
  const host = oneMatterHost()
  const candidates = [
    {matterId: 'matter-test', text: '相同候选', label: '同一标签'},
    {matterId: 'matter-test', text: '相同候选', label: '同一标签'},
  ]
  const first = projectAttentionCanvas(host, {matterId: 'matter-test', agentCandidates: candidates})
  const firstCandidates = first.nodes.filter(item => item.type === 'agent-candidate')
  const firstIds = firstCandidates.map(item => item.id)
  const firstEdges = first.edges.filter(item => item.relation === 'suggests')

  assert.equal(firstCandidates.length, 2)
  assert.equal(new Set(firstIds).size, 2)
  assert.equal(firstEdges.length, 2)
  assert.equal(new Set(firstEdges.map(item => item.id)).size, 2)
  assert.deepEqual(firstCandidates.map(item => item.identity), [
    {strategy: 'content-occurrence', durable: false, occurrence: 0},
    {strategy: 'content-occurrence', durable: false, occurrence: 1},
  ])

  // Reordering records cannot change the occurrence set.  The two records are
  // intentionally indistinguishable: there is no honest way for a stateless
  // projection to claim which physical object was moved.
  const reordered = projectAttentionCanvas(host, {matterId: 'matter-test', agentCandidates: [...candidates].reverse()})
  assert.deepEqual(reordered.nodes.filter(item => item.type === 'agent-candidate').map(item => item.id), firstIds)
  assert.deepEqual(reordered.edges.filter(item => item.relation === 'suggests').map(item => item.id), firstEdges.map(item => item.id))
})

test('candidate identity survives insertion/deletion around stable anchors and shared source live updates', () => {
  const host = oneMatterHost()
  host.chain.matters[0].sourceIds = ['shared-source']
  host.chain.sources.push({id: 'shared-source', title: '共享材料', excerpt: '初始摘录', accessStatus: 'available'})
  const secondMatter = structuredClone(host.chain.matters[0])
  secondMatter.id = 'matter-second'
  secondMatter.title = '第二件事'
  host.chain.matters.push(secondMatter)

  const anchored = {matterId: 'matter-test', start: 0, end: 2, original: '这是', replacement: '第一版'}
  const duplicateA = {matterId: 'matter-test', text: '无身份候选', label: '重复'}
  const duplicateB = {matterId: 'matter-test', text: '无身份候选', label: '重复'}
  const initialCandidates = [anchored, duplicateA, duplicateB]
  const initial = projectAttentionCanvas(host, {agentCandidates: initialCandidates})
  const initialByMatter = initial.nodes.filter(item => item.type === 'agent-candidate' && item.matterId === 'matter-test')
  const anchoredId = initialByMatter.find(item => item.identity.strategy === 'anchor-occurrence')?.id
  const duplicateIds = initialByMatter.filter(item => item.identity.strategy === 'content-occurrence').map(item => item.id)
  assert.ok(anchoredId)
  assert.deepEqual(duplicateIds.length, 2)

  // Adding a different candidate and reordering the input must not move the
  // stable anchor or the existing anonymous occurrence slots.
  const inserted = {matterId: 'matter-test', text: '后来插入的候选', label: '新候选'}
  const afterInsert = projectAttentionCanvas(host, {agentCandidates: [inserted, duplicateB, anchored, duplicateA]})
  const afterInsertCandidates = afterInsert.nodes.filter(item => item.type === 'agent-candidate' && item.matterId === 'matter-test')
  assert.equal(afterInsertCandidates.find(item => item.identity.strategy === 'anchor-occurrence')?.id, anchoredId)
  assert.deepEqual(afterInsertCandidates.filter(item => item.identity.strategy === 'content-occurrence' && item.candidate?.label === '重复').map(item => item.id), duplicateIds)

  // Removing one indistinguishable duplicate leaves an explicit occurrence 0;
  // it does not pretend to know whether the removed physical object was the
  // old occurrence 0 or 1.
  const afterDelete = projectAttentionCanvas(host, {agentCandidates: [anchored, duplicateB]})
  const remainingDuplicate = afterDelete.nodes.find(item => item.type === 'agent-candidate' && item.identity.strategy === 'content-occurrence')
  assert.equal(remainingDuplicate?.identity.durable, false)
  assert.equal(remainingDuplicate?.identity.occurrence, 0)

  // A shared source keeps one canonical node and both Matter edges while its
  // live excerpt changes.
  const firstSource = initial.nodes.find(item => item.type === 'source' && item.objectId === 'shared-source')
  assert.ok(firstSource)
  host.chain.sources.find(item => item.id === 'shared-source').excerpt = '动态更新后的摘录'
  const live = projectAttentionCanvas(host)
  const liveSource = live.nodes.find(item => item.type === 'source' && item.objectId === 'shared-source')
  assert.equal(liveSource?.id, firstSource.id)
  assert.equal(liveSource?.text, '动态更新后的摘录')
  assert.deepEqual(liveSource?.matterIds, ['matter-second', 'matter-test'])
  assert.deepEqual(live.edges.filter(item => item.to === liveSource.id && item.relation === 'source').map(item => item.from).sort(), [
    'matter:matter-second', 'matter:matter-test',
  ])
})

test('a source shared by two Matters has one canonical node and both owners', () => {
  const host = oneMatterHost()
  const firstMatter = host.chain.matters[0]
  const secondMatter = structuredClone(firstMatter)
  secondMatter.id = 'matter-second'
  secondMatter.title = '第二件事'
  secondMatter.sourceIds = ['shared-source']
  firstMatter.sourceIds = ['shared-source']
  host.chain.matters.push(secondMatter)
  host.chain.sources.push({
    id: 'shared-source',
    title: '共享材料',
    excerpt: '同一份来源内容',
    accessStatus: 'available',
  })

  const projection = projectAttentionCanvas(host)
  const shared = projection.nodes.filter(item => item.type === 'source' && item.objectId === 'shared-source')
  assert.equal(shared.length, 1)
  assert.deepEqual(shared[0].matterIds, ['matter-second', 'matter-test'])
  const links = projection.edges.filter(edge => edge.to === shared[0].id && edge.relation === 'source')
  assert.deepEqual(links.map(edge => edge.from).sort(), ['matter:matter-second', 'matter:matter-test'])
})
