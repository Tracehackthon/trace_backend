import {buildActivationPack, type ActivationPack, type ContextSourceRef, type ContextReadPointer} from '../../../packages/core/context/src/index.js';
import type {CreateReceipt} from '../../../packages/core/continuity/src/index.js';
import type {TraceRuntime} from '../../../packages/core/runtime/src/index.js';
import {MyWikiSourceProvider, type MyWikiSourceProfile} from '../../../packages/integration/mywiki-source/src/index.js';
import type {TraceEvent} from '../../../packages/core/observability/src/index.js';
import {randomUUID} from 'node:crypto';

export interface CodexActivationInput {
  thread_id?: string;
  purpose: string;
  summary: string;
  source_refs: ContextSourceRef[];
  read_pointers?: ContextReadPointer[];
  forbidden_scopes?: string[];
  max_tokens?: number;
}

export interface CodexActivationResult {
  pack: ActivationPack;
  user_notice: string;
}

export interface CodexTurnStartedEvent extends CodexActivationInput {
  event_type: 'codex.turn.started';
  correlation_id?: string;
  causation_id?: string;
}

export interface CodexActivationWithReceipt extends CodexActivationResult {
  receipt: ReturnType<TraceRuntime['createReceipt']>;
  correlation_id: string;
  causation_id: string;
  trace_event?: TraceEvent;
}

function errorCode(error: unknown): string {
  const candidate = error as {code?: unknown};
  return typeof candidate?.code === 'string' && candidate.code.length > 0 ? candidate.code.slice(0, 120) : 'UNEXPECTED_ERROR';
}

function recordActivationEvent(runtime: TraceRuntime, input: Parameters<TraceRuntime['recordTraceEvent']>[0]): TraceEvent | undefined {
  // Trace observability must never turn an otherwise successful Codex turn
  // into a failed turn. The receipt still establishes the durable user-facing
  // state; doctor will surface a missing or unhealthy trace-event table.
  try { return runtime.recordTraceEvent(input); } catch { return undefined; }
}

/**
 * Codex remains the reasoning and file/tool host. This adapter only compiles
 * a bounded activation pack and produces a human-readable activation notice.
 */
export function buildCodexActivation(input: CodexActivationInput): CodexActivationResult {
  const pack = buildActivationPack({
    purpose: input.purpose,
    summary: input.summary,
    source_refs: input.source_refs,
    ...(input.thread_id === undefined ? {} : {thread_id: input.thread_id}),
    ...(input.read_pointers === undefined ? {} : {read_pointers: input.read_pointers}),
    ...(input.forbidden_scopes === undefined ? {} : {forbidden_scopes: input.forbidden_scopes}),
    budget: {max_tokens: input.max_tokens ?? 6000},
  });
  return {pack, user_notice: `本次 Codex 将使用 ${pack.source_refs.length} 个来源引用；Trace 不会因此自动写入认知源或发布能力。`};
}

export function buildCodexActivationReceipt(input: {thread_id: string; activated_refs: string[]; not_persisted?: string[]; next_prompts?: string[]}): CreateReceipt {
  return {
    thread_id: input.thread_id,
    receipt_kind: 'activation',
    summary: `本次 Codex 激活 ${input.activated_refs.length} 个来源/能力引用`,
    activated_refs: input.activated_refs,
    not_persisted: input.not_persisted ?? ['完整聊天转录', '未被用户采纳的候选'],
    next_prompts: input.next_prompts ?? ['显示本次实际激活内容', '继续验证当前主题'],
  };
}

/**
 * The real host integration seam: normalize one Codex turn event, compile a
 * bounded pack, and write only an activation receipt to Trace. Codex remains
 * responsible for reading files and reasoning; this adapter never injects raw
 * source text or publishes a capability.
 */
