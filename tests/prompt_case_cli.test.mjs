import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const cli = path.join(process.cwd(), 'dist', 'apps', 'cli', 'src', 'main.js');
function run(args) { const result = spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8'}); return {result, output: JSON.parse(result.stdout)}; }

test('CLI runs prompt-case transient to proposal to selected snapshot without echoing raw prompt', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-prompt-case-cli-'));
  const database = path.join(directory, 'trace.sqlite');
  const promptFile = path.join(directory, 'raw-prompt.txt');
  const contentFile = path.join(directory, 'selected-summary.txt');
  const producerFile = path.join(directory, 'producer.json');
  const marker = 'CLI_RAW_PROMPT_NEVER_ECHOED_8ccd';
  fs.writeFileSync(promptFile, marker, 'utf8');
  fs.writeFileSync(contentFile, 'A user-selected safe summary of a multi-agent handoff issue.', 'utf8');
  fs.writeFileSync(producerFile, JSON.stringify({component: 'cli-test', version: '1.0.0', run_id: 'cli-case'}), 'utf8');
  const common = ['--sqlite-state-file', database, '--producer', `@${producerFile}`, '--correlation-id', 'corr-cli', '--causation-id', 'cause-cli'];
  const proposed = run(['prompt-case', 'propose', ...common, '--prompt-file', promptFile, '--mode', 'summary', '--intent-summary', 'Reusable handoff case.', '--rationale', 'Need a visible receipt.', '--scope-type', 'personal', '--scope-id', 'user-cli']);
  assert.equal(proposed.result.status, 0, proposed.result.stderr);
  assert.equal(proposed.result.stdout.includes(marker), false);
  assert.equal(proposed.output.status, 'proposed');
  const proposalRef = JSON.stringify(proposed.output.proposal.proposal_ref);
  const captured = run(['prompt-case', 'capture', ...common, '--proposal-ref', proposalRef, '--approval', `approve:${proposed.output.proposal.proposal_ref.record_id}`, '--content-file', contentFile]);
  assert.equal(captured.result.status, 0, captured.result.stderr);
  assert.equal(captured.output.status, 'captured');
  assert.equal(captured.output.source_snapshot_ref.kind, 'source_snapshot');
  assert.equal(captured.result.stdout.includes(marker), false);
});
