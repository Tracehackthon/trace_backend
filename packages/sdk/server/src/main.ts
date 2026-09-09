import readline from 'node:readline';
import {TraceRuntime} from '../../../core/runtime/src/index.js';
import {CHANGE_KINDS, CHANGE_STATUSES, type ChangeKind, type ChangeStatus, ProtocolError} from '../../../core/protocol/src/index.js';
import {DATA_KINDS, type DataKind} from '../../../core/data/src/index.js';
import type {RpcMethod} from '../../protocol/src/index.js';

function runtimePaths(argv: string[]): {changeStateFile?: string; dataStateFile?: string; continuityStateFile?: string; sqliteStateFile?: string} {
  const read = (flag: string): string => {
    const index = argv.indexOf(flag);
    const value = index >= 0 ? argv[index + 1] : undefined;
    if (!value || value.startsWith('--')) throw new ProtocolError('INVALID_INPUT', `RPC server requires ${flag} ABSOLUTE_PATH`);
    return value;
  };
  const sqliteIndex = argv.indexOf('--sqlite-state-file');
  const sqlite = sqliteIndex >= 0 ? argv[sqliteIndex + 1] : undefined;
  if (sqlite && !sqlite.startsWith('--')) return {sqliteStateFile: sqlite};
  const continuity = argv.includes('--continuity-state-file') ? read('--continuity-state-file') : undefined;
  return {changeStateFile: read('--change-state-file'), dataStateFile: read('--data-state-file'), ...(continuity === undefined ? {} : {continuityStateFile: continuity})};
}

const runtime = new TraceRuntime(runtimePaths(process.argv.slice(2)));
const input = readline.createInterface({input: process.stdin, crlfDelay: Infinity});

function reply(id: string, value: unknown): void {
  process.stdout.write(JSON.stringify({id, result: value}) + '\n');
}

function failure(id: string | null, error: unknown): void {
  const known = error as {code?: string; message?: string};
  process.stdout.write(JSON.stringify({id, error: {code: known.code ?? 'IO_ERROR', message: known.message ?? String(error)}}) + '\n');
}

for await (const line of input) {
  if (!line.trim()) continue;
  let request: {id?: unknown; method?: unknown; params?: unknown};
  try { request = JSON.parse(line) as typeof request; } catch { failure(null, new ProtocolError('INVALID_JSON', 'RPC input must be one JSON object per line')); continue; }
  try {
    const id = typeof request.id === 'string' ? request.id : null;
    if (!id || typeof request.method !== 'string') throw new ProtocolError('INVALID_INPUT', 'RPC request requires string id and method');
    const method = request.method as RpcMethod;
    const params = (request.params ?? {}) as Record<string, unknown>;
    if (method === 'change.create') {
      if (!CHANGE_KINDS.includes(params.change_kind as ChangeKind)) throw new ProtocolError('INVALID_INPUT', 'Unsupported change_kind');
      reply(id, runtime.createChange(params as never));
    } else if (method === 'change.update') {
      if (!CHANGE_STATUSES.includes(params.status as ChangeStatus)) throw new ProtocolError('INVALID_INPUT', 'Unsupported status');
      const {change_id, ...update} = params;
      if (typeof change_id !== 'string') throw new ProtocolError('INVALID_INPUT', 'change_id is required');
      reply(id, {status: 'updated', record: runtime.updateChange(change_id, update as never)});
    } else if (method === 'change.list') {
      const status = params.status;
      if (status !== undefined && !CHANGE_STATUSES.includes(status as ChangeStatus)) throw new ProtocolError('INVALID_INPUT', 'Unsupported status');
      reply(id, {status: 'listed', records: runtime.listChanges(status as ChangeStatus | undefined)});
    } else if (method === 'data.create') {
      if (!DATA_KINDS.includes(params.kind as DataKind)) throw new ProtocolError('INVALID_INPUT', 'Unsupported data kind');
      reply(id, {status: 'created', record: runtime.createData(params as never)});
    } else if (method === 'capability-candidate.create') {
      reply(id, {status: 'created', record: runtime.createCapabilityCandidate(params as never)});
    } else if (method === 'data.update') {
      const {record_id, ...update} = params;
      if (typeof record_id !== 'string') throw new ProtocolError('INVALID_INPUT', 'record_id is required');
      reply(id, {status: 'updated', record: runtime.updateData(record_id, update as never)});
    } else if (method === 'data.list') {
      const kind = params.kind;
      if (kind !== undefined && !DATA_KINDS.includes(kind as DataKind)) throw new ProtocolError('INVALID_INPUT', 'Unsupported data kind');
      reply(id, {status: 'listed', records: runtime.listData(kind as DataKind | undefined)});
    } else if (method === 'data.verify') {
      if (typeof params.record_id !== 'string') throw new ProtocolError('INVALID_INPUT', 'record_id is required');
      reply(id, runtime.verifyDataChain(params.record_id));
    } else if (method === 'continuity.thread.create') {
      reply(id, {status: 'created', record: runtime.createThread(params as never)});
    } else if (method === 'continuity.thread.update') {
      const {thread_id, ...update} = params;
      if (typeof thread_id !== 'string') throw new ProtocolError('INVALID_INPUT', 'thread_id is required');
      reply(id, {status: 'updated', record: runtime.updateThread(thread_id, update as never)});
    } else if (method === 'continuity.turn.create') {
      reply(id, {status: 'created', record: runtime.appendDiscussionTurn(params as never)});
    } else if (method === 'continuity.receipt.create') {
      reply(id, {status: 'created', record: runtime.createReceipt(params as never)});
    } else if (method === 'continuity.list') {
      const threadId = params.thread_id;
      if (threadId !== undefined && typeof threadId !== 'string') throw new ProtocolError('INVALID_INPUT', 'thread_id must be a string');
      reply(id, {status: 'listed', records: runtime.listContinuity(threadId)});
    } else {
      throw new ProtocolError('METHOD_NOT_FOUND', `Unknown method: ${String(request.method)}`);
    }
  } catch (error) { failure(typeof request?.id === 'string' ? request.id : null, error); }
}


