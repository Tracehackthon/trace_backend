import {StorageError, type VersionedStore} from '../../storage/src/index.js';
import type {RecordRef} from '../../protocol/src/index.js';
import {buildDataEnvelope, envelopeHash, payloadHash, type CreateDataRecord, type DataEnvelope, type DataKind, type DataStatus, type UpdateDataRecord, validateDataEnvelope} from './contracts.js';
import {ProtocolError} from '../../protocol/src/index.js';

const STATUS_TRANSITIONS: Readonly<Record<DataStatus, readonly DataStatus[]>> = {
  captured: ['normalized', 'candidate', 'rejected'],
  normalized: ['candidate', 'validated', 'rejected', 'superseded'],
  candidate: ['validated', 'adopted', 'rejected', 'superseded'],
  validated: ['adopted', 'published', 'rejected', 'superseded'],
  adopted: ['published', 'superseded', 'rejected'],
  published: ['superseded'],
  superseded: [],
  rejected: [],
};

function now(): string { return new Date().toISOString(); }

function clone<T>(value: T): T { return structuredClone(value); }

export interface ChainReport {
  root_record_id: string;
  record_ids: string[];
  edge_count: number;
  complete: true;
}

export interface DataLedgerOptions {
  resolveChange?: (changeId: string) => unknown;
}

export class DataLedger {
  constructor(readonly store: VersionedStore<DataEnvelope>, readonly options: DataLedgerOptions = {}) {}

  private allValidated(): DataEnvelope[] {
    // latest() performs the append-only revision continuity and duplicate
    // checks before we traverse historical revisions for lineage references.
    this.store.latest();
    return this.store.all().map(value => validateDataEnvelope(value));
  }

  private findExact(ref: RecordRef, records = this.allValidated()): DataEnvelope {
    const found = records.find(item => item.record_id === ref.record_id && item.revision === ref.revision);
    if (!found) throw new ProtocolError('LINEAGE_MISSING', `Missing data reference ${ref.record_id}@${ref.revision}`);
    if (found.kind !== ref.kind || found.schema_id !== ref.schema_id || found.schema_version !== ref.schema_version) throw new ProtocolError('LINEAGE_MISMATCH', `Data reference metadata does not match ${ref.record_id}@${ref.revision}`);
    return found;
  }

  private assertDirectLineage(record: DataEnvelope, records = this.allValidated()): void {
    if (record.lineage.change_id !== undefined && this.options.resolveChange !== undefined) this.options.resolveChange(record.lineage.change_id);
    for (const ref of [...record.lineage.parent_refs, ...record.lineage.source_refs]) this.findExact(ref, records);
  }

  create(input: CreateDataRecord): DataEnvelope {
    const record = buildDataEnvelope(input);
    const records = this.allValidated();
    this.assertDirectLineage(record, records);
    const stored = this.store.appendIfAbsent(record);
    return validateDataEnvelope(stored.record);
  }

  get(recordId: string, revision?: number): DataEnvelope {
    const records = this.allValidated();
    const found = records.find(item => item.record_id === recordId && (revision === undefined || item.revision === revision));
    if (!found) throw new StorageError('NOT_FOUND', `Unknown data record: ${recordId}${revision === undefined ? '' : `@${revision}`}`);
    return found;
  }

  update(recordId: string, input: UpdateDataRecord): DataEnvelope {
    const unknown = Object.keys(input as object).filter(key => !['expected_revision', 'status', 'payload', 'origin', 'producer', 'lineage', 'note'].includes(key));
    if (unknown.length > 0) throw new ProtocolError('UNKNOWN_FIELD', `update_data_record contains unsupported fields: ${unknown.join(', ')}`);
    const next = this.store.compareAndSwap(recordId, input.expected_revision, currentValue => {
      const current = validateDataEnvelope(currentValue);
      const status = input.status ?? current.status;
      if (status !== current.status && !(STATUS_TRANSITIONS[current.status] ?? []).includes(status)) throw new ProtocolError('INVALID_TRANSITION', `${current.status} cannot transition to ${status}`);
      const candidate = buildDataEnvelope({
        kind: current.kind,
        status,
        schema_id: current.schema_id,
        schema_version: current.schema_version,
        subject: current.subject,
        scope: current.scope,
        origin: input.origin ?? current.origin,
        producer: input.producer ?? current.producer,
        lineage: input.lineage ?? current.lineage,
        classification: current.classification,
        payload: input.payload ?? current.payload,
      });
      const updated: DataEnvelope = {...candidate, record_id: current.record_id, revision: current.revision + 1, created_at: current.created_at, updated_at: now()};
      this.assertDirectLineage(updated);
      return this.withRecomputedIntegrity(updated);
    });
    return validateDataEnvelope(next);
  }

  private withRecomputedIntegrity(record: DataEnvelope): DataEnvelope {
    const {integrity: _ignored, ...withoutIntegrity} = record;
    return {...record, integrity: {algorithm: 'sha256', payload_hash: payloadHash(record.payload), envelope_hash: envelopeHash(withoutIntegrity)}};
  }

  list(kind?: DataKind): DataEnvelope[] {
    return this.store.latest().map(value => validateDataEnvelope(value)).filter(item => kind === undefined || item.kind === kind);
  }

  verifyChain(rootRecordId: string): ChainReport {
    const records = this.allValidated();
    const byIdentity = new Map(records.map(record => [`${record.record_id}@${record.revision}`, record]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    let edgeCount = 0;
    const walk = (record: DataEnvelope): void => {
      const identity = `${record.record_id}@${record.revision}`;
      if (visiting.has(identity)) throw new ProtocolError('LINEAGE_CYCLE', `Lineage cycle includes ${identity}`);
      if (visited.has(identity)) return;
      visiting.add(identity);
      if (record.lineage.change_id !== undefined && this.options.resolveChange !== undefined) this.options.resolveChange(record.lineage.change_id);
      for (const ref of [...record.lineage.parent_refs, ...record.lineage.source_refs]) {
        const target = byIdentity.get(`${ref.record_id}@${ref.revision}`);
        if (!target) throw new ProtocolError('LINEAGE_MISSING', `Missing data reference ${ref.record_id}@${ref.revision}`);
        if (target.kind !== ref.kind || target.schema_id !== ref.schema_id || target.schema_version !== ref.schema_version) throw new ProtocolError('LINEAGE_MISMATCH', `Data reference metadata does not match ${ref.record_id}@${ref.revision}`);
        if (target.lineage.change_id !== undefined && this.options.resolveChange !== undefined) this.options.resolveChange(target.lineage.change_id);
        edgeCount += 1;
        walk(target);
      }
      visiting.delete(identity);
      visited.add(identity);
    };
    const root = records.filter(record => record.record_id === rootRecordId).sort((a, b) => a.revision - b.revision).at(-1);
    if (!root) throw new StorageError('NOT_FOUND', `Unknown data record: ${rootRecordId}`);
    walk(root);
    return {root_record_id: rootRecordId, record_ids: [...new Set([...visited].map(identity => identity.slice(0, identity.lastIndexOf('@'))))], edge_count: edgeCount, complete: true};
  }
}
