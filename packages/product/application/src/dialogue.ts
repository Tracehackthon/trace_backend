/**
 * Trace dialogue engine.
 *
 * The host LLM still owns language; Trace owns the script. Each engagement is
 * a continuity thread, every user exchange a discussion_turn, and every fork
 * presented to the user a decision_point (择路: the negotiation itself is the
 * visible chain). The current step is derived from the ledger — there is no
 * hidden dialogue state outside the project's own Trace store.
 */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {ProtocolError} from '../../../core/protocol/src/index.js';
import {TraceRuntime} from '../../../core/runtime/src/index.js';
import type {ContinuityEnvelope, DecisionPath, DecisionPathNode} from '../../../core/continuity/src/index.js';
import {requireTraceProject, type ProductProjectContext} from './index.js';

export const DIALOGUE_INTENTS = ['onboard', 'adapt', 'review'] as const;
export type DialogueIntent = (typeof DIALOGUE_INTENTS)[number];

export interface DialogueMove {
  action: 'answer' | 'decide' | 'revise' | 'confirm' | 'abort';
  /** Host-authored summary of what the user said; never raw prompt bytes. */
  summary: string;
  decision_id?: string;
  expected_revision?: number;
  chosen?: string;
  rationale?: string;
  revised_prompt?: string;
  revised_options?: string[];
}

export interface DialogueStepView {
  thread_id: string;
  intent: DialogueIntent;
  step: string;
  instruction: string;
  pending_decisions: DecisionPathNode[];
  open_questions: string[];
  done: boolean;
}

interface StepToken {intent: DialogueIntent; step: string; index: number;}

type JsonRecord = Record<string, unknown>;

const STEP_TOKEN = /^trace-dialogue-step:(onboard|adapt|review):([a-z-]+):(\d+)$/;
const ELICIT_TOPICS = [
  '讨论节奏：先讨论清楚再动手，还是直接给方案？',
  '反馈详略：喜欢逐条展开还是先给结论？',
  '决策方式：提案后想逐条取舍，还是整体采纳？',
  '来源边界：哪些资料可以用、哪些绝不进长期状态？',
  '禁区：Agent 有哪些行为是你明确不想要的？',
];
const SOURCE_MODES = ['local', 'external', 'team', 'empty'];
const SAVE_CHOICES: Readonly<Record<string, 'summary' | 'redacted_excerpt' | 'full_private'>> = {
  '保存摘要': 'summary',
  '保存脱敏片段': 'redacted_excerpt',
  '保存完整私有': 'full_private',
};
const REJECT_PATTERN = /拒绝|放弃|reject|drop/i;

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16); }
function tokenFor(intent: DialogueIntent, step: string, index: number): string { return `trace-dialogue-step:${intent}:${step}:${index}`; }
function parseToken(value: unknown): StepToken | undefined {
  if (typeof value !== 'string') return undefined;
  const match = STEP_TOKEN.exec(value);
  if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) return undefined;
  return {intent: match[1] as DialogueIntent, step: match[2], index: Number(match[3])};
}
function dialogueThreadId(projectDir: string, intent: DialogueIntent): string { return `dialogue-${intent}-${digest({project: projectDir, intent})}`; }

function withDialogueRuntime<T>(context: ProductProjectContext, callback: (runtime: TraceRuntime) => T): T {
  if (!fs.existsSync(context.state_file)) throw new ProtocolError('PROJECT_NOT_INITIALIZED', 'Trace dialogue requires initialized project state; finish Trace setup first.');
  const runtime = new TraceRuntime({sqliteStateFile: context.state_file});
  try { return callback(runtime); } finally { runtime.close(); }
}

function threadOf(runtime: TraceRuntime, threadId: string): ContinuityEnvelope {
  const thread = runtime.listContinuity(threadId).find(record => record.kind === 'thread' && record.record_id === threadId);
  if (!thread) throw new ProtocolError('NOT_FOUND', `Unknown dialogue thread: ${threadId}`);
  return thread;
}

