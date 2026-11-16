import {mountAttentionCanvas} from './attention-canvas.mjs'
import {projectAttentionCanvas} from './attention-projection.mjs'
import {createReaderState, mountAttentionReader} from './attention-reader.mjs'

const clone = value => {
  if (value === undefined) return undefined
  return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value))
}

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const text = value => value == null ? '' : String(value)

/**
 * UI-only layout storage.  Attention Canvas never writes these values to the
 * Product Workspace.  The storage format intentionally contains only finite
 * coordinates so a corrupted local value cannot become domain data.
 */
export const ATTENTION_LAYOUT_STORAGE_VERSION = 1
export const ATTENTION_LAYOUT_STORAGE_KEY = `trace:attention-canvas:layout:v${ATTENTION_LAYOUT_STORAGE_VERSION}`

function safeStorage(value) {
  try {
    return value && typeof value.getItem === 'function' && typeof value.setItem === 'function' ? value : null
  } catch {
    return null
  }
}

function readRawStorage(storage, key) {
  const target = safeStorage(storage)
  if (!target) return null
  try {
    const parsed = JSON.parse(target.getItem(key) || 'null')
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function normalizePosition(value) {
  if (!value || typeof value !== 'object' || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.y))) return null
  const normalized = {x: Number(value.x), y: Number(value.y)}
  if (Number.isFinite(Number(value.width))) normalized.width = Math.max(1, Number(value.width))
  if (Number.isFinite(Number(value.height))) normalized.height = Math.max(1, Number(value.height))
  return normalized
}

export function readAttentionLayout({storage, sessionStorage, key = ATTENTION_LAYOUT_STORAGE_KEY} = {}) {
  const parsed = readRawStorage(storage, key) || readRawStorage(sessionStorage, key)
  const source = parsed?.positions && typeof parsed.positions === 'object' ? parsed.positions : parsed
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {}
  return Object.fromEntries(Object.entries(source).map(([id, value]) => [id, normalizePosition(value)]).filter(([, value]) => value))
}

export function writeAttentionLayout({storage, sessionStorage, key = ATTENTION_LAYOUT_STORAGE_KEY, positions = {}} = {}) {
  const normalized = Object.fromEntries(Object.entries(positions || {}).map(([id, value]) => [String(id), normalizePosition(value)]).filter(([, value]) => value))
  const payload = JSON.stringify({version: ATTENTION_LAYOUT_STORAGE_VERSION, positions: normalized})
  const targets = [safeStorage(storage), safeStorage(sessionStorage)].filter(Boolean)
  for (const target of targets) {
    try { target.setItem(key, payload); return true } catch { /* try session fallback */ }
  }
  return false
}

export function persistAttentionLayoutPosition({storage, sessionStorage, key = ATTENTION_LAYOUT_STORAGE_KEY, nodeId, position} = {}) {
  if (!nodeId || !normalizePosition(position)) return false
  const positions = readAttentionLayout({storage, sessionStorage, key})
  positions[String(nodeId)] = normalizePosition(position)
  return writeAttentionLayout({storage, sessionStorage, key, positions})
}

function browserStorage(name) {
  try { return globalThis[name] ?? null } catch { return null }
}

function nodeSummary(item) {
  const value = item?.text ?? item?.fact ?? item?.interpretation ?? item?.draft ?? item?.proposedUnderstanding ?? ''
  if (text(value).trim()) return text(value)
  const labels = {missing: '还没有可显示的原文', unresolved: '还没有完成这一步', unconfirmed: '待你确认', stale: '这份内容需要重新核验', failed: '这一步没有完成', returned: '结果已带回，等待复核', draft: '草稿尚未保存', generating: '正在准备候选'}
  if (item?.status && labels[item.status]) return labels[item.status]
  return ''
}

