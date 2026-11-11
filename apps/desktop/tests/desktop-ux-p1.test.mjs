import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('agent and profile surfaces keep technical identity behind explicit diagnostics', async () => {
  const agent = await read('src/product/agent-panel.mjs');
  const web = await read('src/web-main.js');
  assert.match(agent, /诊断信息/);
  assert.match(agent, /当前事项：\$\{h\(matterLabel\)\}/);
  assert.doesNotMatch(agent, /当前事项：\$\{h\(matterId\)\}/);
  assert.match(web, /完整路径已隐藏/);
  assert.doesNotMatch(web, /<p>\$\{h\(storage\?\.location\)<\/p>/);
});

test('mobile chain layout avoids a fixed-canvas downscale and keeps close events local', async () => {
  const screen = await read('src/product/chain-screen.mjs');
  const css = await read('src/product/chain.css');
  const worksite = await read('src/product/worksite-screen.mjs');
  assert.match(screen, /root\.clientWidth <= 720/);
  assert.match(screen, /event\.stopPropagation\(\);onBack\(current\)/);
  assert.match(css, /@media\(max-width:720px\)/);
  assert.match(css, /\.chain-handoff-layout/);
  assert.match(worksite, /event\.target!==event\.currentTarget/);
});
