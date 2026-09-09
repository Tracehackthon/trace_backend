import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = path.resolve(process.cwd());
const cli = path.join(root, 'dist', 'apps', 'cli', 'src', 'main.js');

test('Codex trigger can switch to the TypeScript runtime without a Python hook', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-codex-trigger-'));
  const database = path.join(dir, 'trace.sqlite');
  const eventFile = path.join(dir, 'codex-turn-started.json');
  fs.writeFileSync(eventFile, JSON.stringify({
    event_type: 'codex.turn.started',
    thread_id: 'thread-trigger-001',
    purpose: '切换 Codex 触发链路',
    summary: '使用 TS runtime 构建受控 Activation Pack，不调用旧 Python runtime。',
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
});
