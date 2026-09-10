import {createHash} from 'node:crypto';
import {canonicalize, ProtocolError, ProtocolVersionRegistry, rejectUnknown, requireObject, requireText, type ProtocolVersioned, type RecordRef, validateRecordRef} from '../../protocol/src/index.js';

export const DATA_PROTOCOL_ID = 'trace.data-envelope' as const;
export const DATA_PROTOCOL_VERSION = '0.3.0' as const;

export const DATA_KINDS = [
  'source_snapshot',
  'prompt_capture_proposal',
  'normalized_result',
  'candidate_precedent',
  'capability_candidate',
  'prompt_pack',
  'runtime_event',
  'host_retrieval_evidence',
  'artifact',
] as const;
export type DataKind = (typeof DATA_KINDS)[number];

export const DATA_STATUSES = [
  'captured',
  'normalized',
  'candidate',
  'validated',
  'adopted',
  'published',
  'superseded',
  'rejected',
] as const;
export type DataStatus = (typeof DATA_STATUSES)[number];

export type DataClassification = 'public' | 'internal' | 'private' | 'secret';

export interface DataOrigin {
  provider: string;
  source_id: string;
  captured_at: string;
  content_hash: string;
  locator?: string;
}

export interface DataProducer {
  component: string;
  version: string;
  run_id: string;
}

export interface DataLineage {
  parent_refs: RecordRef[];
  source_refs: RecordRef[];
  causation_id: string;
  correlation_id: string;
  change_id?: string;
}

export interface DataIntegrity {
  algorithm: 'sha256';
  payload_hash: string;
  envelope_hash: string;
}

export interface DataEnvelope {
  protocol_id: typeof DATA_PROTOCOL_ID;
  protocol_version: typeof DATA_PROTOCOL_VERSION;
  record_id: string;
  revision: number;
  kind: DataKind;
  status: DataStatus;
  schema_id: string;
  schema_version: string;
  subject: {type: string; id: string};
  scope: {type: 'personal' | 'project' | 'team' | 'domain'; id: string};
  origin: DataOrigin;
  producer: DataProducer;
  lineage: DataLineage;
  classification: DataClassification;
  payload: Record<string, unknown>;
  integrity: DataIntegrity;
  created_at: string;
  updated_at: string;
}

export interface CreateDataRecord {
  kind: DataKind;
  status?: DataStatus;
  schema_id: string;
  schema_version: string;
  subject: {type: string; id: string};
  scope: {type: 'personal' | 'project' | 'team' | 'domain'; id: string};
  origin: DataOrigin;
  producer: DataProducer;
  lineage: DataLineage;
  classification: DataClassification;
  payload: Record<string, unknown>;
}

export interface UpdateDataRecord {
  expected_revision: number;
  status?: DataStatus;
  payload?: Record<string, unknown>;
  origin?: DataOrigin;
  producer?: DataProducer;
  lineage?: DataLineage;
  note?: string;
}

export const REQUIRED_PAYLOAD_FIELDS: Readonly<Record<DataKind, readonly string[]>> = {
  source_snapshot: ['source_id', 'provider', 'external_id', 'title', 'content', 'captured_at', 'content_hash'],
  prompt_capture_proposal: ['proposal_id', 'prompt_hash', 'capture_mode', 'intent_summary', 'rationale'],
  normalized_result: ['source_record_id', 'schema_version', 'items', 'normalized_at'],
  candidate_precedent: ['candidate_id', 'claim', 'evidence_record_ids', 'adoption_status', 'rationale'],
  capability_candidate: ['capability_id', 'activation_contract', 'input_contract', 'output_contract', 'acceptance_contract', 'evidence_record_ids'],
  prompt_pack: ['pack_id', 'capability_record_id', 'sections', 'runtime_budget'],
  runtime_event: ['run_id', 'event_name', 'input_refs', 'output_refs', 'outcome'],
  // Provenance-only record of what a host actually did with an authorized
  // cognitive source. Its specialised builder rejects prompt/source/tool
  // bodies before this generic envelope validator sees the payload.
  host_retrieval_evidence: ['evidence_id', 'event_kind', 'source_id', 'host', 'host_session_id', 'locators', 'page_versions', 'policy', 'observed_at', 'content_hash'],
  artifact: ['artifact_id', 'artifact_version', 'manifest', 'content_hash'],
};

