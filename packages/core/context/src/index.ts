import {createHash} from 'node:crypto';
import {ProtocolError, ProtocolVersionRegistry, rejectUnknown, requireObject as object, requireText as text, type ProtocolVersioned} from '../../protocol/src/index.js';

export const CONTEXT_PROTOCOL_ID = 'trace.context-record' as const;
export const CONTEXT_PROTOCOL_VERSION = '0.2.0' as const;
export const CONTEXT_SKILL_PROTOCOL_ID = 'trace.context-skill-package' as const;
export const CONTEXT_SKILL_PROTOCOL_VERSION = '0.1.0' as const;
export const CONTEXT_SKILL_NAME = 'trace-project-context' as const;
export const CONTEXT_SKILL_DESCRIPTION = 'Apply the user-confirmed Trace context package for the current project when collaboration or cognitive-source boundaries matter.' as const;
export const CONTEXT_SKILL_BOUNDARIES = [
  'current-codex-task-and-project-only',
  'source-map-is-navigation-not-read-evidence',
  'no-raw-source-bodies-or-absolute-source-roots',
  'no-raw-prompts-credentials-or-tool-arguments',
  'no-automatic-global-skill-install-or-profile-update',
] as const;

export interface ContextSourceRef {
  record_id: string;
  revision: number;
  label: string;
  locator?: string;
  excerpt?: string;
}

export interface ContextReadPointer {
  path: string;
  purpose: string;
  priority: 'must' | 'should' | 'optional';
  stop_condition: string;
}

export interface ActivationPack {
  protocol_id: typeof CONTEXT_PROTOCOL_ID;
  protocol_version: typeof CONTEXT_PROTOCOL_VERSION;
  pack_id: string;
  thread_id?: string;
  purpose: string;
  summary: string;
  source_refs: ContextSourceRef[];
  read_pointers: ContextReadPointer[];
  budget: {max_tokens: number; max_sources: number};
  forbidden_scopes: string[];
  required_user_action?: string;
  generated_at: string;
}

export interface BuildActivationPackInput {
  pack_id?: string;
  thread_id?: string;
  purpose: string;
  summary: string;
  source_refs: ContextSourceRef[];
  read_pointers?: ContextReadPointer[];
  budget?: {max_tokens?: number; max_sources?: number};
  forbidden_scopes?: string[];
  required_user_action?: string;
}

export interface ContextSkillPackage {
  protocol_id: typeof CONTEXT_SKILL_PROTOCOL_ID;
  protocol_version: typeof CONTEXT_SKILL_PROTOCOL_VERSION;
  package_id: string;
  artifact_kind: 'context-pack';
  host: 'codex';
  session_binding: {session_id: string};
  scope: {type: 'project'; project_id: string; project_label: string};
  skill: {
    format: 'codex-skill';
    entry: 'SKILL.md';
    name: typeof CONTEXT_SKILL_NAME;
    description: typeof CONTEXT_SKILL_DESCRIPTION;
    instructions: string;
    instructions_sha256: string;
    skill_md: string;
    sha256: string;
  };
  provenance: {
    activation_lock: {lock_id: string; version: '0.1.0'};
    collaboration_model: {model_id: string; version: string; sha256: string};
    source_activation: {manifest_id: string; version: string; source_id: string; sha256: string; entry_point_count: number; available: boolean};
  };
  boundaries: Array<(typeof CONTEXT_SKILL_BOUNDARIES)[number]>;
  content_sha256: string;
  generated_at: string;
}

export interface BuildContextSkillPackageInput {
  host_session_id: string;
  project: {project_id: string; project_label: string};
  instructions: string;
  activation_lock: {lock_id: string; version: '0.1.0'};
  collaboration_model: {model_id: string; version: string; sha256: string};
  source_activation: {manifest_id: string; version: string; source_id: string; sha256: string; entry_point_count: number; available: boolean};
  generated_at?: string;
}

type AnyContextProtocol = ProtocolVersioned & Record<string, unknown>;
const contextUpcasters = new ProtocolVersionRegistry<AnyContextProtocol>();
contextUpcasters.register({
  protocol_id: CONTEXT_PROTOCOL_ID,
  from_version: '0.1.0',
  to_version: CONTEXT_PROTOCOL_VERSION,
  // v0.2 retains the bounded pointer-only payload. The explicit step means
  // future context changes cannot silently reinterpret a v0.1 pack.
  upcast(value) { return {...value, protocol_version: CONTEXT_PROTOCOL_VERSION}; },
});

