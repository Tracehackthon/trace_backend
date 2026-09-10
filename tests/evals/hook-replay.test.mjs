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

function run(args, options = {}) { return spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8', ...options}); }
function runJson(args, options = {}) { const result = run(args, options); assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout); }
function createProject(sandbox, id, sourceProfile) {
  const project = path.join(sandbox, `project-${id}`); const profileFile = path.join(sandbox, `profile-${id}.json`);
  fs.mkdirSync(path.join(project, 'nested'), {recursive: true}); fs.writeFileSync(profileFile, JSON.stringify(sourceProfile), 'utf8');
  runJson(['init', '--project-dir', project, '--source', 'external', '--source-profile', profileFile, '--json']);
  return {project, nested: path.join(project, 'nested')};
}
function replayHook(cwd, event) {
  const result = run(['internal', 'codex', 'hook-stdio', '--route-from-event-cwd'], {input: JSON.stringify({cwd, ...event})});
  assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout);
}
function activationContext(output) {
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  return JSON.parse(output.hookSpecificOutput.additionalContext.split('\n')[0]);
}
function evidenceRows(project) {
  const opened = openSqlite(path.join(project, '.trace', 'state', 'trace.sqlite'), {readOnly: true});
  try { return opened.db.prepare('SELECT payload FROM data_records').all().map(row => JSON.parse(row.payload)); } finally { opened.db.close(); }
}

test('the real Codex hook does not pre-retrieve: it records the host-native reads replayed by the evidence fixture and preserves the privacy boundary', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-hook-replay-'));
  const sourceRoot = path.join(sandbox, 'source-a'); materializeFixtureSource(sourceRoot);
  const projectA = createProject(sandbox, 'a', fixtureSourceProfile(sourceRoot, {host_retrieval: {mode: 'native_observed', allowed_prefixes: ['wiki'], max_reads_per_turn: 64}}));
  const cases = loadEvalCases();
  const rawPrompts = cases.map(caseDefinition => caseDefinition.prompt);

  const results = cases.map((caseDefinition, index) => {
    const sessionId = `eval-a-${index}`; const turnId = `turn-a-${index}`;
    const activation = activationContext(replayHook(projectA.nested, {hook_event_name: 'UserPromptSubmit', session_id: sessionId, turn_id: turnId, prompt: caseDefinition.prompt}));
    assert.equal(activation.activation_mode, 'host_native_evidence');
    assert.equal('pages_considered' in activation, false);
    assert.equal('read_pointers' in activation, false);
    // The fixture supplies the native read decisions as test evidence. It is
    // intentionally not a claim that Trace selected these pages or evaluated a model.
    for (const relative of caseDefinition.expected_pages ?? []) {
      const target = path.join(sourceRoot, ...relative.split('/'));
      const output = replayHook(projectA.nested, {
        hook_event_name: 'PostToolUse', session_id: sessionId, turn_id: turnId, tool_name: 'Bash', tool_use_id: `${sessionId}-${relative.replace(/[^a-z0-9]+/gi, '-')}`,
        tool_input: {command: `Get-Content -Raw "${target}"`}, tool_response: {output: 'fixture source content is not retained'},
      });
      assert.deepEqual(output, {});
    }
    const actual = evidenceRows(projectA.project)
      .filter(record => record.kind === 'host_retrieval_evidence' && record.payload.host_session_id === sessionId && record.payload.event_kind === 'source_read')
      .flatMap(record => record.payload.locators);
    return evaluateCase(caseDefinition, actual);
  });
  const metrics = aggregateEvaluation(results);
  assert.equal(metrics.failed_cases, 0, JSON.stringify({metrics, results}, null, 2));
  assert.equal(metrics.forbidden_read_rate, 0);

  const durableRows = evidenceRows(projectA.project);
  const durable = JSON.stringify(durableRows);
  for (const prompt of rawPrompts) assert.equal(durable.includes(prompt), false, 'transient prompts must not be durable state');
  assert.equal(durable.includes(sourceRoot), false, 'absolute source roots must not be durable state');
  assert.equal(durable.includes('Private finance budget forecast'), false, 'source body must not be durable state');
  assert.equal(durable.includes('wiki/context-boundary.md'), true, 'safe relative locator must remain auditable');
});
