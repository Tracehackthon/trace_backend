import {createHash} from 'node:crypto';
import {ProtocolError} from '../../../core/protocol/src/index.js';

export const TEMPLATE_PROTOCOL_ID = 'trace.template-bundle' as const;
export const TEMPLATE_PROTOCOL_VERSION = '0.1.0' as const;

export interface TemplateRef {id: string; version: string; hash?: string;}

export interface TemplateBundleManifest {
  protocol_id: typeof TEMPLATE_PROTOCOL_ID;
  protocol_version: typeof TEMPLATE_PROTOCOL_VERSION;
  bundle_id: string;
  bundle_version: string;
  display_name: string;
  runtime: {min_version: string; max_version?: string};
  protocols: Record<string, string>;
  capabilities: TemplateRef[];
  source_packs: TemplateRef[];
  context_templates: TemplateRef[];
  hosts: string[];
  activation: {default: 'preview' | 'active'; require_user_confirmation: boolean};
  permissions: {read_scopes: string[]; write_scopes: string[]; network_providers: string[]};
  cognitive_source?: {
    mode: 'user-selected' | 'isolated-empty' | 'team-shared';
    connector: 'mywiki' | 'none' | 'custom';
    selection_required: boolean;
    allowed_scope_types: Array<'personal' | 'project' | 'team' | 'domain'>;
    semantic_defaults: 'none' | 'structure-only' | 'source-pack';
  };
}

export interface TemplateInstanceLock {
  instance_id: string;
  template: TemplateRef;
  installed_at: string;
  runtime_version: string;
  protocols: Record<string, string>;
  capabilities: Record<string, TemplateRef>;
  source_packs: Record<string, TemplateRef>;
  context_templates: Record<string, TemplateRef>;
  local_overrides: string[];
  disabled_items: string[];
  cognitive_source?: TemplateBundleManifest['cognitive_source'];
  selected_source?: {source_id: string; profile_hash: string; scope_type: 'personal' | 'project' | 'team' | 'domain'};
}

