import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { backup, verify, restore } from '../scripts/maintain-product-state.mjs';
import { acquireStateOwner } from '../apps/desktop/state-owner.mjs';

const runtimeRoot = fileURLToPath(new URL('..', import.meta.url));
const entry = path.join(runtimeRoot, 'apps/desktop/server.mjs');
const lifecycle = path.join(runtimeRoot, 'tests/fixtures/desktop-lifecycle.mjs');
const cli = path.join(runtimeRoot, 'scripts/maintain-product-state.mjs');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function isolated() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-pair-recovery-'));
  const cleanup = () => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('trace-pair-recovery-'));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  return { dir, web: path.join(dir, 'web.sqlite'), agent: path.join(dir, 'agent.sqlite'), bundle: path.join(dir, 'pair'), cleanup };
}
async function port() {
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const value = listener.address().port; await new Promise(resolve => listener.close(resolve)); return value;
}
function launch(files, selectedPort, extra = {}) {
  const child = spawn(process.execPath, [lifecycle], { cwd: runtimeRoot, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TRACE_DESKTOP_PORT: String(selectedPort), TRACE_WEB_STATE_FILE: files.web,
      TRACE_AGENT_STATE_FILE: files.agent, TRACE_AGENT_ENABLED: '0', TRACE_ZHIHU_ENABLED: '0', ...extra } });
  let log = ''; child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
  return { child, log: () => log, origin: `http://127.0.0.1:${selectedPort}` };
}
async function started(files, selectedPort, extra) {
  const host = launch(files, selectedPort, extra);
  for (let i = 0; i < 150; i++) {
    if (host.log().includes('Trace Web:')) return host;
    if (host.child.exitCode !== null) break;
    await sleep(20);
  }
  throw new Error(`服务未启动：${host.log()}`);
}
async function stopped(host, signal = 'graceful') {
  if (host.child.exitCode !== null || host.child.signalCode !== null) return;
  const done = once(host.child, 'close');
  if (signal === 'graceful') host.child.stdin.write('stop\n'); else host.child.kill(signal);
  await done;
}
async function request(host, pathname, body) {
  const response = await fetch(host.origin + pathname, { method: body ? 'POST' : 'GET',
    headers: body ? {origin: host.origin, 'content-type': 'application/json'} : {},
    ...(body ? {body: JSON.stringify(body)} : {}) });
  return { status: response.status, body: await response.json() };
}
function createMatter(commandId, revision) {
  return { protocolVersion: 1, commandId, expectedRevision: revision,
    operations: [{type: 'capture.create', matterId: commandId, text: `恢复测试 ${commandId}`},
      {type: 'chain.action', matterId: commandId, action: {type: 'UNDERSTANDING_DRAFT', text: `理解 ${commandId}`}},
      {type: 'chain.action', matterId: commandId, action: {type: 'SAVE_UNDERSTANDING'}}] };
}

test('empty source, absent Agent: offline backup, divergent write, same-path restore, restart and receipt', {timeout: 30000}, async t => {
  const files = isolated(), selectedPort = await port(); let host = await started(files, selectedPort);
  t.after(async () => { await stopped(host); files.cleanup(); });
  const initial = await request(host, '/api/product/workspace'); assert.equal(initial.body.revision, 0);
  const created = await request(host, '/api/product/commands', createMatter('first-matter', 0));
  assert.equal(created.status, 200, JSON.stringify(created.body)); assert.equal(created.body.revision, 1);
  await stopped(host);
  assert.equal(fs.existsSync(files.agent), false);
  const saved = backup({web: files.web, agent: files.agent, out: files.bundle});
  assert.equal(saved.manifest.databases.agent.present, false); assert.equal(verify({bundle: files.bundle}).manifest.databases.agent.present, false);
  const cliVerify = spawnSync(process.execPath, [cli, 'verify', '--bundle', files.bundle], {cwd: runtimeRoot, encoding: 'utf8', windowsHide: true});
  assert.equal(cliVerify.status, 0, cliVerify.stderr);
  host = await started(files, selectedPort, {TRACE_AGENT_ENABLED: '1', TRACE_CODEX_BIN: path.join(files.dir, 'missing-codex')});
  const changed = await request(host, '/api/product/commands', createMatter('second-matter', 1));
  assert.equal(changed.status, 200, JSON.stringify(changed.body)); assert.equal(changed.body.revision, 2);
  await stopped(host); assert.equal(fs.existsSync(files.agent), true);
  const cliRestore = spawnSync(process.execPath, [cli, 'restore', '--bundle', files.bundle, '--web', files.web, '--agent', files.agent],
    {cwd: runtimeRoot, encoding: 'utf8', windowsHide: true});
  assert.equal(cliRestore.status, 0, cliRestore.stderr);
  const result = JSON.parse(cliRestore.stdout);
  assert.equal(result.agentPresent, false); assert.equal(fs.existsSync(files.agent), false);
  host = await started(files, selectedPort);
  const restored = await request(host, '/api/product/workspace');
  const receipt = await request(host, '/api/product/commands/first-matter');
  const gone = await request(host, '/api/product/commands/second-matter');
  assert.equal(restored.body.revision, 1); assert.equal(restored.body.host.chain.matters[0].understanding, '理解 first-matter');
  assert.equal(receipt.body.receipt.status, 'committed'); assert.equal(gone.status, 404);
});

