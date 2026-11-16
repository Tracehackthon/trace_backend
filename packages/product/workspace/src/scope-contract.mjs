/**
 * The scope contract keeps facts that are commonly collapsed into one
 * `scope` value separate.  A Host Session is an attachment context; it is not
 * proof that the captured content belongs to that project or that it may be
 * activated in every other project.
 */
export const SCOPE_CONTRACT_PROTOCOL_ID = 'trace.scope-contract';
export const SCOPE_CONTRACT_VERSION = 1;
export const SCOPE_CONTRACT_MIGRATION_ID = 'product-workspace.scope-contract.v1';
export const SCOPE_CONTRACT_MIGRATION_VERSION = 1;

export const SCOPE_OWNER_KINDS = Object.freeze(['person', 'project', 'team', 'domain', 'unknown']);
export const SCOPE_CONTENT_KINDS = Object.freeze(['personal', 'project', 'team', 'domain', 'task', 'unknown']);
export const SCOPE_DISCOVERY_MODES = Object.freeze(['private', 'personal', 'current-project', 'explicit-projects', 'team', 'domain', 'unknown']);
export const SCOPE_ACTIVATION_MODES = Object.freeze(['none', 'task', 'project', 'selected-projects', 'cross-project', 'team', 'unknown']);
export const SCOPE_CLASSIFICATION_LEVELS = Object.freeze(['private', 'project-internal', 'team', 'internal', 'public', 'unknown']);
export const SCOPE_LIFECYCLE_STATUSES = Object.freeze(['captured', 'candidate', 'validated', 'adopted', 'published', 'rejected', 'superseded', 'unknown']);
export const SCOPE_CERTAINTIES = Object.freeze(['confirmed', 'inferred', 'unknown']);
export const PROJECT_LINK_RELATIONS = Object.freeze(['source', 'related', 'applicable', 'target']);

const OWNER_KINDS = new Set(SCOPE_OWNER_KINDS);
const CONTENT_KINDS = new Set(SCOPE_CONTENT_KINDS);
const DISCOVERY_MODES = new Set(SCOPE_DISCOVERY_MODES);
const ACTIVATION_MODES = new Set(SCOPE_ACTIVATION_MODES);
const CLASSIFICATION_LEVELS = new Set(SCOPE_CLASSIFICATION_LEVELS);
const LIFECYCLE_STATUSES = new Set(SCOPE_LIFECYCLE_STATUSES);
const CERTAINTIES = new Set(SCOPE_CERTAINTIES);
const LINK_RELATIONS = new Set(PROJECT_LINK_RELATIONS);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_ID = 512;
const MAX_SOURCE_ID = 2_000;
const MAX_REFS = 64;

export class ScopeContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ScopeContractError';
    this.code = code;
  }
}

function fail(code, message) { throw new ScopeContractError(code, message); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) {
  try { return structuredClone(value); } catch { fail('INVALID_SCOPE_CONTRACT', 'scope contract must be structured-cloneable'); }
}
function identity(value, field, {nullable = false, max = MAX_ID} = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\x00-\x1f\x7f]/.test(value) || FORBIDDEN_KEYS.has(value)) {
    fail('INVALID_SCOPE_CONTRACT', `${field} must be a bounded identity or null`);
  }
  return value;
}
function nullableIdentity(value, field, max = MAX_ID) {
  if (value === undefined || value === null || value === '') return null;
  return identity(value, field, {max});
}
function enumValue(value, field, allowed) {
  if (typeof value !== 'string' || !allowed.has(value)) fail('INVALID_SCOPE_CONTRACT', `${field} is not supported`);
  return value;
}
function objectKeys(value, allowed, field) {
  if (!plain(value)) fail('INVALID_SCOPE_CONTRACT', `${field} must be an object`);
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length > 0) fail('INVALID_SCOPE_CONTRACT', `${field} contains unsupported fields: ${unknown.join(', ')}`);
}
function refs(value, field) {
  if (!Array.isArray(value) || value.length > MAX_REFS) fail('INVALID_SCOPE_CONTRACT', `${field} must contain at most ${MAX_REFS} items`);
  return value.map((item, index) => {
    if (!plain(item)) fail('INVALID_SCOPE_CONTRACT', `${field}[${index}] must be an object`);
    // References are deliberately bounded but provider-specific. They are
    // pointers/evidence, never a second copy of the source body.
    let encoded;
    try { encoded = JSON.stringify(item); } catch { fail('INVALID_SCOPE_CONTRACT', `${field}[${index}] must be JSON serializable`); }
    if (encoded.length > 4_096) fail('INVALID_SCOPE_CONTRACT', `${field}[${index}] is too large`);
    if (Object.keys(item).some(key => FORBIDDEN_KEYS.has(key))) fail('INVALID_SCOPE_CONTRACT', `${field}[${index}] contains a forbidden key`);
    return clone(item);
  });
}
function projectRefs(value, field) {
  if (!Array.isArray(value) || value.length > MAX_REFS) fail('INVALID_SCOPE_CONTRACT', `${field} must contain at most ${MAX_REFS} project references`);
  const result = value.map((item, index) => identity(item, `${field}[${index}]`));
  if (new Set(result).size !== result.length) fail('INVALID_SCOPE_CONTRACT', `${field} contains duplicate projects`);
  return result;
}
function certainty(value, field) { return enumValue(value, field, CERTAINTIES); }

