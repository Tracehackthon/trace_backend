import {ProtocolError, ProtocolVersionRegistry, rejectUnknown, requireObject as record, requireStringList, requireText as text, type ProtocolVersioned, type RecordRef, validateRecordRef} from '../../protocol/src/index.js';

export const CAPABILITY_CONTENT_PROTOCOL_ID = 'trace.capability-content' as const;
export const CAPABILITY_CONTENT_PROTOCOL_VERSION = '0.2.0' as const;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type CapabilitySourceKind = 'mywiki-cognitive-source' | 'mixed' | 'user-authored';
export type CapabilityNetworkPolicy = 'none' | 'declared-only' | 'host-managed';

export interface CapabilityExternalReference {
  uri: string;
  title: string;
  observed_at: string;
}

export interface CapabilityProvenance {
  source_kind: CapabilitySourceKind;
  source_refs: RecordRef[];
  change_id: string;
  /** The adopted semantic candidate this artifact was compiled from. */
  capability_candidate_ref?: RecordRef;
  source_revision?: string;
  external_references?: CapabilityExternalReference[];
}

export interface CapabilityContentContract {
  protocol_id: typeof CAPABILITY_CONTENT_PROTOCOL_ID;
  protocol_version: typeof CAPABILITY_CONTENT_PROTOCOL_VERSION;
  entrypoint: {path: 'SKILL.md'; name: string; description: string};
  triggers: {positive: string[]; negative: string[]};
  workflow: {inputs: string[]; steps: string[]; outputs: string[]; failure_modes: string[]; stop_conditions: string[]};
  acceptance: {structural: string[]; behavioral: string[]; user_visible: string[]};
  security: {secret_policy: 'never_include'; network_policy: CapabilityNetworkPolicy; forbidden_scopes: string[]};
  provenance: CapabilityProvenance;
}

type AnyCapabilityContentProtocol = ProtocolVersioned & Record<string, unknown>;
const capabilityContentUpcasters = new ProtocolVersionRegistry<AnyCapabilityContentProtocol>();
capabilityContentUpcasters.register({protocol_id: CAPABILITY_CONTENT_PROTOCOL_ID, from_version: '0.1.0', to_version: CAPABILITY_CONTENT_PROTOCOL_VERSION, upcast(value) { return {...value, protocol_version: CAPABILITY_CONTENT_PROTOCOL_VERSION}; }});

function boundedList(value: unknown, field: string, min: number, max: number): string[] {
  return requireStringList(value, field, {min, max, itemMax: 1000});
}

function refs(value: unknown, field: string): RecordRef[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) throw new ProtocolError('INVALID_FIELD', `${field} must contain 1-128 references`);
  const result = value.map((item, index) => validateRecordRef(item, `${field}[${index}]`));
  const identities = new Set(result.map(item => `${item.record_id}@${item.revision}`));
  if (identities.size !== result.length) throw new ProtocolError('INVALID_FIELD', `${field} contains duplicate references`);
  return result;
}

