import {buildActivationPack, type ActivationPack, type ContextSourceRef, type ContextReadPointer} from '../../../packages/core/context/src/index.js';
import type {ActivatedPointer, CreateReceipt} from '../../../packages/core/continuity/src/index.js';
import type {TraceRuntime} from '../../../packages/core/runtime/src/index.js';
import fs from 'node:fs';
import path from 'node:path';
import {MyWikiSourceProvider, type MyWikiSourceProfile} from '../../../packages/integration/mywiki-source/src/index.js';
import {classifyNativeSourceAccess, type HostPageVersion, type HostRetrievalPolicy} from '../../../packages/core/retrieval-evidence/src/index.js';
import type {TraceEvent} from '../../../packages/core/observability/src/index.js';
import {randomUUID} from 'node:crypto';

export interface CodexActivationInput {
  thread_id?: string;
  purpose: string;
  summary: string;
  source_refs: ContextSourceRef[];
  read_pointers?: ContextReadPointer[];
  /** Pointer identities kept in the durable receipt without paths or source text. */
  activated_pointers?: ActivatedPointer[];
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

function activationNotice(sourceRefCount: number, pointerCount: number): string {
  return `本次 Codex 激活 ${sourceRefCount} 个持久化来源/能力引用与 ${pointerCount} 个受控读取指针；Trace 不会因此自动写入认知源或发布能力。`;
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
  return {pack, user_notice: activationNotice(pack.source_refs.length, pack.read_pointers.length)};
}

export function buildCodexActivationReceipt(input: {thread_id: string; activated_refs: string[]; activated_pointers?: ActivatedPointer[]; not_persisted?: string[]; next_prompts?: string[]}): CreateReceipt {
  const pointers = input.activated_pointers ?? [];
  return {
    thread_id: input.thread_id,
    receipt_kind: 'activation',
    summary: `本次 Codex 激活 ${input.activated_refs.length} 个持久化来源/能力引用与 ${pointers.length} 个读取指针`,
    activated_refs: input.activated_refs,
    ...(pointers.length === 0 ? {} : {activated_pointers: pointers}),
    not_persisted: input.not_persisted ?? ['完整聊天转录', '未被用户采纳的候选', '外部来源正文'],
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
    const activatedPointers = event.activated_pointers ?? [];
    const receipt = runtime.createReceipt({...buildCodexActivationReceipt({thread_id: threadId, activated_refs: activatedRefs, activated_pointers: activatedPointers, next_prompts: ['显示本次实际激活的来源和读取指针', '讨论结束后决定是否形成候选沉淀']}), correlation_id: correlationId, causation_id: causationId});
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

export interface CodexHookInput {
  hook_event_name?: string;
  session_id?: string;
  turn_id?: string;
  cwd?: string;
  prompt?: string;
  source?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  [key: string]: unknown;
}

type SourceAvailability = 'unconfigured' | 'disabled' | 'available' | 'unavailable';

interface HostNativeSourceAccess {
  source_id: string;
  mode: 'native_observed';
  /** Absolute paths exist only in this hook response for the live Codex host. */
  allowed_roots: string[];
  allowed_prefixes: string[];
  max_reads_per_turn: number;
  evidence_contract: 'trace.host-retrieval-evidence@0.1.0';
  boundary: 'observed-and-budgeted-not-filesystem-sandbox';
}

interface ResolvedSourceAccess {
  provider: MyWikiSourceProvider;
  policy: HostRetrievalPolicy;
  source_access: HostNativeSourceAccess;
}

function sourceScope(profile: MyWikiSourceProfile): {type: 'personal' | 'project' | 'team' | 'domain'; id: string} {
  const type = profile.scope_type ?? 'personal';
  return {type, id: profile.user_id};
}

function sourceAvailability(sourceProfile: MyWikiSourceProfile | undefined): {status: SourceAvailability; resolved?: ResolvedSourceAccess} {
  if (sourceProfile === undefined) return {status: 'unconfigured'};
  if (sourceProfile.read_enabled === false) return {status: 'disabled'};
  try {
    const provider = new MyWikiSourceProvider(sourceProfile);
    const policy = provider.profile.host_retrieval;
    if (policy.mode === 'disabled') return {status: 'disabled'};
    const allowedRoots = policy.allowed_prefixes.map(prefix => path.resolve(provider.profile.root, prefix));
    // Do not offer an unavailable directory to Codex: it would turn a source
    // configuration mistake into speculative host work.
    if (allowedRoots.some(root => !fs.existsSync(root) || !fs.statSync(root).isDirectory())) return {status: 'unavailable'};
    return {
      status: 'available',
      resolved: {
        provider,
        policy,
        source_access: {
          source_id: provider.profile.source_id,
          mode: 'native_observed',
          allowed_roots: allowedRoots,
          allowed_prefixes: policy.allowed_prefixes,
          max_reads_per_turn: policy.max_reads_per_turn,
          evidence_contract: 'trace.host-retrieval-evidence@0.1.0',
          boundary: 'observed-and-budgeted-not-filesystem-sandbox',
        },
      },
    };
  } catch { return {status: 'unavailable'}; }
}

function hookThreadId(input: CodexHookInput): string {
  return typeof input.session_id === 'string' && input.session_id.length > 0 ? input.session_id : `codex-hook-${Date.now()}`;
}
function hookTurnId(input: CodexHookInput): string | undefined {
  return typeof input.turn_id === 'string' && input.turn_id.length > 0 ? input.turn_id : undefined;
}
function hookToolName(input: CodexHookInput): string | undefined {
  return typeof input.tool_name === 'string' && input.tool_name.length > 0 ? input.tool_name : undefined;
}
function hookToolUseId(input: CodexHookInput): string | undefined {
  return typeof input.tool_use_id === 'string' && input.tool_use_id.length > 0 ? input.tool_use_id : undefined;
}

function hostAccessDeveloperContext(source: HostNativeSourceAccess): string {
  return [
    'Trace cognitive source access is available for this turn.',
    'Use Codex native file/search tools—not a Trace preselected-page list—only when this source is relevant.',
    `Allowed formal roots: ${source.allowed_roots.join(', ')}`,
    `Read budget: at most ${source.max_reads_per_turn} formal Markdown files in this turn.`,
    'Treat results as evidence: distinguish searched from read; do not claim an unread page as a source.',
    'Trace will retain only access evidence (source id, safe relative locator, revision/hash, and input/output hashes). It will not retain the prompt, source body, raw tool arguments, output, or absolute source root.',
    'This native-host path is observed and budgeted, not a filesystem sandbox. Do not use it for source material requiring a hard per-file access boundary.',
  ].join('\n');
}

function recordHostEvidence(runtime: TraceRuntime, input: Parameters<TraceRuntime['recordHostRetrievalEvidence']>[0]) {
  try { return runtime.recordHostRetrievalEvidence(input); } catch { return undefined; }
}

function recordHostEvidenceEvent(runtime: TraceRuntime, input: Parameters<TraceRuntime['recordTraceEvent']>[0]): void {
  recordActivationEvent(runtime, input);
}

function buildSourceOffer(runtime: TraceRuntime, source: ResolvedSourceAccess, sessionId: string, turnId: string | undefined, correlationId: string, causationId: string): void {
  const evidence = recordHostEvidence(runtime, {
    event_kind: 'source_access_offered',
    source_id: source.provider.profile.source_id,
    source_scope: sourceScope(source.provider.profile),
    policy: source.policy,
    host: 'codex',
    host_session_id: sessionId,
    ...(turnId === undefined ? {} : {host_turn_id: turnId}),
    causation_id: causationId,
    correlation_id: correlationId,
    producer: {component: 'trace.codex-adapter', version: '0.3.0', run_id: `codex:${sessionId}`},
  });
  if (evidence !== undefined) recordHostEvidenceEvent(runtime, {
    component: 'codex-adapter', operation: 'source-access-offered', outcome: 'success', correlation_id: correlationId,
    causation_id: causationId, thread_id: sessionId, record_refs: [`${evidence.record_id}@${evidence.revision}`],
  });
}

function buildSourceActivationHookOutput(input: CodexHookInput, runtime: TraceRuntime, sourceProfile: MyWikiSourceProfile | undefined): Record<string, unknown> {
  const eventName = input.hook_event_name;
  if (eventName !== 'SessionStart' && eventName !== 'UserPromptSubmit') return {};
  const sessionId = hookThreadId(input);
  const turnId = hookTurnId(input);
  const source = sourceAvailability(sourceProfile);
  const summary = eventName === 'SessionStart'
    ? 'Codex session activation; Trace did not persist raw prompt or source body.'
    : 'Codex user prompt received; Trace did not persist raw prompt or source body.';
  const activation = activateCodexTurn(runtime, {
    event_type: 'codex.turn.started',
    thread_id: sessionId,
    purpose: eventName === 'SessionStart' ? 'Codex session activation' : 'Codex user prompt activation',
    summary,
    source_refs: [],
    read_pointers: [],
    forbidden_scopes: ['raw/**', 'unscoped-user-data/**'],
    max_tokens: 6000,
  });
  if (source.resolved !== undefined) buildSourceOffer(runtime, source.resolved, sessionId, turnId, activation.correlation_id, `codex-source-offer:${turnId ?? randomUUID()}`);
  const visible = {
    trace: 'activation',
    activation_mode: 'host_native_evidence',
    source_profile: typeof sourceProfile?.source_id === 'string' ? sourceProfile.source_id : null,
    source_status: source.status,
    ...(source.resolved === undefined ? {} : {source_access: source.resolved.source_access}),
    activation_receipt: {
      receipt_id: activation.receipt.record_id,
      activated_refs: activation.receipt.payload.activated_refs ?? [],
      activated_pointers: activation.receipt.payload.activated_pointers ?? [],
      not_persisted: activation.receipt.payload.not_persisted ?? [],
    },
    pack_id: activation.pack.pack_id,
    correlation_id: activation.correlation_id,
    trace_event_id: activation.trace_event?.event_id ?? null,
    user_notice: source.resolved === undefined
      ? activation.user_notice
      : 'Trace 已提供受控的宿主原生认知源访问；Codex 自己检索和读取，Trace 只记录实际访问证据。',
  };
  return {hookSpecificOutput: {hookEventName: eventName, additionalContext: JSON.stringify(visible) + (source.resolved === undefined ? '' : `\n${hostAccessDeveloperContext(source.resolved.source_access)}`)}};
}

function readVersions(provider: MyWikiSourceProvider, locators: string[]): HostPageVersion[] | undefined {
  try {
    const versions = locators.map(locator => {
      const page = provider.readPage(locator);
      return {locator: page.relative_path, revision: page.revision, content_hash: page.content_hash};
    });
    return versions.length === locators.length ? versions : undefined;
  } catch { return undefined; }
}

/**
 * A single native command can read several Markdown files. Budget the actual
 * page locators, not merely the number of PostToolUse events, so batching
 * `Get-Content a.md, b.md` cannot bypass a per-turn page-read limit.
 */
function currentReadCount(runtime: TraceRuntime, sourceId: string, sessionId: string, turnId: string | undefined): number {
  if (turnId === undefined) return 0;
  return runtime.listData('host_retrieval_evidence')
    .filter(record =>
      record.payload.event_kind === 'source_read'
      && record.payload.source_id === sourceId
      && record.payload.host_session_id === sessionId
      && record.payload.host_turn_id === turnId,
    )
    .reduce((total, record) => total + (Array.isArray(record.payload.locators) ? record.payload.locators.length : 0), 0);
}

function buildPreToolHookOutput(input: CodexHookInput, runtime: TraceRuntime, sourceProfile: MyWikiSourceProfile | undefined): Record<string, unknown> {
  if (input.hook_event_name !== 'PreToolUse') return {};
  const source = sourceAvailability(sourceProfile);
  const sessionId = hookThreadId(input);
  const turnId = hookTurnId(input);
  const toolName = hookToolName(input);
  const toolUseId = hookToolUseId(input);
  if (source.resolved === undefined || toolName === undefined) return {};
  const classified = classifyNativeSourceAccess({host: 'codex', host_session_id: sessionId, ...(turnId === undefined ? {} : {host_turn_id: turnId}), host_tool_name: toolName, ...(toolUseId === undefined ? {} : {host_tool_use_id: toolUseId}), tool_input: input.tool_input}, {root: source.resolved.provider.profile.root, formal_prefix: source.resolved.provider.profile.formal_prefix, policy: source.resolved.policy});
  if (classified?.event_kind !== 'source_read') return {};
  const used = currentReadCount(runtime, source.resolved.provider.profile.source_id, sessionId, turnId);
  const requested = classified.locators.length;
  if (used + requested <= source.resolved.policy.max_reads_per_turn) return {};
  return {hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: `Trace native source read budget (${source.resolved.policy.max_reads_per_turn} pages per turn) would be exceeded by this ${requested}-page read after ${used} recorded pages. Continue from evidence already read or start a new turn.`,
  }};
}

function buildPostToolHookOutput(input: CodexHookInput, runtime: TraceRuntime, sourceProfile: MyWikiSourceProfile | undefined): Record<string, unknown> {
  if (input.hook_event_name !== 'PostToolUse') return {};
  const source = sourceAvailability(sourceProfile);
  const sessionId = hookThreadId(input);
  const turnId = hookTurnId(input);
  const toolName = hookToolName(input);
  if (source.resolved === undefined || toolName === undefined) return {};
  const toolUseId = hookToolUseId(input);
  const classified = classifyNativeSourceAccess({
    host: 'codex', host_session_id: sessionId, ...(turnId === undefined ? {} : {host_turn_id: turnId}), host_tool_name: toolName,
    ...(toolUseId === undefined ? {} : {host_tool_use_id: toolUseId}), tool_input: input.tool_input, ...(input.tool_response === undefined ? {} : {tool_response: input.tool_response}),
  }, {root: source.resolved.provider.profile.root, formal_prefix: source.resolved.provider.profile.formal_prefix, policy: source.resolved.policy});
  if (classified === undefined) return {};
  const versions = classified.event_kind === 'source_read' ? readVersions(source.resolved.provider, classified.locators) : [];
  const eventKind = classified.event_kind === 'source_read' && versions === undefined ? 'source_access_unclassified' : classified.event_kind;
  const evidence = recordHostEvidence(runtime, {
    event_kind: eventKind,
    source_id: source.resolved.provider.profile.source_id,
    source_scope: sourceScope(source.resolved.provider.profile),
    policy: source.resolved.policy,
    host: 'codex', host_session_id: sessionId,
    ...(turnId === undefined ? {} : {host_turn_id: turnId}),
    host_tool_name: toolName,
    ...(toolUseId === undefined ? {} : {host_tool_use_id: toolUseId}),
    input_hash: classified.input_hash,
    ...(classified.output_hash === undefined ? {} : {output_hash: classified.output_hash}),
    ...(eventKind === 'source_read' ? {locators: classified.locators, page_versions: versions!} : {locators: []}),
    causation_id: `codex-tool:${toolUseId ?? randomUUID()}`,
    correlation_id: `codex-session:${sessionId}`,
    producer: {component: 'trace.codex-adapter', version: '0.3.0', run_id: `codex:${sessionId}`},
  });
  if (evidence !== undefined) recordHostEvidenceEvent(runtime, {
    component: 'codex-adapter', operation: `host-${eventKind}`, outcome: 'success', correlation_id: `codex-session:${sessionId}`,
    causation_id: `codex-tool:${toolUseId ?? 'unknown'}`, thread_id: sessionId, record_refs: [`${evidence.record_id}@${evidence.revision}`],
  });
  // PostToolUse output is intentionally empty: the native tool result remains
  // under Codex control; Trace only contributes durable provenance for status.
  return {};
}

/**
 * Real Codex hook boundary. Trace does not perform semantic retrieval here.
 * It offers a bounded source lease to Codex, then observes the host's actual
 * native search/read calls without persisting prompt/source/tool bodies.
 */
export function buildCodexHookOutput(input: CodexHookInput, runtime: TraceRuntime, sourceProfile?: MyWikiSourceProfile): Record<string, unknown> {
  if (input.hook_event_name === 'SessionStart' || input.hook_event_name === 'UserPromptSubmit') return buildSourceActivationHookOutput(input, runtime, sourceProfile);
  if (input.hook_event_name === 'PreToolUse') return buildPreToolHookOutput(input, runtime, sourceProfile);
  if (input.hook_event_name === 'PostToolUse') return buildPostToolHookOutput(input, runtime, sourceProfile);
  return {};
}
