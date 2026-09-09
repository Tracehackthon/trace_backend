import fs from 'node:fs';
import path from 'node:path';
import {SqliteVersionedStore, StorageError, readJsonl} from '../../storage/src/index.js';
import {validateChangeSet, type ChangeSet} from '../../protocol/src/index.js';
import {validateDataEnvelope, type DataEnvelope} from '../../data/src/index.js';

export interface JsonlToSqliteInput {
  changeStateFile: string;
  dataStateFile: string;
  sqliteStateFile: string;
}

export interface MigrationReport {
  migration_id: string;
  source: {change_state_file: string; data_state_file: string};
  target: string;
  change_records: number;
  data_records: number;
  change_revisions: number;
  data_revisions: number;
  verified: true;
  created_at: string;
}

function absolute(file: string): string {
  if (!path.isAbsolute(file)) throw new StorageError('INVALID_PATH', `Migration path must be absolute: ${file}`);
  return path.resolve(file);
}

function prepareRows<T extends {revision: number; change_id?: string; record_id?: string}>(rows: T[], validate: (value: unknown) => T, label: string): T[] {
  const checked = rows.map(value => validate(value));
  const groups = new Map<string, T[]>();
  for (const value of checked) {
    const key = value.change_id ?? value.record_id ?? '';
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    const revisions = group.map(value => value.revision).sort((a, b) => a - b);
    for (let index = 0; index < revisions.length; index += 1) if (revisions[index] !== index + 1) throw new StorageError('REVISION_GAP', `${label} ${key} is missing revision ${index + 1}`);
  }
  return checked.sort((a, b) => a.revision - b.revision);
}

export function migrateJsonlToSqlite(input: JsonlToSqliteInput): MigrationReport {
  const changeSource = absolute(input.changeStateFile);
  const dataSource = absolute(input.dataStateFile);
  const target = absolute(input.sqliteStateFile);
  if (changeSource === target || dataSource === target) throw new StorageError('INVALID_PATH', 'SQLite target must be different from JSONL sources');
  if (fs.existsSync(target) && fs.statSync(target).size > 0) throw new StorageError('TARGET_NOT_EMPTY', `SQLite target already exists: ${target}`);
  const changes = prepareRows(readJsonl<ChangeSet>(changeSource), validateChangeSet, 'change');
  const data = prepareRows(readJsonl<DataEnvelope>(dataSource), validateDataEnvelope, 'data');
  const staging = `${target}.staging`;
  if (fs.existsSync(staging)) throw new StorageError('TARGET_BUSY', `Migration staging file exists: ${staging}`);
  const changeStore = new SqliteVersionedStore<ChangeSet>(staging, 'change_sets');
  const dataStore = new SqliteVersionedStore<DataEnvelope>(staging, 'data_records');
  try {
    for (const record of changes) changeStore.append(record);
    for (const record of data) dataStore.append(record);
    if (changeStore.all().length !== changes.length || dataStore.all().length !== data.length) throw new StorageError('MIGRATION_COUNT_MISMATCH', 'SQLite migration count does not match source');
    changeStore.close();
    dataStore.close();
    fs.renameSync(staging, target);
  } catch (error) {
    changeStore.close();
    dataStore.close();
    throw error;
  }
  return {
    migration_id: `migration-${Date.now()}`,
    source: {change_state_file: changeSource, data_state_file: dataSource},
    target,
    change_records: new Set(changes.map(record => record.change_id)).size,
    data_records: new Set(data.map(record => record.record_id)).size,
    change_revisions: changes.length,
    data_revisions: data.length,
    verified: true,
    created_at: new Date().toISOString(),
  };
}
