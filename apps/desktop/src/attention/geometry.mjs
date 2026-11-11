import {
  curveBumpX,
  curveBumpY,
  curveCardinal,
  curveCatmullRom,
  curveLinear,
  curveMonotoneX,
  curveMonotoneY,
  curveNatural,
  curveStep,
  curveStepAfter,
  curveStepBefore,
  link as d3Link,
} from '../vendor/d3-attention.bundle.mjs';

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positive = (value, fallback = 1) => Math.max(Number.EPSILON, finite(value, fallback));

/**
 * Normalize the world-space position of an Attention Canvas node.
 * Node x/y are centers by default; set positionMode:'top-left' for imported layouts.
 */
export function nodeRect(node = {}) {
  const position = node.position ?? node.world ?? {};
  let x = finite(node.x ?? node.worldX ?? position.x ?? position.left, 0);
  let y = finite(node.y ?? node.worldY ?? position.y ?? position.top, 0);
  const width = positive(node.width ?? node.size?.width ?? node.bounds?.width ?? position.width, 220);
  const height = positive(node.height ?? node.size?.height ?? node.bounds?.height ?? position.height, 112);
  const mode = node.positionMode ?? position.mode ?? 'center';
  if (mode === 'top-left') { x += width / 2; y += height / 2; }
  return {x, y, width, height, left: x - width / 2, top: y - height / 2, right: x + width / 2, bottom: y + height / 2};
}

export function nodeCenter(node = {}) {
  const rect = nodeRect(node);
  return {x: rect.x, y: rect.y};
}

const curves = Object.freeze({
  bumpX: curveBumpX,
  bumpY: curveBumpY,
  cardinal: curveCardinal,
  catmullRom: curveCatmullRom,
  linear: curveLinear,
  monotoneX: curveMonotoneX,
  monotoneY: curveMonotoneY,
  natural: curveNatural,
  step: curveStep,
  stepAfter: curveStepAfter,
  stepBefore: curveStepBefore,
});

export const edgeCurves = curves;

function endpointSpec(edge, side) {
  const value = edge?.[side] ?? edge?.[side === 'source' ? 'from' : 'to'];
  const portKey = edge?.[`${side}Port`] ?? edge?.[`${side}Handle`];
  if (value && typeof value === 'object') {
    return {nodeId: value.nodeId ?? value.id ?? value.node ?? value.matterId, port: value.port ?? value.side ?? portKey};
  }
  return {nodeId: value, port: portKey};
}

function lookupNode(nodes, id) {
  if (!nodes) return null;
  if (nodes instanceof Map) return nodes.get(id) ?? null;
  if (Array.isArray(nodes)) return nodes.find(node => String(node.id ?? node.nodeId ?? node.matterId) === String(id)) ?? null;
  return nodes[id] ?? null;
}

function customPort(node, port) {
  if (!node || !port) return null;
  const ports = node.ports ?? node.port ?? {};
  const value = ports[port];
  if (!value) return null;
  if (Array.isArray(value)) return {x: finite(value[0]), y: finite(value[1])};
  if (typeof value === 'object') {
    if (Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y))) return {x: Number(value.x), y: Number(value.y)};
    const rect = nodeRect(node);
    return {x: rect.left + finite(value.left, rect.width / 2), y: rect.top + finite(value.top, rect.height / 2)};
  }
  return null;
}

/** Resolve a node edge port. Port values may be center, cardinal names, or custom coordinates. */
export function nodePort(node, port = 'center', toward = null) {
  const rect = nodeRect(node);
  const custom = customPort(node, port);
  if (custom) return custom;
  let side = String(port ?? 'center').toLowerCase();
  if (side === 'auto') {
    const target = toward ?? rect;
    side = finite(target.x) < rect.x ? 'left' : 'right';
  }
  switch (side) {
    case 'left': case 'west': return {x: rect.left, y: rect.y};
    case 'right': case 'east': return {x: rect.right, y: rect.y};
    case 'top': case 'north': return {x: rect.x, y: rect.top};
    case 'bottom': case 'south': return {x: rect.x, y: rect.bottom};
    case 'top-left': return {x: rect.left, y: rect.top};
    case 'top-right': return {x: rect.right, y: rect.top};
    case 'bottom-left': return {x: rect.left, y: rect.bottom};
    case 'bottom-right': return {x: rect.right, y: rect.bottom};
    default: return {x: rect.x, y: rect.y};
  }
}

/** Return the source/target world coordinates for one edge. */
export function edgePoints(edge, nodes) {
  const source = endpointSpec(edge, 'source');
  const target = endpointSpec(edge, 'target');
  const sourceNode = lookupNode(nodes, source.nodeId);
  const targetNode = lookupNode(nodes, target.nodeId);
  if (!sourceNode || !targetNode) return null;
  const targetCenter = nodeCenter(targetNode);
  const sourceCenter = nodeCenter(sourceNode);
  return {
    source: nodePort(sourceNode, source.port ?? 'auto', targetCenter),
    target: nodePort(targetNode, target.port ?? 'auto', sourceCenter),
    sourceNode,
    targetNode,
  };
}