function text(value: unknown, field: string, max = 240): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) throw new ProtocolError('INVALID_FIELD', `${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProtocolError('INVALID_FIELD', `${field} must be an object`);
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length > 0) throw new ProtocolError('UNKNOWN_FIELD', `${field} contains unsupported fields: ${unknown.join(', ')}`);
}

function refs(value: unknown, field: string): TemplateRef[] {
  if (!Array.isArray(value) || value.length > 256) throw new ProtocolError('INVALID_FIELD', `${field} must contain at most 256 items`);
  return value.map((raw, index) => {
    const item = object(raw, `${field}[${index}]`);
    rejectUnknown(item, ['id', 'version', 'hash'], `${field}[${index}]`);
    return {id: text(item.id, `${field}[${index}].id`), version: text(item.version, `${field}[${index}].version`, 64), ...(item.hash === undefined ? {} : {hash: text(item.hash, `${field}[${index}].hash`, 128)})};
  });
}

export function validateTemplateManifest(value: unknown): TemplateBundleManifest {
  const item = object(value, 'template_manifest');
  rejectUnknown(item, ['protocol_id', 'protocol_version', 'bundle_id', 'bundle_version', 'display_name', 'runtime', 'protocols', 'capabilities', 'source_packs', 'context_templates', 'hosts', 'activation', 'permissions', 'cognitive_source'], 'template_manifest');
  if (item.protocol_id !== TEMPLATE_PROTOCOL_ID || item.protocol_version !== TEMPLATE_PROTOCOL_VERSION) throw new ProtocolError('PROTOCOL_MISMATCH', 'Unsupported template protocol');
  const runtime = object(item.runtime, 'runtime');
  rejectUnknown(runtime, ['min_version', 'max_version'], 'runtime');
  const activation = object(item.activation, 'activation');
  rejectUnknown(activation, ['default', 'require_user_confirmation'], 'activation');
  if (activation.default !== 'preview' && activation.default !== 'active') throw new ProtocolError('INVALID_FIELD', 'activation.default must be preview or active');
  if (typeof activation.require_user_confirmation !== 'boolean') throw new ProtocolError('INVALID_FIELD', 'activation.require_user_confirmation must be boolean');
  const permissions = object(item.permissions, 'permissions');
  rejectUnknown(permissions, ['read_scopes', 'write_scopes', 'network_providers'], 'permissions');
  const list = (value: unknown, field: string): string[] => {
    if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) throw new ProtocolError('INVALID_FIELD', `${field} must be a list of strings`);
    return value.map(entry => text(entry, field, 1000));
  };
  const protocolMap = object(item.protocols, 'protocols');
  if (Object.keys(protocolMap).length === 0 || Object.entries(protocolMap).some(([key, value]) => key.trim().length === 0 || typeof value !== 'string' || value.trim().length === 0)) throw new ProtocolError('INVALID_FIELD', 'protocols must map non-empty protocol ids to non-empty ranges');
  let cognitiveSource: TemplateBundleManifest['cognitive_source'];
  if (item.cognitive_source !== undefined) {
    const source = object(item.cognitive_source, 'cognitive_source');
    rejectUnknown(source, ['mode', 'connector', 'selection_required', 'allowed_scope_types', 'semantic_defaults'], 'cognitive_source');
    if (!['user-selected', 'isolated-empty', 'team-shared'].includes(source.mode as string)) throw new ProtocolError('INVALID_FIELD', 'cognitive_source.mode is invalid');
    if (!['mywiki', 'none', 'custom'].includes(source.connector as string)) throw new ProtocolError('INVALID_FIELD', 'cognitive_source.connector is invalid');
    if (typeof source.selection_required !== 'boolean') throw new ProtocolError('INVALID_FIELD', 'cognitive_source.selection_required must be boolean');
    if (!Array.isArray(source.allowed_scope_types) || source.allowed_scope_types.some(value => !['personal', 'project', 'team', 'domain'].includes(value as string))) throw new ProtocolError('INVALID_FIELD', 'cognitive_source.allowed_scope_types is invalid');
    if (!['none', 'structure-only', 'source-pack'].includes(source.semantic_defaults as string)) throw new ProtocolError('INVALID_FIELD', 'cognitive_source.semantic_defaults is invalid');
    cognitiveSource = {mode: source.mode as NonNullable<TemplateBundleManifest['cognitive_source']>['mode'], connector: source.connector as NonNullable<TemplateBundleManifest['cognitive_source']>['connector'], selection_required: source.selection_required, allowed_scope_types: [...(source.allowed_scope_types as Array<'personal' | 'project' | 'team' | 'domain'>)], semantic_defaults: source.semantic_defaults as NonNullable<TemplateBundleManifest['cognitive_source']>['semantic_defaults']};
  }
  return {
    protocol_id: TEMPLATE_PROTOCOL_ID,
    protocol_version: TEMPLATE_PROTOCOL_VERSION,
    bundle_id: text(item.bundle_id, 'bundle_id'),
    bundle_version: text(item.bundle_version, 'bundle_version', 64),
    display_name: text(item.display_name, 'display_name', 300),
    runtime: {min_version: text(runtime.min_version, 'runtime.min_version', 64), ...(runtime.max_version === undefined ? {} : {max_version: text(runtime.max_version, 'runtime.max_version', 64)})},
    protocols: Object.fromEntries(Object.entries(protocolMap).map(([key, value]) => [key, String(value).trim()])),
    capabilities: refs(item.capabilities, 'capabilities'),
    source_packs: refs(item.source_packs, 'source_packs'),
    context_templates: refs(item.context_templates, 'context_templates'),
    hosts: list(item.hosts, 'hosts'),
    activation: {default: activation.default as 'preview' | 'active', require_user_confirmation: activation.require_user_confirmation},
    permissions: {read_scopes: list(permissions.read_scopes, 'permissions.read_scopes'), write_scopes: list(permissions.write_scopes, 'permissions.write_scopes'), network_providers: list(permissions.network_providers, 'permissions.network_providers')},
    ...(cognitiveSource === undefined ? {} : {cognitive_source: cognitiveSource}),
  };
}

export function buildTemplateLock(manifest: TemplateBundleManifest, runtimeVersion: string, instanceId: string, installedAt = new Date().toISOString(), selectedSource?: TemplateInstanceLock['selected_source']): TemplateInstanceLock {
  const valid = validateTemplateManifest(manifest);
  const map = (items: TemplateRef[]): Record<string, TemplateRef> => Object.fromEntries(items.map(item => [item.id, {...item}]));
  return {
    instance_id: text(instanceId, 'instance_id'),
    template: {id: valid.bundle_id, version: valid.bundle_version},
    installed_at: text(installedAt, 'installed_at', 80),
    runtime_version: text(runtimeVersion, 'runtime_version', 64),
    protocols: {...valid.protocols},
    capabilities: map(valid.capabilities),
    source_packs: map(valid.source_packs),
    context_templates: map(valid.context_templates),
    local_overrides: [],
    disabled_items: [],
    ...(valid.cognitive_source === undefined ? {} : {cognitive_source: valid.cognitive_source}),
    ...(selectedSource === undefined ? {} : {selected_source: selectedSource}),
  };
}

export interface TemplatePreview {
  bundle_id: string;
  bundle_version: string;
  additions: string[];
  updates: string[];
  removals: string[];
  conflicts: string[];
  warnings: string[];
  requires_confirmation: boolean;
}

export function previewTemplate(manifest: TemplateBundleManifest, existing?: TemplateInstanceLock): TemplatePreview {
  const valid = validateTemplateManifest(manifest);
  const desired = [
    ...valid.capabilities.map(item => `capability:${item.id}@${item.version}`),
    ...valid.source_packs.map(item => `source-pack:${item.id}@${item.version}`),
    ...valid.context_templates.map(item => `context-template:${item.id}@${item.version}`),
  ];
  const previous = existing ? [
    ...Object.values(existing.capabilities).map(item => `capability:${item.id}@${item.version}`),
    ...Object.values(existing.source_packs).map(item => `source-pack:${item.id}@${item.version}`),
    ...Object.values(existing.context_templates).map(item => `context-template:${item.id}@${item.version}`),
  ] : [];
  const additions = desired.filter(item => !previous.includes(item));
  const removals = previous.filter(item => !desired.some(candidate => candidate.split('@')[0] === item.split('@')[0]));
  const updates = existing ? desired.filter(item => previous.some(previousItem => previousItem.split('@')[0] === item.split('@')[0] && previousItem !== item)) : [];
  const conflicts = existing ? updates.filter(item => (existing.local_overrides ?? []).some(override => item.startsWith(`${override}:`) || item.startsWith(override))) : [];
  const warnings: string[] = [];
  if (existing && existing.template.id === valid.bundle_id && existing.template.version !== valid.bundle_version) warnings.push(`template update ${existing.template.version} -> ${valid.bundle_version} requires a three-way diff`);
  if (valid.permissions.write_scopes.length > 0) warnings.push('template requests write scopes; installation remains preview-only until the user confirms');
  if (conflicts.length > 0) warnings.push('local overrides conflict with template updates; no automatic merge is allowed');
  return {bundle_id: valid.bundle_id, bundle_version: valid.bundle_version, additions, updates, removals, conflicts, warnings, requires_confirmation: valid.activation.require_user_confirmation};
}

export function templateManifestHash(manifest: TemplateBundleManifest): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}
