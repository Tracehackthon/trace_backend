import {createHash} from 'node:crypto';
import {DataLedger, type DataClassification, type DataEnvelope, type DataOrigin, type DataProducer} from '../../data/src/index.js';
import {buildCandidatePrecedentRecord} from '../../precedent/src/index.js';
import {ProtocolError, requireObject, requireText, type RecordRef, validateRecordRef} from '../../protocol/src/index.js';

export const PROMPT_CAPTURE_PROTOCOL_ID = 'trace.prompt-case-capture' as const;
export const PROMPT_CAPTURE_PROTOCOL_VERSION = '0.1.0' as const;
export const PROMPT_CASE_SOURCE_SCHEMA_ID = 'trace.prompt-case-source' as const;
export const PROMPT_CASE_SOURCE_SCHEMA_VERSION = '0.1.0' as const;

export type PromptCaptureMode = 'summary' | 'redacted_excerpt' | 'full_private';
export const PROMPT_CAPTURE_MODES: readonly PromptCaptureMode[] = ['summary', 'redacted_excerpt', 'full_private'];

export interface PromptCaptureProposal {
  proposal_ref: RecordRef;
  proposal_id: string;
  prompt_hash: string;
  capture_mode: PromptCaptureMode;
  intent_summary: string;
  rationale: string;
  thread_id?: string;
  redacted_preview?: string;
  status: 'candidate' | 'adopted' | 'rejected';
  created_at: string;
}

export interface CreatePromptCaptureProposal {
  proposal_id?: string;
  /** SHA-256 of a transient prompt. Prompt bytes are intentionally not accepted here. */
  prompt_hash: string;
  capture_mode: PromptCaptureMode;
  intent_summary: string;
  rationale: string;
  thread_id?: string;
  /** Optional user-authored preview; it must already be redacted. */
  redacted_preview?: string;
  scope: {type: 'personal' | 'project' | 'team' | 'domain'; id: string};
  producer: DataProducer;
  correlation_id: string;
  causation_id: string;
}

export interface CapturePromptCase {
  proposal_ref: RecordRef;
  approval: string;
  /**
   * The selected summary, redacted excerpt, or explicitly chosen full private
   * prompt. It is supplied only at the approval boundary, never retained from
   * proposal time.
   */
  selected_content: string;
  title?: string;
  classification?: DataClassification;
  producer: DataProducer;
  correlation_id: string;
  causation_id: string;
}

export interface PromptCaseCaptureResult {
  proposal: PromptCaptureProposal;
  source_snapshot_ref: RecordRef;
  capture_mode: PromptCaptureMode;
  classification: DataClassification;
}

export interface CreatePromptCasePrecedent {
  candidate_id: string;
  prompt_source_ref: RecordRef;
  outcome_refs: RecordRef[];
  claim: string;
  rationale: string;
  scope: {type: 'personal' | 'project' | 'team' | 'domain'; id: string};
  origin: DataOrigin;
  producer: DataProducer;
  classification: DataClassification;
  causation_id: string;
  correlation_id: string;
  change_id: string;
}

function recordRef(value: DataEnvelope): RecordRef {
  return {record_id: value.record_id, revision: value.revision, kind: value.kind, schema_id: value.schema_id, schema_version: value.schema_version};
}

function refText(value: RecordRef): string { return `${value.record_id}@${value.revision}`; }
function now(): string { return new Date().toISOString(); }
function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }

/** Allows clients to hash a raw prompt while it is still transient. */
export function hashTransientPrompt(prompt: string): string {
  return hash(requireText(prompt, 'prompt', 4 * 1024 * 1024));
}

function captureMode(value: unknown): PromptCaptureMode {
  if (!PROMPT_CAPTURE_MODES.includes(value as PromptCaptureMode)) throw new ProtocolError('INVALID_PROMPT_CAPTURE', 'capture_mode must be summary, redacted_excerpt, or full_private');
  return value as PromptCaptureMode;
}

