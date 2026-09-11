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

test('sql.js all/get enforce the query boundary and cannot mutate through a read-only handle', () => {
  const database = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trace-sqlite-read-only-')), 'trace.sqlite');
  const writable = openSqlite(database, {driver: 'sql.js'});
  try {
    writable.db.exec('CREATE TABLE evidence(value TEXT NOT NULL)');
    writable.db.prepare('INSERT INTO evidence(value) VALUES (?)').run('keep');
  } finally { writable.db.close(); }

  const readOnly = openSqlite(database, {driver: 'sql.js', readOnly: true});
  try {
    assert.equal(readOnly.db.prepare('SELECT value FROM evidence').get().value, 'keep');
    assert.equal(readOnly.db.prepare('/* source comment */ SELECT value FROM evidence').get().value, 'keep');
    assert.equal(readOnly.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    for (const statement of ['DELETE FROM evidence', '/* source comment */ DELETE FROM evidence', 'UPDATE evidence SET value = \'changed\'', 'INSERT INTO evidence(value) VALUES (\'new\')', 'CREATE TABLE unwanted(value TEXT)']) {
      assert.throws(() => readOnly.db.prepare(statement).all(), error => error?.code === 'SQLITE_READ_ONLY');
      assert.throws(() => readOnly.db.prepare(statement).get(), error => error?.code === 'SQLITE_READ_ONLY');
    }
  } finally { readOnly.db.close(); }

  const stillWritable = openSqlite(database, {driver: 'sql.js'});
  try {
    assert.equal(stillWritable.db.prepare('SELECT COUNT(*) AS count FROM evidence').get().count, 1);
    assert.equal(stillWritable.db.prepare('SELECT value FROM evidence').get().value, 'keep');
    assert.throws(() => stillWritable.db.prepare('DELETE FROM evidence').all(), error => error?.code === 'SQLITE_QUERY_REQUIRED');
    assert.throws(() => stillWritable.db.prepare('DELETE FROM evidence').get(), error => error?.code === 'SQLITE_QUERY_REQUIRED');
    assert.equal(stillWritable.db.prepare('SELECT COUNT(*) AS count FROM evidence').get().count, 1);
  } finally { stillWritable.db.close(); }
});
