import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {openSqlite} from '../dist/packages/core/storage/src/index.js';

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

function createExternalProject(rootDir, id, key, body) {
  const project = path.join(rootDir, `project-${id}`);
  const sourceRoot = path.join(rootDir, `source-${id}`);
  const page = path.join(sourceRoot, 'wiki', `${id}.md`);
  const profile = path.join(rootDir, `profile-${id}.json`);
  fs.mkdirSync(path.join(project, 'nested'), {recursive: true});
  fs.mkdirSync(path.dirname(page), {recursive: true});
  fs.writeFileSync(page, `---\ntitle: ${id} 专属协作页\n---\n\n${key}\n${body}\n`, 'utf8');
  fs.writeFileSync(profile, JSON.stringify({source_id: `source-${id}`, root: sourceRoot, formal_prefix: 'wiki', user_id: `user-${id}`, read_enabled: true, write_enabled: false}), 'utf8');
  runJson(['init', '--project-dir', project, '--source', 'external', '--source-profile', profile, '--json']);
  return {project, sourceRoot, page};
}

function invokeGlobalHook(cwd, sessionId, prompt) {
  const result = run(['internal', 'codex', 'hook-stdio', '--route-from-event-cwd'], {
    input: JSON.stringify({hook_event_name: 'UserPromptSubmit', cwd, session_id: sessionId, prompt}),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function visibleHookOutput(output) {
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  return JSON.parse(output.hookSpecificOutput.additionalContext);
}

test('a single user-level Codex hook routes by event cwd, auto-loads each project profile, and retains only safe pointer audit data', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-codex-routing-'));
  const hooks = path.join(sandbox, 'global-hooks.json');
  const rawPrompt = 'RAW_PROMPT_MUST_NEVER_REACH_DURABLE_TRACE';
  const a = createExternalProject(sandbox, 'alpha', 'ALPHA_ONLY_ROUTING_KEY', 'ALPHA_PRIVATE_SOURCE_BODY_MUST_NOT_BE_PERSISTED');
  const b = createExternalProject(sandbox, 'beta', 'BETA_ONLY_ROUTING_KEY', 'BETA_PRIVATE_SOURCE_BODY_MUST_NOT_BE_PERSISTED');

  const firstEnable = runJson(['codex', 'enable', '--project-dir', a.project, '--hooks-file', hooks, '--json']);
  const secondEnable = runJson(['codex', 'enable', '--project-dir', b.project, '--hooks-file', hooks, '--json']);
  assert.equal(firstEnable.routing, 'event_cwd');
  assert.equal(secondEnable.routing, 'event_cwd');
  const hooksRaw = fs.readFileSync(hooks, 'utf8');
  assert.match(hooksRaw, /--route-from-event-cwd/);
  assert.doesNotMatch(hooksRaw, new RegExp(a.project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(hooksRaw, new RegExp(b.project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(runJson(['codex', 'status', '--project-dir', a.project, '--hooks-file', hooks, '--json']).status, 'enabled');
  assert.equal(runJson(['codex', 'status', '--project-dir', b.project, '--hooks-file', hooks, '--json']).routing, 'event_cwd');

  const alpha = visibleHookOutput(invokeGlobalHook(path.join(a.project, 'nested'), 'alpha-session', `Investigate ALPHA_ONLY_ROUTING_KEY. ${rawPrompt}`));
  assert.equal(alpha.activation_mode, 'pointer_only');
  assert.equal(alpha.source_profile, 'source-alpha');
  assert.equal(alpha.source_status, 'available');
  assert.equal(alpha.read_pointers.length, 1);
  assert.equal(alpha.read_pointers[0].path, a.page);
  assert.equal(alpha.read_pointers[0].purpose, '读取正式认知源页面：alpha 专属协作页');
  assert.equal(alpha.pages_considered[0].path, 'wiki/alpha.md');
  assert.equal(alpha.activation_receipt.activated_refs.length, 0);
  assert.equal(alpha.activation_receipt.activated_pointers.length, 1);
  assert.equal(alpha.activation_receipt.activated_pointers[0].source_id, 'source-alpha');
  assert.equal(alpha.activation_receipt.activated_pointers[0].locator, 'wiki/alpha.md');
  assert.equal(JSON.stringify(alpha).includes(rawPrompt), false);
  assert.equal(JSON.stringify(alpha).includes('ALPHA_PRIVATE_SOURCE_BODY_MUST_NOT_BE_PERSISTED'), false);
  const alphaStatus = runJson(['status', '--project-dir', a.project, '--json']);
  assert.equal(alphaStatus.latest_activation.activated_pointers.length, 1);
  assert.equal(alphaStatus.latest_activation.activated_pointers[0].locator, 'wiki/alpha.md');
  assert.equal(JSON.stringify(alphaStatus.latest_activation).includes(rawPrompt), false);
  assert.equal(JSON.stringify(alphaStatus.latest_activation).includes(a.page), false);

  const beta = visibleHookOutput(invokeGlobalHook(path.join(b.project, 'nested'), 'beta-session', 'Investigate BETA_ONLY_ROUTING_KEY.'));
  assert.equal(beta.source_profile, 'source-beta');
  assert.equal(beta.read_pointers.length, 1);
  assert.equal(beta.read_pointers[0].path, b.page);
  assert.equal(beta.pages_considered[0].path, 'wiki/beta.md');
  assert.equal(JSON.stringify(beta).includes('ALPHA_ONLY_ROUTING_KEY'), false);

  const opened = openSqlite(path.join(a.project, '.trace', 'state', 'trace.sqlite'), {readOnly: true});
  try {
    const receipts = opened.db.prepare('SELECT payload FROM continuity_records').all();
    const receipt = receipts.map(row => JSON.parse(row.payload)).find(item => item.kind === 'activation_receipt');
    assert.ok(receipt, 'the activation receipt is durable');
    const durable = JSON.stringify(receipt);
    assert.equal(durable.includes(rawPrompt), false);
    assert.equal(durable.includes('ALPHA_PRIVATE_SOURCE_BODY_MUST_NOT_BE_PERSISTED'), false);
    assert.equal(durable.includes(a.page), false, 'absolute host source paths must not become durable data');
    assert.equal(durable.includes('wiki/alpha.md'), true, 'safe relative pointer locator is durable audit data');
    const snapshots = opened.db.prepare('SELECT COUNT(*) AS count FROM data_records').get();
    assert.equal(Number(snapshots.count), 0, 'pointer-only activation must not create a source snapshot');
  } finally { opened.db.close(); }

  const unrelated = path.join(sandbox, 'unmanaged-project');
  fs.mkdirSync(unrelated);
  const noOp = invokeGlobalHook(unrelated, 'unmanaged-session', 'BETA_ONLY_ROUTING_KEY');
  assert.deepEqual(noOp, {});
  assert.equal(fs.existsSync(path.join(unrelated, '.trace')), false);
});
