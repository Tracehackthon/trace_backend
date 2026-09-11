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

interface NativeSqliteStatement {
  all(...parameters: unknown[]): unknown[];
  get(...parameters: unknown[]): unknown;
  run(...parameters: unknown[]): unknown;
}

interface NativeSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): NativeSqliteStatement;
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (file: string, options?: {readOnly?: boolean}) => NativeSqliteDatabase;
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

interface SingleSqlStatement {
  /** Executable SQL with leading comments/space and trailing semicolon removed. */
  sql: string;
  /** First executable token after leading comments/space. */
  leadingKeyword: string;
}

/** Skip SQL whitespace and comments without interpreting their contents. */
function skipSqlIgnorable(sql: string, start = 0): number {
  let index = start;
  for (;;) {
    while (index < sql.length && /\s/.test(sql[index]!)) index += 1;
    if (sql.startsWith('--', index)) {
      index += 2;
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') index += 1;
      continue;
    }
    if (sql.startsWith('/*', index)) {
      const close = sql.indexOf('*/', index + 2);
      if (close < 0) throw new StorageError('SQLITE_STATEMENT_INVALID', 'SQL contains an unterminated block comment');
      index = close + 2;
      continue;
    }
    return index;
  }
}

/**
 * Expose exactly one SQLite statement per `exec()` or `prepare()` call.
 * SQLite drivers differ in whether they execute a second statement from the
 * same string; Trace must not let its safety semantics depend on that detail.
 */
function singleSqlStatement(sql: string): SingleSqlStatement {
  const first = skipSqlIgnorable(sql);
  if (first >= sql.length) throw new StorageError('SQLITE_STATEMENT_REQUIRED', 'SQL must contain one statement');
  let quote: "'" | '"' | '[' | '`' | undefined;
  let statementEnd = sql.length;
  for (let index = first; index < sql.length; index += 1) {
    const character = sql[index]!;
    if (quote === "'") {
      if (character === "'" && sql[index + 1] === "'") { index += 1; continue; }
      if (character === "'") quote = undefined;
      continue;
    }
    if (quote === '"') {
      if (character === '"' && sql[index + 1] === '"') { index += 1; continue; }
      if (character === '"') quote = undefined;
      continue;
    }
    if (quote === '[') {
      if (character === ']' && sql[index + 1] === ']') { index += 1; continue; }
      if (character === ']') quote = undefined;
      continue;
    }
    if (quote === '`') {
      if (character === '`' && sql[index + 1] === '`') { index += 1; continue; }
      if (character === '`') quote = undefined;
      continue;
    }
    if (character === "'" || character === '"' || character === '[' || character === '`') { quote = character; continue; }
    if (sql.startsWith('--', index)) {
      const newline = sql.slice(index + 2).search(/[\r\n]/);
      if (newline < 0) break;
      index += newline + 2;
      continue;
    }
    if (sql.startsWith('/*', index)) {
      const close = sql.indexOf('*/', index + 2);
      if (close < 0) throw new StorageError('SQLITE_STATEMENT_INVALID', 'SQL contains an unterminated block comment');
      index = close + 1;
      continue;
    }
    if (character === ';') { statementEnd = index; break; }
  }
  if (quote !== undefined) throw new StorageError('SQLITE_STATEMENT_INVALID', 'SQL contains an unterminated quoted value');
  if (statementEnd < sql.length && skipSqlIgnorable(sql, statementEnd + 1) < sql.length) {
    throw new StorageError('SQLITE_MULTIPLE_STATEMENTS', 'Trace accepts exactly one SQL statement per call');
  }
  const statement = sql.slice(first, statementEnd).trim();
  if (statement.length === 0) throw new StorageError('SQLITE_STATEMENT_REQUIRED', 'SQL must contain one statement');
  const keyword = /^([A-Za-z_][A-Za-z0-9_$]*)/.exec(statement)?.[1]?.toUpperCase();
  if (keyword === undefined) throw new StorageError('SQLITE_STATEMENT_INVALID', 'SQL must start with a statement keyword');
  return {sql: statement, leadingKeyword: keyword};
}