function owner(value) {
  objectKeys(value, new Set(['kind', 'id', 'certainty']), 'owner');
  const kind = enumValue(value.kind, 'owner.kind', OWNER_KINDS);
  const id = nullableIdentity(value.id, 'owner.id');
  const certaintyValue = certainty(value.certainty, 'owner.certainty');
  if (kind === 'unknown' && id !== null) fail('INVALID_SCOPE_CONTRACT', 'owner.id must be null when owner.kind is unknown');
  if (kind !== 'unknown' && id === null && certaintyValue === 'confirmed') fail('INVALID_SCOPE_CONTRACT', 'confirmed non-unknown owner requires owner.id');
  return {kind, id, certainty: certaintyValue};
}

function sourceProvenance(value) {
  objectKeys(value, new Set(['surface', 'source_id', 'project_refs', 'source_refs']), 'source_provenance');
  const surface = identity(value.surface, 'source_provenance.surface', {max: 128});
  const sourceId = nullableIdentity(value.source_id, 'source_provenance.source_id', MAX_SOURCE_ID);
  const projectRefs = projectRefsValue(value.project_refs ?? [], 'source_provenance.project_refs');
  const sourceRefs = refs(value.source_refs ?? [], 'source_provenance.source_refs');
  return {surface, source_id: sourceId, project_refs: projectRefs, source_refs: sourceRefs};
}

function projectRefsValue(value, field) { return projectRefs(value, field); }

function attachmentContext(value) {
  objectKeys(value, new Set(['host', 'session_id', 'turn_id', 'project_ref', 'task_id']), 'attachment_context');
  return {
    host: nullableIdentity(value.host, 'attachment_context.host', 128),
    session_id: nullableIdentity(value.session_id, 'attachment_context.session_id'),
    turn_id: nullableIdentity(value.turn_id, 'attachment_context.turn_id'),
    project_ref: nullableIdentity(value.project_ref, 'attachment_context.project_ref', MAX_ID * 8),
    task_id: nullableIdentity(value.task_id, 'attachment_context.task_id'),
  };
}

function contentScope(value) {
  objectKeys(value, new Set(['kind', 'project_ref', 'certainty']), 'content_scope');
  const kind = enumValue(value.kind, 'content_scope.kind', CONTENT_KINDS);
  const projectRef = nullableIdentity(value.project_ref, 'content_scope.project_ref', MAX_ID * 8);
  const certaintyValue = certainty(value.certainty, 'content_scope.certainty');
  if (kind === 'project' && projectRef === null && certaintyValue === 'confirmed') fail('INVALID_SCOPE_CONTRACT', 'confirmed project content requires content_scope.project_ref');
  if (kind !== 'project' && projectRef !== null) fail('INVALID_SCOPE_CONTRACT', 'content_scope.project_ref is only valid for project content');
  return {kind, project_ref: projectRef, certainty: certaintyValue};
}

function projectLinks(value) {
  if (!Array.isArray(value) || value.length > MAX_REFS) fail('INVALID_SCOPE_CONTRACT', `project_links must contain at most ${MAX_REFS} items`);
  const result = value.map((item, index) => {
    objectKeys(item, new Set(['project_ref', 'relation']), `project_links[${index}]`);
    return {project_ref: identity(item.project_ref, `project_links[${index}].project_ref`, {max: MAX_ID * 8}), relation: enumValue(item.relation, `project_links[${index}].relation`, LINK_RELATIONS)};
  });
  const seen = new Set(result.map(item => `${item.project_ref}\u0000${item.relation}`));
  if (seen.size !== result.length) fail('INVALID_SCOPE_CONTRACT', 'project_links contains duplicates');
  return result;
}

