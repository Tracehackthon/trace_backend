import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCamera,
  fitCamera,
  panBy,
  screenToWorld,
  semanticZoomLevel,
  worldToScreen,
  zoomAt,
} from '../apps/desktop/src/attention/camera.mjs';
import {
  clientToWorld,
  edgePath,
  edgePaths,
  nodePort,
  nodeRect,
  unionNodeBounds,
} from '../apps/desktop/src/attention/geometry.mjs';

test('world/screen conversion is inverse for arbitrary camera', () => {
  const camera = createCamera({x: 118, y: -42, zoom: 1.35});
  const world = {x: -12.5, y: 93.25};
  assert.deepEqual(screenToWorld(worldToScreen(world, camera), camera), world);
  assert.deepEqual(clientToWorld({x: 400, y: 250}, camera, {left: 20, top: 10}), {x: (400 - 20 - 118) / 1.35, y: (250 - 10 + 42) / 1.35});
});

test('zoomAt preserves the world point beneath the pointer', () => {
  const camera = createCamera({x: 22, y: 11, zoom: 0.8, minZoom: 0.25, maxZoom: 3});
  const pointer = {x: 500, y: 300};
  const before = screenToWorld(pointer, camera);
  const after = zoomAt(camera, 1.9, pointer);
  assert.deepEqual(screenToWorld(pointer, after), before);
  assert.equal(after.zoom, 1.9);
});

test('semantic zoom levels use hysteresis and fit zoom normalization', () => {
  const base = createCamera({fitZoom: 0.5, zoom: 0.5});
  assert.equal(semanticZoomLevel(base), 1);
  assert.equal(semanticZoomLevel({...base, zoom: 0.5 * 0.79}, 0), 1);
  assert.equal(semanticZoomLevel({...base, zoom: 0.5 * 0.76}, 1), 1);
  assert.equal(semanticZoomLevel({...base, zoom: 0.5 * 0.73}, 1), 0);
  assert.equal(semanticZoomLevel({...base, zoom: 0.5 * 1.04}, 1), 2);
  assert.equal(semanticZoomLevel({...base, zoom: 0.5 * 1.44}, 2), 3);
  assert.equal(semanticZoomLevel({...base, zoom: 0.5 * 1.36}, 3), 3);
  assert.equal(semanticZoomLevel({...base, zoom: 0.5 * 1.34}, 3), 2);
});

test('fitCamera keeps scene center at viewport center', () => {
  const camera = fitCamera({viewport: {width: 1200, height: 800}, scene: {x: 200, y: 150, width: 800, height: 400}, padding: 40, minZoom: 0.1, maxZoom: 4});
  assert.equal(camera.zoom, 1.4);
  assert.deepEqual(worldToScreen({x: 200, y: 150}, camera), {x: 600, y: 400});
});

test('panBy returns an immutable next camera', () => {
  const camera = createCamera({x: 10, y: 20});
  const moved = panBy(camera, 5, -8);
  assert.deepEqual({x: camera.x, y: camera.y}, {x: 10, y: 20});
  assert.deepEqual({x: moved.x, y: moved.y}, {x: 15, y: 12});
});

test('geometry resolves stable node ports and d3-shape paths', () => {
  const nodes = [
    {id: 'a', x: 0, y: 0, width: 120, height: 80},
    {id: 'b', x: 260, y: 120, width: 140, height: 90},
  ];
  assert.deepEqual(nodeRect(nodes[0]).left, -60);
  assert.deepEqual(nodePort(nodes[0], 'right'), {x: 60, y: 0});
  const path = edgePath({id: 'e', source: 'a', target: 'b'}, nodes);
  assert.match(path, /^M/);
  assert.match(path, /C/);
  assert.equal(edgePaths([{id: 'e', source: 'a', target: 'b'}], nodes)[0].id, 'e');
  assert.deepEqual(unionNodeBounds(nodes), {x: 135, y: 62.5, width: 390, height: 205, left: -60, top: -40, right: 330, bottom: 165});
});