test('missing, tampered and mismatched bundles cannot overwrite current databases', {timeout: 30000}, async t => {
  const files = isolated(), selectedPort = await port(); let host = await started(files, selectedPort);
  t.after(async () => { await stopped(host); files.cleanup(); });
  assert.equal((await request(host, '/api/product/commands', createMatter('keep-this', 0))).status, 200);
  await stopped(host);
  backup({web: files.web, agent: files.agent, out: files.bundle});
  const before = hash(files.web);
  assert.throws(() => restore({bundle: path.join(files.dir, 'missing'), web: files.web, agent: files.agent}));
  assert.throws(() => restore({bundle: files.bundle, web: path.join(files.dir, 'wrong.sqlite'), agent: files.agent}), /原路径/);
  fs.appendFileSync(path.join(files.bundle, 'web.sqlite'), 'tampered');
  assert.throws(() => verify({bundle: files.bundle}), /摘要不符/);
  assert.throws(() => restore({bundle: files.bundle, web: files.web, agent: files.agent}), /摘要不符/);
  assert.equal(hash(files.web), before); assert.equal(fs.existsSync(path.join(files.dir, 'wrong.sqlite')), false);
  host = await started(files, selectedPort);
  assert.equal((await request(host, '/api/product/workspace')).body.revision, 1);
});

test('live owner and wrong database fail closed without making a replacement', {timeout: 30000}, async t => {
  const files = isolated(), selectedPort = await port(); let host = await started(files, selectedPort);
  t.after(async () => { await stopped(host); files.cleanup(); });
  assert.throws(() => backup({web: files.web, agent: files.agent, out: files.bundle}), /占用/);
  assert.equal(fs.existsSync(files.bundle), false);
  await stopped(host);
  backup({web: files.web, agent: files.agent, out: files.bundle});
  const before = hash(files.web), release = acquireStateOwner(files.web);
  try { assert.throws(() => restore({bundle: files.bundle, web: files.web, agent: files.agent}), /占用/); }
  finally { release(); }
  assert.equal(hash(files.web), before);
  const invalid = path.join(files.dir, 'invalid.sqlite');
  const db = new DatabaseSync(invalid); db.exec('CREATE TABLE unrelated(value TEXT)'); db.close();
  assert.throws(() => backup({web: invalid, agent: files.agent, out: path.join(files.dir, 'invalid-pair')}), /身份不符/);
  assert.equal(fs.existsSync(path.join(files.dir, 'invalid-pair')), false);
});

test('missing Agent member and invalid Agent source do not restore or silently initialize', {timeout: 30000}, async t => {
  const files = isolated(), selectedPort = await port();
  let host = await started(files, selectedPort, {TRACE_AGENT_ENABLED: '1', TRACE_CODEX_BIN: path.join(files.dir, 'missing-codex')});
  t.after(async () => { await stopped(host); files.cleanup(); });
  assert.equal((await request(host, '/api/product/commands', createMatter('paired-matter', 0))).status, 200);
  await stopped(host);
  backup({web: files.web, agent: files.agent, out: files.bundle});
  const before = [hash(files.web), hash(files.agent)];
  fs.unlinkSync(path.join(files.bundle, 'agent.sqlite'));
  assert.throws(() => restore({bundle: files.bundle, web: files.web, agent: files.agent}));
  assert.deepEqual([hash(files.web), hash(files.agent)], before);
  const invalid = path.join(files.dir, 'invalid-agent.sqlite');
  const db = new DatabaseSync(invalid); db.exec('CREATE TABLE unrelated(value TEXT)'); db.close();
  fs.copyFileSync(invalid, files.agent);
  const wrongHash = hash(files.agent);
  assert.throws(() => backup({web: files.web, agent: files.agent, out: path.join(files.dir, 'wrong-agent-pair')}), /身份不符/);
  const failed = launch(files, selectedPort, {TRACE_AGENT_ENABLED: '1'});
  await once(failed.child, 'close');
  assert.notEqual(failed.child.exitCode, 0); assert.equal(hash(files.agent), wrongHash);
  assert.equal(fs.existsSync(`${files.web}.owner`), false); assert.equal(fs.existsSync(`${files.agent}.owner`), false);
});

