import {createHash} from 'node:crypto';
import {optionalStringList as stringList, ProtocolError, ProtocolVersionRegistry, rejectUnknown, requireObject as object, requireText as text, type ProtocolVersioned} from '../../protocol/src/index.js';
import type {VersionedStore} from '../../storage/src/index.js';

export const CONTINUITY_PROTOCOL_ID = 'trace.continuity' as const;
export const CONTINUITY_PROTOCOL_VERSION = '0.2.0' as const;
export const CONTINUITY_KINDS = ['thread', 'discussion_turn', 'persistence_receipt', 'activation_receipt'] as const;
export type ContinuityKind = (typeof CONTINUITY_KINDS)[number];
export type ThreadStatus = 'open' | 'watching' | 'resolved' | 'published' | 'superseded';
export type DeltaType = 'none' | 'new_candidate' | 'revision' | 'adoption' | 'rejection' | 'publication';
export type VisibilityMode = 'summary' | 'evidence' | 'audit';

export interface ContinuityEnvelope {
  protocol_id: typeof CONTINUITY_PROTOCOL_ID;
  protocol_version: typeof CONTINUITY_PROTOCOL_VERSION;
  record_id: string;
  revision: number;
  kind: ContinuityKind;
  thread_id: string;
  correlation_id: string;
  causation_id: string;
  visibility: VisibilityMode;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  record_id_key?: string;
}

export interface CreateThread {
  thread_id?: string;
  title: string;
  status?: ThreadStatus;
  current_summary: string;
  candidate_refs?: string[];
  adopted_refs?: string[];
  open_questions?: string[];
  next_action?: string;
  correlation_id?: string;
  causation_id?: string;
}

export interface UpdateThread {
  expected_revision: number;
  status?: ThreadStatus;
  current_summary?: string;
  candidate_refs?: string[];
  adopted_refs?: string[];
  open_questions?: string[];
  next_action?: string;
}

export interface CreateDiscussionTurn {
  thread_id: string;
  user_input_summary: string;
  output_summary: string;
  delta_type: DeltaType;
  context_refs?: string[];
  persisted_refs?: string[];
  open_questions?: string[];
  correlation_id?: string;
  causation_id?: string;
}

export interface CreateReceipt {
  thread_id: string;
  receipt_kind: 'persistence' | 'activation';
  summary: string;
  persisted_refs?: string[];
  not_persisted?: string[];
  activated_refs?: string[];
  required_user_action?: string;
  next_prompts?: string[];
  correlation_id?: string;
  causation_id?: string;
}

const THREAD_STATUSES: readonly ThreadStatus[] = ['open', 'watching', 'resolved', 'published', 'superseded'];
const DELTA_TYPES: readonly DeltaType[] = ['none', 'new_candidate', 'revision', 'adoption', 'rejection', 'publication'];

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20);
}

function timestamp(): string { return new Date().toISOString(); }

type AnyContinuityProtocol = ProtocolVersioned & Record<string, unknown>;

const continuityUpcasters = new ProtocolVersionRegistry<AnyContinuityProtocol>();
continuityUpcasters.register({
  protocol_id: CONTINUITY_PROTOCOL_ID,
  from_version: '0.1.0',
  to_version: CONTINUITY_PROTOCOL_VERSION,
  upcast(value) {
    const recordId = typeof value.record_id === 'string' ? value.record_id : 'unknown';
    const revision = Number.isInteger(value.revision) ? String(value.revision) : 'unknown';
    return {
      ...value,
      protocol_version: CONTINUITY_PROTOCOL_VERSION,
      correlation_id: `legacy-continuity:${recordId}`,
      causation_id: `legacy-continuity:${recordId}@${revision}`,
    };
  },
});

function lineageFor(kind: ContinuityKind, threadId: string, payload: Record<string, unknown>, input: {correlation_id?: string; causation_id?: string}): {correlation_id: string; causation_id: string} {
  const correlationId = input.correlation_id === undefined ? `continuity-thread:${threadId}` : text(input.correlation_id, 'correlation_id', 240);
  const causationId = input.causation_id === undefined ? `continuity-${kind}:${digest({threadId, payload})}` : text(input.causation_id, 'causation_id', 240);
  return {correlation_id: correlationId, causation_id: causationId};
}

function buildEnvelope(kind: ContinuityKind, threadId: string, payload: Record<string, unknown>, recordId: string | undefined, lineage: {correlation_id?: string; causation_id?: string}): ContinuityEnvelope {
  const now = timestamp();
  const identity = recordId ?? `continuity-${kind}-${digest({threadId, payload})}`;
  const trace = lineageFor(kind, threadId, payload, lineage);
  return validateContinuityEnvelope({
    protocol_id: CONTINUITY_PROTOCOL_ID,
    protocol_version: CONTINUITY_PROTOCOL_VERSION,
    record_id: identity,
    revision: 1,
    kind,
    thread_id: threadId,
    correlation_id: trace.correlation_id,
    causation_id: trace.causation_id,
    visibility: 'summary',
    payload,
    created_at: now,
    updated_at: now,
  });
}

