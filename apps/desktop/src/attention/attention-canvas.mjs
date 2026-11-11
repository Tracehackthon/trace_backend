import {createCameraController, createCamera, semanticZoomLevel, prefersReducedMotion} from './camera.mjs';
import {applyWorldTransform, clientToWorld, edgePaths, nodeCenter, nodeRect, renderEdgePaths} from './geometry.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CLICK_SLOP = 4;
const CAMERA_ONLY_RENDER_EVENTS = new Set(['camera-start', 'camera-zoom', 'camera-end', 'camera-animation-start', 'camera-animation-frame', 'camera-animation-end', 'camera-change', 'viewport']);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const idOf = (value, fallback = '') => String(value?.id ?? value?.nodeId ?? value?.matterId ?? value ?? fallback);
const clone = value => globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const laneLabel = node => node.kind === 'discussion' ? '我的补充 · 尚未确认理解' : node.lane === 'user' ? '我的理解' : node.lane === 'agent' ? 'Agent 解读 · 候选' : '原文 / 原现场';
const raf = callback => globalThis.requestAnimationFrame ? requestAnimationFrame(callback) : setTimeout(() => callback(performanceNow()), 16);
const caf = handle => globalThis.cancelAnimationFrame ? cancelAnimationFrame(handle) : clearTimeout(handle);
const performanceNow = () => globalThis.performance?.now?.() ?? Date.now();

function normalizeNode(value, index = 0) {
  const input = value ?? {};
  const position = input.position ?? input.world ?? {};
  return {
    ...input,
    id: idOf(input, `node-${index + 1}`),
    x: finite(input.x ?? input.worldX ?? position.x, 0),
    y: finite(input.y ?? input.worldY ?? position.y, 0),
    width: Math.max(1, finite(input.width ?? input.size?.width ?? position.width, 220)),
    height: Math.max(1, finite(input.height ?? input.size?.height ?? position.height, 112)),
    positionMode: input.positionMode ?? (input.position ? 'top-left' : 'center'),
    title: String(input.title ?? input.label ?? input.name ?? input.text ?? '未命名事项'),
    summary: String(input.summary ?? input.excerpt ?? input.stop ?? ''),
    kind: String(input.kind ?? input.type ?? 'matter'),
    lane: String(input.lane ?? 'original'),
  };
}

function normalizeEdge(value, index = 0) {
  const input = value ?? {};
  return {...input, id: idOf(input, `edge-${index + 1}`)};
}

export function createCanvasViewState(options = {}) {
  const camera = createCamera(options.camera ?? {});
  return {
    phase: options.phase ?? 'overview',
    route: options.route ?? 'overview',
    matterId: options.matterId ?? null,
    semanticLevel: semanticZoomLevel(camera, options.semanticLevel),
    focus: options.focus ? clone(options.focus) : null,
    camera,
    sidebar: {...{open: false, tab: 'context', originFocusId: null}, ...(options.sidebar ?? {})},
    fullscreen: {...{active: false, previousRoute: null, previousSidebarOpen: false, previousCamera: null}, ...(options.fullscreen ?? {})},
    drag: null,
    bird: {...{targetObjectId: null, phase: 'hidden', fromWorld: null, toWorld: null, reason: null}, ...(options.bird ?? {})},
    composer: {...{draftKey: null, text: '', composing: false, busy: false}, ...(options.composer ?? {})},
    loading: options.loading ?? 'ready',
    agentRun: options.agentRun ?? null,
    error: options.error ?? null,
    notice: options.notice ?? null,
    instrumentation: {...{lastRenderFrameId: 0, dragFrameCount: 0, edgeRecalcFrameId: 0, layoutCommitCount: 0}, ...(options.instrumentation ?? {})},
  };
}

function setText(element, value) { if (element) element.textContent = String(value ?? ''); }
function createElement(document, tag, className, attrs = {}) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === 'text') element.textContent = value;
    else if (key === 'html') element.innerHTML = value;
    else element.setAttribute(key, value);
  }
  return element;
}

function nodeWorld(node, layout) {
  const position = layout.get(node.id) ?? {x: node.x, y: node.y};
  return {...node, x: position.x, y: position.y, positionMode: node.positionMode ?? 'center'};
}

function getRootRect(root) {
  const rect = root?.getBoundingClientRect?.();
  return {width: Math.max(0, finite(rect?.width ?? root?.clientWidth, 1)), height: Math.max(0, finite(rect?.height ?? root?.clientHeight, 1)), left: finite(rect?.left), top: finite(rect?.top)};
}

