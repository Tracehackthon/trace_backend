import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAgentPanelController,
  createDurableEventStream,
  createWorksiteAgentPayload,
  diagnosticValue,
  interactionResponse,
  sanitizeInteraction,
} from '../src/product/agent-panel.mjs';

test('diagnostic values redact full ids and local paths', () => {
  assert.equal(diagnosticValue('D:\\Users\\Ho\\trace-runtime\\web.sqlite', 'path'), '本机路径已隐藏');
  assert.equal(diagnosticValue('matter-e12df734-e02f-46f6-b532-87855a38e0ba').includes('e12df734-e02f-46f6-b532-87855a38e0ba'), false);
  assert.match(diagnosticValue('matter-e12df734-e02f-46f6-b532-87855a38e0ba'), /…/);
});

test('worksite payload carries complete bounded identity/context without changing generic panels', () => {
  const base = {protocolVersion: 1, requestId: 'f8-ui-request', matterId: 'matter-ui', purpose: 'discuss'};
  assert.equal(Object.hasOwn(createWorksiteAgentPayload(base), 'workId'), false);
  const payload = createWorksiteAgentPayload(base, {
    workId: 'work-ui', role: 'trial', project: 'fixture-project', projectIdentity: 'fixture-project',
    intake: [{id: 'intake-ui', matterId: 'matter-ui', title: '带入', sourceText: '现场', sourceVersion: 2, role: 'trial', note: '本次'}],
    findings: [{id: 'finding-ui', text: '发现', useInCurrentWork: true}],
  });
  assert.deepEqual(payload.workId, 'work-ui');
  assert.equal(payload.matterId, 'matter-ui');
  assert.equal(payload.role, 'trial');
  assert.equal(payload.projectIdentity, 'fixture-project');
  assert.equal(payload.intake[0].sourceText, '现场');
  assert.equal(payload.findings[0].text, '发现');
});

class FakeEventSource {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  close() { this.closed = true; }
  open() { this.listeners.get('open')?.forEach(listener => listener({type: 'open'})); }
  emit(type, data, lastEventId) {
    const event = {type, data: JSON.stringify(data), lastEventId: String(lastEventId ?? '')};
    this.listeners.get(type)?.forEach(listener => listener(event));
  }
  fail() { this.onerror?.({type: 'error'}); }
}

test('approval/input cards have a redacted, display-only projection', () => {
  const value = sanitizeInteraction({
    interactionId: 'interaction-1', revision: 7, kind: 'approval',
    reason: 'Run with token=super-secret in C:\\Users\\Alice\\project\\.env',
    commandActions: [{name: 'write', path: 'C:\\Users\\Alice\\project\\secret.txt', command: 'curl -H "Authorization: Bearer secret"'}],
    questions: [{id: 'secret', header: 'API key', question: 'Paste the key', isSecret: true}],
  });
  assert.equal(value.interactionId, 'interaction-1');
  assert.equal(value.revision, 7);
  assert.match(value.reason, /已隐藏/);
  assert.doesNotMatch(JSON.stringify(value), /super-secret|Alice|Bearer secret/);
  assert.equal(value.questions[0].isSecret, true);
});

test('interaction response always binds run interaction CAS and idempotency', () => {
  assert.deepEqual(interactionResponse({
    runId: 'run-1', kind: 'approval', interactionId: 'interaction-1', expectedRevision: 8,
    decision: 'accept', idempotencyKey: 'idempotent-1',
  }), {
    path: '/api/agent/runs/run-1/approval',
    body: {interactionId: 'interaction-1', expectedRevision: 8, idempotencyKey: 'idempotent-1', decision: 'accept'},
  });
  assert.deepEqual(interactionResponse({
    runId: 'run-1', kind: 'input', interactionId: 'interaction-2', expectedRevision: 9,
    answers: {goal: {answers: ['Trace']}}, idempotencyKey: 'idempotent-2',
  }), {
    path: '/api/agent/runs/run-1/input',
    body: {interactionId: 'interaction-2', expectedRevision: 9, idempotencyKey: 'idempotent-2', answers: {goal: {answers: ['Trace']}}},
  });
});