export function validateCapabilityProvenance(value: unknown): CapabilityProvenance {
  const item = record(value, 'provenance');
  rejectUnknown(item, ['source_kind', 'source_refs', 'change_id', 'capability_candidate_ref', 'source_revision', 'external_references'], 'provenance');
  const sourceKind = item.source_kind;
  if (sourceKind !== 'mywiki-cognitive-source' && sourceKind !== 'mixed' && sourceKind !== 'user-authored') throw new ProtocolError('INVALID_FIELD', 'provenance.source_kind is not supported');
  const externalValue = item.external_references;
  const external = externalValue === undefined ? undefined : (() => {
    if (!Array.isArray(externalValue) || externalValue.length > 64) throw new ProtocolError('INVALID_FIELD', 'provenance.external_references must contain at most 64 items');
    return externalValue.map((raw, index) => {
      const ref = record(raw, `provenance.external_references[${index}]`);
      rejectUnknown(ref, ['uri', 'title', 'observed_at'], `provenance.external_references[${index}]`);
      const uri = text(ref.uri, `provenance.external_references[${index}].uri`, 2000);
      if (!/^https?:\/\//i.test(uri)) throw new ProtocolError('INVALID_FIELD', `provenance.external_references[${index}].uri must be https/http`);
      const observed = text(ref.observed_at, `provenance.external_references[${index}].observed_at`, 80);
      if (Number.isNaN(Date.parse(observed))) throw new ProtocolError('INVALID_FIELD', `provenance.external_references[${index}].observed_at must be an ISO timestamp`);
      return {uri, title: text(ref.title, `provenance.external_references[${index}].title`, 500), observed_at: observed};
    });
  })();
  const candidateRef = item.capability_candidate_ref === undefined ? undefined : validateRecordRef(item.capability_candidate_ref, 'provenance.capability_candidate_ref');
  return {
    source_kind: sourceKind,
    source_refs: refs(item.source_refs, 'provenance.source_refs'),
    change_id: text(item.change_id, 'provenance.change_id', 128),
    ...(candidateRef === undefined ? {} : {capability_candidate_ref: candidateRef}),
    ...(item.source_revision === undefined ? {} : {source_revision: text(item.source_revision, 'provenance.source_revision', 128)}),
    ...(external === undefined ? {} : {external_references: external}),
  };
}

export function validateCapabilityContentContract(value: unknown): CapabilityContentContract {
  const raw = record(value, 'content_contract');
  if (raw.protocol_id !== CAPABILITY_CONTENT_PROTOCOL_ID) throw new ProtocolError('PROTOCOL_MISMATCH', 'Unsupported capability content contract');
  const item = raw.protocol_version === '0.1.0' ? capabilityContentUpcasters.upgrade(raw as AnyCapabilityContentProtocol, CAPABILITY_CONTENT_PROTOCOL_VERSION) as Record<string, unknown> : raw;
  rejectUnknown(item, ['protocol_id', 'protocol_version', 'entrypoint', 'triggers', 'workflow', 'acceptance', 'security', 'provenance'], 'content_contract');
  if (item.protocol_version !== CAPABILITY_CONTENT_PROTOCOL_VERSION) throw new ProtocolError('PROTOCOL_MIGRATION_REQUIRED', `Unsupported capability content protocol version: ${String(item.protocol_version)}`);
  const entrypoint = record(item.entrypoint, 'content_contract.entrypoint');
  rejectUnknown(entrypoint, ['path', 'name', 'description'], 'content_contract.entrypoint');
  if (entrypoint.path !== 'SKILL.md') throw new ProtocolError('INVALID_FIELD', 'content_contract.entrypoint.path must be SKILL.md');
  const triggers = record(item.triggers, 'content_contract.triggers');
  rejectUnknown(triggers, ['positive', 'negative'], 'content_contract.triggers');
  const workflow = record(item.workflow, 'content_contract.workflow');
  rejectUnknown(workflow, ['inputs', 'steps', 'outputs', 'failure_modes', 'stop_conditions'], 'content_contract.workflow');
  const acceptance = record(item.acceptance, 'content_contract.acceptance');
  rejectUnknown(acceptance, ['structural', 'behavioral', 'user_visible'], 'content_contract.acceptance');
  const security = record(item.security, 'content_contract.security');
  rejectUnknown(security, ['secret_policy', 'network_policy', 'forbidden_scopes'], 'content_contract.security');
  if (security.secret_policy !== 'never_include') throw new ProtocolError('INVALID_FIELD', 'content_contract.security.secret_policy must be never_include');
  if (security.network_policy !== 'none' && security.network_policy !== 'declared-only' && security.network_policy !== 'host-managed') throw new ProtocolError('INVALID_FIELD', 'content_contract.security.network_policy is not supported');
  const entrypointName = text(entrypoint.name, 'content_contract.entrypoint.name', 64);
  if (!SKILL_NAME_PATTERN.test(entrypointName)) throw new ProtocolError('INVALID_FIELD', 'content_contract.entrypoint.name must use lowercase letters, numbers, and single hyphens');
  return {
    protocol_id: CAPABILITY_CONTENT_PROTOCOL_ID,
    protocol_version: CAPABILITY_CONTENT_PROTOCOL_VERSION,
    entrypoint: {path: 'SKILL.md', name: entrypointName, description: text(entrypoint.description, 'content_contract.entrypoint.description', 1024)},
    triggers: {positive: boundedList(triggers.positive, 'content_contract.triggers.positive', 1, 64), negative: boundedList(triggers.negative ?? [], 'content_contract.triggers.negative', 0, 64)},
    workflow: {
      inputs: boundedList(workflow.inputs, 'content_contract.workflow.inputs', 1, 64),
      steps: boundedList(workflow.steps, 'content_contract.workflow.steps', 1, 128),
      outputs: boundedList(workflow.outputs, 'content_contract.workflow.outputs', 1, 64),
      failure_modes: boundedList(workflow.failure_modes, 'content_contract.workflow.failure_modes', 1, 64),
      stop_conditions: boundedList(workflow.stop_conditions, 'content_contract.workflow.stop_conditions', 1, 64),
    },
    acceptance: {
      structural: boundedList(acceptance.structural, 'content_contract.acceptance.structural', 1, 64),
      behavioral: boundedList(acceptance.behavioral, 'content_contract.acceptance.behavioral', 1, 64),
      user_visible: boundedList(acceptance.user_visible, 'content_contract.acceptance.user_visible', 1, 64),
    },
    security: {secret_policy: 'never_include', network_policy: security.network_policy, forbidden_scopes: boundedList(security.forbidden_scopes, 'content_contract.security.forbidden_scopes', 0, 64)},
    provenance: validateCapabilityProvenance(item.provenance),
  };
}

export function validateSkillEntrypoint(content: string, contract: CapabilityContentContract): void {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) throw new ProtocolError('INVALID_CONTENT', 'SKILL.md must begin with YAML frontmatter');
  const body = frontmatter[1]!;
  const name = body.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  if (name !== contract.entrypoint.name) throw new ProtocolError('INVALID_CONTENT', 'SKILL.md frontmatter name does not match content_contract.entrypoint.name');
  const descriptionLine = body.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (!descriptionLine) throw new ProtocolError('INVALID_CONTENT', 'SKILL.md frontmatter requires a description');
  if (descriptionLine !== '>' && descriptionLine !== '>-' && descriptionLine !== '|' && descriptionLine !== '|-' && descriptionLine !== '|+') {
    const normalizedFile = descriptionLine.replace(/^['"]|['"]$/g, '').replace(/\s+/g, ' ');
    const normalizedContract = contract.entrypoint.description.replace(/\s+/g, ' ');
    if (normalizedFile !== normalizedContract) throw new ProtocolError('INVALID_CONTENT', 'SKILL.md frontmatter description does not match content_contract.entrypoint.description');
  }
  if (content.slice(frontmatter[0].length).trim().length === 0) throw new ProtocolError('INVALID_CONTENT', 'SKILL.md body must not be empty');
}