function makeSkeleton(root) {
  const document = root.ownerDocument ?? globalThis.document;
  if (!document) throw new TypeError('mountAttentionCanvas requires a DOM root');
  root.replaceChildren();
  root.classList.add('attention-canvas');
  root.setAttribute('data-canvas-root', '');
  root.setAttribute('data-canvas-phase', 'overview');
  root.tabIndex = root.tabIndex >= 0 ? root.tabIndex : 0;
  root.setAttribute('role', 'application');
  root.setAttribute('aria-label', 'Attention Canvas');
  const cameraSurface = createElement(document, 'div', 'attention-canvas__camera-surface', {'data-canvas-camera-surface': '', tabindex: '-1'});
  const world = createElement(document, 'div', 'attention-canvas__world', {'data-canvas-world': '', 'aria-label': '可探索的注意力画布'});
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'attention-canvas__edges'); svg.setAttribute('data-canvas-edges-svg', ''); svg.setAttribute('aria-hidden', 'true');
  const edgeGroup = document.createElementNS(SVG_NS, 'g'); edgeGroup.setAttribute('data-canvas-edges', ''); svg.append(edgeGroup);
  const nodes = createElement(document, 'div', 'attention-canvas__nodes', {'data-canvas-nodes': ''});
  const bird = createElement(document, 'img', 'attention-canvas__bird', {'data-canvas-bird': '', alt: '', 'aria-hidden': 'true'});
  bird.draggable = false;
  world.append(svg, nodes, bird); cameraSurface.append(world);
  const screen = createElement(document, 'div', 'attention-canvas__screen', {'data-canvas-screen': ''});
  const header = createElement(document, 'header', 'attention-canvas__header', {'data-canvas-header': ''});
  const brand = createElement(document, 'div', 'attention-canvas__brand'); setText(brand, 'Trace · 在意的事');
  const zoomReadout = createElement(document, 'output', 'attention-canvas__zoom', {'data-canvas-zoom': '', 'aria-live': 'polite'});
  const fullscreenButton = createElement(document, 'button', 'attention-canvas__fullscreen', {'type': 'button', 'data-canvas-fullscreen-toggle': '', 'aria-label': '进入全屏探索'}); setText(fullscreenButton, '全屏探索');
  header.append(brand, zoomReadout, fullscreenButton);
  const sidebar = createElement(document, 'aside', 'attention-canvas__sidebar', {'data-canvas-sidebar': '', 'aria-label': '当前注意力上下文', hidden: ''});
  const sidebarHead = createElement(document, 'header'); const sidebarTitle = createElement(document, 'h2', null, {'data-canvas-sidebar-title': ''}); const closeSidebar = createElement(document, 'button', 'attention-canvas__sidebar-close', {'type': 'button', 'data-canvas-sidebar-close': '', 'aria-label': '关闭上下文侧栏'}); setText(closeSidebar, '×'); sidebarHead.append(sidebarTitle, closeSidebar);
  const sidebarBody = createElement(document, 'div', 'attention-canvas__sidebar-body', {'data-canvas-sidebar-body': ''}); sidebar.append(sidebarHead, sidebarBody);
  const composer = createElement(document, 'form', 'attention-canvas__composer', {'data-canvas-composer-form': ''});
  const composerLabel = createElement(document, 'label', null, {'for': 'attention-canvas-composer'}); setText(composerLabel, '留下这一点');
  const composerInput = createElement(document, 'textarea', 'attention-canvas__composer-input', {id: 'attention-canvas-composer', 'data-canvas-composer': '', rows: '2', placeholder: '想留下什么？'});
  const composerSubmit = createElement(document, 'button', null, {type: 'submit', 'data-canvas-composer-submit': ''}); setText(composerSubmit, '留下'); composer.append(composerLabel, composerInput, composerSubmit);
  const status = createElement(document, 'div', 'attention-canvas__status', {'data-canvas-status': '', role: 'status', 'aria-live': 'polite'});
  screen.append(header, sidebar, composer, status); root.append(cameraSurface, screen);
  return {document, cameraSurface, world, svg, edgeGroup, nodes, bird, screen, header, zoomReadout, fullscreenButton, sidebar, sidebarTitle, sidebarBody, closeSidebar, composer, composerInput, status};
}

/**
 * Mount a vanilla DOM/SVG Attention Canvas. The returned adapter owns only view,
 * camera, focus, and layout preview state; domain writes remain callbacks.
 */
