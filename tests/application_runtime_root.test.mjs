import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {proposeProjectInitialize} from '../dist/packages/product/application/src/index.js';

test('product initialization locates a packaged runtime identified by runtime.json', () => {
  const packageRoot = path.resolve(process.cwd());
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-runtime-bundle-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-project-'));
  const previousRoot = process.env.TRACE_RUNTIME_ROOT;
  try {
    fs.mkdirSync(path.join(runtimeRoot, 'templates', 'codex-starter'), {recursive: true});
    fs.copyFileSync(
      path.join(packageRoot, 'templates', 'codex-starter', 'manifest.json'),
      path.join(runtimeRoot, 'templates', 'codex-starter', 'manifest.json'),
    );
    fs.writeFileSync(path.join(runtimeRoot, 'runtime.json'), JSON.stringify({runtime_version: '0.0.0-test'}) + '\n');
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'package.json')), false, 'a packaged runtime need not ship a development package.json');

    process.env.TRACE_RUNTIME_ROOT = runtimeRoot;
    const proposal = proposeProjectInitialize({project_dir: project, template_id: 'trace.codex-starter', source_mode: 'local'});
    assert.equal(proposal.operation, 'project_initialize');
    assert.equal(proposal.summary.project_directory, project);
  } finally {
    if (previousRoot === undefined) delete process.env.TRACE_RUNTIME_ROOT;
    else process.env.TRACE_RUNTIME_ROOT = previousRoot;
    fs.rmSync(runtimeRoot, {recursive: true, force: true});
    fs.rmSync(project, {recursive: true, force: true});
  }
});

test('initialization proposal shows selected behavior and source map without writing or exposing the source root', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-project-'));
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-source-'));
  const sourceProfile = {
    source_id: 'selected-personal-source',
    root: sourceRoot,
    formal_prefix: 'wiki',
    read_enabled: true,
    write_enabled: false,
    user_id: 'test-user',
    host_retrieval: {mode: 'native_observed', allowed_prefixes: ['wiki'], max_reads_per_turn: 8},
    collaboration_model: {
      protocol_id: 'trace.collaboration-model',
      protocol_version: '0.1.0',
      model_id: 'test.personal-collaboration',
      version: '0.1.0',
      display_name: 'Selected personal collaboration',
      scope: 'personal',
      principles: ['Current intent comes first.'],
      open_discussion: ['Continue from the user’s present question.'],
      explicit_execution: ['Carry out explicit implementation requests.'],
      epistemic_practice: ['Separate observed evidence from inference.'],
      boundaries: ['Do not turn ordinary discussion into persistence.'],
    },
    activation_manifest: {
      protocol_id: 'trace.source-activation',
      protocol_version: '0.1.0',
      manifest_id: 'test.personal-source-map',
      version: '0.1.0',
      source_id: 'selected-personal-source',
      display_name: 'Selected source map',
      summary: 'Navigation is not evidence of reading.',
      activation_profiles: ['open_discussion'],
      entry_points: [{id: 'collaboration', label: 'Collaboration', kind: 'capability', purpose: 'Read when collaboration intent is relevant.', triggers: ['collaboration'], locator: 'wiki/collaboration.md'}],
    },
  };
  try {
    const proposal = proposeProjectInitialize({project_dir: project, template_id: 'trace.codex-starter', source_mode: 'external', source_profile: sourceProfile});
    assert.equal(proposal.summary.collaboration_model.display_name, 'Selected personal collaboration');
    assert.equal(proposal.summary.collaboration_model.open_discussion[0], 'Continue from the user’s present question.');
    assert.equal(proposal.summary.source_activation.entry_points[0].locator, 'wiki/collaboration.md');
    assert.ok(proposal.summary.will_create.includes('.trace/profiles/source.profile.json'));
    assert.equal(proposal.summary.will_create.includes('.trace/source/wiki'), false, 'external source mode must not create a misleading local source tree');
    assert.equal(JSON.stringify(proposal).includes(sourceRoot), false, 'the external root stays private');
    assert.equal(fs.existsSync(path.join(project, '.trace')), false, 'proposal is write-free');
  } finally {
    fs.rmSync(sourceRoot, {recursive: true, force: true});
    fs.rmSync(project, {recursive: true, force: true});
  }
});
