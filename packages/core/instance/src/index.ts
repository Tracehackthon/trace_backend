import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ProtocolError, ProtocolVersionRegistry, requireObject, requireText as text, type ProtocolVersioned} from '../../protocol/src/index.js';
import {buildTemplateLock, validateTemplateManifest, type TemplateBundleManifest, type TemplateInstanceLock} from '../../../template/contract/src/index.js';
import {normalizeHostRetrievalPolicy, type HostRetrievalPolicy} from '../../retrieval-evidence/src/index.js';
import {buildActivationLock, collaborationModelHash, defaultCollaborationModel, defaultSourceActivationManifest, sourceActivationManifestHash, validateActivationLock, validateCollaborationModel, validateSourceActivationManifest, type ActivationLock, type CollaborationModel, type SourceActivationManifest} from '../../collaboration-context/src/index.js';

export const PROJECT_INSTANCE_PROTOCOL_ID = 'trace.project-instance' as const;
export const PROJECT_INSTANCE_PROTOCOL_VERSION = '0.2.0' as const;
export type ProjectSourceMode = 'local' | 'external' | 'team' | 'empty';
export type ProjectScopeType = 'personal' | 'project' | 'team' | 'domain';

export interface ProjectSourceProfileInput {
  source_id: string;
  root: string;
  formal_prefix?: string;
  read_enabled?: boolean;
  write_enabled?: boolean;
  user_id: string;
  scope_type?: ProjectScopeType;
  source_mode?: ProjectSourceMode;
  activation_excluded_paths?: string[];
  host_retrieval?: Partial<HostRetrievalPolicy>;
  activation_manifest?: SourceActivationManifest;
  collaboration_model?: CollaborationModel;
}
export interface ProjectInitInput {
  project_dir: string;
  manifest: TemplateBundleManifest;
  runtime_version: string;
  instance_id: string;
  user_id: string;
  source_mode: ProjectSourceMode;
  source_root?: string;
  source_id?: string;
  source_profile?: ProjectSourceProfileInput;
  created_at?: string;
}
export interface ProjectInstanceDescriptor {
  protocol_id: typeof PROJECT_INSTANCE_PROTOCOL_ID;
  protocol_version: typeof PROJECT_INSTANCE_PROTOCOL_VERSION;
  project_id: string;
  instance_id: string;
  template_id: string;
  template_version: string;
  source_mode: ProjectSourceMode;
  source_scope: ProjectScopeType;
  state_file: string;
  source_root: string;
  created_at: string;
}
export interface ProjectInitResult {
  project_dir: string;
  trace_dir: string;
  descriptor: ProjectInstanceDescriptor;
  lock: TemplateInstanceLock;
  source_profile: ProjectSourceProfileInput;
  collaboration_model: CollaborationModel;
  source_activation: SourceActivationManifest;
  activation_lock: ActivationLock;
  created_paths: string[];
}
export interface ProjectActivationConfigurationInput {
  collaboration_model: CollaborationModel;
  source_activation: SourceActivationManifest;
}
export type ProjectActivationConfigurationState = 'locked' | 'legacy_unlocked';

type AnyProjectInstanceProtocol = ProtocolVersioned & Record<string, unknown>;
const projectInstanceUpcasters = new ProtocolVersionRegistry<AnyProjectInstanceProtocol>();
projectInstanceUpcasters.register({protocol_id: PROJECT_INSTANCE_PROTOCOL_ID, from_version: '0.1.0', to_version: PROJECT_INSTANCE_PROTOCOL_VERSION, upcast(value) { return {...value, protocol_version: PROJECT_INSTANCE_PROTOCOL_VERSION}; }});

