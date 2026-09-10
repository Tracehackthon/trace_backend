import {createHash} from 'node:crypto';
import {ProtocolError, rejectUnknown, requireObject, requireStringList, requireText as text} from '../../protocol/src/index.js';

export const COLLABORATION_MODEL_PROTOCOL_ID = 'trace.collaboration-model' as const;
export const COLLABORATION_MODEL_PROTOCOL_VERSION = '0.1.0' as const;
export const SOURCE_ACTIVATION_PROTOCOL_ID = 'trace.source-activation' as const;
export const SOURCE_ACTIVATION_PROTOCOL_VERSION = '0.1.0' as const;

export type CollaborationScope = 'starter' | 'personal' | 'project' | 'team';
export type SourceEntryKind = 'knowledge' | 'capability' | 'governance' | 'question';

/**
 * An explicit, inspectable description of how an Agent should collaborate.
 * It is not a psychological profile and contains no inferred personality data.
 */
export interface CollaborationModel {
  protocol_id: typeof COLLABORATION_MODEL_PROTOCOL_ID;
  protocol_version: typeof COLLABORATION_MODEL_PROTOCOL_VERSION;
  model_id: string;
  version: string;
  display_name: string;
  scope: CollaborationScope;
  principles: string[];
  open_discussion: string[];
  explicit_execution: string[];
  epistemic_practice: string[];
  boundaries: string[];
  current_focus?: string[];
}

export interface SourceActivationEntry {
  id: string;
  label: string;
  kind: SourceEntryKind;
  purpose: string;
  triggers: string[];
  /** A safe relative Markdown path. It is a navigation entry, not injected body text. */
  locator?: string;
}

/**
 * A user-authored source map: small enough for a host prompt, versioned, and
 * deliberately separate from the actual cognitive-source pages.
 */
export interface SourceActivationManifest {
  protocol_id: typeof SOURCE_ACTIVATION_PROTOCOL_ID;
  protocol_version: typeof SOURCE_ACTIVATION_PROTOCOL_VERSION;
  manifest_id: string;
  version: string;
  source_id: string;
  display_name: string;
  summary: string;
  entry_points: SourceActivationEntry[];
  activation_profiles: string[];
}

export interface ActivationLock {
  lock_id: string;
  version: '0.1.0';
  template_id: string;
  collaboration_model: {model_id: string; version: string; sha256: string};
  source_activation: {manifest_id: string; version: string; source_id: string; sha256: string};
  created_at: string;
}

export interface CompiledCollaborationContext {
  collaboration_model: {model_id: string; version: string; sha256: string};
  source_activation: {manifest_id: string; version: string; source_id: string; sha256: string; entry_point_count: number};
  context_sha256: string;
  developer_context: string;
}

function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function jsonHash(value: unknown): string { return sha256(JSON.stringify(value)); }
function semver(value: unknown, field: string): string {
  const version = text(value, field, 64);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) throw new ProtocolError('INVALID_FIELD', `${field} must be semver`);
  return version;
}
function hash(value: unknown, field: string): string {
  const candidate = text(value, field, 64);
  if (!/^[a-f0-9]{64}$/.test(candidate)) throw new ProtocolError('INVALID_FIELD', `${field} must be a SHA-256 hex digest`);
  return candidate;
}
function safeLocator(value: unknown, field: string): string {
  const locator = text(value, field, 2000).replaceAll('\\', '/');
  if (!locator.toLowerCase().endsWith('.md') || locator.startsWith('/') || locator.split('/').some(part => part === '' || part === '.' || part === '..')) throw new ProtocolError('INVALID_FIELD', `${field} must be a safe relative Markdown locator`);
  return locator;
}
function list(value: unknown, field: string, max: number, itemMax = 1600): string[] { return requireStringList(value, field, {max, itemMax}); }

