import {select} from '../vendor/d3-attention.bundle.mjs';
import {zoom as d3Zoom, zoomIdentity, ZoomTransform} from '../vendor/d3-attention.bundle.mjs';

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const positive = (value, fallback = 1) => Math.max(Number.EPSILON, finite(value, fallback));
const now = () => globalThis.performance?.now?.() ?? Date.now();
const getRaf = () => globalThis.requestAnimationFrame ?? (callback => setTimeout(() => callback(now()), 16));
const getCaf = () => globalThis.cancelAnimationFrame ?? clearTimeout;
const raf = getRaf();
const caf = getCaf();

export const ZOOM_LEVELS = Object.freeze({
  0: Object.freeze({name: 'overview', enter: 0, exit: 0.74, max: 0.78}),
  1: Object.freeze({name: 'context', enter: 0.78, exit: 0.74, max: 1.03}),
  2: Object.freeze({name: 'focus', enter: 1.03, exit: 0.98, max: 1.42}),
  3: Object.freeze({name: 'detail', enter: 1.42, exit: 1.35, max: Infinity}),
});

export function prefersReducedMotion(explicit) {
  if (typeof explicit === 'boolean') return explicit;
  if (typeof explicit === 'function') return Boolean(explicit());
  try { return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches); }
  catch { return false; }
}

