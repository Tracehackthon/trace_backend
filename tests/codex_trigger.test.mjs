import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

const root = path.resolve(process.cwd());
const cli = path.join(root, 'dist', 'apps', 'cli', 'src', 'main.js');

test('CLI help is a successful discovery path rather than an input error', () => {
  const result = spawnSync(process.execPath, [cli, '--help'], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /trace-runtime doctor run/);
  assert.equal(result.stdout.includes('"ok":false'), false);
});

test('Codex trigger can switch to the TypeScript runtime without a Python hook', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-codex-trigger-'));
  const database = path.join(dir, 'trace.sqlite');
  const eventFile = path.join(dir, 'codex-turn-started.json');
  fs.writeFileSync(eventFile, JSON.stringify({
    event_type: 'codex.turn.started',
    thread_id: 'thread-trigger-001',
    purpose: '切换 Codex 触发链路',
    summary: 'SENSITIVE_PROMPT_MARKER: 使用 TS runtime 构建受控 Activation Pack，不调用旧 Python runtime。',
    source_refs: [{record_id: 'record-source-001', revision: 1, label: '知乎摘要'}],
    read_pointers: [{path: 'D:/abs/source.md', purpose: '读取已授权摘要', priority: 'must', stop_condition: '完成一条可追溯观察'}],
    forbidden_scopes: ['raw-chat-transcript', 'unadopted-candidate'],
    max_tokens: 3000,
  }, null, 2), 'utf8');
  const result = spawnSync(process.execPath, [cli, 'codex', 'trigger', '--sqlite-state-file', database, '--event-file', eventFile], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'triggered');
  assert.equal(output.pack.source_refs.length, 1);
  assert.equal(output.receipt.kind, 'activation_receipt');
  assert.equal(output.pack.forbidden_scopes.includes('raw-chat-transcript'), true);
  assert.equal(output.correlation_id, 'codex-session:thread-trigger-001');
  assert.equal(output.receipt.protocol_version, '0.2.0');
  assert.equal(output.receipt.correlation_id, output.correlation_id);
  assert.equal(output.receipt.causation_id, output.causation_id);
  assert.equal(output.trace_event.outcome, 'success');
  assert.equal(JSON.stringify(output.trace_event).includes('SENSITIVE_PROMPT_MARKER'), false, 'runtime events must never include the raw prompt/summary');

  const doctor = spawnSync(process.execPath, [cli, 'doctor', 'run', '--sqlite-state-file', database, '--correlation-id', output.correlation_id], {encoding: 'utf8'});
  assert.equal(doctor.status, 0, doctor.stderr);
  const report = JSON.parse(doctor.stdout);
  assert.equal(report.status, 'healthy');
  assert.equal(report.correlation_trace.correlation_id, output.correlation_id);
  assert.equal(report.correlation_trace.events.length, 1);
  assert.equal(report.correlation_trace.events[0].event_id, output.trace_event.event_id);
  assert.equal(JSON.stringify(report.correlation_trace).includes('SENSITIVE_PROMPT_MARKER'), false, 'doctor correlation output must remain provenance-only');
});

test('Codex hook uses a raw prompt only transiently and never persists it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-codex-hook-privacy-'));
  const database = path.join(dir, 'trace.sqlite');
  const marker = 'RAW_PROMPT_MUST_NOT_BE_PERSISTED_4b7c25';
  const result = spawnSync(process.execPath, [cli, 'codex', 'hook-stdio', '--sqlite-state-file', database], {
    encoding: 'utf8',
    input: JSON.stringify({hook_event_name: 'UserPromptSubmit', session_id: 'hook-privacy-session', prompt: marker, cwd: dir}),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes(marker), false, 'hook response must not echo the raw prompt');

  const db = new DatabaseSync(database);
  try {
    const continuity = db.prepare('SELECT payload FROM continuity_records').all();
    const events = db.prepare('SELECT * FROM trace_events').all();
    assert.equal(JSON.stringify(continuity).includes(marker), false, 'continuity state must not retain the raw prompt');
    assert.equal(JSON.stringify(events).includes(marker), false, 'runtime events must not retain the raw prompt');
  } finally {
    db.close();
  }
});
