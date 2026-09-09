import type {CreateDataRecord, DataClassification, DataEnvelope, DataOrigin, DataProducer} from '../../data/src/index.js';
import {ProtocolError, ProtocolVersionRegistry, rejectUnknown, requireObject as object, requireStringList, requireText as text, type ProtocolVersioned, type RecordRef, validateRecordRef} from '../../protocol/src/index.js';

export const CAPABILITY_CANDIDATE_PROTOCOL_ID = 'trace.capability-candidate' as const;
export const CAPABILITY_CANDIDATE_PROTOCOL_VERSION = '0.2.0' as const;
export const CAPABILITY_CANDIDATE_SCHEMA_ID = CAPABILITY_CANDIDATE_PROTOCOL_ID;
export const CAPABILITY_CANDIDATE_SCHEMA_VERSION = CAPABILITY_CANDIDATE_PROTOCOL_VERSION;

export type CapabilityCandidateAdoptionStatus = 'pending' | 'adopted' | 'rejected' | 'superseded';
export type CandidateConfidence = 'low' | 'medium' | 'high';

export interface SemanticDelta {
  before: string;
  after: string;
}

export interface JudgmentChange {
  claim: string;
  reason: string;
  confidence: CandidateConfidence;
}

export interface CandidateMechanism {
  problem: string;
  cause: string;
  failure_modes: string[];
}

export interface CandidateScope {
  applies_to: string[];
  does_not_apply_to: string[];
}

export interface CandidateActivationContract {
  triggers: string[];
  required_context: string[];
  forbidden_context: string[];
}

export interface CandidateInputContract {
  required: string[];
  optional: string[];
}

export interface CandidateOutputContract {
  artifacts: string[];
  user_visible: string[];
}

export interface CandidateAcceptanceContract {
  structural: string[];
  behavioral: string[];
  user_visible: string[];
}

export interface CapabilityCandidatePayload {
  candidate_id: string;
  capability_id: string;
  claim: string;
  rationale: string;
  semantic_delta: SemanticDelta;
  judgment_change: JudgmentChange;
  mechanism: CandidateMechanism;
  scope: CandidateScope;
  counterexamples: string[];
  activation_contract: CandidateActivationContract;
  input_contract: CandidateInputContract;
  output_contract: CandidateOutputContract;
  acceptance_contract: CandidateAcceptanceContract;
  evidence_record_ids: string[];
  precedent_record_ids: string[];
  adoption_status: CapabilityCandidateAdoptionStatus;
  protocol_id: typeof CAPABILITY_CANDIDATE_PROTOCOL_ID;
  protocol_version: typeof CAPABILITY_CANDIDATE_PROTOCOL_VERSION;
  [key: string]: unknown;
}

export interface CapabilityCandidateInput {
  candidate_id: string;
  capability_id: string;
  claim: string;
  rationale: string;
  semantic_delta: SemanticDelta;
  judgment_change: JudgmentChange;
  mechanism: CandidateMechanism;
  scope: CandidateScope;
  counterexamples: string[];
  activation_contract: CandidateActivationContract;
  input_contract: CandidateInputContract;
  output_contract: CandidateOutputContract;
  acceptance_contract: CandidateAcceptanceContract;
  evidence_refs: RecordRef[];
  precedent_refs?: RecordRef[];
  adoption_status?: CapabilityCandidateAdoptionStatus;
  record_scope: CreateDataRecord['scope'];
  origin: DataOrigin;
  producer: DataProducer;
  classification: DataClassification;
  causation_id: string;
  correlation_id: string;
  change_id: string;
  extra_payload?: Record<string, unknown>;
}

export interface CapabilityCandidateEnvelopeRef {
  record_id: string;
  revision: number;
}

type AnyCapabilityCandidateProtocol = ProtocolVersioned & Record<string, unknown>;
const capabilityCandidateUpcasters = new ProtocolVersionRegistry<AnyCapabilityCandidateProtocol>();
capabilityCandidateUpcasters.register({protocol_id: CAPABILITY_CANDIDATE_PROTOCOL_ID, from_version: '0.1.0', to_version: CAPABILITY_CANDIDATE_PROTOCOL_VERSION, upcast(value) { return {...value, protocol_version: CAPABILITY_CANDIDATE_PROTOCOL_VERSION}; }});

