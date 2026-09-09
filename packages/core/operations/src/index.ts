import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ProtocolError, validateChangeSet} from '../../protocol/src/index.js';
import {validateDataEnvelope} from '../../data/src/index.js';
import {validateContinuityEnvelope} from '../../continuity/src/index.js';
import {traceEventFromSqliteRow, type TraceEvent} from '../../observability/src/index.js';
import {openSqlite, type SqliteDatabase, type SqliteDriverInfo} from '../../storage/src/index.js';

export const BACKUP_PROTOCOL_ID = 'trace.backup' as const;
export const BACKUP_PROTOCOL_VERSION = '0.1.0' as const;

export interface DoctorCheck {name: string; status: 'pass' | 'warn' | 'error'; detail: string; count?: number;}
export interface CorrelationTrace {correlation_id: string; events: TraceEvent[];}
export interface DoctorReport {status: 'healthy' | 'warnings' | 'failed'; database: string; node: string; sqlite_driver?: SqliteDriverInfo; checks: DoctorCheck[]; created_at: string; correlation_trace?: CorrelationTrace;}
export interface BackupManifest {protocol_id: typeof BACKUP_PROTOCOL_ID; protocol_version: typeof BACKUP_PROTOCOL_VERSION; database: string; backup_file: string; sha256: string; bytes: number; tables: string[]; created_at: string;}
export interface BackupReport {status: 'created'; manifest: BackupManifest; manifest_file: string;}
export interface RestoreReport {status: 'restored'; database: string; backup_file: string; previous_database?: string; sha256: string; verified: true;}

function absolute(file: string, field: string): string { if (!path.isAbsolute(file)) throw new ProtocolError('INVALID_PATH', `${field} must be absolute`); return path.resolve(file); }
function sha256(file: string): string { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function sqlQuote(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
function tableRows(db: SqliteDatabase, table: string): Array<{identity: string; revision: number; payload: string}> {
  return db.prepare(`SELECT identity, revision, payload FROM ${table} ORDER BY identity, revision`).all() as Array<{identity: string; revision: number; payload: string}>;
}
function revisionCheck(rows: Array<{identity: string; revision: number}>): DoctorCheck[] {
  const checks: DoctorCheck[] = []; const grouped = new Map<string, number[]>();
  for (const row of rows) { const values = grouped.get(row.identity) ?? []; values.push(Number(row.revision)); grouped.set(row.identity, values); }
  let gaps = 0;
  for (const [identity, values] of grouped) { const ordered = [...new Set(values)].sort((a, b) => a - b); for (let index = 0; index < ordered.length; index += 1) if (ordered[index] !== index + 1) gaps += 1; if (values.length !== ordered.length) checks.push({name: `duplicate:${identity}`, status: 'error', detail: 'duplicate revision rows'}); }
  checks.push({name: 'revision-continuity', status: gaps ? 'error' : 'pass', detail: gaps ? `${gaps} revision gaps` : 'all identities are contiguous'}); return checks;
}
function validateRows(table: string, rows: Array<{payload: string}>): DoctorCheck {
  const validate = table === 'change_sets' ? validateChangeSet : table === 'data_records' ? validateDataEnvelope : table === 'continuity_records' ? validateContinuityEnvelope : undefined;
  if (!validate) return {name: `${table}:schema`, status: 'warn', detail: 'unknown table not validated', count: rows.length};
  try { rows.forEach(row => validate(JSON.parse(row.payload))); return {name: `${table}:schema`, status: 'pass', detail: 'all payloads validate', count: rows.length}; }
  catch (error) { return {name: `${table}:schema`, status: 'error', detail: String(error), count: rows.length}; }
}

function traceEvents(db: SqliteDatabase, correlationId: string): TraceEvent[] {
  const rows = db.prepare('SELECT event_id, occurred_at, component, operation, outcome, correlation_id, causation_id, thread_id, record_refs, duration_ms, error_code FROM trace_events WHERE correlation_id = ? ORDER BY occurred_at, event_id').all(correlationId) as Array<Record<string, unknown>>;
  return rows.map(traceEventFromSqliteRow);
}

function validateTraceRows(db: SqliteDatabase): DoctorCheck {
  try {
    const rows = db.prepare('SELECT event_id, occurred_at, component, operation, outcome, correlation_id, causation_id, thread_id, record_refs, duration_ms, error_code FROM trace_events ORDER BY occurred_at, event_id').all() as Array<Record<string, unknown>>;
    rows.forEach(traceEventFromSqliteRow);
    return {name: 'trace_events:schema', status: 'pass', detail: 'all trace events validate', count: rows.length};
  } catch (error) {
    return {name: 'trace_events:schema', status: 'error', detail: String(error)};
  }
}

export function doctorSqlite(databaseFile: string, options: {correlation_id?: string} = {}): DoctorReport {
  const database = absolute(databaseFile, 'database'); const checks: DoctorCheck[] = [];
  if (!fs.existsSync(database)) return {status: 'failed', database, node: process.version, checks: [{name: 'database-exists', status: 'error', detail: 'database file does not exist'}], created_at: new Date().toISOString()};
  let db: SqliteDatabase | undefined;
  let driver: SqliteDriverInfo | undefined;
  let correlationTrace: CorrelationTrace | undefined;
  try {
    const opened = openSqlite(database, {readOnly: true});
    db = opened.db;
    driver = opened.driver;
    const integrity = db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
    checks.push({name: 'sqlite-integrity', status: integrity.integrity_check === 'ok' ? 'pass' : 'error', detail: String(integrity.integrity_check)});
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name: string}>).map(row => row.name));
    for (const table of ['change_sets', 'data_records', 'continuity_records']) {
      if (!tables.has(table)) { checks.push({name: `table:${table}`, status: table === 'continuity_records' ? 'warn' : 'error', detail: 'table is missing'}); continue; }
      const rows = tableRows(db, table); checks.push({name: `table:${table}`, status: 'pass', detail: `${rows.length} revisions`, count: rows.length}); checks.push(...revisionCheck(rows)); checks.push(validateRows(table, rows));
    }
    if (!tables.has('trace_events')) checks.push({name: 'table:trace_events', status: 'warn', detail: 'trace event table is missing; open this database with Trace Runtime 0.6.0+ to initialize it'});
    else {
      const count = Number((db.prepare('SELECT COUNT(*) AS count FROM trace_events').get() as {count: number}).count);
      checks.push({name: 'table:trace_events', status: 'pass', detail: `${count} events`, count});
      checks.push(validateTraceRows(db));
      if (options.correlation_id !== undefined) correlationTrace = {correlation_id: options.correlation_id, events: traceEvents(db, options.correlation_id)};
    }
  } catch (error) { checks.push({name: 'database-open', status: 'error', detail: String(error)}); }
  finally { db?.close(); }
  const hasError = checks.some(check => check.status === 'error'); const hasWarn = checks.some(check => check.status === 'warn');
  if (options.correlation_id !== undefined && correlationTrace === undefined) correlationTrace = {correlation_id: options.correlation_id, events: []};
  return {status: hasError ? 'failed' : hasWarn ? 'warnings' : 'healthy', database, node: process.version, ...(driver === undefined ? {} : {sqlite_driver: driver}), checks, created_at: new Date().toISOString(), ...(correlationTrace === undefined ? {} : {correlation_trace: correlationTrace})};
}

