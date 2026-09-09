import {createHash} from 'node:crypto';
import {ProtocolError} from '../../protocol/src/index.js';

export const CONTEXT_PROTOCOL_ID = 'trace.context-record' as const;
export const CONTEXT_PROTOCOL_VERSION = '0.1.0' as const;

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

function text(value: unknown, field: string, max = 2000): string {
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
  const item = object(value, 'activation_pack');
  rejectUnknown(item, ['protocol_id', 'protocol_version', 'pack_id', 'thread_id', 'purpose', 'summary', 'source_refs', 'read_pointers', 'budget', 'forbidden_scopes', 'required_user_action', 'generated_at'], 'activation_pack');
  if (item.protocol_id !== CONTEXT_PROTOCOL_ID || item.protocol_version !== CONTEXT_PROTOCOL_VERSION) throw new ProtocolError('PROTOCOL_MISMATCH', 'Unsupported context protocol');
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
