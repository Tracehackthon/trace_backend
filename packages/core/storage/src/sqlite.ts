import fs from 'node:fs';
import path from 'node:path';
import {StorageError, recordIdentity, type VersionedRecord, type VersionedStore} from './jsonl.js';
import {openSqlite, type SqliteDatabase, type SqliteDriverInfo} from './sqlite-driver.js';

export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

function absolute(file: string): string {
  if (!path.isAbsolute(file)) throw new StorageError('INVALID_PATH', 'SQLite state file must be an absolute path');
  return path.resolve(file);
}

function tableName(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(value)) throw new StorageError('INVALID_TABLE', `Invalid SQLite table name: ${value}`);
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 'undefined' : encoded;
}

function writeError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const message = String(error);
  if (/SQLITE_BUSY|database is locked|database is busy/i.test(message)) return new StorageError('SQLITE_BUSY', message);
  return new StorageError('SQLITE_WRITE_FAILED', message);
}

/**
 * SQLite implementation of the same append-only versioned-store seam used by
 * JSONL. The database is a local product state store; protocol validation stays
 * in the core ledgers, while this module only owns durable rows and CAS.
 */
export class SqliteVersionedStore<T extends VersionedRecord> implements VersionedStore<T> {
  private readonly db: SqliteDatabase;
  private readonly table: string;
  readonly driver: SqliteDriverInfo;

  constructor(file: string, table: string) {
    const target = absolute(file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    const opened = openSqlite(target);
    this.db = opened.db;
    this.driver = opened.driver;
    this.table = tableName(table);
    this.db.exec('PRAGMA journal_mode = WAL');
    // WAL only allows readers to proceed while a writer holds the lock. A
    // bounded busy timeout makes independent Codex/CLI processes wait for that
    // writer instead of failing immediately with SQLITE_BUSY.
    this.db.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${this.table} (
      identity TEXT NOT NULL,
      revision INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (identity, revision)
    )`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS ${this.table}_identity_idx ON ${this.table}(identity, revision)`);
  }

  all(): T[] {
    const rows = this.db.prepare(`SELECT payload FROM ${this.table} ORDER BY identity, revision`).all() as Array<{payload: string}>;
    return rows.map(row => {
      try { return JSON.parse(row.payload) as T; } catch { throw new StorageError('INVALID_JSON', `Invalid JSON payload in SQLite table ${this.table}`); }
    });
  }

  latest(): T[] {
    const byId = new Map<string, Map<number, T>>();
    for (const record of this.all()) {
      const id = recordIdentity(record);
      if (!Number.isInteger(record.revision) || record.revision < 1) throw new StorageError('INVALID_REVISION', 'Every record must have a positive integer revision');
      const revisions = byId.get(id) ?? new Map<number, T>();
      const prior = revisions.get(record.revision);
      if (prior && stableJson(prior) !== stableJson(record)) throw new StorageError('DUPLICATE_REVISION', `Conflicting duplicate revision ${id}@${record.revision}`);
      revisions.set(record.revision, record);
      byId.set(id, revisions);
    }
    const latest: T[] = [];
    for (const [id, revisions] of byId) {
      const ordered = [...revisions.keys()].sort((a, b) => a - b);
      for (let index = 0; index < ordered.length; index += 1) {
        if (ordered[index] !== index + 1) throw new StorageError('REVISION_GAP', `Missing revision ${id}@${index + 1}`);
      }
      latest.push(revisions.get(ordered.at(-1)!)!);
    }
    return latest;
  }

  read(recordId: string, revision?: number): T | undefined {
    if (!recordId) throw new StorageError('INVALID_IDENTITY', 'recordId must be non-empty');
    // The hot path only scans revisions for the one identity being written. It
    // therefore preserves the no-gap invariant without reparsing unrelated
    // history on every Codex lifecycle event.
    const rows = this.db.prepare(`SELECT identity, revision, payload FROM ${this.table} WHERE identity = ? ORDER BY revision`).all(recordId) as Array<{identity: string; revision: number; payload: string}>;
    const records = rows.map(row => {
      let value: T;
      try { value = JSON.parse(row.payload) as T; } catch { throw new StorageError('INVALID_JSON', `Invalid JSON payload in SQLite table ${this.table}`); }
      if (recordIdentity(value) !== row.identity || value.revision !== Number(row.revision)) throw new StorageError('ROW_PAYLOAD_MISMATCH', `SQLite row identity does not match payload in ${this.table}`);
      return value;
    });
    for (let index = 0; index < records.length; index += 1) if (records[index]!.revision !== index + 1) throw new StorageError('REVISION_GAP', `Missing revision ${recordId}@${index + 1}`);
    return revision === undefined ? records.at(-1) : records.find(item => item.revision === revision);
  }

  private withWrite<TValue>(fn: () => TValue): TValue {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve the original failure */ }
      throw error;
    }
  }

  private appendUnsafe(record: T, current = this.read(recordIdentity(record))): void {
    const id = recordIdentity(record);
    if (!current && record.revision !== 1) throw new StorageError('INVALID_REVISION', 'The first revision must be 1');
    if (current && record.revision !== current.revision + 1) throw new StorageError('INVALID_REVISION', `Expected revision ${current.revision + 1}, found ${record.revision}`);
    this.db.prepare(`INSERT INTO ${this.table}(identity, revision, payload) VALUES (?, ?, ?)`).run(id, record.revision, JSON.stringify(record));
  }

  append(record: T): void {
    try {
      this.withWrite(() => this.appendUnsafe(record));
    } catch (error) {
      throw writeError(error);
    }
  }

  appendIfAbsent(record: T): {record: T; inserted: boolean} {
    try {
      return this.withWrite(() => {
        const id = recordIdentity(record);
        const existing = this.read(id);
        if (existing) return {record: existing, inserted: false};
        this.appendUnsafe(record, undefined);
        return {record, inserted: true};
      });
    } catch (error) {
      throw writeError(error);
    }
  }

  compareAndSwap(recordId: string, expectedRevision: number, update: (current: T) => T): T {
    try {
      return this.withWrite(() => {
        const current = this.read(recordId);
        if (!current) throw new StorageError('NOT_FOUND', `Unknown versioned record: ${recordId}`);
        if (current.revision !== expectedRevision) throw new StorageError('REVISION_CONFLICT', `Expected revision ${expectedRevision}, found ${current.revision}`);
        const next = update(current);
        if (recordIdentity(next) !== recordIdentity(current) || next.revision !== current.revision + 1) throw new StorageError('INVALID_REVISION', 'Updates must increment exactly one revision and preserve record identity');
        this.appendUnsafe(next, current);
        return next;
      });
    } catch (error) {
      throw writeError(error);
    }
  }

  close(): void { this.db.close(); }
}