export function validateContinuityEnvelope(value: unknown): ContinuityEnvelope {
  const raw = object(value, 'continuity_envelope');
  if (raw.protocol_id !== CONTINUITY_PROTOCOL_ID) throw new ProtocolError('PROTOCOL_MISMATCH', 'Unsupported continuity protocol');
  const item = raw.protocol_version === '0.1.0'
    ? continuityUpcasters.upgrade(raw as AnyContinuityProtocol, CONTINUITY_PROTOCOL_VERSION) as Record<string, unknown>
    : raw;
  rejectUnknown(item, ['protocol_id', 'protocol_version', 'record_id', 'revision', 'kind', 'thread_id', 'correlation_id', 'causation_id', 'visibility', 'payload', 'created_at', 'updated_at'], 'continuity_envelope');
  if (item.protocol_version !== CONTINUITY_PROTOCOL_VERSION) throw new ProtocolError('PROTOCOL_MIGRATION_REQUIRED', `Unsupported continuity protocol version: ${String(item.protocol_version)}`);
  if (!Number.isInteger(item.revision) || Number(item.revision) < 1) throw new ProtocolError('INVALID_FIELD', 'continuity revision must be positive');
  if (!CONTINUITY_KINDS.includes(item.kind as ContinuityKind)) throw new ProtocolError('INVALID_FIELD', 'continuity kind is not supported');
  if (item.visibility !== 'summary' && item.visibility !== 'evidence' && item.visibility !== 'audit') throw new ProtocolError('INVALID_FIELD', 'visibility is not supported');
  const payload = object(item.payload, 'payload');
  const kind = item.kind as ContinuityKind;
  const allowed: Record<ContinuityKind, readonly string[]> = {
    thread: ['title', 'status', 'current_summary', 'candidate_refs', 'adopted_refs', 'open_questions', 'next_action'],
    discussion_turn: ['user_input_summary', 'output_summary', 'delta_type', 'context_refs', 'persisted_refs', 'open_questions'],
    persistence_receipt: ['summary', 'persisted_refs', 'not_persisted', 'required_user_action', 'next_prompts'],
    activation_receipt: ['summary', 'activated_refs', 'not_persisted', 'required_user_action', 'next_prompts'],
  };
  rejectUnknown(payload, allowed[kind], `${kind}.payload`);
  if (kind === 'thread') {
    if (!THREAD_STATUSES.includes(payload.status as ThreadStatus)) throw new ProtocolError('INVALID_FIELD', 'thread.status is not supported');
    text(payload.title, 'thread.title', 300); text(payload.current_summary, 'thread.current_summary');
    stringList(payload.candidate_refs, 'thread.candidate_refs'); stringList(payload.adopted_refs, 'thread.adopted_refs'); stringList(payload.open_questions, 'thread.open_questions');
    if (payload.next_action !== undefined) text(payload.next_action, 'thread.next_action', 1000);
  } else if (kind === 'discussion_turn') {
    text(payload.user_input_summary, 'discussion_turn.user_input_summary'); text(payload.output_summary, 'discussion_turn.output_summary');
    if (!DELTA_TYPES.includes(payload.delta_type as DeltaType)) throw new ProtocolError('INVALID_FIELD', 'discussion_turn.delta_type is not supported');
    stringList(payload.context_refs, 'discussion_turn.context_refs'); stringList(payload.persisted_refs, 'discussion_turn.persisted_refs'); stringList(payload.open_questions, 'discussion_turn.open_questions');
  } else {
    text(payload.summary, `${kind}.summary`); stringList(payload.persisted_refs, `${kind}.persisted_refs`); stringList(payload.activated_refs, `${kind}.activated_refs`); stringList(payload.not_persisted, `${kind}.not_persisted`); stringList(payload.next_prompts, `${kind}.next_prompts`);
    if (payload.required_user_action !== undefined) text(payload.required_user_action, `${kind}.required_user_action`, 1000);
  }
  return {
    protocol_id: CONTINUITY_PROTOCOL_ID,
    protocol_version: CONTINUITY_PROTOCOL_VERSION,
    record_id: text(item.record_id, 'record_id', 240),
    revision: Number(item.revision),
    kind,
    thread_id: text(item.thread_id, 'thread_id', 240),
    correlation_id: text(item.correlation_id, 'correlation_id', 240),
    causation_id: text(item.causation_id, 'causation_id', 240),
    visibility: item.visibility as VisibilityMode,
    payload,
    created_at: text(item.created_at, 'created_at', 80),
    updated_at: text(item.updated_at, 'updated_at', 80),
  };
}

