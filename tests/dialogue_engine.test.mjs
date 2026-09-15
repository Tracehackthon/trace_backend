import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {applyProjectInitialize, proposeProjectInitialize} from '../dist/packages/product/application/src/index.js';
import {beginDialogue, stepDialogue, dialogueState, decisionPathView, candidateReviewApply, candidateReviewView} from '../dist/packages/product/application/src/dialogue.js';
import {TraceRuntime} from '../dist/packages/core/runtime/src/index.js';
import {hashTransientPrompt} from '../dist/packages/core/case-capture/src/index.js';
import {buildCodexHookOutput} from '../dist/apps/codex/src/index.js';

const producer = {component: 'trace-test', version: '1.0.0', run_id: 'dialogue-test'};
const scope = {type: 'personal', id: 'user-test'};

function project() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-dialogue-'));
  const input = {project_dir: directory, source_mode: 'local'};
  const proposal = proposeProjectInitialize(input);
  applyProjectInitialize({...input, proposal_id: proposal.proposal_id, approval: `adopt:${proposal.proposal_id}`});
  return directory;
}

function decide(dir, view, chosen, rationale) {
  const fork = view.pending_decisions[0];
  assert.ok(fork, 'expected a pending decision fork');
  return stepDialogue({project_dir: dir, thread_id: view.thread_id, move: {action: 'decide', summary: `用户选择：${chosen}`, decision_id: fork.record_id, chosen, rationale}});
}

test('onboard dialogue runs the full fork chain and closes', () => {
  const dir = project();
  let view = beginDialogue({project_dir: dir, intent: 'onboard'});
  assert.equal(view.step, 'source-mode');
  assert.deepEqual(view.pending_decisions[0].options, ['local', 'external', 'team', 'empty']);

  view = decide(dir, view, 'local', '只用项目本地来源');
  assert.equal(view.step, 'boundaries');
  view = decide(dir, view, '确认，开始初始化', '边界清楚');
  assert.equal(view.step, 'propose');
  assert.match(view.instruction, /trace_project_initialize_propose/);

  view = stepDialogue({project_dir: dir, thread_id: view.thread_id, move: {action: 'confirm', summary: '初始化已完成'}});
  assert.equal(view.done, true);

  const state = dialogueState(dir);
  assert.equal(state.active_count, 0);
  const path = decisionPathView(dir, view.thread_id);
  assert.equal(path.taken.length, 2);
  assert.deepEqual(path.taken.map(node => node.chosen), ['local', '确认，开始初始化']);

  // A closed dialogue does not restart.
  assert.throws(() => beginDialogue({project_dir: dir, intent: 'onboard'}), error => error?.code === 'INVALID_STATE');
});

test('adapt dialogue negotiates in visible rounds and resumes instead of restarting', () => {
  const dir = project();
  let view = beginDialogue({project_dir: dir, intent: 'adapt'});
  assert.equal(view.step, 'elicit');

  // Re-beginning the same intent resumes the open dialogue.
  const resumed = beginDialogue({project_dir: dir, intent: 'adapt'});
  assert.equal(resumed.thread_id, view.thread_id);
  assert.equal(resumed.step, 'elicit');

  for (let index = 0; index < 5; index += 1) {
    view = stepDialogue({project_dir: dir, thread_id: view.thread_id, move: {action: 'answer', summary: `第 ${index + 1} 题的回答`}});
  }
  assert.equal(view.step, 'reflect');
  view = decide(dir, view, '准确，生成协作提案', '理解无误');
  assert.equal(view.step, 'draft');

  // The user negotiates: revise forks a child round on the same step.
  const fork = view.pending_decisions[0];
  view = stepDialogue({project_dir: dir, thread_id: view.thread_id, move: {action: 'revise', summary: '用户要求收紧草案', decision_id: fork.record_id, revised_prompt: '如何处理这份协作模型草案（第二版）？', revised_options: ['全部采纳', '放弃'], rationale: '草案第二条越界'}});
  assert.equal(view.step, 'draft');
  assert.equal(view.pending_decisions[0].round, 2);
  assert.equal(view.pending_decisions[0].parent_decision_id, fork.record_id);

  view = decide(dir, view, '全部采纳', '第二版可以接受');
  assert.equal(view.step, 'adopt');
  view = stepDialogue({project_dir: dir, thread_id: view.thread_id, move: {action: 'confirm', summary: 'profile 更新已 apply'}});
  assert.equal(view.step, 'followup');
  view = stepDialogue({project_dir: dir, thread_id: view.thread_id, move: {action: 'confirm', summary: '结束'}});
  assert.equal(view.done, true);

  const path = decisionPathView(dir, view.thread_id);
  const draftNodes = path.nodes.filter(node => node.prompt.includes('草案'));
  assert.equal(draftNodes.length, 2);
  assert.equal(draftNodes[0].status, 'superseded');
  assert.equal(draftNodes[0].rationale, '草案第二条越界');
  assert.equal(draftNodes[1].status, 'decided');

  // The finished adapt dialogue stays watching for later verification.
  const state = dialogueState(dir);
  assert.equal(state.active_count, 1);
  assert.equal(state.dialogues[0].status, 'watching');
});

