import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {hasStableNodeSqlite, openSqlite, selectSqliteDriver} from '../dist/packages/core/storage/src/index.js';

test('SQLite driver selection avoids Node 22 experimental loading through the packaged pure-JS fallback', () => {
  assert.equal(hasStableNodeSqlite('22.23.1'), false);
  assert.equal(hasStableNodeSqlite('24.2.0'), true);
  assert.deepEqual(selectSqliteDriver({nodeVersion: '22.23.1', hasSqlJs: true}), {kind: 'sql.js'});
  assert.equal(selectSqliteDriver({nodeVersion: '22.23.1', hasSqlJs: false}).kind, 'node:sqlite');
  assert.equal(selectSqliteDriver({preference: 'node', nodeVersion: '22.23.1', hasSqlJs: true}).warning?.includes('experimental'), true);
  assert.throws(() => selectSqliteDriver({preference: 'sql.js', nodeVersion: '24.2.0', hasSqlJs: false}), error => error?.code === 'SQLITE_DRIVER_UNAVAILABLE');
});

test('the actual current runtime opens SQLite through the selected fallback driver', () => {
  const database = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trace-sqlite-driver-')), 'trace.sqlite');
  const opened = openSqlite(database);
  try {
    opened.db.exec('CREATE TABLE evidence(value TEXT NOT NULL)');
    opened.db.prepare('INSERT INTO evidence(value) VALUES (?)').run('ok');
    assert.equal(opened.db.prepare('SELECT value FROM evidence').get().value, 'ok');
    assert.equal(opened.driver.kind, process.versions.node.startsWith('22.') ? 'sql.js' : opened.driver.kind);
  } finally { opened.db.close(); }
});
