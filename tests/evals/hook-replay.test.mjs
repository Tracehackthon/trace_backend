import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {openSqlite} from '../../dist/packages/core/storage/src/index.js';
import {aggregateEvaluation, evaluateCase, fixtureSourceProfile, loadEvalCases, materializeFixtureSource} from './lib.mjs';

const root = path.resolve(process.cwd());
const cli = path.join(root, 'dist', 'apps', 'cli', 'src', 'main.js');

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8', ...options});
}

function runJson(args, options = {}) {
  const result = run(args, options);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function createProject(sandbox, id, sourceProfile) {
  const project = path.join(sandbox, `project-${id}`);
  const profileFile = path.join(sandbox, `profile-${id}.json`);
  fs.mkdirSync(path.join(project, 'nested'), {recursive: true});
  fs.writeFileSync(profileFile, JSON.stringify(sourceProfile), 'utf8');
  runJson(['init', '--project-dir', project, '--source', 'external', '--source-profile', profileFile, '--json']);
  return {project, nested: path.join(project, 'nested')};
}

function replayHook(cwd, sessionId, prompt) {
  const result = run(['internal', 'codex', 'hook-stdio', '--route-from-event-cwd'], {
    input: JSON.stringify({hook_event_name: 'UserPromptSubmit', cwd, session_id: sessionId, prompt}),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function hookPointers(output) {
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  const context = JSON.parse(output.hookSpecificOutput.additionalContext);
  assert.equal(context.activation_mode, 'pointer_only');
  assert.equal(context.read_pointers.length, context.pages_considered.length);
  for (const pointer of context.read_pointers) assert.equal(path.isAbsolute(pointer.path), true, 'only the host-visible response may carry an absolute pointer');
  return context.pages_considered.map(page => page.path);
}

test('the real Codex hook replays the golden set, routes by cwd, and preserves the durable pointer-only boundary', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-hook-replay-'));
  const sourceRoot = path.join(sandbox, 'source-a');
  materializeFixtureSource(sourceRoot);
  const projectA = createProject(sandbox, 'a', fixtureSourceProfile(sourceRoot));
  const cases = loadEvalCases();
  const rawPrompts = cases.map(caseDefinition => caseDefinition.prompt);
  const results = cases.map((caseDefinition, index) => {
    const output = replayHook(projectA.nested, `eval-a-${index}`, caseDefinition.prompt);
    const returned = hookPointers(output);
    assert.equal(JSON.stringify(output).includes(caseDefinition.prompt), false, `transient prompt leaked from hook output for ${caseDefinition.case_id}`);
    return evaluateCase(caseDefinition, returned);
  });
  const metrics = aggregateEvaluation(results);
  assert.equal(metrics.failed_cases, 0, JSON.stringify({metrics, results}, null, 2));
  assert.equal(metrics.precision_at_k, 1);
  assert.equal(metrics.recall_at_k, 1);
  assert.equal(metrics.irrelevant_activation_rate, 0);
  assert.equal(metrics.forbidden_read_rate, 0);

  const sourceB = path.join(sandbox, 'source-b');
  fs.mkdirSync(path.join(sourceB, 'wiki'), {recursive: true});
  fs.writeFileSync(path.join(sourceB, 'wiki', 'only-b.md'), '---\ntitle: Project B only\n---\n\nZQXWTRUNUMBER\n', 'utf8');
  const projectB = createProject(sandbox, 'b', fixtureSourceProfile(sourceB, {source_id: 'eval-mywiki-b', activation_excluded_paths: []}));
  const routedToA = hookPointers(replayHook(projectA.nested, 'route-a', 'ZQXWTRUNUMBER'));
  const routedToB = hookPointers(replayHook(projectB.nested, 'route-b', 'ZQXWTRUNUMBER'));
  assert.deepEqual(routedToA, []);
  assert.deepEqual(routedToB, ['wiki/only-b.md']);

  const opened = openSqlite(path.join(projectA.project, '.trace', 'state', 'trace.sqlite'), {readOnly: true});
  try {
    const snapshots = opened.db.prepare('SELECT COUNT(*) AS count FROM data_records').get();
    assert.equal(Number(snapshots.count), 0, 'automatic activation must not write source snapshots');
    const durableRows = opened.db.prepare('SELECT payload FROM continuity_records').all();
    const durable = JSON.stringify(durableRows);
    for (const prompt of rawPrompts) assert.equal(durable.includes(prompt), false, 'transient prompts must not be durable state');
    assert.equal(durable.includes(sourceRoot), false, 'absolute source roots must not be durable state');
    assert.equal(durable.includes('Private finance budget forecast'), false, 'excluded page content must not be durable state');
    assert.equal(durable.includes('wiki/context-boundary.md'), true, 'safe relative locator must remain auditable');
  } finally {
    opened.db.close();
  }
});