function currentStep(thread: ContinuityEnvelope): StepToken {
  const token = parseToken(thread.payload.next_action);
  if (!token) throw new ProtocolError('INVALID_STATE', `dialogue thread ${thread.record_id} has no active step`);
  return token;
}

function dialogTitle(intent: DialogueIntent): string {
  return intent === 'onboard' ? 'Trace 初始化访谈' : intent === 'adapt' ? 'Trace 协作适配访谈' : 'Trace 候选审阅';
}

/** Rejection and superseded rationales across the whole project: the negative examples later drafts must respect. */
export function collectRejectionRationales(runtime: TraceRuntime): string[] {
  const rationales: string[] = [];
  for (const record of runtime.listContinuity()) {
    if (record.kind !== 'decision_point') continue;
    const payload = record.payload;
    if (typeof payload.rationale !== 'string') continue;
    if (payload.status === 'superseded') { rationales.push(payload.rationale); continue; }
    if (payload.status === 'decided' && typeof payload.chosen === 'string' && REJECT_PATTERN.test(payload.chosen)) rationales.push(payload.rationale);
  }
  return [...new Set(rationales)];
}

function pendingReviewItems(runtime: TraceRuntime): Array<{id: string; kind: string; title: string}> {
  return runtime.listData()
    .filter(record => record.status === 'candidate' && ['prompt_capture_proposal', 'candidate_precedent', 'capability_candidate'].includes(record.kind))
    .map(record => {
      const payload = record.payload as JsonRecord;
      const title = typeof payload.intent_summary === 'string' ? payload.intent_summary
        : typeof payload.claim === 'string' ? payload.claim
          : typeof payload.title === 'string' ? payload.title : record.subject.id;
      return {id: record.record_id, kind: record.kind, title};
    });
}

function takenChoice(runtime: TraceRuntime, threadId: string, options: string[]): string | undefined {
  const taken = runtime.decisionPath(threadId).taken.find(node => options.includes(node.chosen));
  return taken?.chosen;
}

interface StepSpec {
  instruction: string;
  fork?: {prompt: string; options: string[]; related_refs?: string[]};
}

