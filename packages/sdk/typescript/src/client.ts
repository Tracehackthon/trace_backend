import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import readline from 'node:readline';
import {randomUUID} from 'node:crypto';
import type {ChangeSet, CreateChangeSet, UpdateChangeSet, ChangeStatus} from '../../../core/protocol/src/index.js';
import type {CreateDataRecord, DataEnvelope, DataKind, UpdateDataRecord} from '../../../core/data/src/index.js';
import type {CapabilityCandidateInput} from '../../../core/capability-candidate/src/index.js';
import type {ContinuityEnvelope, CreateDiscussionTurn, CreateReceipt, CreateThread, UpdateThread} from '../../../core/continuity/src/index.js';

export interface RuntimeCommand {
  executable: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export class RuntimeRpcError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'TraceRuntimeRpcError'; }
}

type Pending = {resolve: (value: unknown) => void; reject: (error: Error) => void};

/** TypeScript SDK: drives the runtime process; it does not own domain state. */
export class TraceRuntimeClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private readonly pending = new Map<string, Pending>();
  private sequence = 0;

  constructor(readonly command: RuntimeCommand) {}

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = spawn(this.command.executable, this.command.args, {cwd: this.command.cwd, env: this.command.env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
    const lines = readline.createInterface({input: child.stdout, crlfDelay: Infinity});
    lines.on('line', line => {
      try {
        const value = JSON.parse(line) as {id?: string; result?: unknown; error?: {code?: string; message?: string}};
        if (!value.id) return;
        const pending = this.pending.get(value.id);
        if (!pending) return;
        this.pending.delete(value.id);
        if (value.error) pending.reject(new RuntimeRpcError(value.error.code ?? 'RPC_ERROR', value.error.message ?? 'Runtime request failed'));
        else pending.resolve(value.result);
      } catch (error) { this.failPending(error instanceof Error ? error : new Error(String(error))); }
    });
    const onExit = () => { this.child = undefined; this.failPending(new RuntimeRpcError('TRANSPORT_CLOSED', 'Trace runtime exited')); };
    child.once('error', onExit);
    child.once('close', onExit);
    this.child = child;
    return child;
  }

  private failPending(error: Error): void {
    for (const {reject} of this.pending.values()) reject(error);
    this.pending.clear();
  }

  request<T>(method: string, params: unknown): Promise<T> {
    const child = this.ensureStarted();
    const id = `ts-${++this.sequence}-${randomUUID().slice(0, 8)}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {resolve: resolve as (value: unknown) => void, reject});
      child.stdin.write(JSON.stringify({id, method, params}) + '\n', error => {
        if (error) { this.pending.delete(id); reject(error); }
      });
    });
  }

  createChange(input: CreateChangeSet): Promise<{status: 'created' | 'no_change'; record: ChangeSet}> { return this.request('change.create', input); }
  updateChange(changeId: string, input: UpdateChangeSet): Promise<{status: 'updated'; record: ChangeSet}> { return this.request('change.update', {change_id: changeId, ...input}); }
  listChanges(status?: ChangeStatus): Promise<{status: 'listed'; records: ChangeSet[]}> { return this.request('change.list', status === undefined ? {} : {status}); }
  createData(input: CreateDataRecord): Promise<{status: 'created'; record: DataEnvelope}> { return this.request('data.create', input); }
  createCapabilityCandidate(input: CapabilityCandidateInput): Promise<{status: 'created'; record: DataEnvelope}> { return this.request('capability-candidate.create', input); }
  updateData(recordId: string, input: UpdateDataRecord): Promise<{status: 'updated'; record: DataEnvelope}> { return this.request('data.update', {record_id: recordId, ...input}); }
  listData(kind?: DataKind): Promise<{status: 'listed'; records: DataEnvelope[]}> { return this.request('data.list', kind === undefined ? {} : {kind}); }
  verifyDataChain(recordId: string): Promise<{root_record_id: string; record_ids: string[]; edge_count: number; complete: true}> { return this.request('data.verify', {record_id: recordId}); }
  createThread(input: CreateThread): Promise<{status: 'created' | 'no_change'; record: ContinuityEnvelope}> { return this.request('continuity.thread.create', input); }
  updateThread(threadId: string, input: UpdateThread): Promise<{status: 'updated'; record: ContinuityEnvelope}> { return this.request('continuity.thread.update', {thread_id: threadId, ...input}); }
  appendDiscussionTurn(input: CreateDiscussionTurn): Promise<{status: 'created'; record: ContinuityEnvelope}> { return this.request('continuity.turn.create', input); }
  createReceipt(input: CreateReceipt): Promise<{status: 'created'; record: ContinuityEnvelope}> { return this.request('continuity.receipt.create', input); }
  listContinuity(threadId?: string): Promise<{status: 'listed'; records: ContinuityEnvelope[]}> { return this.request('continuity.list', threadId === undefined ? {} : {thread_id: threadId}); }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    child.stdin.end();
    await new Promise<void>(resolve => child.once('close', () => resolve()));
  }
}