export function validateCollaborationModel(value: unknown): CollaborationModel {
  const raw = requireObject(value, 'collaboration_model');
  rejectUnknown(raw, ['protocol_id', 'protocol_version', 'model_id', 'version', 'display_name', 'scope', 'principles', 'open_discussion', 'explicit_execution', 'epistemic_practice', 'boundaries', 'current_focus'], 'collaboration_model');
  if (raw.protocol_id !== COLLABORATION_MODEL_PROTOCOL_ID || raw.protocol_version !== COLLABORATION_MODEL_PROTOCOL_VERSION) throw new ProtocolError('PROTOCOL_MISMATCH', 'Unsupported collaboration model protocol');
  if (!['starter', 'personal', 'project', 'team'].includes(raw.scope as string)) throw new ProtocolError('INVALID_FIELD', 'collaboration_model.scope is invalid');
  const result: CollaborationModel = {
    protocol_id: COLLABORATION_MODEL_PROTOCOL_ID,
    protocol_version: COLLABORATION_MODEL_PROTOCOL_VERSION,
    model_id: text(raw.model_id, 'collaboration_model.model_id', 240),
    version: semver(raw.version, 'collaboration_model.version'),
    display_name: text(raw.display_name, 'collaboration_model.display_name', 300),
    scope: raw.scope as CollaborationScope,
    principles: list(raw.principles, 'collaboration_model.principles', 16),
    open_discussion: list(raw.open_discussion, 'collaboration_model.open_discussion', 16),
    explicit_execution: list(raw.explicit_execution, 'collaboration_model.explicit_execution', 16),
    epistemic_practice: list(raw.epistemic_practice, 'collaboration_model.epistemic_practice', 16),
    boundaries: list(raw.boundaries, 'collaboration_model.boundaries', 16),
  };
  if (result.principles.length === 0 || result.open_discussion.length === 0 || result.explicit_execution.length === 0 || result.epistemic_practice.length === 0 || result.boundaries.length === 0) throw new ProtocolError('INVALID_FIELD', 'collaboration_model requires every behavioral section');
  if (raw.current_focus !== undefined) result.current_focus = list(raw.current_focus, 'collaboration_model.current_focus', 8);
  return result;
}

export function validateSourceActivationManifest(value: unknown): SourceActivationManifest {
  const raw = requireObject(value, 'source_activation_manifest');
  rejectUnknown(raw, ['protocol_id', 'protocol_version', 'manifest_id', 'version', 'source_id', 'display_name', 'summary', 'entry_points', 'activation_profiles'], 'source_activation_manifest');
  if (raw.protocol_id !== SOURCE_ACTIVATION_PROTOCOL_ID || raw.protocol_version !== SOURCE_ACTIVATION_PROTOCOL_VERSION) throw new ProtocolError('PROTOCOL_MISMATCH', 'Unsupported source activation protocol');
  if (!Array.isArray(raw.entry_points) || raw.entry_points.length > 24) throw new ProtocolError('INVALID_FIELD', 'source_activation_manifest.entry_points must contain at most 24 entries');
  const entry_points = raw.entry_points.map((value, index) => {
    const entry = requireObject(value, `source_activation_manifest.entry_points[${index}]`);
    rejectUnknown(entry, ['id', 'label', 'kind', 'purpose', 'triggers', 'locator'], `source_activation_manifest.entry_points[${index}]`);
    if (!['knowledge', 'capability', 'governance', 'question'].includes(entry.kind as string)) throw new ProtocolError('INVALID_FIELD', `source_activation_manifest.entry_points[${index}].kind is invalid`);
    return {
      id: text(entry.id, `source_activation_manifest.entry_points[${index}].id`, 160),
      label: text(entry.label, `source_activation_manifest.entry_points[${index}].label`, 300),
      kind: entry.kind as SourceEntryKind,
      purpose: text(entry.purpose, `source_activation_manifest.entry_points[${index}].purpose`, 1000),
      triggers: list(entry.triggers, `source_activation_manifest.entry_points[${index}].triggers`, 16, 240),
      ...(entry.locator === undefined ? {} : {locator: safeLocator(entry.locator, `source_activation_manifest.entry_points[${index}].locator`)}),
    };
  });
  if (new Set(entry_points.map(item => item.id)).size !== entry_points.length) throw new ProtocolError('INVALID_FIELD', 'source_activation_manifest.entry_points has duplicate ids');
  return {
    protocol_id: SOURCE_ACTIVATION_PROTOCOL_ID,
    protocol_version: SOURCE_ACTIVATION_PROTOCOL_VERSION,
    manifest_id: text(raw.manifest_id, 'source_activation_manifest.manifest_id', 240),
    version: semver(raw.version, 'source_activation_manifest.version'),
    source_id: text(raw.source_id, 'source_activation_manifest.source_id', 240),
    display_name: text(raw.display_name, 'source_activation_manifest.display_name', 300),
    summary: text(raw.summary, 'source_activation_manifest.summary', 2400),
    entry_points,
    activation_profiles: list(raw.activation_profiles, 'source_activation_manifest.activation_profiles', 16, 240),
  };
}