/** Convert a projection record to the renderer's detached node contract. */
export function attentionCanvasNode(item = {}) {
  const position = item.position || item.world || {}
  const lane = ['original', 'user', 'agent'].includes(item.lane) ? item.lane : 'original'
  return {
    id: text(item.id),
    objectId: item.objectId ?? item.id,
    matterId: item.matterId ?? null,
    matterIds: Array.isArray(item.matterIds) ? [...item.matterIds] : undefined,
    kind: text(item.type || item.kind || 'matter'),
    lane,
    title: text(item.title || '未命名事项'),
    summary: nodeSummary(item),
    status: item.status ?? null,
    provenance: clone(item.provenance),
    x: finite(position.x),
    y: finite(position.y),
    width: Math.max(1, finite(position.width, 210)),
    height: Math.max(1, finite(position.height, 92)),
    // projection positions are top-left coordinates; keep that fact explicit
    // so the renderer cannot accidentally reinterpret them as domain centers.
    positionMode: 'top-left',
  }
}

export function attentionCanvasModel(projection = {}) {
  return {
    nodes: Array.isArray(projection.nodes) ? projection.nodes.map(attentionCanvasNode).filter(node => node.id) : [],
    edges: Array.isArray(projection.edges) ? projection.edges.map(edge => ({
      ...clone(edge),
      source: edge.source ?? edge.from,
      target: edge.target ?? edge.to,
    })) : [],
  }
}

function sourceForProjection(projection, focusedNode) {
  const lane = projection?.reader?.lanes?.original || {}
  const original = lane.original || projection?.reader?.original || null
  const sources = Array.isArray(lane.sources) ? lane.sources : []
  if (focusedNode?.kind === 'matter' || focusedNode?.type === 'matter') return original || sources[0] || {}
  if (focusedNode?.kind === 'source' || focusedNode?.type === 'source') return focusedNode
  if (focusedNode?.kind === 'original' || focusedNode?.type === 'original') return focusedNode
  return sources[0] || original || {}
}

function readerSource(projection, focusedNode) {
  const source = sourceForProjection(projection, focusedNode)
  const original = projection?.reader?.lanes?.original?.original || projection?.reader?.original || {}
  const isSource = source?.type === 'source' || source?.kind === 'source'
  const sourceText = text(source?.text)
  const originalText = text(original?.text)
  const provenance = source?.provenance && typeof source.provenance === 'object' ? source.provenance : {}
  const status = source?.status ?? source?.sourceStatus ?? (sourceText || originalText ? 'available' : 'missing')
  return {
    id: source?.objectId ?? source?.id ?? original?.objectId ?? original?.id ?? null,
    matterId: source?.matterId ?? projection?.matterId ?? null,
    title: text(source?.title || projection?.reader?.title || '原文与原现场'),
    author: text(source?.author || provenance.author),
    sourceKind: text(source?.sourceKind || provenance.sourceKind || source?.sourceStatus || '用户材料'),
    authorship: text(source?.authorship || 'user'),
    sourceStatus: status,
    url: source?.url ?? provenance.url ?? null,
    locator: source?.locator ?? provenance.locator ?? source?.url ?? provenance.url ?? '',
    contentHash: source?.contentHash ?? provenance.contentHash ?? '',
    capturedAt: source?.capturedAt ?? provenance.fetchedAt ?? '',
    // A source node is an excerpt, not an invented full article.  The reader
    // receives exactly the text available in the projection.
    // Projection source nodes carry an excerpt only.  Do not label that
    // excerpt as a fabricated full article in the reader.
    fullText: isSource ? '' : originalText,
    fragmentText: isSource ? sourceText : '',
    summaryText: text(source?.summary || source?.summaryText),
    userExcerpt: isSource ? '' : originalText,
  }
}

/** Build a reader state while preserving the three canonical lanes. */
export function attentionReaderInput(projection = {}, focusedNode = null, focus = null) {
  const lanes = projection?.reader?.lanes || {}
  const user = lanes.user?.understanding || projection?.reader?.userUnderstanding || null
  const candidates = Array.isArray(lanes.agent?.candidates) ? lanes.agent.candidates : []
  const agentStatus = lanes.agent?.status || 'not-requested'
  return {
    open: false,
    matterId: focusedNode?.matterId ?? projection?.matterId ?? null,
    focus: focus ? clone(focus) : null,
    source: readerSource(projection, focusedNode),
    user: {
      text: text(user?.text),
      draft: text(user?.draft),
      revision: user?.contentVersion ?? user?.understandingVersion ?? null,
      stop: text(lanes.user?.stop?.text || lanes.user?.stop?.draft),
    },
    // Agent is intentionally collapsed.  Its candidate objects remain
    // detached and visibly unconfirmed; no candidate is copied into user text.
    agent: {
      status: agentStatus,
      output: text(lanes.agent?.output),
      candidates: clone(candidates),
      expanded: false,
    },
    contextMode: projection?.reader?.contextMode === 'fresh' ? 'fresh' : 'resume',
    contextEpoch: projection?.reader?.contextEpoch ?? null,
    draftKey: `${projection?.matterId || ''}:${focusedNode?.objectId || focusedNode?.id || ''}:attention`,
  }
}