export function mountAttentionCanvas(options = {}) {
  const root = options.root;
  if (!root || !root.ownerDocument && !globalThis.document) throw new TypeError('mountAttentionCanvas({root}) requires a DOM element');
  const dom = makeSkeleton(root);
  const nodes = new Map();
  const edges = [];
  const layout = new Map();
  let state = createCanvasViewState(options);
  let disposed = false;
  let renderFrame = 0;
  let pendingFrame = null;
  let pendingWorld = null;
  let drag = null;
  let keyboardDrag = null;
  let focusEpoch = 0;
  let composition = false;
  let resizeObserver = null;
  let cameraUnsubscribe = null;
  const nodeElements = new Map();
  const nodeListeners = new Map();
  const listeners = new Set();
  for (const node of (options.nodes ?? [])) { const normalized = normalizeNode(node, nodes.size); nodes.set(normalized.id, normalized); layout.set(normalized.id, {x: normalized.x, y: normalized.y}); }
  for (const edge of (options.edges ?? [])) edges.push(normalizeEdge(edge, edges.length));

  function notify(event = {}) {
    if (disposed) return;
    // Most product mounts do not subscribe to the verbose view-state stream.
    // Avoid constructing a detached copy of the entire graph for every
    // camera/drag frame when nobody can observe it; getState() remains the
    // explicit snapshot API for callers that need the graph.
    if (!listeners.size && typeof options.onStateChange !== 'function') return;
    const snapshot = clone(state); snapshot.nodes = Array.from(nodes.values(), node => nodeWorld(node, layout)); snapshot.edges = clone(edges);
    for (const listener of listeners) listener(snapshot, event);
    options.onStateChange?.(snapshot, event);
  }
  function updateDataset() {
    root.dataset.canvasPhase = state.phase;
    root.dataset.canvasRoute = state.route;
    root.dataset.canvasSemanticLevel = String(state.semanticLevel);
    root.dataset.canvasFocusId = state.focus?.objectId ?? state.focus?.nodeId ?? '';
    root.dataset.canvasSidebarOpen = String(Boolean(state.sidebar.open));
    root.dataset.canvasFullscreen = String(Boolean(state.fullscreen.active));
    root.dataset.canvasBirdPhase = state.bird.phase;
    if (state.bird.targetObjectId) root.dataset.targetObjectId = state.bird.targetObjectId; else delete root.dataset.targetObjectId;
    dom.cameraSurface.dataset.cameraX = String(state.camera.x);
    dom.cameraSurface.dataset.cameraY = String(state.camera.y);
    dom.cameraSurface.dataset.cameraZoom = String(state.camera.zoom);
    dom.cameraSurface.dataset.semanticLevel = String(state.semanticLevel);
    dom.sidebar.hidden = !state.sidebar.open;
    dom.fullscreenButton.textContent = state.fullscreen.active ? '退出全屏' : '全屏探索';
    dom.fullscreenButton.setAttribute('aria-label', state.fullscreen.active ? '退出全屏探索' : '进入全屏探索');
    dom.composerInput.value = state.composer.text;
    dom.composerInput.disabled = Boolean(state.composer.busy);
    setText(dom.zoomReadout, `${Math.round((state.camera.zoom / Math.max(Number.EPSILON, state.camera.fitZoom)) * 100)}% · Z${state.semanticLevel}`);
    if (state.notice) setText(dom.status, state.notice.message ?? state.notice.code ?? '');
    else if (state.error) setText(dom.status, state.error.message ?? state.error);
    else setText(dom.status, '');
  }
  function renderNodeElement(node) {
    const element = createElement(dom.document, 'article', 'attention-canvas__node', {'data-canvas-node': '', tabindex: '0', role: 'button'});
    element.dataset.nodeId = node.id; element.dataset.objectId = node.objectId ?? node.id; element.dataset.lane = node.lane; element.dataset.kind = node.kind;
    const tag = createElement(dom.document, 'span', 'attention-canvas__node-kind', {'data-canvas-node-kind': ''}); setText(tag, node.kind);
    const title = createElement(dom.document, 'h3', 'attention-canvas__node-title', {'data-canvas-node-title': ''}); setText(title, node.title);
    const summary = createElement(dom.document, 'p', 'attention-canvas__node-summary', {'data-canvas-node-summary': ''}); setText(summary, node.summary);
    const lane = createElement(dom.document, 'span', 'attention-canvas__node-lane', {'data-canvas-node-lane': ''}); setText(lane, laneLabel(node));
    element.append(tag, title, summary, lane);
    const pointerdown = event => beginPointerDrag(event, node.id);
    const pointermove = event => movePointerDrag(event, node.id);
    const pointerup = event => endPointerDrag(event, node.id, false);
    const pointercancel = event => cancelPointerDrag(event, node.id, 'pointercancel');
    const lost = event => { if (drag?.nodeId === node.id && !drag.ended) cancelPointerDrag(event, node.id, 'lostpointercapture'); };
    const keydown = event => handleNodeKeydown(event, node.id);
    element.addEventListener('pointerdown', pointerdown); element.addEventListener('pointermove', pointermove); element.addEventListener('pointerup', pointerup); element.addEventListener('pointercancel', pointercancel); element.addEventListener('lostpointercapture', lost); element.addEventListener('keydown', keydown);
    nodeListeners.set(node.id, {pointerdown, pointermove, pointerup, pointercancel, lost, keydown});
    nodeElements.set(node.id, element); dom.nodes.append(element);
    options.renderNode?.(node, element, {document: dom.document, state: clone(state)});
    return element;
  }
  function syncNodeElements() {
    for (const node of nodes.values()) {
      let element = nodeElements.get(node.id); if (!element) element = renderNodeElement(node);
      element.dataset.nodeId = node.id; element.dataset.objectId = node.objectId ?? node.id; element.dataset.lane = node.lane; element.dataset.kind = node.kind;
      // A same-root update reuses the existing article/listener graph.  Keep
      // its built-in text in sync as well as its geometry; otherwise the
      // projection is fresh while the DOM remains a stale snapshot.
      setText(element.querySelector?.('[data-canvas-node-kind]'), node.kind);
      setText(element.querySelector?.('[data-canvas-node-title]'), node.title);
      setText(element.querySelector?.('[data-canvas-node-summary]'), node.summary);
      setText(element.querySelector?.('[data-canvas-node-lane]'), laneLabel(node));
      element.setAttribute('aria-label', `${node.title}${node.summary ? `：${node.summary}` : ''}`);
      const rect = nodeRect(nodeWorld(node, layout));
      element.style.left = `${rect.left}px`; element.style.top = `${rect.top}px`; element.style.width = `${rect.width}px`; element.style.height = `${rect.height}px`;
      element.dataset.worldX = String(rect.x); element.dataset.worldY = String(rect.y);
      const currentFocus = state.focus?.nodeId === node.id || state.focus?.objectId === node.objectId;
      element.dataset.currentFocus = String(Boolean(currentFocus));
      element.setAttribute('aria-pressed', String(Boolean(currentFocus)));
      element.toggleAttribute('data-dragging', drag?.nodeId === node.id || keyboardDrag?.nodeId === node.id);
    }
    for (const [id, element] of nodeElements) {
      if (nodes.has(id)) continue;
      element.remove(); nodeElements.delete(id); nodeListeners.delete(id);
    }
  }
  function renderSidebar() {
    const node = state.focus ? nodes.get(state.focus.nodeId) ?? findNodeByObjectId(state.focus.objectId) : null;
    setText(dom.sidebarTitle, node?.title ?? '当前注意力');
    dom.sidebarBody.replaceChildren();
    if (!node) { setText(dom.sidebarBody, '还没有选择当前注意力。'); return; }
    const meta = createElement(dom.document, 'p', 'attention-canvas__sidebar-meta'); setText(meta, `${node.kind} · ${laneLabel(node)}`);
    const summary = createElement(dom.document, 'p', 'attention-canvas__sidebar-summary'); setText(summary, node.summary || '此处还没有停点。');
    dom.sidebarBody.append(meta, summary);
    options.renderSidebar?.(node, dom.sidebarBody, {state: clone(state), document: dom.document});
  }
  function findNodeByObjectId(value) {
    if (!value) return null;
    return nodes.get(String(value)) ?? Array.from(nodes.values()).find(node => String(node.objectId ?? node.id) === String(value)) ?? null;
  }
  function renderBird() {
    const target = findNodeByObjectId(state.bird.targetObjectId);
    if (!target) { dom.bird.hidden = true; dom.bird.removeAttribute('src'); return; }
    dom.bird.hidden = false; dom.bird.dataset.targetObjectId = state.bird.targetObjectId;
    dom.bird.dataset.birdPhase = state.bird.phase;
    const rect = nodeRect(nodeWorld(target, layout));
    // Keep the attention cue outside the bubble so the bird never obscures
    // the title/summary that explains the focused matter.
    const perch = {x: rect.right + 28, y: rect.top - 44};
    const position = state.bird.phase === 'flying' && state.bird.toWorld ? state.bird.toWorld : perch;
    dom.bird.dataset.birdAnchor = 'outside-edge';
    dom.bird.style.left = `${position.x - 42}px`; dom.bird.style.top = `${position.y - 38}px`;
    if (options.birdSrc) dom.bird.src = options.birdSrc;
  }
  function renderWorld({dragFrame = false, worldDirty = true, renderBird: shouldRenderBird = true, renderSidebar: shouldRenderSidebar = true} = {}) {
    renderFrame += 1;
    state.instrumentation.lastRenderFrameId = renderFrame;
    if (dragFrame) state.instrumentation.dragFrameCount += 1;
    applyWorldTransform(dom.world, state.camera);
    if (worldDirty) {
      syncNodeElements();
      const currentNodes = new Map(Array.from(nodes.values(), node => [node.id, nodeWorld(node, layout)]));
      const paths = edgePaths(edges, currentNodes).map(item => ({...item, frameId: renderFrame}));
      state.instrumentation.edgeRecalcFrameId = renderFrame;
      renderEdgePaths(dom.edgeGroup, paths);
    }
    if (shouldRenderBird) renderBird();
    updateDataset();
    if (shouldRenderSidebar) renderSidebar();
    dom.world.dataset.renderFrameId = String(renderFrame); dom.world.dataset.edgeRecalcFrameId = String(state.instrumentation.edgeRecalcFrameId);
  }
  function renderAll(event = {}) {
    if (disposed) return;
    state.semanticLevel = semanticZoomLevel(state.camera, state.semanticLevel);
    const cameraOnly = CAMERA_ONLY_RENDER_EVENTS.has(event.type);
    renderWorld({
      dragFrame: event.type === 'drag-frame',
      worldDirty: !cameraOnly,
      // The focus animation settles the bird after its final camera frame;
      // repaint that decoration without rebuilding all node/edge geometry.
      renderBird: !cameraOnly || event.type === 'camera-animation-end',
      renderSidebar: !cameraOnly,
    });
    notify(event);
  }
  function scheduleDragRender() {
    if (pendingFrame !== null) return;
    pendingFrame = raf(() => { pendingFrame = null; if (!drag || disposed || !pendingWorld) return; layout.set(drag.nodeId, {...pendingWorld}); drag.currentWorld = {...pendingWorld}; renderAll({source: 'user', type: 'drag-frame'}); });
  }
  function cancelPendingDragFrame() {
    if (pendingFrame === null) return;
    caf(pendingFrame);
    pendingFrame = null;
  }
  function flushPendingDrag(active) {
    if (!active || !pendingWorld || !active.moved) return;
    // A pointerup can arrive before the requestAnimationFrame scheduled by the
    // last pointermove.  Commit that latest world point synchronously so a
    // fast drag cannot silently persist its origin position.
    cancelPendingDragFrame();
    layout.set(active.nodeId, {...pendingWorld});
    active.currentWorld = {...pendingWorld};
    pendingWorld = null;
  }
  function beginPointerDrag(event, nodeId) {
    if (disposed || event.button !== 0 && event.pointerType !== 'touch') return;
    const node = nodes.get(nodeId); if (!node) return;
    event.stopPropagation();
    const rect = getRootRect(dom.cameraSurface); const current = nodeWorld(node, layout); const origin = {x: current.x, y: current.y};
    drag = {nodeId, pointerId: event.pointerId, startClient: {x: event.clientX, y: event.clientY}, originWorld: origin, currentWorld: origin, moved: false, ended: false, edgeIds: edges.filter(edge => String(edge.source?.nodeId ?? edge.source?.id ?? edge.source) === nodeId || String(edge.target?.nodeId ?? edge.target?.id ?? edge.target) === nodeId).map(edge => edge.id), phase: 'armed'};
    state.drag = clone(drag); state.phase = 'dragging';
    const element = nodeElements.get(nodeId); element?.setPointerCapture?.(event.pointerId); element?.setAttribute('aria-grabbed', 'true');
    updateDataset(); notify({source: 'user', type: 'drag-start'});
    // Keep camera and focus untouched: drag is layout-only.
    void rect;
  }
  function movePointerDrag(event, nodeId) {
    if (!drag || drag.nodeId !== nodeId || drag.pointerId !== event.pointerId || drag.ended || disposed) return;
    event.stopPropagation();
    const delta = Math.hypot(event.clientX - drag.startClient.x, event.clientY - drag.startClient.y);
    if (delta >= CLICK_SLOP) { drag.moved = true; drag.phase = 'moving'; }
    if (!drag.moved) return;
    const world = clientToWorld({x: event.clientX, y: event.clientY}, state.camera, getRootRect(dom.cameraSurface));
    // Projection/UI positions use top-left coordinates. Pointer coordinates
    // describe the node center, so convert once before storing the preview;
    // otherwise a reload shifts every persisted card by half its size.
    const current = nodeWorld(nodes.get(nodeId), layout);
    const rect = nodeRect(current);
    pendingWorld = {x: world.x - rect.width / 2, y: world.y - rect.height / 2}; state.drag = clone({...drag, currentWorld: pendingWorld}); scheduleDragRender();
  }
  function endPointerDrag(event, nodeId, cancelled) {
    if (!drag || drag.nodeId !== nodeId || drag.pointerId !== event.pointerId || drag.ended) return;
    event.stopPropagation(); drag.ended = true; const active = drag;
    if (!cancelled) flushPendingDrag(active); else { cancelPendingDragFrame(); pendingWorld = null; }
    drag = null;
    const element = nodeElements.get(nodeId); element?.releasePointerCapture?.(event.pointerId); element?.removeAttribute('aria-grabbed');
    if (cancelled || !active.moved) {
      if (!active.moved && !cancelled) activateNode(nodeId, 'click'); else revertLayout(active, cancelled ? 'drag-cancel' : 'drag-revert');
      return;
    }
    state.drag = null; state.phase = state.focus ? 'focused' : 'overview'; state.instrumentation.layoutCommitCount += 1;
    const previous = active.originWorld; const next = {...(layout.get(nodeId) ?? active.currentWorld)};
    renderAll({source: 'user', type: 'layout-commit'});
    options.onLayoutCommit?.({nodeId, previous, next, edgeIds: active.edgeIds, layoutRevision: options.layoutRevision ?? null});
  }
  function beginKeyboardDrag(nodeId) {
    const node = nodes.get(nodeId); if (!node) return;
    const current = nodeWorld(node, layout); keyboardDrag = {nodeId, originWorld: {x: current.x, y: current.y}, currentWorld: {x: current.x, y: current.y}, phase: 'moving'}; state.drag = clone(keyboardDrag); state.phase = 'dragging'; renderAll({source: 'user', type: 'drag-start'});
  }
  function moveKeyboardDrag(nodeId, dx, dy) {
    if (!keyboardDrag || keyboardDrag.nodeId !== nodeId) return;
    const current = keyboardDrag.currentWorld; keyboardDrag.currentWorld = {x: current.x + dx, y: current.y + dy}; layout.set(nodeId, {...keyboardDrag.currentWorld}); state.drag = clone(keyboardDrag); renderAll({source: 'user', type: 'drag-frame'});
  }
  function commitKeyboardDrag() {
    if (!keyboardDrag) return; const active = keyboardDrag; keyboardDrag = null; state.drag = null; state.phase = state.focus ? 'focused' : 'overview'; state.instrumentation.layoutCommitCount += 1; renderAll({source: 'user', type: 'layout-commit'}); options.onLayoutCommit?.({nodeId: active.nodeId, previous: active.originWorld, next: active.currentWorld, edgeIds: edges.filter(edge => String(edge.source?.nodeId ?? edge.source?.id ?? edge.source) === active.nodeId || String(edge.target?.nodeId ?? edge.target?.id ?? edge.target) === active.nodeId).map(edge => edge.id), layoutRevision: options.layoutRevision ?? null});
  }
  function revertLayout(active, reason = 'drag-revert') {
    if (!active) return; layout.set(active.nodeId, {...active.originWorld}); state.drag = null; drag = null; keyboardDrag = null; state.phase = state.focus ? 'focused' : 'overview'; renderAll({source: 'user', type: reason}); options.onLayoutRevert?.({nodeId: active.nodeId, position: active.originWorld, reason});
  }
  function cancelPointerDrag(event, nodeId, reason) { if (drag?.nodeId !== nodeId) return; event?.stopPropagation?.(); const active = drag; active.ended = true; cancelPendingDragFrame(); drag = null; pendingWorld = null; revertLayout(active, reason); }
  function handleNodeKeydown(event, nodeId) {
    if (disposed || event.isComposing) return;
    if (keyboardDrag?.nodeId === nodeId) {
      if (event.key === 'ArrowLeft') { event.preventDefault(); moveKeyboardDrag(nodeId, -finite(options.keyboardPanStep, 8), 0); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); moveKeyboardDrag(nodeId, finite(options.keyboardPanStep, 8), 0); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); moveKeyboardDrag(nodeId, 0, -finite(options.keyboardPanStep, 8)); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); moveKeyboardDrag(nodeId, 0, finite(options.keyboardPanStep, 8)); }
      else if (event.key === 'Escape') { event.preventDefault(); revertLayout(keyboardDrag, 'keyboard-cancel'); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); commitKeyboardDrag(); }
      return;
    }
    if (event.key === 'Enter') { event.preventDefault(); activateNode(nodeId, 'keyboard'); }
    else if (event.key === ' ') { event.preventDefault(); beginKeyboardDrag(nodeId); }
  }
  function activateNode(nodeId, reason = 'click') {
    const node = nodes.get(nodeId); if (!node || disposed) return;
    const previous = state.focus; const changed = previous?.nodeId !== nodeId;
    state.focus = {matterId: node.matterId ?? state.matterId ?? null, nodeId, objectId: node.objectId ?? node.id, objectKind: node.kind, lane: node.lane, reason, contextMode: options.contextMode ?? 'resume'};
    state.matterId = node.matterId ?? state.matterId ?? null; state.sidebar = {...state.sidebar, open: true, tab: 'context', originFocusId: nodeId}; state.phase = 'focusing';
    if (changed) {
      const from = previous?.nodeId ? nodeCenter(nodeWorld(nodes.get(previous.nodeId) ?? {}, layout)) : null; const to = nodeCenter(nodeWorld(node, layout));
      state.bird = {targetObjectId: node.objectId ?? node.id, phase: prefersReducedMotion(options.reducedMotion) ? 'perched' : (from ? 'takingOff' : 'landing'), fromWorld: from, toWorld: to, reason};
    } else state.bird = {...state.bird, targetObjectId: node.objectId ?? node.id, phase: 'perched', toWorld: nodeCenter(nodeWorld(node, layout))};
    focusEpoch += 1; const epoch = focusEpoch;
    renderAll({source: 'user', type: 'focus-set'}); options.onSidebarChange?.(true, clone(state.focus)); options.onFocusChange?.(clone(state.focus), {previous: previous ? clone(previous) : null, reason});
    const rect = getRootRect(dom.cameraSurface); const targetZoom = finite(options.focusZoom, state.camera.fitZoom * 1.03);
    const promise = camera.focusOn(nodeCenter(nodeWorld(node, layout)), {zoom: targetZoom, screenPoint: {x: rect.width * (options.focusScreenX ?? 0.43), y: rect.height * 0.48}, duration: options.focusDuration ?? 420, reason: 'focus'});
    Promise.resolve(promise).then(result => {
      if (disposed || epoch !== focusEpoch) return;
      state.phase = 'focused'; state.camera = camera.getState(); state.bird = {...state.bird, phase: 'perched', toWorld: nodeCenter(nodeWorld(node, layout))}; renderAll({source: result?.interrupted ? 'user' : 'program', type: result?.interrupted ? 'focus-interrupted' : 'focus-settled'});
      dom.sidebarTitle.focus?.();
    });
  }
  function closeSidebar() { state.sidebar = {...state.sidebar, open: false}; renderAll({source: 'user', type: 'sidebar-close'}); options.onSidebarChange?.(false, clone(state.focus)); }
  function toggleFullscreen() {
    if (state.fullscreen.active) { state.fullscreen = {...state.fullscreen, active: false}; state.phase = state.focus ? 'focused' : 'overview'; }
    else { state.fullscreen = {active: true, previousRoute: state.route, previousSidebarOpen: state.sidebar.open, previousCamera: clone(state.camera)}; state.phase = state.focus ? 'focused' : 'overview'; }
    renderAll({source: 'user', type: state.fullscreen.active ? 'fullscreen-enter' : 'fullscreen-exit'}); options.onFullscreenChange?.(state.fullscreen.active);
  }
  function onCameraChange(cameraState, event) {
    state.camera = cameraState; state.semanticLevel = semanticZoomLevel(cameraState, state.semanticLevel);
    if (event.source === 'user' && state.phase === 'focusing') state.phase = state.focus ? 'focused' : 'overview';
    renderAll({source: event.source, type: event.type ?? 'camera-change'});
  }
  function onComposerInput(event) { state.composer.text = event.currentTarget.value; state.composer.draftKey = options.composerDraftKey ?? `${state.matterId ?? 'canvas'}:${state.focus?.objectId ?? 'overview'}:${options.contextMode ?? 'resume'}`; options.onComposerDraft?.(state.composer.text, clone(state.composer)); }
  function onComposerKeydown(event) { if (event.key === 'Enter' && !event.shiftKey && !composition && !event.isComposing) { event.preventDefault(); dom.composer.requestSubmit?.(); } }
  function onComposerSubmit(event) { event.preventDefault(); const text = state.composer.text; if (!text.trim()) return; options.onComposerSubmit?.(text, {focus: state.focus ? clone(state.focus) : null, draftKey: state.composer.draftKey}); }
  function onCompositionStart() { composition = true; state.composer.composing = true; }
  function onCompositionEnd() { composition = false; state.composer.composing = false; }
  function onRootKeydown(event) { if (event.key !== 'Escape') return; if (keyboardDrag) { event.preventDefault(); revertLayout(keyboardDrag, 'keyboard-cancel'); } else if (drag) { event.preventDefault(); const active = drag; active.ended = true; revertLayout(active, 'escape-cancel'); } else if (state.sidebar.open) { event.preventDefault(); closeSidebar(); } else if (state.fullscreen.active) { event.preventDefault(); toggleFullscreen(); } }
  dom.closeSidebar.addEventListener('click', closeSidebar); dom.fullscreenButton.addEventListener('click', toggleFullscreen); dom.composer.addEventListener('submit', onComposerSubmit); dom.composerInput.addEventListener('input', onComposerInput); dom.composerInput.addEventListener('keydown', onComposerKeydown); dom.composerInput.addEventListener('compositionstart', onCompositionStart); dom.composerInput.addEventListener('compositionend', onCompositionEnd); root.addEventListener('keydown', onRootKeydown);
  const camera = createCameraController({...(options.camera ?? {}), surface: dom.cameraSurface, keyboardSurface: root, viewport: getRootRect(dom.cameraSurface), scene: options.scene ?? options.sceneBounds, reducedMotion: options.reducedMotion, keyboardPanStep: options.keyboardPanStep, translateExtent: options.translateExtent});
  state.camera = camera.getState(); state.semanticLevel = semanticZoomLevel(state.camera, state.semanticLevel);
  cameraUnsubscribe = camera.subscribe(onCameraChange);
  if (globalThis.ResizeObserver) { resizeObserver = new ResizeObserver(entries => { const rect = entries[0]?.contentRect; if (rect) camera.setViewport(rect); }); resizeObserver.observe(dom.cameraSurface); }
  function update(next = {}) {
    if (disposed) return adapter;
    const previousFocus = state.focus ? clone(state.focus) : null;
    const explicitFocus = Object.prototype.hasOwnProperty.call(next, 'focus');
    const previousLayouts = new Map(layout);
    if (Object.prototype.hasOwnProperty.call(next, 'nodes')) {
      const incoming = Array.isArray(next.nodes) ? next.nodes : [];
      const incomingIds = new Set(incoming.map((node, index) => idOf(node, `node-${index + 1}`)));
      // If a node disappears while it is being dragged, do not leave a
      // pointer/keyboard drag pointing at an article that syncNodeElements is
      // about to remove.
      const removedDrag = (drag && !incomingIds.has(drag.nodeId)) || (keyboardDrag && !incomingIds.has(keyboardDrag.nodeId));
      if (removedDrag) {
        cancelPendingDragFrame();
        pendingWorld = null;
        drag = null;
        keyboardDrag = null;
        state.drag = null;
      }
      nodes.clear();
      layout.clear();
      for (const [index, node] of incoming.entries()) {
        const normalized = normalizeNode(node, index);
        nodes.set(normalized.id, normalized);
        // Layout is view-local state.  Preserve a position already shown by
        // this mount even when the domain projection sends a new default;
        // newly introduced nodes use the projection's position exactly once.
        const activePosition = pendingWorld && drag?.nodeId === normalized.id
          ? pendingWorld
          : keyboardDrag?.nodeId === normalized.id
            ? keyboardDrag.currentWorld
            : previousLayouts.get(normalized.id);
        layout.set(normalized.id, activePosition ? {...activePosition} : {x: normalized.x, y: normalized.y});
      }
    }
    if (Object.prototype.hasOwnProperty.call(next, 'edges')) {
      const incomingEdges = Array.isArray(next.edges) ? next.edges : [];
      edges.splice(0, edges.length, ...incomingEdges.map(normalizeEdge));
    }
    if (next.composerText !== undefined) state.composer.text = String(next.composerText);
    if (next.matterId !== undefined) state.matterId = next.matterId;
    if (explicitFocus) state.focus = next.focus ? clone(next.focus) : null;

    // Resolve the old semantic focus against the new node set by canonical
    // node ID first, then object ID.  A live host update must not silently
    // point the sidebar/bird at a removed object or retain stale reader focus.
    const requestedFocus = explicitFocus ? state.focus : previousFocus;
    const focusedNode = requestedFocus
      ? nodes.get(requestedFocus.nodeId) ?? findNodeByObjectId(requestedFocus.objectId)
      : null;
    if (focusedNode) {
      state.focus = {
        ...requestedFocus,
        matterId: focusedNode.matterId ?? requestedFocus.matterId ?? null,
        nodeId: focusedNode.id,
        objectId: focusedNode.objectId ?? focusedNode.id,
        objectKind: focusedNode.kind,
        lane: focusedNode.lane,
      };
      state.bird = state.bird.phase === 'hidden'
        ? {...state.bird, targetObjectId: focusedNode.objectId ?? focusedNode.id}
        : {...state.bird, targetObjectId: focusedNode.objectId ?? focusedNode.id};
    } else if (requestedFocus) {
      focusEpoch += 1;
      state.focus = null;
      state.sidebar = {...state.sidebar, open: false};
      state.bird = {targetObjectId: null, phase: 'hidden', fromWorld: null, toWorld: null, reason: 'live-update-focus-removed'};
      state.phase = 'overview';
      camera.interrupt?.();
      state.camera = camera.getState();
      options.onFocusChange?.(null, {previous: requestedFocus, reason: 'live-update-focus-removed'});
    }
    if (!state.focus && !drag && !keyboardDrag) state.phase = 'overview';
    if (drag || keyboardDrag) state.phase = 'dragging';
    state.drag = drag ? clone(drag) : keyboardDrag ? clone(keyboardDrag) : null;
    renderAll({source: 'program', type: 'update'}); return adapter;
  }
  function setCamera(next, meta = {}) { camera.set(next, meta); return adapter; }
  const adapter = {
    getState() { const snapshot = clone(state); snapshot.nodes = Array.from(nodes.values(), node => nodeWorld(node, layout)); snapshot.edges = clone(edges); return snapshot; },
    getCamera() { return camera.getState(); },
    getInstrumentation() { return clone(state.instrumentation); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    update, setCamera, panBy: (...args) => { camera.panBy(...args); return adapter; }, zoomAt: (...args) => { camera.zoomAt(...args); return adapter; }, fit: (...args) => { camera.fit(...args); return adapter; }, focusNode: activateNode, clearFocus() {
      // Invalidate an in-flight focus animation before clearing semantic focus;
      // otherwise its completion callback can resurrect the old focused phase.
      focusEpoch += 1;
      state.focus = null;
      state.sidebar = {...state.sidebar, open: false};
      state.bird = {targetObjectId: null, phase: 'hidden', fromWorld: null, toWorld: null, reason: 'clear'};
      state.phase = 'overview';
      camera.interrupt?.();
      state.camera = camera.getState();
      renderAll({source: 'user', type: 'focus-clear'}); options.onSidebarChange?.(false, null);
    }, toggleFullscreen, closeSidebar, destroy({clear = true} = {}) {
      if (disposed) return;
      disposed = true;
      cancelPendingDragFrame();
      pendingWorld = null;
      if (resizeObserver) resizeObserver.disconnect();
      cameraUnsubscribe?.();
      camera.destroy();
      root.removeEventListener('keydown', onRootKeydown);
      for (const [id, element] of nodeElements) {
        const bound = nodeListeners.get(id);
        if (bound) {
          element.removeEventListener('pointerdown', bound.pointerdown);
          element.removeEventListener('pointermove', bound.pointermove);
          element.removeEventListener('pointerup', bound.pointerup);
          element.removeEventListener('pointercancel', bound.pointercancel);
          element.removeEventListener('lostpointercapture', bound.lost);
          element.removeEventListener('keydown', bound.keydown);
        }
        element.remove();
      }
      nodeElements.clear();
      nodeListeners.clear();
      // A destroyed mount owns its skeleton.  Always remove it, including the
      // historical destroy({clear:false}) call shape, so callbacks/listeners
      // cannot remain reachable through stale DOM nodes.
      root.replaceChildren?.();
      root.removeAttribute('data-canvas-root');
      listeners.clear();
    }, root, camera, nodes, edges,
  };
  renderAll({source: 'program', type: 'mount'});
  return adapter;
}

export const createAttentionCanvas = mountAttentionCanvas;
export const AttentionCanvas = mountAttentionCanvas;
export {createCameraController, createCamera, semanticZoomLevel, prefersReducedMotion};
