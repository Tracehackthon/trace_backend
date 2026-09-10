import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDataEnvelope, validateDataEnvelope} from '../dist/packages/core/data/src/index.js';
import {buildHostRetrievalEvidenceRecord} from '../dist/packages/core/retrieval-evidence/src/index.js';

test('host retrieval evidence has a closed payload that cannot become a raw tool or prompt sink', () => {
  const input = buildHostRetrievalEvidenceRecord({
    event_kind: 'source_read', source_id: 'personal-wiki', source_scope: {type: 'personal', id: 'user-1'},
    policy: {mode: 'native_observed', allowed_prefixes: ['wiki'], max_reads_per_turn: 8}, host: 'codex', host_session_id: 'session-1', host_turn_id: 'turn-1',
    host_tool_name: 'Bash', host_tool_use_id: 'tool-1', input_hash: 'a'.repeat(64), output_hash: 'b'.repeat(64),
    locators: ['wiki/knowledge/collaboration.md'], page_versions: [{locator: 'wiki/knowledge/collaboration.md', revision: 7, content_hash: 'c'.repeat(64)}],
    causation_id: 'tool:tool-1', correlation_id: 'session:session-1', observed_at: '2026-09-10T00:00:00.000Z',
  });
  const envelope = buildDataEnvelope(input);
  assert.equal(envelope.kind, 'host_retrieval_evidence');
  assert.equal(envelope.payload.locators[0], 'wiki/knowledge/collaboration.md');
  assert.throws(() => validateDataEnvelope({...envelope, payload: {...envelope.payload, raw_tool_output: 'MUST_NOT_ENTER_TRACE'}}), /unsupported fields/);
  assert.throws(() => validateDataEnvelope({...envelope, payload: {...envelope.payload, locators: ['D:/private.md']}}), /safe relative Markdown locator|matching locators/);
});
