import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MyWikiSourceProvider} from '../../dist/packages/integration/mywiki-source/src/index.js';
import {aggregateEvaluation, evaluateCase, fixtureSourceProfile, loadEvalCases, materializeFixtureSource} from './lib.mjs';

test('MyWiKi activation retrieval meets the synthetic golden set without activating excluded pages', () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-eval-source-'));
  materializeFixtureSource(sourceRoot);
  const provider = new MyWikiSourceProvider(fixtureSourceProfile(sourceRoot));
  const results = loadEvalCases().map(caseDefinition => evaluateCase(caseDefinition, provider.search(caseDefinition.prompt, caseDefinition.max_pointers).map(page => page.relative_path)));
  const metrics = aggregateEvaluation(results);

  assert.equal(results.length, 12, 'the golden set must contain the declared twelve cases');
  assert.equal(metrics.failed_cases, 0, JSON.stringify({metrics, results}, null, 2));
  assert.equal(metrics.precision_at_k, 1);
  assert.equal(metrics.recall_at_k, 1);
  assert.equal(metrics.irrelevant_activation_rate, 0);
  assert.equal(metrics.forbidden_read_rate, 0);
  assert.deepEqual(provider.search('private finance budget forecast', 3), [], 'excluded private content must not enter automatic activation');
});
