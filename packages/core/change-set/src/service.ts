import {
  CHANGE_SET_PROTOCOL_ID,
  CHANGE_SET_PROTOCOL_VERSION,
  STATUS_TRANSITIONS,
  type ChangeSet,
  type CreateChangeSet,
  type UpdateChangeSet,
  type Validation,
  type ChangeStatus,
  type ChangeLineage,
  type RecordRef,
  validateChangeSet,
  validateChangeLineage,
  validateCreateChangeSet,
  validateCompatibility,
  stableChangeId,
  ProtocolError,
} from '../../protocol/src/index.js';
import type {VersionedStore} from '../../storage/src/index.js';

function now(): string {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requireState(value: unknown, field: string): asserts value is Validation[keyof Validation] {
  if (value !== 'pending' && value !== 'passed' && value !== 'failed' && value !== 'not_applicable') throw new ProtocolError('INVALID_VALIDATION', `${field} has an invalid state`);
}

function mergeValidation(current: Validation, patch: Partial<Validation> | undefined): Validation {
  const next: Validation = {...current};
  for (const key of ['schema', 'replay', 'behavior'] as const) {
    if (patch?.[key] !== undefined) {
      requireState(patch[key], `validation.${key}`);
      next[key] = patch[key];
    }
  }
  return next;
}

function mergeLineage(current: ChangeLineage, patch: Partial<ChangeLineage> | undefined): ChangeLineage {
  if (patch === undefined) return current;
  return {
    input_refs: patch.input_refs ?? current.input_refs,
    output_refs: patch.output_refs ?? current.output_refs,
    parent_change_ids: patch.parent_change_ids ?? current.parent_change_ids,
    causation_id: patch.causation_id ?? current.causation_id,
    correlation_id: patch.correlation_id ?? current.correlation_id,
  };
}

export interface CreateResult {
  status: 'created' | 'no_change';
  record: ChangeSet;
}

export interface ChangeSetServiceOptions {
  resolveDataRef?: (ref: RecordRef) => unknown;
}

export class ChangeSetService {
  constructor(readonly store: VersionedStore<ChangeSet>, readonly options: ChangeSetServiceOptions = {}) {}

  private assertDataLineage(lineage: ChangeLineage): void {
    if (this.options.resolveDataRef === undefined) return;
    for (const ref of [...lineage.input_refs, ...lineage.output_refs]) this.options.resolveDataRef(ref);
  }

  private latest(): ChangeSet[] {
    // Validate persisted rows on read; a corrupted or hand-edited state file
    // must fail closed instead of becoming a new trusted revision.
    return this.store.latest().map(validateChangeSet);
  }

  create(input: CreateChangeSet): CreateResult {
    input = validateCreateChangeSet(input);
    const changeId = stableChangeId(input);
    const existing = this.latest().find(item => item.change_id === changeId);
    if (existing) return {status: 'no_change', record: existing};
    const timestamp = now();
    const raw: ChangeSet = {
      protocol_id: CHANGE_SET_PROTOCOL_ID,
      protocol_version: CHANGE_SET_PROTOCOL_VERSION,
      change_id: changeId,
      revision: 1,
      change_kind: input.change_kind,
      subject: clone(input.subject),
      base: clone(input.base),
      proposed: clone(input.proposed),
      impact: [...input.impact],
      compatibility: validateCompatibility(input.compatibility),
      validation: {schema: 'pending', replay: 'pending', behavior: 'pending'},
      scope: clone(input.scope),
      status: 'proposed',
      requested_by: input.requested_by,
      created_at: timestamp,
      updated_at: timestamp,
      adoption: {status: 'pending'},
      promotion: {status: 'not_started'},
      rollback: {status: 'not_started'},
      lineage: clone(input.lineage),
      ...(input.note === undefined ? {} : {note: input.note}),
    };
    const record = validateChangeSet(raw);
    this.assertDataLineage(record.lineage);
    // Re-check under the storage lock so two callers proposing the same
    // canonical change cannot append duplicate revision-1 rows.
    const stored = this.store.appendIfAbsent(record);
    return {status: stored.inserted ? 'created' : 'no_change', record: validateChangeSet(stored.record)};
  }

  get(changeId: string): ChangeSet {
    const found = this.latest().find(item => item.change_id === changeId);
    if (!found) throw new ProtocolError('NOT_FOUND', `Unknown change set: ${changeId}`);
    return found;
  }

  update(changeId: string, input: UpdateChangeSet): ChangeSet {
    const unknown = Object.keys(input as object).filter(key => !['expected_revision', 'status', 'validation', 'note', 'decided_by', 'promotion_target', 'rollback_target', 'rollback_reason', 'lineage'].includes(key));
    if (unknown.length > 0) throw new ProtocolError('UNKNOWN_FIELD', `update_change_set contains unsupported fields: ${unknown.join(', ')}`);
    const next = this.store.compareAndSwap(changeId, input.expected_revision, currentValue => {
      const current = validateChangeSet(currentValue);
      const allowed = STATUS_TRANSITIONS[current.status] ?? [];
      if (!allowed.includes(input.status)) throw new ProtocolError('INVALID_TRANSITION', `${current.status} cannot transition to ${input.status}`);
      const validation = mergeValidation(current.validation, input.validation);
      const lineage = validateChangeLineage(mergeLineage(current.lineage, input.lineage));
      if (input.status === 'validated' && (validation.schema !== 'passed' || validation.replay !== 'passed')) throw new ProtocolError('VALIDATION_REQUIRED', 'validated requires schema and replay checks to pass');
      if (input.status === 'promoted') {
        if (current.status !== 'adopted') throw new ProtocolError('ADOPTION_REQUIRED', 'promoted requires adopted status');
        if (validation.behavior !== 'passed') throw new ProtocolError('BEHAVIOR_REQUIRED', 'promoted requires behavior check to pass');
        if (!input.promotion_target?.trim()) throw new ProtocolError('PROMOTION_TARGET_REQUIRED', 'promoted requires promotion_target');
      }
      if (input.status === 'adopted' && !input.decided_by?.trim()) throw new ProtocolError('DECIDER_REQUIRED', 'adopted requires decided_by');
      if (input.status === 'rolled_back' && (!input.rollback_target?.trim() || !input.rollback_reason?.trim())) throw new ProtocolError('ROLLBACK_TARGET_REQUIRED', 'rolled_back requires rollback_target and rollback_reason');
      const timestamp = now();
      const updated: ChangeSet = {
        ...clone(current),
        revision: current.revision + 1,
        status: input.status,
        validation,
        lineage,
        updated_at: timestamp,
        ...(input.note === undefined ? {} : {note: input.note}),
      };
      if (input.status === 'adopted') updated.adoption = {status: 'adopted', decided_by: input.decided_by!.trim(), decided_at: timestamp};
      if (input.status === 'promoted') updated.promotion = {status: 'promoted', target: input.promotion_target!.trim(), promoted_at: timestamp};
      if (input.status === 'rolled_back') updated.rollback = {status: 'rolled_back', target: input.rollback_target!.trim(), reason: input.rollback_reason!.trim(), rolled_back_at: timestamp};
      const validated = validateChangeSet(updated);
      this.assertDataLineage(validated.lineage);
      return validated;
    });
    return next;
  }

  list(status?: ChangeStatus): ChangeSet[] {
    return this.latest().filter(item => status === undefined || item.status === status).sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  }
}

