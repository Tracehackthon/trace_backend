import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {StorageError, recordIdentity, type VersionedRecord, type VersionedStore} from './jsonl.js';

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

/**
 * SQLite implementation of the same append-only versioned-store seam used by
 * JSONL. The database is a local product state store; protocol validation stays
 * in the core ledgers, while this module only owns durable rows and CAS.
 */
export class SqliteVersionedStore<T extends VersionedRecord> implements VersionedStore<T> {
  private readonly db: DatabaseSync;
  private readonly table: string;

  constructor(file: string, table: string) {
    const target = absolute(file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    this.db = new DatabaseSync(target);
    this.table = tableName(table);
    this.db.exec('PRAGMA journal_mode = WAL');
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

  private appendUnsafe(record: T): void {
    const id = recordIdentity(record);
    const current = this.latest().find(item => recordIdentity(item) === id);
    if (!current && record.revision !== 1) throw new StorageError('INVALID_REVISION', 'The first revision must be 1');
    if (current && record.revision !== current.revision + 1) throw new StorageError('INVALID_REVISION', `Expected revision ${current.revision + 1}, found ${record.revision}`);
    this.db.prepare(`INSERT INTO ${this.table}(identity, revision, payload) VALUES (?, ?, ?)`).run(id, record.revision, JSON.stringify(record));
  }

  append(record: T): void {
    try {
      this.withWrite(() => this.appendUnsafe(record));
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError('SQLITE_WRITE_FAILED', String(error));
    }
  }

  appendIfAbsent(record: T): {record: T; inserted: boolean} {
    try {
      return this.withWrite(() => {
        const id = recordIdentity(record);
        const existing = this.latest().find(item => recordIdentity(item) === id);
        if (existing) return {record: existing, inserted: false};
        this.appendUnsafe(record);
        return {record, inserted: true};
      });
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError('SQLITE_WRITE_FAILED', String(error));
    }
  }

  compareAndSwap(recordId: string, expectedRevision: number, update: (current: T) => T): T {
    try {
      return this.withWrite(() => {
        const current = this.latest().find(item => recordIdentity(item) === recordId);
        if (!current) throw new StorageError('NOT_FOUND', `Unknown versioned record: ${recordId}`);
        if (current.revision !== expectedRevision) throw new StorageError('REVISION_CONFLICT', `Expected revision ${expectedRevision}, found ${current.revision}`);
        const next = update(current);
        if (recordIdentity(next) !== recordIdentity(current) || next.revision !== current.revision + 1) throw new StorageError('INVALID_REVISION', 'Updates must increment exactly one revision and preserve record identity');
        this.appendUnsafe(next);
        return next;
      });
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError('SQLITE_WRITE_FAILED', String(error));
    }
  }

  close(): void { this.db.close(); }
}
