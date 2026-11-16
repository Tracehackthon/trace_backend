/**
 * Read-only projection of the Product Workspace for Attention Canvas.
 *
 * This module deliberately does not own a store or a reducer.  Matter,
 * source, understanding, work and result records remain in the workspace
 * host; the values returned here are detached copies that are safe for a
 * renderer to annotate.  In particular, `positionOverrides` are view data
 * only and are never written back to a Matter or a Product Workspace object.
 */

export const ATTENTION_PROJECTION_VERSION = 1

export const ATTENTION_NODE_TYPES = Object.freeze([
  'matter',
  'original',
  'source',
  'understanding',
  'discussion',
  'agent-candidate',
  'work',
  'result',
  'revision',
])

export const ATTENTION_WORLD = Object.freeze({width: 1500, height: 900})

const copy = value => {
  if (value === undefined) return undefined
  return structuredClone(value)
}
const string = value => typeof value === 'string' ? value : ''
const nonempty = value => string(value).trim().length > 0
const array = value => Array.isArray(value) ? value : []
const own = (value, key) => !!value && Object.prototype.hasOwnProperty.call(value, key)
const finite = value => typeof value === 'number' && Number.isFinite(value)
const safeVersion = value => Number.isSafeInteger(value) && value >= 0 ? value : 0
const versionOr = (value, fallback = 0) => Number.isSafeInteger(value) && value >= 0 ? value : fallback
const unique = values => [...new Set(values.filter(value => value !== undefined && value !== null))]

