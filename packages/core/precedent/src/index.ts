import type {CreateDataRecord, DataClassification, DataOrigin, DataProducer} from '../../data/src/index.js';
import type {RecordRef} from '../../protocol/src/index.js';

export const PRECEDENT_PROTOCOL_ID = 'trace.candidate-precedent' as const;
export const PRECEDENT_PROTOCOL_VERSION = '0.1.0' as const;
export const PRECEDENT_SCHEMA_ID = 'trace.candidate-precedent' as const;
export const PRECEDENT_SCHEMA_VERSION = '0.1.0' as const;

export interface CandidatePrecedentInput {
  candidate_id: string;
  claim: string;
  evidence_refs: RecordRef[];
  adoption_status?: 'pending' | 'adopted' | 'rejected' | 'superseded';
  rationale: string;
  scope: CreateDataRecord['scope'];
  origin: DataOrigin;
  producer: DataProducer;
  classification: DataClassification;
  causation_id: string;
  correlation_id: string;
  change_id: string;
  extra_payload?: Record<string, unknown>;
}

function text(value: string, field: string, max = 4000): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) throw new Error(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}

function refKey(ref: RecordRef): string { return `${ref.record_id}@${ref.revision}`; }

export function buildCandidatePrecedentRecord(input: CandidatePrecedentInput): CreateDataRecord {
  const candidateId = text(input.candidate_id, 'candidate_id', 240);
  const evidence = input.evidence_refs.map((ref, index) => {
    if (!ref || typeof ref.record_id !== 'string' || !Number.isInteger(ref.revision) || ref.revision < 1) throw new Error(`evidence_refs[${index}] is invalid`);
    return ref;
  });
  if (evidence.length === 0) throw new Error('evidence_refs must not be empty');
  if (new Set(evidence.map(refKey)).size !== evidence.length) throw new Error('evidence_refs must be unique');
  // Extension fields are adapter metadata only; protocol-owned fields always win.
  const payload: Record<string, unknown> = {
    ...input.extra_payload,
    candidate_id: candidateId,
    claim: text(input.claim, 'claim'),
    evidence_record_ids: evidence.map(refKey),
    adoption_status: input.adoption_status ?? 'pending',
    rationale: text(input.rationale, 'rationale'),
    precedent_protocol_id: PRECEDENT_PROTOCOL_ID,
    precedent_protocol_version: PRECEDENT_PROTOCOL_VERSION,
  };
  return {
    kind: 'candidate_precedent',
    status: 'candidate',
    schema_id: PRECEDENT_SCHEMA_ID,
    schema_version: PRECEDENT_SCHEMA_VERSION,
    subject: {type: 'candidate_precedent', id: candidateId},
    scope: input.scope,
    origin: input.origin,
    producer: input.producer,
    lineage: {
      parent_refs: evidence,
      source_refs: [],
      causation_id: text(input.causation_id, 'causation_id', 200),
      correlation_id: text(input.correlation_id, 'correlation_id', 200),
      change_id: text(input.change_id, 'change_id', 128),
    },
    classification: input.classification,
    payload,
  };
}
