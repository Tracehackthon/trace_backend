import test from 'node:test';
import assert from 'node:assert/strict';
import {requireObject, requireStringList, requireText} from '../dist/packages/core/protocol/src/index.js';
import {validateActivationPack} from '../dist/packages/core/context/src/index.js';
import {validateContinuityEnvelope} from '../dist/packages/core/continuity/src/index.js';

function next(seed) {
  return (seed * 1_664_525 + 1_013_904_223) >>> 0;
}

function clone(value) { return structuredClone(value); }

function validPack() {
  return {
    protocol_id: 'trace.context-record', protocol_version: '0.1.0', pack_id: 'pack-fuzz',
    purpose: 'Validate bounded context', summary: 'A valid compact summary', source_refs: [], read_pointers: [],
    budget: {max_tokens: 6000, max_sources: 16}, forbidden_scopes: [], generated_at: '2026-09-09T00:00:00.000Z',
  };
}

function validContinuity() {
  return {
    protocol_id: 'trace.continuity', protocol_version: '0.2.0', record_id: 'continuity-fuzz', revision: 1,
    kind: 'thread', thread_id: 'continuity-fuzz', correlation_id: 'run:fuzz', causation_id: 'cause:fuzz', visibility: 'summary',
    payload: {title: 'Fuzz thread', status: 'open', current_summary: 'A valid thread', candidate_refs: [], adopted_refs: [], open_questions: []},
    created_at: '2026-09-09T00:00:00.000Z', updated_at: '2026-09-09T00:00:00.000Z',
  };
}

test('shared validation primitives preserve their output invariants across a deterministic malformed corpus', () => {
  let seed = 0x5eedc0de;
  const malformed = [undefined, null, false, 0, '', [], [''], ['ok', 7], {unexpected: true}, 'x'.repeat(501)];
  for (let index = 0; index < 500; index += 1) {
    seed = next(seed);
    const value = malformed[seed % malformed.length];
    try {
      const output = requireText(value, `text-${index}`, 500);
      assert.equal(typeof output, 'string');
      assert.ok(output.length > 0 && output.length <= 500);
    } catch (error) {
      assert.equal(error.name, 'TraceProtocolError');
    }
    try {
      const output = requireObject(value, `object-${index}`);
      assert.equal(Array.isArray(output), false);
      assert.equal(typeof output, 'object');
    } catch (error) {
      assert.equal(error.name, 'TraceProtocolError');
    }
    try {
      const output = requireStringList(value, `list-${index}`, {min: 0, max: 4});
      assert.ok(output.every(item => typeof item === 'string' && item.trim().length > 0));
    } catch (error) {
      assert.equal(error.name, 'TraceProtocolError');
    }
  }
});

test('activation and continuity validators reject deterministic unknown-field and required-field mutations', () => {
  let seed = 0x0ddc0ffe;
  for (let index = 0; index < 250; index += 1) {
    seed = next(seed);
    const pack = clone(validPack());
    const continuity = clone(validContinuity());
    switch (seed % 5) {
      case 0: delete pack.purpose; delete continuity.correlation_id; break;
      case 1: pack.unknown = true; continuity.unknown = true; break;
      case 2: pack.budget.max_tokens = 0; continuity.revision = 0; break;
      case 3: pack.source_refs = [{record_id: '', revision: 1, label: 'bad'}]; continuity.payload.title = ''; break;
      default: pack.read_pointers = [{path: 'x', purpose: 'x', priority: 'invalid', stop_condition: 'x'}]; continuity.causation_id = '\n';
    }
    assert.throws(() => validateActivationPack(pack), error => error?.name === 'TraceProtocolError');
    assert.throws(() => validateContinuityEnvelope(continuity), error => error?.name === 'TraceProtocolError');
  }
});