const MAX_PAYLOAD_CHARS = 4 * 1024 * 1024;

type AnyDataProtocol = ProtocolVersioned & Record<string, unknown>;
const dataUpcasters = new ProtocolVersionRegistry<AnyDataProtocol>();
dataUpcasters.register({
  protocol_id: DATA_PROTOCOL_ID,
  from_version: '0.1.0',
  to_version: '0.2.0',
  // v0.2 adds explicit prompt-capture admission semantics at the kind layer;
  // existing envelope fields remain compatible.
  upcast(value) { return {...value, protocol_version: '0.2.0'}; },
});
dataUpcasters.register({
  protocol_id: DATA_PROTOCOL_ID,
  from_version: '0.2.0',
  to_version: DATA_PROTOCOL_VERSION,
  // v0.3 adds the closed host_retrieval_evidence kind. Historical envelopes
  // keep their persisted bytes and are only upgraded in memory on read.
  upcast(value) { return {...value, protocol_version: DATA_PROTOCOL_VERSION}; },
});

function requireIsoTimestamp(value: unknown, field: string): string {
  const text = requireText(value, field, 64);
  if (Number.isNaN(Date.parse(text))) throw new ProtocolError('INVALID_FIELD', `${field} must be an ISO timestamp`);
  return text;
}

function requireHash(value: unknown, field: string): string {
  const text = requireText(value, field, 128);
  if (!/^[a-f0-9]{64}$/i.test(text)) throw new ProtocolError('INVALID_FIELD', `${field} must be a sha256 hex digest`);
  return text.toLowerCase();
}

function jsonHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function envelopeHash(value: Omit<DataEnvelope, 'integrity'> & {integrity?: Partial<DataIntegrity>}): string {
  const {integrity: _ignored, ...withoutIntegrity} = value;
  return jsonHash(withoutIntegrity);
}

function hasPath(object: Record<string, unknown>, path: string): boolean {
  let current: unknown = object;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object' || !(part in (current as Record<string, unknown>))) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return current !== undefined && current !== null && (!(typeof current === 'string') || current.trim().length > 0);
}

function validateRefList(value: unknown, field: string): RecordRef[] {
  if (!Array.isArray(value) || value.length > 128) throw new ProtocolError('INVALID_FIELD', `${field} must contain at most 128 references`);
  const refs = value.map((item, index) => validateRecordRef(item, `${field}[${index}]`));
  const seen = new Set(refs.map(ref => `${ref.record_id}@${ref.revision}`));
  if (seen.size !== refs.length) throw new ProtocolError('INVALID_FIELD', `${field} contains duplicate references`);
  return refs;
}

function safeEvidenceLocator(value: unknown, field: string): string {
  const locator = requireText(value, field, 2000).replaceAll('\\', '/');
  if (!locator.toLowerCase().endsWith('.md') || locator.startsWith('/') || locator.split('/').some(part => part === '' || part === '.' || part === '..')) throw new ProtocolError('INVALID_FIELD', `${field} must be a safe relative Markdown locator`);
  return locator;
}

/**
 * This record is deliberately stricter than a normal data payload. The
 * generic Data Ledger must not become a bypass that can put a raw prompt,
 * source body, absolute root, tool input or tool output beside the evidence.
 */
