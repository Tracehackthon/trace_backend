import {AppendOnlyStore, SqliteVersionedStore, StorageError, type DatabaseIdentity, type VersionedRecord, type VersionedStore} from '../../storage/src/index.js';
import {ChangeSetService} from '../../change-set/src/index.js';
import {DataLedger} from '../../data/src/index.js';
import {ContinuityLedger, DecisionTrail, type CreateDecisionPoint, type CreateDiscussionTurn, type CreateReceipt, type CreateThread, type ResolveDecisionPoint, type ReviseDecisionPoint, type UpdateThread, type ContinuityEnvelope} from '../../continuity/src/index.js';
import {ProtocolError, type ChangeSet, type CreateChangeSet, type UpdateChangeSet, type ChangeStatus} from '../../protocol/src/index.js';
import type {CreateDataRecord, DataEnvelope, DataKind, UpdateDataRecord} from '../../data/src/index.js';
import {buildCapabilityCandidateRecord, type CapabilityCandidateInput} from '../../capability-candidate/src/index.js';
import {SqliteTraceEventStore, type CreateTraceEvent, type TraceEvent} from '../../observability/src/index.js';
import {PromptCaseCaptureService, type CapturePromptCase, type CreatePromptCaptureProposal, type CreatePromptCasePrecedent} from '../../case-capture/src/index.js';
import {buildHostRetrievalEvidenceRecord, type CreateHostRetrievalEvidence} from '../../retrieval-evidence/src/index.js';

export interface TraceRuntimePaths {
  changeStateFile?: string;
  dataStateFile?: string;
  continuityStateFile?: string;
  sqliteStateFile?: string;
  /** Optional explicit installation/workspace binding for a SQLite project DB. */
  workspaceId?: string;
  installationId?: string;
  runtimeVersion?: string;
  /** Legacy files are read-only unless this is explicitly enabled. */
  allowLegacyIdentity?: boolean;
  /** Migrate an old project DB only when both IDs are supplied explicitly. */
  upgradeLegacyIdentity?: boolean;
}

/**
 * The application-facing runtime seam. It owns no Codex or Python process;
 * those are adapters that call this service through the CLI/RPC boundary.
 */
export class TraceRuntime {
  readonly changes: ChangeSetService;
  readonly data: DataLedger;
  readonly continuity?: ContinuityLedger;
  readonly decisions?: DecisionTrail;
  readonly events?: SqliteTraceEventStore;
  readonly promptCases: PromptCaseCaptureService;
  private projectIdentity?: DatabaseIdentity;
  private readonly identityStores: Array<{upgradeIdentity(input: {workspaceId: string; installationId: string; runtimeVersion?: string}): DatabaseIdentity}> = [];
  private readonly allowLegacyIdentity: boolean;