function refs(value: unknown): ContextSourceRef[] {
  if (!Array.isArray(value) || value.length > 128) throw new ProtocolError('INVALID_FIELD', 'source_refs must contain at most 128 references');
  return value.map((raw, index) => {
    const item = object(raw, `source_refs[${index}]`);
    rejectUnknown(item, ['record_id', 'revision', 'label', 'locator', 'excerpt'], `source_refs[${index}]`);
    if (!Number.isInteger(item.revision) || Number(item.revision) < 1) throw new ProtocolError('INVALID_FIELD', `source_refs[${index}].revision must be positive`);
    return {
      record_id: text(item.record_id, `source_refs[${index}].record_id`, 240),
      revision: Number(item.revision),
      label: text(item.label, `source_refs[${index}].label`, 300),
      ...(item.locator === undefined ? {} : {locator: text(item.locator, `source_refs[${index}].locator`, 2000)}),
      ...(item.excerpt === undefined ? {} : {excerpt: text(item.excerpt, `source_refs[${index}].excerpt`, 4000)}),
    };
  });
}

export function validateActivationPack(value: unknown): ActivationPack {
  const raw = object(value, 'activation_pack');
  if (raw.protocol_id !== CONTEXT_PROTOCOL_ID) throw new ProtocolError('PROTOCOL_MISMATCH', 'Unsupported context protocol');
  const item = raw.protocol_version === '0.1.0'
    ? contextUpcasters.upgrade(raw as AnyContextProtocol, CONTEXT_PROTOCOL_VERSION) as Record<string, unknown>
    : raw;
  rejectUnknown(item, ['protocol_id', 'protocol_version', 'pack_id', 'thread_id', 'purpose', 'summary', 'source_refs', 'read_pointers', 'budget', 'forbidden_scopes', 'required_user_action', 'generated_at'], 'activation_pack');
  if (item.protocol_version !== CONTEXT_PROTOCOL_VERSION) throw new ProtocolError('PROTOCOL_MIGRATION_REQUIRED', `Unsupported context protocol version: ${String(item.protocol_version)}`);
  const budget = object(item.budget, 'budget');
  rejectUnknown(budget, ['max_tokens', 'max_sources'], 'budget');
  if (!Number.isInteger(budget.max_tokens) || Number(budget.max_tokens) < 1 || Number(budget.max_tokens) > 200_000) throw new ProtocolError('INVALID_FIELD', 'budget.max_tokens must be between 1 and 200000');
  if (!Number.isInteger(budget.max_sources) || Number(budget.max_sources) < 1 || Number(budget.max_sources) > 128) throw new ProtocolError('INVALID_FIELD', 'budget.max_sources must be between 1 and 128');
  const pointers = item.read_pointers;
  if (!Array.isArray(pointers) || pointers.length > 128) throw new ProtocolError('INVALID_FIELD', 'read_pointers must contain at most 128 items');
  const readPointers = pointers.map((raw, index) => {
    const pointer = object(raw, `read_pointers[${index}]`);
    rejectUnknown(pointer, ['path', 'purpose', 'priority', 'stop_condition'], `read_pointers[${index}]`);
    if (pointer.priority !== 'must' && pointer.priority !== 'should' && pointer.priority !== 'optional') throw new ProtocolError('INVALID_FIELD', `read_pointers[${index}].priority is invalid`);
    return {path: text(pointer.path, `read_pointers[${index}].path`, 2000), purpose: text(pointer.purpose, `read_pointers[${index}].purpose`), priority: pointer.priority as ContextReadPointer['priority'], stop_condition: text(pointer.stop_condition, `read_pointers[${index}].stop_condition`, 1000)};
  });
  if (!Array.isArray(item.forbidden_scopes) || item.forbidden_scopes.some(scope => typeof scope !== 'string')) throw new ProtocolError('INVALID_FIELD', 'forbidden_scopes must be a list of strings');
  return {
    protocol_id: CONTEXT_PROTOCOL_ID,
    protocol_version: CONTEXT_PROTOCOL_VERSION,
    pack_id: text(item.pack_id, 'pack_id', 240),
    ...(item.thread_id === undefined ? {} : {thread_id: text(item.thread_id, 'thread_id', 240)}),
    purpose: text(item.purpose, 'purpose'),
    summary: text(item.summary, 'summary', 6000),
    source_refs: refs(item.source_refs),
    read_pointers: readPointers,
    budget: {max_tokens: Number(budget.max_tokens), max_sources: Number(budget.max_sources)},
    forbidden_scopes: (item.forbidden_scopes as string[]).map(scope => text(scope, 'forbidden_scope', 500)),
    ...(item.required_user_action === undefined ? {} : {required_user_action: text(item.required_user_action, 'required_user_action', 1000)}),
    generated_at: text(item.generated_at, 'generated_at', 80),
  };
}

