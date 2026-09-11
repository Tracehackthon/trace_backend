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

function verifiedDrivers() {
  const drivers = ['sql.js'];
  const database = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trace-native-sqlite-probe-')), 'trace.sqlite');
  try {
    const opened = openSqlite(database, {driver: 'node'});
    opened.db.close();
    drivers.push('node');
  } catch { /* A Node version or vendor build may not provide node:sqlite. */ }
  return drivers;
}

test('every SQLite driver rejects multi-statement reads and preserves a uniform query boundary', () => {
  for (const driver of verifiedDrivers()) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `trace-sqlite-statement-${driver.replace(/[^a-z]/g, '')}-`));
    const database = path.join(directory, 'trace.sqlite');
    const writable = openSqlite(database, {driver});
    try {
      writable.db.exec('CREATE TABLE evidence(value TEXT NOT NULL)');
      writable.db.prepare('INSERT INTO evidence(value) VALUES (?)').run('keep');
      assert.equal(writable.db.prepare('-- leading comment\nSELECT value FROM evidence;').get().value, 'keep', `${driver}: line-comment query`);
      assert.equal(writable.db.prepare('WITH q AS (SELECT value FROM evidence) SELECT value FROM q').get().value, 'keep', `${driver}: CTE SELECT`);
      assert.throws(() => writable.db.prepare('WITH q AS (SELECT value FROM evidence) DELETE FROM evidence RETURNING value').all(), error => error?.code === 'SQLITE_QUERY_REQUIRED', `${driver}: writable CTE is not a query`);
      for (const multiStatement of ['SELECT 1; DELETE FROM evidence', 'PRAGMA integrity_check; DELETE FROM evidence']) {
        assert.throws(() => writable.db.exec(multiStatement), error => error?.code === 'SQLITE_MULTIPLE_STATEMENTS', `${driver}: exec rejects ${multiStatement}`);
        assert.throws(() => writable.db.prepare(multiStatement).all(), error => error?.code === 'SQLITE_MULTIPLE_STATEMENTS', `${driver}: all rejects ${multiStatement}`);
      }
      assert.equal(writable.db.prepare('SELECT COUNT(*) AS count FROM evidence').get().count, 1, `${driver}: no multi-statement write happened`);
      assert.throws(() => writable.db.prepare('DELETE FROM evidence').all(), error => error?.code === 'SQLITE_QUERY_REQUIRED', `${driver}: writable all() rejects DML`);
    } finally { writable.db.close(); }

    const readOnly = openSqlite(database, {driver, readOnly: true});
    try {
      assert.equal(readOnly.db.prepare('WITH q AS (SELECT value FROM evidence) SELECT value FROM q').get().value, 'keep', `${driver}: read-only CTE SELECT`);
      assert.throws(() => readOnly.db.exec('SELECT 1; DELETE FROM evidence'), error => error?.code === 'SQLITE_MULTIPLE_STATEMENTS', `${driver}: read-only exec cannot smuggle DELETE`);
      assert.throws(() => readOnly.db.prepare('DELETE FROM evidence').get(), error => error?.code === 'SQLITE_READ_ONLY', `${driver}: read-only get rejects DML`);
    } finally { readOnly.db.close(); }

    const verify = openSqlite(database, {driver});
    try { assert.equal(verify.db.prepare('SELECT COUNT(*) AS count FROM evidence').get().count, 1, `${driver}: read-only handle left data intact`); }
    finally { verify.db.close(); fs.rmSync(directory, {recursive: true, force: true}); }
  }
});
