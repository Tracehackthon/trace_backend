import {createHash} from 'node:crypto';

export const CHANGE_SET_PROTOCOL_ID = 'trace.change-set' as const;
export const CHANGE_SET_PROTOCOL_VERSION = '0.2.0' as const;

export const CHANGE_KINDS = [
  'product_context',
  'protocol',
  'source',
  'result',
  'runtime',
  'artifact',
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const CHANGE_STATUSES = [
  'proposed',
  'analyzed',
  'validated',
  'adopted',
  'promoted',
  'superseded',
  'rejected',
  'rolled_back',
] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export type ValidationState = 'pending' | 'passed' | 'failed' | 'not_applicable';
export type ImpactLevel = 'low' | 'medium' | 'high';
export type ScopeType = 'personal' | 'project' | 'team' | 'domain';

export interface Compatibility {
  backward_compatible: boolean;
  migration_required: boolean;
  impact_level: ImpactLevel;
  notes?: string;
}

export interface Validation {
  schema: ValidationState;
  replay: ValidationState;
  behavior: ValidationState;
}

/** A stable pointer to another Trace data record. The pointed revision is
 * intentional: evidence must not silently move when its latest revision
 * changes later. */
export interface RecordRef {
  record_id: string;
  revision: number;
  kind: string;
  schema_id: string;
  schema_version: string;
}

export interface ChangeLineage {
  input_refs: RecordRef[];
  output_refs: RecordRef[];
  parent_change_ids: string[];
  causation_id: string;
  correlation_id: string;
}

export interface ChangeSet {
  protocol_id: typeof CHANGE_SET_PROTOCOL_ID;
  protocol_version: typeof CHANGE_SET_PROTOCOL_VERSION;
  change_id: string;
  revision: number;
  change_kind: ChangeKind;
  subject: {type: string; id: string};
  base: Record<string, unknown>;
  proposed: Record<string, unknown>;
  impact: string[];
  compatibility: Compatibility;
  validation: Validation;
  scope: {type: ScopeType; id: string};
  status: ChangeStatus;
  requested_by: string;
  created_at: string;
  updated_at: string;
  adoption: {status: 'pending' | 'adopted' | 'rejected'; decided_by?: string; decided_at?: string};
  promotion: {status: 'not_started' | 'promoted'; target?: string; promoted_at?: string};
  rollback: {status: 'not_started' | 'rolled_back'; target?: string; reason?: string; rolled_back_at?: string};
  lineage: ChangeLineage;
  note?: string;
}

export interface CreateChangeSet {
  change_kind: ChangeKind;
  subject: {type: string; id: string};
  base: Record<string, unknown>;
  proposed: Record<string, unknown>;
  impact: string[];
  compatibility: Compatibility;
  requested_by: string;
  scope: {type: ScopeType; id: string};
  lineage: ChangeLineage;
  note?: string;
}

export interface UpdateChangeSet {
  expected_revision: number;
  status: ChangeStatus;
  validation?: Partial<Validation>;
  note?: string;
  decided_by?: string;
  promotion_target?: string;
  rollback_target?: string;
  rollback_reason?: string;
  lineage?: Partial<ChangeLineage>;
}

export const STATUS_TRANSITIONS: Readonly<Record<ChangeStatus, readonly ChangeStatus[]>> = {
  proposed: ['analyzed', 'rejected'],
  analyzed: ['validated', 'rejected'],
  validated: ['adopted', 'rejected'],
  adopted: ['promoted', 'rejected', 'rolled_back'],
  promoted: ['superseded', 'rolled_back'],
  superseded: [],
  rejected: [],
  rolled_back: [],
};

export class ProtocolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TraceProtocolError';
  }
}