/** Read project.json defensively without admitting a random user path as state. */
export function validateProjectInstanceDescriptor(value: unknown): ProjectInstanceDescriptor {
  const raw = requireObject(value, 'project_instance');
  if (raw.protocol_id !== PROJECT_INSTANCE_PROTOCOL_ID) throw new ProtocolError('PROTOCOL_MISMATCH', 'Unsupported project instance protocol');
  const item = raw.protocol_version === '0.1.0' ? projectInstanceUpcasters.upgrade(raw as AnyProjectInstanceProtocol, PROJECT_INSTANCE_PROTOCOL_VERSION) as Record<string, unknown> : raw;
  const allowed = ['protocol_id', 'protocol_version', 'project_id', 'instance_id', 'template_id', 'template_version', 'source_mode', 'source_scope', 'state_file', 'source_root', 'created_at'];
  const unknown = Object.keys(item).filter(key => !allowed.includes(key));
  if (unknown.length > 0) throw new ProtocolError('UNKNOWN_FIELD', `project instance contains unsupported fields: ${unknown.join(', ')}`);
  if (item.protocol_version !== PROJECT_INSTANCE_PROTOCOL_VERSION) throw new ProtocolError('PROTOCOL_MIGRATION_REQUIRED', `Unsupported project instance protocol version: ${String(item.protocol_version)}`);
  const sourceMode = item.source_mode;
  const sourceScope = item.source_scope;
  if (!['local', 'external', 'team', 'empty'].includes(sourceMode as string) || !['personal', 'project', 'team', 'domain'].includes(sourceScope as string)) throw new ProtocolError('INVALID_FIELD', 'project instance source mode/scope is invalid');
  const stateFile = text(item.state_file, 'state_file', 400);
  const sourceRoot = text(item.source_root, 'source_root', 4000);
  if (stateFile !== '.trace/state/trace.sqlite') throw new ProtocolError('INVALID_FIELD', 'project instance state_file is invalid');
  if (!sourceRoot.startsWith('.trace/')) throw new ProtocolError('INVALID_FIELD', 'project instance source_root must be a project-local trace path');
  return {protocol_id: PROJECT_INSTANCE_PROTOCOL_ID, protocol_version: PROJECT_INSTANCE_PROTOCOL_VERSION, project_id: text(item.project_id, 'project_id', 80), instance_id: text(item.instance_id, 'instance_id', 200), template_id: text(item.template_id, 'template_id', 240), template_version: text(item.template_version, 'template_version', 64), source_mode: sourceMode as ProjectSourceMode, source_scope: sourceScope as ProjectScopeType, state_file: stateFile, source_root: sourceRoot, created_at: text(item.created_at, 'created_at', 80)};
}

function absolute(value: unknown, field: string): string {
  const resolved = path.resolve(text(value, field, 4000));
  if (!path.isAbsolute(resolved)) throw new ProtocolError('INVALID_INPUT', `${field} must be absolute`);
  return resolved;
}
function sameAbsolutePath(left: string, right: string): boolean {
  const normalize = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}
function projectManagedSourceRoot(traceDir: string): string { return path.join(traceDir, 'source'); }
function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
function ensureDirectory(dir: string): void { fs.mkdirSync(dir, {recursive: true}); }
function writeNew(file: string, content: string): void { ensureDirectory(path.dirname(file)); fs.writeFileSync(file, content, {encoding: 'utf8', flag: 'wx'}); }
function slug(value: string): string { const candidate = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); return candidate || 'project'; }
function scopeFor(mode: ProjectSourceMode): ProjectScopeType { if (mode === 'external') return 'personal'; if (mode === 'team') return 'team'; return 'project'; }
function readJson(file: string): unknown { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeAtomic(file: string, content: string): void {
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, content, {encoding: 'utf8', flag: 'wx'});
  try { fs.renameSync(temporary, file); } catch (error) { fs.rmSync(temporary, {force: true}); throw error; }
}

/** A source-map locator must be navigable through the selected host lease. */
function assertActivationMapWithinSourcePolicy(source: SourceActivationManifest, profile: ProjectSourceProfileInput): void {
  const prefixes = profile.host_retrieval?.mode === 'disabled'
    ? []
    : (profile.host_retrieval?.allowed_prefixes ?? [profile.formal_prefix ?? 'wiki']);
  for (const entry of source.entry_points) {
    if (entry.locator === undefined) continue;
    const locator = entry.locator;
    if (!prefixes.some(prefix => locator === prefix || locator.startsWith(`${prefix}/`))) {
      throw new ProtocolError('SOURCE_MAP_OUT_OF_SCOPE', `source activation entry ${entry.id} is outside the selected host retrieval prefixes`);
    }
  }
}

function assertActivationLockMatches(lock: ActivationLock, input: {template_id: string; model: CollaborationModel; source: SourceActivationManifest}): void {
  if (lock.template_id !== input.template_id) throw new ProtocolError('ACTIVATION_LOCK_MISMATCH', 'activation lock template_id does not match this project');
  if (lock.collaboration_model.model_id !== input.model.model_id || lock.collaboration_model.version !== input.model.version || lock.collaboration_model.sha256 !== collaborationModelHash(input.model)) {
    throw new ProtocolError('ACTIVATION_LOCK_MISMATCH', 'collaboration model changed outside the explicit Trace profile update flow');
  }
  if (lock.source_activation.manifest_id !== input.source.manifest_id || lock.source_activation.version !== input.source.version || lock.source_activation.source_id !== input.source.source_id || lock.source_activation.sha256 !== sourceActivationManifestHash(input.source)) {
    throw new ProtocolError('ACTIVATION_LOCK_MISMATCH', 'source activation map changed outside the explicit Trace profile update flow');
  }
}

