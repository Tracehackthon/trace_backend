import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {StorageError} from './jsonl.js';

/** The small synchronous SQLite surface required by Trace's append-only stores. */
export interface SqliteStatement {
  all(...parameters: unknown[]): unknown[];
  get(...parameters: unknown[]): unknown;
  run(...parameters: unknown[]): unknown;
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export type SqliteDriverPreference = 'auto' | 'node' | 'sql.js';
export type SqliteDriverKind = 'node:sqlite' | 'sql.js';

export interface SqliteDriverInfo {
  kind: SqliteDriverKind;
  /** Present only when the selected driver has a runtime caveat. */
  warning?: string;
}

export interface OpenSqliteOptions {
  readOnly?: boolean;
  driver?: SqliteDriverPreference;
}

export interface OpenSqliteResult {
  db: SqliteDatabase;
  driver: SqliteDriverInfo;
}

interface NodeSqliteModule {
  DatabaseSync: new (file: string, options?: {readOnly?: boolean}) => SqliteDatabase;
}

interface SqlJsStatement {
  bind(parameters?: unknown[]): void;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  run(parameters?: unknown[]): void;
  free(): void;
}

interface SqlJsDatabase {
  run(sql: string, parameters?: unknown[]): void;
  prepare(sql: string): SqlJsStatement;
  export(): Uint8Array;
  close(): void;
}

interface SqlJsModule {
  Database: new (bytes?: Uint8Array) => SqlJsDatabase;
}

const requireFromHere = createRequire(import.meta.url);
const sqlJsFactory = requireFromHere('sql.js/dist/sql-asm.js') as () => Promise<SqlJsModule>;
// The selected sql.js asm build is audited and has no native node-gyp dependency. Top-level
// await completes before any store constructor runs, preserving the synchronous
// public store API while never loading node:sqlite on Node 22–24.1.
const SQL = await sqlJsFactory();
const SQLJS_BUSY_TIMEOUT_MS = 5_000;
const SQLJS_LOCK_STALE_MS = 30_000;
const sleepCell = new Int32Array(new SharedArrayBuffer(4));

function parseVersion(version: string): [number, number, number] {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** `node:sqlite` stopped being experimental in Node 24.2.0. */
export function hasStableNodeSqlite(version = process.versions.node): boolean {
  const [major, minor] = parseVersion(version);
  return major > 24 || (major === 24 && minor >= 2);
}

function configuredDriver(value = process.env.TRACE_SQLITE_DRIVER): SqliteDriverPreference {
  if (value === undefined || value === '' || value === 'auto') return 'auto';
  if (value === 'node' || value === 'sql.js') return value;
  throw new StorageError('INVALID_SQLITE_DRIVER', 'TRACE_SQLITE_DRIVER must be auto, node, or sql.js');
}

function loadNode(): NodeSqliteModule {
  try { return requireFromHere('node:sqlite') as NodeSqliteModule; }
  catch (error) { throw new StorageError('SQLITE_DRIVER_UNAVAILABLE', `node:sqlite is unavailable: ${String(error)}`); }
}

export function selectSqliteDriver(input: {preference?: SqliteDriverPreference; nodeVersion?: string; hasSqlJs?: boolean} = {}): SqliteDriverInfo {
  const preference = input.preference ?? configuredDriver();
  const stableNode = hasStableNodeSqlite(input.nodeVersion);
  const hasSqlJs = input.hasSqlJs ?? true;
  if (preference === 'node') {
    return {kind: 'node:sqlite', ...(stableNode ? {} : {warning: 'node:sqlite is experimental before Node 24.2.0; prefer sql.js or upgrade Node.'})};
  }
  if (preference === 'sql.js') {
    if (!hasSqlJs) throw new StorageError('SQLITE_DRIVER_UNAVAILABLE', 'sql.js is requested but not installed');
    return {kind: 'sql.js'};
  }
  if (stableNode) return {kind: 'node:sqlite'};
  if (hasSqlJs) return {kind: 'sql.js'};
  return {kind: 'node:sqlite', warning: 'sql.js is unavailable and node:sqlite is experimental before Node 24.2.0; install the packaged fallback or upgrade Node.'};
}

function isReadOnly(sql: string): boolean {
  return /^(?:\s|\/\*[\s\S]*?\*\/)*(?:SELECT|EXPLAIN)\b/i.test(sql);
}

function fileSignature(file: string): string | undefined {
  try {
    const stat = fs.statSync(file);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function lockPath(file: string): string { return `${file}.trace-sqljs.lock`; }

/**
 * File-backed sql.js core. Every outer write takes a short cross-process lock,
 * reloads the latest file, then atomically replaces it on commit. This is not
 * a network-filesystem protocol; it preserves Trace's local-file boundary when
 * native node:sqlite is unavailable.
 */
class SqlJsFileCore {
  private db: SqlJsDatabase;
  private signature: string | undefined;
  private transaction = false;
  private lockHeld = false;

  constructor(readonly file: string) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    this.db = new SQL.Database();
    this.acquireLock();
    try {
      this.reloadFromDisk();
      if (!fs.existsSync(file)) this.persist();
    } finally { this.releaseLock(); }
  }

  private acquireLock(): void {
    const lock = lockPath(this.file);
    const deadline = Date.now() + SQLJS_BUSY_TIMEOUT_MS;
    for (;;) {
      try {
        fs.writeFileSync(lock, JSON.stringify({pid: process.pid, acquired_at: Date.now()}), {flag: 'wx', encoding: 'utf8', mode: 0o600});
        this.lockHeld = true;
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Windows can surface an in-flight create/remove of this lock as EPERM
        // instead of EEXIST. Treat both as bounded lock contention: checking
        // existsSync here races with unlink and reintroduces a false failure.
        if (code !== 'EEXIST' && code !== 'EPERM') throw error;
        try {
          const prior = JSON.parse(fs.readFileSync(lock, 'utf8')) as {acquired_at?: number};
          if (typeof prior.acquired_at === 'number' && Date.now() - prior.acquired_at > SQLJS_LOCK_STALE_MS) fs.unlinkSync(lock);
        } catch { /* another writer can win the race; retry until bounded deadline */ }
        if (Date.now() >= deadline) throw new StorageError('SQLITE_BUSY', `sql.js writer lock timed out for ${this.file}`);
        Atomics.wait(sleepCell, 0, 0, 10);
      }
    }
  }

  private releaseLock(): void {
    if (!this.lockHeld) return;
    this.lockHeld = false;
    const lock = lockPath(this.file);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try { fs.unlinkSync(lock); return; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return;
        if (code !== 'EPERM' || attempt === 19) throw error;
        Atomics.wait(sleepCell, 0, 0, 5);
      }
    }
  }

  private reloadFromDisk(): void {
    const next = fileSignature(this.file);
    if (next === undefined) {
      this.db.close();
      this.db = new SQL.Database();
      this.signature = undefined;
      return;
    }
    if (next === this.signature) return;
    const loaded = new SQL.Database(fs.readFileSync(this.file));
    this.db.close();
    this.db = loaded;
    this.signature = next;
  }

  private persist(): void {
    const temporary = `${this.file}.trace-sqljs-${process.pid}-${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporary, Buffer.from(this.db.export()), {flag: 'wx'});
      fs.renameSync(temporary, this.file);
      this.signature = fileSignature(this.file);
    } finally {
      try { fs.unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }

  private beforeRead(): void { if (!this.transaction) this.reloadFromDisk(); }

  exec(sql: string, readOnly: boolean): void {
    const normalized = sql.trim().toUpperCase();
    if (normalized === 'BEGIN IMMEDIATE' || normalized === 'BEGIN') {
      if (readOnly) throw new StorageError('SQLITE_READ_ONLY', 'Cannot begin a write transaction on a read-only database');
      if (this.transaction) throw new StorageError('SQLITE_TRANSACTION', 'Nested sql.js write transactions are not supported');
      this.acquireLock();
      try { this.reloadFromDisk(); this.db.run(sql); this.transaction = true; }
      catch (error) { this.releaseLock(); throw error; }
      return;
    }
    if (normalized === 'COMMIT' || normalized === 'END') {
      if (!this.transaction) throw new StorageError('SQLITE_TRANSACTION', 'No active sql.js transaction to commit');
      try { this.db.run(sql); this.persist(); }
      finally { this.transaction = false; this.releaseLock(); }
      return;
    }
    if (normalized === 'ROLLBACK') {
      if (!this.transaction) return;
      try { this.db.run(sql); this.reloadFromDisk(); }
      finally { this.transaction = false; this.releaseLock(); }
      return;
    }
    if (readOnly && !isReadOnly(sql)) throw new StorageError('SQLITE_READ_ONLY', 'Cannot write to a read-only database');
    if (isReadOnly(sql)) { this.beforeRead(); this.db.run(sql); return; }
    this.write(() => this.db.run(sql), readOnly);
  }

  query(sql: string, parameters: unknown[]): Record<string, unknown>[] {
    this.beforeRead();
    const statement = this.db.prepare(sql);
    try {
      if (parameters.length > 0) statement.bind(parameters);
      const rows: Record<string, unknown>[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally { statement.free(); }
  }

  run(sql: string, parameters: unknown[], readOnly: boolean): {changes: number} {
    if (readOnly) throw new StorageError('SQLITE_READ_ONLY', 'Cannot write to a read-only database');
    return this.write(() => {
      const statement = this.db.prepare(sql);
      try { statement.run(parameters); return {changes: 0}; }
      finally { statement.free(); }
    }, false);
  }

  private write<T>(work: () => T, readOnly: boolean): T {
    if (readOnly) throw new StorageError('SQLITE_READ_ONLY', 'Cannot write to a read-only database');
    if (this.transaction) return work();
    this.acquireLock();
    try { this.reloadFromDisk(); const result = work(); this.persist(); return result; }
    finally { this.releaseLock(); }
  }

  close(): void { /* A process-shared core remains live for sibling Trace stores. */ }
}

class SqlJsStatementAdapter implements SqliteStatement {
  constructor(private readonly core: SqlJsFileCore, private readonly sql: string, private readonly readOnly: boolean) {}
  all(...parameters: unknown[]): unknown[] { return this.core.query(this.sql, parameters); }
  get(...parameters: unknown[]): unknown { return this.core.query(this.sql, parameters)[0]; }
  run(...parameters: unknown[]): unknown { return this.core.run(this.sql, parameters, this.readOnly); }
}

class SqlJsDatabaseAdapter implements SqliteDatabase {
  constructor(private readonly core: SqlJsFileCore, private readonly readOnly: boolean) {}
  exec(sql: string): void { this.core.exec(sql, this.readOnly); }
  prepare(sql: string): SqliteStatement { return new SqlJsStatementAdapter(this.core, sql, this.readOnly); }
  close(): void { this.core.close(); }
}

const sqlJsCores = new Map<string, SqlJsFileCore>();

function openSqlJs(file: string, readOnly: boolean): SqliteDatabase {
  const target = path.resolve(file);
  if (readOnly && !fs.existsSync(target)) throw new StorageError('SQLITE_DRIVER_UNAVAILABLE', `SQLite database does not exist: ${target}`);
  let core = sqlJsCores.get(target);
  if (!core) { core = new SqlJsFileCore(target); sqlJsCores.set(target, core); }
  return new SqlJsDatabaseAdapter(core, readOnly);
}

/**
 * Opens the selected driver lazily. Node 22–24.1 use the packaged sql.js
 * fallback by default, so importing the runtime does not emit ExperimentalWarning.
 */
export function openSqlite(file: string, options: OpenSqliteOptions = {}): OpenSqliteResult {
  const driver = selectSqliteDriver(options.driver === undefined ? {} : {preference: options.driver});
  if (driver.kind === 'sql.js') return {db: openSqlJs(file, options.readOnly ?? false), driver};
  const NodeSqlite = loadNode();
  return {db: new NodeSqlite.DatabaseSync(file, options.readOnly ? {readOnly: true} : undefined), driver};
}