function list(value: unknown, field: string, min: number, max: number): string[] {
  return requireStringList(value, field, {min, max, itemMax: 1000});
}

function refs(value: unknown, field: string, min = 1): RecordRef[] {
  if (!Array.isArray(value) || value.length < min || value.length > 128) throw new ProtocolError('INVALID_FIELD', `${field} must contain ${min}-128 references`);
  const result = value.map((item, index) => validateRecordRef(item, `${field}[${index}]`));
  const identities = new Set(result.map(item => `${item.record_id}@${item.revision}`));
  if (identities.size !== result.length) throw new ProtocolError('INVALID_FIELD', `${field} contains duplicate references`);
  return result;
}

function validateSemanticDelta(value: unknown): SemanticDelta {
  const item = object(value, 'semantic_delta');
  rejectUnknown(item, ['before', 'after'], 'semantic_delta');
  return {before: text(item.before, 'semantic_delta.before'), after: text(item.after, 'semantic_delta.after')};
}

function validateJudgmentChange(value: unknown): JudgmentChange {
  const item = object(value, 'judgment_change');
  rejectUnknown(item, ['claim', 'reason', 'confidence'], 'judgment_change');
  if (item.confidence !== 'low' && item.confidence !== 'medium' && item.confidence !== 'high') throw new ProtocolError('INVALID_FIELD', 'judgment_change.confidence is not supported');
  return {claim: text(item.claim, 'judgment_change.claim'), reason: text(item.reason, 'judgment_change.reason'), confidence: item.confidence};
}

function validateMechanism(value: unknown): CandidateMechanism {
  const item = object(value, 'mechanism');
  rejectUnknown(item, ['problem', 'cause', 'failure_modes'], 'mechanism');
  return {problem: text(item.problem, 'mechanism.problem'), cause: text(item.cause, 'mechanism.cause'), failure_modes: list(item.failure_modes, 'mechanism.failure_modes', 1, 64)};
}

function validateScope(value: unknown): CandidateScope {
  const item = object(value, 'scope');
  rejectUnknown(item, ['applies_to', 'does_not_apply_to'], 'scope');
  return {applies_to: list(item.applies_to, 'scope.applies_to', 1, 64), does_not_apply_to: list(item.does_not_apply_to, 'scope.does_not_apply_to', 0, 64)};
}

function validateActivation(value: unknown): CandidateActivationContract {
  const item = object(value, 'activation_contract');
  rejectUnknown(item, ['triggers', 'required_context', 'forbidden_context'], 'activation_contract');
  return {triggers: list(item.triggers, 'activation_contract.triggers', 1, 64), required_context: list(item.required_context, 'activation_contract.required_context', 1, 64), forbidden_context: list(item.forbidden_context, 'activation_contract.forbidden_context', 0, 64)};
}

function validateInput(value: unknown): CandidateInputContract {
  const item = object(value, 'input_contract');
  rejectUnknown(item, ['required', 'optional'], 'input_contract');
  return {required: list(item.required, 'input_contract.required', 1, 64), optional: list(item.optional ?? [], 'input_contract.optional', 0, 64)};
}

function validateOutput(value: unknown): CandidateOutputContract {
  const item = object(value, 'output_contract');
  rejectUnknown(item, ['artifacts', 'user_visible'], 'output_contract');
  return {artifacts: list(item.artifacts, 'output_contract.artifacts', 1, 64), user_visible: list(item.user_visible, 'output_contract.user_visible', 1, 64)};
}

function validateAcceptance(value: unknown): CandidateAcceptanceContract {
  const item = object(value, 'acceptance_contract');
  rejectUnknown(item, ['structural', 'behavioral', 'user_visible'], 'acceptance_contract');
  return {structural: list(item.structural, 'acceptance_contract.structural', 1, 64), behavioral: list(item.behavioral, 'acceptance_contract.behavioral', 1, 64), user_visible: list(item.user_visible, 'acceptance_contract.user_visible', 1, 64)};
}