export function activateCodexTurn(runtime: TraceRuntime, event: CodexTurnStartedEvent): CodexActivationWithReceipt {
  if (event.event_type !== 'codex.turn.started') throw new Error('Unsupported Codex event');
  const threadId = event.thread_id ?? `codex-${event.purpose.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)}`;
  const correlationId = event.correlation_id ?? `codex-session:${threadId}`;
  const causationId = event.causation_id ?? `codex-turn:${randomUUID()}`;
  const startedAt = Date.now();
  try {
    runtime.createThread({thread_id: threadId, title: `Codex: ${event.purpose}`, current_summary: event.summary, next_action: 'Review the activation notice before reading sources', correlation_id: correlationId, causation_id: causationId});
    const activation = buildCodexActivation({...event, thread_id: threadId});
    const activatedRefs = activation.pack.source_refs.map(ref => `${ref.record_id}@${ref.revision}`);
    const receipt = runtime.createReceipt({...buildCodexActivationReceipt({thread_id: threadId, activated_refs: activatedRefs, next_prompts: ['显示本次实际激活的来源和读取指针', '讨论结束后决定是否形成候选沉淀']}), correlation_id: correlationId, causation_id: causationId});
    const traceEvent = recordActivationEvent(runtime, {component: 'codex-adapter', operation: 'activation', outcome: 'success', correlation_id: correlationId, causation_id: causationId, thread_id: threadId, record_refs: [
      `${receipt.record_id}@${receipt.revision}`,
      ...activatedRefs,
    ], duration_ms: Date.now() - startedAt});
    return {pack: activation.pack, user_notice: activation.user_notice, receipt, correlation_id: correlationId, causation_id: causationId, ...(traceEvent === undefined ? {} : {trace_event: traceEvent})};
  } catch (error) {
    recordActivationEvent(runtime, {component: 'codex-adapter', operation: 'activation', outcome: 'failure', correlation_id: correlationId, causation_id: causationId, thread_id: threadId, record_refs: [], duration_ms: Date.now() - startedAt, error_code: errorCode(error)});
    throw error;
  }
}

export interface CodexHookInput {hook_event_name?: string; session_id?: string; cwd?: string; prompt?: string; source?: string; [key: string]: unknown;}

/**
 * Stdio boundary for the real Codex hooks.json format. It never writes a
 * formal page or installs a Skill: it only exposes bounded read pointers and
 * the activation receipt. A user-selected MyWiKi profile can be supplied by
 * the host command; without one the event remains source-empty.
 */
export function buildCodexHookOutput(input: CodexHookInput, runtime: TraceRuntime, sourceProfile?: MyWikiSourceProfile): Record<string, unknown> {
  const eventName = input.hook_event_name;
  if (eventName !== 'SessionStart' && eventName !== 'UserPromptSubmit') return {};
  const sessionId = typeof input.session_id === 'string' && input.session_id.length > 0 ? input.session_id : `codex-hook-${Date.now()}`;
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const provider = sourceProfile === undefined ? undefined : new MyWikiSourceProvider(sourceProfile);
  const pages = provider === undefined || prompt.trim().length === 0 ? [] : provider.search(prompt, 8);
  const readPointers = pages.map(page => ({path: page.absolute_path, purpose: `读取正式认知源页面：${page.title}`, priority: 'should' as const, stop_condition: '只在当前问题需要时读取，并保留页面 revision/hash'}));
  // Codex already owns the raw prompt. Trace may use it transiently to locate
  // authorized read pointers, but must never turn it into a durable thread
  // summary, receipt, event, or hook response.
  const summary = eventName === 'SessionStart'
    ? 'Codex session activation; no raw prompt is persisted by Trace.'
    : 'Codex user prompt received; raw prompt is not persisted by Trace.';
  const event: CodexTurnStartedEvent = {event_type: 'codex.turn.started', thread_id: sessionId, purpose: eventName === 'SessionStart' ? 'Codex session activation' : 'Codex user prompt activation', summary, source_refs: [], read_pointers: readPointers, forbidden_scopes: ['raw/**', 'unscoped-user-data/**'], max_tokens: 6000};
  const activation = activateCodexTurn(runtime, event);
  const visible = {trace: 'activation', source_profile: sourceProfile?.source_id ?? null, pages_considered: pages.map(page => ({path: page.relative_path, title: page.title, revision: page.revision, content_hash: page.content_hash})), pack_id: activation.pack.pack_id, correlation_id: activation.correlation_id, trace_event_id: activation.trace_event?.event_id ?? null, user_notice: activation.user_notice};
  return {hookSpecificOutput: {hookEventName: eventName, additionalContext: JSON.stringify(visible)}};
}