function sourceProfileLockMismatch(message = 'The source profile differs from this project lock. No source lease was issued.'): never {
  throw new ProtocolError('SOURCE_PROFILE_LOCK_MISMATCH', message);
}

/** Parse only the source fields that can influence a host source lease. */
function validateStoredSourceProfile(value: unknown): ProjectSourceProfileInput {
  const raw = requireObject(value, 'source_profile');
  const sourceMode = raw.source_mode;
  const scope = raw.scope_type;
  if (!['local', 'external', 'team', 'empty'].includes(sourceMode as string)) throw new ProtocolError('SOURCE_PROFILE_INVALID', 'source profile mode is invalid');
  if (!['personal', 'project', 'team', 'domain'].includes(scope as string)) throw new ProtocolError('SOURCE_PROFILE_INVALID', 'source profile scope is invalid');
  const formalPrefix = text(raw.formal_prefix ?? 'wiki', 'source_profile.formal_prefix', 200);
  const activationExcludedPaths = raw.activation_excluded_paths ?? [];
  if (!Array.isArray(activationExcludedPaths) || activationExcludedPaths.length > 128 || activationExcludedPaths.some(item => typeof item !== 'string')) throw new ProtocolError('SOURCE_PROFILE_INVALID', 'source profile activation_excluded_paths is invalid');
  if (raw.read_enabled !== undefined && typeof raw.read_enabled !== 'boolean') throw new ProtocolError('SOURCE_PROFILE_INVALID', 'source profile read_enabled is invalid');
  if (raw.write_enabled !== undefined && typeof raw.write_enabled !== 'boolean') throw new ProtocolError('SOURCE_PROFILE_INVALID', 'source profile write_enabled is invalid');
  return {
    source_id: text(raw.source_id, 'source_profile.source_id', 240),
    root: absolute(raw.root, 'source_profile.root'),
    formal_prefix: formalPrefix,
    read_enabled: raw.read_enabled ?? true,
    write_enabled: raw.write_enabled ?? false,
    activation_excluded_paths: [...activationExcludedPaths],
    host_retrieval: normalizeHostRetrievalPolicy(raw.host_retrieval as Partial<HostRetrievalPolicy> | undefined, formalPrefix),
    user_id: text(raw.user_id, 'source_profile.user_id', 240),
    scope_type: scope as ProjectScopeType,
    source_mode: sourceMode as ProjectSourceMode,
  };
}

function selectedSourceFromLock(value: unknown): NonNullable<TemplateInstanceLock['selected_source']> {
  const lock = requireObject(value, 'template_lock');
  const selected = lock.selected_source;
  if (!selected || typeof selected !== 'object' || Array.isArray(selected)) throw new ProtocolError('SOURCE_PROFILE_LOCK_REQUIRED', 'This project has no selected source lock; migrate or reinitialize it before issuing a source lease');
  const item = selected as Record<string, unknown>;
  const scope = item.scope_type;
  if (!['personal', 'project', 'team', 'domain'].includes(scope as string)) throw new ProtocolError('SOURCE_PROFILE_LOCK_REQUIRED', 'The selected source lock is invalid');
  const profileHash = text(item.profile_hash, 'selected_source.profile_hash', 128);
  if (!/^[a-f0-9]{64}$/.test(profileHash)) throw new ProtocolError('SOURCE_PROFILE_LOCK_REQUIRED', 'The selected source lock hash is invalid');
  return {source_id: text(item.source_id, 'selected_source.source_id', 240), profile_hash: profileHash, scope_type: scope as ProjectScopeType};
}

/**
 * `local` and `empty` are descriptor-owned source modes, not editable aliases
 * for an arbitrary external root. Their root and, for `empty`, their disabled
 * policy are therefore invariant even when a profile hash has been refreshed.
 */