/** Validate the public, hash-only lock without reading private model/source-map bodies. */
export function validateActivationLock(value: unknown): ActivationLock {
  const raw = requireObject(value, 'activation_lock');
  rejectUnknown(raw, ['lock_id', 'version', 'template_id', 'collaboration_model', 'source_activation', 'created_at'], 'activation_lock');
  if (raw.version !== '0.1.0') throw new ProtocolError('PROTOCOL_MIGRATION_REQUIRED', 'Unsupported activation lock version');
  const model = requireObject(raw.collaboration_model, 'activation_lock.collaboration_model');
  rejectUnknown(model, ['model_id', 'version', 'sha256'], 'activation_lock.collaboration_model');
  const source = requireObject(raw.source_activation, 'activation_lock.source_activation');
  rejectUnknown(source, ['manifest_id', 'version', 'source_id', 'sha256'], 'activation_lock.source_activation');
  return {
    lock_id: text(raw.lock_id, 'activation_lock.lock_id', 240),
    version: '0.1.0',
    template_id: text(raw.template_id, 'activation_lock.template_id', 240),
    collaboration_model: {model_id: text(model.model_id, 'activation_lock.collaboration_model.model_id', 240), version: semver(model.version, 'activation_lock.collaboration_model.version'), sha256: hash(model.sha256, 'activation_lock.collaboration_model.sha256')},
    source_activation: {manifest_id: text(source.manifest_id, 'activation_lock.source_activation.manifest_id', 240), version: semver(source.version, 'activation_lock.source_activation.version'), source_id: text(source.source_id, 'activation_lock.source_activation.source_id', 240), sha256: hash(source.sha256, 'activation_lock.source_activation.sha256')},
    created_at: text(raw.created_at, 'activation_lock.created_at', 80),
  };
}

/**
 * This starter is distilled from the product's validated collaboration stance:
 * continue an unfinished thought, do not interrogate by default, challenge
 * concretely, and switch cleanly from discussion to explicit execution.
 */
export function defaultCollaborationModel(templateId = 'trace.codex-starter'): CollaborationModel {
  const team = templateId === 'trace.codex-team';
  const empty = templateId === 'trace.codex-empty';
  if (empty) return validateCollaborationModel({
    protocol_id: COLLABORATION_MODEL_PROTOCOL_ID, protocol_version: COLLABORATION_MODEL_PROTOCOL_VERSION,
    model_id: 'trace.structure-only-collaboration', version: '1.0.0', display_name: 'Trace Structure-only Collaboration', scope: 'starter',
    principles: ['Keep project work explicit and bounded; do not infer personal history or preferences without a user-provided source.'],
    open_discussion: ['Ask only for information that materially changes the work; state uncertainty rather than inventing familiarity.'],
    explicit_execution: ['When the user asks to implement, execute the stated task and report evidence.'],
    epistemic_practice: ['Separate observed facts, source claims, and inference.'],
    boundaries: ['Do not persist prompts, source bodies, or inferred personal traits without an explicit product flow.'],
  });
  return validateCollaborationModel({
    protocol_id: COLLABORATION_MODEL_PROTOCOL_ID, protocol_version: COLLABORATION_MODEL_PROTOCOL_VERSION,
    model_id: team ? 'trace.team-collaboration-starter' : 'trace.cognitive-collaboration-starter', version: '1.0.0',
    display_name: team ? 'Trace Team Collaboration Starter' : 'Trace Cognitive Collaboration Starter', scope: team ? 'team' : 'starter',
    principles: [
      'Treat an incomplete user expression as thinking in progress: first connect to its real tension, then help move the understanding forward.',
      'Use prior context only when it changes the present work; never pretend to know what was not read or confirmed.',
      'Warm collaboration is not agreement: explain concrete conflicts, limits, and alternatives when they matter.',
    ],
    open_discussion: [
      'Do not default to generic diagnostic checklists, repeated interrogation, or premature task decomposition when the user is still forming the question.',
      'Offer the smallest useful connection or distinction first; leave room for the user to continue thinking rather than filling every branch.',
    ],
    explicit_execution: [
      'When the user clearly asks to implement, organize, save, publish, or verify, switch from discussion to the requested work without turning it into a coaching exercise.',
      'Feedback or a better direction is a proposal until the user explicitly asks to alter a durable artifact.',
    ],
    epistemic_practice: [
      'Distinguish runtime evidence, source material, user-stated observations, and inference.',
      'Do not turn a local success, a remembered claim, or an unadopted candidate into a general rule.',
    ],
    boundaries: [
      'A candidate is not an adopted judgment; an adopted judgment is not an automatically published capability.',
      'Do not silently persist raw prompts, private source bodies, tool arguments, or inferred traits.',
      ...(team ? ['Keep member, team, and project scopes distinct; access to a team source does not grant cross-project reuse.'] : []),
    ],
  });
}