function validateHostRetrievalEvidencePayload(payload: Record<string, unknown>): void {
  const allowed = ['evidence_id', 'event_kind', 'source_id', 'host', 'host_session_id', 'host_turn_id', 'host_tool_name', 'host_tool_use_id', 'input_hash', 'output_hash', 'locators', 'page_versions', 'policy', 'observed_at', 'content_hash'];
  rejectUnknown(payload, allowed, 'host_retrieval_evidence.payload');
  requireText(payload.evidence_id, 'host_retrieval_evidence.evidence_id', 240);
  if (!['source_access_offered', 'source_search', 'source_read', 'source_access_unclassified'].includes(payload.event_kind as string)) throw new ProtocolError('INVALID_FIELD', 'host_retrieval_evidence.event_kind is invalid');
  requireText(payload.source_id, 'host_retrieval_evidence.source_id', 240);
  if (payload.host !== 'codex') throw new ProtocolError('INVALID_FIELD', 'host_retrieval_evidence.host is invalid');
  requireText(payload.host_session_id, 'host_retrieval_evidence.host_session_id', 240);
  if (payload.host_turn_id !== undefined) requireText(payload.host_turn_id, 'host_retrieval_evidence.host_turn_id', 240);
  if (payload.host_tool_name !== undefined) requireText(payload.host_tool_name, 'host_retrieval_evidence.host_tool_name', 160);
  if (payload.host_tool_use_id !== undefined) requireText(payload.host_tool_use_id, 'host_retrieval_evidence.host_tool_use_id', 240);
  if (payload.input_hash !== undefined) requireHash(payload.input_hash, 'host_retrieval_evidence.input_hash');
  if (payload.output_hash !== undefined) requireHash(payload.output_hash, 'host_retrieval_evidence.output_hash');
  if (!Array.isArray(payload.locators) || payload.locators.length > 64) throw new ProtocolError('INVALID_FIELD', 'host_retrieval_evidence.locators must contain at most 64 locators');
  const locators = payload.locators.map((value, index) => safeEvidenceLocator(value, `host_retrieval_evidence.locators[${index}]`));
  if (new Set(locators).size !== locators.length) throw new ProtocolError('INVALID_FIELD', 'host_retrieval_evidence.locators contains duplicates');
  if (!Array.isArray(payload.page_versions) || payload.page_versions.length > 64) throw new ProtocolError('INVALID_FIELD', 'host_retrieval_evidence.page_versions must contain at most 64 pages');
  const versions = payload.page_versions.map((value, index) => {
    const page = requireObject(value, `host_retrieval_evidence.page_versions[${index}]`);
    rejectUnknown(page, ['locator', 'revision', 'content_hash'], `host_retrieval_evidence.page_versions[${index}]`);
    const locator = safeEvidenceLocator(page.locator, `host_retrieval_evidence.page_versions[${index}].locator`);
    if (!Number.isInteger(page.revision) || Number(page.revision) < 1) throw new ProtocolError('INVALID_FIELD', `host_retrieval_evidence.page_versions[${index}].revision must be positive`);
    requireHash(page.content_hash, `host_retrieval_evidence.page_versions[${index}].content_hash`);
    return locator;
  });
  if (new Set(versions).size !== versions.length) throw new ProtocolError('INVALID_FIELD', 'host_retrieval_evidence.page_versions contains duplicates');
  if (payload.event_kind === 'source_read' && (locators.length === 0 || versions.length === 0 || locators.length !== versions.length || locators.some(locator => !versions.includes(locator)))) throw new ProtocolError('INVALID_FIELD', 'source_read evidence must have matching locators and page_versions');
  if (payload.event_kind !== 'source_read' && versions.length > 0) throw new ProtocolError('INVALID_FIELD', 'only source_read evidence may have page_versions');
  if (payload.event_kind !== 'source_access_offered' && (payload.host_tool_name === undefined || payload.input_hash === undefined)) throw new ProtocolError('INVALID_FIELD', 'tool evidence requires host_tool_name and input_hash');
  const policy = requireObject(payload.policy, 'host_retrieval_evidence.policy');
  rejectUnknown(policy, ['mode', 'allowed_prefixes', 'max_reads_per_turn', 'policy_hash'], 'host_retrieval_evidence.policy');
  if (policy.mode !== 'native_observed' && policy.mode !== 'disabled') throw new ProtocolError('INVALID_FIELD', 'host_retrieval_evidence.policy.mode is invalid');
  if (!Array.isArray(policy.allowed_prefixes) || policy.allowed_prefixes.length === 0 || policy.allowed_prefixes.length > 32) throw new ProtocolError('INVALID_FIELD', 'host_retrieval_evidence.policy.allowed_prefixes is invalid');
  for (const [index, prefixValue] of policy.allowed_prefixes.entries()) {
    const prefix = requireText(prefixValue, `host_retrieval_evidence.policy.allowed_prefixes[${index}]`, 500).replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
    if (!prefix || prefix.split('/').some(part => part === '' || part === '.' || part === '..')) throw new ProtocolError('INVALID_FIELD', 'host_retrieval_evidence.policy.allowed_prefixes contains an unsafe prefix');
  }
  if (!Number.isInteger(policy.max_reads_per_turn) || Number(policy.max_reads_per_turn) < 1 || Number(policy.max_reads_per_turn) > 64) throw new ProtocolError('INVALID_FIELD', 'host_retrieval_evidence.policy.max_reads_per_turn is invalid');
  requireHash(policy.policy_hash, 'host_retrieval_evidence.policy.policy_hash');
  requireIsoTimestamp(payload.observed_at, 'host_retrieval_evidence.observed_at');
  requireHash(payload.content_hash, 'host_retrieval_evidence.content_hash');
}

