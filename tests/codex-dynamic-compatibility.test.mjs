import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  CODEX_APP_SERVER_REQUIRED_SURFACE,
  canonicalJson,
  codexAppServerSchemaFingerprint,
  createCodexQualificationRecord,
  readCodexAppServerSchemaBundle,
  validateCodexAppServerInitialize,
  validateCodexAppServerProbe,
  validateCodexAppServerInstallation,
  validateCodexQualificationRecord,
  writeCodexQualificationRecord,
} from '../native/codex-compatibility.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(repoRoot, 'tests', 'fixtures', 'codex-app-server-0.155.0-alpha.2.6');
const bundle = readCodexAppServerSchemaBundle(fixtureRoot);
const schemaArgs = { clientRequest: bundle.clientRequest, serverRequest: bundle.serverRequest, serverNotification: bundle.serverNotification };
const projectCwd = repoRoot;

function calls() {
  const threadId = 'probe-thread'; const turnId = 'probe-turn';
  return [
    { direction: 'request', method: 'initialize', params: {}, result: {} },
    { direction: 'notification', method: 'initialized', params: {} },
    { direction: 'request', method: 'account/read', params: { refreshToken: false }, result: { account: null } },
    { direction: 'request', method: 'thread/start', params: { cwd: projectCwd, ephemeral: true, approvalPolicy: 'never' }, result: { cwd: projectCwd, thread: { id: threadId, ephemeral: true } } },
  ];
}

function init(version = '9.9.9') {
  return { userAgent: `Codex Desktop/${version} (Windows; x86_64)`, codexHome: path.join(os.tmpdir(), 'trace-codex-home'), platformFamily: 'windows', platformOs: 'windows' };
}

test('schema fingerprint is canonical and independent of object key order', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: true, x: null } }), canonicalJson({ a: { x: null, y: true }, z: 1 }));
  assert.equal(codexAppServerSchemaFingerprint(bundle), codexAppServerSchemaFingerprint({
    clientRequest: JSON.parse(JSON.stringify(bundle.clientRequest)), serverRequest: JSON.parse(JSON.stringify(bundle.serverRequest)), serverNotification: JSON.parse(JSON.stringify(bundle.serverNotification)),
  }));
});

test('unknown Codex version can qualify only with generated schema and no-model wire evidence', () => {
  const record = createCodexQualificationRecord({
    executableIdentity: { path: 'C:\\codex\\codex.exe', sha256: 'a'.repeat(64), size: 123, mtimeMs: 1 },
    versionOutput: 'codex-cli 9.9.9', initializeResult: init(), initializeParams: { capabilities: { experimentalApi: true } },
    schemaBundle: schemaArgs, probeCalls: calls(), expectedCwd: projectCwd,
  });
  assert.equal(record.cli_version, '9.9.9');
  assert.equal(record.schema.required_surface.client_methods.length, CODEX_APP_SERVER_REQUIRED_SURFACE.client_methods.length);
  assert.match(record.cache_key, /^[a-f0-9]{64}$/);
  assert.equal(validateCodexQualificationRecord(record, { schemaBundle: schemaArgs,
    executableIdentity: record.executable, initializeResult: init(), initializeParams: { capabilities: { experimentalApi: true } }, probeCalls: calls(), expectedCwd: projectCwd }).status, 'compatible');
});

test('qualification rejects a spoofed initialize identity and missing schema method', () => {
  assert.throws(() => validateCodexAppServerInitialize({ initializeResult: init('9.9.8'), initializeParams: { capabilities: { experimentalApi: true } }, cliVersion: '9.9.9' }), /does not match/);
  const broken = JSON.parse(JSON.stringify(schemaArgs));
  broken.clientRequest.oneOf = broken.clientRequest.oneOf.filter(variant => !variant?.properties?.method?.enum?.includes('thread/resume'));
  assert.throws(() => createCodexQualificationRecord({ executableIdentity: { path: 'C:\\codex.exe', sha256: 'b'.repeat(64), size: 1, mtimeMs: 1 }, versionOutput: 'codex-cli 9.9.9', initializeResult: init(), initializeParams: { capabilities: { experimentalApi: true } }, schemaBundle: broken, probeCalls: calls(), expectedCwd: projectCwd }), /missing required methods/);
});

test('qualification cache invalidates when binary or schema changes', () => {
  const record = createCodexQualificationRecord({ executableIdentity: { path: 'C:\\codex.exe', sha256: 'c'.repeat(64), size: 1, mtimeMs: 1 }, versionOutput: 'codex-cli 9.9.9', initializeResult: init(), initializeParams: { capabilities: { experimentalApi: true } }, schemaBundle: schemaArgs, probeCalls: calls(), expectedCwd: projectCwd });
  assert.throws(() => validateCodexQualificationRecord(record, { schemaBundle: schemaArgs, executableIdentity: { ...record.executable, sha256: 'd'.repeat(64) } }), /executable identity is stale/);
  const changed = JSON.parse(JSON.stringify(schemaArgs)); changed.serverNotification.description = `${changed.serverNotification.description ?? ''} changed`;
  assert.throws(() => validateCodexQualificationRecord(record, { schemaBundle: changed }), /schema fingerprint is stale/);
});

test('qualification records are persisted as local replay evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-qualification-test-')); const file = path.join(root, 'record.json');
  try {
    const record = createCodexQualificationRecord({ executableIdentity: { path: 'C:\\codex.exe', sha256: 'e'.repeat(64), size: 1, mtimeMs: 1 }, versionOutput: 'codex-cli 9.9.9', initializeResult: init(), initializeParams: { capabilities: { experimentalApi: true } }, schemaBundle: schemaArgs, probeCalls: calls(), expectedCwd: projectCwd });
    writeCodexQualificationRecord(file, record);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).cache_key, record.cache_key);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('native startup consumer re-checks executable and protocol without semver or project allowlisting', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-install-qualification-test-')); const file = path.join(root, 'record.json');
  const otherProject = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-other-project-'));
  try {
    const version = process.versions.node; const realHash = hashFile(process.execPath);
    const record = createCodexQualificationRecord({ executableIdentity: { path: fs.realpathSync(process.execPath), sha256: realHash, size: fs.statSync(process.execPath).size, mtimeMs: Math.trunc(fs.statSync(process.execPath).mtimeMs) }, versionOutput: `codex-cli ${version}`, initializeResult: init(version), initializeParams: { capabilities: { experimentalApi: true } }, schemaBundle: schemaArgs, probeCalls: calls(), expectedCwd: projectCwd });
    record.schema.source = fixtureRoot; writeCodexQualificationRecord(file, record);
    const runtimeInit = { ...init(version), userAgent: `${init(version).userAgent} dumb (trace_agent; 0.1.0)` };
    const result = validateCodexAppServerInstallation({ initializeResult: runtimeInit, initializeParams: { capabilities: { experimentalApi: true } }, executable: process.execPath, env: process.env, qualificationRecordPath: file, expectedCwd: otherProject });
    assert.equal(result.status, 'compatible');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(otherProject, { recursive: true, force: true }); }
});

function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
