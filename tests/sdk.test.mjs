import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {TraceRuntimeClient} from '../dist/packages/sdk/typescript/src/index.js';

test('TypeScript SDK drives the same RPC contract as the runtime', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-runtime-sdk-'));
  const changeState = path.join(dir, 'changes.jsonl');
  const dataState = path.join(dir, 'data.jsonl');
  const client = new TraceRuntimeClient({executable: process.execPath, args: [path.resolve('dist/packages/sdk/server/src/main.js'), '--change-state-file', changeState, '--data-state-file', dataState]});
  try {
    const created = await client.createChange({
      change_kind: 'runtime',
      subject: {type: 'codex.adapter', id: 'codex.adapter'},
      base: {runtime_version: '0.5.0'},
      proposed: {runtime_version: '0.6.0'},
      impact: ['codex'],
      compatibility: {backward_compatible: false, migration_required: true, impact_level: 'high'},
      requested_by: 'ts-test',
      scope: {type: 'project', id: 'trace'},
      lineage: {input_refs: [], output_refs: [], parent_change_ids: [], causation_id: 'sdk:test', correlation_id: 'sdk:run'},
    });
    const listed = await client.listChanges();
    assert.equal(created.record.protocol_id, 'trace.change-set');
    assert.equal(listed.records.length, 1);
    assert.equal(listed.records[0].change_id, created.record.change_id);
  } finally {
    await client.close();
  }
});

test('TypeScript SDK drives the data ledger and returns a verifiable lineage report', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-runtime-data-sdk-'));
  const changeState = path.join(dir, 'changes.jsonl');
  const dataState = path.join(dir, 'data.jsonl');
  const client = new TraceRuntimeClient({executable: process.execPath, args: [path.resolve('dist/packages/sdk/server/src/main.js'), '--change-state-file', changeState, '--data-state-file', dataState]});
  const hash = crypto.createHash('sha256').update('sdk-source').digest('hex');
  try {
    const source = await client.createData({
      kind: 'source_snapshot', schema_id: 'trace.external-source.zhihu', schema_version: '0.1.0', subject: {type: 'zhihu.answer', id: 'sdk-1'}, scope: {type: 'project', id: 'trace'}, classification: 'public',
      origin: {provider: 'synthetic', source_id: 'zhihu:sdk-1', captured_at: new Date().toISOString(), content_hash: hash}, producer: {component: 'sdk-test', version: '1', run_id: 'sdk-data-run'}, lineage: {parent_refs: [], source_refs: [], causation_id: 'sdk-data:capture', correlation_id: 'sdk-data:run'},
      payload: {source_id: 'zhihu:sdk-1', provider: 'zhihu', external_id: 'sdk-1', title: 'SDK source', content: 'sdk-source', captured_at: new Date().toISOString(), content_hash: hash},
    });
    const ref = {record_id: source.record.record_id, revision: 1, kind: source.record.kind, schema_id: source.record.schema_id, schema_version: source.record.schema_version};
    const change = await client.createChange({change_kind: 'result', subject: {type: 'zhihu.result', id: 'sdk-result-1'}, base: {schema_version: '0.1.0'}, proposed: {schema_version: '0.1.1'}, impact: ['data-ledger'], compatibility: {backward_compatible: false, migration_required: true, impact_level: 'medium'}, requested_by: 'sdk-test', scope: {type: 'project', id: 'trace'}, lineage: {input_refs: [ref], output_refs: [], parent_change_ids: [], causation_id: 'sdk-data:change', correlation_id: 'sdk-data:run'}});
    const result = await client.createData({
      kind: 'normalized_result', status: 'normalized', schema_id: 'trace.zhihu.result', schema_version: '0.1.0', subject: {type: 'zhihu.result', id: 'sdk-result-1'}, scope: {type: 'project', id: 'trace'}, classification: 'public',
      origin: {provider: 'synthetic-normalizer', source_id: source.record.record_id, captured_at: new Date().toISOString(), content_hash: hash}, producer: {component: 'sdk-test', version: '1', run_id: 'sdk-data-run'}, lineage: {parent_refs: [], source_refs: [ref], change_id: change.record.change_id, causation_id: 'sdk-data:normalize', correlation_id: 'sdk-data:run'},
      payload: {source_record_id: source.record.record_id, schema_version: '0.1.0', items: [{value: 'kept'}], normalized_at: new Date().toISOString()},
    });
    const outputRef = {record_id: result.record.record_id, revision: 1, kind: result.record.kind, schema_id: result.record.schema_id, schema_version: result.record.schema_version};
    const linkedChange = await client.updateChange(change.record.change_id, {expected_revision: 1, status: 'analyzed', lineage: {output_refs: [outputRef]}});
    assert.equal(linkedChange.record.lineage.output_refs[0].record_id, result.record.record_id);
    const chain = await client.verifyDataChain(result.record.record_id);
    assert.equal(chain.complete, true);
    assert.equal(chain.edge_count, 1);
    assert.equal((await client.listData()).records.length, 2);
  } finally {
    await client.close();
  }
});
