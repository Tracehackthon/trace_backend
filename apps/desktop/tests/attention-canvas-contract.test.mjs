import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const canvasSource = fs.readFileSync(path.join(here, '../src/attention/attention-canvas.mjs'), 'utf8');
const homeSource = fs.readFileSync(path.join(here, '../src/attention/attention-home.mjs'), 'utf8');
const cameraSource = fs.readFileSync(path.join(here, '../src/attention/camera.mjs'), 'utf8');
const canvasCss = fs.readFileSync(path.join(here, '../src/attention/attention-canvas.css'), 'utf8');
const homeCss = fs.readFileSync(path.join(here, '../src/attention/attention-home.css'), 'utf8');
const workerSource = fs.readFileSync(path.join(here, '../sw.js'), 'utf8');

test('pointerup flushes the latest pending drag frame before layout commit', () => {
  assert.match(canvasSource, /function flushPendingDrag\(active\)/);
  assert.match(canvasSource, /if \(!cancelled\) flushPendingDrag\(active\)/);
  assert.match(canvasSource, /layout\.set\(active\.nodeId, \{\.\.\.pendingWorld\}\)/);
  assert.match(canvasSource, /active\.currentWorld = \{\.\.\.pendingWorld\}/);
  assert.match(canvasSource, /Projection\/UI positions use top-left coordinates/);
  assert.match(canvasSource, /world\.x - rect\.width \/ 2/);
  assert.match(canvasSource, /world\.y - rect\.height \/ 2/);
});

test('canvas destroy owns and removes its DOM/listener graph', () => {
  assert.match(canvasSource, /destroy\(\{clear = true\} = \{\}\)/);
  assert.match(canvasSource, /nodeElements\.clear\(\)/);
  assert.match(canvasSource, /nodeListeners\.clear\(\)/);
  assert.match(canvasSource, /root\.replaceChildren\?\.\(\)/);
});

test('clearFocus invalidates focus animation before rendering the overview', () => {
  const clearStart = canvasSource.indexOf('clearFocus() {');
  assert.notEqual(clearStart, -1);
  const clearBlock = canvasSource.slice(clearStart, canvasSource.indexOf('toggleFullscreen, closeSidebar, destroy', clearStart));
  assert.match(clearBlock, /focusEpoch \+= 1/);
  assert.match(clearBlock, /camera\.interrupt\?\.\(\)/);
  assert.match(clearBlock, /state\.focus = null/);
});

test('home adapter aborts its root listener on destroy and worker precaches d3 geometry', () => {
  assert.match(homeSource, /const controller = new AbortController\(\)/);
  assert.match(homeSource, /\{signal: controller\.signal\}/);
  assert.match(homeSource, /controller\.abort\(\)/);
  assert.match(workerSource, /\.\/src\/vendor\/d3-attention\.bundle\.mjs/);
  assert.match(workerSource, /\.\/runtime\/product-workspace\/scope-contract\.mjs/);
});

test('camera keyboard controls follow the focusable canvas root without hijacking editors', () => {
  assert.match(canvasSource, /keyboardSurface: root/);
  assert.match(cameraSource, /keyboardSurface = options\.keyboardSurface \?\? surface/);
  assert.match(cameraSource, /\[role="button"\]/);
  assert.match(cameraSource, /keyboardSurface\?\.removeEventListener/);
});

test('d3 camera transforms keep the constructor order k, x, y', () => {
  assert.match(cameraSource, /new ZoomTransform\(state\.zoom, state\.x, state\.y\)/);
  assert.doesNotMatch(cameraSource, /new ZoomTransform\(state\.x, state\.y, state\.zoom\)/);
});

test('sidebar close styling is scoped and context actions keep normal button geometry', () => {
  assert.match(canvasSource, /attention-canvas__sidebar-close/);
  assert.doesNotMatch(canvasCss, /\.attention-canvas__sidebar button\s*\{/);
  assert.match(homeCss, /\.attention-canvas__sidebar-action\s*\{/);
  assert.match(homeCss, /attention-home\[data-attention-sidebar-open="true"\]/);
  assert.match(homeCss, /attention-home__reader\s*\{[^}]*z-index: 90/s);
});

test('semantic zoom keeps node summaries measurable only after context zoom', () => {
  assert.match(canvasCss, /data-canvas-semantic-level="0"[^}]*node-summary/s);
  assert.match(canvasCss, /data-canvas-semantic-level="1"[^}]*node-summary/s);
  assert.match(canvasCss, /data-canvas-semantic-level="2"[^}]*node-summary[^}]*min-height: 1\.55em/s);
  assert.match(canvasCss, /data-canvas-semantic-level="3"[^}]*node-summary[^}]*-webkit-line-clamp: 5/s);
});

test('canvas focus indicators use a dark enough green for the light surface', () => {
  assert.match(canvasCss, /--canvas-focus:\s*#2b6956/);
  assert.doesNotMatch(canvasCss, /outline:\s*2px\s+solid\s+#76a994/);
  assert.doesNotMatch(canvasCss, /border-color:\s+#76a994/);
  assert.match(canvasCss, /node:focus-visible[\s\S]*var\(--canvas-focus\)/);
  assert.match(canvasCss, /fullscreen:focus-visible[\s\S]*var\(--canvas-focus\)/);
  assert.match(canvasCss, /composer-input:focus-visible[\s\S]*var\(--canvas-focus\)/);
});

test('reader modal traps document keyboard focus and restores the trigger', () => {
  const readerSource = fs.readFileSync(path.join(here, '../src/attention/attention-reader.mjs'), 'utf8');
  assert.match(readerSource, /modalKeydownAbort = new AbortController\(\)/);
  assert.match(readerSource, /doc\.addEventListener\('keydown',[\s\S]*capture: true, signal: modalKeydownAbort\.signal/);
  assert.match(readerSource, /if \(event\.key === 'Escape'\)/);
  assert.match(readerSource, /if \(event\.key !== 'Tab'\) return/);
  assert.match(readerSource, /event\.shiftKey \? -1 : 1/);
  assert.match(readerSource, /setBackgroundModalState\(true\)/);
  assert.match(readerSource, /returnFocusElement/);
  assert.match(readerSource, /tag === 'body' \|\| tag === 'html'/);
  assert.match(readerSource, /requestAnimationFrame\(retry\)/);
  assert.match(readerSource, /safeFocus\(preferred\)/);
  assert.match(readerSource, /if \(wasOpen && !current\.open\) restoreFocus\(\)/);
  assert.match(homeSource, /const returnFocusElement =/);
  assert.match(homeSource, /reader\.update\(\{\.\.\.input, open: true, returnFocusKey: node\?\.id \|\| null, returnFocusElement/);
});

test('focused canvas reader reprojects the selected Matter instead of reusing host selectedId', () => {
  assert.match(homeSource, /projectAttentionCanvas\(currentHost, \{matterId, focus: focus \|\| node\?\.id\}\)/);
  assert.match(homeSource, /attentionReaderInput\(readerProjection, node, focus\)/);
});

test('perched bird declares an outside-edge anchor', () => {
  assert.match(canvasSource, /birdAnchor = 'outside-edge'/);
  assert.match(canvasSource, /rect\.right \+ 28/);
  assert.match(canvasSource, /rect\.top - 44/);
});
