import {ProtocolError, ProtocolVersionRegistry, rejectUnknown, requireObject as record, requireText as text, type ProtocolVersioned, type RecordRef} from '../../protocol/src/index.js';
import {CapabilityContentContract, CapabilityProvenance, validateCapabilityContentContract, validateCapabilityProvenance} from './content.js';

export const CAPABILITY_PROTOCOL_ID = 'trace.capability-publish' as const;
export const CAPABILITY_PROTOCOL_VERSION = '0.2.0' as const;

export type CapabilityArtifactKind = 'skill' | 'workflow' | 'source-pack' | 'context-pack';

export interface CapabilityFileSpec {
  source: string;
  target?: string;
}

export interface CapabilitySpec {
  protocol_id?: typeof CAPABILITY_PROTOCOL_ID;
  protocol_version?: typeof CAPABILITY_PROTOCOL_VERSION;
  capability_id: string;
  version: string;
  display_name: string;
  description: string;
  artifact_kind: CapabilityArtifactKind;
  source_root: string;
  target_root: string;
  files: CapabilityFileSpec[];
  host_compatibility: string[];
  runtime_compatibility: Record<string, string>;
  dependencies?: string[];
  provenance: CapabilityProvenance;
  content_contract?: CapabilityContentContract;
  protocol_registry_ref?: string;
}

export interface CapabilityManifest {
  protocol_id: typeof CAPABILITY_PROTOCOL_ID;
  protocol_version: typeof CAPABILITY_PROTOCOL_VERSION;
  capability_id: string;
  version: string;
  display_name: string;
  description: string;
  artifact_kind: CapabilityArtifactKind;
  source_root: string;
  target_root: string;
  host_compatibility: string[];
  runtime_compatibility: Record<string, string>;
  dependencies: string[];
  provenance: CapabilityProvenance;
  content_contract?: CapabilityContentContract;
  protocol_registry_ref?: string;
  sources: Record<string, string>;
  files: Record<string, string>;
  installed_before: Record<string, string | null>;
  staged_at: string;
}

export interface CapabilityPreview {
  capability_id: string;
  version: string;
  candidate_dir?: string;
  target_root: string;
  additions: string[];
  updates: string[];
  unchanged: string[];
  removals: string[];
  warnings: string[];
  requires_confirmation: true;
}

export interface CapabilityReceiptFile {
  path: string;
  before_sha256: string | null;
  after_sha256: string;
  before_base64: string | null;
}

export interface CapabilityReceipt {
  protocol_id: typeof CAPABILITY_PROTOCOL_ID;
  protocol_version: typeof CAPABILITY_PROTOCOL_VERSION;
  status: 'prepared' | 'published' | 'rolled_back';
  approval: string;
  candidate_manifest: string;
  candidate_sha256: string;
  target_root: string;
  files: CapabilityReceiptFile[];
  created_at: string;
  updated_at: string;
}

type AnyCapabilityProtocol = ProtocolVersioned & Record<string, unknown>;
const capabilityUpcasters = new ProtocolVersionRegistry<AnyCapabilityProtocol>();
capabilityUpcasters.register({protocol_id: CAPABILITY_PROTOCOL_ID, from_version: '0.1.0', to_version: CAPABILITY_PROTOCOL_VERSION, upcast(value) { return {...value, protocol_version: CAPABILITY_PROTOCOL_VERSION}; }});

function canonicalCapabilityProtocol(raw: Record<string, unknown>, field: string, optional = false): Record<string, unknown> {
  if (raw.protocol_id === undefined && raw.protocol_version === undefined && optional) return raw;
  if (raw.protocol_id !== CAPABILITY_PROTOCOL_ID) throw new ProtocolError('PROTOCOL_MISMATCH', `Unsupported ${field} protocol`);
  const item = raw.protocol_version === '0.1.0' ? capabilityUpcasters.upgrade(raw as AnyCapabilityProtocol, CAPABILITY_PROTOCOL_VERSION) as Record<string, unknown> : raw;
  if (item.protocol_version !== CAPABILITY_PROTOCOL_VERSION) throw new ProtocolError('PROTOCOL_MIGRATION_REQUIRED', `Unsupported ${field} protocol version: ${String(item.protocol_version)}`);
  return item;
}

function safeRelative(value: unknown, field: string): string {
  const relative = text(value, field, 1000);
  if (relative.includes('\\') || relative.startsWith('/') || relative.split('/').some(part => part === '' || part === '.' || part === '..')) throw new ProtocolError('INVALID_PATH', `${field} must be a relative forward-slash path without traversal`);
  return relative;
}

