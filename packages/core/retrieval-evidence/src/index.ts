import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import type {CreateDataRecord, DataClassification} from '../../data/src/index.js';
import {canonicalize, ProtocolError, requireText} from '../../protocol/src/index.js';

export const HOST_RETRIEVAL_EVIDENCE_SCHEMA_ID = 'trace.host-retrieval-evidence' as const;
export const HOST_RETRIEVAL_EVIDENCE_SCHEMA_VERSION = '0.1.0' as const;
export const HOST_RETRIEVAL_EVIDENCE_COMPONENT = 'trace.host-native-retrieval' as const;
export const HOST_RETRIEVAL_EVIDENCE_COMPONENT_VERSION = '0.1.0' as const;

export type HostRetrievalMode = 'native_observed' | 'disabled';
export type HostRetrievalEventKind =
  | 'source_access_offered'
  | 'source_search'
  | 'source_read'
  | 'source_access_unclassified';

export interface HostRetrievalPolicy {
  mode: HostRetrievalMode;
  /** Formal relative prefixes that the host is invited to inspect. */
  allowed_prefixes: string[];
  /** Bounded, host-visible advisory budget. It is not a filesystem sandbox. */
  max_reads_per_turn: number;
}

export interface HostPageVersion {
  locator: string;
  revision: number;
  content_hash: string;
}

export interface CreateHostRetrievalEvidence {
  event_kind: HostRetrievalEventKind;
  source_id: string;
  source_scope: {type: 'personal' | 'project' | 'team' | 'domain'; id: string};
  policy: HostRetrievalPolicy;
  host: 'codex';
  host_session_id: string;
  host_turn_id?: string;
  host_tool_name?: string;
  host_tool_use_id?: string;
  /** SHA-256 only. The raw hook tool input must never be persisted. */
  input_hash?: string;
  /** SHA-256 only. The raw tool output must never be persisted. */
  output_hash?: string;
  locators?: string[];
  page_versions?: HostPageVersion[];
  observed_at?: string;
  causation_id: string;
  correlation_id: string;
  producer?: {component: string; version: string; run_id: string};
  classification?: DataClassification;
}

export interface NativeToolObservation {
  host: 'codex';
  host_session_id: string;
  host_turn_id?: string;
  host_tool_name: string;
  host_tool_use_id?: string;
  tool_input: unknown;
  tool_response?: unknown;
}

export interface NativeSourceLocation {
  root: string;
  formal_prefix: string;
  policy: HostRetrievalPolicy;
}

export interface ClassifiedNativeSourceAccess {
  event_kind: Exclude<HostRetrievalEventKind, 'source_access_offered'>;
  locators: string[];
  input_hash: string;
  output_hash?: string;
}

function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function canonicalHash(value: unknown): string { return sha256(JSON.stringify(canonicalize(value)) ?? 'null'); }
function iso(value: string): string {
  if (Number.isNaN(Date.parse(value))) throw new ProtocolError('INVALID_FIELD', 'observed_at must be an ISO timestamp');
  return value;
}
function text(value: unknown, field: string, max = 240): string { return requireText(value, field, max); }
function safeRelative(value: string, field = 'locator'): string {
  const normalized = value.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(part => part === '' || part === '.' || part === '..')) throw new ProtocolError('INVALID_FIELD', `${field} must be a safe relative path`);
  if (!normalized.toLowerCase().endsWith('.md')) throw new ProtocolError('INVALID_FIELD', `${field} must identify a Markdown formal page`);
  return normalized;
}
function safePrefix(value: string, field = 'allowed_prefix'): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.split('/').some(part => part === '' || part === '.' || part === '..')) throw new ProtocolError('INVALID_FIELD', `${field} must be a safe relative directory prefix`);
  return normalized;
}
function dedupe<T>(values: T[], identity: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter(value => { const key = identity(value); if (seen.has(key)) return false; seen.add(key); return true; });
}

