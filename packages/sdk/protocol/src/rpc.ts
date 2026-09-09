import type {ChangeSet, CreateChangeSet, UpdateChangeSet, ChangeStatus} from '../../../core/protocol/src/index.js';
import type {CreateDataRecord, DataEnvelope, DataKind, UpdateDataRecord} from '../../../core/data/src/index.js';
import type {CapabilityCandidateInput} from '../../../core/capability-candidate/src/index.js';
import type {ContinuityEnvelope, CreateDiscussionTurn, CreateReceipt, CreateThread, UpdateThread} from '../../../core/continuity/src/index.js';

export interface RpcRequest<P = unknown> {
  id: string;
  method: RpcMethod;
  params: P;
}

export interface RpcError {
  code: string;
  message: string;
}

export type RpcMethod = 'change.create' | 'change.update' | 'change.list' | 'data.create' | 'capability-candidate.create' | 'data.update' | 'data.list' | 'data.verify' | 'continuity.thread.create' | 'continuity.thread.update' | 'continuity.turn.create' | 'continuity.receipt.create' | 'continuity.list';

export interface RpcParams {
  'change.create': CreateChangeSet;
  'change.update': {change_id: string} & UpdateChangeSet;
  'change.list': {status?: ChangeStatus};
  'data.create': CreateDataRecord;
  'capability-candidate.create': CapabilityCandidateInput;
  'data.update': {record_id: string} & UpdateDataRecord;
  'data.list': {kind?: DataKind};
  'data.verify': {record_id: string};
  'continuity.thread.create': CreateThread;
  'continuity.thread.update': {thread_id: string} & UpdateThread;
  'continuity.turn.create': CreateDiscussionTurn;
  'continuity.receipt.create': CreateReceipt;
  'continuity.list': {thread_id?: string};
}

export interface RpcResults {
  'change.create': {status: 'created' | 'no_change'; record: ChangeSet};
  'change.update': {status: 'updated'; record: ChangeSet};
  'change.list': {status: 'listed'; records: ChangeSet[]};
  'data.create': {status: 'created'; record: DataEnvelope};
  'capability-candidate.create': {status: 'created'; record: DataEnvelope};
  'data.update': {status: 'updated'; record: DataEnvelope};
  'data.list': {status: 'listed'; records: DataEnvelope[]};
  'data.verify': {root_record_id: string; record_ids: string[]; edge_count: number; complete: true};
  'continuity.thread.create': {status: 'created' | 'no_change'; record: ContinuityEnvelope};
  'continuity.thread.update': {status: 'updated'; record: ContinuityEnvelope};
  'continuity.turn.create': {status: 'created'; record: ContinuityEnvelope};
  'continuity.receipt.create': {status: 'created'; record: ContinuityEnvelope};
  'continuity.list': {status: 'listed'; records: ContinuityEnvelope[]};
}

export type RpcResponse<M extends RpcMethod = RpcMethod> = {id: string; result: RpcResults[M]} | {id: string; error: RpcError};
