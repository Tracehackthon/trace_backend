import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {createCodexAdapter, NATIVE_CODEX_MODE} from '../apps/agent/codex.mjs';
import {createCodexQualificationRecord, readCodexAppServerSchemaBundle, writeCodexQualificationRecord} from '../native/codex-compatibility.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(repoRoot, 'tests', 'fixtures', 'codex-app-server-0.155.0-alpha.2.6');
const bundle = readCodexAppServerSchemaBundle(fixtureRoot);
const schemaArgs = {clientRequest: bundle.clientRequest, serverRequest: bundle.serverRequest, serverNotification: bundle.serverNotification};
const projectCwd = repoRoot;
const version = process.versions.node;
const nodeHash = crypto.createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex');

function initialization() {
  return {userAgent: `Codex Desktop/${version} (Windows; x86_64)`, codexHome: path.join(os.tmpdir(), 'trace-codex-qualified-home'), platformFamily: 'windows', platformOs: 'windows'};
}

function probeEvidence() {
  return [
    {direction: 'request', method: 'initialize', params: {}, result: {}},
    {direction: 'notification', method: 'initialized', params: {}},
    {direction: 'request', method: 'account/read', params: {refreshToken: false}, result: {account: null}},
    {direction: 'request', method: 'thread/start', params: {cwd: projectCwd, ephemeral: true, approvalPolicy: 'never'}, result: {cwd: projectCwd, thread: {id: 'qualification-thread', ephemeral: true}}},
  ];
}

function fakeChild(project, calls) {
  return (_file, _args, options) => {
    assert.equal(options.cwd, project);
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.exitCode = null; child.signalCode = null;
    const send = value => queueMicrotask(() => { if (!child.signalCode) child.stdout.write(`${JSON.stringify(value)}\n`); });
    const finish = () => { if (child.signalCode === null) { child.exitCode = 0; queueMicrotask(() => child.emit('close')); } };
    child.kill = () => { if (child.signalCode !== null) return; child.signalCode = 'SIGTERM'; queueMicrotask(() => child.emit('close')); };
    child.stdin.on('finish', finish); child.stdin.setEncoding('utf8');
    let buffer = '';
    child.stdin.on('data', chunk => {
      buffer += chunk; let offset;
      while ((offset = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, offset); buffer = buffer.slice(offset + 1); if (!line.trim()) continue;
        const value = JSON.parse(line); calls.push(value);
        if (value.method === 'initialize') send({id: value.id, result: initialization()});
        else if (value.method === 'account/read') send({id: value.id, result: {account: null}});
      }
    });
    return child;
  };
}

test('native adapter.check accepts an unknown semver only through a local qualification record', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-codex-qualification-adapter-')); const recordPath = path.join(root, 'record.json'); const calls = [];
  t.after(() => fs.rmSync(root, {recursive: true, force: true, maxRetries: 3, retryDelay: 50}));
  const record = createCodexQualificationRecord({
    executableIdentity: {path: fs.realpathSync(process.execPath), sha256: nodeHash, size: fs.statSync(process.execPath).size, mtimeMs: Math.trunc(fs.statSync(process.execPath).mtimeMs)},
    versionOutput: `codex-cli ${version}`, initializeResult: initialization(), initializeParams: {capabilities: {experimentalApi: true}},
    schemaBundle: schemaArgs, probeCalls: probeEvidence(), expectedCwd: projectCwd,
  });
  record.schema.source = fixtureRoot; writeCodexQualificationRecord(recordPath, record);
  const adapter = createCodexAdapter({executable: process.execPath, mode: NATIVE_CODEX_MODE, projectCwd, env: {PATH: process.env.PATH, TRACE_CODEX_QUALIFICATION_RECORD: recordPath}, spawnProcess: fakeChild(projectCwd, calls), rpcTimeoutMs: 500});
  const result = await adapter.check({signal: new AbortController().signal});
  assert.equal(result.version, version);
  assert.equal(result.authenticated, false);
  assert.ok(calls.some(call => call.method === 'initialize'));
  assert.ok(calls.some(call => call.method === 'account/read'));
});