export function buildActivationPack(input: BuildActivationPackInput): ActivationPack {
  const sourceRefs = refs(input.source_refs);
  if (sourceRefs.length > (input.budget?.max_sources ?? 16)) throw new ProtocolError('CONTEXT_LIMIT', 'source_refs exceed the activation pack source budget');
  const readPointers = input.read_pointers ?? [];
  const digest = createHash('sha256').update(JSON.stringify({purpose: input.purpose, summary: input.summary, sourceRefs, readPointers})).digest('hex').slice(0, 20);
  return validateActivationPack({
    protocol_id: CONTEXT_PROTOCOL_ID,
    protocol_version: CONTEXT_PROTOCOL_VERSION,
    pack_id: input.pack_id ?? `context-${digest}`,
    ...(input.thread_id === undefined ? {} : {thread_id: input.thread_id}),
    purpose: text(input.purpose, 'purpose'),
    summary: text(input.summary, 'summary', 6000),
    source_refs: sourceRefs,
    read_pointers: readPointers,
    budget: {max_tokens: input.budget?.max_tokens ?? 6000, max_sources: input.budget?.max_sources ?? 16},
    forbidden_scopes: input.forbidden_scopes ?? [],
    ...(input.required_user_action === undefined ? {} : {required_user_action: input.required_user_action}),
    generated_at: new Date().toISOString(),
  });
}

function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function hash(value: unknown, field: string): string {
  const candidate = text(value, field, 64);
  if (!/^[a-f0-9]{64}$/.test(candidate)) throw new ProtocolError('INVALID_FIELD', `${field} must be a lowercase SHA-256 hex digest`);
  return candidate;
}
function version(value: unknown, field: string): string {
  const candidate = text(value, field, 64);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(candidate)) throw new ProtocolError('INVALID_FIELD', `${field} must be semver`);
  return candidate;
}
function generatedAt(value: unknown): string {
  const candidate = text(value, 'generated_at', 80);
  if (Number.isNaN(Date.parse(candidate)) || new Date(candidate).toISOString() !== candidate) throw new ProtocolError('INVALID_FIELD', 'generated_at must be an ISO-8601 UTC timestamp');
  return candidate;
}
function sessionId(value: unknown): string {
  const candidate = text(value, 'session_binding.session_id', 512);
  if (/[\x00-\x1f\x7f]/.test(candidate)) throw new ProtocolError('INVALID_FIELD', 'session_binding.session_id contains control characters');
  return candidate;
}
function renderContextSkill(instructions: string): string {
  return [
    '---',
    `name: ${CONTEXT_SKILL_NAME}`,
    `description: ${CONTEXT_SKILL_DESCRIPTION}`,
    '---',
    '',
    '# Trace Project Context',
    '',
    'This package is bound to the current Codex task and Trace project. Apply it as collaboration context, not as proof that any cognitive-source page was read.',
    '',
    instructions,
  ].join('\n');
}
function exactBoundaries(value: unknown): ContextSkillPackage['boundaries'] {
  if (!Array.isArray(value) || value.length !== CONTEXT_SKILL_BOUNDARIES.length || value.some((item, index) => item !== CONTEXT_SKILL_BOUNDARIES[index])) {
    throw new ProtocolError('INVALID_FIELD', 'context skill package boundaries are missing or changed');
  }
  return [...CONTEXT_SKILL_BOUNDARIES];
}
function contextSkillContent(value: Omit<ContextSkillPackage, 'package_id' | 'content_sha256' | 'generated_at'>): string {
  return JSON.stringify(value);
}

