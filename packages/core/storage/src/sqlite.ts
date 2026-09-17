import fs from 'node:fs';
import path from 'node:path';
import {StorageError, recordIdentity, type VersionedRecord, type VersionedStore} from './jsonl.js';
import {openSqlite, type SqliteDatabase, type SqliteDriverInfo} from './sqlite-driver.js';
import {
  DATABASE_IDENTITY_COLUMNS,
  DATABASE_IDENTITY_TABLE,
  DATABASE_ROLES,
  RUNTIME_IDENTITY_PROTOCOL_VERSION,
  TRACE_PRODUCT_ID,
  TRACE_PROJECT_SERVICE_ID,
  databaseIdentityTemplate,
  deriveDatabaseIdentity,
  type DatabaseIdentity,
  type DatabaseIdentityOptions,
  validateDatabaseIdentity,
} from './identity.js';

export const SQLITE_BUSY_TIMEOUT_MS = 5_000;
/** TRC1. Product and Agent use different application IDs and are rejected. */
export const PROJECT_APPLICATION_ID = 0x54524331;
export const PROJECT_SCHEMA_VERSION = 1;
const PRODUCT_APPLICATION_ID = 0x54525731; // TRW1
const AGENT_APPLICATION_ID = 0x54524131; // TRA1

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

function userTables(db: SqliteDatabase): string[] {
  return (db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{name?: unknown}>)
    .map(row => typeof row.name === 'string' ? row.name : '').filter(Boolean);
}

/**
 * Before the identity marker existed, project ledgers were recognized only by
 * the table that the caller happened to request.  Keep that migration path
 * narrow: a marker-less file may contain only the known project ledger tables
 * (or the requested versioned table), never an arbitrary SQLite table that was
 * merely renamed to `trace.sqlite`.
 */
function legacyProjectTables(db: SqliteDatabase, requestedTable: string, allowRequestedTable: boolean): boolean {
  const tables = userTables(db);
  if (tables.length === 0) return true;
  const allowed = new Set(['change_sets', 'data_records', 'continuity_records']);
  if (allowRequestedTable) allowed.add(requestedTable);
  if (tables.some(table => !allowed.has(table))) return false;
  // A legacy runtime may have opened only one of the three ledgers. The next
  // store is allowed to add its own table, but any table already carrying the
  // requested name must still have the versioned-store schema.
  for (const table of tables) {
    const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name?: unknown}>)
      .map(row => row.name).filter((value): value is string => typeof value === 'string');
    if (columns.length !== 4 || !['identity', 'revision', 'payload', 'created_at'].every(column => columns.includes(column))) return false;
  }
  return tables.length > 0;
}

function databaseApplicationId(db: SqliteDatabase): number {
  const row = db.prepare('PRAGMA application_id').get() as {application_id?: unknown} | undefined;
  return Number(row?.application_id ?? 0);
}