function unavailableProjection() {
  return {
    schemaVersion: 1,
    matterId: null,
    matterIds: [],
    nodes: [],
    edges: [],
    reader: {
      matterId: null,
      title: null,
      contextMode: 'resume',
      contextEpoch: 0,
      lanes: {
        original: {lane: 'original', status: 'none', nodeIds: [], original: null, sources: [], sourceProvenance: []},
        user: {lane: 'user', status: 'none', nodeIds: [], understanding: null, stop: null},
        agent: {lane: 'agent', status: 'not-requested', nodeIds: [], candidates: [], notice: '尚未请求 Agent 解读。'},
      },
    },
    focus: null,
    statuses: {workspace: 'error', matter: 'none', source: 'none', understanding: 'none', agent: 'not-requested', work: 'none', result: 'none', revision: 'none'},
    unresolved: [],
    returned: [],
    layout: {world: {width: 1500, height: 900}, positions: {}, positionOverridesApplied: []},
  }
}

function mapReaderStatus(message) {
  return {kind: 'info', message: text(message)}
}

/**
 * Mount the product homepage's real Attention Canvas.  This adapter owns only
 * presentation state and UI-local positions; all product writes are callbacks
 * supplied by web-main (not hidden mutations of the host snapshot).
 */
export function mountAttentionHome({
  root,
  host = {},
  projection: providedProjection,
  onAll,
  onSearch,
  onCapture,
  onProfile,
  onWorks,
  onMatters,
  onEnterMatter,
  onDraft,
  onEvent,
  document: documentOption,
  storage,
  sessionStorage,
} = {}) {
  if (!root || typeof root !== 'object') throw new TypeError('mountAttentionHome requires a root element')
  const doc = documentOption || root.ownerDocument || globalThis.document
  if (!doc) throw new TypeError('mountAttentionHome requires a document')
  const localStorage = storage === undefined ? browserStorage('localStorage') : storage
  const session = sessionStorage === undefined ? browserStorage('sessionStorage') : sessionStorage
  const layoutKey = ATTENTION_LAYOUT_STORAGE_KEY
  let currentHost = host
  let projectionError = false
  let projection
  try {
    projection = providedProjection || projectAttentionCanvas(currentHost, {positionOverrides: readAttentionLayout({storage: localStorage, sessionStorage: session, key: layoutKey})})
  } catch (error) {
    // A malformed/stale host must produce a truthful error state, never a
    // demo projection or a second guessed workspace.
    console.error('Attention Canvas projection unavailable', error)
    projectionError = true
    projection = unavailableProjection()
  }
  let disposed = false
  const controller = new AbortController()
  let canvas
  let reader
  let noticeTimer = null

  root.innerHTML = `
    <main class="attention-home" data-attention-home data-attention-workspace-status="${text(projection.statuses?.workspace || 'error')}">
      <nav class="attention-home__nav" aria-label="Trace 首页导航">
        <button type="button" class="attention-home__brand" data-attention-nav="home" aria-label="Trace，首页"><span aria-hidden="true">T</span><strong>Trace</strong></button>
        <div class="attention-home__nav-links">
          <button type="button" data-attention-nav="matters">在意的事</button>
          <button type="button" data-attention-nav="search">搜索</button>
          <button type="button" data-attention-nav="all">全部痕迹</button>
          <button type="button" data-attention-nav="works">工作现场</button>
        </div>
        <button type="button" class="attention-home__profile" data-attention-nav="profile">个人设置</button>
      </nav>
      <div class="attention-home__canvas" data-attention-canvas></div>
      <section class="attention-home__empty" data-attention-empty hidden aria-live="polite">
        <h1 data-attention-empty-heading>这里还没有一件事</h1>
        <p data-attention-empty-copy>画布不会用示例内容代替你的空间。先留下一点，接续从真实原话开始。</p>
        <button type="button" class="attention-home__empty-action" data-attention-focus-composer>写下第一点</button>
      </section>
      <div class="attention-home__reader" data-attention-reader></div>
      <div class="attention-home__notice" data-attention-notice role="status" aria-live="polite" hidden></div>
    </main>`

  const home = root.querySelector('[data-attention-home]')
  const canvasRoot = root.querySelector('[data-attention-canvas]')
  const readerRoot = root.querySelector('[data-attention-reader]')
  const empty = root.querySelector('[data-attention-empty]')
  const emptyHeading = root.querySelector('[data-attention-empty-heading]')
  const emptyCopy = root.querySelector('[data-attention-empty-copy]')
  const notice = root.querySelector('[data-attention-notice]')
  home.dataset.attentionSidebarOpen = 'false'

  const showNotice = message => {
    if (!message) return
    notice.textContent = text(message)
    notice.hidden = false
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => { if (!disposed) notice.hidden = true }, 4200)
  }

  const emit = event => {
    try { onEvent?.(event) } catch (error) { showNotice(error.message || '这一步还没有完成。') }
  }

  const resolveMatterId = node => {
    const candidate = node?.matterId || node?.matterIds?.[0] || (node?.kind === 'source' ? null : projection.matterId)
    return candidate && projection.matterIds?.includes(candidate) ? candidate : null
  }

  const readerEvent = event => {
    emit(event)
    switch (event?.type) {
      case 'READER_CLOSED':
        showNotice('已关闭阅读栏，当前注意力仍保留。')
        break
      case 'READER_COMPARE_SAVE_REQUESTED':
      case 'READER_USER_DRAFT_SAVE_REQUESTED':
        showNotice('这份草稿尚未保存；进入这件事后再明确保存，不会在首页冒充成功。')
        reader?.update({notice: mapReaderStatus('首页不替你写入理解；请进入这件事后明确保存。')})
        break
      case 'READER_AGENT_REQUESTED':
      case 'READER_AGENT_RETRY_REQUESTED':
        showNotice('当前首页没有连接 Agent，未伪造生成结果。')
        reader?.update({notice: mapReaderStatus('尚未连接 Agent；原文和你的草稿仍保留。')})
        break
      case 'READER_AGENT_ADOPT_REQUESTED':
        showNotice('Agent 候选仍待确认，没有自动写入我的理解。')
        break
      default:
        break
    }
  }

  reader = mountAttentionReader({root: readerRoot, document: doc, state: createReaderState({open: false}), onEvent: readerEvent, title: 'Attention Canvas'})

  const openReader = node => {
    const focus = canvas?.getState?.().focus || null
    const matterId = resolveMatterId(node) || focus?.matterId || projection.matterId
    // The overview projection contains every Matter and its reader payload is
    // intentionally selected by the host's selectedId. Re-project the reader
    // scope from the focused node so clicking Matter A can never open Matter B
    // merely because B was selected when the home was mounted.
    let readerProjection = projection
    try {
      readerProjection = projectAttentionCanvas(currentHost, {matterId, focus: focus || node?.id})
    } catch (error) {
      console.error('Attention Canvas reader projection unavailable', error)
    }
    const input = attentionReaderInput(readerProjection, node, focus)
    const canvasSurface = canvasRoot?.querySelector?.('[data-canvas-root]')
    const returnFocusElement = [...(canvasSurface?.querySelectorAll?.('[data-canvas-node]') || [])].find(element => element.dataset.objectId === node?.objectId || element.dataset.nodeId === node?.id) || canvasSurface
    canvas?.closeSidebar?.()
    reader.update({...input, open: true, returnFocusKey: node?.id || null, returnFocusElement, beforeClose: {camera: clone(canvas?.getCamera?.()), focus: clone(canvas?.getState?.().focus)}})
  }

  const renderSidebar = (node, body) => {
    const matterId = resolveMatterId(node)
    const readerButton = doc.createElement('button')
    readerButton.type = 'button'
    readerButton.className = 'attention-canvas__sidebar-action attention-canvas__sidebar-action--primary'
    readerButton.dataset.attentionOpenReader = ''
    readerButton.textContent = node?.kind === 'source' || node?.kind === 'original' ? '阅读这份原文' : '打开阅读栏'
    readerButton.addEventListener('click', event => { event.stopPropagation(); openReader(node) })
    body.append(readerButton)
    if (matterId) {
      const enter = doc.createElement('button')
      enter.type = 'button'
      enter.className = 'attention-canvas__sidebar-action'
      enter.dataset.attentionEnterMatter = matterId
      enter.textContent = '进入这件事'
      enter.addEventListener('click', event => { event.stopPropagation(); onEnterMatter?.(matterId) })
      body.append(enter)
    }
    if (node?.lane === 'agent') {
      const boundary = doc.createElement('p')
      boundary.className = 'attention-canvas__sidebar-boundary'
      boundary.textContent = 'Agent 候选默认收起，不会自动成为我的理解。'
      body.append(boundary)
    }
  }

  const model = attentionCanvasModel(projection)
  const initialFocus = projection.focus?.status === 'resolved' && projection.focus.nodeId
    ? {
        matterId: projection.focus.matterId ?? projection.matterId ?? null,
        nodeId: projection.focus.nodeId,
        objectId: projection.focus.objectId ?? projection.focus.nodeId,
        objectKind: projection.focus.objectKind ?? null,
        lane: projection.focus.lane ?? null,
        reason: projection.focus.reason ?? 'restore',
        contextMode: projection.reader?.contextMode ?? 'resume',
      }
    : null
  canvas = mountAttentionCanvas({
    root: canvasRoot,
    nodes: model.nodes,
    edges: model.edges,
    matterId: projection.matterId,
    phase: initialFocus ? 'focused' : 'overview',
    focus: initialFocus,
    bird: initialFocus ? {targetObjectId: initialFocus.objectId, phase: 'perched', reason: 'restore'} : undefined,
    scene: projection.layout?.world || {width: 1500, height: 900},
    translateExtent: [[-260, -220], [finite(projection.layout?.world?.width, 1500) + 260, finite(projection.layout?.world?.height, 900) + 220]],
    birdSrc: new URL('../../public/home/bird-perched.png', import.meta.url).href,
    reducedMotion: () => doc.documentElement?.dataset.reduceMotion === 'true',
    renderSidebar,
    composerDraftKey: `${projection.matterId || 'workspace'}:capture`,
    onComposerDraft: (value, state) => onDraft?.(value, state),
    onComposerSubmit: (value, state) => onCapture?.(value, state),
    onFocusChange: (focus, event) => emit({type: 'ATTENTION_FOCUS_CHANGED', payload: {focus, event}}),
    onLayoutCommit: info => {
      const ok = persistAttentionLayoutPosition({storage: localStorage, sessionStorage: session, key: layoutKey, nodeId: info.nodeId, position: info.next})
      if (!ok) showNotice('布局无法写入浏览器存储，只保留在本次页面中。')
      emit({type: 'ATTENTION_LAYOUT_COMMITTED', payload: {...info, persisted: ok, storage: 'ui-local-only'}})
    },
    onLayoutRevert: info => emit({type: 'ATTENTION_LAYOUT_REVERTED', payload: info}),
    onFullscreenChange: active => { home.dataset.attentionFullscreen = String(active) },
    onSidebarChange: active => { home.dataset.attentionSidebarOpen = String(active) },
  })

  // Fit is camera-only and deliberately does not set focus or write product
  // state.  Empty workspaces still fit the honest world bounds, with no nodes.
  canvas.fit({source: 'program'})
  const renderWorkspaceState = () => {
    const state = projection.statuses?.workspace
    if (state === 'error' || projectionError) {
      emptyHeading.textContent = '工作区暂时无法显示'
      emptyCopy.textContent = '真实内容投影失败，未用示例替代。请重新载入或先检查本机存储。'
      empty.querySelector('[data-attention-focus-composer]').hidden = true
      empty.hidden = false
    } else {
      emptyHeading.textContent = '这里还没有一件事'
      emptyCopy.textContent = '画布不会用示例内容代替你的空间。先留下一点，接续从真实原话开始。'
      empty.querySelector('[data-attention-focus-composer]').hidden = false
      empty.hidden = state !== 'empty'
    }
  }
  renderWorkspaceState()

  // The home route keeps one canvas/reader mount alive while the product host
  // is refreshed after a draft or command.  Refresh an already-open reader
  // from the new projection instead of leaving its original/user/Agent lanes
  // as a stale snapshot.  Reader-local draft/tab/selection state is retained
  // by mountAttentionReader.update; only the detached domain payload changes.
  const refreshOpenReader = (previousCanvasState, previousReaderState, nextModel) => {
    if (!previousReaderState?.open) return
    if (projectionError) {
      reader?.update?.({open: false})
      return
    }
    const liveFocus = canvas?.getState?.().focus || previousCanvasState?.focus || previousReaderState.focus || null
    const focusNode = liveFocus
      ? nextModel.nodes.find(node => node.id === liveFocus.nodeId || node.objectId === liveFocus.objectId)
      : nextModel.nodes.find(node => node.id === previousReaderState.returnFocusKey)
    if (!focusNode) {
      // The focused Matter/source may have been deleted by another surface;
      // close the reader rather than showing the old text against an empty
      // canvas.  The reader adapter restores focus to the surviving canvas.
      reader?.update?.({open: false})
      return
    }
    const matterId = liveFocus?.matterId || focusNode.matterId || focusNode.matterIds?.[0] || previousReaderState.matterId || null
    let readerProjection = projection
    try {
      readerProjection = projectAttentionCanvas(currentHost, {matterId, focus: liveFocus || focusNode.id})
    } catch (error) {
      console.error('Attention Canvas live reader projection unavailable', error)
    }
    const input = attentionReaderInput(readerProjection, focusNode, liveFocus || previousReaderState.focus)
    reader?.update?.({
      ...input,
      open: true,
      returnFocusKey: previousReaderState.returnFocusKey,
      beforeClose: previousReaderState.beforeClose,
    })
  }

  const focusComposer = () => canvasRoot.querySelector('[data-canvas-composer]')?.focus({preventScroll: true})
  root.addEventListener('click', event => {
    const nav = event.target.closest?.('[data-attention-nav]')?.dataset.attentionNav
    if (nav === 'all') onAll?.()
    else if (nav === 'search') onSearch?.()
    else if (nav === 'works') onWorks?.()
    else if (nav === 'matters') onMatters?.()
    else if (nav === 'profile') onProfile?.()
    else if (nav === 'home') canvas.fit({source: 'user'})
    if (event.target.closest?.('[data-attention-focus-composer]')) focusComposer()
  }, {signal: controller.signal})

  return {
    getProjection: () => clone(projection),
    getCanvas: () => canvas,
    getReader: () => reader,
    update(next = {}) {
      if (disposed) return this
      const previousCanvasState = canvas?.getState?.() || null
      const previousReaderState = reader?.getState?.() || null
      if (next.host) currentHost = next.host
      try {
        projectionError = false
        projection = next.projection || projectAttentionCanvas(currentHost, {positionOverrides: readAttentionLayout({storage: localStorage, sessionStorage: session, key: layoutKey})})
      } catch (error) {
        console.error('Attention Canvas projection unavailable', error)
        projectionError = true
        projection = unavailableProjection()
      }
      const nextModel = attentionCanvasModel(projection)
      home.dataset.attentionWorkspaceStatus = text(projection.statuses?.workspace || 'error')
      renderWorkspaceState()
      canvas.update({...nextModel, matterId: projection.matterId})
      refreshOpenReader(previousCanvasState, previousReaderState, nextModel)
      if (projectionError) reader?.close?.()
      return this
    },
    destroy() {
      if (disposed) return
      disposed = true
      if (noticeTimer) clearTimeout(noticeTimer)
      controller.abort()
      reader?.destroy?.()
      canvas?.destroy?.()
      root.replaceChildren()
    },
  }
}

export const createAttentionHome = mountAttentionHome
export default mountAttentionHome
