import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectSourceIdentity} from '../scripts/source-identity.mjs';
import {loadRuntimeIdentity, runtimeApiSurface} from '../apps/desktop/runtime-identity.mjs';

test('source identity distinguishes a dirty checkout from HEAD', () => {
  const identity = inspectSourceIdentity(path.resolve('.'));
  assert.match(identity.git_commit, /^[0-9a-f]{40}$/);
  assert.match(identity.git_tree, /^[0-9a-f]{40}$/);
  assert.match(identity.content_sha256, /^[0-9a-f]{64}$/);
  assert.equal(identity.clean, identity.worktree_state === 'clean');
  assert.equal(identity.dirty_path_count > 0, identity.worktree_state === 'dirty');
});

test('packaged runtime identity is safe for the desktop status API', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-runtime-identity-'));
  try {
    fs.mkdirSync(path.join(directory, 'apps', 'desktop'), {recursive: true});
    fs.writeFileSync(path.join(directory, 'runtime.json'), JSON.stringify({
      runtime_version: '0.7.1', distribution_eligibility: 'release-ready', source_identity: {
        git_commit: 'a'.repeat(40), git_tree: 'b'.repeat(40), worktree_state: 'clean', clean: true,
        content_sha256: 'c'.repeat(64), source_file_count: 10, dirty_path_count: 0, dirty_paths: ['private/path'],
      },
    }), 'utf8');
    const identity = loadRuntimeIdentity(path.join(directory, 'apps', 'desktop'));
    assert.equal(identity.runtime_version, '0.7.1');
    assert.equal(identity.distribution_eligibility, 'release-ready');
    assert.equal(identity.source_identity.clean, true);
    assert.equal('dirty_paths' in identity.source_identity, false, 'API must not expose path inventory');
    assert.ok(identity.api_surface.host.length >= 20);
    assert.ok(runtimeApiSurface().agent.includes('/api/agent/runs/:id/events'));
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});
