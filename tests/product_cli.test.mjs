import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const cli = path.join(process.cwd(), 'dist', 'apps', 'cli', 'src', 'main.js');
function run(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8', ...options});
  return {result, json: options.json === false ? undefined : JSON.parse(result.stdout)};
}

test('product CLI keeps the default path small, discovers the project, and hides protocol flags', () => {
  const help = run(['--help'], {json: false});
  assert.equal(help.result.status, 0, help.result.stderr);
  assert.match(help.result.stdout, /trace init/);
  assert.match(help.result.stdout, /trace inbox/);
  assert.doesNotMatch(help.result.stdout, /change create/);
  assert.doesNotMatch(help.result.stdout, /--causation-id/);
  const advanced = run(['--help', '--advanced'], {json: false});
  assert.equal(advanced.result.status, 0, advanced.result.stderr);
  assert.match(advanced.result.stdout, /change create/);
});

test('product CLI initializes, reviews an explicit prompt case, enables Codex, and backs up without state-file flags', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-product-cli-'));
  const hooks = path.join(project, 'hooks.json');
  const initialized = run(['init', '--project-dir', project, '--json']);
  assert.equal(initialized.result.status, 0, initialized.result.stderr);
  assert.equal(initialized.json.status, 'initialized');
  assert.equal(initialized.json.source_mode, 'local');
  const database = path.join(project, '.trace', 'state', 'trace.sqlite');
  assert.equal(fs.existsSync(database), true, 'init makes the project immediately doctor/backup-ready');
  const doctor = run(['doctor', '--project-dir', project, '--json']);
  assert.equal(doctor.result.status, 0, doctor.result.stderr);
  assert.equal(doctor.json.status, 'healthy');
  const status = run(['status', '--project-dir', project, '--json']);
  assert.equal(status.result.status, 0, status.result.stderr);
  assert.equal(status.json.pending_reviews, 0);

  const prompt = path.join(project, 'raw.txt');
  const selected = path.join(project, 'summary.txt');
  const producer = path.join(project, 'producer.json');
  fs.writeFileSync(prompt, 'PRODUCT_RAW_PROMPT_MUST_STAY_TRANSIENT', 'utf8');
  fs.writeFileSync(selected, 'A user-selected safe summary of the Agent collaboration issue.', 'utf8');
  fs.writeFileSync(producer, JSON.stringify({component: 'product-cli-test', version: '1.0.0', run_id: 'product-cli'}), 'utf8');
 const proposed = run(['internal', 'prompt-case', 'propose', '--sqlite-state-file', database, '--prompt-file', prompt, '--mode', 'summary', '--intent-summary', 'Agent collaboration context boundary.', '--rationale', 'A user should decide whether to retain this case.', '--scope-type', 'project', '--scope-id', 'product-cli', '--producer', `@${producer}`, '--correlation-id', 'corr-product', '--causation-id', 'cause-product']);
  assert.equal(proposed.result.status, 0, proposed.result.stderr);
  assert.equal(proposed.result.stdout.includes('PRODUCT_RAW_PROMPT_MUST_STAY_TRANSIENT'), false);

  const inbox = run(['inbox', '--project-dir', project, '--json']);
  assert.equal(inbox.result.status, 0, inbox.result.stderr);
  assert.equal(inbox.json.items.length, 1);
  const proposalId = inbox.json.items[0].id;
  const review = run(['review', proposalId, '--project-dir', project, '--save', selected, '--json']);
  assert.equal(review.result.status, 0, review.result.stderr);
  assert.equal(review.json.status, 'captured');
  assert.equal(review.result.stdout.includes('PRODUCT_RAW_PROMPT_MUST_STAY_TRANSIENT'), false);

  const enabled = run(['codex', 'enable', '--project-dir', project, '--hooks-file', hooks, '--json']);
  assert.equal(enabled.result.status, 0, enabled.result.stderr);
  assert.equal(enabled.json.status, 'enabled');
  const hooksValue = JSON.parse(fs.readFileSync(hooks, 'utf8'));
  assert.match(JSON.stringify(hooksValue), /internal codex hook-stdio/);
  const codexStatus = run(['codex', 'status', '--project-dir', project, '--hooks-file', hooks, '--json']);
  assert.equal(codexStatus.json.status, 'enabled');

  const backup = run(['backup', 'create', '--project-dir', project, '--json']);
  assert.equal(backup.result.status, 0, backup.result.stderr);
  assert.equal(backup.json.status, 'created');
  assert.equal(fs.existsSync(backup.json.backup.manifest.backup_file), true);
});