export function validateRecordRef(value: unknown, field = 'record_ref'): RecordRef {
  const object = requireObject(value, field);
  rejectUnknown(object, ['record_id', 'revision', 'kind', 'schema_id', 'schema_version'], field);
  if (!Number.isInteger(object.revision) || Number(object.revision) < 1) {
    throw new ProtocolError('INVALID_FIELD', `${field}.revision must be a positive integer`);
  }
  return {
    record_id: requireText(object.record_id, `${field}.record_id`, 200),
    revision: Number(object.revision),
    kind: requireText(object.kind, `${field}.kind`, 128),
    schema_id: requireText(object.schema_id, `${field}.schema_id`, 200),
    schema_version: requireText(object.schema_version, `${field}.schema_version`, 64),
  };
}

function validateRefList(value: unknown, field: string): RecordRef[] {
  if (!Array.isArray(value) || value.length > 128) throw new ProtocolError('INVALID_FIELD', `${field} must contain at most 128 references`);
  const refs = value.map((item, index) => validateRecordRef(item, `${field}[${index}]`));
  const identities = new Set(refs.map(ref => `${ref.record_id}@${ref.revision}`));
  if (identities.size !== refs.length) throw new ProtocolError('INVALID_FIELD', `${field} contains duplicate references`);
  return refs;
}

export function validateChangeLineage(value: unknown): ChangeLineage {
  const object = requireObject(value, 'lineage');
  rejectUnknown(object, ['input_refs', 'output_refs', 'parent_change_ids', 'causation_id', 'correlation_id'], 'lineage');
  if (!Array.isArray(object.parent_change_ids) || object.parent_change_ids.length > 128) {
    throw new ProtocolError('INVALID_FIELD', 'lineage.parent_change_ids must contain at most 128 ids');
  }
  const parentChangeIds = object.parent_change_ids.map((item, index) => requireText(item, `lineage.parent_change_ids[${index}]`, 128));
  if (new Set(parentChangeIds).size !== parentChangeIds.length) throw new ProtocolError('INVALID_FIELD', 'lineage.parent_change_ids contains duplicates');
  return {
    input_refs: validateRefList(object.input_refs, 'lineage.input_refs'),
    output_refs: validateRefList(object.output_refs, 'lineage.output_refs'),
    parent_change_ids: parentChangeIds,
    causation_id: requireText(object.causation_id, 'lineage.causation_id', 200),
    correlation_id: requireText(object.correlation_id, 'lineage.correlation_id', 200),
  };
}

export function validateCreateChangeSet(value: unknown): CreateChangeSet {
  const object = requireObject(value, 'create_change_set');
  rejectUnknown(object, ['change_kind', 'subject', 'base', 'proposed', 'impact', 'compatibility', 'requested_by', 'scope', 'lineage', 'note'], 'create_change_set');
  const subject = requireObject(object.subject, 'subject');
  rejectUnknown(subject, ['type', 'id'], 'subject');
  const scope = requireObject(object.scope, 'scope');
  rejectUnknown(scope, ['type', 'id'], 'scope');
  const kind = object.change_kind;
  if (!CHANGE_KINDS.includes(kind as ChangeKind)) throw new ProtocolError('INVALID_FIELD', 'change_kind is not supported');
  const impact = object.impact;
  if (!Array.isArray(impact) || impact.length > 32 || impact.some(item => typeof item !== 'string' || item.length === 0 || item.length > 240)) throw new ProtocolError('INVALID_FIELD', 'impact must contain at most 32 non-empty strings');
  return {
    change_kind: kind as ChangeKind,
    subject: {type: requireText(subject.type, 'subject.type'), id: requireText(subject.id, 'subject.id')},
    base: requireBoundedObject(object.base, 'base'),
    proposed: requireBoundedObject(object.proposed, 'proposed'),
    impact: impact.map(item => String(item).trim()),
    compatibility: validateCompatibility(object.compatibility),
    requested_by: requireText(object.requested_by, 'requested_by'),
    scope: {type: scope.type as ScopeType, id: requireText(scope.id, 'scope.id')},
    lineage: validateChangeLineage(object.lineage),
    ...(object.note === undefined ? {} : {note: requireText(object.note, 'note', 4000)}),
  };
}