function stepSpec(runtime: TraceRuntime, threadId: string, step: StepToken): StepSpec {
  if (step.intent === 'onboard') {
    if (step.step === 'source-mode') return {
      instruction: [
        '向用户解释四种认知来源模式，一次讲清，不要替用户选择：',
        '- local：只用项目本地 .trace/source，不外接任何来源；',
        '- external：接入一个用户明确授权的外部认知源（如个人 Wiki）；',
        '- team：接入团队共享来源；',
        '- empty：完全不配置来源。',
        '同时说明：Trace 只保存 hash、摘要与用户显式选择的内容；不保存原始 prompt、来源正文、绝对路径与凭证。',
        '然后请用户做出第一个决定。',
      ].join('\n'),
      fork: {prompt: '选择这个项目的认知来源模式', options: SOURCE_MODES},
    };
    if (step.step === 'boundaries') {
      const chosen = takenChoice(runtime, threadId, SOURCE_MODES) ?? '未记录';
      return {
        instruction: `回放用户的选择（来源模式：${chosen}），并逐条确认边界：会创建 .trace/ 项目状态、协作 profile、来源地图与 SQLite；不会读取来源正文、不会安装全局 hooks、不会覆盖已有状态。请用户确认或返回修改。`,
        fork: {prompt: '确认以上边界并开始初始化？', options: ['确认，开始初始化', '返回修改来源模式', '放弃']},
      };
    }
    if (step.step === 'propose') {
      const chosen = takenChoice(runtime, threadId, SOURCE_MODES) ?? 'local';
      return {instruction: `调用 trace_project_initialize_propose（source_mode: "${chosen}"），用普通语言向用户展示 proposal 的将做/不做；用户明确说"采用"后调用 trace_project_initialize_apply。apply 成功后用 confirm 结束本对话。`};
    }
    return {instruction: '初始化对话已完成。项目已有自己的 .trace/ 状态；日常协作中的候选与决定会陆续出现在决策路径里。'};
  }
  if (step.intent === 'adapt') {
    if (step.step === 'elicit') {
      const topic = ELICIT_TOPICS[Math.min(step.index, ELICIT_TOPICS.length - 1)];
      return {instruction: `适配访谈（第 ${step.index + 1}/${ELICIT_TOPICS.length} 题，一次只问一题，不要合并提问）：${topic}\n用户回答后用 answer 推进；用户表示"问够了"时用 confirm 进入理解回放。`};
    }
    if (step.step === 'reflect') return {
      instruction: '把访谈中听到的协作偏好用自己的话完整回放给用户，区分：哪些是长期协作规则、哪些只是本轮观察。请用户确认理解是否准确。',
      fork: {prompt: '以上对你协作方式的理解准确吗？', options: ['准确，生成协作提案', '需要纠正', '放弃']},
    };
    if (step.step === 'draft') {
      const rejections = collectRejectionRationales(runtime);
      const avoid = rejections.length === 0 ? '（本项目还没有历史拒绝记录）' : rejections.map((item, index) => `${index + 1}. ${item}`).join('\n');
      return {
        instruction: [
          '基于已确认的理解，起草逐条的协作模型变更：新增行为、避免行为、来源边界、保持 transient 的信息。',
          '起草"避免行为"时必须考虑以下历史拒绝理由（用户过去否决过的方向，不要换个说法再提）：',
          avoid,
          '把草案逐条展示给用户，并询问整体处理方式。用户要求修改时，用 revise 给出修订后的整份草案，协商轮次会留在决策路径里。',
        ].join('\n'),
        fork: {prompt: '如何处理这份协作模型草案？', options: ['全部采纳', '逐条协商修改', '放弃']},
      };
    }
    if (step.step === 'adopt') return {instruction: '把用户采纳的含义整理成结构化 collaboration_model 与 source_activation，调用 trace_profile_update_propose 并展示 before/after；用户明确采纳后调用 trace_profile_update_apply，成功后用 confirm 推进本对话。'};
    if (step.step === 'followup') return {instruction: '适配已生效。告诉用户：这条线索会保持 watching，使用几轮后可以回来说"$trace 验证适配效果"，届时对照实际协作证据确认保留或调整。'};
    return {instruction: '适配对话已完成。'};
  }
  if (step.step === 'done') return {instruction: '候选审阅已结束。'};
  // review triage
  const items = pendingReviewItems(runtime);
  if (items.length === 0) return {instruction: '没有等待决定的候选。Trace 没有静默记住任何东西——本轮讨论的内容仍是 transient，除非用户明确选择沉淀。用户可以 confirm 结束。'};
  if (step.index >= items.length) return {instruction: '全部候选已审完。追问用户：保存下来的案例后来有效吗？补充结果证据后，可复用的案例才能走向 precedent 与能力验证。用户可以 confirm 结束。'};
  const item = items[step.index];
  if (item === undefined) return {instruction: '全部候选已审完。用户可以 confirm 结束。'};
  return {
    instruction: `候选 ${step.index + 1}/${items.length}（${item.kind}）：${item.title}\n向用户说明：它为什么仍是候选、保存后会发生什么、不决定会怎样。然后请用户做决定；选择"拒绝"必须说明理由，理由会成为以后提案的负例。`,
    fork: {prompt: `如何处理候选「${item.title}」？`, options: [...Object.keys(SAVE_CHOICES), '拒绝', '暂不决定'], related_refs: [item.id]},
  };
}

