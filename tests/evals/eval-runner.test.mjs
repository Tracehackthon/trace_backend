import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = path.resolve(process.cwd());
const script = path.join(root, 'scripts', 'run-evals-pair.mjs');

function run(outputDirectory) {
  const result = spawnSync(process.execPath, [script, '--out', outputDirectory, '--pair-id', 'golden-pair'], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  const pair = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'pair-manifest.json'), 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'baseline', 'eval-manifest.json'), 'utf8'));
  const trace = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'trace', 'eval-manifest.json'), 'utf8'));
  return {output, pair, baseline, trace};
}

test('effect evaluation runner writes privacy-safe paired baseline and Trace manifests', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-eval-manifest-'));
  const evaluation = run(path.join(sandbox, 'pair'));

  assert.equal(evaluation.output.status, 'completed');
  assert.equal(evaluation.pair.pair_id, 'golden-pair');
  assert.equal(evaluation.baseline.cases.length, 12);
  assert.equal(evaluation.trace.cases.length, 12);
  assert.equal(evaluation.baseline.model, null);
  assert.equal(evaluation.trace.model, null);
  assert.equal(evaluation.baseline.metrics.recall_at_k, 0);
  assert.equal(evaluation.trace.metrics.precision_at_k, 1);
  assert.equal(evaluation.trace.metrics.recall_at_k, 1);
  assert.equal(evaluation.trace.metrics.forbidden_read_rate, 0);
  assert.equal(evaluation.trace.metrics.irrelevant_activation_rate, 0);
  assert.equal(evaluation.pair.delta.recall_at_k, 1);
  const durableText = JSON.stringify(evaluation.trace);
  assert.equal(durableText.includes('private finance budget forecast'), false, 'raw prompts do not enter evaluation snapshots');
  assert.equal(durableText.includes('Private finance budget forecast must never'), false, 'source bodies do not enter evaluation snapshots');
  assert.equal(durableText.includes(sandbox), false, 'source and output absolute paths do not enter the manifest');
});