export function defaultSourceActivationManifest(input: {source_id: string; source_mode: 'local' | 'external' | 'team' | 'empty'; template_id: string}): SourceActivationManifest {
  const empty = input.source_mode === 'empty';
  return validateSourceActivationManifest({
    protocol_id: SOURCE_ACTIVATION_PROTOCOL_ID,
    protocol_version: SOURCE_ACTIVATION_PROTOCOL_VERSION,
    manifest_id: empty ? 'trace.empty-source-map' : 'trace.user-selected-source-map',
    version: '1.0.0',
    source_id: input.source_id,
    display_name: empty ? 'No Cognitive Source Selected' : input.source_mode === 'team' ? 'Selected Team Cognitive Source' : 'Selected Cognitive Source',
    summary: empty
      ? 'No personal or team cognitive source is active for this project. Work only from the project and explicit user input.'
      : 'This is a user-selected cognitive source. Its map is navigation for relevant work, not a claim that every page is read, current, or authoritative.',
    entry_points: [],
    activation_profiles: input.template_id === 'trace.codex-empty' ? ['structure-only'] : ['cold-start', 'open-discussion', 'explicit-execution'],
  });
}

export function collaborationModelHash(model: CollaborationModel): string { return jsonHash(validateCollaborationModel(model)); }
export function sourceActivationManifestHash(manifest: SourceActivationManifest): string { return jsonHash(validateSourceActivationManifest(manifest)); }

export function buildActivationLock(input: {template_id: string; model: CollaborationModel; source: SourceActivationManifest; created_at?: string}): ActivationLock {
  const model = validateCollaborationModel(input.model);
  const source = validateSourceActivationManifest(input.source);
  return {
    lock_id: `activation-${sha256(`${input.template_id}:${collaborationModelHash(model)}:${sourceActivationManifestHash(source)}`).slice(0, 24)}`,
    version: '0.1.0',
    template_id: text(input.template_id, 'template_id', 240),
    collaboration_model: {model_id: model.model_id, version: model.version, sha256: collaborationModelHash(model)},
    source_activation: {manifest_id: source.manifest_id, version: source.version, source_id: source.source_id, sha256: sourceActivationManifestHash(source)},
    created_at: text(input.created_at ?? new Date().toISOString(), 'created_at', 80),
  };
}

function renderList(title: string, values: string[]): string[] { return values.length === 0 ? [] : [title, ...values.map(value => `- ${value}`)]; }

/** Compile a bounded developer context; source pages remain native-host reads. */
export function compileCollaborationContext(input: {model: CollaborationModel; source: SourceActivationManifest; source_available: boolean; max_chars?: number}): CompiledCollaborationContext {
  const model = validateCollaborationModel(input.model);
  const source = validateSourceActivationManifest(input.source);
  const lines = [
    'Trace collaboration context (versioned, user-visible):',
    `Collaboration model: ${model.display_name} (${model.model_id}@${model.version}).`,
    ...renderList('Core collaboration principles:', model.principles),
    ...renderList('When the user is exploring or uncertain:', model.open_discussion),
    ...renderList('When the user explicitly asks to execute:', model.explicit_execution),
    ...renderList('Evidence discipline:', model.epistemic_practice),
    ...renderList('Boundaries:', model.boundaries),
    ...(model.current_focus === undefined ? [] : renderList('Current user-provided focus:', model.current_focus)),
    `Cognitive source map: ${source.display_name} (${source.manifest_id}@${source.version}) for source ${source.source_id}.`,
    `Source purpose: ${source.summary}`,
    ...(source.entry_points.length === 0 ? ['The source map has no curated entry points yet. Use native search/read only when the user task makes the authorized source relevant.'] : [
      'Curated entry points (navigation only; do not claim a page was read until native tools actually read it):',
      ...source.entry_points.map(entry => `- ${entry.label} [${entry.kind}] — ${entry.purpose}; triggers: ${entry.triggers.join(', ')}${entry.locator === undefined ? '' : `; locator: ${entry.locator}`}`),
    ]),
    `Source availability for this turn: ${input.source_available ? 'available through the authorized host-native lease' : 'not available; do not imply source access'}.`,
    'Do not turn this collaboration model or source map into a claim about the user’s personality or into durable memory without the explicit Trace proposal/adoption flow.',
  ];
  const developer_context = lines.join('\n');
  const maxChars = input.max_chars ?? 12_000;
  if (developer_context.length > maxChars) throw new ProtocolError('CONTEXT_LIMIT', `compiled collaboration context exceeds ${maxChars} characters`);
  return {
    collaboration_model: {model_id: model.model_id, version: model.version, sha256: collaborationModelHash(model)},
    source_activation: {manifest_id: source.manifest_id, version: source.version, source_id: source.source_id, sha256: sourceActivationManifestHash(source), entry_point_count: source.entry_points.length},
    context_sha256: sha256(developer_context),
    developer_context,
  };
}