function describeStep(runtime: TraceRuntime, thread: ContinuityEnvelope, step: StepToken): DialogueStepView {
  const spec = stepSpec(runtime, thread.record_id, step);
  let pending = runtime.pendingDecisions(thread.record_id);
  if (spec.fork && pending.length === 0) {
    runtime.createDecisionPoint({
      thread_id: thread.record_id,
      prompt: spec.fork.prompt,
      options: spec.fork.options,
      ...(spec.fork.related_refs === undefined ? {} : {related_refs: spec.fork.related_refs}),
    });
    pending = runtime.pendingDecisions(thread.record_id);
  }
  const done = thread.payload.status === 'resolved' || thread.payload.status === 'published';
  return {
    thread_id: thread.record_id,
    intent: step.intent,
    step: step.step,
    instruction: spec.instruction,
    pending_decisions: pending,
    open_questions: (thread.payload.open_questions as string[] | undefined) ?? [],
    done,
  };
}

function enterStep(runtime: TraceRuntime, thread: ContinuityEnvelope, next: StepToken): DialogueStepView {
  const updated = runtime.updateThread(thread.record_id, {expected_revision: thread.revision, next_action: tokenFor(next.intent, next.step, next.index)});
  return describeStep(runtime, updated, next);
}

function advanceAfterDecide(step: StepToken, chosen: string): StepToken {
  const at = (intent: DialogueIntent, name: string, index = 0): StepToken => ({intent, step: name, index});
  if (step.intent === 'onboard') {
    if (step.step === 'source-mode') return at('onboard', 'boundaries');
    if (step.step === 'boundaries') {
      if (chosen === '确认，开始初始化') return at('onboard', 'propose');
      if (chosen === '返回修改来源模式') return at('onboard', 'source-mode');
      return at('onboard', 'done');
    }
  }
  if (step.intent === 'adapt') {
    if (step.step === 'reflect') {
      if (chosen === '准确，生成协作提案') return at('adapt', 'draft');
      if (chosen === '需要纠正') return at('adapt', 'elicit', ELICIT_TOPICS.length - 1);
      return at('adapt', 'done');
    }
    if (step.step === 'draft') {
      if (chosen === '全部采纳') return at('adapt', 'adopt');
      if (chosen === '逐条协商修改') return at('adapt', 'draft'); // stays; revision forks carry the negotiation rounds
      return at('adapt', 'done');
    }
  }
  if (step.intent === 'review' && step.step === 'triage') return at('review', 'triage', step.index + 1);
  return {...step};
}

export interface BeginDialogueInput {project_dir?: string; intent: DialogueIntent;}

export function beginDialogue(input: BeginDialogueInput): DialogueStepView {
  if (!DIALOGUE_INTENTS.includes(input.intent)) throw new ProtocolError('INVALID_INPUT', `intent must be one of: ${DIALOGUE_INTENTS.join(', ')}`);
  const context = requireTraceProject(input.project_dir);
  return withDialogueRuntime(context, runtime => {
    const threadId = dialogueThreadId(context.project_dir, input.intent);
    const initial: StepToken = {intent: input.intent, step: input.intent === 'adapt' ? 'elicit' : input.intent === 'review' ? 'triage' : 'source-mode', index: 0};
    const existing = runtime.listContinuity(threadId).find(record => record.kind === 'thread');
    if (existing) {
      const status = existing.payload.status;
      const token = parseToken(existing.payload.next_action);
      if (input.intent === 'onboard') {
        if (status === 'resolved' || status === 'published' || token === undefined) throw new ProtocolError('INVALID_STATE', `dialogue ${threadId} is already ${String(status)}`);
        return describeStep(runtime, existing, token);
      }
      // adapt / review are recurring: a mid-dialogue thread resumes, while a
      // closed or finished one starts a new round on the same thread — earlier
      // rounds stay visible in its decision path.
      if (token !== undefined && status !== 'resolved' && status !== 'published') return describeStep(runtime, existing, token);
      const reopened = runtime.updateThread(existing.record_id, {expected_revision: existing.revision, status: 'open', next_action: tokenFor(initial.intent, initial.step, initial.index)});
      return describeStep(runtime, reopened, initial);
    }
    runtime.createThread({thread_id: threadId, title: dialogTitle(input.intent), current_summary: '对话开始', next_action: tokenFor(initial.intent, initial.step, initial.index)});
    return describeStep(runtime, threadOf(runtime, threadId), initial);
  });
}