/** Top-level words, used only to classify the final operation in a CTE. */
function topLevelSqlWords(sql: string): string[] {
  const words: string[] = [];
  let depth = 0;
  let quote: "'" | '"' | '[' | '`' | undefined;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    if (quote === "'") {
      if (character === "'" && sql[index + 1] === "'") { index += 1; continue; }
      if (character === "'") quote = undefined;
      continue;
    }
    if (quote === '"') {
      if (character === '"' && sql[index + 1] === '"') { index += 1; continue; }
      if (character === '"') quote = undefined;
      continue;
    }
    if (quote === '[') {
      if (character === ']' && sql[index + 1] === ']') { index += 1; continue; }
      if (character === ']') quote = undefined;
      continue;
    }
    if (quote === '`') {
      if (character === '`' && sql[index + 1] === '`') { index += 1; continue; }
      if (character === '`') quote = undefined;
      continue;
    }
    if (character === "'" || character === '"' || character === '[' || character === '`') { quote = character; continue; }
    if (sql.startsWith('--', index)) {
      const newline = sql.slice(index + 2).search(/[\r\n]/);
      if (newline < 0) break;
      index += newline + 2;
      continue;
    }
    if (sql.startsWith('/*', index)) {
      const close = sql.indexOf('*/', index + 2);
      if (close < 0) break;
      index = close + 1;
      continue;
    }
    if (character === '(') { depth += 1; continue; }
    if (character === ')') { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0 && /[A-Za-z_]/.test(character)) {
      let end = index + 1;
      while (end < sql.length && /[A-Za-z0-9_$]/.test(sql[end]!)) end += 1;
      words.push(sql.slice(index, end).toUpperCase());
      index = end - 1;
    }
  }
  return words;
}

/**
 * Only statements whose *result* is read through the statement API belong on
 * `all()` / `get()`. Keep PRAGMA deliberately narrow: integrity checks are
 * used by doctor, while arbitrary PRAGMA can change connection/database state.
 */
function isReadOnlyQuery(statement: SingleSqlStatement): boolean {
  if (statement.leadingKeyword === 'SELECT' || statement.leadingKeyword === 'EXPLAIN') return true;
  if (statement.leadingKeyword === 'WITH') {
    const operation = topLevelSqlWords(statement.sql).find(word => ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(word));
    return operation === 'SELECT';
  }
  return /^PRAGMA\s+(?:main\.)?(?:integrity_check|quick_check)\s*$/i.test(statement.sql);
}

