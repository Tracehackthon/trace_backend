import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePluginDescriptor, PLUGIN_PROTOCOL_ID, PLUGIN_PROTOCOL_VERSION} from '../dist/packages/plugin/contract/src/index.js';

test('host plugin contract is explicit and does not leak host behavior into core', () => {
  const descriptor = validatePluginDescriptor({
    plugin_id: 'trace.deepseek-harness.bridge',
    plugin_version: '0.1.0',
    protocol_id: PLUGIN_PROTOCOL_ID,
    protocol_version: PLUGIN_PROTOCOL_VERSION,
    hosts: ['deepseek-harness'],
    capabilities: ['runtime_observer', 'source_adapter'],
    permissions: ['read_data', 'observe_runtime'],
    schemas: [{schema_id: 'trace.data-envelope', schema_version: '0.1.0'}],
    entrypoint: 'packages/integration/deepseek-harness',
  });
  assert.deepEqual(descriptor.hosts, ['deepseek-harness']);
  assert.throws(() => validatePluginDescriptor({...descriptor, hosts: ['not-a-host']}), /hosts are invalid/);
  assert.throws(() => validatePluginDescriptor({...descriptor, protocol_version: '9.9.9'}), /Unsupported plugin protocol/);
});
