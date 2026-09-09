export const PLUGIN_PROTOCOL_ID = 'trace.plugin' as const;
export const PLUGIN_PROTOCOL_VERSION = '0.1.0' as const;

export const PLUGIN_HOSTS = ['deepseek-harness', 'codex', 'desktop'] as const;
export type PluginHostKind = (typeof PLUGIN_HOSTS)[number];

export const PLUGIN_CAPABILITIES = [
  'source_adapter',
  'result_normalizer',
  'precedent_provider',
  'capability_provider',
  'runtime_observer',
  'desktop_surface',
] as const;
export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

export const PLUGIN_PERMISSIONS = ['read_data', 'write_data', 'observe_runtime', 'desktop_surface'] as const;
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export interface PluginSchemaRef {
  schema_id: string;
  schema_version: string;
}

export interface TracePluginDescriptor {
  plugin_id: string;
  plugin_version: string;
  protocol_id: typeof PLUGIN_PROTOCOL_ID;
  protocol_version: typeof PLUGIN_PROTOCOL_VERSION;
  hosts: PluginHostKind[];
  capabilities: PluginCapability[];
  permissions: PluginPermission[];
  schemas: PluginSchemaRef[];
  entrypoint: string;
}

export interface PluginRegistration {
  plugin_id: string;
  plugin_version: string;
  schema: PluginSchemaRef;
  kind: 'source_adapter' | 'result_normalizer' | 'runtime_observer';
}

export interface PluginHost {
  readonly host: PluginHostKind;
  readonly host_version: string;
  register(registration: PluginRegistration): void;
  emitRuntimeEvent(event: unknown): Promise<void>;
}

export interface TracePlugin {
  readonly descriptor: TracePluginDescriptor;
  activate(host: PluginHost): Promise<{deactivate(): Promise<void>} | void>;
}

export function validatePluginDescriptor(value: unknown): TracePluginDescriptor {
  const object = record(value, 'plugin descriptor');
  rejectUnknown(object, ['plugin_id', 'plugin_version', 'protocol_id', 'protocol_version', 'hosts', 'capabilities', 'permissions', 'schemas', 'entrypoint'], 'plugin descriptor');
  if (object.protocol_id !== PLUGIN_PROTOCOL_ID || object.protocol_version !== PLUGIN_PROTOCOL_VERSION) throw new ProtocolError('PROTOCOL_MISMATCH', 'Unsupported plugin protocol');
  if (!Array.isArray(object.hosts) || object.hosts.length === 0 || object.hosts.some(item => !PLUGIN_HOSTS.includes(item as PluginHostKind))) throw new ProtocolError('INVALID_FIELD', 'plugin hosts are invalid');
  if (!Array.isArray(object.capabilities) || object.capabilities.length === 0 || object.capabilities.some(item => !PLUGIN_CAPABILITIES.includes(item as PluginCapability))) throw new ProtocolError('INVALID_FIELD', 'plugin capabilities are invalid');
  if (!Array.isArray(object.permissions) || object.permissions.some(item => !PLUGIN_PERMISSIONS.includes(item as PluginPermission))) throw new ProtocolError('INVALID_FIELD', 'plugin permissions are invalid');
  if (!Array.isArray(object.schemas)) throw new ProtocolError('INVALID_FIELD', 'plugin schemas are required');
  const schemas = object.schemas.map((schema, index) => {
    const item = record(schema, `schemas[${index}]`);
    rejectUnknown(item, ['schema_id', 'schema_version'], `schemas[${index}]`);
    return {schema_id: text(item.schema_id, `schemas[${index}].schema_id`), schema_version: text(item.schema_version, `schemas[${index}].schema_version`, 64)};
  });
  return {
    plugin_id: text(object.plugin_id, 'plugin_id'),
    plugin_version: text(object.plugin_version, 'plugin_version', 64),
    protocol_id: PLUGIN_PROTOCOL_ID,
    protocol_version: PLUGIN_PROTOCOL_VERSION,
    hosts: [...new Set(object.hosts as PluginHostKind[])],
    capabilities: [...new Set(object.capabilities as PluginCapability[])],
    permissions: [...new Set(object.permissions as PluginPermission[])],
    schemas,
    entrypoint: text(object.entrypoint, 'entrypoint', 1000),
  };
}
import {ProtocolError, rejectUnknown, requireObject as record, requireText as text} from '../../../core/protocol/src/index.js';