function promptHash(value: unknown): string {
  const normalized = requireText(value, 'prompt_hash', 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new ProtocolError('INVALID_PROMPT_CAPTURE', 'prompt_hash must be a sha256 hex digest');
  return normalized;
}

function proposalId(value: unknown): string { return requireText(value, 'proposal_id', 240); }

function proposalPayload(value: unknown): {
  proposal_id: string; prompt_hash: string; capture_mode: PromptCaptureMode; intent_summary: string; rationale: string; thread_id?: string; redacted_preview?: string; captured_source_ref?: string;
} {
  const item = requireObject(value, 'prompt_capture_proposal.payload');
  const allowed = ['proposal_id', 'prompt_hash', 'capture_mode', 'intent_summary', 'rationale', 'thread_id', 'redacted_preview', 'captured_source_ref'];
  const unknown = Object.keys(item).filter(key => !allowed.includes(key));
  if (unknown.length > 0) throw new ProtocolError('INVALID_PROMPT_CAPTURE', `prompt capture proposal has unsupported fields: ${unknown.join(', ')}`);
  const mode = captureMode(item.capture_mode);
  if (mode === 'redacted_excerpt' && item.redacted_preview !== undefined) requireText(item.redacted_preview, 'redacted_preview', 2000);
  if (mode !== 'redacted_excerpt' && item.redacted_preview !== undefined) throw new ProtocolError('INVALID_PROMPT_CAPTURE', 'redacted_preview is valid only for redacted_excerpt proposals');
  return {
    proposal_id: proposalId(item.proposal_id),
    prompt_hash: promptHash(item.prompt_hash),
    capture_mode: mode,
    intent_summary: requireText(item.intent_summary, 'intent_summary', 4000),
    rationale: requireText(item.rationale, 'rationale', 4000),
    ...(item.thread_id === undefined ? {} : {thread_id: requireText(item.thread_id, 'thread_id', 240)}),
    ...(item.redacted_preview === undefined ? {} : {redacted_preview: requireText(item.redacted_preview, 'redacted_preview', 2000)}),
    ...(item.captured_source_ref === undefined ? {} : {captured_source_ref: requireText(item.captured_source_ref, 'captured_source_ref', 600)}),
  };
}

function proposalView(record: DataEnvelope): PromptCaptureProposal {
  if (record.kind !== 'prompt_capture_proposal' || record.schema_id !== PROMPT_CAPTURE_PROTOCOL_ID || record.schema_version !== PROMPT_CAPTURE_PROTOCOL_VERSION) throw new ProtocolError('INVALID_PROMPT_CAPTURE', 'record is not a Trace prompt capture proposal');
  const payload = proposalPayload(record.payload);
  if (record.status !== 'candidate' && record.status !== 'adopted' && record.status !== 'rejected') throw new ProtocolError('INVALID_PROMPT_CAPTURE', 'prompt capture proposal has an invalid data status');
  return {
    proposal_ref: recordRef(record), proposal_id: payload.proposal_id, prompt_hash: payload.prompt_hash, capture_mode: payload.capture_mode,
    intent_summary: payload.intent_summary, rationale: payload.rationale, ...(payload.thread_id === undefined ? {} : {thread_id: payload.thread_id}),
    ...(payload.redacted_preview === undefined ? {} : {redacted_preview: payload.redacted_preview}), status: record.status, created_at: record.created_at,
  };
}

function requireApproval(value: string, proposalRef: RecordRef): void {
  if (value !== `approve:${proposalRef.record_id}`) throw new ProtocolError('USER_CONFIRMATION_REQUIRED', `prompt case capture requires approval=approve:${proposalRef.record_id}`);
}

/**
 * Explicit prompt-case ledger. It stores only a hash plus user-authored
 * metadata at proposal time. Bytes enter a source snapshot only after the
 * user makes a capture-mode choice and supplies a matching approval token.
 */
export class PromptCaseCaptureService {
  constructor(private readonly data: DataLedger) {}

  propose(input: CreatePromptCaptureProposal): PromptCaptureProposal {
    const mode = captureMode(input.capture_mode);
    const proposal_id = input.proposal_id === undefined
      ? `prompt-capture-${hash(`${input.prompt_hash}:${input.correlation_id}:${input.causation_id}`).slice(0, 20)}`
      : proposalId(input.proposal_id);
    const payload = {
      proposal_id,
      prompt_hash: promptHash(input.prompt_hash),
      capture_mode: mode,
      intent_summary: requireText(input.intent_summary, 'intent_summary', 4000),
      rationale: requireText(input.rationale, 'rationale', 4000),
      ...(input.thread_id === undefined ? {} : {thread_id: requireText(input.thread_id, 'thread_id', 240)}),
      ...(input.redacted_preview === undefined ? {} : {redacted_preview: requireText(input.redacted_preview, 'redacted_preview', 2000)}),
    };
    proposalPayload(payload);
    const created = this.data.create({
      kind: 'prompt_capture_proposal', status: 'candidate', schema_id: PROMPT_CAPTURE_PROTOCOL_ID, schema_version: PROMPT_CAPTURE_PROTOCOL_VERSION,
      subject: {type: 'prompt_case', id: proposal_id}, scope: input.scope,
      origin: {provider: 'trace.transient-prompt', source_id: proposal_id, captured_at: now(), content_hash: payload.prompt_hash},
      producer: input.producer,
      lineage: {parent_refs: [], source_refs: [], correlation_id: requireText(input.correlation_id, 'correlation_id', 200), causation_id: requireText(input.causation_id, 'causation_id', 200)},
      classification: 'private', payload,
    });
    return proposalView(created);
  }

  get(proposalRef: RecordRef): PromptCaptureProposal {
    const ref = validateRecordRef(proposalRef, 'proposal_ref');
    return proposalView(this.data.get(ref.record_id, ref.revision));
  }

  capture(input: CapturePromptCase): PromptCaseCaptureResult {
    const proposalRef = validateRecordRef(input.proposal_ref, 'proposal_ref');
    const proposalRecord = this.data.get(proposalRef.record_id, proposalRef.revision);
    const proposal = proposalView(proposalRecord);
    requireApproval(input.approval, proposal.proposal_ref);
    if (proposal.status !== 'candidate') throw new ProtocolError('INVALID_PROMPT_CAPTURE', 'only a candidate prompt capture proposal may be captured');
    const content = requireText(input.selected_content, 'selected_content', 4 * 1024 * 1024);
    if (proposal.capture_mode === 'full_private' && hash(content) !== proposal.prompt_hash) throw new ProtocolError('PROMPT_HASH_MISMATCH', 'full_private selected_content must match the transient prompt hash recorded by the proposal');
    const classification = proposal.capture_mode === 'full_private' ? 'private' : input.classification ?? 'private';
    if (proposal.capture_mode === 'full_private' && input.classification !== undefined && input.classification !== 'private') throw new ProtocolError('INVALID_PROMPT_CAPTURE', 'full_private capture must remain private');
    const capturedAt = now();
    const source = this.data.create({
      kind: 'source_snapshot', status: 'captured', schema_id: PROMPT_CASE_SOURCE_SCHEMA_ID, schema_version: PROMPT_CASE_SOURCE_SCHEMA_VERSION,
      subject: {type: 'conversation_prompt', id: proposal.proposal_id}, scope: proposalRecord.scope,
      origin: {provider: 'trace.user-approved-prompt-case', source_id: proposal.proposal_id, captured_at: capturedAt, content_hash: hash(content), locator: `prompt-capture:${proposal.proposal_id}`},
      producer: input.producer,
      lineage: {parent_refs: [], source_refs: [], correlation_id: requireText(input.correlation_id, 'correlation_id', 200), causation_id: requireText(input.causation_id, 'causation_id', 200)},
      classification,
      payload: {
        source_id: proposal.proposal_id, provider: 'trace.user-approved-prompt-case', external_id: proposal.proposal_id,
        title: input.title === undefined ? `Prompt case ${proposal.proposal_id}` : requireText(input.title, 'title', 300),
        content, captured_at: capturedAt, content_hash: hash(content), content_mode: proposal.capture_mode,
        capture_proposal_ref: refText(proposal.proposal_ref), prompt_hash: proposal.prompt_hash,
      },
    });
    const sourceRef = recordRef(source);
    const adopted = this.data.update(proposalRecord.record_id, {
      expected_revision: proposalRecord.revision, status: 'adopted',
      payload: {...proposalRecord.payload, captured_source_ref: refText(sourceRef)},
    });
    return {proposal: proposalView(adopted), source_snapshot_ref: sourceRef, capture_mode: proposal.capture_mode, classification};
  }

  createPrecedent(input: CreatePromptCasePrecedent): DataEnvelope {
    const sourceRef = validateRecordRef(input.prompt_source_ref, 'prompt_source_ref');
    const source = this.data.get(sourceRef.record_id, sourceRef.revision);
    if (source.kind !== 'source_snapshot' || source.schema_id !== PROMPT_CASE_SOURCE_SCHEMA_ID) throw new ProtocolError('INVALID_PROMPT_CAPTURE', 'prompt_source_ref must identify an approved prompt case source snapshot');
    const outcomes = input.outcome_refs.map((ref, index) => validateRecordRef(ref, `outcome_refs[${index}]`));
    if (outcomes.length === 0) throw new ProtocolError('INVALID_PROMPT_CAPTURE', 'at least one outcome_ref is required before creating a precedent');
    return this.data.create(buildCandidatePrecedentRecord({
      candidate_id: proposalId(input.candidate_id), claim: requireText(input.claim, 'claim'), rationale: requireText(input.rationale, 'rationale'),
      evidence_refs: [sourceRef, ...outcomes], scope: input.scope, origin: input.origin, producer: input.producer, classification: input.classification,
      causation_id: input.causation_id, correlation_id: input.correlation_id, change_id: input.change_id,
      extra_payload: {prompt_case_source_ref: refText(sourceRef)},
    }));
  }
}
