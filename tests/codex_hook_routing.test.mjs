import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
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
  fs.writeFileSync(profile, JSON.stringify({
    source_id: `source-${id}`, root: sourceRoot, formal_prefix: 'wiki', user_id: `user-${id}`,
    read_enabled: true, write_enabled: false,
    host_retrieval: {mode: 'native_observed', allowed_prefixes: ['wiki'], max_reads_per_turn: 1},
  }), 'utf8');
  runJson(['init', '--project-dir', project, '--source', 'external', '--source-profile', profile, '--json']);
  return {project, sourceRoot, page};
}

function invokeGlobalHook(cwd, event) {
  const result = run(['internal', 'codex', 'hook-stdio', '--route-from-event-cwd'], {
    input: JSON.stringify({cwd, ...event}),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function visibleHookOutput(output, eventName = 'UserPromptSubmit') {
  assert.equal(output.hookSpecificOutput.hookEventName, eventName);
  // The first line is intentionally machine-readable host state. Later lines
  // are bounded developer context and must never be parsed as durable data.
  return JSON.parse(output.hookSpecificOutput.additionalContext.split('\n')[0]);
}

function records(database) {
  const opened = openSqlite(database, {readOnly: true});
  try {
    return opened.db.prepare('SELECT payload FROM data_records').all().map(row => JSON.parse(row.payload));
  } finally { opened.db.close(); }
}

test('a single user-level Codex hook routes by event cwd, delegates retrieval to native Codex tools, and records only actual source-use evidence', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-codex-routing-'));
  const hooks = path.join(sandbox, 'global-hooks.json');
  const rawPrompt = 'RAW_PROMPT_MUST_NEVER_REACH_DURABLE_TRACE';
  const rawToolOutput = 'TOOL_OUTPUT_AND_SOURCE_BODY_MUST_NEVER_REACH_DURABLE_TRACE';
  const a = createExternalProject(sandbox, 'alpha', 'ALPHA_ONLY_ROUTING_KEY', rawToolOutput);
  const b = createExternalProject(sandbox, 'beta', 'BETA_ONLY_ROUTING_KEY', 'BETA_PRIVATE_SOURCE_BODY_MUST_NOT_BE_PERSISTED');

  const firstEnable = runJson(['codex', 'enable', '--project-dir', a.project, '--hooks-file', hooks, '--json']);
  const secondEnable = runJson(['codex', 'enable', '--project-dir', b.project, '--hooks-file', hooks, '--json']);
  assert.equal(firstEnable.routing, 'event_cwd');
  assert.equal(firstEnable.receipt.managed_events.includes('PreToolUse'), true);
  assert.equal(firstEnable.receipt.managed_events.includes('PostToolUse'), true);
  assert.equal(secondEnable.routing, 'event_cwd');
  const hooksRaw = fs.readFileSync(hooks, 'utf8');
  assert.match(hooksRaw, /--route-from-event-cwd/);
  assert.match(hooksRaw, /"PreToolUse"/);
  assert.match(hooksRaw, /"PostToolUse"/);
  assert.doesNotMatch(hooksRaw, new RegExp(a.project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(hooksRaw, new RegExp(b.project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(runJson(['codex', 'status', '--project-dir', a.project, '--hooks-file', hooks, '--json']).status, 'enabled');

  const alphaOutput = invokeGlobalHook(path.join(a.project, 'nested'), {
    hook_event_name: 'UserPromptSubmit', cwd: path.join(a.project, 'nested'), session_id: 'alpha-session', turn_id: 'alpha-turn', prompt: `Investigate ALPHA_ONLY_ROUTING_KEY. ${rawPrompt}`,
  });
  const alpha = visibleHookOutput(alphaOutput);
  assert.equal(alpha.activation_mode, 'host_native_evidence');
  assert.equal(alpha.source_profile, 'source-alpha');
  assert.equal(alpha.source_status, 'available');
  assert.equal(alpha.source_access.mode, 'native_observed');
  assert.deepEqual(alpha.source_access.allowed_roots, [path.join(a.sourceRoot, 'wiki')]);
  assert.equal(alpha.source_access.max_reads_per_turn, 1);
  assert.equal('pages_considered' in alpha, false, 'Trace must not preselect pages with its lexical provider');
  assert.equal('read_pointers' in alpha, false, 'Trace must not send an old pointer list to the host');
  assert.equal(alpha.collaboration_context.model.model_id, 'trace.cognitive-collaboration-starter');
  assert.equal(alpha.collaboration_context.source_activation.manifest_id, 'trace.user-selected-source-map');
  assert.equal(alpha.collaboration_context.source_activation.entry_point_count, 0);
  assert.match(alphaOutput.hookSpecificOutput.additionalContext, /Trace collaboration context \(versioned, user-visible\):/);
  assert.match(alphaOutput.hookSpecificOutput.additionalContext, /Treat an incomplete user expression as thinking in progress/);
  assert.equal(JSON.stringify(alpha).includes(rawPrompt), false);
  assert.equal(JSON.stringify(alpha).includes(rawToolOutput), false);
  assert.equal(alphaOutput.hookSpecificOutput.additionalContext.includes(rawPrompt), false);
  assert.equal(alphaOutput.hookSpecificOutput.additionalContext.includes(rawToolOutput), false);

  // A page budget counts concrete Markdown locators, not just tool events:
  // a batched native command cannot read two pages under this one-page lease.
  const alphaSecondPage = path.join(a.sourceRoot, 'wiki', 'alpha-second.md');
  fs.writeFileSync(alphaSecondPage, '---\ntitle: alpha second\n---\n\nSECOND_PAGE\n', 'utf8');
  const multiPageDenied = invokeGlobalHook(path.join(a.project, 'nested'), {
    hook_event_name: 'PreToolUse', cwd: path.join(a.project, 'nested'), session_id: 'alpha-session', turn_id: 'alpha-turn',
    tool_name: 'Bash', tool_use_id: 'tool-alpha-multi-read', tool_input: {command: `Get-Content -Raw "${a.page}", "${alphaSecondPage}"`},
  });
  assert.equal(multiPageDenied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(multiPageDenied.hookSpecificOutput.permissionDecisionReason, /2-page read/);

  // This is the real host-side retrieval step: Codex executes its native tool.
  // Trace only observes the event after it ran, storing safe provenance.
  const readOutput = invokeGlobalHook(path.join(a.project, 'nested'), {
    hook_event_name: 'PostToolUse', cwd: path.join(a.project, 'nested'), session_id: 'alpha-session', turn_id: 'alpha-turn',
    tool_name: 'Bash', tool_use_id: 'tool-alpha-read',
    tool_input: {command: `Get-Content -Raw "${a.page}"`},
    tool_response: {output: rawToolOutput},
  });
  assert.deepEqual(readOutput, {}, 'PostToolUse must not replace native tool output or add source body to context');

  // The configured per-turn source-read budget is enforceable before the next
  // recognised native read. Unknown local paths are deliberately not treated as
  // an access-control boundary.
  const denied = invokeGlobalHook(path.join(a.project, 'nested'), {
    hook_event_name: 'PreToolUse', cwd: path.join(a.project, 'nested'), session_id: 'alpha-session', turn_id: 'alpha-turn',
    tool_name: 'Bash', tool_use_id: 'tool-alpha-second-read', tool_input: {command: `Get-Content -Raw "${a.page}"`},
  });
  assert.equal(denied.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');

  // A native search in project B is recorded as search, not falsely reported as
  // a page read. Cwd routing keeps its source entirely separate from project A.
  const beta = visibleHookOutput(invokeGlobalHook(path.join(b.project, 'nested'), {
    hook_event_name: 'UserPromptSubmit', cwd: path.join(b.project, 'nested'), session_id: 'beta-session', turn_id: 'beta-turn', prompt: 'Find a relevant collaboration note.',
  }));
  assert.equal(beta.source_profile, 'source-beta');
  assert.deepEqual(beta.source_access.allowed_roots, [path.join(b.sourceRoot, 'wiki')]);
  const searched = invokeGlobalHook(path.join(b.project, 'nested'), {
    hook_event_name: 'PostToolUse', cwd: path.join(b.project, 'nested'), session_id: 'beta-session', turn_id: 'beta-turn',
    tool_name: 'Bash', tool_use_id: 'tool-beta-search', tool_input: {command: `rg "BETA_ONLY_ROUTING_KEY" "${path.join(b.sourceRoot, 'wiki')}"`}, tool_response: {output: 'wiki/beta.md'},
  });
  assert.deepEqual(searched, {});

  const alphaDatabase = path.join(a.project, '.trace', 'state', 'trace.sqlite');
  const alphaEvidence = records(alphaDatabase).filter(record => record.kind === 'host_retrieval_evidence');
  assert.equal(alphaEvidence.filter(record => record.payload.event_kind === 'source_access_offered').length, 1);
  const read = alphaEvidence.find(record => record.payload.event_kind === 'source_read');
  assert.ok(read, 'actual native read must be durable evidence');
  assert.deepEqual(read.payload.locators, ['wiki/alpha.md']);
  assert.equal(read.payload.page_versions[0].locator, 'wiki/alpha.md');
  assert.match(read.payload.page_versions[0].content_hash, /^[a-f0-9]{64}$/);
  assert.match(read.payload.input_hash, /^[a-f0-9]{64}$/);
  assert.match(read.payload.output_hash, /^[a-f0-9]{64}$/);
  const alphaDurable = JSON.stringify(records(alphaDatabase));
  assert.equal(alphaDurable.includes(rawPrompt), false);
  assert.equal(alphaDurable.includes(rawToolOutput), false);
  assert.equal(alphaDurable.includes(a.page), false, 'absolute source paths must not become durable state');
  assert.equal(alphaDurable.includes('wiki/alpha.md'), true, 'safe relative locator is the durable audit identity');

  const sourceView = runJson(['sources', '--project-dir', a.project, '--json']);
  assert.equal(sourceView.host_source_usage.read, 1);
  assert.equal(sourceView.host_source_usage.searched, 0);
  assert.equal(sourceView.host_source_usage.recent.some(item => item.locators.includes('wiki/alpha.md')), true);
  assert.equal(JSON.stringify(sourceView).includes(rawToolOutput), false);
  assert.equal(JSON.stringify(sourceView).includes(a.page), false);

  const betaEvidence = records(path.join(b.project, '.trace', 'state', 'trace.sqlite')).filter(record => record.kind === 'host_retrieval_evidence');
  assert.equal(betaEvidence.some(record => record.payload.event_kind === 'source_search'), true);
  assert.equal(JSON.stringify(betaEvidence).includes('ALPHA_ONLY_ROUTING_KEY'), false);

  const unrelated = path.join(sandbox, 'unmanaged-project');
  fs.mkdirSync(unrelated);
  const noOp = invokeGlobalHook(unrelated, {hook_event_name: 'UserPromptSubmit', cwd: unrelated, session_id: 'unmanaged-session', prompt: 'BETA_ONLY_ROUTING_KEY'});
  assert.deepEqual(noOp, {});
  assert.equal(fs.existsSync(path.join(unrelated, '.trace')), false);
});

test('a profile edit cannot expand a cwd-routed source lease until an explicit source update refreshes its lock', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-codex-source-drift-'));
  const project = createExternalProject(sandbox, 'drift', 'DRIFT_ORIGINAL', 'original body');
  const profileFile = path.join(project.project, '.trace', 'profiles', 'source.profile.json');
  const changedRoot = path.join(sandbox, 'source-drift-replacement'); fs.mkdirSync(path.join(changedRoot, 'wiki'), {recursive: true});
  const changed = JSON.parse(fs.readFileSync(profileFile, 'utf8')); changed.root = changedRoot;
  fs.writeFileSync(profileFile, JSON.stringify(changed, null, 2) + '\n', 'utf8');

  const failed = run(['internal', 'codex', 'hook-stdio', '--route-from-event-cwd'], {
    input: JSON.stringify({hook_event_name: 'UserPromptSubmit', cwd: project.project, session_id: 'drift-session', prompt: 'do not leak a new root'}),
  });
  assert.notEqual(failed.status, 0);
  const failure = `${failed.stdout}\n${failed.stderr}`;
  assert.match(failure, /SOURCE_PROFILE_LOCK_MISMATCH/);
  assert.equal(failure.includes(changedRoot), false, 'a failed lease must not disclose the changed absolute root');

  const proposedProfile = path.join(sandbox, 'approved-source-profile.json');
  fs.writeFileSync(proposedProfile, JSON.stringify(changed, null, 2) + '\n', 'utf8');
  const updated = runJson(['source', 'update', '--project-dir', project.project, '--file', proposedProfile, '--confirm', 'true', '--json']);
  assert.equal(updated.status, 'updated');
  assert.match(updated.source.profile_hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(updated).includes(changedRoot), false, 'the source update receipt returns hashes, never an absolute root');

  const output = invokeGlobalHook(project.project, {hook_event_name: 'UserPromptSubmit', cwd: project.project, session_id: 'drift-session', prompt: 'now use the approved source'});
  const visible = visibleHookOutput(output);
  assert.deepEqual(visible.source_access.allowed_roots, [path.join(changedRoot, 'wiki')]);
});

test('descriptor-owned local and empty sources cannot be converted into external leases through source update or a forged matching lock', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-codex-owned-source-'));
  const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
  try {
    for (const mode of ['local', 'empty']) {
      const project = path.join(sandbox, `project-${mode}`);
      const outside = path.join(sandbox, `outside-${mode}`);
      fs.mkdirSync(project, {recursive: true});
      fs.mkdirSync(path.join(outside, 'wiki'), {recursive: true});
      runJson(['init', '--project-dir', project, '--source', mode, '--json']);

      if (mode === 'empty') {
        const initial = visibleHookOutput(invokeGlobalHook(project, {hook_event_name: 'UserPromptSubmit', cwd: project, session_id: 'empty-session', prompt: 'do not offer a source lease'}));
        assert.equal(initial.source_status, 'disabled');
        assert.equal('source_access' in initial, false);
      }

      const profileFile = path.join(project, '.trace', 'profiles', 'source.profile.json');
      const proposed = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
      proposed.root = outside;
      proposed.read_enabled = true;
      proposed.host_retrieval = {mode: 'native_observed', allowed_prefixes: ['wiki'], max_reads_per_turn: 8};
      const proposalFile = path.join(sandbox, `${mode}-outside-profile.json`);
      fs.writeFileSync(proposalFile, JSON.stringify(proposed, null, 2) + '\n', 'utf8');

      const rejectedUpdate = run(['source', 'update', '--project-dir', project, '--file', proposalFile, '--confirm', 'true', '--json']);
      assert.notEqual(rejectedUpdate.status, 0, `${mode}: project-owned sources cannot use source update`);
      assert.match(`${rejectedUpdate.stdout}\n${rejectedUpdate.stderr}`, /SOURCE_SELECTION_MIGRATION_REQUIRED/);

      // Even if an untrusted project edits both profile and selected-source hash,
      // the immutable descriptor semantics still refuse a host lease.
      const forgedProfile = fs.readFileSync(proposalFile, 'utf8');
      fs.writeFileSync(profileFile, forgedProfile, 'utf8');
      const lockFile = path.join(project, '.trace', 'instance', 'trace.lock.json');
      const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      lock.selected_source.profile_hash = hash(forgedProfile);
      fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n', 'utf8');
      const forgedLease = run(['internal', 'codex', 'hook-stdio', '--route-from-event-cwd'], {
        input: JSON.stringify({hook_event_name: 'UserPromptSubmit', cwd: project, session_id: `${mode}-forged-session`, prompt: 'do not disclose an outside source root'}),
      });
      assert.notEqual(forgedLease.status, 0, `${mode}: forged lock must not issue a source lease`);
      const failure = `${forgedLease.stdout}\n${forgedLease.stderr}`;
      assert.match(failure, /SOURCE_DESCRIPTOR_INVARIANT/);
      assert.equal(failure.includes(outside), false, `${mode}: failed lease must not disclose the forged root`);
    }
  } finally { fs.rmSync(sandbox, {recursive: true, force: true}); }
});
