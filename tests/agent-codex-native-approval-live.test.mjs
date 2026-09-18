import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createCodexAdapter, NATIVE_CODEX_MODE } from '../apps/agent/codex.mjs';
import { TERMINAL } from '../apps/agent/protocol.mjs';
import { fixture } from './fixtures/agent-harness.mjs';

test('LIVE: HTTP approval resumes the same authenticated native Codex turn and writes only after accept',
  { skip: process.env.TRACE_AGENT_APPROVAL_LIVE !== '1', timeout: 420000 }, async t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-native-approval-e2e-'));
  execFileSync('git', ['init', '-q'], { cwd: project });
  fs.writeFileSync(path.join(project, 'README.md'), 'Temporary Trace approval smoke project.\n', 'utf8');
  t.after(() => {
    assert.equal(path.dirname(project), path.resolve(os.tmpdir()));
    assert.ok(path.basename(project).startsWith('trace-native-approval-e2e-'));
    fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const adapter = createCodexAdapter({
    mode: NATIVE_CODEX_MODE,
    projectCwd: project,
    providerConfig: { sandbox_mode: 'read-only' },
    interactionTtlMs: 180000,
  });
  const check = await adapter.check();
  assert.equal(check.authenticated, true);

  const a = await fixture(t, { adapter, timeoutMs: 300000 });
  const marker = path.join(project, 'approval-sentinel.txt');
  const created = await a.request('/api/agent/runs', a.envelope({
    input: [
      '这是一次临时审批链路验收。必须使用命令执行工具，不能使用 apply_patch。',
      "请运行 PowerShell 命令在当前项目创建 approval-sentinel.txt，内容必须精确为 TRACE_APPROVAL_OK 且不带换行。",
      '当前为只读沙箱；请正常发起一次性用户审批，不要绕过审批。批准后读取该文件核验。',
      '最后按系统要求返回结构化 JSON；answer 简短说明验证结果，replacement=null，citations=[]，uncertainties=[]。',
    ].join('\n'),
  }));
  assert.equal(created.status, 202, JSON.stringify(created.json));
  const runId = created.json.run.runId;
  const handled = new Set();
  const seen = [];
  let finished = null;
  for (let i = 0; i < 600; i++) {
    const run = a.service.get(runId);
    const pending = run.runtime?.pendingInteraction;
    if (pending && !handled.has(pending.interactionId)) {
      seen.push({ method: pending.method, kind: pending.kind, revision: pending.revision });
      assert.equal(pending.kind, 'approval', JSON.stringify(pending));
      const response = await a.request(`/api/agent/runs/${runId}/approval`, {
        interactionId: pending.interactionId,
        expectedRevision: pending.revision,
        idempotencyKey: `live-${randomUUID()}`,
        decision: 'accept',
      });
      assert.equal(response.status, 200, JSON.stringify(response.json));
      handled.add(pending.interactionId);
    }
    if (TERMINAL.has(run.status)) { finished = run; break; }
    await delay(500);
  }
  assert.ok(finished, 'live native run did not terminate');
  assert.ok(seen.length > 0, `model completed without an approval request: ${JSON.stringify(finished)}`);
  assert.equal(finished.status, 'succeeded', JSON.stringify(finished));
  assert.equal(fs.readFileSync(marker, 'utf8'), 'TRACE_APPROVAL_OK');
  const events = a.service.events(runId, 0);
  assert.ok(events.some(event => event.type === 'runtime.approval.required'));
  assert.ok(events.some(event => event.type === 'runtime.interaction.resolved'));
  t.diagnostic(JSON.stringify({ check, runId, seen, threadId: finished.runtime?.threadId,
    turnId: finished.runtime?.turnId, result: finished.result?.answer }));
  });