export function payloadHash(payload: Record<string, unknown>): string {
  return jsonHash(payload);
}

export function stableRecordId(input: Pick<CreateDataRecord, 'kind' | 'schema_id' | 'schema_version' | 'subject' | 'origin' | 'payload'>): string {
  const digest = jsonHash({kind: input.kind, schema_id: input.schema_id, schema_version: input.schema_version, subject: input.subject, source_id: input.origin.source_id, payload_hash: payloadHash(input.payload)}).slice(0, 20);
  return `record-${input.kind}-${digest}`;
}

export function validateDataLineage(value: unknown): DataLineage {
  const object = requireObject(value, 'lineage');
  rejectUnknown(object, ['parent_refs', 'source_refs', 'causation_id', 'correlation_id', 'change_id'], 'lineage');
  const parent_refs = validateRefList(object.parent_refs, 'lineage.parent_refs');
  const source_refs = validateRefList(object.source_refs, 'lineage.source_refs');
  const result: DataLineage = {
    parent_refs,
    source_refs,
    causation_id: requireText(object.causation_id, 'lineage.causation_id', 200),
    correlation_id: requireText(object.correlation_id, 'lineage.correlation_id', 200),
  };
  if (object.change_id !== undefined) result.change_id = requireText(object.change_id, 'lineage.change_id', 128);
  return result;
}