function assertProjectSourceDescriptorInvariant(input: {trace_dir: string; profile: ProjectSourceProfileInput; source_mode?: ProjectSourceMode; source_scope?: ProjectScopeType}): void {
  const mode = input.source_mode ?? input.profile.source_mode;
  const scope = input.source_scope ?? input.profile.scope_type;
  if (mode === undefined || scope === undefined) throw new ProtocolError('SOURCE_DESCRIPTOR_INVARIANT', 'The selected source profile is missing its descriptor mode or scope');
  if (input.profile.source_mode !== mode || input.profile.scope_type !== scope) throw new ProtocolError('SOURCE_DESCRIPTOR_INVARIANT', 'The selected source profile does not match this project source descriptor');
  if (mode !== 'local' && mode !== 'empty') return;
  if (scope !== 'project' || !sameAbsolutePath(input.profile.root, projectManagedSourceRoot(input.trace_dir))) {
    throw new ProtocolError('SOURCE_DESCRIPTOR_INVARIANT', `${mode} sources must retain the project-local Trace source root`);
  }
  if (mode === 'empty') {
    if (input.profile.read_enabled !== false || input.profile.write_enabled !== false || input.profile.host_retrieval?.mode !== 'disabled') {
      throw new ProtocolError('SOURCE_DESCRIPTOR_INVARIANT', 'An empty source must remain disabled and cannot issue a source lease');
    }
  }
}

/**
 * A host may receive only a source profile whose exact on-disk bytes match the
 * project-local selected-source lock.  This protects a Codex event routed by
 * cwd from silently acquiring a newly edited absolute root.
 */
export function loadLockedProjectSourceProfile(input: {trace_dir: string; source_mode?: ProjectSourceMode; source_scope?: ProjectScopeType}): ProjectSourceProfileInput {
  const traceDir = absolute(input.trace_dir, 'trace_dir');
  const profileFile = path.join(traceDir, 'profiles', 'source.profile.json');
  const lockFile = path.join(traceDir, 'instance', 'trace.lock.json');
  if (!fs.existsSync(profileFile) || !fs.existsSync(lockFile)) throw new ProtocolError('SOURCE_PROFILE_LOCK_REQUIRED', 'This project is missing its source profile or source lock; no source lease was issued');
  let profileText: string;
  let profile: ProjectSourceProfileInput;
  try { profileText = fs.readFileSync(profileFile, 'utf8'); profile = validateStoredSourceProfile(JSON.parse(profileText)); }
  catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError('SOURCE_PROFILE_INVALID', 'The project source profile is unreadable; no source lease was issued');
  }
  let selected: NonNullable<TemplateInstanceLock['selected_source']>;
  try { selected = selectedSourceFromLock(readJson(lockFile)); }
  catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError('SOURCE_PROFILE_LOCK_REQUIRED', 'The project source lock is unreadable; no source lease was issued');
  }
  if (sha256(profileText) !== selected.profile_hash || profile.source_id !== selected.source_id || profile.scope_type !== selected.scope_type) sourceProfileLockMismatch();
  if (input.source_mode !== undefined && profile.source_mode !== input.source_mode) sourceProfileLockMismatch('The source profile mode differs from the project descriptor. No source lease was issued.');
  if (input.source_scope !== undefined && profile.scope_type !== input.source_scope) sourceProfileLockMismatch('The source profile scope differs from the project descriptor. No source lease was issued.');
  assertProjectSourceDescriptorInvariant({trace_dir: traceDir, profile, ...(input.source_mode === undefined ? {} : {source_mode: input.source_mode}), ...(input.source_scope === undefined ? {} : {source_scope: input.source_scope})});
  return profile;
}

/**
 * The detailed model and source map live in the ignored profiles directory;
 * the committable activation lock retains only identities and hashes. Existing
 * projects can use a compatibility starter, but remain visibly legacy-unlocked
 * until the user explicitly writes a local lock with `profile migrate`.
 */