test('durable SSE replays from the latest cursor and reports reconnect without auto-approving', () => {
  FakeEventSource.instances.length = 0;
  const seen = [], statuses = [];
  const stream = createDurableEventStream({
    runId: 'run-1', EventSourceImpl: FakeEventSource,
    onEvent: event => seen.push(event), onStatus: status => statuses.push(status),
  });
  const first = FakeEventSource.instances[0];
  assert.match(first.url, /\/api\/agent\/runs\/run-1\/events\?after=0$/);
  first.open();
  first.emit('runtime.approval.required', {sequence: 3, type: 'runtime.approval.required', data: {
    interaction: {interactionId: 'i-1', revision: 3, kind: 'approval', state: 'waiting', recoverable: true},
  }}, 3);
  first.fail();
  assert.equal(stream.cursor, 3);
  assert.deepEqual(seen[0].data.interaction, {interactionId: 'i-1', revision: 3, kind: 'approval', state: 'waiting', recoverable: true});
  assert.ok(statuses.includes('reconnecting'));
  stream.reconnect();
  const second = FakeEventSource.instances[1];
  assert.match(second.url, /\/api\/agent\/runs\/run-1\/events\?after=3$/);
  assert.equal(first.closed, true);
  stream.close();
});

test('controller renders a fake native approval/input event into scoped CAS POSTs', async () => {
  FakeEventSource.instances.length = 0;
  const calls = [];
  const controller = createAgentPanelController({
    identity: {matterId: 'matter-native', workId: 'work-native', project: 'fixture-project'},
    EventSourceImpl: FakeEventSource,
    request: async (path, body) => {
      calls.push({path, body});
      if (path === '/api/agent/runs') return {run: {runId: 'native-run', matterId: 'matter-native', status: 'running', lastEventId: 1, runtime: {}}};
      return {run: controller.getState().run};
    },
  });
  await controller.start({protocolVersion: 1, requestId: 'native-request', expectedRevision: 2, matterId: 'matter-native', contextMode: 'resume', contextEpoch: 1, purpose: 'discuss', input: 'fixture', profileId: 'fixture'}, {identity: {matterId: 'matter-native', workId: 'work-native', project: 'fixture-project'}});
  const source = FakeEventSource.instances.at(-1);
  source.emit('runtime.approval.required', {sequence: 3, type: 'runtime.approval.required', data: {interaction: {interactionId: 'native-i', revision: 3, kind: 'approval', state: 'waiting', recoverable: true, reason: 'fixture approval'}}}, 3);
  await controller.respond('approval', interactionResponse({runId: 'native-run', kind: 'approval', interactionId: 'native-i', expectedRevision: 3, decision: 'decline', idempotencyKey: 'native-i-1'}).body);
  assert.deepEqual(calls.at(-1), {path: '/api/agent/runs/native-run/approval', body: {interactionId: 'native-i', expectedRevision: 3, idempotencyKey: 'native-i-1', decision: 'decline'}});
  source.emit('runtime.interaction.resolved', {sequence: 4, type: 'runtime.interaction.resolved', data: {interactionId: 'native-i', state: 'resolved'}}, 4);
  assert.equal(controller.getState().interaction.state, 'resolved');
  source.emit('runtime.approval.required', {sequence: 5, type: 'runtime.approval.required', data: {interaction: {interactionId: 'native-i-2', revision: 5, kind: 'approval', state: 'waiting', recoverable: true}}}, 5);
  source.emit('run.timed_out', {sequence: 6, type: 'run.timed_out', data: {status: 'timed_out'}}, 6);
  assert.equal(controller.getState().interaction.state, 'expired');
  assert.equal(controller.getState().interaction.recoverable, false);
  controller.close();
});