export class ContinuityLedger {
  constructor(readonly store: VersionedStore<ContinuityEnvelope>) {}

  private latest(): ContinuityEnvelope[] { return this.store.latest().map(value => validateContinuityEnvelope(value)); }

  createThread(input: CreateThread): ContinuityEnvelope {
    const title = text(input.title, 'title', 300);
    const threadId = input.thread_id ?? `thread-${digest({title, summary: input.current_summary})}`;
    const record = buildEnvelope('thread', threadId, {
      title,
      status: input.status ?? 'open',
      current_summary: text(input.current_summary, 'current_summary'),
      candidate_refs: stringList(input.candidate_refs, 'candidate_refs'),
      adopted_refs: stringList(input.adopted_refs, 'adopted_refs'),
      open_questions: stringList(input.open_questions, 'open_questions'),
      ...(input.next_action === undefined ? {} : {next_action: text(input.next_action, 'next_action', 1000)}),
    }, threadId, input);
    return validateContinuityEnvelope(this.store.appendIfAbsent(record).record);
  }

  getThread(threadId: string): ContinuityEnvelope {
    const raw = this.store.read(threadId);
    const found = raw === undefined ? undefined : validateContinuityEnvelope(raw);
    if (found?.kind !== 'thread' || found.thread_id !== threadId) throw new ProtocolError('NOT_FOUND', `Unknown continuity thread: ${threadId}`);
    return found;
  }

  updateThread(threadId: string, input: UpdateThread): ContinuityEnvelope {
    const next = this.store.compareAndSwap(threadId, input.expected_revision, current => {
      const currentRecord = validateContinuityEnvelope(current);
      if (currentRecord.kind !== 'thread') throw new ProtocolError('INVALID_FIELD', `${threadId} is not a thread`);
      const payload = currentRecord.payload;
      const updated: ContinuityEnvelope = {
        ...currentRecord,
        revision: currentRecord.revision + 1,
        updated_at: timestamp(),
        payload: {
          ...payload,
          ...(input.status === undefined ? {} : {status: input.status}),
          ...(input.current_summary === undefined ? {} : {current_summary: text(input.current_summary, 'current_summary')}),
          ...(input.candidate_refs === undefined ? {} : {candidate_refs: stringList(input.candidate_refs, 'candidate_refs')}),
          ...(input.adopted_refs === undefined ? {} : {adopted_refs: stringList(input.adopted_refs, 'adopted_refs')}),
          ...(input.open_questions === undefined ? {} : {open_questions: stringList(input.open_questions, 'open_questions')}),
          ...(input.next_action === undefined ? {} : {next_action: text(input.next_action, 'next_action', 1000)}),
        },
      };
      return validateContinuityEnvelope(updated);
    });
    return validateContinuityEnvelope(next);
  }

  appendTurn(input: CreateDiscussionTurn): ContinuityEnvelope {
    this.getThread(input.thread_id);
    const record = buildEnvelope('discussion_turn', input.thread_id, {
      user_input_summary: text(input.user_input_summary, 'user_input_summary'),
      output_summary: text(input.output_summary, 'output_summary'),
      delta_type: input.delta_type,
      context_refs: stringList(input.context_refs, 'context_refs'),
      persisted_refs: stringList(input.persisted_refs, 'persisted_refs'),
      open_questions: stringList(input.open_questions, 'open_questions'),
    }, undefined, input);
    return validateContinuityEnvelope(this.store.appendIfAbsent(record).record);
  }

  createReceipt(input: CreateReceipt): ContinuityEnvelope {
    this.getThread(input.thread_id);
    if (input.receipt_kind !== 'persistence' && input.receipt_kind !== 'activation') throw new ProtocolError('INVALID_FIELD', 'receipt_kind must be persistence or activation');
    const kind: ContinuityKind = input.receipt_kind === 'persistence' ? 'persistence_receipt' : 'activation_receipt';
    const record = buildEnvelope(kind, input.thread_id, {
      summary: text(input.summary, 'summary'),
      ...(input.persisted_refs === undefined ? {} : {persisted_refs: stringList(input.persisted_refs, 'persisted_refs')}),
      ...(input.activated_refs === undefined ? {} : {activated_refs: stringList(input.activated_refs, 'activated_refs')}),
      ...(input.not_persisted === undefined ? {} : {not_persisted: stringList(input.not_persisted, 'not_persisted')}),
      ...(input.required_user_action === undefined ? {} : {required_user_action: text(input.required_user_action, 'required_user_action', 1000)}),
      ...(input.next_prompts === undefined ? {} : {next_prompts: stringList(input.next_prompts, 'next_prompts')}),
    }, undefined, input);
    return validateContinuityEnvelope(this.store.appendIfAbsent(record).record);
  }

  list(threadId?: string): ContinuityEnvelope[] {
    return this.latest().filter(item => threadId === undefined || item.thread_id === threadId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
}