test('review rejection feeds future adapt drafts as a negative example and SessionStart surfaces pending forks', () => {
  const dir = project();
  const sqlite = path.join(dir, '.trace', 'state', 'trace.sqlite');
  const runtime = new TraceRuntime({sqliteStateFile: sqlite});
  const proposal = runtime.proposePromptCase({
    prompt_hash: hashTransientPrompt('RAW_PROMPT_NEVER_STORED'), capture_mode: 'summary',
    intent_summary: '审阅多 Agent 交接的 prompt 案例', rationale: '可能成为前例', scope, producer,
    correlation_id: 'corr-review', causation_id: 'cause-review',
  });
  runtime.close();

  let view = beginDialogue({project_dir: dir, intent: 'review'});
  assert.equal(view.step, 'triage');
  assert.equal(view.pending_decisions.length, 1);
  view = decide(dir, view, '拒绝', '这类 prompt 涉及客户机密，任何形态都不该沉淀');
  view = stepDialogue({project_dir: dir, thread_id: view.thread_id, move: {action: 'confirm', summary: '审阅完毕'}});
  assert.equal(view.done, true);

  const record = candidateReviewView(dir, proposal.proposal_ref.record_id);
  assert.equal(record.status, 'candidate'); // the dialogue records the fork; the record itself awaits apply
  const applied = candidateReviewApply({project_dir: dir, record_id: proposal.proposal_ref.record_id, action: 'reject', approval: `approve:${proposal.proposal_ref.record_id}`, rationale: '这类 prompt 涉及客户机密，任何形态都不该沉淀'});
  assert.equal(applied.status, 'rejected');

  // Review is recurring: a closed dialogue starts a new round on the same thread.
  const secondRound = beginDialogue({project_dir: dir, intent: 'review'});
  assert.equal(secondRound.thread_id, view.thread_id);
  assert.equal(secondRound.step, 'triage');
  const pathAfterReopen = decisionPathView(dir, view.thread_id);
  assert.equal(pathAfterReopen.taken.some(node => node.chosen === '拒绝'), true);

  // A later adapt draft must carry the rejection rationale as an avoid direction.
  let adapt = beginDialogue({project_dir: dir, intent: 'adapt'});
  for (let index = 0; index < 5; index += 1) adapt = stepDialogue({project_dir: dir, thread_id: adapt.thread_id, move: {action: 'answer', summary: '回答'}});
  adapt = stepDialogue({project_dir: dir, thread_id: adapt.thread_id, move: {action: 'decide', summary: '确认理解', decision_id: adapt.pending_decisions[0].record_id, chosen: '准确，生成协作提案', rationale: '准确'}});
  assert.equal(adapt.step, 'draft');
  assert.match(adapt.instruction, /客户机密/);

  // SessionStart injects open threads and pending forks for the next session.
  const hookRuntime = new TraceRuntime({sqliteStateFile: sqlite});
  const output = buildCodexHookOutput({hook_event_name: 'SessionStart', session_id: 'fresh-session', cwd: dir}, hookRuntime, {});
  const context = output.hookSpecificOutput.additionalContext;
  assert.match(context, /Trace session resume/);
  assert.match(context, /如何处理这份协作模型草案/);
  hookRuntime.close();
});
