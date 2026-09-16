import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {Client} from '../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import {buildCodexHookOutput} from '../dist/apps/codex/src/index.js';
import {TraceRuntime} from '../dist/packages/core/runtime/src/index.js';
import {createProductWorkspace} from '../packages/product/workspace/src/workspace.mjs';
import {DEFAULT_TRACE_HOOK_EVENTS} from '../dist/packages/host/codex-hooks/src/index.js';

const mcpEntry = path.resolve('dist/apps/mcp/src/main.js');

const cleanups = new WeakMap();

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-host-session-test-'));
  const file = path.join(directory, 'web.sqlite');
  cleanups.set(t, []);
  t.after(async () => {
    for (const close of cleanups.get(t)) await close();
    const absolute = path.resolve(directory);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
    assert.ok(path.basename(absolute).startsWith('trace-host-session-test-'));
    fs.rmSync(absolute, {recursive: true, force: true});
  });
  return file;
}

function event(sessionId, turnId, hookEventName, extra = {}) {
  return {host: 'codex', session_id: sessionId, ...(turnId === undefined ? {} : {turn_id: turnId}), hook_event_name: hookEventName, ...extra};
}

function attach(store, sessionId, commandId = `attach-${sessionId}`) {
  return store.hostSessions.attach({host: 'codex', sessionId, commandId, projectRef: 'D:\\workspace\\demo'});
}