function discoveryPolicy(value) {
  objectKeys(value, new Set(['mode', 'project_refs', 'certainty']), 'discovery_policy');
  return {mode: enumValue(value.mode, 'discovery_policy.mode', DISCOVERY_MODES), project_refs: projectRefsValue(value.project_refs ?? [], 'discovery_policy.project_refs'), certainty: certainty(value.certainty, 'discovery_policy.certainty')};
}

function activationPolicy(value) {
  objectKeys(value, new Set(['mode', 'project_refs', 'requires_adoption', 'certainty']), 'activation_policy');
  if (typeof value.requires_adoption !== 'boolean') fail('INVALID_SCOPE_CONTRACT', 'activation_policy.requires_adoption must be boolean');
  return {mode: enumValue(value.mode, 'activation_policy.mode', ACTIVATION_MODES), project_refs: projectRefsValue(value.project_refs ?? [], 'activation_policy.project_refs'), requires_adoption: value.requires_adoption, certainty: certainty(value.certainty, 'activation_policy.certainty')};
}

function classification(value) {
  objectKeys(value, new Set(['level', 'certainty']), 'classification');
  return {level: enumValue(value.level, 'classification.level', CLASSIFICATION_LEVELS), certainty: certainty(value.certainty, 'classification.certainty')};
}

function lifecycle(value) {
  objectKeys(value, new Set(['status', 'certainty']), 'lifecycle');
  return {status: enumValue(value.status, 'lifecycle.status', LIFECYCLE_STATUSES), certainty: certainty(value.certainty, 'lifecycle.certainty')};
}

function legacyMetadata(value) {
  if (value === undefined) return undefined;
  objectKeys(value, new Set(['scope', 'upcasted', 'uncertain_fields']), 'legacy');
  const scope = identity(value.scope, 'legacy.scope', {max: 64});
  if (value.upcasted !== true) fail('INVALID_SCOPE_CONTRACT', 'legacy.upcasted must be true');
  if (!Array.isArray(value.uncertain_fields) || value.uncertain_fields.length > 32 || value.uncertain_fields.some(item => typeof item !== 'string')) fail('INVALID_SCOPE_CONTRACT', 'legacy.uncertain_fields is invalid');
  return {scope, upcasted: true, uncertain_fields: [...value.uncertain_fields]};
}

/** Validate and return a normalized, immutable-by-convention scope contract. */
export function validateScopeContract(value) {
  objectKeys(value, new Set(['protocol_id', 'protocol_version', 'owner', 'source_provenance', 'attachment_context', 'content_scope', 'project_links', 'discovery_policy', 'activation_policy', 'classification', 'lifecycle', 'legacy']), 'scope_contract');
  if (value.protocol_id !== SCOPE_CONTRACT_PROTOCOL_ID || value.protocol_version !== SCOPE_CONTRACT_VERSION) fail('SCOPE_CONTRACT_VERSION_UNSUPPORTED', 'scope contract protocol/version is unsupported');
  const result = {
    protocol_id: SCOPE_CONTRACT_PROTOCOL_ID,
    protocol_version: SCOPE_CONTRACT_VERSION,
    owner: owner(value.owner),
    source_provenance: sourceProvenance(value.source_provenance),
    attachment_context: attachmentContext(value.attachment_context),
    content_scope: contentScope(value.content_scope),
    project_links: projectLinks(value.project_links),
    discovery_policy: discoveryPolicy(value.discovery_policy),
    activation_policy: activationPolicy(value.activation_policy),
    classification: classification(value.classification),
    lifecycle: lifecycle(value.lifecycle),
  };
  const legacy = legacyMetadata(value.legacy);
  if (legacy !== undefined) result.legacy = legacy;
  return clone(result);
}

function emptyOwner() { return {kind: 'unknown', id: null, certainty: 'unknown'}; }
function emptyClassification() { return {level: 'unknown', certainty: 'unknown'}; }

/**
 * Conservative migration of the old one-dimensional `scope` field. The old
 * value is retained as provenance metadata, while owner, classification and
 * portable activation remain unknown unless an explicit project attachment
 * gives a safe project boundary.
 */