/** Validate a task-bound, Skill-shaped context artifact without trusting its hashes or nested field set. */
export function validateContextSkillPackage(value: unknown): ContextSkillPackage {
  const raw = object(value, 'context_skill_package');
  rejectUnknown(raw, ['protocol_id', 'protocol_version', 'package_id', 'artifact_kind', 'host', 'session_binding', 'scope', 'skill', 'provenance', 'boundaries', 'content_sha256', 'generated_at'], 'context_skill_package');
  if (raw.protocol_id !== CONTEXT_SKILL_PROTOCOL_ID || raw.protocol_version !== CONTEXT_SKILL_PROTOCOL_VERSION) throw new ProtocolError('PROTOCOL_MISMATCH', 'Unsupported context skill package protocol');
  if (raw.artifact_kind !== 'context-pack' || raw.host !== 'codex') throw new ProtocolError('INVALID_FIELD', 'context skill package host or artifact kind is invalid');

  const binding = object(raw.session_binding, 'session_binding');
  rejectUnknown(binding, ['session_id'], 'session_binding');
  const scope = object(raw.scope, 'scope');
  rejectUnknown(scope, ['type', 'project_id', 'project_label'], 'scope');
  if (scope.type !== 'project') throw new ProtocolError('INVALID_FIELD', 'context skill package scope must be project');

  const skillRaw = object(raw.skill, 'skill');
  rejectUnknown(skillRaw, ['format', 'entry', 'name', 'description', 'instructions', 'instructions_sha256', 'skill_md', 'sha256'], 'skill');
  if (skillRaw.format !== 'codex-skill' || skillRaw.entry !== 'SKILL.md' || skillRaw.name !== CONTEXT_SKILL_NAME || skillRaw.description !== CONTEXT_SKILL_DESCRIPTION) throw new ProtocolError('INVALID_FIELD', 'context skill package Skill identity is invalid');
  const instructions = text(skillRaw.instructions, 'skill.instructions', 12_000);
  const instructionsHash = hash(skillRaw.instructions_sha256, 'skill.instructions_sha256');
  if (sha256(instructions) !== instructionsHash) throw new ProtocolError('HASH_MISMATCH', 'context skill instructions hash does not match');
  const skillMd = text(skillRaw.skill_md, 'skill.skill_md', 16_000);
  if (skillMd !== renderContextSkill(instructions)) throw new ProtocolError('INVALID_FIELD', 'skill.skill_md is not the canonical rendering of its instructions');
  const skillHash = hash(skillRaw.sha256, 'skill.sha256');
  if (sha256(skillMd) !== skillHash) throw new ProtocolError('HASH_MISMATCH', 'context SKILL.md hash does not match');

  const provenanceRaw = object(raw.provenance, 'provenance');
  rejectUnknown(provenanceRaw, ['activation_lock', 'collaboration_model', 'source_activation'], 'provenance');
  const lockRaw = object(provenanceRaw.activation_lock, 'provenance.activation_lock');
  rejectUnknown(lockRaw, ['lock_id', 'version'], 'provenance.activation_lock');
  if (lockRaw.version !== '0.1.0') throw new ProtocolError('PROTOCOL_MIGRATION_REQUIRED', 'Unsupported activation lock version in context skill package');
  const modelRaw = object(provenanceRaw.collaboration_model, 'provenance.collaboration_model');
  rejectUnknown(modelRaw, ['model_id', 'version', 'sha256'], 'provenance.collaboration_model');
  const sourceRaw = object(provenanceRaw.source_activation, 'provenance.source_activation');
  rejectUnknown(sourceRaw, ['manifest_id', 'version', 'source_id', 'sha256', 'entry_point_count', 'available'], 'provenance.source_activation');
  if (!Number.isInteger(sourceRaw.entry_point_count) || Number(sourceRaw.entry_point_count) < 0 || Number(sourceRaw.entry_point_count) > 24) throw new ProtocolError('INVALID_FIELD', 'provenance.source_activation.entry_point_count must be between 0 and 24');
  if (typeof sourceRaw.available !== 'boolean') throw new ProtocolError('INVALID_FIELD', 'provenance.source_activation.available must be boolean');

  const core: Omit<ContextSkillPackage, 'package_id' | 'content_sha256' | 'generated_at'> = {
    protocol_id: CONTEXT_SKILL_PROTOCOL_ID,
    protocol_version: CONTEXT_SKILL_PROTOCOL_VERSION,
    artifact_kind: 'context-pack',
    host: 'codex',
    session_binding: {session_id: sessionId(binding.session_id)},
    scope: {type: 'project', project_id: text(scope.project_id, 'scope.project_id', 240), project_label: text(scope.project_label, 'scope.project_label', 300)},
    skill: {
      format: 'codex-skill', entry: 'SKILL.md', name: CONTEXT_SKILL_NAME, description: CONTEXT_SKILL_DESCRIPTION,
      instructions, instructions_sha256: instructionsHash, skill_md: skillMd, sha256: skillHash,
    },
    provenance: {
      activation_lock: {lock_id: text(lockRaw.lock_id, 'provenance.activation_lock.lock_id', 240), version: '0.1.0'},
      collaboration_model: {model_id: text(modelRaw.model_id, 'provenance.collaboration_model.model_id', 240), version: version(modelRaw.version, 'provenance.collaboration_model.version'), sha256: hash(modelRaw.sha256, 'provenance.collaboration_model.sha256')},
      source_activation: {
        manifest_id: text(sourceRaw.manifest_id, 'provenance.source_activation.manifest_id', 240),
        version: version(sourceRaw.version, 'provenance.source_activation.version'),
        source_id: text(sourceRaw.source_id, 'provenance.source_activation.source_id', 240),
        sha256: hash(sourceRaw.sha256, 'provenance.source_activation.sha256'),
        entry_point_count: Number(sourceRaw.entry_point_count), available: sourceRaw.available,
      },
    },
    boundaries: exactBoundaries(raw.boundaries),
  };
  const contentHash = hash(raw.content_sha256, 'content_sha256');
  if (sha256(contextSkillContent(core)) !== contentHash) throw new ProtocolError('HASH_MISMATCH', 'context skill package content hash does not match');
  const packageId = text(raw.package_id, 'package_id', 240);
  if (packageId !== `context-skill-${contentHash.slice(0, 24)}`) throw new ProtocolError('HASH_MISMATCH', 'context skill package id does not match its content hash');
  return {...core, package_id: packageId, content_sha256: contentHash, generated_at: generatedAt(raw.generated_at)};
}