export function backupSqlite(databaseFile: string, backupFile: string): BackupReport {
  const database = absolute(databaseFile, 'database'); const backup = absolute(backupFile, 'backup_file');
  if (!fs.existsSync(database)) throw new ProtocolError('NOT_FOUND', `Database does not exist: ${database}`);
  if (fs.existsSync(backup)) throw new ProtocolError('TARGET_EXISTS', `Backup already exists: ${backup}`);
  fs.mkdirSync(path.dirname(backup), {recursive: true});
  const opened = openSqlite(database);
  const db = opened.db;
  try {
    if (opened.driver.kind === 'sql.js') {
      // sql.js owns a file-backed in-memory image and cannot implement SQLite's
      // VACUUM INTO virtual-file behavior. Its committed image is already a
      // valid SQLite file, so preserve it byte-for-byte as the backup artifact.
      fs.copyFileSync(database, backup, fs.constants.COPYFILE_EXCL);
    } else {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.exec(`VACUUM INTO ${sqlQuote(backup)}`);
    }
  } finally { db.close(); }
  const tables = openSqlite(backup, {readOnly: true}).db;
  let tableNames: string[];
  try { tableNames = (tables.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{name: string}>).map(row => row.name); } finally { tables.close(); }
  const manifest: BackupManifest = {protocol_id: BACKUP_PROTOCOL_ID, protocol_version: BACKUP_PROTOCOL_VERSION, database, backup_file: backup, sha256: sha256(backup), bytes: fs.statSync(backup).size, tables: tableNames, created_at: new Date().toISOString()};
  const manifestFile = `${backup}.manifest.json`; fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
  return {status: 'created', manifest, manifest_file: manifestFile};
}

export function restoreSqlite(backupFile: string, databaseFile: string, replace = false): RestoreReport {
  const backup = absolute(backupFile, 'backup_file'); const database = absolute(databaseFile, 'database'); const manifestFile = `${backup}.manifest.json`;
  if (!fs.existsSync(backup) || !fs.existsSync(manifestFile)) throw new ProtocolError('NOT_FOUND', 'Backup and its manifest are both required');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as BackupManifest;
  if (manifest.protocol_id !== BACKUP_PROTOCOL_ID || manifest.protocol_version !== BACKUP_PROTOCOL_VERSION || manifest.backup_file !== backup) throw new ProtocolError('INVALID_MANIFEST', 'Backup manifest identity does not match');
  if (sha256(backup) !== manifest.sha256 || fs.statSync(backup).size !== manifest.bytes) throw new ProtocolError('BACKUP_CHANGED', 'Backup hash or byte size changed');
  if (fs.existsSync(database) && !replace) throw new ProtocolError('TARGET_EXISTS', `Database exists; use replace=true explicitly: ${database}`);
  const staging = `${database}.restore-staging-${process.pid}`; if (fs.existsSync(staging)) throw new ProtocolError('TARGET_BUSY', `Restore staging exists: ${staging}`);
  fs.mkdirSync(path.dirname(database), {recursive: true}); fs.copyFileSync(backup, staging);
  const check = doctorSqlite(staging); if (check.status === 'failed') { fs.rmSync(staging, {force: true}); throw new ProtocolError('RESTORE_VERIFY_FAILED', 'Restored staging database failed doctor'); }
  let previous: string | undefined;
  if (fs.existsSync(database)) { previous = `${database}.pre-restore-${Date.now()}`; fs.renameSync(database, previous); }
  fs.renameSync(staging, database);
  return {status: 'restored', database, backup_file: backup, ...(previous === undefined ? {} : {previous_database: previous}), sha256: sha256(database), verified: true};
}
