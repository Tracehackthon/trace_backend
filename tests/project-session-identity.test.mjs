import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {resolveProjectBinding} from '../packages/product/workspace/src/host-ingest.mjs';
import {createProductWorkspace} from '../packages/product/workspace/src/workspace.mjs';
import {TraceRuntime} from '../dist/packages/core/runtime/src/index.js';
import {buildCodexHookOutput} from '../dist/apps/codex/src/index.js';

const cli = path.resolve('dist/apps/cli/src/main.js');

function git(directory, ...args) {
  return execFileSync('git', ['-C', directory, ...args], {encoding: 'utf8'}).trim();
}

function projectFixture(parent, name) {
  const directory = path.join(parent, name);
  fs.mkdirSync(path.join(directory, '.trace'), {recursive: true});
  fs.writeFileSync(path.join(directory, '.trace', 'project.json'), JSON.stringify({
    protocol_id: 'trace.project-instance', protocol_version: '0.2.0', project_id: name,
    instance_id: `instance-${name}`, template_id: 'trace.codex-starter', template_version: '0.1.0',
    source_mode: 'local', source_scope: 'project', state_file: '.trace/state/trace.sqlite',
    source_root: '.trace/source', created_at: new Date().toISOString(),
  }), 'utf8');
  git(directory, 'init', '-b', 'main');
  git(directory, 'config', 'user.email', 'trace@example.invalid');
  git(directory, 'config', 'user.name', 'Trace Fixture');
  fs.writeFileSync(path.join(directory, 'README.md'), 'fixture\n', 'utf8');
  git(directory, 'add', '.');
  git(directory, 'commit', '-m', 'fixture');
  return directory;
}

test('ProjectBindingResolver requires descriptor and repository evidence and rejects cwd drift', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-project-binding-'));
  try {
    const left = projectFixture(path.join(sandbox, 'left-root'), 'same-name');
    const right = projectFixture(path.join(sandbox, 'right-root'), 'same-name');
    const resolved = resolveProjectBinding({project_ref: left, cwd: left});
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.project_ref, path.resolve(left));
    assert.equal(resolved.project_id, 'same-name');
    assert.equal(resolved.repository.status, 'verified');
    assert.equal(resolveProjectBinding({cwd: left}).status, 'resolved');

    const wrongCwd = resolveProjectBinding({project_ref: left, cwd: right});
    assert.equal(wrongCwd.status, 'conflict');
    assert.ok(wrongCwd.diagnostics.some(item => item.code === 'PROJECT_REF_CWD_MISMATCH'));
    const worktree = path.join(sandbox, 'worktrees', 'same-name');
    fs.mkdirSync(path.dirname(worktree), {recursive: true});
    git(left, 'worktree', 'add', '--detach', worktree, 'HEAD');
    try {
      const worktreeBinding = resolveProjectBinding({project_ref: left, cwd: worktree});
      assert.equal(worktreeBinding.status, 'conflict');
      assert.ok(worktreeBinding.diagnostics.some(item => item.code === 'PROJECT_REF_CWD_MISMATCH'));
    } finally { git(left, 'worktree', 'remove', '--force', worktree); }
    const nestedRepo = path.join(left, 'nested-repo');
    fs.mkdirSync(nestedRepo, {recursive: true});
    git(nestedRepo, 'init', '-b', 'main');
    git(nestedRepo, 'config', 'user.email', 'trace@example.invalid');
    git(nestedRepo, 'config', 'user.name', 'Trace Fixture');
    fs.writeFileSync(path.join(nestedRepo, 'README.md'), 'nested fixture\n', 'utf8');
    git(nestedRepo, 'add', '.');
    git(nestedRepo, 'commit', '-m', 'nested fixture');
    const nestedBinding = resolveProjectBinding({project_ref: left, cwd: nestedRepo});
    assert.equal(nestedBinding.status, 'conflict');
    assert.ok(nestedBinding.diagnostics.some(item => ['PROJECT_GIT_ROOT_MISMATCH', 'PROJECT_REPOSITORY_MISMATCH'].includes(item.code)));
    assert.equal(resolveProjectBinding({project_ref: path.join(sandbox, 'missing')}).status, 'unresolved');
    assert.equal(resolveProjectBinding({project_ref: left, cwd: sandbox}).status, 'conflict');
  } finally { fs.rmSync(sandbox, {recursive: true, force: true}); }
});

