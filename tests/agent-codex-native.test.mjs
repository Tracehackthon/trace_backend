import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { createCodexAdapter, NATIVE_CODEX_MODE } from '../apps/agent/codex.mjs';

const context = { protocolVersion: 1, contextHash: 'native-fixture', contextMode: 'fresh', contextEpoch: 1,
  fragments: [{ id: 'selection', role: 'explicit_selection', text: 'native project evidence', revision: 1 }] };
const request = (extra = {}) => ({ purpose: 'discuss', input: '读取项目并返回结构化结果。', ...extra });

function nativeChildFactory({ project, mode = 'complete', calls, userAgent = 'codex_cli_rs/0.155.0-alpha.2.6 (fixture)' }) {
  return (file, args, options) => {
    assert.equal(options.cwd, project);
    assert.equal(options.shell, false);
    assert.deepEqual(args.slice(0, 2), ['app-server', '--stdio']);
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.exitCode = null; child.signalCode = null;
    const send = value => queueMicrotask(() => { if (!child.signalCode) child.stdout.write(`${JSON.stringify(value)}\n`); });
    const finish = () => { if (!child.signalCode) { child.exitCode = 0; queueMicrotask(() => child.emit('close')); } };
    child.kill = () => { if (child.signalCode) return; child.signalCode = 'SIGTERM'; queueMicrotask(() => child.emit('close')); };
    child.stdin.on('finish', finish);
    child.stdin.setEncoding('utf8');
    let buffer = '';
    child.stdin.on('data', chunk => {
      buffer += chunk;
      let offset;
      while ((offset = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, offset); buffer = buffer.slice(offset + 1);
        if (!line.trim()) continue;
        const value = JSON.parse(line); calls.push(value);
        if (value.method === 'initialize') send({ id: value.id, result: { userAgent } });
        else if (value.method === 'account/read') send({ id: value.id, result: { account: null } });
        else if (value.method === 'thread/start') {
          send({ id: value.id, result: { cwd: project, model: 'fixture', thread: { id: 'native-thread', cwd: project, ephemeral: false } } });
        } else if (value.method === 'thread/resume') {
          send({ id: value.id, result: { cwd: project, model: 'fixture', thread: { id: value.params.threadId, cwd: project, ephemeral: false } } });
        } else if (value.method === 'turn/start') {
          const turnId = 'native-turn';
          send({ id: value.id, result: { turn: { id: turnId, status: 'inProgress' } } });
          send({ method: 'turn/started', params: { threadId: value.params.threadId, turn: { id: turnId } } });
          if (mode === 'approval') {
            send({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: {
              threadId: value.params.threadId, turnId, itemId: 'command-item', reason: 'fixture approval', cwd: project,
              commandActions: [{ type: 'read', name: 'cat', path: path.join(project, 'src', 'index.js'), command: 'cat index.js' }],
              additionalPermissions: { fileSystem: { entries: [{ access: 'write', path: { type: 'path', path: path.join(project, 'tmp') } }] }, network: { enabled: true } },
              networkApprovalContext: { host: 'api.example.com' } } });
          } else if (mode === 'permission') {
            send({ id: 'approval-1', method: 'item/permissions/requestApproval', params: {
              threadId: value.params.threadId, turnId, itemId: 'permission-item', reason: 'fixture permission',
              permissions: { fileSystem: { entries: [{ access: 'write', path: { type: 'path', path: path.join(project, 'tmp') } }] }, network: { enabled: true } } } });
          } else if (mode === 'cancel') {
            // Hold the turn until the adapter sends turn/interrupt.
          } else {
            const raw = JSON.stringify({ answer: 'native fixture result', replacement: null, citations: [], uncertainties: [] });
            send({ method: 'item/agentMessage/delta', params: { threadId: value.params.threadId, turnId, itemId: 'message-item', delta: raw } });
            send({ method: 'item/started', params: { threadId: value.params.threadId, turnId, item: { id: 'message-item', type: 'agentMessage' } } });
            send({ method: 'item/completed', params: { threadId: value.params.threadId, turnId, item: { id: 'message-item', type: 'agentMessage', text: raw } } });
            send({ method: 'turn/completed', params: { threadId: value.params.threadId, turn: { id: turnId, status: 'completed' } } });
          }
        } else if (value.id === 'approval-1' && value.result) {
          const raw = JSON.stringify({ answer: 'native fixture result after approval', replacement: null, citations: [], uncertainties: [] });
          send({ method: 'item/agentMessage/delta', params: { threadId: 'native-thread', turnId: 'native-turn', itemId: 'message-item', delta: raw } });
          send({ method: 'item/completed', params: { threadId: 'native-thread', turnId: 'native-turn', item: { id: 'message-item', type: 'agentMessage', text: raw } } });
          send({ method: 'turn/completed', params: { threadId: 'native-thread', turn: { id: 'native-turn', status: 'completed' } } });
        } else if (value.method === 'turn/interrupt') {
          send({ id: value.id, result: {} });
          send({ method: 'turn/completed', params: { threadId: value.params.threadId, turn: { id: value.params.turnId, status: 'interrupted' } } });
        }
      }
    });
    return child;
  };
}

function adapterFor(project, mode, calls, events, userAgent) {
  return createCodexAdapter({ mode: NATIVE_CODEX_MODE, projectCwd: project, env: { PATH: process.env.PATH },
    spawnProcess: nativeChildFactory({ project, mode, calls, userAgent }), rpcTimeoutMs: 500, runtimeRoot: path.join(project, '.trace-test-runtime') });
}