export function upcastLegacyScope({scope = 'unknown', project_ref = null, host = null, session_id = null, turn_id = null, task_id = null, source_refs = [], status = 'captured'} = {}) {
  const legacyScope = typeof scope === 'string' && ['personal', 'project', 'team', 'domain', 'unknown'].includes(scope) ? scope : 'unknown';
  const projectRef = nullableIdentity(project_ref, 'legacy.project_ref', MAX_ID * 8);
  const contentKind = legacyScope === 'personal' ? 'personal' : legacyScope === 'project' ? 'project' : legacyScope === 'team' ? 'team' : legacyScope === 'domain' ? 'domain' : 'unknown';
  const hasProject = legacyScope === 'project' && projectRef !== null;
  const uncertain = ['owner', 'classification', 'activation_policy'];
  if (legacyScope === 'project' && !hasProject) uncertain.push('content_scope.project_ref', 'project_links', 'discovery_policy');
  if (legacyScope === 'unknown') uncertain.push('content_scope', 'discovery_policy');
  const contract = {
    protocol_id: SCOPE_CONTRACT_PROTOCOL_ID,
    protocol_version: SCOPE_CONTRACT_VERSION,
    owner: emptyOwner(),
    source_provenance: {
      surface: host === null ? 'unknown' : 'codex-host',
      source_id: host && session_id ? `host:${host}:session:${session_id}` : null,
      project_refs: hasProject ? [projectRef] : [],
      source_refs: Array.isArray(source_refs) ? source_refs : [],
    },
    attachment_context: {
      host: nullableIdentity(host, 'legacy.host', 128),
      session_id: nullableIdentity(session_id, 'legacy.session_id'),
      turn_id: nullableIdentity(turn_id, 'legacy.turn_id'),
      project_ref: projectRef,
      task_id: nullableIdentity(task_id, 'legacy.task_id'),
    },
    content_scope: {kind: contentKind, project_ref: hasProject ? projectRef : null, certainty: legacyScope === 'unknown' ? 'unknown' : 'inferred'},
    project_links: hasProject ? [{project_ref: projectRef, relation: 'source'}] : [],
    discovery_policy: legacyScope === 'project' && hasProject
      ? {mode: 'current-project', project_refs: [projectRef], certainty: 'inferred'}
      : legacyScope === 'personal'
        ? {mode: 'personal', project_refs: [], certainty: 'inferred'}
        : {mode: 'unknown', project_refs: [], certainty: 'unknown'},
    activation_policy: legacyScope === 'project' && hasProject
      ? {mode: 'project', project_refs: [projectRef], requires_adoption: true, certainty: 'inferred'}
      : {mode: 'unknown', project_refs: [], requires_adoption: true, certainty: 'unknown'},
    classification: emptyClassification(),
    lifecycle: {status: LIFECYCLE_STATUSES.has(status) ? status : 'unknown', certainty: LIFECYCLE_STATUSES.has(status) ? 'confirmed' : 'unknown'},
    legacy: {scope: legacyScope, upcasted: true, uncertain_fields: [...new Set(uncertain)]},
  };
  return validateScopeContract(contract);
}

/** Read a finding's new contract, or conservatively upcast its old columns. */
export function scopeContractFromFindingRow(row, {project_ref = null} = {}) {
  if (!plain(row)) fail('INVALID_SCOPE_CONTRACT', 'workflow finding row must be an object');
  if (row.scope_contract_json !== undefined && row.scope_contract_json !== null) {
    let value;
    try { value = JSON.parse(row.scope_contract_json); } catch { fail('STORAGE_CORRUPT', 'workflow finding scope_contract_json is not valid JSON'); }
    return validateScopeContract(value);
  }
  let sourceRefs = row.source_refs ?? [];
  if (typeof sourceRefs === 'string') {
    try { sourceRefs = JSON.parse(sourceRefs); } catch { fail('STORAGE_CORRUPT', 'workflow finding source_refs is not valid JSON'); }
  }
  return upcastLegacyScope({scope: row.scope, project_ref, host: row.host, session_id: row.session_id, turn_id: row.turn_id, source_refs: sourceRefs, status: row.status});
}

export function projectRefsFromContract(contract) {
  const value = validateScopeContract(contract);
  return [...new Set([
    ...value.project_links.map(item => item.project_ref),
    ...value.discovery_policy.project_refs,
    ...value.activation_policy.project_refs,
    ...(value.content_scope.project_ref === null ? [] : [value.content_scope.project_ref]),
  ])];
}

export function scopeContractLegacyKind(contract) {
  const value = validateScopeContract(contract);
  return value.content_scope.kind === 'project' ? 'project' : value.content_scope.kind === 'personal' ? 'personal' : value.content_scope.kind === 'team' ? 'team' : value.content_scope.kind === 'domain' ? 'domain' : 'unknown';
}