test('Host attach validates project identity, retains personal sessions, and blocks an already-bound cwd drift', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-host-binding-'));
  const store = createProductWorkspace({file: path.join(sandbox, 'web.sqlite')});
  try {
    const left = projectFixture(sandbox, 'project-left');
    const right = projectFixture(sandbox, 'project-right');
    assert.throws(() => store.hostSessions.attach({host: 'codex', sessionId: 'bad', commandId: 'bad', projectRef: path.join(sandbox, 'missing')}), error => error.code === 'HOST_PROJECT_BINDING_UNRESOLVED');

    const personal = store.hostSessions.attach({host: 'codex', sessionId: 'personal', commandId: 'personal', cwd: left});
    assert.equal(personal.session.project_ref, null);
    const personalEvent = store.hostSessions.ingestEvent({host: 'codex', session_id: 'personal', turn_id: 'personal-turn', hook_event_name: 'UserPromptSubmit', cwd: right, prompt: 'personal capture'});
    assert.equal(personalEvent.status, 'captured');
    assert.equal(personalEvent.project_binding.status, 'personal');

    const attached = store.hostSessions.attach({host: 'codex', sessionId: 'bound', commandId: 'bound', projectRef: left, cwd: left});
    assert.equal(attached.project_binding.status, 'resolved');
    const drift = store.hostSessions.ingestEvent({host: 'codex', session_id: 'bound', turn_id: 'drift-turn', hook_event_name: 'UserPromptSubmit', cwd: right, prompt: 'must not capture'});
    assert.equal(drift.status, 'ignored');
    assert.equal(drift.reason, 'project_binding_conflict');
    assert.equal(drift.project_binding.status, 'conflict');
    assert.equal(store.hostSessions.listTurns({session_id: 'bound'}).length, 0);
    const missingCwd = store.hostSessions.ingestEvent({host: 'codex', session_id: 'bound', turn_id: 'missing-cwd-turn', hook_event_name: 'UserPromptSubmit', prompt: 'must not capture without cwd'});
    assert.equal(missingCwd.status, 'ignored');
    assert.equal(missingCwd.reason, 'project_binding_unresolved');
    assert.equal(missingCwd.project_binding.diagnostics[0].code, 'PROJECT_CWD_REQUIRED');
    assert.equal(store.hostSessions.listTurns({session_id: 'bound'}).length, 0);

    const recovered = store.hostSessions.ingestEvent({host: 'codex', session_id: 'bound', turn_id: 'bound-turn', hook_event_name: 'UserPromptSubmit', cwd: left, prompt: 'capture after returning'});
    assert.equal(recovered.status, 'captured');
    assert.equal(store.hostSessions.listTurns({session_id: 'bound'}).length, 1);
    assert.throws(() => store.hostSessions.captureWorkflowFinding({host: 'codex', session_id: 'bound', turn_id: 'bound-turn', command_id: 'drift-finding', cwd: right, observation: 'must not be captured'}), error => error.code === 'HOST_PROJECT_BINDING_CONFLICT');
    assert.equal(store.hostSessions.listWorkflowFindings({session_id: 'bound'}).length, 0);
  } finally { store.close(); fs.rmSync(sandbox, {recursive: true, force: true}); }
});

test('Codex hook missing session_id fails closed without a durable fallback identity', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-hook-identity-'));
  const state = path.join(sandbox, 'trace.sqlite');
  const runtime = new TraceRuntime({sqliteStateFile: state});
  try {
    const output = buildCodexHookOutput({hook_event_name: 'UserPromptSubmit', cwd: sandbox, prompt: 'private prompt'}, runtime, {});
    const visible = JSON.parse(output.hookSpecificOutput.additionalContext);
    assert.equal(visible.status, 'unresolved');
    assert.equal(visible.reason, 'missing_session_id');
    assert.equal(visible.durable_identity, 'session_id_required');
    assert.equal(JSON.stringify(output).includes('codex-hook-'), false);
    assert.equal(runtime.listContinuity().length, 0);
  } finally { runtime.close(); fs.rmSync(sandbox, {recursive: true, force: true}); }
});

test('Codex hook does not activate or persist when Host Ingest reports project drift', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-hook-drift-'));
  const state = path.join(sandbox, 'trace.sqlite');
  const runtime = new TraceRuntime({sqliteStateFile: state});
  try {
    const output = buildCodexHookOutput({hook_event_name: 'UserPromptSubmit', session_id: 'bound', cwd: sandbox, prompt: 'must not activate'}, runtime, {}, {
      ingestEvent() { return {status: 'ignored', reason: 'project_binding_conflict', project_binding: {status: 'conflict', diagnostics: [{code: 'PROJECT_REF_CWD_MISMATCH'}]}}; },
    });
    const visible = JSON.parse(output.hookSpecificOutput.additionalContext);
    assert.equal(visible.status, 'conflict');
    assert.equal(visible.reason, 'project_binding_conflict');
    assert.equal(runtime.listContinuity().length, 0);
  } finally { runtime.close(); fs.rmSync(sandbox, {recursive: true, force: true}); }
});

test('CLI keeps personal Host Ingest working from a directory with no Trace project via TRACE_WEB_STATE_FILE', () => {
  const sandbox = fs.mkdtempSync(path.join('D:\\', 'trace-personal-hook-'));
  const web = path.join(sandbox, 'web.sqlite');
  const store = createProductWorkspace({file: web});
  try {
    store.hostSessions.attach({host: 'codex', session_id: 'personal-cli', command_id: 'personal-cli-attach', project_ref: null});
  } finally { store.close(); }
  try {
    assert.equal(fs.existsSync(path.join(sandbox, '.trace')), false);
    const result = spawnSync(process.execPath, [cli, 'internal', 'codex', 'hook-stdio', '--route-from-event-cwd'], {
      cwd: sandbox,
      input: JSON.stringify({hook_event_name: 'UserPromptSubmit', session_id: 'personal-cli', turn_id: 'personal-cli-turn', cwd: sandbox, prompt: 'personal host capture'}),
      encoding: 'utf8',
      env: {...process.env, TRACE_WEB_STATE_FILE: web},
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '{}');
    const reopened = createProductWorkspace({file: web});
    try { assert.equal(reopened.hostSessions.listTurns({session_id: 'personal-cli'}).length, 1); }
    finally { reopened.close(); }
  } finally { fs.rmSync(sandbox, {recursive: true, force: true}); }
});