async function serve(t, file) {
  const store = createProductWorkspace({file});
  const server = http.createServer(async (request, response) => {
    if (!await store.handle(request, response)) { response.writeHead(404); response.end('outside store'); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise(resolve => server.close(resolve));
    store.close();
  };
  cleanups.get(t).push(close);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (pathname, {method = 'GET', body, headers = {}} = {}) => {
    const response = await fetch(origin + pathname, {
      method,
      headers: {
        ...(['POST', 'PUT'].includes(method) ? {origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin'} : {}),
        ...headers,
      },
      ...(body === undefined ? {} : {body: typeof body === 'string' ? body : JSON.stringify(body)}),
    });
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch { /* keep raw response for diagnostics */ }
    return {response, status: response.status, text, json};
  };
  return {store, request, close};
}

test('default Codex hooks include lifecycle boundaries without changing existing event order', () => {
  assert.deepEqual([...DEFAULT_TRACE_HOOK_EVENTS], [
    'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd',
  ]);
});

test('unattached host events are ignored and do not persist prompt or advance Product Workspace revision', t => {
  const file = temporary(t);
  const store = createProductWorkspace({file});
  const prompt = store.hostSessions.ingestEvent(event('session-unattached', 'turn-1', 'UserPromptSubmit', {prompt: '不要把这段保存到任何 Trace 数据库'}));
  assert.equal(prompt.status, 'ignored');
  assert.equal(prompt.reason, 'not_attached');
  assert.equal(store.read().revision, 0);
  assert.deepEqual(store.hostSessions.listSessions(), []);
  store.close();

  const db = new DatabaseSync(file, {readOnly: true});
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM host_ingest_events').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM host_turns').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM host_sessions').get().n, 0);
  } finally { db.close(); }
});

test('explicit attach captures a turn, replays the same event exactly, and rejects same-key content conflicts', t => {
  const file = temporary(t);
  const store = createProductWorkspace({file});
  const attached = attach(store, 'session-capture');
  assert.equal(attached.status, 'attached');
  assert.equal(attached.session.capture_policy, 'explicit');
  assert.equal(attached.session.project_ref, 'D:\\workspace\\demo');
  assert.equal(store.read().revision, 0);

  const promptInput = event('session-capture', 'turn-1', 'UserPromptSubmit', {prompt: '第一行\n第二行\t带制表符'});
  const first = store.hostSessions.ingestEvent(promptInput);
  assert.equal(first.status, 'captured');
  assert.deepEqual(first.captured_fields, ['prompt']);
  const toolInput = event('session-capture', 'turn-1', 'PreToolUse', {tool_use_id: 'tool-1', tool_input: {command: 'SENSITIVE_TOOL_BODY'} });
  assert.equal(store.hostSessions.ingestEvent(toolInput).status, 'captured');
  assert.throws(() => store.hostSessions.ingestEvent({...toolInput, tool_input: {command: 'CHANGED_TOOL_BODY'}}), error => error.code === 'HOST_EVENT_CONFLICT');
  const toolOutput = store.hostSessions.ingestEvent(event('session-capture', 'turn-1', 'PostToolUse', {tool_use_id: 'tool-1', tool_response: {output: 'SENSITIVE_TOOL_OUTPUT'}}));
  assert.equal(toolOutput.status, 'captured');
  assert.equal(JSON.stringify(store.hostSessions.listTurns({host: 'codex', session_id: 'session-capture'}).at(0).prompt).includes('SENSITIVE_TOOL_BODY'), false);
  const replay = store.hostSessions.ingestEvent({...promptInput, prompt: '第一行\n第二行\t带制表符'});
  assert.equal(JSON.stringify(replay), JSON.stringify(first));
  assert.throws(() => store.hostSessions.ingestEvent(event('session-capture', 'turn-missing-prompt', 'UserPromptSubmit')), error => error.code === 'INVALID_HOST_EVENT');

  const stopInput = event('session-capture', 'turn-1', 'Stop', {last_assistant_message: '完成\n但不含 transcript_path'});
  const stopped = store.hostSessions.ingestEvent(stopInput);
  assert.equal(stopped.status, 'captured');
  assert.deepEqual(stopped.captured_fields, ['last_assistant_message']);
  assert.equal(stopped.turn.state, 'completed');
  assert.equal(stopped.turn.last_assistant_message, '完成\n但不含 transcript_path');
  assert.equal(JSON.stringify(store.hostSessions.ingestEvent(stopInput)), JSON.stringify(stopped));

  assert.throws(() => store.hostSessions.ingestEvent({...promptInput, prompt: '同一个键不能换正文'}), error => error.code === 'HOST_EVENT_CONFLICT' && error.status === 409);
  const turns = store.hostSessions.listTurns({host: 'codex', session_id: 'session-capture'});
  assert.equal(turns.length, 1);
  assert.equal(turns[0].prompt, '第一行\n第二行\t带制表符');
  assert.equal(turns[0].state, 'completed');
  assert.equal(store.read().revision, 0);

  const db = new DatabaseSync(file, {readOnly: true});
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM host_ingest_events').get().n, 4);
    const eventJson = db.prepare("SELECT event_json FROM host_ingest_events WHERE event_kind='PreToolUse'").get().event_json;
    assert.equal(eventJson.includes('SENSITIVE_TOOL_BODY'), false);
  }
  finally { db.close(); }
  store.close();
});

test('Codex adapter persists attached prompt in web.sqlite without echoing it or copying it to project trace.sqlite', t => {
  const file = temporary(t);
  const traceFile = path.join(path.dirname(file), 'trace.sqlite');
  const store = createProductWorkspace({file});
  attach(store, 'adapter-session');
  const runtime = new TraceRuntime({sqliteStateFile: traceFile});
  const marker = 'ADAPTER_PROMPT_MUST_STAY_IN_WEB_ONLY';
  const output = buildCodexHookOutput(event('adapter-session', 'adapter-turn', 'UserPromptSubmit', {prompt: marker}), runtime, {}, store.hostSessions);
  assert.equal(JSON.stringify(output).includes(marker), false);
  assert.equal(store.hostSessions.listTurns({session_id: 'adapter-session'})[0].prompt, marker);
  runtime.close();
  store.close();
  assert.equal(fs.readFileSync(traceFile).includes(marker), false);
});

test('pause, out-of-order lifecycle events, interrupt, SessionEnd and detach are fail-closed and deterministic', t => {
  const file = temporary(t);
  const store = createProductWorkspace({file});
  attach(store, 'session-state');

  assert.throws(() => store.hostSessions.ingestEvent(event('session-state', 'turn-missing', 'Stop', {last_assistant_message: '不能先 Stop'})), error => error.code === 'HOST_EVENT_OUT_OF_ORDER');
  assert.deepEqual(store.hostSessions.listTurns({session_id: 'session-state'}), []);

  const pause = store.hostSessions.pause({host: 'codex', sessionId: 'session-state', commandId: 'pause-1'});
  assert.equal(pause.status, 'paused');
  const ignored = store.hostSessions.ingestEvent(event('session-state', 'turn-paused', 'UserPromptSubmit', {prompt: 'paused prompt'}));
  assert.equal(ignored.status, 'ignored');
  assert.equal(ignored.reason, 'paused');
  assert.deepEqual(store.hostSessions.listTurns({session_id: 'session-state'}), []);

  const reattached = store.hostSessions.attach({host: 'codex', sessionId: 'session-state', commandId: 'attach-2'});
  assert.equal(reattached.status, 'attached');
  store.hostSessions.ingestEvent(event('session-state', 'turn-interrupt', 'UserPromptSubmit', {prompt: '需要中断'}));
  const interrupted = store.hostSessions.ingestEvent(event('session-state', 'turn-interrupt', 'Interrupt'));
  assert.equal(interrupted.turn.state, 'interrupted');
  assert.equal(interrupted.session_status, 'attached');
  assert.equal(JSON.stringify(store.hostSessions.ingestEvent(event('session-state', 'turn-interrupt', 'Interrupt'))), JSON.stringify(interrupted));
  assert.throws(() => store.hostSessions.ingestEvent(event('session-state', 'turn-interrupt', 'Stop', {last_assistant_message: '不能在 Interrupt 后 Stop'})), error => error.code === 'HOST_EVENT_OUT_OF_ORDER');

  store.hostSessions.ingestEvent(event('session-state', 'turn-end', 'UserPromptSubmit', {prompt: 'SessionEnd 应封口'}));
  const endedByEvent = store.hostSessions.ingestEvent(event('session-state', undefined, 'SessionEnd'));
  assert.equal(endedByEvent.session_status, 'ended');
  assert.equal(endedByEvent.reason, 'session_ended');
  assert.equal(store.hostSessions.getSession({sessionId: 'session-state'}).status, 'ended');
  assert.equal(store.hostSessions.listTurns({session_id: 'session-state'}).find(row => row.turn_id === 'turn-end').state, 'interrupted');
  assert.equal(JSON.stringify(store.hostSessions.ingestEvent(event('session-state', undefined, 'SessionEnd'))), JSON.stringify(endedByEvent));

  assert.throws(() => store.hostSessions.ingestEvent(event('session-state', 'late-turn', 'UserPromptSubmit', {prompt: 'ended'})), error => error.code === 'HOST_SESSION_ENDED' && error.status === 409);
  const detachedAfterEnd = store.hostSessions.detach({host: 'codex', sessionId: 'session-state', commandId: 'detach-after-end'});
  assert.equal(detachedAfterEnd.status, 'ended');
  store.close();
});

test('workflow finding capture is explicitly associated with a HostTurn and keeps unresolved initial semantics', t => {
  const file = temporary(t);
  const store = createProductWorkspace({file});
  attach(store, 'session-finding');
  store.hostSessions.ingestEvent(event('session-finding', 'turn-1', 'UserPromptSubmit', {prompt: '$trace capture this finding'}));
  const finding = store.hostSessions.captureWorkflowFinding({
    host: 'codex', sessionId: 'session-finding', turnId: 'turn-1', commandId: 'finding-1',
    observation: '截图显示简化流程无人承接', desiredBehavior: '由当前项目状态选择可承接的分支/任务',
  });
  assert.equal(finding.status, 'captured');
  assert.equal(finding.finding.scope, 'unknown');
  assert.equal(finding.finding.target_kind, 'unresolved');
  assert.equal(finding.finding.status, 'captured');
  assert.equal(finding.finding.session_id, 'session-finding');
  assert.equal(finding.finding.turn_id, 'turn-1');
  assert.equal(JSON.stringify(store.hostSessions.captureWorkflowFinding({
    host: 'codex', sessionId: 'session-finding', turnId: 'turn-1', commandId: 'finding-1',
    observation: '截图显示简化流程无人承接', desiredBehavior: '由当前项目状态选择可承接的分支/任务',
  })), JSON.stringify(finding));
  assert.throws(() => store.hostSessions.captureWorkflowFinding({host: 'codex', sessionId: 'session-finding', turnId: 'missing', commandId: 'finding-missing', observation: '不能关联不存在的 turn'}), error => error.code === 'HOST_TURN_NOT_FOUND');
  assert.equal(store.read().revision, 0);
  assert.equal(store.hostSessions.listWorkflowFindings({session_id: 'session-finding'}).length, 1);
  store.close();
});

test('Product Workspace HTTP host routes persist receipts without advancing snapshot revision', async t => {
  const file = temporary(t);
  const server = await serve(t, file);
  const attachResponse = await server.request('/api/product/host/session/attach', {
    method: 'POST', body: {protocolVersion: 1, host: 'codex', sessionId: 'http-session', commandId: 'http-attach', projectRef: null},
  });
  assert.equal(attachResponse.status, 200, attachResponse.text);
  assert.equal(attachResponse.json.protocolVersion, 1);
  assert.equal(attachResponse.json.status, 'attached');
  const promptResponse = await server.request('/api/product/host/event', {
    method: 'POST', body: event('http-session', 'http-turn', 'UserPromptSubmit', {prompt: '通过底层 HTTP 接收'}),
  });
  assert.equal(promptResponse.status, 200, promptResponse.text);
  assert.equal(promptResponse.json.status, 'captured');
  const turnResponse = await server.request('/api/product/host/turns?host=codex&session_id=http-session');
  assert.equal(turnResponse.status, 200, turnResponse.text);
  assert.equal(turnResponse.json.items[0].prompt, '通过底层 HTTP 接收');
  const workspaceResponse = await server.request('/api/product/workspace');
  assert.equal(workspaceResponse.status, 200, workspaceResponse.text);
  assert.equal(workspaceResponse.json.revision, 0);
  await server.close();
});

test('MCP exposes explicit host attach/pause/detach and finding capture against the Product Workspace', async t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-host-mcp-project-'));
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-host-mcp-state-'));
  const file = path.join(stateDirectory, 'web.sqlite');
  const store = createProductWorkspace({file});
  const server = http.createServer(async (request, response) => {
    if (!await store.handle(request, response)) { response.writeHead(404); response.end('{}'); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const environment = Object.fromEntries(Object.entries(process.env).filter(entry => typeof entry[1] === 'string'));
  environment.TRACE_PRODUCT_URL = origin;
  environment.CODEX_THREAD_ID = 'mcp-host-session';
  delete environment.CODEX_SESSION_ID;
  const client = new Client({name: 'trace-host-ingest-test', version: '0.1.0'});
  const transport = new StdioClientTransport({command: process.execPath, args: [mcpEntry], cwd: project, stderr: 'pipe', env: environment});
  await client.connect(transport);
  t.after(async () => {
    await client.close();
    await new Promise(resolve => server.close(resolve));
    store.close();
    fs.rmSync(project, {recursive: true, force: true});
    fs.rmSync(stateDirectory, {recursive: true, force: true});
  });
  const tools = await client.listTools();
  for (const name of ['trace_host_session_attach', 'trace_host_session_pause', 'trace_host_session_detach', 'trace_workflow_finding_capture']) {
    assert.equal(tools.tools.some(tool => tool.name === name), true, `${name} must be exposed by MCP`);
  }
  const call = async (name, argumentsValue = {}) => {
    const response = await client.callTool({name, arguments: argumentsValue});
    const body = response.content?.find(item => item.type === 'text');
    assert.ok(body, `${name} must return a text result`);
    const value = JSON.parse(body.text);
    assert.equal(value.ok, true, `${name} failed: ${JSON.stringify(value)}`);
    return value;
  };
  const attached = await call('trace_host_session_attach');
  assert.equal(attached.status, 'attached');
  const prompt = await fetch(`${origin}/api/product/host/event`, {
    method: 'POST', headers: {origin, 'content-type': 'application/json'},
    body: JSON.stringify(event('mcp-host-session', 'mcp-turn', 'UserPromptSubmit', {prompt: '$trace capture an explicit finding'})),
  });
  assert.equal(prompt.status, 200, await prompt.text());
  const finding = await call('trace_workflow_finding_capture', {turn_id: 'mcp-turn', observation: 'MCP finding is explicit'});
  assert.equal(finding.finding.status, 'captured');
  assert.equal(finding.finding.scope, 'unknown');
  assert.equal((await call('trace_host_session_pause')).status, 'paused');
  assert.equal((await call('trace_host_session_detach')).status, 'ended');
  assert.equal(store.read().revision, 0);
});