export function validateDataEnvelope(value: unknown, checkIntegrity = true): DataEnvelope {
  const raw = requireObject(value, 'data_envelope');
  if (raw.protocol_id !== DATA_PROTOCOL_ID) throw new ProtocolError('PROTOCOL_MISMATCH', 'Unsupported data envelope protocol');
  let object: Record<string, unknown> = raw;
  if (raw.protocol_version === '0.1.0' || raw.protocol_version === '0.2.0') {
    // Verify historical bytes before creating an in-memory v0.3 view. The
    // persisted revision remains untouched; a later update appends the
    // canonical version with a new envelope hash.
    const legacyIntegrity = requireObject(raw.integrity, 'data_envelope.integrity');
    const legacyEnvelope = {...raw, integrity: legacyIntegrity};
    const {integrity: _legacyIntegrity, ...legacyWithoutIntegrity} = legacyEnvelope;
    if (checkIntegrity && legacyIntegrity.envelope_hash !== envelopeHash(legacyWithoutIntegrity as Omit<DataEnvelope, 'integrity'>)) throw new ProtocolError('INTEGRITY_MISMATCH', 'legacy envelope_hash does not match envelope');
    const upgraded = dataUpcasters.upgrade(raw as AnyDataProtocol, DATA_PROTOCOL_VERSION) as Record<string, unknown>;
    const {integrity: _ignored, ...upgradedWithoutIntegrity} = upgraded;
    object = {...upgraded, integrity: {...legacyIntegrity, envelope_hash: envelopeHash(upgradedWithoutIntegrity as Omit<DataEnvelope, 'integrity'>)}};
  }
  rejectUnknown(object, ['protocol_id', 'protocol_version', 'record_id', 'revision', 'kind', 'status', 'schema_id', 'schema_version', 'subject', 'scope', 'origin', 'producer', 'lineage', 'classification', 'payload', 'integrity', 'created_at', 'updated_at'], 'data_envelope');
  if (object.protocol_version !== DATA_PROTOCOL_VERSION) throw new ProtocolError('PROTOCOL_MIGRATION_REQUIRED', `Unsupported data envelope protocol version: ${String(object.protocol_version)}`);
  if (!Number.isInteger(object.revision) || Number(object.revision) < 1) throw new ProtocolError('INVALID_FIELD', 'revision must be a positive integer');
  if (!DATA_KINDS.includes(object.kind as DataKind)) throw new ProtocolError('INVALID_FIELD', 'kind is not supported');
  if (!DATA_STATUSES.includes(object.status as DataStatus)) throw new ProtocolError('INVALID_FIELD', 'status is not supported');
  const subject = requireObject(object.subject, 'subject');
  rejectUnknown(subject, ['type', 'id'], 'subject');
  const scope = requireObject(object.scope, 'scope');
  rejectUnknown(scope, ['type', 'id'], 'scope');
  if (scope.type !== 'personal' && scope.type !== 'project' && scope.type !== 'team' && scope.type !== 'domain') throw new ProtocolError('INVALID_FIELD', 'scope.type is not supported');
  const origin = requireObject(object.origin, 'origin');
  rejectUnknown(origin, ['provider', 'source_id', 'captured_at', 'content_hash', 'locator'], 'origin');
  const producer = requireObject(object.producer, 'producer');
  rejectUnknown(producer, ['component', 'version', 'run_id'], 'producer');
  const payload = requireObject(object.payload, 'payload');
  const encodedPayload = JSON.stringify(canonicalize(payload));
  if (encodedPayload.length > MAX_PAYLOAD_CHARS) throw new ProtocolError('BYTE_LIMIT', `payload exceeds ${MAX_PAYLOAD_CHARS} JSON characters`);
  const kind = object.kind as DataKind;
  const missing = REQUIRED_PAYLOAD_FIELDS[kind].filter(field => !hasPath(payload, field));
  if (missing.length > 0) throw new ProtocolError('MISSING_REQUIRED_DATA', `${kind} payload is missing: ${missing.join(', ')}`);
  if (kind === 'host_retrieval_evidence') validateHostRetrievalEvidencePayload(payload);
  const sourceLike = kind === 'source_snapshot' || kind === 'prompt_capture_proposal' || kind === 'host_retrieval_evidence';
  if (sourceLike && (object.lineage as Record<string, unknown> | undefined)?.['parent_refs'] && ((object.lineage as Record<string, unknown>).parent_refs as unknown[]).length > 0) throw new ProtocolError('INVALID_LINEAGE', `${kind} cannot have parent_refs`);
  if (!sourceLike && !Array.isArray((object.lineage as Record<string, unknown> | undefined)?.['source_refs']) && !Array.isArray((object.lineage as Record<string, unknown> | undefined)?.['parent_refs'])) throw new ProtocolError('INVALID_LINEAGE', `${kind} requires lineage refs`);
  const lineage = validateDataLineage(object.lineage);
  if (sourceLike && lineage.source_refs.length > 0) throw new ProtocolError('INVALID_LINEAGE', `${kind} cannot have source_refs`);
  if (!sourceLike && !lineage.change_id) throw new ProtocolError('MISSING_REQUIRED_DATA', `${kind} requires lineage.change_id`);
  if (!sourceLike && lineage.parent_refs.length === 0 && lineage.source_refs.length === 0) throw new ProtocolError('INVALID_LINEAGE', `${kind} must retain at least one parent or source reference`);
  const classification = object.classification;
  if (classification !== 'public' && classification !== 'internal' && classification !== 'private' && classification !== 'secret') throw new ProtocolError('INVALID_FIELD', 'classification is not supported');
  const integrityObject = requireObject(object.integrity, 'integrity');
  rejectUnknown(integrityObject, ['algorithm', 'payload_hash', 'envelope_hash'], 'integrity');
  if (integrityObject.algorithm !== 'sha256') throw new ProtocolError('INVALID_FIELD', 'integrity.algorithm must be sha256');
  const envelope: DataEnvelope = {
    protocol_id: DATA_PROTOCOL_ID,
    protocol_version: DATA_PROTOCOL_VERSION,
    record_id: requireText(object.record_id, 'record_id', 240),
    revision: Number(object.revision),
    kind,
    status: object.status as DataStatus,
    schema_id: requireText(object.schema_id, 'schema_id', 240),
    schema_version: requireText(object.schema_version, 'schema_version', 64),
    subject: {type: requireText(subject.type, 'subject.type'), id: requireText(subject.id, 'subject.id')},
    scope: {type: scope.type as DataEnvelope['scope']['type'], id: requireText(scope.id, 'scope.id')},
    origin: {provider: requireText(origin.provider, 'origin.provider'), source_id: requireText(origin.source_id, 'origin.source_id', 240), captured_at: requireIsoTimestamp(origin.captured_at, 'origin.captured_at'), content_hash: requireHash(origin.content_hash, 'origin.content_hash'), ...(origin.locator === undefined ? {} : {locator: requireText(origin.locator, 'origin.locator', 2000)})},
    producer: {component: requireText(producer.component, 'producer.component'), version: requireText(producer.version, 'producer.version', 64), run_id: requireText(producer.run_id, 'producer.run_id', 200)},
    lineage,
    classification,
    payload,
    integrity: {algorithm: 'sha256', payload_hash: requireHash(integrityObject.payload_hash, 'integrity.payload_hash'), envelope_hash: requireHash(integrityObject.envelope_hash, 'integrity.envelope_hash')},
    created_at: requireIsoTimestamp(object.created_at, 'created_at'),
    updated_at: requireIsoTimestamp(object.updated_at, 'updated_at'),
  };
  if (envelope.payload.content_hash !== undefined && envelope.payload.content_hash !== envelope.origin.content_hash) throw new ProtocolError('INTEGRITY_MISMATCH', 'payload.content_hash must equal origin.content_hash');
  if (checkIntegrity) {
    if (envelope.integrity.payload_hash !== payloadHash(envelope.payload)) throw new ProtocolError('INTEGRITY_MISMATCH', 'payload_hash does not match payload');
    if (envelope.integrity.envelope_hash !== envelopeHash(envelope)) throw new ProtocolError('INTEGRITY_MISMATCH', 'envelope_hash does not match envelope');
  }
  return envelope;
}

