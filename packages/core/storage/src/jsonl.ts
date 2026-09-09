import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export class StorageError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TraceStorageError';
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 'undefined' : encoded;
}

function absolute(file: string): string {
  if (!path.isAbsolute(file)) throw new StorageError('INVALID_PATH', 'State file must be an absolute path');
  return path.resolve(file);
}

export function readJsonl<T>(file: string, maxBytes = 16 * 1024 * 1024): T[] {
  const target = absolute(file);
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (!stat.isFile() || stat.size > maxBytes) throw new StorageError('BYTE_LIMIT', `State file exceeds ${maxBytes} bytes`);
  const text = fs.readFileSync(target, 'utf8');
  const result: T[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      result.push(JSON.parse(line) as T);
    } catch {
      throw new StorageError('INVALID_JSONL', `Invalid JSONL at ${target}:${index + 1}`);
    }
  }
  return result;
}

function ensureParent(file: string): void {
  fs.mkdirSync(path.dirname(file), {recursive: true});
}

export function appendJsonl<T>(file: string, value: T): void {
  const target = absolute(file);
  ensureParent(target);
  fs.appendFileSync(target, JSON.stringify(value) + '\n', 'utf8');
}

/**
 * A short-lived exclusive lock for one append-only state stream. The lock is
 * deliberately a file beside the stream so the state root remains inspectable
 * and callers can recover a stale lock explicitly instead of silently merging.
 */
export function withFileLock<T>(file: string, fn: () => T): T {
  const target = absolute(file);
  const lock = `${target}.lock`;
  ensureParent(lock);
  let fd: number;
  try {
    fd = fs.openSync(lock, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StorageError('STATE_BUSY', `State lock exists: ${lock}`);
    throw error;
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({pid: process.pid, token: randomUUID()}), 'utf8');
    return fn();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, {force: true});
  }
}

export interface VersionedRecord {
  change_id?: string;
  record_id?: string;
  revision: number;
}

export function recordIdentity(record: VersionedRecord): string {
  const value = record.change_id ?? record.record_id;
  if (typeof value !== 'string' || !value) throw new StorageError('INVALID_IDENTITY', 'Every record must have a non-empty change_id or record_id');
  return value;
}

export interface VersionedStore<T extends VersionedRecord> {
  all(): T[];
  latest(): T[];
  /**
   * Read a single identity (or an exact historical revision). SQLite can serve
   * this through its primary-key index; JSONL keeps the compatible fallback.
   */
  read(recordId: string, revision?: number): T | undefined;
  append(record: T): void;
  appendIfAbsent(record: T): {record: T; inserted: boolean};
  compareAndSwap(recordId: string, expectedRevision: number, update: (current: T) => T): T;
  close?(): void;
}

export class AppendOnlyStore<T extends VersionedRecord> implements VersionedStore<T> {
  constructor(readonly file: string) {}

  all(): T[] {
    return readJsonl<T>(this.file);
  }

  latest(): T[] {
    const byId = new Map<string, Map<number, T>>();
    for (const record of this.all()) {
      const recordId = recordIdentity(record);
      if (!Number.isInteger(record.revision) || record.revision < 1) throw new StorageError('INVALID_REVISION', 'Every record must have a positive integer revision');
      const revisions = byId.get(recordId) ?? new Map<number, T>();
      const prior = revisions.get(record.revision);
      if (prior && stableJson(prior) !== stableJson(record)) throw new StorageError('DUPLICATE_REVISION', `Conflicting duplicate revision ${record.change_id}@${record.revision}`);
      revisions.set(record.revision, record);
      byId.set(recordId, revisions);
    }
    const latest: T[] = [];
    for (const [changeId, revisions] of byId) {
      const ordered = [...revisions.keys()].sort((a, b) => a - b);
      for (let index = 0; index < ordered.length; index += 1) {
        if (ordered[index] !== index + 1) throw new StorageError('REVISION_GAP', `Missing revision ${changeId}@${index + 1}`);
      }
      latest.push(revisions.get(ordered.at(-1)!)!);
    }
    return latest;
  }

  read(recordId: string, revision?: number): T | undefined {
    if (revision === undefined) return this.latest().find(item => recordIdentity(item) === recordId);
    const records = this.all().filter(item => recordIdentity(item) === recordId && item.revision === revision);
    if (records.length > 1) {
      const first = records[0]!;
      if (records.some(item => stableJson(item) !== stableJson(first))) throw new StorageError('DUPLICATE_REVISION', `Conflicting duplicate revision ${recordId}@${revision}`);
    }
    return records[0];
  }

  append(record: T): void {
    withFileLock(this.file, () => {
      const current = this.latest().find(item => recordIdentity(item) === recordIdentity(record));
      if (!current && record.revision !== 1) throw new StorageError('INVALID_REVISION', 'The first revision must be 1');
      if (current && record.revision !== current.revision + 1) throw new StorageError('INVALID_REVISION', `Expected revision ${current.revision + 1}, found ${record.revision}`);
      appendJsonl(this.file, record);
    });
  }

  appendIfAbsent(record: T): {record: T; inserted: boolean} {
    return withFileLock(this.file, () => {
      const existing = this.latest().find(item => recordIdentity(item) === recordIdentity(record));
      if (existing) return {record: existing, inserted: false};
      appendJsonl(this.file, record);
      return {record, inserted: true};
    });
  }

  compareAndSwap(changeId: string, expectedRevision: number, update: (current: T) => T): T {
    return withFileLock(this.file, () => {
      const current = this.latest().find(item => recordIdentity(item) === changeId);
      if (!current) throw new StorageError('NOT_FOUND', `Unknown versioned record: ${changeId}`);
      if (current.revision !== expectedRevision) throw new StorageError('REVISION_CONFLICT', `Expected revision ${expectedRevision}, found ${current.revision}`);
      const next = update(current);
      if (recordIdentity(next) !== recordIdentity(current) || next.revision !== current.revision + 1) throw new StorageError('INVALID_REVISION', 'Updates must increment exactly one revision and preserve record identity');
      appendJsonl(this.file, next);
      return next;
    });
  }
}