export function loadProjectActivationConfiguration(input: {trace_dir: string; template_id: string; source_mode?: ProjectSourceMode; source_scope?: ProjectScopeType}): {source_profile: ProjectSourceProfileInput; collaboration_model: CollaborationModel; source_activation: SourceActivationManifest; activation_lock?: ActivationLock; configuration_state: ProjectActivationConfigurationState} {
  const traceDir = absolute(input.trace_dir, 'trace_dir');
  const source_profile = loadLockedProjectSourceProfile({trace_dir: traceDir, ...(input.source_mode === undefined ? {} : {source_mode: input.source_mode}), ...(input.source_scope === undefined ? {} : {source_scope: input.source_scope})});
  const modelFile = path.join(traceDir, 'profiles', 'collaboration-model.json');
  const sourceFile = path.join(traceDir, 'profiles', 'source-activation.json');
  const lockFile = path.join(traceDir, 'instance', 'activation.lock.json');
  const collaboration_model = fs.existsSync(modelFile)
    ? validateCollaborationModel(readJson(modelFile))
    : defaultCollaborationModel(input.template_id);
  const source_activation = fs.existsSync(sourceFile)
    ? validateSourceActivationManifest(readJson(sourceFile))
    : defaultSourceActivationManifest({source_id: source_profile.source_id, source_mode: source_profile.source_mode ?? 'local', template_id: input.template_id});
  if (source_activation.source_id !== source_profile.source_id) throw new ProtocolError('INVALID_INPUT', 'source activation manifest source_id does not match the selected source profile');
  assertActivationMapWithinSourcePolicy(source_activation, source_profile);
  let activation_lock: ActivationLock | undefined;
  if (fs.existsSync(lockFile)) {
    activation_lock = validateActivationLock(readJson(lockFile));
    assertActivationLockMatches(activation_lock, {template_id: input.template_id, model: collaboration_model, source: source_activation});
  }
  return {source_profile, collaboration_model, source_activation, configuration_state: activation_lock === undefined ? 'legacy_unlocked' : 'locked', ...(activation_lock === undefined ? {} : {activation_lock})};
}

/**
 * Explicitly replace a project-local collaboration model/source map.
 * Private configuration stays under ignored profiles/; the hash-only lock is
 * refreshed atomically enough to either retain the prior files or leave a
 * recoverable backup under .trace/backups/.
 */
