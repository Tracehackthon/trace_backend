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

test('product CLI visibly migrates an older unlocked collaboration configuration without changing durable state', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-product-legacy-profile-'));
  const initialized = run(['init', '--project-dir', project, '--json']);
  assert.equal(initialized.result.status, 0, initialized.result.stderr);
  const traceDir = path.join(project, '.trace');
  const database = path.join(traceDir, 'state', 'trace.sqlite');
  const databaseBefore = fs.readFileSync(database);

  // This precisely models a project created before collaboration profiles and
  // their hash-only lock existed. The source profile and durable state remain.
  fs.rmSync(path.join(traceDir, 'profiles', 'collaboration-model.json'));
  fs.rmSync(path.join(traceDir, 'profiles', 'source-activation.json'));
  fs.rmSync(path.join(traceDir, 'instance', 'activation.lock.json'));

  const legacy = run(['profile', '--project-dir', project, '--json']);
  assert.equal(legacy.result.status, 0, legacy.result.stderr);
  assert.equal(legacy.json.configuration_state, 'legacy_unlocked');
  assert.equal(legacy.json.activation_lock, null);
  assert.equal(legacy.json.collaboration_model.model_id, 'trace.cognitive-collaboration-starter');

  const refused = run(['profile', 'migrate', '--project-dir', project], {json: false});
  assert.notEqual(refused.result.status, 0);
  assert.match(refused.result.stdout, /USER_CONFIRMATION_REQUIRED/);

  const migrated = run(['profile', 'migrate', '--project-dir', project, '--confirm', 'true', '--json']);
  assert.equal(migrated.result.status, 0, migrated.result.stderr);
  assert.equal(migrated.json.status, 'migrated');
  assert.equal(migrated.json.previous_state, 'legacy_unlocked');
  assert.equal(fs.existsSync(path.join(traceDir, 'profiles', 'collaboration-model.json')), true);
  assert.equal(fs.existsSync(path.join(traceDir, 'profiles', 'source-activation.json')), true);
  assert.equal(fs.existsSync(path.join(traceDir, 'instance', 'activation.lock.json')), true);
  assert.deepEqual(fs.readFileSync(database), databaseBefore, 'migration must not alter the SQLite ledger');

  const locked = run(['profile', '--project-dir', project, '--json']);
  assert.equal(locked.result.status, 0, locked.result.stderr);
  assert.equal(locked.json.configuration_state, 'locked');
  assert.notEqual(locked.json.activation_lock, null);
  const repeated = run(['profile', 'migrate', '--project-dir', project, '--confirm', 'true', '--json']);
  assert.equal(repeated.result.status, 0, repeated.result.stderr);
  assert.equal(repeated.json.status, 'already_locked');

  const instanceLockFile = path.join(traceDir, 'instance', 'trace.lock.json');
  const instanceLock = JSON.parse(fs.readFileSync(instanceLockFile, 'utf8'));
  instanceLock.runtime_version = '0.6.0';
  fs.writeFileSync(instanceLockFile, JSON.stringify(instanceLock, null, 2) + '\n', 'utf8');
  const updateInspection = run(['upgrade', '--project-dir', project, '--json']);
  assert.equal(updateInspection.result.status, 0, updateInspection.result.stderr);
  assert.equal(updateInspection.json.status, 'inspected');
  assert.equal(updateInspection.json.runtime.state, 'runtime_changed');
  assert.deepEqual(updateInspection.json.automatic_changes, []);
  assert.deepEqual(fs.readFileSync(database), databaseBefore, 'inspection must not alter the SQLite ledger');
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
  assert.equal(status.json.collaboration.model_id, 'trace.cognitive-collaboration-starter');
  const profileBefore = run(['profile', '--project-dir', project, '--json']);
  assert.equal(profileBefore.result.status, 0, profileBefore.result.stderr);
  assert.equal(profileBefore.json.collaboration_model.scope, 'starter');
  assert.equal(profileBefore.json.source_activation.entry_points.length, 0);

  const activationConfig = path.join(project, 'activation-config.json');
  fs.writeFileSync(activationConfig, JSON.stringify({
    collaboration_model: {
      protocol_id: 'trace.collaboration-model', protocol_version: '0.1.0', model_id: 'trace.test-project-collaboration', version: '1.1.0', display_name: 'Project Collaboration Contract', scope: 'project',
      principles: ['Connect the user request to the current project evidence.'],
      open_discussion: ['Do not replace an unfinished thought with a generic checklist.'],
      explicit_execution: ['Perform explicit implementation requests with verifiable evidence.'],
      epistemic_practice: ['Separate runtime fact, source claim, and inference.'],
      boundaries: ['Do not persist raw prompts or private source bodies.'],
    },
    source_activation: {
      protocol_id: 'trace.source-activation', protocol_version: '0.1.0', manifest_id: 'trace.test-project-source-map', version: '1.1.0', source_id: 'project-cognitive-source', display_name: 'Project Source Map', summary: 'A visible local map for this project.', activation_profiles: ['open-discussion'],
      entry_points: [{id: 'collaboration', label: 'Collaboration notes', kind: 'capability', purpose: 'Use for collaboration design.', triggers: ['collaboration', 'context'], locator: 'wiki/collaboration.md'}],
    },
  }), 'utf8');
  const updatedProfile = run(['profile', 'update', '--project-dir', project, '--file', activationConfig, '--confirm', 'true', '--json']);
  assert.equal(updatedProfile.result.status, 0, updatedProfile.result.stderr);
  assert.equal(updatedProfile.json.status, 'updated');
  assert.equal(fs.existsSync(updatedProfile.json.backup_dir), true);
  const profileAfter = run(['profile', '--project-dir', project, '--json']);
  assert.equal(profileAfter.json.collaboration_model.model_id, 'trace.test-project-collaboration');
  assert.equal(profileAfter.json.source_activation.entry_points[0].locator, 'wiki/collaboration.md');
  const sourcesAfter = run(['sources', '--project-dir', project, '--json']);
  assert.equal(sourcesAfter.json.sources[0].activation_map.entry_points[0].label, 'Collaboration notes');

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