function absolute(value: unknown, field: string): string {
  const candidate = text(value, field, 2000);
  if (!candidate.match(/^[A-Za-z]:[\\/]|^\\\\|^\//)) throw new ProtocolError('INVALID_PATH', `${field} must be absolute`);
  return candidate;
}

function sameRecordRef(left: RecordRef | undefined, right: RecordRef | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.record_id === right.record_id && left.revision === right.revision && left.kind === right.kind && left.schema_id === right.schema_id && left.schema_version === right.schema_version;
}

export function validateCapabilitySpec(value: unknown): CapabilitySpec {
  const item = canonicalCapabilityProtocol(record(value, 'capability_spec'), 'capability', true);
  rejectUnknown(item, ['protocol_id', 'protocol_version', 'capability_id', 'version', 'display_name', 'description', 'artifact_kind', 'source_root', 'target_root', 'files', 'host_compatibility', 'runtime_compatibility', 'dependencies', 'provenance', 'content_contract', 'protocol_registry_ref'], 'capability_spec');
  const kind = text(item.artifact_kind, 'artifact_kind', 32) as CapabilityArtifactKind;
  if (!['skill', 'workflow', 'source-pack', 'context-pack'].includes(kind)) throw new ProtocolError('INVALID_FIELD', 'artifact_kind is not supported');
  const sourceRoot = absolute(item.source_root, 'source_root');
  const filesValue = item.files;
  if (!Array.isArray(filesValue) || filesValue.length === 0 || filesValue.length > 512) throw new ProtocolError('INVALID_FIELD', 'files must contain 1-512 entries');
  const files = filesValue.map((raw, index): CapabilityFileSpec => {
    const file = record(raw, `files[${index}]`);
    rejectUnknown(file, ['source', 'target'], `files[${index}]`);
    const source = safeRelative(file.source, `files[${index}].source`);
    const target = file.target === undefined ? undefined : safeRelative(file.target, `files[${index}].target`);
    if (target === undefined) return {source};
    return {source, target};
  });
  const targets = files.map(file => file.target ?? file.source);
  if (new Set(targets).size !== targets.length) throw new ProtocolError('DUPLICATE', 'Capability target paths must be unique');
  const hosts = item.host_compatibility;
  if (!Array.isArray(hosts) || hosts.length === 0 || hosts.some(host => typeof host !== 'string' || host.trim().length === 0)) throw new ProtocolError('INVALID_FIELD', 'host_compatibility must be a non-empty list');
  const runtime = record(item.runtime_compatibility, 'runtime_compatibility');
  const runtimeCompatibility = Object.fromEntries(Object.entries(runtime).map(([key, value]) => [text(key, 'runtime_compatibility key', 120), text(value, `runtime_compatibility.${key}`, 120)]));
  const dependenciesValue = item.dependencies ?? [];
  if (!Array.isArray(dependenciesValue) || dependenciesValue.length > 64 || dependenciesValue.some(value => typeof value !== 'string' || value.trim().length === 0 || value.length > 240)) throw new ProtocolError('INVALID_FIELD', 'dependencies must contain at most 64 non-empty strings');
  const provenance = validateCapabilityProvenance(item.provenance);
  const contentContract = item.content_contract === undefined ? undefined : validateCapabilityContentContract(item.content_contract);
  if (kind === 'skill' && contentContract === undefined) throw new ProtocolError('MISSING_REQUIRED_DATA', 'skill capabilities require content_contract');
  if (kind === 'skill' && provenance.capability_candidate_ref === undefined) throw new ProtocolError('MISSING_REQUIRED_DATA', 'skill capabilities require provenance.capability_candidate_ref');
  if (contentContract !== undefined && contentContract.provenance.change_id !== provenance.change_id) throw new ProtocolError('INVALID_LINEAGE', 'content_contract.provenance.change_id must match provenance.change_id');
  if (contentContract !== undefined && !sameRecordRef(contentContract.provenance.capability_candidate_ref, provenance.capability_candidate_ref)) throw new ProtocolError('INVALID_LINEAGE', 'content_contract.provenance.capability_candidate_ref must match provenance.capability_candidate_ref');
  return {
    protocol_id: CAPABILITY_PROTOCOL_ID,
    protocol_version: CAPABILITY_PROTOCOL_VERSION,
    capability_id: text(item.capability_id, 'capability_id', 160),
    version: text(item.version, 'version', 64),
    display_name: text(item.display_name, 'display_name', 300),
    description: text(item.description, 'description', 4000),
    artifact_kind: kind,
    source_root: sourceRoot,
    target_root: absolute(item.target_root, 'target_root'),
    files,
    host_compatibility: hosts.map(host => String(host).trim()),
    runtime_compatibility: runtimeCompatibility,
    dependencies: dependenciesValue.map(value => String(value).trim()),
    provenance,
    ...(contentContract === undefined ? {} : {content_contract: contentContract}),
    ...(item.protocol_registry_ref === undefined ? {} : {protocol_registry_ref: text(item.protocol_registry_ref, 'protocol_registry_ref', 1000)}),
  };
}

export function validateCapabilityManifest(value: unknown): CapabilityManifest {
  const item = canonicalCapabilityProtocol(record(value, 'capability_manifest'), 'capability manifest');
  rejectUnknown(item, ['protocol_id', 'protocol_version', 'capability_id', 'version', 'display_name', 'description', 'artifact_kind', 'source_root', 'target_root', 'host_compatibility', 'runtime_compatibility', 'dependencies', 'provenance', 'content_contract', 'protocol_registry_ref', 'sources', 'files', 'installed_before', 'staged_at'], 'capability_manifest');
  const sources = record(item.sources, 'sources');
  const files = record(item.files, 'files');
  const installedBeforeValue = record(item.installed_before, 'installed_before');
  const sourcePaths = Object.keys(sources).map(value => safeRelative(value, 'sources path'));
  const filePaths = Object.keys(files).map(value => safeRelative(value, 'files path'));
  const sourceHashes = Object.fromEntries(sourcePaths.map(relative => [relative, text(sources[relative], `sources.${relative}`, 128)]));
  const fileHashes = Object.fromEntries(filePaths.map(relative => [relative, text(files[relative], `files.${relative}`, 128)]));
  const installedBefore: Record<string, string | null> = {};
  for (const [relative, hash] of Object.entries(installedBeforeValue)) {
    const file = safeRelative(relative, 'installed_before path');
    if (hash !== null && typeof hash !== 'string') throw new ProtocolError('INVALID_FIELD', `installed_before.${file} must be a hash or null`);
    installedBefore[file] = hash as string | null;
  }
  const hosts = item.host_compatibility;
  if (!Array.isArray(hosts) || hosts.some(host => typeof host !== 'string')) throw new ProtocolError('INVALID_FIELD', 'host_compatibility must be a string list');
  const runtime = record(item.runtime_compatibility, 'runtime_compatibility');
  const dependenciesValue = item.dependencies;
  if (!Array.isArray(dependenciesValue) || dependenciesValue.length > 64 || dependenciesValue.some(value => typeof value !== 'string' || value.trim().length === 0 || value.length > 240)) throw new ProtocolError('INVALID_FIELD', 'dependencies must contain at most 64 non-empty strings');
  const artifactKind = text(item.artifact_kind, 'artifact_kind', 32) as CapabilityArtifactKind;
  if (!['skill', 'workflow', 'source-pack', 'context-pack'].includes(artifactKind)) throw new ProtocolError('INVALID_FIELD', 'artifact_kind is not supported');
  const provenance = validateCapabilityProvenance(item.provenance);
  const contentContract = item.content_contract === undefined ? undefined : validateCapabilityContentContract(item.content_contract);
  if (artifactKind === 'skill' && contentContract === undefined) throw new ProtocolError('MISSING_REQUIRED_DATA', 'skill manifests require content_contract');
  if (artifactKind === 'skill' && provenance.capability_candidate_ref === undefined) throw new ProtocolError('MISSING_REQUIRED_DATA', 'skill manifests require provenance.capability_candidate_ref');
  if (contentContract !== undefined && contentContract.provenance.change_id !== provenance.change_id) throw new ProtocolError('INVALID_LINEAGE', 'content_contract.provenance.change_id must match provenance.change_id');
  if (contentContract !== undefined && !sameRecordRef(contentContract.provenance.capability_candidate_ref, provenance.capability_candidate_ref)) throw new ProtocolError('INVALID_LINEAGE', 'content_contract.provenance.capability_candidate_ref must match provenance.capability_candidate_ref');
  return {
    protocol_id: CAPABILITY_PROTOCOL_ID,
    protocol_version: CAPABILITY_PROTOCOL_VERSION,
    capability_id: text(item.capability_id, 'capability_id', 160),
    version: text(item.version, 'version', 64),
    display_name: text(item.display_name, 'display_name', 300),
    description: text(item.description, 'description', 4000),
    artifact_kind: artifactKind,
    source_root: absolute(item.source_root, 'source_root'),
    target_root: absolute(item.target_root, 'target_root'),
    host_compatibility: hosts.map(host => String(host).trim()),
    runtime_compatibility: Object.fromEntries(Object.entries(runtime).map(([key, value]) => [text(key, 'runtime_compatibility key', 120), text(value, `runtime_compatibility.${key}`, 120)])),
    dependencies: dependenciesValue.map(value => String(value).trim()),
    provenance,
    ...(contentContract === undefined ? {} : {content_contract: contentContract}),
    ...(item.protocol_registry_ref === undefined ? {} : {protocol_registry_ref: text(item.protocol_registry_ref, 'protocol_registry_ref', 1000)}),
    sources: sourceHashes,
    files: fileHashes,
    installed_before: installedBefore,
    staged_at: text(item.staged_at, 'staged_at', 80),
  };
}