export interface StepDialogueInput {project_dir?: string; thread_id: string; move: DialogueMove;}

export function stepDialogue(input: StepDialogueInput): DialogueStepView {
  const context = requireTraceProject(input.project_dir);
  return withDialogueRuntime(context, runtime => {
    const thread = threadOf(runtime, input.thread_id);
    const step = currentStep(thread);
    const move = input.move;
    let delta: 'none' | 'revision' | 'adoption' | 'rejection' = 'none';
    let next: StepToken = {...step};
    let finish = false;
    let directive: string | undefined;

    if (move.action === 'abort') { finish = true; delta = 'rejection'; }
    else if (move.action === 'decide' || move.action === 'revise') {
      const decisionId = move.decision_id ?? '';
      const target = runtime.pendingDecisions(input.thread_id).find(node => node.record_id === decisionId);
      if (!target) throw new ProtocolError('INVALID_INPUT', `decision ${decisionId} is not pending in this dialogue`);
      if (move.action === 'decide') {
        if (move.chosen === undefined || move.rationale === undefined) throw new ProtocolError('INVALID_INPUT', 'decide requires chosen and rationale');
        runtime.resolveDecisionPoint(decisionId, {expected_revision: move.expected_revision ?? target.revision, chosen: move.chosen, rationale: move.rationale});
        delta = REJECT_PATTERN.test(move.chosen) ? 'rejection' : 'adoption';
        const saveMode = SAVE_CHOICES[move.chosen];
        if (saveMode !== undefined && target.related_refs.length > 0) {
          directive = `先调用 trace_candidate_review_apply（record_id: "${target.related_refs[0]}", action: "save", save_mode: "${saveMode}"，由用户提供内容文件与 approval）完成保存，再展示下一步。`;
        }
        next = advanceAfterDecide(step, move.chosen);
      } else {
        if (move.revised_prompt === undefined || move.revised_options === undefined || move.rationale === undefined) throw new ProtocolError('INVALID_INPUT', 'revise requires revised_prompt, revised_options and rationale');
        runtime.reviseDecisionPoint(decisionId, {expected_revision: move.expected_revision ?? target.revision, prompt: move.revised_prompt, options: move.revised_options, rationale: move.rationale});
        delta = 'revision';
        // A revision keeps the dialogue on the same step; the new child fork is the pending one.
      }
    } else if (move.action === 'confirm') {
      if (step.intent === 'adapt' && step.step === 'elicit') next = {intent: 'adapt', step: 'reflect', index: 0};
      else if (step.intent === 'adapt' && step.step === 'adopt') next = {intent: 'adapt', step: 'followup', index: 0};
      else if (step.intent === 'onboard' && step.step === 'propose') finish = true;
      else if (step.intent === 'adapt' && step.step === 'followup') finish = true;
      else if (step.intent === 'review') finish = true;
      else throw new ProtocolError('INVALID_INPUT', `confirm is not valid at step ${step.intent}:${step.step}; use decide on the pending fork`);
    } else if (move.action === 'answer') {
      if (step.intent === 'adapt' && step.step === 'elicit') {
        next = step.index + 1 < ELICIT_TOPICS.length ? {intent: 'adapt', step: 'elicit', index: step.index + 1} : {intent: 'adapt', step: 'reflect', index: 0};
      } else if (step.intent === 'review' && step.step === 'triage') next = {intent: 'review', step: 'triage', index: step.index + 1};
    } else {
      throw new ProtocolError('INVALID_INPUT', `unsupported dialogue action: ${String(move.action)}`);
    }

    if (next.step === 'done') finish = true;

    const latestThread = threadOf(runtime, input.thread_id);
    const result = finish
      ? finishDialogue(runtime, latestThread, step, move.summary)
      : enterStep(runtime, latestThread, next);
    if (directive !== undefined) result.instruction = `${directive}\n\n${result.instruction}`;

    runtime.appendDiscussionTurn({
      thread_id: input.thread_id,
      user_input_summary: move.summary,
      output_summary: result.instruction,
      delta_type: delta,
      persisted_refs: result.pending_decisions.map(node => `${node.record_id}@${node.revision}`),
      open_questions: result.open_questions,
    });
    return result;
  });
}

