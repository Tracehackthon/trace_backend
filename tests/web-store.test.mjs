import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createProductWorkspace } from '../packages/product/workspace/src/workspace.mjs';

function sample(text = '今天的理解：先核验，再修改 🙂') {
  return {
    schemaVersion: 1, preferences: { displayName: '测试用户', reduceMotion: true },
    chain: { schemaVersion: 1, nextId: 2, screen: 'understanding', selectedId: 'matter-中文', isDemo: false, notice: '不持久的成功提示',
      matters: [{ id: 'matter-中文', title: '同一件事', understanding: text, understandingDraft: text + '\n草稿不丢失', understandingVersion: 1, understandingDraftVersion: 2, sourceIds: ['source-1'], links: [{ id: 'link-1', sourceId: 'source-1' }], revisions: [{ id: 'rev-1', before: '之前', after: text }], observations: [], extraFutureField: { preserved: true } }],
      sources: [{ id: 'source-1', title: '我的材料', excerpt: '不是示例材料', kind: 'user', ownerMatterId: 'matter-中文' }],
      sessions: { 'matter-中文': { contextMode: 'resume', composer: { text: '会话草稿' }, focus: { field: 'understanding', start: 0, end: 2, text: '今天' }, backStack: ['resume'] } },
      unassignedMaterials: [], capture: { text: '首页还没提交的文字', sourceIds: [], excerpt: '', excerptSourceId: null }, collapseUndo: null },
    comparisons: { 'compare-1': { matterId: 'matter-中文', anchor: { field: 'understanding', baseVersion: 1 }, returnTarget: { matterId: 'matter-中文', screen: 'understanding' }, model: { schemaVersion: 1, sessionId: 'compare-1', matter: { id: 'matter-中文', version: 1 }, isDemo: true, notice: '短暂对照提示', catalog: [], drafts: { 'candidate-1': '我还没决定' }, notes: {}, request: null } } },
    worksite: { schemaVersion: 1, isDemo: false, selectedWorkId: 'work-1', notice: '临时工作提示', sequence: 1,
      works: { 'work-1': { id: 'work-1', title: '我的本地工作', connected: false } }, sessions: { 'work-1': { screen: 'finding', intake: [{ id: 'intake-1', matterId: 'matter-中文', sourceVersion: 1 }], finding: { text: '现场未提交发现' }, results: [{ id: 'result-1', matterId: 'matter-中文', fact: '实际结果' }] } } },
    workGuards: { 'work-1': { matterId: 'matter-中文', draftVersion: 2 } }, route: { view: 'compare', matterId: 'matter-中文' }, error: { code: 'temporary' },
  };
}
function canonical(host) { host = structuredClone(host); host.route = { view: 'home' }; host.error = null; host.chain.notice = ''; host.worksite.notice = ''; for (const local of Object.values(host.comparisons)) local.model.notice = ''; return host; }
const cleanups = new WeakMap();
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-web-store-test-'));
  const file = path.join(directory, 'web.sqlite');
  cleanups.set(t, []);
  t.after(async () => {
    // Node's after hooks run in registration order. Close all handles first.
    for (const close of cleanups.get(t)) await close();
    const absolute = path.resolve(directory);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
    assert.ok(path.basename(absolute).startsWith('trace-web-store-test-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  return file;
}
async function serve(t, file) {
  // Explicit legacy import path for storage-format regression only. The real
  // server defaults to commands-only and never enables snapshot HTTP writes.
  const store = createProductWorkspace({ file, allowSnapshotWrites: true });
  const server = http.createServer(async (req, res) => { if (!await store.handle(req, res)) { res.writeHead(404); res.end('outside store'); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let stopped = false;
  const close = async () => { if (stopped) return; stopped = true; await new Promise(resolve => server.close(resolve)); store.close(); };
  if (cleanups.has(t)) cleanups.get(t).push(close); else t.after(close);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (pathname, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(origin + pathname, { method, headers: { ...(['PUT','POST'].includes(method) ? { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } : {}), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
    const text = await response.text(); let json; try { json = JSON.parse(text); } catch { /* outside route */ }
    return { response, status: response.status, text, json };
  };
  const put = (host, expectedRevision = 0, commandId = 'command-1') => request('/api/web/workspace', { method: 'PUT', body: { expectedRevision, commandId, host } });
  return { store, server, origin, request, put, close };
}

test('UTF-8 entities, preferences and session/home drafts persist across close/reopen', async t => {
  const file = temporary(t), first = await serve(t, file);
  const empty = await first.request('/api/web/workspace');
  assert.deepEqual(empty.json, { revision: 0, host: null, storage: { kind: 'sqlite', location: file } });
  const host = sample(), saved = await first.put(host);
  assert.equal(saved.status, 200, saved.text); assert.equal(saved.json.revision, 1);
  assert.deepEqual(saved.json.host, canonical(host));
  await first.close();
  const second = await serve(t, file), restored = await second.request('/api/web/workspace');
  assert.equal(restored.status, 200, restored.text); assert.deepEqual(restored.json, saved.json);
  assert.equal(restored.json.host.chain.capture.text, host.chain.capture.text);
  assert.equal(restored.json.host.chain.matters[0].extraFutureField.preserved, true);
  assert.deepEqual(restored.json.host.preferences, host.preferences);
  const exported = await second.request('/api/web/export');
  assert.match(exported.response.headers.get('content-disposition'), /^attachment;/);
  assert.deepEqual(exported.json, restored.json);
  assert.equal(exported.response.headers.get('access-control-allow-origin'), null);
  assert.equal(exported.response.headers.get('cache-control'), 'no-store');
});

test('CAS rejects stale writers and two database handles see one authoritative revision', async t => {
  const file = temporary(t), a = await serve(t, file), b = await serve(t, file);
  assert.equal((await a.put(sample('甲'))).status, 200);
  const conflict = await b.put(sample('乙'), 0, 'command-b');
  assert.equal(conflict.status, 409); assert.equal(conflict.json.error.code, 'REVISION_CONFLICT'); assert.equal(conflict.json.revision, 1);
  assert.equal((await b.put(sample('乙'), 1, 'command-b')).json.revision, 2);
  assert.equal((await a.request('/api/web/workspace')).json.host.chain.matters[0].understanding, '乙');
});

test('idempotent replay is exact, survives reopen and does not overwrite later revisions', async t => {
  const file = temporary(t), a = await serve(t, file), firstHost = sample('第一次');
  const first = await a.put(firstHost, 0, 'unique-command');
  assert.equal(first.status, 200, first.text);
  const replay = await a.put({ ...firstHost, route: { view: 'home' }, error: null }, 0, 'unique-command');
  assert.deepEqual(replay.json, first.json);
  assert.equal((await a.put(sample('后来修改'), 1, 'later-command')).json.revision, 2);
  assert.deepEqual((await a.put(firstHost, 0, 'unique-command')).json, first.json);
  const collision = await a.put(sample('不同正文'), 0, 'unique-command');
  assert.equal(collision.status, 409); assert.equal(collision.json.error.code, 'COMMAND_CONFLICT');
  await a.close(); const b = await serve(t, file);
  assert.deepEqual((await b.put(firstHost, 0, 'unique-command')).json, first.json);
  assert.equal((await b.request('/api/web/workspace')).json.revision, 2);
});

test('cross-origin, same-site other port, missing Origin and DNS-rebinding Host writes fail', async t => {
  const a = await serve(t, temporary(t)), body = { host: sample(), expectedRevision: 0, commandId: 'blocked' };
  for (const headers of [{ origin: 'https://attacker.invalid' }, { origin: 'null' }, { origin: 'http://127.0.0.1:1' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { host: 'attacker.invalid', origin: 'http://attacker.invalid' }]) {
    const denied = await a.request('/api/web/workspace', { method: 'PUT', body, headers });
    assert.equal(denied.status, 403, JSON.stringify(headers));
  }
  const missing = await fetch(a.origin + '/api/web/workspace', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(missing.status, 403);
  const readDenied = await a.request('/api/web/export', { headers: { origin: 'https://attacker.invalid', 'sec-fetch-site': 'cross-site' } });
  assert.equal(readDenied.status, 403);
  assert.equal((await a.request('/api/web/workspace')).json.revision, 0);
});

test('invalid JSON, invalid UTF-8, content type, command and 8 MiB limits leave no mutation', async t => {
  const a = await serve(t, temporary(t));
  const cases = [
    [{ body: '{' }, 400], [{ body: Buffer.from([0xc3, 0x28]) }, 400],
    [{ body: '{}', headers: { 'content-type': 'text/plain' } }, 415],
    [{ body: '{}', headers: { 'content-encoding': 'gzip' } }, 415],
    [{ body: { expectedRevision: -1, commandId: 'x', host: sample() } }, 400],
    [{ body: { expectedRevision: 0, commandId: '', host: sample() } }, 400],
    [{ body: { expectedRevision: 0, commandId: 'x', host: null } }, 422],
    [{ body: ' '.repeat(8 * 1024 * 1024 + 1) }, 413],
  ];
  for (const [options, status] of cases) assert.equal((await a.request('/api/web/workspace', { method: 'PUT', ...options })).status, status);
  assert.equal((await a.request('/api/web/workspace')).json.revision, 0);
});

test('unknown routes stay scoped, supported routes reject unsupported methods without CORS', async t => {
  const a = await serve(t, temporary(t));
  const outside = await a.request('/api/other'); assert.equal(outside.text, 'outside store');
  const adjacent = await a.request('/api/website'); assert.equal(adjacent.text, 'outside store');
  assert.equal((await a.request('/api/web/no-such-route')).json.error.code, 'NOT_FOUND');
  const preflight = await a.request('/api/web/workspace', { method: 'OPTIONS' });
  assert.equal(preflight.status, 405); assert.equal(preflight.response.headers.get('access-control-allow-origin'), null);
  assert.equal((await a.request('/api/web/export', { method: 'POST' })).status, 405);
  a.store.close(); a.store.close();
  assert.equal((await a.request('/api/web/workspace')).json.error.code, 'STORE_CLOSED');
});

test('entity identity, referential integrity, prototype keys and demo stores fail closed', async t => {
  const a = await serve(t, temporary(t));
  const invalid = [];
  let h = sample(); h.chain.matters.push(structuredClone(h.chain.matters[0])); invalid.push(h);
  h = sample(); h.chain.selectedId = 'missing'; invalid.push(h);
  h = sample(); delete h.chain.sessions['matter-中文']; invalid.push(h);
  h = sample(); h.chain.sources[0].ownerMatterId = 'missing'; invalid.push(h);
  h = sample(); h.comparisons['compare-1'].model.matter.id = 'other'; invalid.push(h);
  h = sample(); h.worksite.matters = {}; invalid.push(h);
  h = sample(); h.worksite.works['work-1'].id = 'other'; invalid.push(h);
  h = sample(); h.worksite.sessions['work-1'].intake[0].matterId = 'missing'; invalid.push(h);
  h = sample(); h.chain.isDemo = true; invalid.push(h);
  h = sample(); h.chain.sources[0].kind = 'example-article'; invalid.push(h);
  h = sample(); h.preferences.reduceMotion = 'yes'; invalid.push(h);
  h = sample(); h.chain.capture = JSON.parse('{"__proto__":{"polluted":true}}'); invalid.push(h);
  for (const host of invalid) assert.equal((await a.put(host)).status, 422);
  assert.equal({}.polluted, undefined); assert.equal((await a.request('/api/web/workspace')).json.revision, 0);
});

test('SQLite rows separate entities and recovery metadata, not a serialized whole host', async t => {
  const file = temporary(t), a = await serve(t, file); assert.equal((await a.put(sample())).status, 200);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('SELECT kind,object_id,payload FROM web_entities WHERE workspace_revision=1').all();
    assert.deepEqual(new Set(rows.map(row => row.kind)), new Set(['host-meta', 'chain-meta', 'matter', 'source', 'chain-session', 'comparison', 'worksite-meta', 'work', 'worksite-session', 'work-guard']));
    const meta = JSON.parse(rows.find(row => row.kind === 'host-meta').payload); assert.deepEqual(Object.keys(meta).sort(), ['preferences', 'schemaVersion']);
    const chain = JSON.parse(rows.find(row => row.kind === 'chain-meta').payload); assert.equal(chain.matters, undefined); assert.equal(chain.sessions, undefined); assert.equal(chain.sources, undefined); assert.equal(chain.capture.text, '首页还没提交的文字');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM web_commands').get().n, 1);
  } finally { db.close(); }
});

test('mid-transaction SQLite failure rolls back snapshots, commands and current revision', async t => {
  const file = temporary(t), a = await serve(t, file); assert.equal((await a.put(sample())).status, 200);
  const db = new DatabaseSync(file);
  db.exec("CREATE TRIGGER force_test_failure BEFORE INSERT ON web_entities WHEN NEW.kind='source' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
  try {
    const failed = await a.put(sample('不应写入'), 1, 'retryable'); assert.equal(failed.status, 503);
    assert.equal((await a.request('/api/web/workspace')).json.revision, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM web_snapshots').get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM web_commands WHERE command_id='retryable'").get().n, 0);
    db.exec('DROP TRIGGER force_test_failure');
    assert.equal((await a.put(sample('可重试'), 1, 'retryable')).json.revision, 2);
  } finally { db.close(); }
});

test('corrupt payload reads and writes fail visibly; reopening never resets corruption', async t => {
  const file = temporary(t), a = await serve(t, file); assert.equal((await a.put(sample())).status, 200);
  const db = new DatabaseSync(file); db.prepare("UPDATE web_entities SET payload='{' WHERE kind='matter'").run(); db.close();
  const corruptRead = await a.request('/api/web/workspace'); assert.equal(corruptRead.status, 503); assert.equal(corruptRead.json.error.code, 'STORAGE_CORRUPT');
  assert.equal((await a.put(sample('不得覆盖损坏'), 1, 'later')).status, 503);
  await a.close(); assert.throws(() => createProductWorkspace({ file }), error => error.code === 'STORAGE_CORRUPT');
  const verify = new DatabaseSync(file, { readOnly: true }); try { assert.equal(verify.prepare('SELECT revision FROM web_workspace').get().revision, 1); } finally { verify.close(); }
});

test('rejects wrong/ledger database before changing bytes or creating web tables', t => {
  const file = temporary(t); const db = new DatabaseSync(file); db.exec('CREATE TABLE adopted(identity TEXT PRIMARY KEY,payload TEXT); INSERT INTO adopted VALUES(\'keep\',\'original\')'); db.close();
  const before = fs.readFileSync(file);
  assert.throws(() => createProductWorkspace({ file }), error => error.code === 'WRONG_DATABASE');
  assert.deepEqual(fs.readFileSync(file), before);
  const verify = new DatabaseSync(file, { readOnly: true }); try { assert.deepEqual(verify.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name), ['adopted']); } finally { verify.close(); }
  assert.throws(() => createProductWorkspace({ file: path.join(path.dirname(file), 'trace.sqlite') }), error => error.code === 'WRONG_DATABASE');
  assert.throws(() => createProductWorkspace({ file: 'relative.sqlite' }), error => error.code === 'INVALID_PATH');
  assert.equal(fs.existsSync(path.join(path.dirname(file), 'trace.sqlite')), false);
});

test('damaged revision head cannot silently turn saved entities into an empty workspace', async t => {
  const file = temporary(t), a = await serve(t, file); assert.equal((await a.put(sample())).status, 200);
  const db = new DatabaseSync(file); db.exec('UPDATE web_workspace SET revision=0 WHERE singleton=1'); db.close();
  const result = await a.request('/api/web/workspace');
  assert.equal(result.status, 503); assert.equal(result.json.error.code, 'STORAGE_CORRUPT');
  await a.close(); assert.throws(() => createProductWorkspace({ file }), error => error.code === 'STORAGE_CORRUPT');
});
