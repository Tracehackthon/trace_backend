/**
 * Product-facing application service shared by host adapters.
 *
 * It deliberately returns summaries and stable proposal receipts rather than
 * source bodies, prompts, credentials, or filesystem roots. CLI presentation
 * may migrate here incrementally; MCP and a future desktop host use this API
 * directly instead of spawning a CLI process.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ProtocolError} from '../../../core/protocol/src/index.js';
import {TraceRuntime} from '../../../core/runtime/src/index.js';
import {
  initializeProject,
  loadLockedProjectSourceProfile,
  loadProjectActivationConfiguration,
  migrateProjectActivationConfiguration,
  updateProjectActivationConfiguration,
  validateProjectInstanceDescriptor,
  type ProjectActivationConfigurationInput,
  type ProjectInstanceDescriptor,
  type ProjectSourceMode,
  type ProjectSourceProfileInput,
} from '../../../core/instance/src/index.js';
import {validateCollaborationModel, validateSourceActivationManifest} from '../../../core/collaboration-context/src/index.js';
import {SELECTABLE_TEMPLATES} from '../../../template/catalog/src/index.js';
import {validateTemplateManifest} from '../../../template/contract/src/index.js';
import {CodexHookInstaller, type CodexHookPreview} from '../../../host/codex-hooks/src/index.js';

export interface ProductProjectContext {
  project_dir: string;
  trace_dir: string;
  state_file: string;
  descriptor: ProjectInstanceDescriptor;
  source_profile: ProjectSourceProfileInput;
}

export interface ProductProposal<T extends string = string> {
  proposal_id: string;
  operation: T;
  state_fingerprint: string;
  requires_user_adoption: true;
  summary: Record<string, unknown>;
}

export interface ProjectInitializeInput {
  project_dir?: string;
  template_id?: string;
  source_mode?: ProjectSourceMode;
  source_profile?: ProjectSourceProfileInput;
  user_id?: string;
}

export interface ProfileUpdateInput {
  project_dir?: string;
  configuration: ProjectActivationConfigurationInput;
}

export interface CodexHookInput {project_dir?: string; hooks_file?: string;}

type JsonRecord = Record<string, unknown>;

function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function safeJson(value: unknown): string { return JSON.stringify(sortValue(value)); }
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as JsonRecord).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortValue(child)]));
  return value;
}
function proposalId(operation: string, state: unknown): string { return `trace-proposal:${operation}:${sha256(safeJson(state)).slice(0, 24)}`; }
function fileHash(file: string): string | null { return fs.existsSync(file) ? sha256(fs.readFileSync(file, 'utf8')) : null; }
function readObject(file: string, label: string): JsonRecord {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value as JsonRecord;
  } catch { throw new ProtocolError('PROJECT_INVALID', `${label} is invalid: ${file}`); }
}
function absoluteDirectory(value: string | undefined, label: string): string {
  const result = path.resolve(value ?? process.cwd());
  if (!fs.existsSync(result) || !fs.statSync(result).isDirectory()) throw new ProtocolError('INVALID_INPUT', `${label} must be an existing directory`);
  return result;
}
function redactedPath(root: string, target: string): string {
  const relative = path.relative(root, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.replaceAll(path.sep, '/') : '<outside-project>';
}
function runtimeRoot(): string {
  const candidates = [process.env.TRACE_RUNTIME_ROOT, process.cwd(), path.dirname(fileURLToPath(import.meta.url))]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  for (const initial of candidates) {
    let cursor = path.resolve(initial);
    for (let steps = 0; steps < 10; steps += 1) {
      if (fs.existsSync(path.join(cursor, 'package.json')) && fs.existsSync(path.join(cursor, 'templates'))) return cursor;
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  throw new ProtocolError('IO_ERROR', 'Trace runtime root could not be located');
}
function runtimeVersion(): string {
  const root = runtimeRoot();
  const runtimeFile = path.join(root, 'runtime.json');
  if (fs.existsSync(runtimeFile)) {
    const value = readObject(runtimeFile, 'runtime.json');
    if (typeof value.runtime_version === 'string' && value.runtime_version.length > 0) return value.runtime_version;
  }
  const packageInfo = readObject(path.join(root, 'package.json'), 'package.json');
  if (typeof packageInfo.version !== 'string' || packageInfo.version.length === 0) throw new ProtocolError('IO_ERROR', 'Trace runtime version is unavailable');
  return packageInfo.version;
}
function defaultUserId(): string {
  const raw = process.env.TRACE_USER_ID ?? process.env.USERNAME ?? process.env.USER ?? 'local-user';
  const normalized = raw.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return `local-${normalized || 'user'}`;
}
function defaultInstanceId(projectDir: string): string {
  const normalized = path.basename(projectDir).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `trace-${normalized || 'project'}`;
}

/** Locate one existing Trace project without treating an arbitrary file as state. */
export function findTraceProject(directory?: string): ProductProjectContext | undefined {
  let cursor = absoluteDirectory(directory, 'project_dir');
  while (true) {
    const traceDir = path.join(cursor, '.trace');
    const descriptorFile = path.join(traceDir, 'project.json');
    if (fs.existsSync(descriptorFile)) {
      const descriptor = validateProjectInstanceDescriptor(readObject(descriptorFile, 'Trace project descriptor'));
      const sourceProfile = loadLockedProjectSourceProfile({trace_dir: traceDir, source_mode: descriptor.source_mode, source_scope: descriptor.source_scope});
      return {project_dir: cursor, trace_dir: traceDir, state_file: path.join(cursor, descriptor.state_file), descriptor, source_profile: sourceProfile};
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return undefined;
    cursor = parent;
  }
}

export function requireTraceProject(directory?: string): ProductProjectContext {
  const project = findTraceProject(directory);
  if (!project) throw new ProtocolError('PROJECT_NOT_INITIALIZED', 'No Trace project was found. Start with Trace setup in this project first.');
  return project;
}

function activationFor(context: ProductProjectContext) {
  return loadProjectActivationConfiguration({trace_dir: context.trace_dir, template_id: context.descriptor.template_id, source_mode: context.descriptor.source_mode, source_scope: context.descriptor.source_scope});
}
function withRuntime<T>(context: ProductProjectContext, fallback: T, callback: (runtime: TraceRuntime) => T): T {
  if (!fs.existsSync(context.state_file)) return fallback;
  const runtime = new TraceRuntime({sqliteStateFile: context.state_file});
  try { return callback(runtime); } finally { runtime.close(); }
}
function configurationSummary(context: ProductProjectContext) {
  const activation = activationFor(context);
  return {
    state: activation.configuration_state,
    collaboration_model: {
      id: activation.collaboration_model.model_id,
      version: activation.collaboration_model.version,
      name: activation.collaboration_model.display_name,
    },
    source_activation: {
      id: activation.source_activation.manifest_id,
      version: activation.source_activation.version,
      name: activation.source_activation.display_name,
      entry_point_count: activation.source_activation.entry_points.length,
    },
  };
}
function installationView(context: ProductProjectContext) {
  const lockFile = path.join(context.trace_dir, 'instance', 'trace.lock.json');
  const current = runtimeVersion();
  const initialized = fs.existsSync(lockFile) ? readObject(lockFile, 'Trace instance lock').runtime_version : null;
  const initializedVersion = typeof initialized === 'string' ? initialized : null;
  return {
    state: initializedVersion === null ? 'installation_lock_unavailable' : initializedVersion === current ? 'matching' : 'runtime_changed',
    current_runtime_version: current,
    initialized_runtime_version: initializedVersion,
    project_template_version: context.descriptor.template_version,
  };
}

/** Product-safe status: counts and identities, never source bodies or prompt text. */
export function inspectProject(directory?: string): JsonRecord {
  const context = requireTraceProject(directory);
  const records = withRuntime(context, {data: [], continuity: []} as {data: ReturnType<TraceRuntime['listData']>; continuity: ReturnType<TraceRuntime['listContinuity']>}, runtime => ({data: runtime.listData(), continuity: runtime.listContinuity()}));
  const candidates = records.data.filter(record => record.status === 'candidate');
  const hostEvidence = records.data.filter(record => record.kind === 'host_retrieval_evidence');
  return {
    project: {
      directory: context.project_dir,
      template_id: context.descriptor.template_id,
      template_version: context.descriptor.template_version,
      source_mode: context.descriptor.source_mode,
      source_scope: context.descriptor.source_scope,
      initialized_at: context.descriptor.created_at,
    },
    configuration: configurationSummary(context),
    installation: installationView(context),
    state: {
      persisted: fs.existsSync(context.state_file),
      pending_review_count: candidates.length,
      continuity_record_count: records.continuity.length,
      host_retrieval_evidence_count: hostEvidence.length,
    },
  };
}

export function inspectSource(directory?: string): JsonRecord {
  const context = requireTraceProject(directory);
  const activation = activationFor(context);
  return {
    source: {
      id: context.source_profile.source_id,
      mode: context.descriptor.source_mode,
      scope: context.descriptor.source_scope,
      read_enabled: context.source_profile.read_enabled !== false,
      write_enabled: context.source_profile.write_enabled === true,
      host_retrieval_mode: context.source_profile.host_retrieval?.mode ?? 'native_observed',
      allowed_prefixes: context.source_profile.host_retrieval?.allowed_prefixes ?? [context.source_profile.formal_prefix ?? 'wiki'],
      root_visibility: 'private-not-returned',
    },
    activation: {
      id: activation.source_activation.manifest_id,
      version: activation.source_activation.version,
      entry_points: activation.source_activation.entry_points.map(entry => ({id: entry.id, label: entry.label, kind: entry.kind, locator: entry.locator ?? null})),
    },
  };
}

export function listInbox(directory?: string): JsonRecord {
  const context = requireTraceProject(directory);
  const items = withRuntime(context, [] as JsonRecord[], runtime => runtime.listData()
    .filter(record => record.status === 'candidate' && ['prompt_capture_proposal', 'candidate_precedent', 'capability_candidate'].includes(record.kind))
    .map(record => {
      const payload = record.payload as JsonRecord;
      const title = typeof payload.intent_summary === 'string' ? payload.intent_summary
        : typeof payload.claim === 'string' ? payload.claim
          : typeof payload.title === 'string' ? payload.title : record.subject.id;
      return {id: record.record_id, kind: record.kind, title, created_at: record.created_at, status: 'pending_user_review'};
    }));
  return {pending_count: items.length, items};
}

/** Candidate abilities are visible, but this read model never calls them published. */
export function listAbilities(directory?: string): JsonRecord {
  const context = requireTraceProject(directory);
  const abilities = withRuntime(context, [] as JsonRecord[], runtime => runtime.listData()
    .filter(record => record.kind === 'capability_candidate')
    .map(record => {
      const payload = record.payload as JsonRecord;
      return {
        id: record.record_id,
        title: typeof payload.title === 'string' ? payload.title : record.subject.id,
        status: record.status,
        created_at: record.created_at,
        lifecycle: 'candidate_not_published',
      };
    }));
  return {candidate_count: abilities.length, abilities};
}

export function inspectUpgrade(directory?: string): JsonRecord {
  const context = requireTraceProject(directory);
  return {
    project: {directory: context.project_dir, template_id: context.descriptor.template_id},
    installation: installationView(context),
    policy: {
      automatic_project_rewrite: false,
      old_project_behavior: 'continue_with_locked_or_legacy_compatibility_configuration',
      action_required: 'inspect_then_explicitly_adopt_each_migration_or_profile_change',
    },
  };
}

function templateManifest(templateId: string) {
  const entry = SELECTABLE_TEMPLATES.find(item => item.id === templateId);
  if (!entry) throw new ProtocolError('INVALID_INPUT', `Unknown Trace template: ${templateId}`);
  const file = path.join(runtimeRoot(), entry.manifest_path);
  return validateTemplateManifest(readObject(file, 'Trace template manifest'));
}
function initState(input: ProjectInitializeInput) {
  const projectDir = absoluteDirectory(input.project_dir, 'project_dir');
  const templateId = input.template_id ?? 'trace.codex-starter';
  const sourceMode = input.source_mode ?? 'local';
  if (!['local', 'external', 'team', 'empty'].includes(sourceMode)) throw new ProtocolError('INVALID_INPUT', 'source_mode is invalid');
  if ((sourceMode === 'external' || sourceMode === 'team') && input.source_profile === undefined) throw new ProtocolError('SOURCE_SELECTION_REQUIRED', `${sourceMode} source mode requires an explicit source profile`);
  const traceDir = path.join(projectDir, '.trace');
  const traceExists = fs.existsSync(traceDir) && fs.readdirSync(traceDir).length > 0;
  return {project_dir: projectDir, template_id: templateId, source_mode: sourceMode as ProjectSourceMode, source_profile: input.source_profile, user_id: input.user_id ?? defaultUserId(), runtime_version: runtimeVersion(), trace_exists: traceExists};
}

export function proposeProjectInitialize(input: ProjectInitializeInput = {}): ProductProposal<'project_initialize'> {
  const state = initState(input);
  if (state.trace_exists) throw new ProtocolError('INSTANCE_EXISTS', 'This project already has Trace state; initialization never overwrites it.');
  templateManifest(state.template_id);
  const fingerprint = sha256(safeJson(state));
  return {
    proposal_id: proposalId('project_initialize', state), operation: 'project_initialize', state_fingerprint: fingerprint, requires_user_adoption: true,
    summary: {
      project_directory: state.project_dir, template_id: state.template_id, source_mode: state.source_mode,
      will_create: ['.trace/project.json', '.trace/profiles/', '.trace/instance/', '.trace/state/trace.sqlite'],
      will_not_do: ['read external source bodies', 'install global hooks', 'replace existing Trace state'],
    },
  };
}

function assertAdopted(proposal: ProductProposal, approval: string): void {
  if (approval !== `adopt:${proposal.proposal_id}`) throw new ProtocolError('USER_CONFIRMATION_REQUIRED', `approval must equal adopt:${proposal.proposal_id}`);
}

export function applyProjectInitialize(input: ProjectInitializeInput & {proposal_id: string; approval: string}): JsonRecord {
  const proposal = proposeProjectInitialize(input);
  if (proposal.proposal_id !== input.proposal_id) throw new ProtocolError('STALE_PROPOSAL', 'Project initialization proposal is stale; inspect the new proposal before adopting it.');
  assertAdopted(proposal, input.approval);
  const state = initState(input);
  const result = initializeProject({
    project_dir: state.project_dir, manifest: templateManifest(state.template_id), runtime_version: state.runtime_version,
    instance_id: defaultInstanceId(state.project_dir), user_id: state.user_id, source_mode: state.source_mode,
    ...(state.source_profile === undefined ? {} : {source_profile: state.source_profile}),
  });
  // Match the product CLI guarantee: a fresh project is doctor/backup-ready
  // before any hook event or MCP read asks the runtime to create state lazily.
  const initialRuntime = new TraceRuntime({sqliteStateFile: path.join(result.project_dir, result.descriptor.state_file)});
  initialRuntime.close();
  return {
    status: 'initialized', proposal_id: proposal.proposal_id,
    project: {directory: result.project_dir, template_id: result.descriptor.template_id, source_mode: result.descriptor.source_mode},
    configuration: {state: 'locked', collaboration_model: result.collaboration_model.display_name, source_activation: result.source_activation.display_name},
    receipt: {created_paths: result.created_paths.map(item => redactedPath(result.project_dir, item)), source_bodies_persisted: false},
  };
}

function legacyMigrationState(directory?: string) {
  const context = requireTraceProject(directory);
  const configuration = activationFor(context);
  return {
    project_dir: context.project_dir,
    descriptor_hash: fileHash(path.join(context.trace_dir, 'project.json')),
    source_profile_hash: fileHash(path.join(context.trace_dir, 'profiles', 'source.profile.json')),
    collaboration_model: {id: configuration.collaboration_model.model_id, version: configuration.collaboration_model.version},
    source_activation: {id: configuration.source_activation.manifest_id, version: configuration.source_activation.version},
    configuration_state: configuration.configuration_state,
  };
}

export function proposeProfileMigration(directory?: string): ProductProposal<'profile_migrate'> {
  const state = legacyMigrationState(directory);
  return {
    proposal_id: proposalId('profile_migrate', state), operation: 'profile_migrate', state_fingerprint: sha256(safeJson(state)), requires_user_adoption: true,
    summary: {
      project_directory: state.project_dir,
      current_configuration_state: state.configuration_state,
      will_do: state.configuration_state === 'legacy_unlocked'
        ? ['materialize the compatibility collaboration model', 'materialize the compatibility source map', 'write a hash-only activation lock and backup prior profile files']
        : ['no configuration rewrite; the project is already locked'],
      will_not_do: ['change selected source', 'read source bodies', 'rewrite SQLite state', 'change capabilities', 'install or replace Codex hooks'],
    },
  };
}

export function applyProfileMigration(input: {project_dir?: string; proposal_id: string; approval: string}): JsonRecord {
  const proposal = proposeProfileMigration(input.project_dir);
  if (proposal.proposal_id !== input.proposal_id) throw new ProtocolError('STALE_PROPOSAL', 'Profile migration proposal is stale; inspect the new proposal before adopting it.');
  assertAdopted(proposal, input.approval);
  const context = requireTraceProject(input.project_dir);
  const migrated = migrateProjectActivationConfiguration({trace_dir: context.trace_dir, template_id: context.descriptor.template_id, source_mode: context.descriptor.source_mode, source_scope: context.descriptor.source_scope});
  return {
    status: migrated.migrated ? 'migrated' : 'already_locked', proposal_id: proposal.proposal_id,
    configuration: {state: 'locked', collaboration_model: migrated.collaboration_model.display_name, source_activation: migrated.source_activation.display_name},
    receipt: {backup_created: migrated.backup_dir !== undefined, source_changed: false, state_database_changed: false, hooks_changed: false},
  };
}

function validatedProfileUpdate(directory: string | undefined, configuration: ProjectActivationConfigurationInput) {
  const context = requireTraceProject(directory);
  const collaboration = validateCollaborationModel(configuration.collaboration_model);
  const source = validateSourceActivationManifest(configuration.source_activation);
  if (source.source_id !== context.source_profile.source_id) throw new ProtocolError('INVALID_INPUT', 'source_activation source_id must match the current source selection');
  return {context, configuration: {collaboration_model: collaboration, source_activation: source} satisfies ProjectActivationConfigurationInput};
}

export function proposeProfileUpdate(input: ProfileUpdateInput): ProductProposal<'profile_update'> {
  const selected = validatedProfileUpdate(input.project_dir, input.configuration);
  const current = activationFor(selected.context);
  const state = {
    project_dir: selected.context.project_dir,
    current_lock_hash: fileHash(path.join(selected.context.trace_dir, 'instance', 'activation.lock.json')),
    next_configuration: selected.configuration,
  };
  return {
    proposal_id: proposalId('profile_update', state), operation: 'profile_update', state_fingerprint: sha256(safeJson(state)), requires_user_adoption: true,
    summary: {
      project_directory: selected.context.project_dir,
      from: {collaboration_model: `${current.collaboration_model.display_name}@${current.collaboration_model.version}`, source_activation: `${current.source_activation.display_name}@${current.source_activation.version}`},
      to: {collaboration_model: `${selected.configuration.collaboration_model.display_name}@${selected.configuration.collaboration_model.version}`, source_activation: `${selected.configuration.source_activation.display_name}@${selected.configuration.source_activation.version}`, entry_point_count: selected.configuration.source_activation.entry_points.length},
      will_do: ['replace this project’s private collaboration model and source activation map', 'write a new hash-only activation lock', 'create a rollback backup'],
      will_not_do: ['read source bodies', 'rewrite SQLite history', 'install or change Codex hooks'],
    },
  };
}

export function applyProfileUpdate(input: ProfileUpdateInput & {proposal_id: string; approval: string}): JsonRecord {
  const proposal = proposeProfileUpdate(input);
  if (proposal.proposal_id !== input.proposal_id) throw new ProtocolError('STALE_PROPOSAL', 'Profile update proposal is stale; inspect the new proposal before adopting it.');
  assertAdopted(proposal, input.approval);
  const selected = validatedProfileUpdate(input.project_dir, input.configuration);
  const updated = updateProjectActivationConfiguration({trace_dir: selected.context.trace_dir, template_id: selected.context.descriptor.template_id, source_mode: selected.context.descriptor.source_mode, source_scope: selected.context.descriptor.source_scope, configuration: selected.configuration});
  return {
    status: 'updated', proposal_id: proposal.proposal_id,
    configuration: {state: 'locked', collaboration_model: updated.collaboration_model.display_name, source_activation: updated.source_activation.display_name},
    receipt: {backup_created: true, source_bodies_read: false, state_database_changed: false, hooks_changed: false},
  };
}

function hookCommand(): string {
  const root = runtimeRoot();
  const entry = path.join(root, 'dist', 'apps', 'cli', 'src', 'main.js');
  if (!fs.existsSync(entry)) throw new ProtocolError('IO_ERROR', 'The installed Trace CLI entrypoint is unavailable; build or install Trace before enabling Codex hooks.');
  const quote = (value: string) => `"${value.replaceAll('"', '\\"')}"`;
  return `${quote(process.execPath)} ${quote(entry)} internal codex hook-stdio --route-from-event-cwd`;
}
function hookState(input: CodexHookInput) {
  const context = requireTraceProject(input.project_dir);
  const installer = new CodexHookInstaller(input.hooks_file);
  const preview = installer.preview({command: hookCommand()});
  return {context, installer, preview};
}
function hookProposal(input: CodexHookInput): ProductProposal<'codex_hook_enable'> {
  const state = hookState(input);
  const fingerprint = {project_dir: state.context.project_dir, hooks_file: state.preview.hooks_file, before_hash: state.preview.before_hash, after_hash: state.preview.after_hash, command: hookCommand()};
  return {
    proposal_id: proposalId('codex_hook_enable', fingerprint), operation: 'codex_hook_enable', state_fingerprint: sha256(safeJson(fingerprint)), requires_user_adoption: true,
    summary: {
      scope: 'Codex user-level hooks configuration, routed per event to the nearest Trace project',
      target_project: state.context.project_dir,
      managed_events: state.preview.managed_events,
      unrelated_hooks_preserved: state.preview.unrelated_hooks_preserved,
      legacy_hook_commands_detected: state.preview.legacy_commands.length,
      will_do: ['back up the existing Codex hook configuration', 'install Trace-managed hooks that route by event cwd'],
      will_not_do: ['bind all future Codex sessions to this project', 'read prompt bodies into Trace state', 'replace unrelated hooks'],
    },
  };
}
export function proposeCodexHookEnable(input: CodexHookInput = {}): ProductProposal<'codex_hook_enable'> { return hookProposal(input); }
export function applyCodexHookEnable(input: CodexHookInput & {proposal_id: string; approval: string}): JsonRecord {
  const proposal = hookProposal(input);
  if (proposal.proposal_id !== input.proposal_id) throw new ProtocolError('STALE_PROPOSAL', 'Codex hook proposal is stale; inspect the new proposal before adopting it.');
  assertAdopted(proposal, input.approval);
  const state = hookState(input);
  const receipt = state.installer.install({command: hookCommand(), backup_root: path.join(state.context.trace_dir, 'backups', 'codex-hooks'), approval: 'approve:codex-hooks'});
  return {
    status: 'enabled', proposal_id: proposal.proposal_id,
    receipt: {managed_events: receipt.managed_events, backup_created: receipt.backup_file !== null, routed_by_event_cwd: true, prompt_bodies_persisted: false},
  };
}

export function inspectCodexHook(input: CodexHookInput = {}): JsonRecord {
  const preview = hookState(input).preview;
  return {managed_events: preview.managed_events, is_up_to_date: preview.before_hash === preview.after_hash, unrelated_hooks_preserved: preview.unrelated_hooks_preserved, legacy_hook_commands_detected: preview.legacy_commands.length};
}