function pathCurve(edge = {}) {
  const key = edge.curve ?? edge.pathCurve ?? (edge.kind === 'straight' ? 'linear' : 'bumpX');
  return curves[key] ?? curveBumpX;
}

/**
 * Generate an SVG path with d3-shape. Keeping path generation in d3-shape avoids
 * a second hand-written Bezier implementation in the product.
 */
export function edgePath(edge, nodes, options = {}) {
  const points = edgePoints(edge, nodes);
  if (!points) return '';
  const curve = options.curve ?? pathCurve(edge);
  const generator = d3Link(curve).x(point => point.x).y(point => point.y);
  try { return generator({source: points.source, target: points.target}) ?? ''; }
  catch { return d3Link(curveLinear).x(point => point.x).y(point => point.y)({source: points.source, target: points.target}) ?? ''; }
}

/** Recalculate all paths in one render frame. */
export function edgePaths(edges = [], nodes, options = {}) {
  return edges.map(edge => ({
    id: String(edge.id ?? edge.edgeId ?? `${edge.source}->${edge.target}`),
    edge,
    d: edgePath(edge, nodes, options),
  }));
}

export function applyWorldTransform(element, camera = {}) {
  if (!element) return;
  const x = finite(camera.x, 0); const y = finite(camera.y, 0); const zoom = positive(camera.zoom, 1);
  element.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoom})`;
  element.style.setProperty('--camera-x', `${x}px`);
  element.style.setProperty('--camera-y', `${y}px`);
  element.style.setProperty('--camera-zoom', String(zoom));
}

export function formatSvgTransform(camera = {}) {
  return `translate(${finite(camera.x, 0)} ${finite(camera.y, 0)}) scale(${positive(camera.zoom, 1)})`;
}

export function distance(a = {}, b = {}) {
  return Math.hypot(finite(a.x) - finite(b.x), finite(a.y) - finite(b.y));
}

export function lerpPoint(a = {}, b = {}, t = 0) {
  const amount = Math.max(0, Math.min(1, finite(t)));
  return {x: finite(a.x) + (finite(b.x) - finite(a.x)) * amount, y: finite(a.y) + (finite(b.y) - finite(a.y)) * amount};
}

/**
 * Convert a pointer's client coordinates into canvas-local world coordinates.
 * Camera x/y are local to the canvas viewport, not page coordinates.
 */
export function clientToWorld(client, camera, rect) {
  const left = finite(rect?.left); const top = finite(rect?.top);
  const zoom = positive(camera?.zoom, 1);
  return {x: (finite(client?.x ?? client?.clientX) - left - finite(camera?.x)) / zoom, y: (finite(client?.y ?? client?.clientY) - top - finite(camera?.y)) / zoom};
}

export function worldToClient(world, camera, rect) {
  const zoom = positive(camera?.zoom, 1);
  return {x: finite(rect?.left) + finite(camera?.x) + finite(world?.x) * zoom, y: finite(rect?.top) + finite(camera?.y) + finite(world?.y) * zoom};
}

export function rectCenter(rect = {}) {
  return {x: finite(rect.left) + finite(rect.width) / 2, y: finite(rect.top) + finite(rect.height) / 2};
}

export function unionNodeBounds(nodes = []) {
  const list = Array.from(nodes, nodeRect);
  if (!list.length) return {x: 0, y: 0, width: 1, height: 1, left: 0, top: 0, right: 1, bottom: 1};
  const left = Math.min(...list.map(rect => rect.left));
  const top = Math.min(...list.map(rect => rect.top));
  const right = Math.max(...list.map(rect => rect.right));
  const bottom = Math.max(...list.map(rect => rect.bottom));
  return {x: (left + right) / 2, y: (top + bottom) / 2, width: right - left, height: bottom - top, left, top, right, bottom};
}

export function renderEdgePaths(group, paths = []) {
  if (!group) return;
  // Resolve the existing SVG children once per frame.  The previous lookup
  // scanned the whole group for every edge (`E` querySelectorAll calls plus an
  // `E`-sized linear search), which made a drag/camera frame quadratic in the
  // number of edges.  A single id map keeps path identity and DOM semantics
  // unchanged while making updates linear.
  const existing = new Map(
    Array.from(group.querySelectorAll?.('[data-edge-id]') ?? [], path => [String(path.dataset.edgeId), path]),
  );
  const seen = new Set();
  for (const item of paths) {
    const id = String(item.id);
    let path = existing.get(id);
    if (!path && group.ownerDocument?.createElementNS) {
      path = group.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.dataset.edgeId = id;
      path.setAttribute('fill', 'none');
      group.append(path);
    }
    if (!path) continue;
    path.setAttribute('d', item.d ?? '');
    path.dataset.edgeFrame = String(item.frameId ?? '');
    if (item.kind) path.dataset.edgeKind = String(item.kind);
    existing.set(id, path);
    seen.add(path);
  }
  for (const path of existing.values()) if (!seen.has(path)) path.remove();
}

export const geometry = Object.freeze({nodeRect, nodeCenter, nodePort, edgePoints, edgePath, edgePaths, applyWorldTransform, formatSvgTransform, distance, lerpPoint, clientToWorld, worldToClient, rectCenter, unionNodeBounds, renderEdgePaths});
