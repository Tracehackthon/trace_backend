import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../../../packages/product/workspace/src/bridge.mjs';
import {createDemoWorkspace} from '../../../packages/product/workspace/src/demo-workspace.mjs';
import {projectAttentionCanvas} from '../src/attention/attention-projection.mjs';
import {nodeRect} from '../src/attention/geometry.mjs';
import {
  ATTENTION_LAYOUT_STORAGE_KEY,
  attentionCanvasModel,
  attentionReaderInput,
  persistAttentionLayoutPosition,
  readAttentionLayout,
  writeAttentionLayout,
} from '../src/attention/attention-home.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function failingStorage() {
  return {getItem: () => null, setItem: () => { throw new Error('storage denied') }};
}

test('home adapter renders only projection nodes and preserves an honest empty host', () => {
  const empty = projectAttentionCanvas(B.createBridge());
  assert.deepEqual(attentionCanvasModel(empty).nodes, []);
  assert.deepEqual(attentionCanvasModel(empty).edges, []);

  const ready = projectAttentionCanvas(createDemoWorkspace());
  const model = attentionCanvasModel(ready);
  assert.equal(model.nodes.length, ready.nodes.length);
  assert.equal(model.edges.length, ready.edges.length);
  assert.equal(model.nodes.every(node => node.positionMode === 'top-left'), true);
  assert.equal(model.nodes.some(node => node.title.includes('Agent 自动生成')), false);
});

test('reader input keeps original/user/Agent lanes detached and Agent collapsed', () => {
  let host = B.createBridge();
  host = B.captureInput(host, {matterId: 'matter-reader', text: '用户原话'});
  host = B.dispatchChain(host, {matterId: 'matter-reader', action: {type: 'UNDERSTANDING_DRAFT', text: '用户自己的草稿'}});
  host = B.dispatchChain(host, {matterId: 'matter-reader', action: {type: 'SAVE_UNDERSTANDING'}});
  host.chain.sessions['matter-reader'].suggestion = {
    start: 0, end: 2, original: '用户', replacement: 'Agent 候选', status: 'pending',
    origin: {type: 'agent-run', runId: 'run-reader'},
  };
  const projection = projectAttentionCanvas(host, {matterId: 'matter-reader'});
  const candidateNode = projection.nodes.find(node => node.type === 'agent-candidate');
  const input = attentionReaderInput(projection, candidateNode, {nodeId: candidateNode.id, objectId: candidateNode.objectId});
  assert.equal(input.source.fullText, '用户原话');
  assert.equal(input.user.text, '用户自己的草稿');
  assert.equal(input.agent.candidates.length, 1);
  assert.equal(input.agent.candidates[0].text, 'Agent 候选');
  assert.equal(input.agent.expanded, false);
  assert.notEqual(input.source.fullText, input.user.text);
});

test('focused handoff Matter reprojects reader identity instead of using the overview selected Matter', () => {
  const host = createDemoWorkspace();
  const overview = projectAttentionCanvas(host);
  const handoff = overview.nodes.find(node => node.id === 'matter:matter-demo-handoff');
  assert.ok(handoff);
  const focusedProjection = projectAttentionCanvas(host, {matterId: handoff.matterId, focus: handoff.id});
  const input = attentionReaderInput(focusedProjection, handoff, {nodeId: handoff.id, objectId: handoff.objectId});
  assert.equal(input.matterId, 'matter-demo-handoff');
  assert.match(input.source.fullText, /handoff/);
  assert.doesNotMatch(input.source.fullText, /每次想写点东西/);
  assert.match(input.user.text, /没核过|踩空/);
});

test('layout overrides round-trip through UI storage only and never mutate the host projection', () => {
  const storage = memoryStorage();
  const sessionStorage = memoryStorage();
  const positions = {'matter:matter-demo-writing': {x: 420, y: 315, width: 220, height: 100}};
  assert.equal(writeAttentionLayout({storage, key: ATTENTION_LAYOUT_STORAGE_KEY, positions}), true);
  assert.deepEqual(readAttentionLayout({storage, key: ATTENTION_LAYOUT_STORAGE_KEY}), positions);
  assert.equal(persistAttentionLayoutPosition({storage, sessionStorage, nodeId: 'source:one', position: {x: 12, y: 18}}), true);
  assert.deepEqual(readAttentionLayout({storage, key: ATTENTION_LAYOUT_STORAGE_KEY})['source:one'], {x: 12, y: 18});

  const host = createDemoWorkspace();
  const before = JSON.stringify(host);
  const projection = projectAttentionCanvas(host, {positionOverrides: readAttentionLayout({storage, key: ATTENTION_LAYOUT_STORAGE_KEY})});
  assert.equal(JSON.stringify(host), before);
  assert.equal(projection.nodes.find(node => node.id === 'matter:matter-demo-writing').layoutSource, 'ui-override');
});

test('invalid or non-finite UI positions are discarded instead of entering renderer state', () => {
  const storage = memoryStorage();
  storage.setItem(ATTENTION_LAYOUT_STORAGE_KEY, JSON.stringify({positions: {
    good: {x: 2, y: 3},
    bad: {x: 'NaN', y: 3},
    missing: {x: 4},
  }}));
  assert.deepEqual(readAttentionLayout({storage}), {good: {x: 2, y: 3}});
});

test('layout persistence falls back from blocked localStorage to sessionStorage', () => {
  const sessionStorage = memoryStorage();
  assert.equal(persistAttentionLayoutPosition({storage: failingStorage(), sessionStorage, nodeId: 'matter:one', position: {x: 1, y: 2}}), true);
  assert.deepEqual(readAttentionLayout({storage: failingStorage(), sessionStorage}), {'matter:one': {x: 1, y: 2}});
});

test('persisted canvas positions round-trip as top-left world coordinates', () => {
  const storage = memoryStorage();
  const position = {x: 488.7864, y: 193.7184, width: 210, height: 92};
  assert.equal(persistAttentionLayoutPosition({storage, nodeId: 'matter:matter-demo-handoff', position}), true);
  const projection = projectAttentionCanvas(createDemoWorkspace(), {positionOverrides: readAttentionLayout({storage})});
  const node = attentionCanvasModel(projection).nodes.find(item => item.id === 'matter:matter-demo-handoff');
  assert.equal(node.positionMode, 'top-left');
  const rect = nodeRect(node);
  assert.equal(rect.x, position.x + position.width / 2);
  assert.equal(rect.y, position.y + position.height / 2);
  assert.equal(rect.width, position.width);
  assert.equal(rect.height, position.height);
  assert.ok(Math.abs(rect.left - position.x) < 1e-9);
  assert.equal(rect.top, position.y);
  assert.equal(rect.right, position.x + position.width);
  assert.equal(rect.bottom, position.y + position.height);
});