function identityTableExists(db: SqliteDatabase): boolean {
  return Boolean(db.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name=?").get(DATABASE_IDENTITY_TABLE));
}

function readDatabaseIdentity(db: SqliteDatabase): DatabaseIdentity {
  try {
    const columns = (db.prepare(`PRAGMA table_info(${DATABASE_IDENTITY_TABLE})`).all() as Array<{name?: unknown}>)
      .map(row => row.name).filter((value): value is string => typeof value === 'string');
    const required = [...DATABASE_IDENTITY_COLUMNS];
    if (columns.length !== required.length || required.some(column => !columns.includes(column)) || columns.some(column => !required.includes(column as typeof required[number]))) {
      throw new StorageError('DATABASE_IDENTITY_INVALID', 'SQLite state identity metadata has an unsupported schema');
    }
    const row = db.prepare(`SELECT ${required.join(',')} FROM ${DATABASE_IDENTITY_TABLE} WHERE id=1`).get();
    if (!row) throw new StorageError('DATABASE_IDENTITY_INVALID', 'SQLite state identity metadata is missing');
    return validateDatabaseIdentity(row, {role: DATABASE_ROLES.project, serviceId: TRACE_PROJECT_SERVICE_ID});
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError('DATABASE_IDENTITY_INVALID', `SQLite state identity metadata could not be read: ${String(error)}`);
  }
}

function createIdentityTable(db: SqliteDatabase): void {
  db.exec(`CREATE TABLE ${DATABASE_IDENTITY_TABLE}(
    id INTEGER PRIMARY KEY CHECK(id=1),
    schema_version INTEGER NOT NULL,
    product_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    role TEXT NOT NULL,
    protocol_version INTEGER NOT NULL,
    runtime_version TEXT NOT NULL,
    installation_id TEXT,
    workspace_id TEXT,
    verification_state TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
}

function insertIdentity(db: SqliteDatabase, value: DatabaseIdentity): void {
  db.prepare(`INSERT INTO ${DATABASE_IDENTITY_TABLE}(${DATABASE_IDENTITY_COLUMNS.join(',')}) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    value.id, value.schema_version, value.product_id, value.service_id, value.role,
    value.protocol_version, value.runtime_version, value.installation_id,
    value.workspace_id, value.verification_state, value.created_at,
  );
}

function sameDatabaseIdentity(left: DatabaseIdentity, right: DatabaseIdentity): boolean {
  return left.id === right.id && left.schema_version === right.schema_version && left.product_id === right.product_id
    && left.service_id === right.service_id && left.role === right.role && left.protocol_version === right.protocol_version
    && left.runtime_version === right.runtime_version && left.installation_id === right.installation_id
    && left.workspace_id === right.workspace_id && left.verification_state === right.verification_state
    && left.created_at === right.created_at;
}

function projectIdentity(file: string, options: DatabaseIdentityOptions, verificationState: 'verified' | 'legacy'): DatabaseIdentity {
  return databaseIdentityTemplate({
    role: DATABASE_ROLES.project,
    serviceId: TRACE_PROJECT_SERVICE_ID,
    file,
    ...(options.workspaceId === undefined ? {} : {workspaceId: options.workspaceId}),
    ...(options.installationId === undefined ? {} : {installationId: options.installationId}),
    ...(options.runtimeVersion === undefined ? {} : {runtimeVersion: options.runtimeVersion}),
    verificationState,
  });
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
  private databaseIdentity: DatabaseIdentity;
  private readonly allowLegacyIdentity: boolean;
  private ledgerSchemaAvailable = false;

  constructor(file: string, table: string, options: DatabaseIdentityOptions & {upgradeLegacyIdentity?: boolean} = {}) {
    const target = absolute(file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    const opened = openSqlite(target);
    this.db = opened.db;
    this.driver = opened.driver;
    this.table = tableName(table);
    this.allowLegacyIdentity = options.allowLegacyIdentity ?? false;
    try {
      // WAL only allows readers to proceed while a writer holds the lock. A
      // bounded busy timeout makes independent Codex/CLI processes wait for that
      // writer instead of failing immediately with SQLITE_BUSY.  Set the
      // connection-local timeout before the identity probe, but defer the
      // file-mutating journal-mode pragma until after role/owner validation.
      this.db.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
      this.databaseIdentity = this.ensureDatabaseIdentity(target, options);
      // Legacy project state is inspectable but read-only until explicit
      // identity adoption.  Do not switch journal mode or create a missing
      // ledger/index merely because a newer runtime opened that file.
      if (this.databaseIdentity.verification_state === 'verified' || this.allowLegacyIdentity) {
        this.db.exec('PRAGMA journal_mode = WAL');
        this.ensureLedgerSchema();
      } else {
        this.ledgerSchemaAvailable = this.hasLedgerSchema();
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  /**
   * Establish the project owner before creating the requested record table.
   * Product and Agent application IDs are checked even for old databases that
   * predate the identity table, so a renamed state file cannot change roles.
   */
  private ensureDatabaseIdentity(target: string, options: DatabaseIdentityOptions & {upgradeLegacyIdentity?: boolean}): DatabaseIdentity {
    const present = identityTableExists(this.db);
    if (present) {
      const existing = readDatabaseIdentity(this.db);
      this.assertExpectedIdentity(existing, target, options);
      if (existing.verification_state !== 'verified' && options.upgradeLegacyIdentity) {
        return this.upgradeIdentityRow(existing, options);
      }
      return options.runtimeVersion !== undefined && existing.runtime_version !== options.runtimeVersion
        && (existing.verification_state === 'verified' || this.allowLegacyIdentity)
        ? this.refreshRuntimeVersion(existing, options.runtimeVersion) : existing;
    }
    // Do the marker-less role/shape check before taking BEGIN IMMEDIATE.  The
    // initial migration used to create a rollback journal before rejecting an
    // unrelated SQLite file, which made identity rejection observable as a
    // write even though the database was never authorized for this store.
    this.assertMarkerlessDatabase();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // The initial probe is intentionally outside the lock for cheap reads,
      // but another process may have created the marker while we waited. The
      // locked/reloaded view is authoritative and must be rechecked before
      // issuing CREATE TABLE (the sql.js fallback otherwise races on CREATE).
      const lockedIdentityPresent = identityTableExists(this.db);
      if (lockedIdentityPresent) {
        const existing = readDatabaseIdentity(this.db);
        this.assertExpectedIdentity(existing, target, options);
        this.db.exec('COMMIT');
        if (existing.verification_state !== 'verified' && options.upgradeLegacyIdentity) return this.upgradeIdentityRow(existing, options);
        return options.runtimeVersion !== undefined && existing.runtime_version !== options.runtimeVersion
          && (existing.verification_state === 'verified' || this.allowLegacyIdentity)
          ? this.refreshRuntimeVersion(existing, options.runtimeVersion) : existing;
      }
      this.assertMarkerlessDatabase();
      const existingTables = userTables(this.db);
      const state: 'verified' | 'legacy' = existingTables.length === 0 ? 'verified' : 'legacy';
      const identity = projectIdentity(target, options, state);
      // Mark both newly-created and migrated legacy project files.  The
      // metadata row remains the authority, while the application id gives
      // old callers a cheap role fingerprint before they inspect the table.
      this.db.exec(`PRAGMA application_id=${PROJECT_APPLICATION_ID}`);
      this.db.exec(`PRAGMA user_version=${PROJECT_SCHEMA_VERSION}`);
      createIdentityTable(this.db);
      insertIdentity(this.db, identity);
      this.db.exec('COMMIT');
      return identity;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  private assertMarkerlessDatabase(): void {
    const appId = databaseApplicationId(this.db);
    if (appId === PRODUCT_APPLICATION_ID || appId === AGENT_APPLICATION_ID) {
      throw new StorageError('DATABASE_ROLE_MISMATCH', 'The requested project runtime cannot open a Product or Agent database');
    }
    if (appId !== 0 && appId !== PROJECT_APPLICATION_ID) {
      throw new StorageError('WRONG_DATABASE', 'The SQLite state file is not a recognized Trace database');
    }
    const existingTables = userTables(this.db);
    // A concurrent writer may have committed the identity marker between the
    // cheap probe and this validation. Let the locked path reload and validate
    // that marker instead of misclassifying a legitimate project as arbitrary
    // SQLite state.
    if (existingTables.includes(DATABASE_IDENTITY_TABLE)) return;
    if (existingTables.length > 0 && !legacyProjectTables(this.db, this.table, appId === PROJECT_APPLICATION_ID)) {
      throw new StorageError('WRONG_DATABASE', 'The marker-less SQLite state is not a recognized Trace project ledger');
    }
  }

  private refreshRuntimeVersion(existing: DatabaseIdentity, runtimeVersion: string): DatabaseIdentity {
    const refreshed = databaseIdentityTemplate({role: DATABASE_ROLES.project, serviceId: TRACE_PROJECT_SERVICE_ID,
      runtimeVersion, verificationState: existing.verification_state,
      ...(existing.workspace_id === null ? {} : {workspaceId: existing.workspace_id}),
      ...(existing.installation_id === null ? {} : {installationId: existing.installation_id}),
      createdAt: existing.created_at});
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = readDatabaseIdentity(this.db);
      if (!sameDatabaseIdentity(current, existing)) throw new StorageError('DATABASE_IDENTITY_CHANGED', 'SQLite state identity changed before the runtime version update; reopen explicitly');
      this.db.prepare(`UPDATE ${DATABASE_IDENTITY_TABLE} SET runtime_version=? WHERE id=1`).run(refreshed.runtime_version);
      this.db.exec('COMMIT');
      return refreshed;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  private assertExpectedIdentity(identity: DatabaseIdentity, target: string, options: DatabaseIdentityOptions): void {
    if ((options.workspaceId !== undefined) !== (options.installationId !== undefined)) {
      throw new StorageError('IDENTITY_MISSING', 'workspaceId and installationId must be supplied together');
    }
    if (identity.verification_state !== 'verified') {
      return;
    }
    const derived = deriveDatabaseIdentity(target);
    const expected = options.workspaceId !== undefined || options.installationId !== undefined
      ? {workspaceId: options.workspaceId!, installationId: options.installationId!}
      : {workspaceId: derived.workspace_id, installationId: derived.installation_id};
    validateDatabaseIdentity(identity, expected);
  }

  private upgradeIdentityRow(existing: DatabaseIdentity, options: DatabaseIdentityOptions & {upgradeLegacyIdentity?: boolean}): DatabaseIdentity {
    if (options.workspaceId === undefined || options.installationId === undefined) {
      throw new StorageError('IDENTITY_UPGRADE_REQUIRED', 'Upgrading a legacy SQLite state requires explicit workspaceId and installationId');
    }
    const upgraded = databaseIdentityTemplate({
      role: DATABASE_ROLES.project,
      serviceId: TRACE_PROJECT_SERVICE_ID,
      workspaceId: options.workspaceId,
      installationId: options.installationId,
      ...(options.runtimeVersion === undefined ? {runtimeVersion: existing.runtime_version} : {runtimeVersion: options.runtimeVersion}),
      verificationState: 'verified',
      createdAt: existing.created_at,
    });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = readDatabaseIdentity(this.db);
      if (!sameDatabaseIdentity(current, existing)) {
        // TraceRuntime upgrades its three project ledgers one after another.
        // A sibling store can therefore observe the marker already upgraded
        // by the first store.  Treat that exact, caller-requested verified
        // owner as an idempotent hand-off; any other drift remains a hard
        // failure rather than overwriting a concurrent owner.
        if (current.verification_state !== 'verified' || current.workspace_id !== options.workspaceId || current.installation_id !== options.installationId) {
          throw new StorageError('DATABASE_IDENTITY_CHANGED', 'SQLite state identity changed before the identity upgrade; reopen explicitly');
        }
        this.ensureLedgerSchema();
        this.db.exec('COMMIT');
        return current;
      }
      this.db.prepare(`UPDATE ${DATABASE_IDENTITY_TABLE} SET schema_version=?,product_id=?,service_id=?,role=?,protocol_version=?,runtime_version=?,installation_id=?,workspace_id=?,verification_state=? WHERE id=1`)
        .run(upgraded.schema_version, upgraded.product_id, upgraded.service_id, upgraded.role, upgraded.protocol_version,
          upgraded.runtime_version, upgraded.installation_id, upgraded.workspace_id, upgraded.verification_state);
      // A legacy marker can predate this particular ledger table (for example
      // an older runtime opened only one of the three project stores). Identity
      // adoption must reopen the requested store atomically instead of
      // reporting success and leaving its first write to fail with "no such
      // table".
      this.ensureLedgerSchema();
      this.ledgerSchemaAvailable = true;
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
    return upgraded;
  }

  private ensureLedgerSchema(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${this.table} (
      identity TEXT NOT NULL,
      revision INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (identity, revision)
    )`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS ${this.table}_identity_idx ON ${this.table}(identity, revision)`);
    this.ledgerSchemaAvailable = true;
  }

  private hasLedgerSchema(): boolean {
    return Boolean(this.db.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name=?").get(this.table));
  }

  private assertLedgerSchema(): void {
    if (!this.ledgerSchemaAvailable) throw new StorageError('TRACE_LEDGER_UNAVAILABLE', `SQLite ledger ${this.table} is not available in this legacy database; explicitly upgrade its project identity first`);
  }

  private assertWritableIdentity(): void {
    if (this.databaseIdentity.verification_state !== 'verified' && !this.allowLegacyIdentity) {
      throw new StorageError('LEGACY_IDENTITY_UNVERIFIED', 'Legacy SQLite state is read-only until it is explicitly upgraded with workspace and installation identity');
    }
  }

  private assertCurrentIdentity(): void {
    const current = readDatabaseIdentity(this.db);
    if (!sameDatabaseIdentity(current, this.databaseIdentity)) throw new StorageError('DATABASE_IDENTITY_CHANGED', 'SQLite state identity changed after this runtime opened it; reopen explicitly before reading or writing');
  }

  private assertCurrentWritableIdentity(): void {
    this.assertCurrentIdentity();
    this.assertWritableIdentity();
  }

  get identity(): DatabaseIdentity { return structuredClone(this.databaseIdentity); }
  getIdentity(): DatabaseIdentity { return structuredClone(this.databaseIdentity); }

  /** Explicit, reversible adoption path for old project databases. */
  upgradeIdentity(input: {workspaceId: string; installationId: string; runtimeVersion?: string}): DatabaseIdentity {
    if (this.databaseIdentity.verification_state === 'verified') {
      this.assertCurrentIdentity();
      validateDatabaseIdentity(this.databaseIdentity, {workspaceId: input.workspaceId, installationId: input.installationId});
      return this.identity;
    }
    const upgraded = this.upgradeIdentityRow(this.databaseIdentity, {
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      ...(input.runtimeVersion === undefined ? {} : {runtimeVersion: input.runtimeVersion}),
    });
    this.databaseIdentity = upgraded;
    // Explicit upgrade is the authorized point at which legacy state may
    // switch back to the normal journal mode.
    this.db.exec('PRAGMA journal_mode = WAL');
    return this.identity;
  }

  all(): T[] {
    this.assertCurrentIdentity();
    this.assertLedgerSchema();
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
    this.assertCurrentIdentity();
    this.assertLedgerSchema();
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
      this.assertCurrentWritableIdentity();
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
    this.assertWritableIdentity();
    try {
      this.withWrite(() => this.appendUnsafe(record));
    } catch (error) {
      throw writeError(error);
    }
  }

  appendIfAbsent(record: T): {record: T; inserted: boolean} {
    this.assertWritableIdentity();
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
    this.assertWritableIdentity();
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
