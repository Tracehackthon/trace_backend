import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import vm from 'node:vm';
import {fileURLToPath, pathToFileURL} from 'node:url';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const bundlePath = path.join(desktopRoot, 'src/vendor/d3-attention.bundle.mjs');
const shapeExportsPath = path.join(desktopRoot, 'src/vendor/d3-attention-shape-exports.mjs');
const lockPath = path.join(desktopRoot, 'approved-assets.lock.json');
const workerPath = path.join(desktopRoot, 'sw.js');
const indexPath = path.join(desktopRoot, 'index.html');
const workerSource = fs.readFileSync(workerPath, 'utf8');

function waitForReady(child, timeout = 15_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`desktop server did not become ready: ${output}`)), timeout);
    const onData = chunk => {
      output += String(chunk);
      const match = output.match(/Trace Web: http:\/\/127\.0\.0\.1:(\d+)\//);
      if (!match) return;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      resolve(Number(match[1]));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`desktop server exited before ready (${code}): ${output}`));
    });
  });
}

test('Attention Canvas d3 vendor bytes and hash are locked', () => {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const asset = lock.assets.find(entry => entry.key === 'vendor.d3-attention');
  assert.ok(asset, 'the audited d3 bundle must have an approved asset lock entry');
  const bytes = fs.readFileSync(path.join(desktopRoot, asset.path));
  assert.equal(bytes.byteLength, asset.bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(), asset.sha256.toUpperCase());
});

test('Attention Canvas d3 bundle does not mutate the global d3 namespace', async () => {
  const bundleUrl = pathToFileURL(bundlePath).href;
  const script = `
    const before = {sentinel: true};
    globalThis.d3 = before;
    const loaded = await import(${JSON.stringify(bundleUrl)} + '?namespace-isolation=' + Date.now());
    process.stdout.write(JSON.stringify({
      same: globalThis.d3 === before,
      keys: Object.keys(globalThis.d3).sort(),
      sentinel: globalThis.d3.sentinel,
      hasZoom: typeof loaded.zoom === 'function',
      hasLink: typeof loaded.link === 'function'
    }));
  `;
  const {stdout} = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {cwd: desktopRoot});
  const result = JSON.parse(stdout);
  assert.deepEqual(result, {same: true, keys: ['sentinel'], sentinel: true, hasZoom: true, hasLink: true});

  const cleanScript = `
    delete globalThis.d3;
    await import(${JSON.stringify(bundleUrl)} + '?namespace-absent=' + Date.now());
    const shape = await import(${JSON.stringify(pathToFileURL(shapeExportsPath).href)} + '?namespace-absent=' + Date.now());
    process.stdout.write(JSON.stringify({created: Object.hasOwn(globalThis, 'd3'), hasShapeLink: typeof shape.link === 'function'}));
  `;
  const clean = await execFileAsync(process.execPath, ['--input-type=module', '-e', cleanScript], {cwd: desktopRoot});
  assert.deepEqual(JSON.parse(clean.stdout), {created: false, hasShapeLink: true});
});

test('real desktop server serves the locked vendor and observable worker assets', {timeout: 30_000}, async t => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'trace-attention-assets-'));
  const child = spawn(process.execPath, [path.join(desktopRoot, 'server.mjs')], {
    cwd: desktopRoot,
    env: {...process.env, TRACE_DESKTOP_PORT: '0', TRACE_WEB_STATE_FILE: path.join(tempRoot, 'web.sqlite')},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (!child.killed) child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    await rm(tempRoot, {recursive: true, force: true});
  });
  const port = await waitForReady(child);
  const base = `http://127.0.0.1:${port}`;
  const bundle = await fetch(`${base}/src/vendor/d3-attention.bundle.mjs`);
  assert.equal(bundle.status, 200);
  assert.match(bundle.headers.get('content-type') || '', /^text\/javascript/);
  const bundleBytes = Buffer.from(await bundle.arrayBuffer());
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const lockEntry = lock.assets.find(entry => entry.key === 'vendor.d3-attention');
  assert.equal(bundleBytes.length, lockEntry.bytes);
  assert.equal(crypto.createHash('sha256').update(bundleBytes).digest('hex').toUpperCase(), lockEntry.sha256.toUpperCase());

  const worker = await fetch(`${base}/sw.js`);
  assert.equal(worker.status, 200);
  assert.match(await worker.text(), /trace-sw-status/);
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /trace:service-worker-status/);
});

test('service worker install exposes safe precache status without leaking the cache error', async () => {
  const messages = [];
  let skipWaitingCalls = 0;
  const listeners = new Map();
  const self = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    skipWaiting() { skipWaitingCalls += 1; },
    clients: {matchAll: async () => [{postMessage(message) { messages.push(message); }}]},
  };
  const context = {
    self,
    caches: {open: async () => ({addAll: async () => { throw new Error('C:\\Users\\secret\\web.sqlite'); }})},
    console,
  };
  vm.runInNewContext(workerSource, context, {filename: workerPath});
  const waiters = [];
  listeners.get('install')({waitUntil(promise) { waiters.push(Promise.resolve(promise)); }});
  assert.equal(waiters.length, 1);
  await assert.rejects(waiters[0]);
  assert.equal(skipWaitingCalls, 0, 'a failed install must not activate the incomplete worker');
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{type: 'trace-sw-status', state: 'degraded', code: 'PRECACHE_FAILED'}]);
  assert.doesNotMatch(JSON.stringify(messages), /Users|sqlite|secret/i);
});

test('service worker install reports ready only after the complete precache succeeds', async () => {
  const messages = [];
  let skipWaitingCalls = 0;
  const listeners = new Map();
  const self = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    skipWaiting() { skipWaitingCalls += 1; },
    clients: {matchAll: async () => [{postMessage(message) { messages.push(message); }}]},
  };
  const context = {
    self,
    caches: {open: async () => ({addAll: async () => undefined})},
    console,
  };
  vm.runInNewContext(workerSource, context, {filename: workerPath});
  const waiters = [];
  listeners.get('install')({waitUntil(promise) { waiters.push(Promise.resolve(promise)); }});
  await waiters[0];
  assert.equal(skipWaitingCalls, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{type: 'trace-sw-status', state: 'ready'}]);
});

test('index registration observes worker failures without blocking online page startup', () => {
  const indexSource = fs.readFileSync(indexPath, 'utf8');
  assert.match(indexSource, /trace:service-worker-status/);
  assert.match(indexSource, /PRECACHE_FAILED/);
  assert.doesNotMatch(indexSource, /serviceWorker\.register\([^)]*\)\.catch\(\(\) => \{\}\)/s);
});
