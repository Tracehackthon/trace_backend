import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {SQLITE_BUSY_TIMEOUT_MS, StorageError} from '../../storage/src/index.js';

export const TRACE_EVENT_PROTOCOL_ID = 'trace.runtime-event' as const;
export const TRACE_EVENT_PROTOCOL_VERSION = '0.1.0' as const;

export type TraceEventOutcome = 'success' | 'failure';

/**
 * A deliberately narrow event contract. It captures operation provenance but
 * has no generic payload field, so raw prompts, source bodies, secrets and
 * tool arguments cannot accidentally enter the runtime event ledger.
 */
export interface TraceEvent {
  protocol_id: typeof TRACE_EVENT_PROTOCOL_ID;
  protocol_version: typeof TRACE_EVENT_PROTOCOL_VERSION;
  event_id: string;
  occurred_at: string;
  component: string;
  operation: string;
  outcome: TraceEventOutcome;
  correlation_id: string;
  causation_id: string;
  thread_id?: string;
  record_refs: string[];
  duration_ms?: number;
  error_code?: string;
}

export interface CreateTraceEvent {
  component: string;
  operation: string;
  outcome: TraceEventOutcome;
  correlation_id: string;
  causation_id: string;
  thread_id?: string;
  record_refs?: string[];
  duration_ms?: number;
  error_code?: string;
}

function absolute(file: string): string {
  if (!path.isAbsolute(file)) throw new StorageError('INVALID_PATH', 'SQLite event database must be an absolute path');
  return path.resolve(file);
}

function text(value: unknown, field: string, max = 240): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max || /[\r\n]/.test(value)) throw new StorageError('INVALID_TRACE_EVENT', `${field} must be a non-empty single-line string of at most ${max} characters`);
  return value.trim();
}

function recordRefs(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128) throw new StorageError('INVALID_TRACE_EVENT', 'record_refs must contain at most 128 references');
  return value.map((item, index) => text(item, `record_refs[${index}]`, 320));
}

function optionalText(value: unknown, field: string, max = 240): string | undefined {
  return value === undefined ? undefined : text(value, field, max);
}

function optionalDuration(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 86_400_000) throw new StorageError('INVALID_TRACE_EVENT', 'duration_ms must be an integer between 0 and 86400000');
  return Number(value);
}

export function buildTraceEvent(input: CreateTraceEvent, eventId = `trace-event-${randomUUID()}`, occurredAt = new Date().toISOString()): TraceEvent {
  if (input.outcome !== 'success' && input.outcome !== 'failure') throw new StorageError('INVALID_TRACE_EVENT', 'outcome must be success or failure');
  const duration = optionalDuration(input.duration_ms);
  const errorCode = optionalText(input.error_code, 'error_code', 120);
  return {
    protocol_id: TRACE_EVENT_PROTOCOL_ID,
    protocol_version: TRACE_EVENT_PROTOCOL_VERSION,
    event_id: text(eventId, 'event_id'),
    occurred_at: text(occurredAt, 'occurred_at', 80),
    component: text(input.component, 'component', 160),
    operation: text(input.operation, 'operation', 160),
    outcome: input.outcome,
    correlation_id: text(input.correlation_id, 'correlation_id'),
    causation_id: text(input.causation_id, 'causation_id'),
    ...(input.thread_id === undefined ? {} : {thread_id: optionalText(input.thread_id, 'thread_id')!}),
    record_refs: recordRefs(input.record_refs),
    ...(duration === undefined ? {} : {duration_ms: duration}),
    ...(errorCode === undefined ? {} : {error_code: errorCode}),
  };
}

