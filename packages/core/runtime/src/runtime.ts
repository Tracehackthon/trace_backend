import {AppendOnlyStore, SqliteVersionedStore, StorageError, type VersionedStore} from '../../storage/src/index.js';
import {ChangeSetService} from '../../change-set/src/index.js';
import {DataLedger} from '../../data/src/index.js';
import {ContinuityLedger, type CreateDiscussionTurn, type CreateReceipt, type CreateThread, type UpdateThread, type ContinuityEnvelope} from '../../continuity/src/index.js';
import {ProtocolError, type ChangeSet, type CreateChangeSet, type UpdateChangeSet, type ChangeStatus} from '../../protocol/src/index.js';
import type {CreateDataRecord, DataEnvelope, DataKind, UpdateDataRecord} from '../../data/src/index.js';
import {buildCapabilityCandidateRecord, type CapabilityCandidateInput} from '../../capability-candidate/src/index.js';

export interface TraceRuntimePaths {
  changeStateFile?: string;
  dataStateFile?: string;
  continuityStateFile?: string;
  sqliteStateFile?: string;
}

/**
 * The application-facing runtime seam. It owns no Codex or Python process;
 * those are adapters that call this service through the CLI/RPC boundary.
 */
export class TraceRuntime {
  readonly changes: ChangeSetService;
  readonly data: DataLedger;
  readonly continuity?: ContinuityLedger;

  constructor(paths: TraceRuntimePaths) {
    if (!paths.sqliteStateFile && (!paths.changeStateFile || !paths.dataStateFile)) throw new StorageError('INVALID_PATH', 'TraceRuntime requires either sqliteStateFile or both changeStateFile and dataStateFile');
    const changeStore: VersionedStore<ChangeSet> = paths.sqliteStateFile ? new SqliteVersionedStore<ChangeSet>(paths.sqliteStateFile, 'change_sets') : new AppendOnlyStore<ChangeSet>(paths.changeStateFile!);
    const dataStore: VersionedStore<DataEnvelope> = paths.sqliteStateFile ? new SqliteVersionedStore<DataEnvelope>(paths.sqliteStateFile, 'data_records') : new AppendOnlyStore<DataEnvelope>(paths.dataStateFile!);
    let changes!: ChangeSetService;
    let data!: DataLedger;
    changes = new ChangeSetService(changeStore, {resolveDataRef: ref => {
      const record = data.get(ref.record_id, ref.revision);
      if (record.kind !== ref.kind || record.schema_id !== ref.schema_id || record.schema_version !== ref.schema_version) throw new ProtocolError('LINEAGE_MISMATCH', `Data reference metadata does not match ${ref.record_id}@${ref.revision}`);
      return record;
    }});
    data = new DataLedger(dataStore, {resolveChange: changeId => changes.get(changeId)});
    this.changes = changes;
    this.data = data;
    if (paths.sqliteStateFile || paths.continuityStateFile) {
      const continuityStore = paths.sqliteStateFile ? new SqliteVersionedStore<ContinuityEnvelope>(paths.sqliteStateFile, 'continuity_records') : new AppendOnlyStore<ContinuityEnvelope>(paths.continuityStateFile!);
      this.continuity = new ContinuityLedger(continuityStore);
    }
  }

  createChange(input: CreateChangeSet) {
    return this.changes.create(input);
  }

  updateChange(changeId: string, input: UpdateChangeSet) {
    return this.changes.update(changeId, input);
  }

  listChanges(status?: ChangeStatus) {
    return this.changes.list(status);
  }

  createData(input: CreateDataRecord) {
    return this.data.create(input);
  }

  createCapabilityCandidate(input: CapabilityCandidateInput) {
    return this.data.create(buildCapabilityCandidateRecord(input));
  }

  updateData(recordId: string, input: UpdateDataRecord) {
    return this.data.update(recordId, input);
  }

  listData(kind?: DataKind) {
    return this.data.list(kind);
  }

  verifyDataChain(recordId: string) {
    return this.data.verifyChain(recordId);
  }

  private requireContinuity(): ContinuityLedger {
    if (!this.continuity) throw new StorageError('CONTINUITY_UNAVAILABLE', 'Continuity state is not configured for this runtime');
    return this.continuity;
  }

  createThread(input: CreateThread) { return this.requireContinuity().createThread(input); }
  updateThread(threadId: string, input: UpdateThread) { return this.requireContinuity().updateThread(threadId, input); }
  appendDiscussionTurn(input: CreateDiscussionTurn) { return this.requireContinuity().appendTurn(input); }
  createReceipt(input: CreateReceipt) { return this.requireContinuity().createReceipt(input); }
  listContinuity(threadId?: string) { return this.requireContinuity().list(threadId); }
}