export function normalizeHostRetrievalPolicy(value: Partial<HostRetrievalPolicy> | undefined, formalPrefix = 'wiki'): HostRetrievalPolicy {
  const mode = value?.mode ?? 'native_observed';
  if (mode !== 'native_observed' && mode !== 'disabled') throw new ProtocolError('INVALID_FIELD', 'host_retrieval.mode must be native_observed or disabled');
  const rawPrefixes = value?.allowed_prefixes ?? [formalPrefix];
  if (!Array.isArray(rawPrefixes) || rawPrefixes.length === 0 || rawPrefixes.length > 32) throw new ProtocolError('INVALID_FIELD', 'host_retrieval.allowed_prefixes must contain 1-32 prefixes');
  const allowed_prefixes = dedupe(rawPrefixes.map((item, index) => safePrefix(text(item, `host_retrieval.allowed_prefixes[${index}]`, 500))), value => value);
  const maxReads = value?.max_reads_per_turn ?? 8;
  if (!Number.isInteger(maxReads) || maxReads < 1 || maxReads > 64) throw new ProtocolError('INVALID_FIELD', 'host_retrieval.max_reads_per_turn must be an integer between 1 and 64');
  return {mode, allowed_prefixes, max_reads_per_turn: maxReads};
}

export function hashHostRetrievalPolicy(policy: HostRetrievalPolicy): string {
  return canonicalHash(policy);
}

function optionalText(value: unknown, field: string, max = 240): string | undefined {
  return value === undefined ? undefined : text(value, field, max);
}
function optionalHash(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  const candidate = text(value, field, 128).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(candidate)) throw new ProtocolError('INVALID_FIELD', `${field} must be a sha256 hash`);
  return candidate;
}
function pages(value: HostPageVersion[] | undefined): HostPageVersion[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) throw new ProtocolError('INVALID_FIELD', 'page_versions must contain at most 64 pages');
  return dedupe(value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new ProtocolError('INVALID_FIELD', `page_versions[${index}] must be an object`);
    const revision = (item as HostPageVersion).revision;
    if (!Number.isInteger(revision) || revision < 1) throw new ProtocolError('INVALID_FIELD', `page_versions[${index}].revision must be positive`);
    const content_hash = optionalHash((item as HostPageVersion).content_hash, `page_versions[${index}].content_hash`)!;
    return {locator: safeRelative((item as HostPageVersion).locator, `page_versions[${index}].locator`), revision, content_hash};
  }), page => page.locator).sort((left, right) => left.locator.localeCompare(right.locator));
}

/**
 * Build one immutable, provenance-only host retrieval record. It has no raw
 * prompt, source body, absolute source root, tool input or tool output field.
 */