test('native Codex uses the selected project cwd, keeps persistent threads, and resumes explicitly', async t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-native-codex-'));
  fs.writeFileSync(path.join(project, 'AGENTS.md'), 'native project instruction');
  t.after(() => fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const calls = [], events = [];
  const adapter = adapterFor(project, 'complete', calls, events);
  const run = extra => adapter.execute({ request: request(extra), context, signal: new AbortController().signal,
    isCurrent: () => true, onEvent: (type, data) => events.push({ type, data }) });
  const first = await run();
  assert.equal(first.threadId, 'native-thread');
  assert.equal(calls.find(x => x.method === 'thread/start').params.cwd, project);
  assert.equal(calls.find(x => x.method === 'thread/start').params.ephemeral, undefined);
  assert.equal(calls.find(x => x.method === 'thread/start').params.approvalPolicy, 'on-request');
  assert.equal(calls.find(x => x.method === 'thread/start').params.config, undefined);
  assert.equal(fs.existsSync(path.join(project, '.git')), false, 'native mode must not create a fake .git');

  calls.length = 0;
  const second = await run({ threadId: first.threadId });
  assert.equal(second.threadId, first.threadId);
  assert.equal(calls.some(x => x.method === 'thread/resume' && x.params.threadId === first.threadId), true);
  assert.equal(calls.some(x => x.method === 'thread/start'), false);
  assert.ok(events.some(e => e.type === 'runtime.item' && e.data.itemId === 'message-item' && e.data.threadId === first.threadId));
});

test('native Codex approval requests stay pending until an explicit, scoped response', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-native-approval-'));
  const calls = [], events = [];
  try {
    const adapter = adapterFor(project, 'approval', calls, events);
    const pending = adapter.execute({ runId: 'run-approval', profile: { profileId: 'fixture' }, request: request(), context,
      signal: new AbortController().signal, isCurrent: () => true, onEvent: (type, data) => events.push({ type, data }) });
    for (let i = 0; i < 100 && !events.some(e => e.type === 'runtime.approval.required'); i++) await delay(5);
    const required = events.find(e => e.type === 'runtime.approval.required');
    assert.ok(required?.data?.interaction?.interactionId);
    assert.equal(required.data.interaction.commandActions[0].path, 'src/index.js');
    assert.equal(required.data.interaction.permissions.fileSystem.entries[0].path, 'tmp');
    assert.deepEqual(required.data.interaction.network, { host: 'api.example.com' });
    assert.equal(calls.some(x => x.id === 'approval-1' && x.result), false);
    const interaction = required.data.interaction;
    const response = adapter.respondInteraction('run-approval', interaction.interactionId, {
      interactionId: interaction.interactionId, expectedRevision: 1, idempotencyKey: 'fixture-approval-1', decision: 'accept' });
    assert.equal(response.interaction.state, 'resolved');
    const output = await pending;
    assert.equal(output.raw.includes('after approval'), true);
    assert.equal(calls.find(x => x.id === 'approval-1').result.decision, 'accept');
    assert.ok(events.some(e => e.type === 'runtime.interaction.resolved' && e.data.state === 'resolved'));
  } finally { fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('permission approval defaults to the requested turn scope when UI omits a raw permissions payload', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-native-permission-'));
  const calls = [], events = [];
  try {
    const adapter = adapterFor(project, 'permission', calls, events);
    const pending = adapter.execute({ runId: 'run-permission', profile: { profileId: 'fixture' }, request: request(), context,
      signal: new AbortController().signal, isCurrent: () => true, onEvent: (type, data) => events.push({ type, data }) });
    for (let i = 0; i < 100 && !events.some(e => e.type === 'runtime.approval.required'); i++) await delay(5);
    const required = events.find(e => e.type === 'runtime.approval.required'), interaction = required.data.interaction;
    const result = adapter.respondInteraction('run-permission', interaction.interactionId, {
      interactionId: interaction.interactionId, expectedRevision: 1, idempotencyKey: 'permission-1', decision: 'accept' });
    assert.equal(result.interaction.state, 'resolved');
    await pending;
    const wire = calls.find(x => x.id === 'approval-1');
    assert.deepEqual(wire.result, { permissions: { fileSystem: { entries: [{ access: 'write', path: { type: 'path', path: path.join(project, 'tmp') } }] }, network: { enabled: true } }, scope: 'turn' });
  } finally { fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('native Codex cancellation sends turn/interrupt before terminating the owned process', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-native-cancel-'));
  const calls = [];
  try {
    const adapter = adapterFor(project, 'cancel', calls, []);
    const controller = new AbortController();
    const pending = adapter.execute({ request: request(), context, signal: controller.signal,
      isCurrent: () => true, onEvent: () => {} });
    for (let i = 0; i < 100 && !calls.some(x => x.method === 'turn/start'); i++) await delay(5);
    assert.ok(calls.some(x => x.method === 'turn/start'));
    controller.abort();
    await assert.rejects(pending, error => error.code === 'CANCELLED');
    assert.ok(calls.some(x => x.method === 'turn/interrupt' && x.params.threadId === 'native-thread' && x.params.turnId === 'native-turn'));
  } finally { fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('native Codex rejects an unknown app-server protocol before account or thread work', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-native-unknown-'));
  const calls = [];
  try {
    const adapter = adapterFor(project, 'complete', calls, [], 'codex_cli_rs/9.99.0 (fixture)');
    await assert.rejects(adapter.check({ signal: new AbortController().signal }), error => error.code === 'CODEX_VERSION_UNVERIFIED');
    assert.equal(calls.filter(x => x.method === 'account/read').length, 0);
    assert.equal(calls.filter(x => x.method === 'thread/start').length, 0);
  } finally { fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});