function assertQueryStatement(sql: string, readOnly: boolean): SingleSqlStatement {
  const statement = singleSqlStatement(sql);
  if (isReadOnlyQuery(statement)) return statement;
  if (readOnly) throw new StorageError('SQLITE_READ_ONLY', 'Read-only database rejects non-query statements through all() and get()');
  throw new StorageError('SQLITE_QUERY_REQUIRED', 'all() and get() accept query statements only; use run() for writes');
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
    const statement = singleSqlStatement(sql);
    const normalized = statement.sql.toUpperCase();
    if (normalized === 'BEGIN IMMEDIATE' || normalized === 'BEGIN') {
      if (readOnly) throw new StorageError('SQLITE_READ_ONLY', 'Cannot begin a write transaction on a read-only database');
      if (this.transaction) throw new StorageError('SQLITE_TRANSACTION', 'Nested sql.js write transactions are not supported');
      this.acquireLock();
      try { this.reloadFromDisk(); this.db.run(statement.sql); this.transaction = true; }
      catch (error) { this.releaseLock(); throw error; }
      return;
    }
    if (normalized === 'COMMIT' || normalized === 'END') {
      if (!this.transaction) throw new StorageError('SQLITE_TRANSACTION', 'No active sql.js transaction to commit');
      try { this.db.run(statement.sql); this.persist(); }
      finally { this.transaction = false; this.releaseLock(); }
      return;
    }
    if (normalized === 'ROLLBACK') {
      if (!this.transaction) return;
      try { this.db.run(statement.sql); this.reloadFromDisk(); }
      finally { this.transaction = false; this.releaseLock(); }
      return;
    }
    if (readOnly && !isReadOnlyQuery(statement)) throw new StorageError('SQLITE_READ_ONLY', 'Cannot write to a read-only database');
    if (isReadOnlyQuery(statement)) { this.beforeRead(); this.db.run(statement.sql); return; }
    this.write(() => this.db.run(statement.sql), readOnly);
  }

  query(sql: string, parameters: unknown[], readOnly: boolean): Record<string, unknown>[] {
    const statementSql = assertQueryStatement(sql, readOnly);
    this.beforeRead();
    const statement = this.db.prepare(statementSql.sql);
    try {
      if (parameters.length > 0) statement.bind(parameters);
      const rows: Record<string, unknown>[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally { statement.free(); }
  }

  run(sql: string, parameters: unknown[], readOnly: boolean): {changes: number} {
    if (readOnly) throw new StorageError('SQLITE_READ_ONLY', 'Cannot write to a read-only database');
    const statementSql = singleSqlStatement(sql);
    return this.write(() => {
      const statement = this.db.prepare(statementSql.sql);
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
  all(...parameters: unknown[]): unknown[] { return this.core.query(this.sql, parameters, this.readOnly); }
  get(...parameters: unknown[]): unknown { return this.core.query(this.sql, parameters, this.readOnly)[0]; }
  run(...parameters: unknown[]): unknown { return this.core.run(this.sql, parameters, this.readOnly); }
}

class SqlJsDatabaseAdapter implements SqliteDatabase {
  constructor(private readonly core: SqlJsFileCore, private readonly readOnly: boolean) {}
  exec(sql: string): void { this.core.exec(sql, this.readOnly); }
  prepare(sql: string): SqliteStatement { return new SqlJsStatementAdapter(this.core, singleSqlStatement(sql).sql, this.readOnly); }
  close(): void { this.core.close(); }
}

/** Apply the same query/read-only contract to node:sqlite and sql.js. */
class NodeSqliteStatementAdapter implements SqliteStatement {
  constructor(private readonly statement: NativeSqliteStatement, private readonly sql: string, private readonly readOnly: boolean) {}
  all(...parameters: unknown[]): unknown[] {
    assertQueryStatement(this.sql, this.readOnly);
    return this.statement.all(...parameters);
  }
  get(...parameters: unknown[]): unknown {
    assertQueryStatement(this.sql, this.readOnly);
    return this.statement.get(...parameters);
  }
  run(...parameters: unknown[]): unknown {
    if (this.readOnly) throw new StorageError('SQLITE_READ_ONLY', 'Cannot write to a read-only database');
    return this.statement.run(...parameters);
  }
}

class NodeSqliteDatabaseAdapter implements SqliteDatabase {
  constructor(private readonly db: NativeSqliteDatabase, private readonly readOnly: boolean) {}
  exec(sql: string): void {
    const statement = singleSqlStatement(sql);
    if (this.readOnly && !isReadOnlyQuery(statement)) throw new StorageError('SQLITE_READ_ONLY', 'Cannot write to a read-only database');
    this.db.exec(statement.sql);
  }
  prepare(sql: string): SqliteStatement {
    const statement = singleSqlStatement(sql);
    return new NodeSqliteStatementAdapter(this.db.prepare(statement.sql), statement.sql, this.readOnly);
  }
  close(): void { this.db.close(); }
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
  const readOnly = options.readOnly ?? false;
  return {db: new NodeSqliteDatabaseAdapter(new NodeSqlite.DatabaseSync(file, readOnly ? {readOnly: true} : undefined), readOnly), driver};
}