  constructor(paths: TraceRuntimePaths) {
    this.allowLegacyIdentity = paths.allowLegacyIdentity ?? false;
    if (!paths.sqliteStateFile && (!paths.changeStateFile || !paths.dataStateFile)) throw new StorageError('INVALID_PATH', 'TraceRuntime requires either sqliteStateFile or both changeStateFile and dataStateFile');
    const sqliteOptions = {
      ...(paths.workspaceId === undefined ? {} : {workspaceId: paths.workspaceId}),
      ...(paths.installationId === undefined ? {} : {installationId: paths.installationId}),
      ...(paths.runtimeVersion === undefined ? {} : {runtimeVersion: paths.runtimeVersion}),
      allowLegacyIdentity: this.allowLegacyIdentity,
      ...(paths.upgradeLegacyIdentity === undefined ? {} : {upgradeLegacyIdentity: paths.upgradeLegacyIdentity}),
    };
    const makeSqliteStore = <T extends VersionedRecord>(table: string): SqliteVersionedStore<T> => {
      const store = new SqliteVersionedStore<T>(paths.sqliteStateFile!, table, sqliteOptions);
      this.identityStores.push(store);
      if (this.projectIdentity === undefined) this.projectIdentity = store.identity;
      return store;
    };
    const changeStore: VersionedStore<ChangeSet> = paths.sqliteStateFile ? makeSqliteStore<ChangeSet>('change_sets') : new AppendOnlyStore<ChangeSet>(paths.changeStateFile!);
    const dataStore: VersionedStore<DataEnvelope> = paths.sqliteStateFile ? makeSqliteStore<DataEnvelope>('data_records') : new AppendOnlyStore<DataEnvelope>(paths.dataStateFile!);
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
    this.promptCases = new PromptCaseCaptureService(this.data);
    if (paths.sqliteStateFile || paths.continuityStateFile) {
      const continuityStore: VersionedStore<ContinuityEnvelope> = paths.sqliteStateFile ? makeSqliteStore<ContinuityEnvelope>('continuity_records') : new AppendOnlyStore<ContinuityEnvelope>(paths.continuityStateFile!);
      this.continuity = new ContinuityLedger(continuityStore);
      this.decisions = new DecisionTrail(this.continuity);
    }
    if (paths.sqliteStateFile) this.events = new SqliteTraceEventStore(paths.sqliteStateFile, {
      allowLegacyIdentity: this.allowLegacyIdentity,
      ...(paths.workspaceId === undefined ? {} : {workspaceId: paths.workspaceId}),
      ...(paths.installationId === undefined ? {} : {installationId: paths.installationId}),
    });
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

  proposePromptCase(input: CreatePromptCaptureProposal) {
    const proposal = this.promptCases.propose(input);
    if (proposal.thread_id !== undefined && this.continuity !== undefined) {
      this.createReceipt({thread_id: proposal.thread_id, receipt_kind: 'persistence', summary: 'A prompt-case capture proposal was created; no raw prompt has been persisted.', persisted_refs: [proposal.proposal_ref.record_id + '@' + proposal.proposal_ref.revision], not_persisted: ['raw prompt'], required_user_action: `Choose summary, redacted_excerpt, or full_private and approve:${proposal.proposal_ref.record_id}.`, correlation_id: input.correlation_id, causation_id: input.causation_id});
    }
    return proposal;
  }

  capturePromptCase(input: CapturePromptCase) {
    const result = this.promptCases.capture(input);
    if (result.proposal.thread_id !== undefined && this.continuity !== undefined) {
      this.createReceipt({thread_id: result.proposal.thread_id, receipt_kind: 'persistence', summary: `A ${result.capture_mode} prompt case was explicitly persisted as a private source snapshot.`, persisted_refs: [result.proposal.proposal_ref.record_id + '@' + result.proposal.proposal_ref.revision, result.source_snapshot_ref.record_id + '@' + result.source_snapshot_ref.revision], not_persisted: [], next_prompts: ['Attach an outcome record, then create a candidate precedent if the case is reusable.'], correlation_id: input.correlation_id, causation_id: input.causation_id});
    }
    return result;
  }

  createPromptCasePrecedent(input: CreatePromptCasePrecedent) { return this.promptCases.createPrecedent(input); }

  /** Persist only the defined, provenance-only evidence contract for host source use. */
  recordHostRetrievalEvidence(input: CreateHostRetrievalEvidence) {
    return this.data.create(buildHostRetrievalEvidenceRecord(input));
  }

  updateData(recordId: string, input: UpdateDataRecord) {
    return this.data.update(recordId, input);
  }

  listData(kind?: DataKind) {
    return this.data.list(kind);
  }

  get identity(): DatabaseIdentity | undefined {
    return this.projectIdentity === undefined ? undefined : structuredClone(this.projectIdentity);
  }

  getIdentity(): DatabaseIdentity | undefined { return this.identity; }

  /** Explicitly bind a legacy project database to this installation/workspace. */
  upgradeIdentity(input: {workspaceId: string; installationId: string; runtimeVersion?: string}): DatabaseIdentity {
    if (this.identityStores.length === 0) throw new StorageError('IDENTITY_UNAVAILABLE', 'JSONL runtime has no SQLite identity metadata');
    let upgraded!: DatabaseIdentity;
    for (const store of this.identityStores) upgraded = store.upgradeIdentity(input);
    this.projectIdentity = upgraded;
    this.events?.syncIdentity(upgraded);
    return this.identity!;
  }

  verifyDataChain(recordId: string) {
    return this.data.verifyChain(recordId);
  }

  private requireContinuity(): ContinuityLedger {
    if (!this.continuity) throw new StorageError('CONTINUITY_UNAVAILABLE', 'Continuity state is not configured for this runtime');
    return this.continuity;
  }

  private requireDecisions(): DecisionTrail {
    if (!this.decisions) throw new StorageError('CONTINUITY_UNAVAILABLE', 'Continuity state is not configured for this runtime');
    return this.decisions;
  }

  createThread(input: CreateThread) { return this.requireContinuity().createThread(input); }
  updateThread(threadId: string, input: UpdateThread) { return this.requireContinuity().updateThread(threadId, input); }
  appendDiscussionTurn(input: CreateDiscussionTurn) { return this.requireContinuity().appendTurn(input); }
  createReceipt(input: CreateReceipt) { return this.requireContinuity().createReceipt(input); }
  listContinuity(threadId?: string) { return this.requireContinuity().list(threadId); }
  createDecisionPoint(input: CreateDecisionPoint) { return this.requireDecisions().createDecisionPoint(input); }
  resolveDecisionPoint(recordId: string, input: ResolveDecisionPoint) { return this.requireDecisions().resolveDecisionPoint(recordId, input); }
  reviseDecisionPoint(recordId: string, input: ReviseDecisionPoint) { return this.requireDecisions().reviseDecisionPoint(recordId, input); }
  pendingDecisions(threadId?: string) { return this.requireDecisions().pendingFor(threadId); }
  decisionPath(threadId: string) { return this.requireDecisions().pathFor(threadId); }
  recordTraceEvent(input: CreateTraceEvent): TraceEvent {
    if (!this.events) throw new StorageError('TRACE_EVENTS_UNAVAILABLE', 'Trace event storage requires sqliteStateFile');
    if (this.projectIdentity?.verification_state !== 'verified' && !this.allowLegacyIdentity) {
      throw new StorageError('LEGACY_IDENTITY_UNVERIFIED', 'Legacy SQLite state is read-only until it is explicitly upgraded with workspace and installation identity');
    }
    return this.events.record(input);
  }
  listTraceEvents(correlationId: string): TraceEvent[] {
    if (!this.events) throw new StorageError('TRACE_EVENTS_UNAVAILABLE', 'Trace event storage requires sqliteStateFile');
    return this.events.byCorrelation(correlationId);
  }
  close(): void {
    this.changes.store.close?.();
    this.data.store.close?.();
    this.continuity?.store.close?.();
    this.events?.close();
  }
}