function requireText(value: unknown, field: string, max = 512): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new ProtocolError('INVALID_FIELD', `${field} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProtocolError('INVALID_FIELD', `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(object: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const unknown = Object.keys(object).filter(key => !allowed.includes(key));
  if (unknown.length > 0) throw new ProtocolError('UNKNOWN_FIELD', `${field} contains unsupported fields: ${unknown.join(', ')}`);
}

function requireBoundedObject(value: unknown, field: string): Record<string, unknown> {
  const object = requireObject(value, field);
  let encoded: string;
  try { encoded = JSON.stringify(canonicalize(object)); } catch { throw new ProtocolError('INVALID_FIELD', `${field} must be JSON serializable`); }
  if (encoded.length > 32_768) throw new ProtocolError('BYTE_LIMIT', `${field} exceeds 32768 JSON characters`);
  return object;
}

function requireState(value: unknown, field: string): ValidationState {
  if (value !== 'pending' && value !== 'passed' && value !== 'failed' && value !== 'not_applicable') {
    throw new ProtocolError('INVALID_FIELD', `${field} has an invalid validation state`);
  }
  return value;
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonicalize(v)]));
  }
  return value;
}

export function stableChangeId(input: Pick<CreateChangeSet, 'change_kind' | 'subject' | 'base' | 'proposed'>): string {
  const digest = createHash('sha256').update(JSON.stringify(canonicalize(input))).digest('hex').slice(0, 16);
  return `change-${digest}`;
}

export function validateCompatibility(value: unknown): Compatibility {
  const object = requireObject(value, 'compatibility');
  rejectUnknown(object, ['backward_compatible', 'migration_required', 'impact_level', 'notes'], 'compatibility');
  const backward = object.backward_compatible;
  const migration = object.migration_required;
  if (typeof backward !== 'boolean' || typeof migration !== 'boolean') {
    throw new ProtocolError('INVALID_COMPATIBILITY', 'compatibility requires boolean backward_compatible and migration_required');
  }
  if (backward && migration) throw new ProtocolError('INVALID_COMPATIBILITY', 'backward_compatible and migration_required cannot both be true');
  const level = object.impact_level;
  if (level !== 'low' && level !== 'medium' && level !== 'high') throw new ProtocolError('INVALID_COMPATIBILITY', 'compatibility.impact_level must be low, medium, or high');
  const result: Compatibility = {backward_compatible: backward, migration_required: migration, impact_level: level};
  if (object.notes !== undefined) result.notes = requireText(object.notes, 'compatibility.notes', 2000);
  return result;
}