export function buildHostRetrievalEvidenceRecord(input: CreateHostRetrievalEvidence): CreateDataRecord {
  const event_kind = input.event_kind;
  if (!['source_access_offered', 'source_search', 'source_read', 'source_access_unclassified'].includes(event_kind)) throw new ProtocolError('INVALID_FIELD', 'unsupported host retrieval event_kind');
  const source_id = text(input.source_id, 'source_id');
  const policy = normalizeHostRetrievalPolicy(input.policy);
  if (input.host !== 'codex') throw new ProtocolError('INVALID_FIELD', 'host retrieval evidence currently supports codex only');
  const host_session_id = text(input.host_session_id, 'host_session_id');
  const host_turn_id = optionalText(input.host_turn_id, 'host_turn_id');
  const host_tool_name = optionalText(input.host_tool_name, 'host_tool_name', 160);
  const host_tool_use_id = optionalText(input.host_tool_use_id, 'host_tool_use_id');
  const input_hash = optionalHash(input.input_hash, 'input_hash');
  const output_hash = optionalHash(input.output_hash, 'output_hash');
  const locators = dedupe((input.locators ?? []).map((item, index) => safeRelative(text(item, `locators[${index}]`, 2000))), value => value).sort();
  const page_versions = pages(input.page_versions);
  if (event_kind === 'source_read' && (locators.length === 0 || page_versions.length === 0)) throw new ProtocolError('INVALID_FIELD', 'source_read evidence requires locators and page_versions');
  if (event_kind !== 'source_read' && page_versions.length > 0) throw new ProtocolError('INVALID_FIELD', 'only source_read evidence may include page_versions');
  if (event_kind !== 'source_access_offered' && host_tool_name === undefined) throw new ProtocolError('INVALID_FIELD', 'tool evidence requires host_tool_name');
  if (event_kind !== 'source_access_offered' && input_hash === undefined) throw new ProtocolError('INVALID_FIELD', 'tool evidence requires input_hash');
  const observed_at = iso(input.observed_at ?? new Date().toISOString());
  const evidence_id = `host-retrieval-${randomUUID()}`;
  const source_scope = input.source_scope;
  if (!source_scope || !['personal', 'project', 'team', 'domain'].includes(source_scope.type)) throw new ProtocolError('INVALID_FIELD', 'source_scope.type is invalid');
  const scopeId = text(source_scope.id, 'source_scope.id');
  const payloadWithoutContentHash = {
    evidence_id,
    event_kind,
    source_id,
    host: input.host,
    host_session_id,
    ...(host_turn_id === undefined ? {} : {host_turn_id}),
    ...(host_tool_name === undefined ? {} : {host_tool_name}),
    ...(host_tool_use_id === undefined ? {} : {host_tool_use_id}),
    ...(input_hash === undefined ? {} : {input_hash}),
    ...(output_hash === undefined ? {} : {output_hash}),
    locators,
    page_versions,
    policy: {mode: policy.mode, allowed_prefixes: policy.allowed_prefixes, max_reads_per_turn: policy.max_reads_per_turn, policy_hash: hashHostRetrievalPolicy(policy)},
    observed_at,
  };
  const content_hash = canonicalHash(payloadWithoutContentHash);
  const payload = {...payloadWithoutContentHash, content_hash};
  const subjectDigest = sha256(JSON.stringify({source_id, event_kind, host_session_id, host_turn_id, host_tool_use_id, input_hash, observed_at})).slice(0, 32);
  return {
    kind: 'host_retrieval_evidence',
    status: 'captured',
    schema_id: HOST_RETRIEVAL_EVIDENCE_SCHEMA_ID,
    schema_version: HOST_RETRIEVAL_EVIDENCE_SCHEMA_VERSION,
    subject: {type: 'host_retrieval_evidence', id: `${source_id}:${subjectDigest}`},
    scope: {type: source_scope.type, id: scopeId},
    origin: {provider: 'codex-native-host', source_id, captured_at: observed_at, content_hash},
    producer: input.producer ?? {component: HOST_RETRIEVAL_EVIDENCE_COMPONENT, version: HOST_RETRIEVAL_EVIDENCE_COMPONENT_VERSION, run_id: `host:${host_session_id}`},
    lineage: {parent_refs: [], source_refs: [], causation_id: text(input.causation_id, 'causation_id'), correlation_id: text(input.correlation_id, 'correlation_id')},
    classification: input.classification ?? 'internal',
    payload,
  };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function stringLeaves(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') { output.push(value); return output; }
  if (Array.isArray(value)) { for (const item of value) stringLeaves(item, output); return output; }
  const object = asObject(value);
  if (object) for (const item of Object.values(object)) stringLeaves(item, output);
  return output;
}
function commandFrom(value: unknown): string | undefined {
  const object = asObject(value);
  return typeof object?.command === 'string' ? object.command : undefined;
}
function absoluteCandidate(value: string, location: NativeSourceLocation): string | undefined {
  const candidate = value.trim().replace(/^['"]|['"]$/g, '');
  if (!path.isAbsolute(candidate)) return undefined;
  const root = path.resolve(location.root);
  const absolute = path.resolve(candidate);
  const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return undefined;
  try {
    const locator = safeRelative(relative);
    const allowed = location.policy.allowed_prefixes.some(prefix => locator === prefix || locator.startsWith(`${prefix}/`));
    return allowed ? locator : undefined;
  } catch { return undefined; }
}
function quotedCandidates(command: string): string[] {
  const values: string[] = [];
  for (const match of command.matchAll(/(?:"([^"]+)"|'([^']+)')/g)) values.push(match[1] ?? match[2] ?? '');
  return values;
}
function escapedPattern(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function commandPageCandidates(command: string, location: NativeSourceLocation): string[] {
  const values = quotedCandidates(command);
  const root = path.resolve(location.root).replaceAll('/', path.sep);
  // Add unquoted absolute Markdown paths rooted in the authorized source.
  const normalizedRoot = root.replaceAll('\\', '/');
  const sourcePattern = new RegExp(`${escapedPattern(normalizedRoot)}[^\\r\\n\"']*?\\.md`, 'gi');
  for (const match of command.replaceAll('\\', '/').matchAll(sourcePattern)) values.push(match[0]);
  return values;
}
function isSearchCommand(command: string): boolean { return /(?:^|[;&|]\s*|\s)(rg|grep|select-string|findstr|find|ls|dir|get-childitem|gci)\b/i.test(command); }
function isReadCommand(command: string): boolean { return /(?:^|[;&|]\s*|\s)(cat|get-content|gc|type|more|head|tail|sed)\b/i.test(command); }
function hasSourceRoot(value: string, location: NativeSourceLocation): boolean {
  const root = path.resolve(location.root).replaceAll('\\', '/').toLowerCase();
  return value.replaceAll('\\', '/').toLowerCase().includes(root);
}

/**
 * Classify a native Codex tool event without retaining its arguments or output.
 * This is intentionally conservative: unknown source-touching command forms
 * become source_access_unclassified rather than a false source_read claim.
 */
export function classifyNativeSourceAccess(observation: NativeToolObservation, location: NativeSourceLocation): ClassifiedNativeSourceAccess | undefined {
  if (location.policy.mode !== 'native_observed') return undefined;
  const toolName = text(observation.host_tool_name, 'host_tool_name', 160);
  const rawInput = observation.tool_input;
  const input_hash = canonicalHash(rawInput);
  const output_hash = observation.tool_response === undefined ? undefined : canonicalHash(observation.tool_response);
  const leaves = stringLeaves(rawInput);
  const command = commandFrom(rawInput);
  const locators = dedupe([
    ...leaves.map(value => absoluteCandidate(value, location)).filter((value): value is string => value !== undefined),
    ...(command === undefined ? [] : commandPageCandidates(command, location).map(value => absoluteCandidate(value, location)).filter((value): value is string => value !== undefined)),
  ], value => value).sort();
  const touchesSource = leaves.some(value => hasSourceRoot(value, location));
  if (!touchesSource) return undefined;
  if (toolName === 'Bash' && command !== undefined) {
    if (isReadCommand(command) && locators.length > 0) return {event_kind: 'source_read', locators, input_hash, ...(output_hash === undefined ? {} : {output_hash})};
    if (isSearchCommand(command)) return {event_kind: 'source_search', locators: [], input_hash, ...(output_hash === undefined ? {} : {output_hash})};
    return {event_kind: 'source_access_unclassified', locators: [], input_hash, ...(output_hash === undefined ? {} : {output_hash})};
  }
  if (locators.length > 0) return {event_kind: 'source_read', locators, input_hash, ...(output_hash === undefined ? {} : {output_hash})};
  return {event_kind: 'source_access_unclassified', locators: [], input_hash, ...(output_hash === undefined ? {} : {output_hash})};
}
