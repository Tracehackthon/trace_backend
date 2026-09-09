import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openSqlite} from '../dist/packages/core/storage/src/index.js';
import {validateContinuityEnvelope} from '../dist/packages/core/continuity/src/index.js';
import {TraceRuntime} from '../dist/packages/core/runtime/src/index.js';
import {doctorSqlite} from '../dist/packages/core/operations/src/index.js';

function legacyThread() {
  return {
    protocol_id: 'trace.continuity',
    protocol_version: '0.1.0',
    record_id: 'legacy-thread-001',
    revision: 1,
    kind: 'thread',
    thread_id: 'legacy-thread-001',
    visibility: 'summary',
    payload: {title: 'Legacy thread', status: 'open', current_summary: 'A persisted v0.1 continuity record', candidate_refs: [], adopted_refs: [], open_questions: []},
    created_at: '2026-09-09T00:00:00.000Z',
    updated_at: '2026-09-09T00:00:00.000Z',
  };
}

test('continuity v0.1 records are upcast in memory without rewriting history', () => {
  const upgraded = validateContinuityEnvelope(legacyThread());
  assert.equal(upgraded.protocol_version, '0.2.0');
  assert.equal(upgraded.correlation_id, 'legacy-continuity:legacy-thread-001');
  assert.equal(upgraded.causation_id, 'legacy-continuity:legacy-thread-001@1');
  assert.throws(() => validateContinuityEnvelope({...legacyThread(), protocol_version: '9.9.9'}), /PROTOCOL_MIGRATION_REQUIRED|Unsupported continuity protocol version/);
});

test('a legacy SQLite continuity revision remains immutable and can be followed by a v0.2 revision', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-protocol-upcast-'));
  const database = path.join(directory, 'trace.sqlite');
  const bootstrap = new TraceRuntime({sqliteStateFile: database});
  bootstrap.close();

  const db = openSqlite(database).db;
  db.prepare('INSERT INTO continuity_records(identity, revision, payload) VALUES (?, ?, ?)').run('legacy-thread-001', 1, JSON.stringify(legacyThread()));
  db.close();

  const runtime = new TraceRuntime({sqliteStateFile: database});
  const loaded = runtime.listContinuity('legacy-thread-001');
  assert.equal(loaded[0].protocol_version, '0.2.0');
  const updated = runtime.updateThread('legacy-thread-001', {expected_revision: 1, status: 'watching'});
  assert.equal(updated.protocol_version, '0.2.0');
  assert.equal(updated.revision, 2);
  runtime.close();

  const raw = openSqlite(database, {readOnly: true}).db;
  const revisions = raw.prepare('SELECT revision, payload FROM continuity_records WHERE identity = ? ORDER BY revision').all('legacy-thread-001');
  raw.close();
  assert.equal(JSON.parse(revisions[0].payload).protocol_version, '0.1.0');
  assert.equal(JSON.parse(revisions[1].payload).protocol_version, '0.2.0');
  assert.equal(doctorSqlite(database).status, 'healthy');
});