function normalizeExtent(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x0 = finite(value[0]?.[0]); const y0 = finite(value[0]?.[1]);
  const x1 = finite(value[1]?.[0]); const y1 = finite(value[1]?.[1]);
  return [[Math.min(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.max(y0, y1)]];
}

export function semanticZoomLevel(camera = {}, previousLevel = null) {
  const fitZoom = positive(camera.fitZoom, 1);
  const worldZoom = positive(camera.zoom, fitZoom) / fitZoom;
  const previous = Number.isInteger(previousLevel) ? previousLevel : null;
  // Hysteresis applies near a boundary, but a programmatic jump still lands in
  // the correct semantic level instead of walking one level per frame.
  if (previous === 0) {
    if (worldZoom >= ZOOM_LEVELS[3].enter) return 3;
    if (worldZoom >= ZOOM_LEVELS[2].enter) return 2;
    if (worldZoom >= ZOOM_LEVELS[1].enter) return 1;
    return 0;
  }
  if (previous === 1) {
    if (worldZoom >= ZOOM_LEVELS[3].enter) return 3;
    if (worldZoom >= ZOOM_LEVELS[2].enter) return 2;
    if (worldZoom < ZOOM_LEVELS[1].exit) return 0;
    return 1;
  }
  if (previous === 2) {
    if (worldZoom >= ZOOM_LEVELS[3].enter) return 3;
    if (worldZoom < ZOOM_LEVELS[1].exit) return 0;
    if (worldZoom < ZOOM_LEVELS[2].exit) return 1;
    return 2;
  }
  if (previous === 3) {
    if (worldZoom < ZOOM_LEVELS[1].exit) return 0;
    if (worldZoom < ZOOM_LEVELS[2].exit) return 1;
    if (worldZoom < ZOOM_LEVELS[3].exit) return 2;
    return 3;
  }
  if (worldZoom < ZOOM_LEVELS[0].max) return 0;
  if (worldZoom < ZOOM_LEVELS[2].enter) return 1;
  if (worldZoom < ZOOM_LEVELS[3].enter) return 2;
  return 3;
}

export function cloneCamera(camera = {}) {
  return {
    x: finite(camera.x), y: finite(camera.y), zoom: positive(camera.zoom, 1),
    fitZoom: positive(camera.fitZoom, 1),
    minZoom: positive(camera.minZoom, 0.25), maxZoom: Math.max(positive(camera.minZoom, 0.25), finite(camera.maxZoom, 2.4)),
    target: camera.target ? {...camera.target} : null,
    motion: camera.motion ?? 'idle',
    userInterrupted: Boolean(camera.userInterrupted),
    semanticLevel: Number.isInteger(camera.semanticLevel) ? camera.semanticLevel : semanticZoomLevel(camera),
  };
}

export function createCamera(options = {}) {
  const minZoom = positive(options.minZoom, 0.25);
  const maxZoom = Math.max(minZoom, finite(options.maxZoom, 2.4));
  const fitZoom = clamp(positive(options.fitZoom, 1), minZoom, maxZoom);
  const zoom = clamp(positive(options.zoom, fitZoom), minZoom, maxZoom);
  return cloneCamera({
    x: finite(options.x), y: finite(options.y), zoom, fitZoom, minZoom, maxZoom,
    target: options.target ?? null, motion: options.motion ?? 'idle', userInterrupted: false,
    semanticLevel: Number.isInteger(options.semanticLevel) ? options.semanticLevel : undefined,
  });
}

export function worldToScreen(world = {}, camera = {}) {
  const zoom = positive(camera.zoom, 1);
  return {x: finite(camera.x) + finite(world.x) * zoom, y: finite(camera.y) + finite(world.y) * zoom};
}

export function screenToWorld(screen = {}, camera = {}) {
  const zoom = positive(camera.zoom, 1);
  return {x: (finite(screen.x) - finite(camera.x)) / zoom, y: (finite(screen.y) - finite(camera.y)) / zoom};
}

export function panBy(camera, dx = 0, dy = 0, options = {}) {
  return setCameraTransform(camera, {x: finite(camera?.x) + finite(dx), y: finite(camera?.y) + finite(dy)}, options);
}

export function zoomAt(camera, zoom, screenPoint = {x: 0, y: 0}, options = {}) {
  const current = cloneCamera(camera);
  const nextZoom = clamp(finite(zoom, current.zoom), current.minZoom, current.maxZoom);
  const world = screenToWorld(screenPoint, current);
  return setCameraTransform(current, {
    x: finite(screenPoint.x) - world.x * nextZoom,
    y: finite(screenPoint.y) - world.y * nextZoom,
    zoom: nextZoom,
  }, options);
}

export function setCameraTransform(camera, transform = {}, options = {}) {
  const next = cloneCamera({...camera, ...transform});
  const extent = normalizeExtent(options.translateExtent ?? camera?.translateExtent);
  const viewport = options.viewport ?? camera?.viewport;
  if (extent && viewport) {
    const [[x0, y0], [x1, y1]] = extent;
    const width = Math.max(0, finite(viewport.width)); const height = Math.max(0, finite(viewport.height));
    const minX = width - x1 * next.zoom; const maxX = -x0 * next.zoom;
    const minY = height - y1 * next.zoom; const maxY = -y0 * next.zoom;
    next.x = minX <= maxX ? clamp(next.x, minX, maxX) : (minX + maxX) / 2;
    next.y = minY <= maxY ? clamp(next.y, minY, maxY) : (minY + maxY) / 2;
  }
  next.semanticLevel = semanticZoomLevel(next, options.previousLevel ?? camera?.semanticLevel);
  return next;
}

export function fitCamera({viewport = {}, scene = {}, padding = 0, minZoom = 0.25, maxZoom = 2.4, previousLevel = null} = {}) {
  const width = Math.max(1, finite(viewport.width, 1)); const height = Math.max(1, finite(viewport.height, 1));
  const sceneWidth = Math.max(1, finite(scene.width, 1)); const sceneHeight = Math.max(1, finite(scene.height, 1));
  const innerWidth = Math.max(1, width - finite(padding) * 2); const innerHeight = Math.max(1, height - finite(padding) * 2);
  const fitZoom = clamp(Math.min(innerWidth / sceneWidth, innerHeight / sceneHeight), minZoom, maxZoom);
  const centerX = finite(scene.x, finite(scene.left) + sceneWidth / 2);
  const centerY = finite(scene.y, finite(scene.top) + sceneHeight / 2);
  return setCameraTransform({x: width / 2 - centerX * fitZoom, y: height / 2 - centerY * fitZoom, zoom: fitZoom, fitZoom, minZoom, maxZoom, semanticLevel: previousLevel}, {}, {viewport, previousLevel});
}

function readViewport(value) {
  if (value && Number.isFinite(Number(value.width))) return {width: Math.max(0, Number(value.width)), height: Math.max(0, finite(value.height))};
  if (value?.getBoundingClientRect) { const rect = value.getBoundingClientRect(); return {width: rect.width, height: rect.height}; }
  return {width: 0, height: 0};
}

/**
 * Small camera controller around d3-zoom. D3 owns pointer/wheel/pinch mechanics;
 * this controller owns the product camera state and interruption semantics.
 */
export function createCameraController(options = {}) {
  let viewport = readViewport(options.viewport ?? options.surface);
  let state = createCamera({...options, ...(options.initial ?? {})});
  state.viewport = viewport;
  state.translateExtent = normalizeExtent(options.translateExtent);
  state.semanticLevel = semanticZoomLevel(state, options.semanticLevel);
  const listeners = new Set();
  let disposed = false;
  let selection = null;
  let behavior = null;
  let boundSurface = null;
  let animation = null;
  let suppressD3 = false;
  let keyboardHandler = null;
  let keyboardSurface = null;
  let pointerInterruptHandler = null;
  const reduce = options.reducedMotion;

  function notify(meta = {}) {
    const snapshot = cloneCamera(state);
    snapshot.viewport = {...viewport}; snapshot.translateExtent = state.translateExtent;
    for (const listener of listeners) listener(snapshot, meta);
    options.onChange?.(snapshot, meta);
  }
  function commit(next, meta = {}) {
    if (disposed) return state;
    const merged = setCameraTransform({...state, ...next}, {}, {viewport, translateExtent: state.translateExtent, previousLevel: state.semanticLevel});
    merged.viewport = viewport; merged.translateExtent = state.translateExtent;
    state = merged;
    syncD3();
    notify(meta);
    return state;
  }
  function syncD3() {
    if (!selection || !behavior || disposed) return;
    suppressD3 = true;
    try { selection.call(behavior.transform, new ZoomTransform(state.zoom, state.x, state.y)); }
    finally { suppressD3 = false; }
  }
  function stopAnimation(interrupted = true) {
    if (!animation) return false;
    const current = animation; animation = null;
    caf(current.frame);
    current.resolve({interrupted});
    if (interrupted) commit({target: null, motion: 'idle', userInterrupted: true}, {source: 'user', type: 'camera-interrupted'});
    return true;
  }
  function sourceIsUser(event) { return Boolean(event?.sourceEvent); }
  function attach(surface) {
    if (!surface || !surface.addEventListener) return controller;
    if (boundSurface === surface) return controller;
    detach();
    boundSurface = surface;
    selection = select(surface);
    const ext = state.translateExtent;
    behavior = d3Zoom()
      .scaleExtent([state.minZoom, state.maxZoom])
      .extent(() => [[0, 0], [viewport.width || surface.clientWidth || 1, viewport.height || surface.clientHeight || 1]])
      .filter(event => {
        if (event.type === 'wheel') return true;
        if (event.target?.closest?.('[data-canvas-node]')) return false;
        if (event.type === 'mousedown' && event.button !== 0) return false;
        return !event.button || event.button === 0;
      })
      .on('start.attention-camera', event => {
        if (sourceIsUser(event) && animation) stopAnimation(true);
        if (sourceIsUser(event)) commit({motion: event.sourceEvent?.type === 'wheel' ? 'zooming' : 'panning'}, {source: 'user', type: 'camera-start'});
      })
      .on('zoom.attention-camera', event => {
        const transform = event.transform;
        const isUser = sourceIsUser(event);
        if (isUser && animation) stopAnimation(true);
        if (suppressD3) return;
        commit({x: transform.x, y: transform.y, zoom: transform.k, motion: isUser ? (event.sourceEvent?.type === 'wheel' ? 'zooming' : 'panning') : 'idle', target: isUser ? null : state.target, userInterrupted: isUser ? false : state.userInterrupted}, {source: isUser ? 'user' : 'program', type: 'camera-zoom', originalEvent: event.sourceEvent});
      })
      .on('end.attention-camera', event => {
        if (sourceIsUser(event)) commit({motion: 'idle'}, {source: 'user', type: 'camera-end'});
      });
    selection.call(behavior);
    if (ext) behavior.translateExtent(ext);
    keyboardHandler = event => {
      if (disposed || event.defaultPrevented || event.isComposing || event.key === 'Process') return;
      const tag = String(event.target?.tagName ?? '').toLowerCase();
      if (['input', 'textarea', 'select', 'button'].includes(tag) || event.target?.isContentEditable || event.target?.closest?.('[role="button"]')) return;
      const rect = boundSurface.getBoundingClientRect?.() ?? {width: viewport.width, height: viewport.height};
      const center = {x: finite(rect.width, viewport.width) / 2, y: finite(rect.height, viewport.height) / 2};
      const step = finite(options.keyboardPanStep, 48);
      if (event.key === '+' || event.key === '=') { event.preventDefault(); controller.zoomAt(state.zoom * 1.2, center, {source: 'user', type: 'keyboard-zoom'}); }
      else if (event.key === '-' || event.key === '_') { event.preventDefault(); controller.zoomAt(state.zoom / 1.2, center, {source: 'user', type: 'keyboard-zoom'}); }
      else if (event.key === '0') { event.preventDefault(); controller.fit({source: 'user', type: 'keyboard-fit'}); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); controller.panBy(step, 0, {source: 'user', type: 'keyboard-pan'}); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); controller.panBy(-step, 0, {source: 'user', type: 'keyboard-pan'}); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); controller.panBy(0, step, {source: 'user', type: 'keyboard-pan'}); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); controller.panBy(0, -step, {source: 'user', type: 'keyboard-pan'}); }
    };
    pointerInterruptHandler = event => {
      if (event.target?.closest?.('[data-canvas-node]')) return;
      if (animation && (event.type === 'pointerdown' || event.type === 'wheel')) stopAnimation(true);
    };
    keyboardSurface = options.keyboardSurface ?? surface;
    keyboardSurface.addEventListener('keydown', keyboardHandler);
    surface.addEventListener('pointerdown', pointerInterruptHandler, {capture: true});
    surface.addEventListener('wheel', pointerInterruptHandler, {capture: true, passive: true});
    syncD3();
    return controller;
  }
  function detach() {
    if (!boundSurface) return;
    keyboardSurface?.removeEventListener?.('keydown', keyboardHandler);
    boundSurface.removeEventListener?.('pointerdown', pointerInterruptHandler, true);
    boundSurface.removeEventListener?.('wheel', pointerInterruptHandler, true);
    if (selection) selection.on('.zoom', null).on('.attention-camera', null);
    selection = null; behavior = null; boundSurface = null; keyboardSurface = null; keyboardHandler = null; pointerInterruptHandler = null;
  }
  function setViewport(value) {
    viewport = readViewport(value); state.viewport = viewport; syncD3(); notify({source: 'layout', type: 'viewport'}); return controller;
  }
  function set(next = {}, meta = {}) { if (meta.source === 'user') stopAnimation(true); return commit(next, meta); }
  function pan(dx, dy, meta = {}) { if (meta.source === 'user') stopAnimation(true); return commit(panBy(state, dx, dy, {previousLevel: state.semanticLevel}), meta); }
  function zoomTo(nextZoom, point, meta = {}) { if (meta.source === 'user') stopAnimation(true); return commit(zoomAt(state, nextZoom, point ?? {x: viewport.width / 2, y: viewport.height / 2}, {previousLevel: state.semanticLevel}), meta); }
  function fit(meta = {}) {
    if (meta.source === 'user') stopAnimation(true);
    const target = fitCamera({viewport, scene: options.scene ?? options.sceneBounds ?? {width: viewport.width || 1, height: viewport.height || 1}, padding: options.fitPadding, minZoom: state.minZoom, maxZoom: state.maxZoom, previousLevel: state.semanticLevel});
    return animateTo(target, {duration: meta.source === 'user' ? 0 : undefined, ...meta});
  }
  function animateTo(target = {}, animationOptions = {}) {
    if (disposed) return Promise.resolve({interrupted: true});
    stopAnimation(false);
    const desired = setCameraTransform({...state, ...target}, {}, {viewport, translateExtent: state.translateExtent, previousLevel: state.semanticLevel});
    const duration = prefersReducedMotion(reduce) ? 0 : Math.max(0, finite(animationOptions.duration, 420));
    if (!duration) { commit({...desired, target: null, motion: 'idle', userInterrupted: false}, {source: animationOptions.source ?? 'program', type: animationOptions.type ?? 'camera-animate'}); return Promise.resolve({interrupted: false}); }
    const from = cloneCamera(state); const start = now();
    commit({target: {x: desired.x, y: desired.y, zoom: desired.zoom, reason: animationOptions.reason ?? 'program'}, motion: 'autoCentering', userInterrupted: false}, {source: 'program', type: 'camera-animation-start'});
    return new Promise(resolve => {
      const token = {};
      const tick = timestamp => {
        if (!animation || animation.token !== token || disposed) return;
        const amount = clamp((timestamp - start) / duration, 0, 1);
        const eased = typeof animationOptions.ease === 'function' ? animationOptions.ease(amount) : 1 - Math.pow(1 - amount, 3);
        commit({x: from.x + (desired.x - from.x) * eased, y: from.y + (desired.y - from.y) * eased, zoom: from.zoom + (desired.zoom - from.zoom) * eased, motion: amount >= 1 ? 'idle' : 'autoCentering', target: amount >= 1 ? null : {x: desired.x, y: desired.y, zoom: desired.zoom, reason: animationOptions.reason ?? 'program'}, userInterrupted: false}, {source: 'program', type: amount >= 1 ? 'camera-animation-end' : 'camera-animation-frame'});
        if (amount >= 1) { animation = null; resolve({interrupted: false}); }
        else { animation.frame = raf(tick); }
      };
      animation = {token, frame: raf(tick), resolve};
    });
  }
  const controller = {
    get state() { return cloneCamera(state); },
    getState() { return cloneCamera(state); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    attach, bind: attach, detach,
    setViewport, set,
    panBy: pan,
    zoomAt(nextZoom, point, meta = {}) { return zoomTo(nextZoom, point, meta); },
    zoomTo(nextZoom, point, meta = {}) { return zoomTo(nextZoom, point, meta); },
    fit, animateTo,
    focusOn(worldPoint, options = {}) {
      const center = options.screenPoint ?? {x: viewport.width / 2, y: viewport.height / 2};
      const zoom = finite(options.zoom, state.fitZoom * 1.03);
      return animateTo({x: center.x - finite(worldPoint.x) * zoom, y: center.y - finite(worldPoint.y) * zoom, zoom}, options);
    },
    interrupt() { return stopAnimation(true); },
    destroy() { if (disposed) return; disposed = true; stopAnimation(false); detach(); listeners.clear(); },
  };
  if (options.surface) attach(options.surface);
  return controller;
}

export const camera = Object.freeze({create: createCamera, clone: cloneCamera, worldToScreen, screenToWorld, panBy, zoomAt, setCameraTransform, fitCamera, semanticZoomLevel, createController: createCameraController});