export function validateCapabilityCandidatePayload(value: unknown): CapabilityCandidatePayload {
  const raw = object(value, 'capability_candidate.payload');
  if (raw.protocol_id !== CAPABILITY_CANDIDATE_PROTOCOL_ID) throw new ProtocolError('PROTOCOL_MISMATCH', 'Unsupported capability candidate protocol');
  const item = raw.protocol_version === '0.1.0' ? capabilityCandidateUpcasters.upgrade(raw as AnyCapabilityCandidateProtocol, CAPABILITY_CANDIDATE_PROTOCOL_VERSION) as Record<string, unknown> : raw;
  const required = ['candidate_id', 'capability_id', 'claim', 'rationale', 'semantic_delta', 'judgment_change', 'mechanism', 'scope', 'counterexamples', 'activation_contract', 'input_contract', 'output_contract', 'acceptance_contract', 'evidence_record_ids', 'precedent_record_ids', 'adoption_status', 'protocol_id', 'protocol_version'] as const;
  for (const field of required) if (!(field in item)) throw new ProtocolError('MISSING_REQUIRED_DATA', `capability_candidate payload is missing: ${field}`);
  if (item.protocol_version !== CAPABILITY_CANDIDATE_PROTOCOL_VERSION) throw new ProtocolError('PROTOCOL_MIGRATION_REQUIRED', `Unsupported capability candidate protocol version: ${String(item.protocol_version)}`);
  if (item.adoption_status !== 'pending' && item.adoption_status !== 'adopted' && item.adoption_status !== 'rejected' && item.adoption_status !== 'superseded') throw new ProtocolError('INVALID_FIELD', 'adoption_status is not supported');
  const evidenceRecordIds = list(item.evidence_record_ids, 'evidence_record_ids', 1, 128);
  if (new Set(evidenceRecordIds).size !== evidenceRecordIds.length) throw new ProtocolError('INVALID_FIELD', 'evidence_record_ids contains duplicates');
  const precedentRecordIds = list(item.precedent_record_ids, 'precedent_record_ids', 0, 128);
  if (new Set(precedentRecordIds).size !== precedentRecordIds.length) throw new ProtocolError('INVALID_FIELD', 'precedent_record_ids contains duplicates');
  const evidenceSet = new Set(evidenceRecordIds);
  if (precedentRecordIds.some(id => !evidenceSet.has(id))) throw new ProtocolError('INVALID_LINEAGE', 'precedent_record_ids must be included in evidence_record_ids');
  return {
    ...item,
    candidate_id: text(item.candidate_id, 'candidate_id', 240),
    capability_id: text(item.capability_id, 'capability_id', 160),
    claim: text(item.claim, 'claim'),
    rationale: text(item.rationale, 'rationale'),
    semantic_delta: validateSemanticDelta(item.semantic_delta),
    judgment_change: validateJudgmentChange(item.judgment_change),
    mechanism: validateMechanism(item.mechanism),
    scope: validateScope(item.scope),
    counterexamples: list(item.counterexamples, 'counterexamples', 1, 64),
    activation_contract: validateActivation(item.activation_contract),
    input_contract: validateInput(item.input_contract),
    output_contract: validateOutput(item.output_contract),
    acceptance_contract: validateAcceptance(item.acceptance_contract),
    evidence_record_ids: evidenceRecordIds,
    precedent_record_ids: precedentRecordIds,
    adoption_status: item.adoption_status,
    protocol_id: CAPABILITY_CANDIDATE_PROTOCOL_ID,
    protocol_version: CAPABILITY_CANDIDATE_PROTOCOL_VERSION,
  };
}

function refKey(ref: RecordRef): string { return `${ref.record_id}@${ref.revision}`; }

