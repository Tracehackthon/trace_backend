import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ProtocolError} from '../../protocol/src/index.js';
import {buildTemplateLock, validateTemplateManifest, type TemplateBundleManifest, type TemplateInstanceLock} from '../../../template/contract/src/index.js';

export const PROJECT_INSTANCE_PROTOCOL_ID = 'trace.project-instance' as const;
export const PROJECT_INSTANCE_PROTOCOL_VERSION = '0.1.0' as const;
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
  created_paths: string[];
}

function text(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) throw new ProtocolError('INVALID_INPUT', `${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function absolute(value: unknown, field: string): string {
  const resolved = path.resolve(text(value, field, 4000));
  if (!path.isAbsolute(resolved)) throw new ProtocolError('INVALID_INPUT', `${field} must be absolute`);
  return resolved;
}
function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
function ensureDirectory(dir: string): void { fs.mkdirSync(dir, {recursive: true}); }
function writeNew(file: string, content: string): void { ensureDirectory(path.dirname(file)); fs.writeFileSync(file, content, {encoding: 'utf8', flag: 'wx'}); }
function slug(value: string): string { const candidate = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); return candidate || 'project'; }
function scopeFor(mode: ProjectSourceMode): ProjectScopeType { if (mode === 'external') return 'personal'; if (mode === 'team') return 'team'; return 'project'; }

function profileFor(input: ProjectInitInput, traceDir: string): {profile: ProjectSourceProfileInput; sourceRoot: string; scope: ProjectScopeType} {
  const mode = input.source_mode;
  const scope = scopeFor(mode);
  if (mode === 'local' || mode === 'empty') {
    if (input.source_root !== undefined || input.source_id !== undefined || input.source_profile !== undefined) throw new ProtocolError('INVALID_INPUT', `source options are not accepted for ${mode} mode`);
    const sourceRoot = path.join(traceDir, 'source');
    return {scope, sourceRoot, profile: {source_id: mode === 'empty' ? 'isolated-empty-source' : 'project-cognitive-source', root: sourceRoot, formal_prefix: 'wiki', read_enabled: mode !== 'empty', write_enabled: false, user_id: input.user_id, scope_type: scope, source_mode: mode}};
  }
  if (input.source_profile === undefined && input.source_root === undefined) throw new ProtocolError('SOURCE_SELECTION_REQUIRED', `${mode} mode requires --source-profile or --source-root`);
  const supplied = input.source_profile;
  const sourceRoot = absolute(supplied?.root ?? input.source_root, 'source_root');
  const sourceId = text(supplied?.source_id ?? input.source_id, 'source_id', 240);
  if (input.source_id !== undefined && input.source_id !== sourceId) throw new ProtocolError('INVALID_INPUT', '--source-id does not match source profile');
  const profile: ProjectSourceProfileInput = {source_id: sourceId, root: sourceRoot, formal_prefix: supplied?.formal_prefix ?? 'wiki', read_enabled: supplied?.read_enabled ?? true, write_enabled: supplied?.write_enabled ?? false, user_id: supplied?.user_id ?? input.user_id, scope_type: scope, source_mode: mode};
  return {profile, sourceRoot, scope};
}

/** Create the project-local Trace boundary. This is create-only and never overwrites .trace. */
export function initializeProject(input: ProjectInitInput): ProjectInitResult {
  const projectDir = absolute(input.project_dir, 'project_dir');
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new ProtocolError('INVALID_INPUT', `project_dir must exist and be a directory: ${projectDir}`);
  const userId = text(input.user_id, 'user_id', 240);
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
    const descriptor: ProjectInstanceDescriptor = {protocol_id: PROJECT_INSTANCE_PROTOCOL_ID, protocol_version: PROJECT_INSTANCE_PROTOCOL_VERSION, project_id: slug(path.basename(projectDir)), instance_id: instanceId, template_id: manifest.bundle_id, template_version: manifest.bundle_version, source_mode: input.source_mode, source_scope: selected.scope, state_file: '.trace/state/trace.sqlite', source_root: input.source_mode === 'local' || input.source_mode === 'empty' ? '.trace/source' : '.trace/profiles/source.profile.json', created_at: createdAt};
    writeNew(path.join(stagedTrace, 'project.json'), json(descriptor));
    writeNew(path.join(stagedTrace, 'instance', 'trace.lock.json'), json(lock));
    writeNew(path.join(stagedTrace, 'instance', 'template.manifest.json'), json(manifest));
    writeNew(path.join(stagedTrace, 'profiles', 'source.profile.json'), profileText);
    writeNew(path.join(stagedTrace, '.gitignore'), ['# Trace project-local state (generated by `trace-runtime project init`)', 'state/', 'receipts/', 'backups/', 'candidates/', 'profiles/', '*.lock.tmp', ''].join('\n'));
    for (const directory of ['state', 'receipts', 'backups', 'candidates', 'source/wiki']) ensureDirectory(path.join(stagedTrace, directory));
    fs.renameSync(stagedTrace, traceDir);
    fs.rmSync(staging, {recursive: true, force: true});
    const finalProfile = {...selected.profile, root: selected.sourceRoot};
    const createdPaths = [path.join(traceDir, 'project.json'), path.join(traceDir, 'instance', 'trace.lock.json'), path.join(traceDir, 'instance', 'template.manifest.json'), path.join(traceDir, 'profiles', 'source.profile.json'), path.join(traceDir, '.gitignore'), path.join(traceDir, 'state'), path.join(traceDir, 'receipts'), path.join(traceDir, 'backups'), path.join(traceDir, 'candidates'), path.join(traceDir, 'source', 'wiki')];
    return {project_dir: projectDir, trace_dir: traceDir, descriptor, lock, source_profile: finalProfile, created_paths: createdPaths};
  } catch (error) { fs.rmSync(staging, {recursive: true, force: true}); throw error; }
}