function finishDialogue(runtime: TraceRuntime, thread: ContinuityEnvelope, step: StepToken, closingSummary: string): DialogueStepView {
  runtime.updateThread(thread.record_id, {
    expected_revision: thread.revision,
    status: step.intent === 'adapt' ? 'watching' : 'resolved',
    current_summary: closingSummary,
    ...(step.intent === 'adapt' ? {next_action: '使用几轮后回来验证适配效果（$trace 验证适配效果）'} : {}),
  });
  runtime.createReceipt({
    thread_id: thread.record_id,
    receipt_kind: 'persistence',
    summary: `对话「${dialogTitle(step.intent)}」结束：每轮交锋与决定已在决策路径中可见；未保存原始对话逐字稿。`,
    not_persisted: ['原始对话逐字稿'],
    next_prompts: step.intent === 'adapt' ? ['验证适配效果', '查看决策路径'] : ['查看决策路径', '继续日常工作'],
  });
  const closed = threadOf(runtime, thread.record_id);
  return {
    thread_id: thread.record_id,
    intent: step.intent,
    step: 'done',
    instruction: stepSpec(runtime, thread.record_id, {intent: step.intent, step: 'done', index: 0}).instruction,
    pending_decisions: runtime.pendingDecisions(thread.record_id),
    open_questions: (closed.payload.open_questions as string[] | undefined) ?? [],
    done: true,
  };
}

export function dialogueState(projectDir: string | undefined, threadId?: string): JsonRecord {
  const context = requireTraceProject(projectDir);
  return withDialogueRuntime(context, runtime => {
    const view = (thread: ContinuityEnvelope): JsonRecord => {
      const step = parseToken(thread.payload.next_action);
      return {
        thread_id: thread.record_id,
        title: thread.payload.title,
        status: thread.payload.status,
        step: step === undefined ? null : `${step.intent}:${step.step}:${step.index}`,
        pending_decisions: runtime.pendingDecisions(thread.record_id),
        summary: thread.payload.current_summary,
      };
    };
    if (threadId !== undefined) return view(threadOf(runtime, threadId));
    const threads = runtime.listContinuity()
      .filter(record => record.kind === 'thread' && record.record_id.startsWith('dialogue-'))
      .filter(record => record.payload.status === 'open' || record.payload.status === 'watching');
    return {active_count: threads.length, dialogues: threads.map(view)};
  });
}

export function decisionPathView(projectDir: string | undefined, threadId: string): DecisionPath {
  const context = requireTraceProject(projectDir);
  return withDialogueRuntime(context, runtime => runtime.decisionPath(threadId));
}

/* ---- Candidate review closure (previously CLI-only) ---- */

export function candidateReviewView(projectDir: string | undefined, recordId: string): JsonRecord {
  const context = requireTraceProject(projectDir);
  return withDialogueRuntime(context, runtime => {
    const record = runtime.data.get(recordId);
    const payload = record.payload as JsonRecord;
    const title = typeof payload.intent_summary === 'string' ? payload.intent_summary
      : typeof payload.claim === 'string' ? payload.claim
        : typeof payload.title === 'string' ? payload.title : record.subject.id;
    return {
      record_id: record.record_id,
      revision: record.revision,
      kind: record.kind,
      status: record.status,
      title,
      rationale: typeof payload.rationale === 'string' ? payload.rationale : null,
      created_at: record.created_at,
      available_decisions: record.status === 'candidate' ? [...Object.keys(SAVE_CHOICES), '拒绝', '暂不决定'] : [],
      note: '候选不等于能力；保存后仍需结果证据与显式验证才可能走向 precedent 与发布。',
    };
  });
}