export function validateTraceEvent(value: unknown): TraceEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StorageError('INVALID_TRACE_EVENT', 'trace event must be an object');
  const item = value as Record<string, unknown>;
  const allowed = ['protocol_id', 'protocol_version', 'event_id', 'occurred_at', 'component', 'operation', 'outcome', 'correlation_id', 'causation_id', 'thread_id', 'record_refs', 'duration_ms', 'error_code'];
  const unknown = Object.keys(item).filter(key => !allowed.includes(key));
  if (unknown.length > 0) throw new StorageError('INVALID_TRACE_EVENT', `trace event contains unsupported fields: ${unknown.join(', ')}`);
  if (item.protocol_id !== TRACE_EVENT_PROTOCOL_ID || item.protocol_version !== TRACE_EVENT_PROTOCOL_VERSION) throw new StorageError('TRACE_EVENT_PROTOCOL_MISMATCH', 'Unsupported trace event protocol');
  const duration = optionalDuration(item.duration_ms);
  const errorCode = optionalText(item.error_code, 'error_code', 120);
  return buildTraceEvent({
    component: text(item.component, 'component', 160),
    operation: text(item.operation, 'operation', 160),
    outcome: item.outcome as TraceEventOutcome,
    correlation_id: text(item.correlation_id, 'correlation_id'),
    causation_id: text(item.causation_id, 'causation_id'),
    ...(item.thread_id === undefined ? {} : {thread_id: optionalText(item.thread_id, 'thread_id')!}),
    record_refs: recordRefs(item.record_refs),
    ...(duration === undefined ? {} : {duration_ms: duration}),
    ...(errorCode === undefined ? {} : {error_code: errorCode}),
  }, text(item.event_id, 'event_id'), text(item.occurred_at, 'occurred_at', 80));
}

/** Decode nullable SQLite columns without admitting a free-form event payload. */
export function traceEventFromSqliteRow(row: Record<string, unknown>): TraceEvent {
  const threadId = row.thread_id;
  const duration = row.duration_ms;
  const errorCode = row.error_code;
  return validateTraceEvent({
    protocol_id: TRACE_EVENT_PROTOCOL_ID,
    protocol_version: TRACE_EVENT_PROTOCOL_VERSION,
    event_id: row.event_id,
    occurred_at: row.occurred_at,
    component: row.component,
    operation: row.operation,
    outcome: row.outcome,
    correlation_id: row.correlation_id,
    causation_id: row.causation_id,
    ...(threadId === null || threadId === undefined ? {} : {thread_id: threadId}),
    record_refs: JSON.parse(String(row.record_refs)),
    ...(duration === null || duration === undefined ? {} : {duration_ms: duration}),
    ...(errorCode === null || errorCode === undefined ? {} : {error_code: errorCode}),
  });
}

function sqliteError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const message = String(error);
  if (/SQLITE_BUSY|database is locked|database is busy/i.test(message)) return new StorageError('SQLITE_BUSY', message);
  return new StorageError('SQLITE_TRACE_EVENT_FAILED', message);
}

export class SqliteTraceEventStore {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    const target = absolute(file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    this.db = new DatabaseSync(target);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS trace_events (
      event_id TEXT NOT NULL PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      component TEXT NOT NULL,
      operation TEXT NOT NULL,
      outcome TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      causation_id TEXT NOT NULL,
      thread_id TEXT,
      record_refs TEXT NOT NULL,
      duration_ms INTEGER,
      error_code TEXT
    )`);
    this.db.exec('CREATE INDEX IF NOT EXISTS trace_events_correlation_at_idx ON trace_events(correlation_id, occurred_at, event_id)');
  }

  record(input: CreateTraceEvent): TraceEvent {
    const event = buildTraceEvent(input);
    try {
      this.db.prepare('INSERT INTO trace_events(event_id, occurred_at, component, operation, outcome, correlation_id, causation_id, thread_id, record_refs, duration_ms, error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(event.event_id, event.occurred_at, event.component, event.operation, event.outcome, event.correlation_id, event.causation_id, event.thread_id ?? null, JSON.stringify(event.record_refs), event.duration_ms ?? null, event.error_code ?? null);
      return event;
    } catch (error) {
      throw sqliteError(error);
    }
  }

  byCorrelation(correlationId: string): TraceEvent[] {
    const correlation = text(correlationId, 'correlation_id');
    try {
      const rows = this.db.prepare('SELECT event_id, occurred_at, component, operation, outcome, correlation_id, causation_id, thread_id, record_refs, duration_ms, error_code FROM trace_events WHERE correlation_id = ? ORDER BY occurred_at, event_id').all(correlation) as Array<Record<string, unknown>>;
      return rows.map(traceEventFromSqliteRow);
    } catch (error) {
      throw sqliteError(error);
    }
  }

  close(): void { this.db.close(); }
}