test('resume is explicit and preserves the bound matter/work/project identity', async () => {
  const calls = [];
  const controller = createAgentPanelController({
    identity: {matterId: 'matter-1', workId: 'work-1', project: 'trace-runtime'},
    EventSourceImpl: FakeEventSource,
    request: async (path, body) => {
      calls.push({path, body});
      if (path === '/api/agent/runs') return {run: {
        runId: body.previousRunId ? 'run-2' : 'run-1', matterId: 'matter-1', status: 'succeeded',
        contextMode: 'resume', contextEpoch: 4, baseRevision: 12, lastEventId: 4,
        runtime: {threadId: 'thread-1'}, result: {kind: 'answer', answer: 'fixture', adoption: 'not_applied'},
      }};
      return {run: controller.getState().run};
    },
  });
  await controller.start({protocolVersion: 1, requestId: 'request-1', expectedRevision: 12, matterId: 'matter-1',
    contextMode: 'resume', contextEpoch: 4, purpose: 'discuss', input: 'fixture native run', profileId: 'fixture'},
    {identity: {matterId: 'matter-1', workId: 'work-1', project: 'trace-runtime'}});
  const state = controller.getState();
  assert.equal(state.resumeAvailable, true);
  assert.equal(state.resumeSource, null, 'a resumable run must not start a new turn automatically');
  controller.prepareResume();
  assert.equal(controller.getState().resumeSource.runId, 'run-1');
  await controller.start({protocolVersion: 1, requestId: 'request-2', expectedRevision: 12, matterId: 'matter-1',
    contextMode: 'resume', contextEpoch: 4, purpose: 'discuss', input: '继续 fixture', profileId: 'fixture',
    threadId: 'thread-1', previousRunId: 'run-1'},
    {identity: {matterId: 'matter-1', workId: 'work-1', project: 'trace-runtime'}, previousRunId: 'run-1', threadId: 'thread-1'});
  assert.equal(calls.at(-1).body.threadId, 'thread-1');
  assert.equal(calls.at(-1).body.previousRunId, 'run-1');
  assert.equal(calls.at(-1).body.matterId, 'matter-1');
  assert.equal(calls.at(-1).body.workId, undefined, 'work identity is UI-bound, never smuggled as an unsupported API field');
  controller.prepareResume();
  await assert.rejects(() => controller.resume({matterId: 'another-matter'}), /身份|identity/i);
});

test('terminal SSE refreshes the authoritative runtime thread before exposing resume', async () => {
  FakeEventSource.instances.length = 0;
  let current;
  const controller = createAgentPanelController({
    identity: {matterId: 'matter-refresh', workId: 'work-refresh', project: 'fixture-project'}, EventSourceImpl: FakeEventSource,
    request: async (path, body) => {
      if (path === '/api/agent/runs') { current = {runId: 'refresh-run', matterId: 'matter-refresh', status: 'running', lastEventId: 1, runtime: {}}; return {run: current}; }
      if (path === '/api/agent/runs/refresh-run') return {run: {...current, status: 'succeeded', runtime: {threadId: 'refresh-thread'}, result: {kind: 'answer', answer: 'fixture', replacement: null, citations: [], uncertainties: []}}};
      return {run: current};
    },
  });
  await controller.start({protocolVersion: 1, requestId: 'refresh-request', expectedRevision: 2, matterId: 'matter-refresh', contextMode: 'resume', contextEpoch: 1, purpose: 'discuss', input: 'fixture', profileId: 'fixture'}, {identity: {matterId: 'matter-refresh', workId: 'work-refresh', project: 'fixture-project'}});
  FakeEventSource.instances.at(-1).emit('run.succeeded', {sequence: 3, type: 'run.succeeded', data: {status: 'succeeded', result: {kind: 'answer', answer: 'fixture'}}}, 3);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(controller.getState().run.runtime.threadId, 'refresh-thread');
  assert.equal(controller.getState().resumeAvailable, true);
  controller.close();
});