export function buildCapabilityCandidateRecord(input: CapabilityCandidateInput): CreateDataRecord {
  const evidenceRefs = refs(input.evidence_refs, 'evidence_refs');
  const precedentRefs = refs(input.precedent_refs ?? [], 'precedent_refs', 0);
  const evidenceKeys = new Set(evidenceRefs.map(refKey));
  for (const ref of precedentRefs) if (!evidenceKeys.has(refKey(ref))) throw new ProtocolError('INVALID_LINEAGE', `precedent_refs must be present in evidence_refs: ${refKey(ref)}`);
  const payload = validateCapabilityCandidatePayload({
    ...input.extra_payload,
    candidate_id: text(input.candidate_id, 'candidate_id', 240),
    capability_id: text(input.capability_id, 'capability_id', 160),
    claim: text(input.claim, 'claim'),
    rationale: text(input.rationale, 'rationale'),
    semantic_delta: input.semantic_delta,
    judgment_change: input.judgment_change,
    mechanism: input.mechanism,
    scope: input.scope,
    counterexamples: input.counterexamples,
    activation_contract: input.activation_contract,
    input_contract: input.input_contract,
    output_contract: input.output_contract,
    acceptance_contract: input.acceptance_contract,
    evidence_record_ids: evidenceRefs.map(refKey),
    precedent_record_ids: precedentRefs.map(refKey),
    adoption_status: input.adoption_status ?? 'pending',
    protocol_id: CAPABILITY_CANDIDATE_PROTOCOL_ID,
    protocol_version: CAPABILITY_CANDIDATE_PROTOCOL_VERSION,
  });
  const parentRefs = precedentRefs;
  const parentKeys = new Set(parentRefs.map(refKey));
  const sourceRefs = evidenceRefs.filter(ref => !parentKeys.has(refKey(ref)));
  return {
    kind: 'capability_candidate',
    status: 'candidate',
    schema_id: CAPABILITY_CANDIDATE_SCHEMA_ID,
    schema_version: CAPABILITY_CANDIDATE_SCHEMA_VERSION,
    subject: {type: 'capability_candidate', id: payload.candidate_id},
    scope: input.record_scope,
    origin: input.origin,
    producer: input.producer,
    lineage: {parent_refs: parentRefs, source_refs: sourceRefs, causation_id: text(input.causation_id, 'causation_id', 200), correlation_id: text(input.correlation_id, 'correlation_id', 200), change_id: text(input.change_id, 'change_id', 128)},
    classification: input.classification,
    payload,
  };
}

export function assertPublishableCapabilityCandidate(value: unknown): CapabilityCandidatePayload {
  const record = object(value, 'capability_candidate_record');
  if (record.kind !== 'capability_candidate') throw new ProtocolError('INVALID_LINEAGE', 'Skill publication requires a capability_candidate record');
  if (record.status !== 'adopted' && record.status !== 'published') throw new ProtocolError('ADOPTION_REQUIRED', 'Skill publication requires an adopted capability_candidate');
  const payload = validateCapabilityCandidatePayload(record.payload);
  if (payload.adoption_status !== 'adopted') throw new ProtocolError('ADOPTION_REQUIRED', 'capability_candidate payload must be adopted before Skill publication');
  return payload;
}

export function assertCapabilityCandidateRef(value: unknown, expected: CapabilityCandidateEnvelopeRef): void {
  const record = object(value, 'capability_candidate_record');
  if (record.record_id !== expected.record_id || record.revision !== expected.revision) throw new ProtocolError('LINEAGE_MISMATCH', 'Resolved capability_candidate does not match provenance reference');
  assertPublishableCapabilityCandidate(record);
}

export function capabilityCandidateRef(record: Pick<DataEnvelope, 'record_id' | 'revision' | 'kind' | 'schema_id' | 'schema_version'>): RecordRef {
  if (record.kind !== 'capability_candidate') throw new ProtocolError('INVALID_FIELD', 'record must be a capability_candidate');
  return {record_id: record.record_id, revision: record.revision, kind: record.kind, schema_id: record.schema_id, schema_version: record.schema_version};
}