export function updateProjectActivationConfiguration(input: {trace_dir: string; template_id: string; source_mode?: ProjectSourceMode; source_scope?: ProjectScopeType; configuration: ProjectActivationConfigurationInput; updated_at?: string}): {collaboration_model: CollaborationModel; source_activation: SourceActivationManifest; activation_lock: ActivationLock; backup_dir: string} {
  const traceDir = absolute(input.trace_dir, 'trace_dir');
  const source_profile = loadLockedProjectSourceProfile({trace_dir: traceDir, ...(input.source_mode === undefined ? {} : {source_mode: input.source_mode}), ...(input.source_scope === undefined ? {} : {source_scope: input.source_scope})});
  const collaboration_model = validateCollaborationModel(input.configuration.collaboration_model);
  const source_activation = validateSourceActivationManifest(input.configuration.source_activation);
  if (source_activation.source_id !== source_profile.source_id) throw new ProtocolError('INVALID_INPUT', 'source activation manifest source_id does not match the selected source profile');
  assertActivationMapWithinSourcePolicy(source_activation, source_profile);
  const activation_lock = buildActivationLock({template_id: input.template_id, model: collaboration_model, source: source_activation, ...(input.updated_at === undefined ? {} : {created_at: input.updated_at})});
  const profilesDir = path.join(traceDir, 'profiles');
  const instanceDir = path.join(traceDir, 'instance');
  const backupDir = path.join(traceDir, 'backups', `activation-profile-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const targets = [
    {name: 'collaboration-model.json', target: path.join(profilesDir, 'collaboration-model.json'), content: json(collaboration_model)},
    {name: 'source-activation.json', target: path.join(profilesDir, 'source-activation.json'), content: json(source_activation)},
    {name: 'activation.lock.json', target: path.join(instanceDir, 'activation.lock.json'), content: json(activation_lock)},
  ];
  ensureDirectory(backupDir);
  for (const item of targets) if (fs.existsSync(item.target)) fs.copyFileSync(item.target, path.join(backupDir, item.name));
  try {
    for (const item of targets) writeAtomic(item.target, item.content);
  } catch (error) {
    for (const item of targets) {
      const backup = path.join(backupDir, item.name);
      if (fs.existsSync(backup)) fs.copyFileSync(backup, item.target);
    }
    throw error;
  }
  return {collaboration_model, source_activation, activation_lock, backup_dir: backupDir};
}

/**
 * One-way compatibility migration for pre-profile projects. It does not change
 * the selected source, template, SQLite state, capabilities, or hooks: it
 * only materializes the exact compatibility model/map currently in use and
 * writes their hash-only lock.
 */
export function migrateProjectActivationConfiguration(input: {trace_dir: string; template_id: string; source_mode?: ProjectSourceMode; source_scope?: ProjectScopeType; migrated_at?: string}): {migrated: boolean; previous_state: ProjectActivationConfigurationState; collaboration_model: CollaborationModel; source_activation: SourceActivationManifest; activation_lock?: ActivationLock; backup_dir?: string} {
  const current = loadProjectActivationConfiguration(input);
  if (current.configuration_state === 'locked') {
    return {
      migrated: false,
      previous_state: 'locked',
      collaboration_model: current.collaboration_model,
      source_activation: current.source_activation,
      ...(current.activation_lock === undefined ? {} : {activation_lock: current.activation_lock}),
    };
  }
  const updated = updateProjectActivationConfiguration({
    trace_dir: input.trace_dir,
    template_id: input.template_id,
    ...(input.source_mode === undefined ? {} : {source_mode: input.source_mode}),
    ...(input.source_scope === undefined ? {} : {source_scope: input.source_scope}),
    configuration: {collaboration_model: current.collaboration_model, source_activation: current.source_activation},
    ...(input.migrated_at === undefined ? {} : {updated_at: input.migrated_at}),
  });
  return {migrated: true, previous_state: 'legacy_unlocked', ...updated};
}

/**
 * Explicit recovery path for an intentional source-profile change.  A project
 * refuses a changed profile during normal use; this operation is the only path
 * that writes the matching selected-source hash after the user has reviewed a
 * separate profile file and confirmed the change.
 */
export function updateProjectSourceProfile(input: {trace_dir: string; source_mode: ProjectSourceMode; source_scope: ProjectScopeType; next_source_profile: ProjectSourceProfileInput}): {source_id: string; previous_profile_hash: string; profile_hash: string; backup_dir: string} {
  const traceDir = absolute(input.trace_dir, 'trace_dir');
  const profile = validateStoredSourceProfile(input.next_source_profile);
  if (profile.source_mode !== input.source_mode || profile.scope_type !== input.source_scope) throw new ProtocolError('SOURCE_PROFILE_LOCK_MISMATCH', 'The proposed source profile mode or scope does not match this project');
  if (input.source_mode === 'local' || input.source_mode === 'empty') {
    throw new ProtocolError('SOURCE_SELECTION_MIGRATION_REQUIRED', `${input.source_mode} sources are project-owned and cannot be replaced with source update; use an explicit source-selection migration`);
  }
  assertProjectSourceDescriptorInvariant({trace_dir: traceDir, profile, source_mode: input.source_mode, source_scope: input.source_scope});
  const lockFile = path.join(traceDir, 'instance', 'trace.lock.json');
  const profileFile = path.join(traceDir, 'profiles', 'source.profile.json');
  if (!fs.existsSync(lockFile) || !fs.existsSync(profileFile)) throw new ProtocolError('SOURCE_PROFILE_LOCK_REQUIRED', 'This project is missing its source profile or source lock');
  const lockRaw = readJson(lockFile);
  const selected = selectedSourceFromLock(lockRaw);
  if (profile.source_id !== selected.source_id) throw new ProtocolError('SOURCE_PROFILE_LOCK_MISMATCH', 'The proposed source id differs from the selected project source; reinitialize or use a source migration instead');
  const sourceMapFile = path.join(traceDir, 'profiles', 'source-activation.json');
  if (fs.existsSync(sourceMapFile)) {
    const sourceMap = validateSourceActivationManifest(readJson(sourceMapFile));
    if (sourceMap.source_id !== profile.source_id) throw new ProtocolError('SOURCE_PROFILE_LOCK_MISMATCH', 'The proposed source profile does not match this project source activation map');
    assertActivationMapWithinSourcePolicy(sourceMap, profile);
  }
  const profileText = json(profile);
  const profileHash = sha256(profileText);
  const lock = requireObject(lockRaw, 'template_lock');
  const nextLock = {...lock, selected_source: {...selected, profile_hash: profileHash}};
  const backupDir = path.join(traceDir, 'backups', `source-profile-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  ensureDirectory(backupDir);
  fs.copyFileSync(profileFile, path.join(backupDir, 'source.profile.json'));
  fs.copyFileSync(lockFile, path.join(backupDir, 'trace.lock.json'));
  try {
    writeAtomic(profileFile, profileText);
    writeAtomic(lockFile, json(nextLock));
  } catch (error) {
    fs.copyFileSync(path.join(backupDir, 'source.profile.json'), profileFile);
    fs.copyFileSync(path.join(backupDir, 'trace.lock.json'), lockFile);
    throw error;
  }
  return {source_id: profile.source_id, previous_profile_hash: selected.profile_hash, profile_hash: profileHash, backup_dir: backupDir};
}

function profileFor(input: ProjectInitInput, traceDir: string): {profile: ProjectSourceProfileInput; sourceRoot: string; scope: ProjectScopeType} {
  const mode = input.source_mode;
  const scope = scopeFor(mode);
  if (mode === 'local' || mode === 'empty') {
    if (input.source_root !== undefined || input.source_id !== undefined || input.source_profile !== undefined) throw new ProtocolError('INVALID_INPUT', `source options are not accepted for ${mode} mode`);
    const sourceRoot = path.join(traceDir, 'source');
    return {scope, sourceRoot, profile: {source_id: mode === 'empty' ? 'isolated-empty-source' : 'project-cognitive-source', root: sourceRoot, formal_prefix: 'wiki', read_enabled: mode !== 'empty', write_enabled: false, activation_excluded_paths: [], host_retrieval: {mode: mode === 'empty' ? 'disabled' : 'native_observed', allowed_prefixes: ['wiki'], max_reads_per_turn: 8}, user_id: input.user_id, scope_type: scope, source_mode: mode}};
  }
  if (input.source_profile === undefined && input.source_root === undefined) throw new ProtocolError('SOURCE_SELECTION_REQUIRED', `${mode} mode requires --source-profile or --source-root`);
  const supplied = input.source_profile;
  const sourceRoot = absolute(supplied?.root ?? input.source_root, 'source_root');
  const sourceId = text(supplied?.source_id ?? input.source_id, 'source_id', 240);
  if (input.source_id !== undefined && input.source_id !== sourceId) throw new ProtocolError('INVALID_INPUT', '--source-id does not match source profile');
  const formalPrefix = text(supplied?.formal_prefix ?? 'wiki', 'formal_prefix', 200);
  const profileUserId = text(supplied?.user_id ?? input.user_id, 'source_profile.user_id', 240);
  const readEnabled = supplied?.read_enabled ?? true;
  const writeEnabled = supplied?.write_enabled ?? false;
  const activationExcludedPaths = supplied?.activation_excluded_paths ?? [];
  const hostRetrieval = normalizeHostRetrievalPolicy(supplied?.host_retrieval, formalPrefix);
  if (typeof readEnabled !== 'boolean' || typeof writeEnabled !== 'boolean') throw new ProtocolError('INVALID_INPUT', 'source profile read_enabled/write_enabled must be boolean');
  if (!Array.isArray(activationExcludedPaths) || activationExcludedPaths.length > 128 || activationExcludedPaths.some(item => typeof item !== 'string')) throw new ProtocolError('INVALID_INPUT', 'source profile activation_excluded_paths must be a list of at most 128 strings');
  const profile: ProjectSourceProfileInput = {source_id: sourceId, root: sourceRoot, formal_prefix: formalPrefix, read_enabled: readEnabled, write_enabled: writeEnabled, activation_excluded_paths: activationExcludedPaths, host_retrieval: hostRetrieval, user_id: profileUserId, scope_type: scope, source_mode: mode};
  return {profile, sourceRoot, scope};
}

/** Create the project-local Trace boundary. This is create-only and never overwrites .trace. */
export function initializeProject(input: ProjectInitInput): ProjectInitResult {
  const projectDir = absolute(input.project_dir, 'project_dir');
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new ProtocolError('INVALID_INPUT', `project_dir must exist and be a directory: ${projectDir}`);
  const userId = text(input.user_id, 'user_id', 240);
  if (!['local', 'external', 'team', 'empty'].includes(input.source_mode)) throw new ProtocolError('INVALID_INPUT', 'source_mode must be local, external, team, or empty');
  const runtimeVersion = text(input.runtime_version, 'runtime_version', 64);
  const instanceId = text(input.instance_id, 'instance_id', 200);
  const manifest = validateTemplateManifest(input.manifest);
  const traceDir = path.join(projectDir, '.trace');
  if (fs.existsSync(traceDir)) { const entries = fs.readdirSync(traceDir); if (entries.length > 0) throw new ProtocolError('INSTANCE_EXISTS', `project already has a non-empty .trace directory: ${traceDir}`); }
  const createdAt = input.created_at ?? new Date().toISOString();
  const staging = path.join(projectDir, `.trace-init-${process.pid}-${Date.now()}`);
  if (fs.existsSync(staging)) throw new ProtocolError('INSTANCE_EXISTS', `initialization staging path already exists: ${staging}`);
  const stagedTrace = path.join(staging, '.trace');
  try {
    ensureDirectory(stagedTrace);
    const selected = profileFor({...input, user_id: userId}, traceDir);
    if (manifest.cognitive_source !== undefined && !manifest.cognitive_source.allowed_scope_types.includes(selected.scope)) throw new ProtocolError('INVALID_INPUT', `source scope ${selected.scope} is not allowed by template ${manifest.bundle_id}`);
    const profileText = json(selected.profile);
    const profileHash = sha256(profileText);
    const lock = buildTemplateLock(manifest, runtimeVersion, instanceId, createdAt, {source_id: selected.profile.source_id, profile_hash: profileHash, scope_type: selected.scope});
    const collaborationModel = input.source_profile?.collaboration_model === undefined
      ? defaultCollaborationModel(manifest.bundle_id)
      : validateCollaborationModel(input.source_profile.collaboration_model);
    const sourceActivation = input.source_profile?.activation_manifest === undefined
      ? defaultSourceActivationManifest({source_id: selected.profile.source_id, source_mode: input.source_mode, template_id: manifest.bundle_id})
      : validateSourceActivationManifest(input.source_profile.activation_manifest);
    if (sourceActivation.source_id !== selected.profile.source_id) throw new ProtocolError('INVALID_INPUT', 'activation_manifest.source_id must match the selected source profile');
    assertActivationMapWithinSourcePolicy(sourceActivation, selected.profile);
    const activationLock = buildActivationLock({template_id: manifest.bundle_id, model: collaborationModel, source: sourceActivation, created_at: createdAt});
    const descriptor = validateProjectInstanceDescriptor({protocol_id: PROJECT_INSTANCE_PROTOCOL_ID, protocol_version: PROJECT_INSTANCE_PROTOCOL_VERSION, project_id: slug(path.basename(projectDir)), instance_id: instanceId, template_id: manifest.bundle_id, template_version: manifest.bundle_version, source_mode: input.source_mode, source_scope: selected.scope, state_file: '.trace/state/trace.sqlite', source_root: input.source_mode === 'local' || input.source_mode === 'empty' ? '.trace/source' : '.trace/profiles/source.profile.json', created_at: createdAt});
    writeNew(path.join(stagedTrace, 'project.json'), json(descriptor));
    writeNew(path.join(stagedTrace, 'instance', 'trace.lock.json'), json(lock));
    writeNew(path.join(stagedTrace, 'instance', 'template.manifest.json'), json(manifest));
    writeNew(path.join(stagedTrace, 'instance', 'activation.lock.json'), json(activationLock));
    writeNew(path.join(stagedTrace, 'profiles', 'source.profile.json'), profileText);
    writeNew(path.join(stagedTrace, 'profiles', 'collaboration-model.json'), json(collaborationModel));
    writeNew(path.join(stagedTrace, 'profiles', 'source-activation.json'), json(sourceActivation));
    writeNew(path.join(stagedTrace, '.gitignore'), ['# Trace project-local state (generated by `trace-runtime project init`)', 'state/', 'receipts/', 'backups/', 'candidates/', 'profiles/', '*.lock.tmp', ''].join('\n'));
    for (const directory of ['state', 'receipts', 'backups', 'candidates', 'source/wiki']) ensureDirectory(path.join(stagedTrace, directory));
    fs.renameSync(stagedTrace, traceDir);
    fs.rmSync(staging, {recursive: true, force: true});
    const finalProfile = {...selected.profile, root: selected.sourceRoot};
    const createdPaths = [path.join(traceDir, 'project.json'), path.join(traceDir, 'instance', 'trace.lock.json'), path.join(traceDir, 'instance', 'template.manifest.json'), path.join(traceDir, 'instance', 'activation.lock.json'), path.join(traceDir, 'profiles', 'source.profile.json'), path.join(traceDir, 'profiles', 'collaboration-model.json'), path.join(traceDir, 'profiles', 'source-activation.json'), path.join(traceDir, '.gitignore'), path.join(traceDir, 'state'), path.join(traceDir, 'receipts'), path.join(traceDir, 'backups'), path.join(traceDir, 'candidates'), path.join(traceDir, 'source', 'wiki')];
    return {project_dir: projectDir, trace_dir: traceDir, descriptor, lock, source_profile: finalProfile, collaboration_model: collaborationModel, source_activation: sourceActivation, activation_lock: activationLock, created_paths: createdPaths};
  } catch (error) { fs.rmSync(staging, {recursive: true, force: true}); throw error; }
}
