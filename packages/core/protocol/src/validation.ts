import {ProtocolError} from './change-set.js';

export interface StringListOptions {
  min?: number;
  max?: number;
  itemMax?: number;
}

/** Shared protocol primitives. Domain validators retain their own field lists and semantic rules. */
export function requireText(value: unknown, field: string, max = 512): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) throw new ProtocolError('INVALID_FIELD', `${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}

export function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ProtocolError('INVALID_FIELD', `${field} must be an object`);
  return value as Record<string, unknown>;
}

export function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length > 0) throw new ProtocolError('UNKNOWN_FIELD', `${field} contains unsupported fields: ${unknown.join(', ')}`);
}

export function requireStringList(value: unknown, field: string, options: StringListOptions = {}): string[] {
  const min = options.min ?? 0;
  const max = options.max ?? 128;
  const itemMax = options.itemMax ?? 500;
  if (!Array.isArray(value) || value.length < min || value.length > max || value.some(item => typeof item !== 'string' || item.trim().length === 0 || item.length > itemMax)) throw new ProtocolError('INVALID_FIELD', `${field} must contain ${min === max ? min : `${min}-${max}`} non-empty strings`);
  return value.map(item => String(item).trim());
}

export function optionalStringList(value: unknown, field: string, options: StringListOptions = {}): string[] {
  return value === undefined ? [] : requireStringList(value, field, options);
}