export function buildDataEnvelope(input: CreateDataRecord): DataEnvelope {
  const unknown = Object.keys(input as object).filter(key => !['kind', 'status', 'schema_id', 'schema_version', 'subject', 'scope', 'origin', 'producer', 'lineage', 'classification', 'payload'].includes(key));
  if (unknown.length > 0) throw new ProtocolError('UNKNOWN_FIELD', `create_data_record contains unsupported fields: ${unknown.join(', ')}`);
  const timestamp = new Date().toISOString();
  const payload = structuredClone(input.payload);
  const rawWithoutIntegrity = {
    protocol_id: DATA_PROTOCOL_ID,
    protocol_version: DATA_PROTOCOL_VERSION,
    record_id: stableRecordId(input),
    revision: 1,
    kind: input.kind,
    status: input.status ?? 'captured',
    schema_id: input.schema_id,
    schema_version: input.schema_version,
    subject: structuredClone(input.subject),
    scope: structuredClone(input.scope),
    origin: structuredClone(input.origin),
    producer: structuredClone(input.producer),
    lineage: structuredClone(input.lineage),
    classification: input.classification,
    payload,
    created_at: timestamp,
    updated_at: timestamp,
  } as Omit<DataEnvelope, 'integrity'>;
  const envelope: DataEnvelope = {
    ...rawWithoutIntegrity,
    integrity: {algorithm: 'sha256', payload_hash: payloadHash(payload), envelope_hash: envelopeHash(rawWithoutIntegrity)},
  };
  return validateDataEnvelope(envelope);
}
