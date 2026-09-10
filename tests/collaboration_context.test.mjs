import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActivationLock,
  compileCollaborationContext,
  defaultCollaborationModel,
  defaultSourceActivationManifest,
  validateActivationLock,
  validateSourceActivationManifest,
} from '../dist/packages/core/collaboration-context/src/index.js';

test('cold-start collaboration context is explicit, bounded, and not a simulated personal history', () => {
  const model = defaultCollaborationModel('trace.codex-starter');
  const source = defaultSourceActivationManifest({source_id: 'project-cognitive-source', source_mode: 'local', template_id: 'trace.codex-starter'});
  const compiled = compileCollaborationContext({model, source, source_available: true});
  assert.equal(model.scope, 'starter');
  assert.equal(source.entry_points.length, 0);
  assert.match(compiled.developer_context, /incomplete user expression as thinking in progress/);
  assert.match(compiled.developer_context, /source map has no curated entry points yet/);
  assert.equal(compiled.developer_context.includes('PRIVATE_SOURCE_BODY_MUST_NOT_APPEAR'), false);
  assert.match(compiled.context_sha256, /^[a-f0-9]{64}$/);
  const lock = buildActivationLock({template_id: 'trace.codex-starter', model, source, created_at: '2026-09-10T00:00:00.000Z'});
  assert.deepEqual(validateActivationLock(lock), lock);
  assert.equal(JSON.stringify(lock).includes('PRIVATE_SOURCE_BODY_MUST_NOT_APPEAR'), false);
});

test('source activation manifests reject traversal, absolute locators, unknown fields, and duplicate entry IDs', () => {
  const base = {
    protocol_id: 'trace.source-activation', protocol_version: '0.1.0', manifest_id: 'test.map', version: '1.0.0', source_id: 'test-source', display_name: 'Test map', summary: 'A map.', activation_profiles: ['open-discussion'],
    entry_points: [{id: 'one', label: 'One', kind: 'knowledge', purpose: 'Test.', triggers: ['test'], locator: 'wiki/one.md'}],
  };
  assert.equal(validateSourceActivationManifest(base).entry_points[0].locator, 'wiki/one.md');
  assert.throws(() => validateSourceActivationManifest({...base, entry_points: [{...base.entry_points[0], locator: '../secret.md'}]}), /safe relative Markdown locator/);
  assert.throws(() => validateSourceActivationManifest({...base, entry_points: [{...base.entry_points[0], locator: '/secret.md'}]}), /safe relative Markdown locator/);
  assert.throws(() => validateSourceActivationManifest({...base, unexpected: true}), /unsupported fields/);
  assert.throws(() => validateSourceActivationManifest({...base, entry_points: [...base.entry_points, {...base.entry_points[0]}]}), /duplicate ids/);
});