function stableString(value) {
  if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableString(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function stableHash(value) {
  let hash = 2166136261
  for (const char of stableString(value)) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function idFor(type, objectId, matterId = null) {
  const value = string(objectId)
  // Product IDs are already globally unique for source/work records.  Keep
  // those IDs unchanged after the type prefix so a source shared by two
  // Matters cannot receive two visual identities.  Matter-local records are
  // scoped explicitly where their raw IDs are only locally meaningful.
  if (type === 'matter' || type === 'source' || type === 'work') return `${type}:${value}`
  if (type === 'original' && value.endsWith(':original')) return `original:${value.slice(0, -':original'.length)}`
  if (type === 'understanding' && value.endsWith(':understanding')) return `understanding:${value.slice(0, -':understanding'.length)}`
  if (type === 'discussion' && value.includes(':discussion:')) return `discussion:${value}`
  const scope = matterId ? `${matterId}:` : ''
  return `${type}:${scope}${value}`
}

function titleOf(matter) {
  return string(matter?.title) || string(matter?.originalText).split(/\r?\n/)[0] || string(matter?.whyCare).split(/\r?\n/)[0] || '未命名的事'
}

function sourceStatus(source) {
  const raw = source?.accessStatus ?? source?.sourceStatus ?? source?.status
  if (typeof raw === 'string' && raw.trim()) return raw
  if (source?.accessDenied === true || source?.authorized === false) return 'denied'
  if (source?.changed === true || source?.stale === true) return 'changed'
  if (nonempty(source?.excerpt)) return 'available'
  return 'missing'
}

function sourceKind(source) {
  if (!source) return 'unknown'
  if (source.kind === 'external' || source.source === 'global' || source.source === 'authorized') return 'external'
  if (source.origin === 'demo' || String(source.kind).startsWith('example-')) return 'example'
  if (source.kind === 'work-finding') return 'work-finding'
  return source.kind || 'user'
}

function sourceProvenance(source, extra = {}) {
  if (!source) return {sourceId: extra.sourceId ?? null, status: 'missing', origin: 'unresolved'}
  const status = sourceStatus(source)
  return {
    sourceId: source.id ?? extra.sourceId ?? null,
    status,
    sourceKind: sourceKind(source),
    origin: source.origin ?? source.source ?? (source.kind === 'external' ? 'external' : 'user-provided'),
    url: source.url ?? null,
    ...(source.provider ? {provider: source.provider} : {}),
    ...(source.author ? {author: source.author} : {}),
    ...(source.locator ? {locator: copy(source.locator)} : {}),
    ...(source.contentHash ? {contentHash: source.contentHash} : {}),
    ...(source.fetchedAt ? {fetchedAt: source.fetchedAt} : {}),
    ...(extra.matterId ? {matterId: extra.matterId} : {}),
  }
}

function node(type, objectId, matterId, fields = {}) {
  const id = idFor(type, objectId, matterId)
  return {
    id,
    type,
    kind: type,
    objectId,
    matterId: matterId ?? null,
    ...fields,
  }
}

function asMap(value) {
  if (value instanceof Map) return Object.fromEntries(value.entries())
  return value && typeof value === 'object' ? value : {}
}

function meaningfulWork(work, session) {
  if (!work) return false
  if (string(work.title).trim() && string(work.title).trim() !== '尚未接入工作') return true
  if (nonempty(work.agent) || nonempty(work.project) || nonempty(work.connection?.sessionId)) return true
  if (array(session?.intake).length || array(session?.results).length || array(session?.findings).length) return true
  return nonempty(session?.result?.fact) || nonempty(session?.finding?.text)
}

function normalizeFocus(focus, matterId, nodesById, nodeIdsByObject) {
  if (typeof focus === 'string' && focus) focus = {objectId: focus}
  if (!focus || typeof focus !== 'object') return null
  const requestedMatterId = focus.matterId ?? matterId ?? null
  if (requestedMatterId && matterId && requestedMatterId !== matterId) {
    return {
      matterId: requestedMatterId,
      objectId: focus.objectId ?? focus.expressionId ?? null,
      objectKind: focus.objectKind ?? focus.kind ?? null,
      lane: focus.lane ?? null,
      locator: copy(focus.locator ?? focus),
      reason: focus.reason ?? 'restore',
      status: 'unresolved',
    }
  }
  const directId = string(focus.nodeId || focus.objectId || focus.expressionId)
  let resolved = directId && nodesById.get(directId)
  if (!resolved && directId) {
    const candidates = nodeIdsByObject.get(directId) || []
    if (candidates.length === 1) resolved = nodesById.get(candidates[0])
    else {
      const matching = candidates.find(id => nodesById.get(id)?.matterId === requestedMatterId)
      resolved = matching ? nodesById.get(matching) : undefined
    }
  }
  if (!resolved && focus.field) {
    const type = focus.field === 'originalText' ? 'original' : focus.field === 'understanding' || focus.field === 'understandingDraft' ? 'understanding' : focus.field === 'source' ? 'source' : focus.field === 'discussion' ? 'discussion' : null
    if (type) {
      const objectId = focus.objectId || (type === 'original' ? `${requestedMatterId}:original` : type === 'understanding' ? `${requestedMatterId}:understanding` : null)
      const candidateIds = objectId ? (nodeIdsByObject.get(objectId) || []) : []
      const candidate = candidateIds.find(id => nodesById.get(id)?.matterId === requestedMatterId && nodesById.get(id)?.type === type)
      resolved = candidate ? nodesById.get(candidate) : [...nodesById.values()].find(item => item.matterId === requestedMatterId && item.type === type)
    }
  }
  const objectId = resolved?.objectId ?? focus.objectId ?? focus.expressionId ?? null
  return {
    matterId: requestedMatterId,
    objectId,
    objectKind: resolved?.type ?? focus.objectKind ?? focus.kind ?? null,
    lane: resolved?.lane ?? focus.lane ?? (resolved?.type === 'agent-candidate' ? 'agent' : resolved?.type === 'understanding' || resolved?.type === 'discussion' ? 'user' : resolved?.type === 'source' || resolved?.type === 'original' ? 'original' : null),
    locator: copy(focus.locator ?? focus),
    reason: focus.reason ?? 'restore',
    status: resolved ? 'resolved' : 'unresolved',
    ...(resolved ? {nodeId: resolved.id} : {}),
  }
}

function sourceIdsForMatter(matter) {
  return unique([
    ...array(matter?.sourceIds),
    ...array(matter?.captureSourceIds),
    ...array(matter?.links).map(link => link?.sourceId),
    ...array(matter?.observations).map(observation => observation?.sourceId),
  ].filter(value => typeof value === 'string' && value.length))
}

function candidateStatus(candidate) {
  const status = string(candidate?.status).toLowerCase()
  if (status === 'accepted' || status === 'adopted' || status === 'applied') return 'accepted'
  if (status === 'stale' || status === 'expired') return 'stale'
  if (status === 'dismissed' || status === 'rejected' || status === 'cancelled') return 'dismissed'
  if (status === 'running' || status === 'generating') return 'generating'
  if (status === 'failed' || status === 'error') return 'failed'
  return 'unconfirmed'
}

function candidateOrigin(candidate) {
  const origin = candidate?.origin
  if (origin && typeof origin === 'object') return copy(origin)
  if (origin) return {type: origin}
  if (candidate?.runId) return {type: 'agent-run', runId: candidate.runId}
  return {type: 'unresolved'}
}

function candidateObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function candidateAnchorDescriptor(input) {
  const rawAnchor = input.anchor ?? input.targetAnchor ?? input.range
  const anchor = candidateObject(rawAnchor) || {}
  const start = Number.isInteger(input.start) ? input.start : Number.isInteger(anchor.start) ? anchor.start : null
  const end = Number.isInteger(input.end) ? input.end : Number.isInteger(anchor.end) ? anchor.end : null
  const original = string(input.original || anchor.original || anchor.quote)
  const field = string(input.field || anchor.field)
  const path = string(input.path || anchor.path || anchor.objectId)
  const anchorText = string(rawAnchor)
  const baseVersion = Number.isSafeInteger(input.baseVersion) ? input.baseVersion : Number.isSafeInteger(anchor.baseVersion) ? anchor.baseVersion : Number.isSafeInteger(anchor.revision) ? anchor.revision : null
  const baseDraftVersion = Number.isSafeInteger(input.baseDraftVersion) ? input.baseDraftVersion : Number.isSafeInteger(anchor.baseDraftVersion) ? anchor.baseDraftVersion : null
  if (!(start != null || end != null || original || field || path || anchorText || baseVersion != null || baseDraftVersion != null)) return null
  const value = {start, end, original, field, path, anchorText, baseVersion, baseDraftVersion}
  return {value, hash: stableHash(value), sortKey: stableString(value)}
}

function candidateIdentityDescriptor(candidate) {
  const input = candidateObject(candidate) || {}
  const origin = candidateObject(input.origin)
  const anchor = candidateAnchorDescriptor(input)
  const explicitId = string(input.id || input.proposalId || input.candidateId || origin?.proposalId || origin?.candidateId)
  if (explicitId) {
    return {base: explicitId, strategy: 'explicit', durable: true, requiresOccurrence: false, sortKey: explicitId}
  }

  // Agent output is often streamed through the same anonymous suggestion
  // record.  Do not hash the whole record here: replacement text, status,
  // citations and timestamps are mutable and would make one candidate become
  // a new DOM/layout identity on every retry.  Run/request IDs are the
  // strongest available identity when a provider supplies them.  A run may
  // legitimately contain several candidates, so its ID still needs an
  // occurrence anchor below.
  const runId = string(origin?.runId || origin?.run_id || input.runId || input.run_id)
  if (runId) {
    const base = `run:${runId}${anchor ? `:anchor:${anchor.hash}` : ''}`
    return {base, strategy: 'provider-run', durable: true, requiresOccurrence: true, anchor: anchor?.value, sortKey: `run:${runId}\u0000${anchor?.sortKey || ''}`}
  }
  const requestId = string(origin?.requestId || origin?.request_id || input.requestId || input.request_id)
  if (requestId) {
    const base = `request:${requestId}${anchor ? `:anchor:${anchor.hash}` : ''}`
    return {base, strategy: 'provider-request', durable: true, requiresOccurrence: true, anchor: anchor?.value, sortKey: `request:${requestId}\u0000${anchor?.sortKey || ''}`}
  }

  // Some adapters do not expose a provider ID but do carry a stable turn or
  // result identity.  These fields are preferred to any input array index and
  // are deliberately read from origin as well as the flattened candidate.
  for (const [name, ...keys] of [
    ['session', 'sessionId', 'session_id'], ['turn', 'turnId', 'turn_id'], ['item', 'itemId', 'item_id'],
    ['result', 'resultId', 'result_id'], ['event', 'eventId', 'event_id'],
  ]) {
    const value = string(keys.map(key => origin?.[key] || input[key]).find(Boolean))
    if (value) {
      const base = `${name}:${value}${anchor ? `:anchor:${anchor.hash}` : ''}`
      return {base, strategy: `provider-${name}`, durable: true, requiresOccurrence: true, anchor: anchor?.value, sortKey: `${name}:${value}\u0000${anchor?.sortKey || ''}`}
    }
  }

  // The comparison/suggestion shape has a stable text anchor even when it
  // does not have a provider-issued ID.  Keep the anchor and its base
  // revision, but intentionally exclude the candidate replacement/status so
  // a streaming update remains the same candidate.  Accept the common
  // targetAnchor/range aliases without copying the whole object into an ID.
  if (anchor) return {base: `anchor:${anchor.hash}`, strategy: 'anchor-occurrence', durable: true, requiresOccurrence: true, anchor: anchor.value, sortKey: anchor.sortKey}

  // Creation/sequence metadata is useful when an adapter has no provider ID.
  // It is more honest than using the current array index, which changes when
  // candidates are reordered.  `sequence`/`ordinal` are accepted only as
  // supplied metadata; the projection never creates them from the index.
  const createdAt = string(origin?.createdAt || input.createdAt || input.created || input.sequence || input.ordinal)
  if (createdAt) return {base: `anonymous:${stableHash({createdAt})}`, strategy: 'creation-occurrence', durable: true, requiresOccurrence: true, sortKey: `created:${createdAt}`}

  // Last-resort anonymous records have no information with which to
  // distinguish duplicates.  Hash the visible content only as a grouping
  // key, then assign an occurrence anchor over the deterministic candidate
  // order.  This is intentionally marked non-durable: if the upstream record
  // later acquires a stable ID or changes its only distinguishing text, no
  // projection can prove that it is the same object.  Equal records remain
  // addressable as occurrence 0/1/... but are not falsely presented as
  // individually durable identities.
  const visibleText = string(input.text || input.output || input.content || input.replacement)
  const label = string(input.label)
  const content = {text: visibleText, label}
  return {base: `anonymous:${stableHash(content)}`, strategy: 'content-occurrence', durable: false, requiresOccurrence: true, sortKey: stableString(content)}
}

function candidateOccurrenceSortKey(entry) {
  const input = candidateObject(entry.candidate) || {}
  const identity = entry.identity
  // Only use fields that are useful for deterministic ordering.  Never use
  // status/citations or an input index as the identity itself.  The index is a
  // final tie breaker for genuinely indistinguishable records; swapping two
  // such records is semantically unobservable and no stateless projection can
  // recover a distinction that was not present in the input.
  const visibleText = string(input.text || input.output || input.content || input.replacement)
  const label = string(input.label)
  return `${identity.sortKey}\u0000${stableString({text: visibleText, label})}`
}

function candidateIdentityRecords(candidates, scopeMatterIds = []) {
  const entries = array(candidates).map((candidate, index) => ({candidate, index, identity: candidateIdentityDescriptor(candidate)}))
  const groups = new Map()
  for (const entry of entries) {
    // Candidate node IDs are scoped by Matter.  Keep occurrence allocation in
    // that same scope so adding/removing a duplicate for another Matter cannot
    // renumber this Matter's anonymous candidates.
    const matterId = string(scopeMatterIds[entry.index] ?? entry.candidate?.matterId)
    const groupKey = `${matterId}\u0000${entry.identity.base}`
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey).push(entry)
  }
  for (const group of groups.values()) {
    const ordered = group.slice().sort((a, b) => candidateOccurrenceSortKey(a).localeCompare(candidateOccurrenceSortKey(b)) || a.index - b.index)
    const needsOccurrence = ordered.length > 1 || ordered[0]?.identity.requiresOccurrence
    for (let occurrence = 0; occurrence < ordered.length; occurrence += 1) {
      const entry = ordered[occurrence]
      entry.occurrence = occurrence
      entry.objectId = needsOccurrence ? `${entry.identity.base}:occurrence:${occurrence}` : entry.identity.base
      // A provider/run/anchor key is durable only while it names one
      // candidate.  Once several candidates share that key, the occurrence is
      // an honest current-snapshot slot rather than a durable per-candidate
      // identity (there is no source field left to tell them apart).
      entry.identity = {...entry.identity, occurrence, needsOccurrence, durable: entry.identity.durable && ordered.length === 1}
    }
  }
  return entries.sort((a, b) => a.index - b.index)
}

function candidateObjectId(candidate, occurrence = null) {
  const identity = candidateIdentityDescriptor(candidate)
  return occurrence == null || !identity.requiresOccurrence ? identity.base : `${identity.base}:occurrence:${occurrence}`
}

function candidateIdentityMetadata(entry) {
  const identity = entry?.identity || candidateIdentityDescriptor(entry?.candidate)
  return {
    strategy: identity.strategy,
    durable: identity.durable,
    occurrence: Number.isInteger(identity.occurrence) ? identity.occurrence : null,
    ...(identity.anchor ? {anchor: copy(identity.anchor)} : {}),
  }
}

function statusForResult(result, pending = false) {
  if (pending || result?.decision === 'pending' || result?.status === 'pending') return 'returned'
  if (result?.decision === 'revised' || result?.returned === true || result?.status === 'returned') return 'returned'
  return nonempty(result?.fact) ? 'returned' : 'unresolved'
}

function buildPosition(nodeItem, row, ordinal) {
  const xByType = {
    matter: 70,
    original: 310,
    source: 560,
    understanding: 810,
    discussion: 810,
    'agent-candidate': 1060,
    work: 1060,
    result: 1310,
    revision: 1310,
  }
  const yOffsets = {
    matter: 70,
    original: 35,
    source: 20,
    understanding: 45,
    discussion: 145,
    'agent-candidate': 20,
    work: 155,
    result: 20,
    revision: 155,
  }
  const height = nodeItem.type === 'source' || nodeItem.type === 'agent-candidate' ? 74 : 92
  const width = nodeItem.type === 'matter' ? 200 : 210
  return {x: xByType[nodeItem.type] ?? 70, y: 70 + row * 260 + (yOffsets[nodeItem.type] ?? ordinal * 100), width, height}
}

function readPosition(overrides, item) {
  const map = asMap(overrides)
  const variants = [item.id, item.objectId, `${item.type}:${item.objectId}`, item.type]
  let value
  for (const key of variants) {
    if (own(map, key)) { value = map[key]; break }
  }
  if (!value || typeof value !== 'object' || !finite(value.x) || !finite(value.y)) return null
  return {
    x: value.x,
    y: value.y,
    ...(finite(value.width) ? {width: value.width} : {}),
    ...(finite(value.height) ? {height: value.height} : {}),
  }
}

function pushEdge(edges, seen, from, to, relation, fields = {}) {
  if (!from || !to || from === to) return
  const id = `edge:${from}->${to}:${relation}`
  if (seen.has(id)) return
  seen.add(id)
  edges.push({id, from, to, relation, type: relation, status: fields.status ?? 'confirmed', ...fields})
}

/**
 * Project one Product Workspace host into a detached Attention Canvas model.
 *
 * Options:
 *   - `matterId`: restrict the projection to this Matter.  Without it all
 *     real Matters are shown and the host selectedId is used for the reader.
 *   - `workId`: additionally restrict work nodes to one work record.
 *   - `focus`: a semantic focus object or a raw node/object id.
 *   - `positionOverrides`: UI-only world positions keyed by node id/object id.
 *     `positions` and `uiPositions` are accepted aliases for integrations.
 */
export function projectAttentionCanvas(host = {}, options = {}) {
  const chain = host?.chain && typeof host.chain === 'object' ? host.chain : {}
  const allMatters = array(chain.matters).filter(item => nonempty(item?.id))
  const requestedMatterId = options.matterId ?? null
  const selectedMatterId = requestedMatterId || chain.selectedId || allMatters[0]?.id || null
  const selectedMatter = allMatters.find(item => item.id === selectedMatterId) || null
  const scopeMatters = requestedMatterId
    ? allMatters.filter(item => item.id === requestedMatterId)
    : options.allMatters === false && selectedMatter ? [selectedMatter] : allMatters.slice()
  const matterSet = new Set(scopeMatters.map(item => item.id))
  const sources = array(chain.sources).filter(item => nonempty(item?.id))
  const sourceById = new Map(sources.map(item => [item.id, item]))
  const sessions = chain.sessions && typeof chain.sessions === 'object' ? chain.sessions : {}
  const worksite = host?.worksite && typeof host.worksite === 'object' ? host.worksite : {}
  const worksById = worksite.works && typeof worksite.works === 'object' ? worksite.works : {}
  const workSessions = worksite.sessions && typeof worksite.sessions === 'object' ? worksite.sessions : {}
  const agentCandidates = array(options.agentCandidates)
  // Allocate candidate occurrence identities once across both the canonical
  // session suggestion and the optional multi-candidate API.  Otherwise a
  // suggestion and an API candidate with the same anonymous anchor could be
  // assigned the same node ID simply because they are projected in separate
  // loops.
  const suggestionIdentityIndexByMatter = new Map()
  const candidateIdentityInputs = []
  const candidateIdentityScopes = []
  for (const matter of scopeMatters) {
    const suggestion = sessions[matter.id]?.suggestion
    if (!suggestion || typeof suggestion !== 'object') continue
    suggestionIdentityIndexByMatter.set(matter.id, candidateIdentityInputs.length)
    candidateIdentityInputs.push(suggestion)
    candidateIdentityScopes.push(matter.id)
  }
  const optionCandidateIdentityStart = candidateIdentityInputs.length
  candidateIdentityInputs.push(...agentCandidates)
  candidateIdentityScopes.push(...agentCandidates.map(candidate => candidate?.matterId))
  const candidateIdentityEntries = candidateIdentityRecords(candidateIdentityInputs, candidateIdentityScopes)
  const nodes = []
  const edges = []
  const seenEdges = new Set()
  const provenance = []
  const unresolved = new Set()
  const returned = new Set()
  const unresolvedNodes = []
  const returnedNodes = []
  const matterNodeByMatter = new Map()
  const sourceNodeBySource = new Map()
  const userNodeByMatter = new Map()
  const candidateNodesByMatter = new Map()
  const resultNodesByMatter = new Map()
  const revisionNodesByMatter = new Map()

  const addNode = item => { nodes.push(item); return item }
  const markUnresolved = (code, item) => {
    unresolved.add(code)
    if (item?.id) unresolvedNodes.push(item.id)
  }
  const markReturned = item => {
    if (!item?.id) return
    returned.add(item.id)
    returnedNodes.push(item.id)
  }

  // A Matter row is the only root of a scoped graph.  Empty content is kept
  // as an explicit missing state; no title or text is borrowed from another
  // lane to fill the gap.
  for (const matter of scopeMatters.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    const matterNode = addNode(node('matter', matter.id, matter.id, {
      lane: 'matter',
      title: titleOf(matter),
      text: nonempty(matter.whyCare) ? matter.whyCare : null,
      status: 'available',
      authorship: 'user',
      sourceStatus: 'user-capture',
      isDemo: matter.origin === 'demo',
      contentVersion: safeVersion(matter.originalTextVersion),
    }))
    matterNodeByMatter.set(matter.id, matterNode)

    const originalText = string(matter.originalText)
    const original = addNode(node('original', matter.originalExpressionId || `${matter.id}:original`, matter.id, {
      lane: 'original',
      title: '原文与原现场',
      text: nonempty(originalText) ? originalText : null,
      status: nonempty(originalText) ? 'available' : 'missing',
      authorship: 'user',
      sourceStatus: nonempty(originalText) ? 'user-capture' : 'missing',
      contentVersion: versionOr(matter.originalTextVersion, 1),
      provenance: {type: 'user-capture', origin: matter.origin ?? 'user', matterId: matter.id, sourceIds: sourceIdsForMatter(matter)},
    }))
    pushEdge(edges, seenEdges, matterNode.id, original.id, 'captures', {status: original.status === 'available' ? 'confirmed' : 'unresolved'})
    if (original.status === 'missing') markUnresolved('original', original)

    const savedUnderstanding = string(matter.understanding)
    const draftUnderstanding = string(matter.understandingDraft)
    const understanding = addNode(node('understanding', `${matter.id}:understanding`, matter.id, {
      lane: 'user',
      title: '我的理解',
      text: nonempty(savedUnderstanding) ? savedUnderstanding : null,
      draft: draftUnderstanding !== savedUnderstanding && nonempty(draftUnderstanding) ? draftUnderstanding : null,
      status: nonempty(savedUnderstanding) ? (draftUnderstanding !== savedUnderstanding ? 'draft' : 'confirmed') : nonempty(draftUnderstanding) ? 'draft' : 'unresolved',
      authorship: 'user',
      sourceStatus: 'user-authored',
      contentVersion: safeVersion(matter.understandingVersion),
      draftVersion: safeVersion(matter.understandingDraftVersion),
      unresolved: nonempty(savedUnderstanding) ? [] : ['understanding'],
      stop: nonempty(matter.stop) ? matter.stop : null,
      stopDraft: nonempty(matter.stopDraft) && matter.stopDraft !== matter.stop ? matter.stopDraft : null,
      stopVersion: safeVersion(matter.stopVersion),
    }))
    userNodeByMatter.set(matter.id, understanding)
    pushEdge(edges, seenEdges, matterNode.id, understanding.id, 'understanding', {status: understanding.status === 'unresolved' ? 'unresolved' : 'confirmed'})
    if (understanding.status === 'unresolved') markUnresolved('understanding', understanding)
    if (!nonempty(matter.stop)) markUnresolved('stop', understanding)

    const messageNodes = []
    const session = sessions[matter.id] || {}
    for (const [index, message] of array(session.discussion?.messages).entries()) {
      if (!nonempty(message?.text) || !message?.id) continue
      const role = message.role === 'assistant' || message.role === 'agent' ? 'agent' : 'user'
      if (role === 'agent') {
        // Legacy/host messages are not silently promoted to user understanding.
        const candidate = addNode(node('agent-candidate', `message:${message.id}`, matter.id, {
          lane: 'agent',
          title: 'Agent 解读 · 候选',
          text: message.text,
          status: 'unconfirmed',
          authorship: 'agent',
          sourceStatus: 'agent-output',
          provenance: {type: 'agent-message', messageId: message.id, status: 'unconfirmed'},
          candidate: {messageId: message.id, contextMode: message.contextMode ?? null},
        }))
        if (!candidateNodesByMatter.has(matter.id)) candidateNodesByMatter.set(matter.id, [])
        candidateNodesByMatter.get(matter.id).push(candidate)
        markUnresolved('agent', candidate)
        continue
      }
      const discussion = addNode(node('discussion', `${matter.id}:discussion:${message.id}`, matter.id, {
        lane: 'user',
        title: '本次表达',
        text: message.text,
        status: 'available',
        authorship: 'user',
        sourceStatus: 'user-authored',
        contentVersion: versionOr(message.contentVersion, 1),
        contextMode: message.contextMode ?? session.contextMode ?? 'resume',
        contextEpoch: safeVersion(message.contextEpoch),
      }))
      messageNodes.push(discussion)
      pushEdge(edges, seenEdges, matterNode.id, discussion.id, 'discussion', {status: 'confirmed'})
      // Keep deterministic fallback use of index out of the identity.  The
      // index is only retained in the node's UI metadata for callers that
      // want to preserve source ordering.
      discussion.ordinal = index
    }
    if (messageNodes.length) pushEdge(edges, seenEdges, messageNodes.at(-1).id, understanding.id, 'continues', {status: 'unresolved'})

    const matterSourceIds = sourceIdsForMatter(matter)
    for (const sourceId of matterSourceIds.slice().sort()) {
      const source = sourceById.get(sourceId)
      if (!source) {
        markUnresolved('source', {id: idFor('source', sourceId, matter.id)})
        provenance.push(sourceProvenance(null, {sourceId, matterId: matter.id}))
        continue
      }
      const existing = sourceNodeBySource.get(source.id)
      const sourceNode = existing || addNode(node('source', source.id, null, {
        lane: 'original',
        title: string(source.title) || '来源摘录',
        text: nonempty(source.excerpt) ? source.excerpt : null,
        status: sourceStatus(source),
        authorship: sourceKind(source) === 'external' ? 'external' : 'user',
        sourceStatus: sourceStatus(source),
        provenance: sourceProvenance(source, {matterId: matter.id}),
        contentVersion: versionOr(source.contentVersion, 1),
        url: source.url ?? null,
        matterIds: [matter.id],
      }))
      sourceNodeBySource.set(source.id, sourceNode)
      if (existing && !array(existing.matterIds).includes(matter.id)) existing.matterIds = [...array(existing.matterIds), matter.id].sort()
      provenance.push(copy(sourceNode.provenance))
      pushEdge(edges, seenEdges, matterNode.id, sourceNode.id, 'source', {status: sourceNode.status === 'available' ? 'confirmed' : 'unresolved', sourceId: source.id})
      if (sourceNode.status !== 'available') markUnresolved('source', sourceNode)
    }

    // A current suggestion is a candidate even when the candidate was
    // accepted into a draft.  It is never represented as a saved user node.
    const suggestions = []
    if (session.suggestion && typeof session.suggestion === 'object') suggestions.push(session.suggestion)
    for (const candidate of suggestions) {
      const identityIndex = suggestionIdentityIndexByMatter.get(matter.id)
      const identity = identityIndex == null ? null : candidateIdentityEntries[identityIndex]
      const objectId = identity?.objectId || candidateObjectId(candidate)
      const candidateNode = addNode(node('agent-candidate', objectId, matter.id, {
        lane: 'agent',
        title: 'Agent 解读 · 候选',
        text: nonempty(candidate.replacement) ? candidate.replacement : null,
        status: candidateStatus(candidate),
        authorship: 'agent',
        sourceStatus: 'agent-output',
        provenance: candidateOrigin(candidate),
        identity: candidateIdentityMetadata(identity),
        candidate: {
          original: string(candidate.original),
          replacement: string(candidate.replacement),
          start: Number.isInteger(candidate.start) ? candidate.start : null,
          end: Number.isInteger(candidate.end) ? candidate.end : null,
          baseVersion: safeVersion(candidate.baseVersion),
          baseDraftVersion: safeVersion(candidate.baseDraftVersion),
        },
      }))
      if (!candidateNodesByMatter.has(matter.id)) candidateNodesByMatter.set(matter.id, [])
      candidateNodesByMatter.get(matter.id).push(candidateNode)
      pushEdge(edges, seenEdges, candidateNode.id, understanding.id, 'suggests', {status: candidateNode.status === 'accepted' ? 'confirmed' : 'unresolved', proposalId: candidateNode.id})
      if (candidateNode.status !== 'accepted') markUnresolved('agent', candidateNode)
    }

    const matterLinks = array(matter.links)
    for (const link of matterLinks) {
      const sourceNode = sourceNodeBySource.get(link?.sourceId)
      const targetNode = link?.focus?.field === 'understanding' ? understanding : link?.focus?.field === 'originalText' ? original : link?.focus?.field === 'discussion' ? messageNodes.find(item => item.objectId === link.focus.objectId) || understanding : understanding
      if (sourceNode && targetNode) pushEdge(edges, seenEdges, sourceNode.id, targetNode.id, link?.relationship?.type || 'related', {
        status: link?.status || (link?.relationship?.confirmed === false ? 'unresolved' : 'confirmed'),
        sourceId: link.sourceId,
        provenance: sourceNode.provenance,
      })
      else if (link?.sourceId) markUnresolved('source', {id: idFor('source', link.sourceId, matter.id)})
    }

    const matterRevisions = array(matter.revisions)
    const revisionNodes = []
    for (const revision of matterRevisions) {
      if (!revision?.id) continue
      const revisionNode = addNode(node('revision', revision.id, matter.id, {
        lane: 'user',
        title: '理解修订',
        text: nonempty(revision.after) ? revision.after : null,
        status: revision.undone || revision.undoneBy ? 'undone' : 'confirmed',
        authorship: 'user',
        sourceStatus: 'user-authored',
        before: revision.before ?? null,
        after: revision.after ?? null,
        beforeVersion: safeVersion(revision.beforeVersion),
        afterVersion: safeVersion(revision.afterVersion),
        resultId: revision.resultId ?? null,
        provenance: revision.origin ? copy(revision.origin) : {type: 'user-confirmed'},
      }))
      revisionNodes.push(revisionNode)
      pushEdge(edges, seenEdges, revisionNode.id, understanding.id, 'revises', {status: revisionNode.status === 'confirmed' ? 'confirmed' : 'returned'})
      if (revisionNode.status === 'confirmed') markReturned(revisionNode)
    }
    if (revisionNodes.length) revisionNodesByMatter.set(matter.id, revisionNodes)

    // A review is a proposal until the worksite command confirms it.
    for (const [workId, sessionValue] of Object.entries(workSessions)) {
      if (sessionValue?.review?.open && sessionValue.review.matterId === matter.id) {
        const proposalId = `review:${workId}:${matter.id}`
        const proposal = addNode(node('revision', proposalId, matter.id, {
          lane: 'agent',
          title: '修订候选 · 尚未确认',
          text: nonempty(sessionValue.review.after) ? sessionValue.review.after : null,
          status: sessionValue.review.stale ? 'stale' : 'unconfirmed',
          authorship: 'user-review',
          sourceStatus: 'work-result',
          before: sessionValue.review.before ?? null,
          after: sessionValue.review.after ?? null,
          baseVersion: safeVersion(sessionValue.review.baseVersion),
          proposal: true,
          provenance: {type: 'work-review', workId, status: sessionValue.review.stale ? 'stale' : 'unconfirmed'},
        }))
        if (!revisionNodesByMatter.has(matter.id)) revisionNodesByMatter.set(matter.id, [])
        revisionNodesByMatter.get(matter.id).push(proposal)
        pushEdge(edges, seenEdges, proposal.id, understanding.id, 'proposes-revision', {status: proposal.status === 'stale' ? 'stale' : 'unresolved', workId})
        markUnresolved('revision', proposal)
      }
    }
  }

  // Sources with no owner are not attached to a Matter.  They are retained as
  // explicit source nodes only in the all-Matter view, never copied into a
  // Matter's original or user lane.
  if (!requestedMatterId && options.includeUnassignedSources !== false) {
    for (const source of sources.slice().sort((a, b) => a.id.localeCompare(b.id))) {
      if (sourceNodeBySource.has(source.id) || source.ownerMatterId) continue
      const sourceNode = addNode(node('source', source.id, null, {
        lane: 'original',
        title: string(source.title) || '未归属来源摘录',
        text: nonempty(source.excerpt) ? source.excerpt : null,
        status: sourceStatus(source),
        authorship: sourceKind(source) === 'external' ? 'external' : 'user',
        sourceStatus: sourceStatus(source),
        provenance: sourceProvenance(source),
        contentVersion: versionOr(source.contentVersion, 1),
        url: source.url ?? null,
        unresolved: 'unassigned',
      }))
      sourceNodeBySource.set(source.id, sourceNode)
      provenance.push(copy(sourceNode.provenance))
      if (sourceNode.status !== 'available') markUnresolved('source', sourceNode)
    }
  }

  // Comparison catalogs are read-only candidates until the user explicitly
  // imports/links one.  They therefore remain source-lane candidates rather
  // than becoming a canonical SourceSnapshot or a user understanding.
  const comparisonSessions = host?.comparisons && typeof host.comparisons === 'object' ? host.comparisons : {}
  for (const [sessionId, comparison] of Object.entries(comparisonSessions)) {
    const comparisonMatterId = comparison?.matterId
    if (!matterSet.has(comparisonMatterId)) continue
    const model = comparison.model || comparison
    const catalog = array(model?.catalog)
    const visibleIds = array(model?.candidateIds)
    const candidates = (visibleIds.length ? visibleIds.map(id => catalog.find(item => item?.id === id)).filter(Boolean) : catalog).slice().sort((a, b) => string(a.id).localeCompare(string(b.id)))
    for (const candidate of candidates) {
      if (!candidate?.id || !nonempty(candidate.excerpt) || sourceNodeBySource.has(`comparison:${sessionId}:${candidate.id}`)) continue
      const candidateSourceId = `comparison:${sessionId}:${candidate.id}`
      const sourceNode = addNode(node('source', candidateSourceId, null, {
        lane: 'original',
        title: string(candidate.title) || '对照候选',
        text: candidate.excerpt,
        status: 'unconfirmed',
        authorship: candidate.kind === 'external' ? 'external' : 'candidate',
        sourceStatus: 'candidate',
        matterIds: [comparisonMatterId],
        url: candidate.url ?? null,
        provenance: {
          type: 'comparison-candidate',
          sessionId,
          candidateId: candidate.id,
          sourceKind: candidate.kind ?? 'unknown',
          status: 'unconfirmed',
          ...(candidate.provider ? {provider: candidate.provider} : {}),
          ...(candidate.author ? {author: candidate.author} : {}),
        },
        candidate: true,
      }))
      sourceNodeBySource.set(candidateSourceId, sourceNode)
      provenance.push(copy(sourceNode.provenance))
      const matterNode = matterNodeByMatter.get(comparisonMatterId)
      if (matterNode) pushEdge(edges, seenEdges, matterNode.id, sourceNode.id, 'candidate-source', {status: 'unresolved', sessionId})
      markUnresolved('source', sourceNode)
    }
  }

  const workNodesByMatter = new Map()
  const workEntries = Object.values(worksById).filter(work => meaningfulWork(work, workSessions[work?.id]))
    .filter(work => !options.workId || work.id === options.workId)
    .sort((a, b) => string(a.id).localeCompare(string(b.id)))
  for (const work of workEntries) {
    const session = workSessions[work.id] || {}
    const intake = array(session.intake).filter(item => matterSet.has(item?.matterId))
    const resultRecords = array(session.results).filter(result => matterSet.has(result?.matterId))
    const pendingResult = session.result && matterSet.has(session.result.matterId) && nonempty(session.result.fact) ? session.result : null
    const matterIds = unique([...intake.map(item => item.matterId), ...resultRecords.map(item => item.matterId), pendingResult?.matterId]).sort()
    if (requestedMatterId && !matterIds.includes(requestedMatterId) && options.workId !== work.id) continue
    const returnedStatus = session.connection?.status === 'returned_for_review' || resultRecords.length > 0 || !!pendingResult
    const workNode = addNode(node('work', work.id, matterIds.length === 1 ? matterIds[0] : null, {
      lane: 'work',
      title: string(work.title) || '工作现场',
      text: null,
      status: returnedStatus ? 'returned' : work.connected || session.connection?.status === 'received' ? 'connected' : 'unresolved',
      authorship: 'user',
      sourceStatus: work.connected ? 'connected' : 'not-connected',
      agent: string(work.agent) || null,
      project: string(work.project) || null,
      connection: work.connection ? copy(work.connection) : null,
      contextMode: session.contextMode ?? null,
      matterIds,
    }))
    if (returnedStatus) markReturned(workNode); else if (workNode.status === 'unresolved') markUnresolved('work', workNode)
    for (const matterId of matterIds) {
      if (!workNodesByMatter.has(matterId)) workNodesByMatter.set(matterId, [])
      workNodesByMatter.get(matterId).push(workNode)
      const matterNode = matterNodeByMatter.get(matterId)
      if (matterNode) pushEdge(edges, seenEdges, matterNode.id, workNode.id, 'handoff', {status: workNode.status === 'unresolved' ? 'unresolved' : 'confirmed', workId: work.id})
    }
    // Findings are real work records.  They are represented as source-lane
    // evidence with their work provenance, never as a new understanding.
    for (const finding of array(session.findings)) {
      if (!finding?.id || !matterSet.has(finding.matterId) || !nonempty(finding.text)) continue
      const findingSourceId = `finding:${work.id}:${finding.id}`
      const findingNode = addNode(node('source', findingSourceId, null, {
        lane: 'original',
        title: string(finding.source?.title) || '本次工作发现',
        text: finding.text,
        status: 'available',
        authorship: 'user',
        sourceStatus: 'work-return',
        matterIds: [finding.matterId],
        provenance: {type: 'work-finding', workId: work.id, findingId: finding.id, matterId: finding.matterId, status: 'available'},
        contentVersion: 1,
      }))
      sourceNodeBySource.set(findingSourceId, findingNode)
      provenance.push(copy(findingNode.provenance))
      pushEdge(edges, seenEdges, workNode.id, findingNode.id, 'finding', {status: finding.saved === false ? 'unresolved' : 'confirmed', workId: work.id})
      const matterNode = matterNodeByMatter.get(finding.matterId)
      if (matterNode) pushEdge(edges, seenEdges, matterNode.id, findingNode.id, 'work-evidence', {status: finding.relation === 'pending' ? 'unresolved' : 'confirmed', workId: work.id})
    }
    const resultNodes = []
    for (const result of [...resultRecords, ...(pendingResult && !resultRecords.some(item => item.id && item.id === pendingResult.id) ? [pendingResult] : [])]) {
      const resultId = result.id || `pending:${work.id}:${result.matterId}`
      if (nodes.some(item => item.id === idFor('result', resultId, result.matterId))) continue
      const resultNode = addNode(node('result', resultId, result.matterId, {
        lane: 'work',
        title: '工作结果',
        text: nonempty(result.fact) ? result.fact : null,
        status: statusForResult(result, result === pendingResult),
        authorship: result.origin === 'agent' ? 'agent' : 'user',
        sourceStatus: result.isDemo === true ? 'example' : 'work-return',
        fact: nonempty(result.fact) ? result.fact : null,
        interpretation: nonempty(result.interpretation) ? result.interpretation : null,
        unconfirmed: nonempty(result.unconfirmed) ? result.unconfirmed : null,
        proposedUnderstanding: nonempty(result.proposedUnderstanding) ? result.proposedUnderstanding : null,
        decision: result.decision ?? 'pending',
        workId: work.id,
        provenance: {type: 'work-result', workId: work.id, resultId, status: statusForResult(result, result === pendingResult)},
      }))
      resultNodes.push(resultNode)
      if (resultNode.status === 'returned') markReturned(resultNode); else markUnresolved('result', resultNode)
      const matterNode = matterNodeByMatter.get(result.matterId)
      if (matterNode) pushEdge(edges, seenEdges, workNode.id, resultNode.id, 'returns', {status: 'confirmed', workId: work.id})
      const understanding = userNodeByMatter.get(result.matterId)
      if (understanding && result.decision === 'revised') pushEdge(edges, seenEdges, resultNode.id, understanding.id, 'changed-understanding', {status: 'confirmed'})
    }
    for (const result of resultNodes) {
      if (!resultNodesByMatter.has(result.matterId)) resultNodesByMatter.set(result.matterId, [])
      resultNodesByMatter.get(result.matterId).push(result)
    }
  }

  // Chain-owned result records can exist before/without a worksite record.
  for (const matter of scopeMatters) {
    const matterNode = matterNodeByMatter.get(matter.id)
    for (const result of array(matter.results)) {
      if (!result?.id || nodes.some(item => item.id === idFor('result', result.id, matter.id))) continue
      const resultNode = addNode(node('result', result.id, matter.id, {
        lane: 'work', title: '工作结果', text: nonempty(result.fact) ? result.fact : null,
        status: statusForResult(result), authorship: 'user', sourceStatus: result.origin === 'example' ? 'example' : 'work-return',
        fact: nonempty(result.fact) ? result.fact : null,
        interpretation: nonempty(result.interpretation) ? result.interpretation : null,
        unconfirmed: nonempty(result.unconfirmed) ? result.unconfirmed : null,
        decision: result.decision ?? 'result-only', workId: result.workId ?? null,
        provenance: {type: 'work-result', workId: result.workId ?? null, resultId: result.id, status: statusForResult(result)},
      }))
      if (!resultNodesByMatter.has(matter.id)) resultNodesByMatter.set(matter.id, [])
      resultNodesByMatter.get(matter.id).push(resultNode)
      if (resultNode.status === 'returned') markReturned(resultNode); else markUnresolved('result', resultNode)
      if (matterNode) pushEdge(edges, seenEdges, matterNode.id, resultNode.id, 'result', {status: 'confirmed'})
    }
  }

  const agentCandidateEntries = candidateIdentityEntries.slice(optionCandidateIdentityStart)
  for (const entry of agentCandidateEntries) {
    const {candidate} = entry
    if (!candidate || !matterSet.has(candidate.matterId)) continue
    const matter = scopeMatters.find(item => item.id === candidate.matterId)
    const understanding = userNodeByMatter.get(candidate.matterId)
    if (!matter || !understanding) continue
    const candidateNode = addNode(node('agent-candidate', entry.objectId || candidateObjectId(candidate), candidate.matterId, {
      lane: 'agent', title: 'Agent 解读 · 候选', text: nonempty(candidate.text ?? candidate.replacement) ? (candidate.text ?? candidate.replacement) : null,
      status: candidateStatus(candidate), authorship: 'agent', sourceStatus: 'agent-output',
      provenance: candidateOrigin(candidate), identity: candidateIdentityMetadata(entry), candidate: copy(candidate),
    }))
    if (!candidateNodesByMatter.has(matter.id)) candidateNodesByMatter.set(matter.id, [])
    candidateNodesByMatter.get(matter.id).push(candidateNode)
    pushEdge(edges, seenEdges, candidateNode.id, understanding.id, 'suggests', {status: candidateNode.status === 'accepted' ? 'confirmed' : 'unresolved'})
    if (candidateNode.status !== 'accepted') markUnresolved('agent', candidateNode)
  }

  // Stable layout is calculated only after all real nodes are known.  Sorting
  // by canonical IDs makes object insertion order irrelevant.
  const matterOrder = scopeMatters.map(item => item.id).sort()
  const rowByMatter = new Map(matterOrder.map((id, index) => [id, index]))
  const unassignedRow = matterOrder.length
  const perTypeOrdinal = new Map()
  for (const item of nodes.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    const key = `${item.matterId ?? '__unassigned__'}:${item.type}`
    const ordinal = perTypeOrdinal.get(key) ?? 0
    perTypeOrdinal.set(key, ordinal + 1)
    const positionMatterId = item.matterId ?? array(item.matterIds)[0] ?? null
    const row = positionMatterId && rowByMatter.has(positionMatterId) ? rowByMatter.get(positionMatterId) : unassignedRow
    const defaultPosition = buildPosition(item, row, ordinal)
    const override = readPosition(options.positionOverrides ?? options.positions ?? options.uiPositions, item)
    item.position = override ? {...defaultPosition, ...override} : defaultPosition
    item.world = {x: item.position.x, y: item.position.y}
    item.layoutSource = override ? 'ui-override' : 'stable-default'
  }

  const nodesById = new Map(nodes.map(item => [item.id, item]))
  for (const item of nodes) {
    item.state = {
      unresolved: ['missing', 'unresolved', 'unconfirmed', 'generating', 'failed', 'stale'].includes(item.status),
      returned: returned.has(item.id) || item.status === 'returned',
      confirmed: ['available', 'confirmed', 'connected', 'accepted'].includes(item.status),
    }
  }
  const nodeIdsByObject = new Map()
  for (const item of nodes) {
    if (!nodeIdsByObject.has(item.objectId)) nodeIdsByObject.set(item.objectId, [])
    nodeIdsByObject.get(item.objectId).push(item.id)
  }
  const session = selectedMatterId ? sessions[selectedMatterId] || {} : {}
  const requestedFocus = options.focus || session.focus || null
  const focus = normalizeFocus(requestedFocus, selectedMatterId, nodesById, nodeIdsByObject)
  const selectedSources = selectedMatter ? sourceIdsForMatter(selectedMatter).map(sourceId => sourceProvenance(sourceById.get(sourceId), {sourceId, matterId: selectedMatter.id})) : []
  const selectedCandidates = candidateNodesByMatter.get(selectedMatterId) || []
  const selectedWorks = workNodesByMatter.get(selectedMatterId) || []
  const selectedResults = resultNodesByMatter.get(selectedMatterId) || []
  const selectedRevisions = revisionNodesByMatter.get(selectedMatterId) || []
  const selectedOriginal = selectedMatter ? nodes.find(item => item.type === 'original' && item.matterId === selectedMatter.id) : null
  const selectedUnderstanding = userNodeByMatter.get(selectedMatterId) || null
  const selectedSourceNodes = selectedMatter ? nodes.filter(item => item.type === 'source' && (item.matterId === selectedMatter.id || array(item.matterIds).includes(selectedMatter.id))) : []
  const selectedUnresolved = selectedMatter ? [...new Set([...unresolved])].filter(code => {
    if (code === 'original') return selectedOriginal?.status === 'missing'
    if (code === 'understanding') return selectedUnderstanding?.status === 'unresolved'
    if (code === 'stop') return !nonempty(selectedMatter.stop)
    if (code === 'source') return selectedSources.some(item => item.status !== 'available') || selectedSourceNodes.some(item => item.status !== 'available')
    if (code === 'agent') return selectedCandidates.some(item => !['accepted', 'dismissed'].includes(item.status))
    if (code === 'work') return selectedWorks.some(item => item.status === 'unresolved')
    if (code === 'result') return selectedResults.some(item => item.status === 'unresolved')
    if (code === 'revision') return selectedRevisions.some(item => ['unconfirmed', 'stale'].includes(item.status))
    return true
  }) : []
  const selectedReturned = selectedMatter ? [...new Set([...returned])].filter(id => {
    const item = nodesById.get(id)
    return item?.matterId === selectedMatter.id || array(item?.matterIds).includes(selectedMatter.id)
  }) : []
  const agentStatus = selectedCandidates.length ? (selectedCandidates.some(item => item.status === 'generating') ? 'generating' : selectedCandidates.some(item => item.status === 'failed') ? 'failed' : selectedCandidates.some(item => item.status === 'unconfirmed' || item.status === 'stale') ? 'unconfirmed' : 'available') : 'not-requested'
  const sourceStatuses = [...selectedSources.map(item => item.status), ...selectedSourceNodes.map(item => item.status)]
  const sourceStatusSummary = sourceStatuses.length ? (sourceStatuses.includes('denied') ? 'denied' : sourceStatuses.includes('changed') ? 'changed' : sourceStatuses.every(status => status === 'available') ? 'available' : 'unresolved') : selectedMatter ? 'unresolved' : 'none'
  const laneOriginal = {
    lane: 'original', label: '原文与原现场，只读', status: selectedMatter ? (nonempty(selectedMatter.originalText) ? 'available' : 'missing') : 'none',
    nodeIds: nodes.filter(item => item.matterId === selectedMatterId && (item.type === 'original' || item.type === 'source')).map(item => item.id),
    original: selectedMatter ? nodes.find(item => item.type === 'original' && item.matterId === selectedMatterId) ?? null : null,
    sources: nodes.filter(item => item.type === 'source' && (item.matterId === selectedMatterId || array(item.matterIds).includes(selectedMatterId))).map(copy),
    sourceProvenance: copy(selectedSources),
  }
  const laneUser = {
    lane: 'user', label: '我的理解', status: selectedMatter ? (nonempty(selectedMatter.understanding) ? 'available' : 'unresolved') : 'none',
    nodeIds: nodes.filter(item => item.matterId === selectedMatterId && (item.type === 'understanding' || item.type === 'discussion')).map(item => item.id),
    understanding: userNodeByMatter.get(selectedMatterId) ? copy(userNodeByMatter.get(selectedMatterId)) : null,
    stop: selectedMatter ? {text: nonempty(selectedMatter.stop) ? selectedMatter.stop : null, draft: nonempty(selectedMatter.stopDraft) && selectedMatter.stopDraft !== selectedMatter.stop ? selectedMatter.stopDraft : null, version: safeVersion(selectedMatter.stopVersion)} : null,
  }
  const laneAgent = {
    lane: 'agent', label: 'Agent 解读 · 候选', status: agentStatus,
    nodeIds: selectedCandidates.map(item => item.id), candidates: selectedCandidates.map(copy),
    notice: selectedCandidates.length ? '候选尚未自动写入我的理解。' : '尚未请求 Agent 解读。',
  }
  const reader = {
    matterId: selectedMatter?.id ?? null,
    title: selectedMatter ? titleOf(selectedMatter) : null,
    contextMode: session.contextMode ?? 'resume',
    contextEpoch: safeVersion(session.contextEpoch),
    lanes: {original: laneOriginal, user: laneUser, agent: laneAgent},
    original: laneOriginal,
    originalText: laneOriginal.original,
    understanding: laneUser,
    userUnderstanding: laneUser.understanding,
    agent: laneAgent,
    agentCandidates: laneAgent.candidates,
    work: {status: selectedWorks.length ? selectedWorks.some(item => item.status === 'returned') ? 'returned' : 'available' : 'none', nodes: selectedWorks.map(copy)},
    results: {status: selectedResults.length ? 'returned' : 'none', nodes: selectedResults.map(copy)},
    workResults: selectedResults.map(copy),
    revisions: {status: selectedRevisions.some(item => item.status === 'unconfirmed') ? 'unconfirmed' : selectedRevisions.length ? 'available' : 'none', nodes: selectedRevisions.map(copy)},
    focus: copy(focus),
    sourceProvenance: copy(selectedSources),
    unresolved: copy(selectedUnresolved),
    returned: copy(selectedReturned),
  }
  const statuses = {
    workspace: allMatters.length ? 'ready' : 'empty',
    matter: selectedMatter ? 'available' : requestedMatterId ? 'unresolved' : 'none',
    source: sourceStatusSummary,
    understanding: selectedMatter ? (nonempty(selectedMatter.understanding) ? 'available' : 'unresolved') : 'none',
    agent: agentStatus,
    work: reader.work.status,
    result: reader.results.status,
    revision: reader.revisions.status,
  }
  const projection = {
    schemaVersion: ATTENTION_PROJECTION_VERSION,
    matterId: selectedMatter?.id ?? requestedMatterId ?? null,
    matterIds: scopeMatters.map(item => item.id).sort(),
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges.sort((a, b) => a.id.localeCompare(b.id)),
    reader: copy(reader),
    readerPayload: copy(reader),
    focus: copy(focus),
    attention: {matterId: selectedMatter?.id ?? requestedMatterId ?? null, focus: copy(focus), focusStatus: focus?.status ?? 'none', sourceProvenance: copy(selectedSources)},
    provenance: copy(provenance.sort((a, b) => string(a.sourceId).localeCompare(string(b.sourceId)))),
    statuses,
    unresolved: [...unresolved].sort(),
    unresolvedNodes: [...new Set(unresolvedNodes)].sort(),
    returned: [...returned].sort(),
    returnedNodes: [...new Set(returnedNodes)].sort(),
    layout: {world: copy(ATTENTION_WORLD), positions: Object.fromEntries(nodes.map(item => [item.id, copy(item.position)])), positionOverridesApplied: nodes.filter(item => item.layoutSource === 'ui-override').map(item => item.id).sort()},
  }
  return copy(projection)
}

export const selectAttentionProjection = projectAttentionCanvas
export const createAttentionProjection = projectAttentionCanvas
export const projectAttention = projectAttentionCanvas

export default projectAttentionCanvas