/** Build a virtual Codex Skill from an already compiled and lock-verified collaboration context. */
export function buildContextSkillPackage(input: BuildContextSkillPackageInput): ContextSkillPackage {
  const instructions = text(input.instructions, 'skill.instructions', 12_000);
  const skillMd = renderContextSkill(instructions);
  const core: Omit<ContextSkillPackage, 'package_id' | 'content_sha256' | 'generated_at'> = {
    protocol_id: CONTEXT_SKILL_PROTOCOL_ID,
    protocol_version: CONTEXT_SKILL_PROTOCOL_VERSION,
    artifact_kind: 'context-pack',
    host: 'codex',
    session_binding: {session_id: sessionId(input.host_session_id)},
    scope: {type: 'project', project_id: text(input.project.project_id, 'scope.project_id', 240), project_label: text(input.project.project_label, 'scope.project_label', 300)},
    skill: {
      format: 'codex-skill', entry: 'SKILL.md', name: CONTEXT_SKILL_NAME, description: CONTEXT_SKILL_DESCRIPTION,
      instructions, instructions_sha256: sha256(instructions), skill_md: skillMd, sha256: sha256(skillMd),
    },
    provenance: {
      activation_lock: {lock_id: text(input.activation_lock.lock_id, 'provenance.activation_lock.lock_id', 240), version: input.activation_lock.version},
      collaboration_model: {model_id: text(input.collaboration_model.model_id, 'provenance.collaboration_model.model_id', 240), version: version(input.collaboration_model.version, 'provenance.collaboration_model.version'), sha256: hash(input.collaboration_model.sha256, 'provenance.collaboration_model.sha256')},
      source_activation: {
        manifest_id: text(input.source_activation.manifest_id, 'provenance.source_activation.manifest_id', 240),
        version: version(input.source_activation.version, 'provenance.source_activation.version'),
        source_id: text(input.source_activation.source_id, 'provenance.source_activation.source_id', 240),
        sha256: hash(input.source_activation.sha256, 'provenance.source_activation.sha256'),
        entry_point_count: input.source_activation.entry_point_count, available: input.source_activation.available,
      },
    },
    boundaries: [...CONTEXT_SKILL_BOUNDARIES],
  };
  const contentHash = sha256(contextSkillContent(core));
  return validateContextSkillPackage({...core, package_id: `context-skill-${contentHash.slice(0, 24)}`, content_sha256: contentHash, generated_at: input.generated_at ?? new Date().toISOString()});
}