test('corrupt Web source refuses startup without replacing bytes or keeping owner', {timeout: 30000}, async t => {
  const files = isolated(); t.after(files.cleanup);
  fs.writeFileSync(files.web, Buffer.from('not a SQLite database'));
  const before = hash(files.web), selectedPort = await port();
  const failed = launch(files, selectedPort);
  await once(failed.child, 'close');
  assert.notEqual(failed.child.exitCode, 0); assert.equal(hash(files.web), before);
  assert.equal(fs.existsSync(`${files.web}.owner`), false); assert.equal(fs.existsSync(files.agent), false);
});

test('standalone Agent host reserves its port before opening the existing Product store', {timeout: 30000}, async t => {
  const files = isolated(), selectedPort = await port();
  t.after(files.cleanup);
  const listener = net.createServer(); listener.listen(selectedPort, '127.0.0.1'); await once(listener, 'listening');
  try {
    const conflict = spawnSync(process.execPath, ['apps/agent/server.mjs'], {cwd: runtimeRoot, encoding: 'utf8', windowsHide: true, timeout: 5000,
      env: {...process.env, TRACE_AGENT_PORT: String(selectedPort), TRACE_WEB_STATE_FILE: files.web, TRACE_AGENT_ENABLED: '1', TRACE_AGENT_STATE_FILE: files.agent}});
    assert.notEqual(conflict.status, 0); assert.equal(fs.existsSync(files.web), false);
    assert.equal(fs.existsSync(`${files.web}.owner`), false); assert.equal(fs.existsSync(files.agent), false);
  } finally { await new Promise(resolve => listener.close(resolve)); }
});

test('port conflict and Agent init failure release resources; forced interruption can restart', {timeout: 30000}, async t => {
  const files = isolated(), selectedPort = await port();
  const listener = net.createServer(); listener.listen(selectedPort, '127.0.0.1'); await once(listener, 'listening');
  try {
    const conflict = spawnSync(process.execPath, [entry], {cwd: runtimeRoot, encoding: 'utf8', windowsHide: true, timeout: 5000,
      env: {...process.env, TRACE_DESKTOP_PORT: String(selectedPort), TRACE_WEB_STATE_FILE: files.web, TRACE_AGENT_ENABLED: '1', TRACE_AGENT_STATE_FILE: files.agent}});
    assert.notEqual(conflict.status, 0); assert.equal(fs.existsSync(files.web), false); assert.equal(fs.existsSync(files.agent), false);
  } finally { await new Promise(resolve => listener.close(resolve)); }
  const failed = launch(files, selectedPort, {TRACE_AGENT_ENABLED: '1', TRACE_AGENT_TIMEOUT_MS: '0'});
  await once(failed.child, 'close');
  assert.notEqual(failed.child.exitCode, 0); assert.equal(fs.existsSync(`${files.web}.owner`), false);
  assert.equal(fs.existsSync(`${files.agent}.owner`), false);
  let host = await started(files, selectedPort, {TRACE_AGENT_ENABLED: '1', TRACE_CODEX_BIN: path.join(files.dir, 'missing-codex')});
  t.after(async () => { await stopped(host); files.cleanup(); });
  const first = await request(host, '/api/product/commands', createMatter('survives-crash', 0)); assert.equal(first.status, 200);
  await stopped(host, 'SIGKILL');
  host = await started(files, selectedPort, {TRACE_AGENT_ENABLED: '1', TRACE_CODEX_BIN: path.join(files.dir, 'missing-codex')});
  assert.equal((await request(host, '/api/product/workspace')).body.revision, 1);
  await stopped(host);
  assert.equal(fs.existsSync(`${files.web}.owner`), false); assert.equal(fs.existsSync(`${files.agent}.owner`), false);
  const command = spawnSync(process.execPath, [cli, 'backup', '--web', files.web, '--agent', files.agent, '--out', files.bundle],
    {cwd: runtimeRoot, encoding: 'utf8', windowsHide: true});
  assert.equal(command.status, 0, command.stderr); assert.equal(verify({bundle: files.bundle}).manifest.databases.agent.present, true);
});