export interface CandidateReviewApplyInput {
  project_dir?: string;
  record_id: string;
  action: 'save' | 'reject';
  approval: string;
  save_mode?: 'summary' | 'redacted_excerpt' | 'full_private';
  /** Absolute path of the user-selected content file; read only at this approval boundary. */
  content_file?: string;
  title?: string;
  rationale?: string;
}

export function candidateReviewApply(input: CandidateReviewApplyInput): JsonRecord {
  const context = requireTraceProject(input.project_dir);
  return withDialogueRuntime(context, runtime => {
    const record = runtime.data.get(input.record_id);
    if (record.status !== 'candidate') throw new ProtocolError('INVALID_STATE', `record ${input.record_id} is ${record.status}, not a pending candidate`);
    const producer = {component: 'trace.product-dialogue', version: '0.1.0', run_id: `dialogue:${Date.now()}`};
    if (input.action === 'reject') {
      if (input.rationale === undefined || input.rationale.trim().length === 0) throw new ProtocolError('INVALID_INPUT', 'reject requires a rationale; it becomes a negative example for future proposals');
      const rejected = runtime.updateData(input.record_id, {expected_revision: record.revision, status: 'rejected', note: input.rationale});
      // Data records cannot carry a note today; the rationale lives in the
      // decision trail so future adapt drafts treat it as a negative example.
      const threadId = dialogueThreadId(context.project_dir, 'review');
      if (runtime.listContinuity(threadId).find(item => item.kind === 'thread') === undefined) {
        runtime.createThread({thread_id: threadId, title: dialogTitle('review'), current_summary: '独立审阅（未经对话脚本）', status: 'watching'});
      }
      const fork = runtime.createDecisionPoint({thread_id: threadId, prompt: `如何处理候选「${input.record_id}」？`, options: [...Object.keys(SAVE_CHOICES), '拒绝', '暂不决定'], related_refs: [input.record_id]});
      runtime.resolveDecisionPoint(fork.record_id, {expected_revision: fork.revision, chosen: '拒绝', rationale: input.rationale});
      return {status: 'rejected', record_id: rejected.record_id, rationale: input.rationale, receipt: '拒绝理由已记入决策路径，后续 adapt 起草会把它作为避免方向'};
    }
    if (input.save_mode === undefined || input.content_file === undefined) throw new ProtocolError('INVALID_INPUT', 'save requires save_mode and content_file');
    if (record.kind !== 'prompt_capture_proposal') throw new ProtocolError('INVALID_INPUT', `record ${input.record_id} is ${record.kind}; MCP save currently supports prompt_capture_proposal candidates`);
    const content = fs.readFileSync(input.content_file, 'utf8');
    const result = runtime.capturePromptCase({
      proposal_ref: {record_id: record.record_id, revision: record.revision, kind: record.kind, schema_id: record.schema_id, schema_version: record.schema_version},
      approval: input.approval,
      selected_content: content,
      ...(input.title === undefined ? {} : {title: input.title}),
      producer,
      correlation_id: `dialogue-review:${context.project_dir}`,
      causation_id: `dialogue-review-capture:${input.record_id}`,
    });
    return {
      status: 'saved',
      capture_mode: result.capture_mode,
      source_snapshot: `${result.source_snapshot_ref.record_id}@${result.source_snapshot_ref.revision}`,
      receipt: '已保存为私有 source_snapshot；补充结果证据后才可走向 precedent 与能力验证',
    };
  });
}
