import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {openSqlite, SqliteVersionedStore} from '../dist/packages/core/storage/src/index.js';
import {TraceRuntime} from '../dist/packages/core/runtime/src/index.js';
import {doctorSqlite} from '../dist/packages/core/operations/src/index.js';

const root = path.resolve(process.cwd());
const worker = path.join(root, 'tests', 'fixtures', 'sqlite-concurrency-worker.mjs');

function runWorker(database, prefix, count, mode = 'independent') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, database, prefix, String(count), mode], {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({stdout, stderr});
      else reject(new Error(`worker ${prefix} exited ${code}: ${stderr || stdout}`));
    });
  });
}

test('SQLite hot writes only read the addressed identity while explicit full reads still reject corruption', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-sqlite-hot-path-'));
  const database = path.join(directory, 'trace.sqlite');
  const first = new SqliteVersionedStore(database, 'records');
  first.append({record_id: 'healthy', revision: 1, value: 'first'});
  first.close();

  const db = openSqlite(database).db;
  db.prepare('INSERT INTO records(identity, revision, payload) VALUES (?, ?, ?)').run('corrupt-unrelated', 1, '{not-json');
  db.close();

  const writer = new SqliteVersionedStore(database, 'records');
  assert.doesNotThrow(() => writer.append({record_id: 'new-write', revision: 1, value: 'second'}));
  const gap = openSqlite(database).db;
  gap.prepare('INSERT INTO records(identity, revision, payload) VALUES (?, ?, ?)').run('gap-target', 2, JSON.stringify({record_id: 'gap-target', revision: 2, value: 'invalid history'}));
  gap.close();
  assert.throws(() => writer.append({record_id: 'gap-target', revision: 3, value: 'must not extend a gap'}), /Missing revision gap-target@1/);
  assert.throws(() => writer.latest(), /Invalid JSON payload/);
  writer.close();
});

test('four independent Node processes serialize SQLite writers without lost records or SQLITE_BUSY', {timeout: 20_000}, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-sqlite-concurrency-'));
  const database = path.join(directory, 'trace.sqlite');
  const workers = ['a', 'b', 'c', 'd'];
  await Promise.all(workers.map(prefix => runWorker(database, prefix, 12)));

  const runtime = new TraceRuntime({sqliteStateFile: database});
  assert.equal(runtime.listContinuity().filter(record => record.kind === 'thread').length, 48);
  runtime.close();
  assert.equal(doctorSqlite(database).status, 'healthy');
});

test('concurrent append-if-absent resolves one shared identity without duplicate revisions', {timeout: 20_000}, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-sqlite-concurrency-shared-'));
  const database = path.join(directory, 'trace.sqlite');
  await Promise.all(['a', 'b', 'c', 'd'].map(prefix => runWorker(database, prefix, 1, 'same')));

  const runtime = new TraceRuntime({sqliteStateFile: database});
  const records = runtime.listContinuity('concurrent-shared-thread');
  assert.equal(records.length, 1);
  assert.equal(records[0].revision, 1);
  runtime.close();
  assert.equal(doctorSqlite(database).status, 'healthy');
});