export function validateChangeSet(value: unknown): ChangeSet {
  const object = requireObject(value, 'change_set');
  rejectUnknown(object, ['protocol_id', 'protocol_version', 'change_id', 'revision', 'change_kind', 'subject', 'base', 'proposed', 'impact', 'compatibility', 'validation', 'scope', 'status', 'requested_by', 'created_at', 'updated_at', 'adoption', 'promotion', 'rollback', 'lineage', 'note'], 'change_set');
  if (object.protocol_id !== CHANGE_SET_PROTOCOL_ID || object.protocol_version !== CHANGE_SET_PROTOCOL_VERSION) throw new ProtocolError('PROTOCOL_MISMATCH', 'Unsupported Change Set protocol');
  const kind = object.change_kind;
  if (!CHANGE_KINDS.includes(kind as ChangeKind)) throw new ProtocolError('INVALID_FIELD', 'change_kind is not supported');
  const subject = requireObject(object.subject, 'subject');
  rejectUnknown(subject, ['type', 'id'], 'subject');
  const status = object.status;
  if (!CHANGE_STATUSES.includes(status as ChangeStatus)) throw new ProtocolError('INVALID_FIELD', 'status is not supported');
  const scope = requireObject(object.scope, 'scope');
  rejectUnknown(scope, ['type', 'id'], 'scope');
  const scopeType = scope.type;
  if (scopeType !== 'personal' && scopeType !== 'project' && scopeType !== 'team' && scopeType !== 'domain') throw new ProtocolError('INVALID_FIELD', 'scope.type is not supported');
  const validation = requireObject(object.validation, 'validation');
  rejectUnknown(validation, ['schema', 'replay', 'behavior'], 'validation');
  const adoption = requireObject(object.adoption, 'adoption');
  rejectUnknown(adoption, ['status', 'decided_by', 'decided_at'], 'adoption');
  const promotion = requireObject(object.promotion, 'promotion');
  rejectUnknown(promotion, ['status', 'target', 'promoted_at'], 'promotion');
  const rollback = requireObject(object.rollback, 'rollback');
  rejectUnknown(rollback, ['status', 'target', 'reason', 'rolled_back_at'], 'rollback');
  if (adoption.status !== 'pending' && adoption.status !== 'adopted' && adoption.status !== 'rejected') throw new ProtocolError('INVALID_FIELD', 'adoption.status is not supported');
  if (promotion.status !== 'not_started' && promotion.status !== 'promoted') throw new ProtocolError('INVALID_FIELD', 'promotion.status is not supported');
  if (rollback.status !== 'not_started' && rollback.status !== 'rolled_back') throw new ProtocolError('INVALID_FIELD', 'rollback.status is not supported');
  if (!Number.isInteger(object.revision) || Number(object.revision) < 1) throw new ProtocolError('INVALID_FIELD', 'revision must be a positive integer');
  const impact = object.impact;
  if (!Array.isArray(impact) || impact.length > 32 || impact.some(item => typeof item !== 'string' || item.length === 0 || item.length > 240)) throw new ProtocolError('INVALID_FIELD', 'impact must contain at most 32 non-empty strings');
  const lineage = validateChangeLineage(object.lineage);
  return {
    protocol_id: CHANGE_SET_PROTOCOL_ID,
    protocol_version: CHANGE_SET_PROTOCOL_VERSION,
    change_id: requireText(object.change_id, 'change_id', 128),
    revision: Number(object.revision),
    change_kind: kind as ChangeKind,
    subject: {type: requireText(subject.type, 'subject.type'), id: requireText(subject.id, 'subject.id')},
    base: requireBoundedObject(object.base, 'base'),
    proposed: requireBoundedObject(object.proposed, 'proposed'),
    impact: impact.map(item => String(item).trim()),
    compatibility: validateCompatibility(object.compatibility),
    validation: {schema: requireState(validation.schema, 'validation.schema'), replay: requireState(validation.replay, 'validation.replay'), behavior: requireState(validation.behavior, 'validation.behavior')},
    scope: {type: scopeType as ScopeType, id: requireText(scope.id, 'scope.id')},
    status: status as ChangeStatus,
    requested_by: requireText(object.requested_by, 'requested_by'),
    created_at: requireText(object.created_at, 'created_at', 64),
    updated_at: requireText(object.updated_at, 'updated_at', 64),
    adoption: {status: adoption.status as ChangeSet['adoption']['status'], ...(adoption.decided_by === undefined ? {} : {decided_by: requireText(adoption.decided_by, 'adoption.decided_by')}), ...(adoption.decided_at === undefined ? {} : {decided_at: requireText(adoption.decided_at, 'adoption.decided_at', 64)})},
    promotion: {status: promotion.status as ChangeSet['promotion']['status'], ...(promotion.target === undefined ? {} : {target: requireText(promotion.target, 'promotion.target')}), ...(promotion.promoted_at === undefined ? {} : {promoted_at: requireText(promotion.promoted_at, 'promotion.promoted_at', 64)})},
    rollback: {status: rollback.status as ChangeSet['rollback']['status'], ...(rollback.target === undefined ? {} : {target: requireText(rollback.target, 'rollback.target')}), ...(rollback.reason === undefined ? {} : {reason: requireText(rollback.reason, 'rollback.reason', 2000)}), ...(rollback.rolled_back_at === undefined ? {} : {rolled_back_at: requireText(rollback.rolled_back_at, 'rollback.rolled_back_at', 64)})},
    lineage,
    ...(object.note === undefined ? {} : {note: requireText(object.note, 'note', 4000)}),
  };
}

