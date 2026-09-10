import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDataEnvelope, envelopeHash, payloadHash, validateDataEnvelope} from '../dist/packages/core/data/src/index.js';
import {buildActivationPack, validateActivationPack} from '../dist/packages/core/context/src/index.js';
import {ChangeSetService} from '../dist/packages/core/change-set/src/index.js';
import {AppendOnlyStore} from '../dist/packages/core/storage/src/index.js';
import {validateTemplateManifest} from '../dist/packages/template/contract/src/index.js';
import {validatePluginDescriptor} from '../dist/packages/plugin/contract/src/index.js';
import {validateProjectInstanceDescriptor} from '../dist/packages/core/instance/src/index.js';

const origin = {provider: 'test', source_id: 'legacy-source', captured_at: '2026-09-09T00:00:00.000Z', content_hash: 'a'.repeat(64)};
const producer = {component: 'test', version: '1.0.0', run_id: 'run-legacy'};
const lineage = {parent_refs: [], source_refs: [], correlation_id: 'corr-legacy', causation_id: 'cause-legacy'};

test('Data envelope validates historical integrity before an in-memory v0.1 to v0.2 to v0.3 upcast', () => {
  const current = buildDataEnvelope({kind: 'source_snapshot', schema_id: 'test.source', schema_version: '0.1.0', subject: {type: 'source', id: 'legacy-source'}, scope: {type: 'personal', id: 'user'}, origin, producer, lineage, classification: 'private', payload: {source_id: 'legacy-source', provider: 'test', external_id: 'legacy-source', title: 'Legacy source', content: 'content', captured_at: origin.captured_at, content_hash: origin.content_hash}});
  const legacy = structuredClone(current);
  legacy.protocol_version = '0.1.0';
  legacy.integrity = {algorithm: 'sha256', payload_hash: payloadHash(legacy.payload), envelope_hash: envelopeHash({...legacy, integrity: undefined})};
  const upgraded = validateDataEnvelope(legacy);
  assert.equal(upgraded.protocol_version, '0.3.0');
  assert.equal(upgraded.integrity.envelope_hash, envelopeHash({...upgraded, integrity: undefined}));
  assert.throws(() => validateDataEnvelope({...legacy, protocol_version: '9.9.9'}), error => error?.code === 'PROTOCOL_MIGRATION_REQUIRED');
});

test('Change Set, context, template and plugin contracts use explicit v0.1 to v0.2 paths', () => {
  const store = new AppendOnlyStore(`${process.env.TEMP ?? process.cwd()}/trace-upcast-contract-test-${Date.now()}.jsonl`);
  const changes = new ChangeSetService(store);
  const created = changes.create({change_kind: 'runtime', subject: {type: 'legacy', id: 'change'}, base: {}, proposed: {}, impact: ['test'], compatibility: {backward_compatible: true, migration_required: false, impact_level: 'low'}, requested_by: 'user', scope: {type: 'personal', id: 'user'}, lineage: {input_refs: [], output_refs: [], parent_change_ids: [], correlation_id: 'corr', causation_id: 'cause'}}).record;
  assert.equal(changes.get(created.change_id).protocol_version, '0.2.0');
  const pack = buildActivationPack({purpose: 'legacy context', summary: 'pointer only', source_refs: []});
  assert.equal(validateActivationPack({...pack, protocol_version: '0.1.0'}).protocol_version, '0.2.0');
  const template = {protocol_id: 'trace.template-bundle', protocol_version: '0.1.0', bundle_id: 'legacy', bundle_version: '0.1.0', display_name: 'Legacy', runtime: {min_version: '0.1.0'}, protocols: {'trace.data-envelope': '>=0.1.0 <0.3.0'}, capabilities: [], source_packs: [], context_templates: [], hosts: ['codex'], activation: {default: 'preview', require_user_confirmation: true}, permissions: {read_scopes: [], write_scopes: [], network_providers: []}};
  assert.equal(validateTemplateManifest(template).protocol_version, '0.2.0');
  const plugin = {plugin_id: 'legacy', plugin_version: '0.1.0', protocol_id: 'trace.plugin', protocol_version: '0.1.0', hosts: ['codex'], capabilities: ['runtime_observer'], permissions: ['observe_runtime'], schemas: [], entrypoint: 'index.js'};
  assert.equal(validatePluginDescriptor(plugin).protocol_version, '0.2.0');
  const instance = {protocol_id: 'trace.project-instance', protocol_version: '0.1.0', project_id: 'legacy-project', instance_id: 'legacy-instance', template_id: 'legacy', template_version: '0.1.0', source_mode: 'local', source_scope: 'project', state_file: '.trace/state/trace.sqlite', source_root: '.trace/source', created_at: '2026-09-09T00:00:00.000Z'};
  assert.equal(validateProjectInstanceDescriptor(instance).protocol_version, '0.2.0');
});
