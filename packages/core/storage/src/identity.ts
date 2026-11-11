import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {StorageError} from './jsonl.js';

/**
 * Durable identity metadata shared by the SQLite-backed Trace ledgers.
 *
 * The Product/Agent hosts have a dependency-free `.mjs` implementation of
 * this contract.  Keeping the storage-side representation here avoids making
 * the core packages depend on an application entrypoint while preserving the
 * same field names and identity derivation algorithm.
 */
export const DATABASE_IDENTITY_SCHEMA_VERSION = 1;
export const DATABASE_IDENTITY_TABLE = 'trace_runtime_identity';
export const RUNTIME_IDENTITY_PROTOCOL_VERSION = 1;
export const TRACE_PRODUCT_ID = 'trace';
export const TRACE_PROJECT_SERVICE_ID = 'trace-project-runtime';
export const DATABASE_ROLES = {
  project: 'project-runtime',
  product: 'product-web',
  agent: 'agent-runtime',
} as const;

export type DatabaseRole = typeof DATABASE_ROLES[keyof typeof DATABASE_ROLES];
export type IdentityState = 'verified' | 'legacy' | 'unverified';

export interface DatabaseIdentity {
  id: number;
  schema_version: number;
  product_id: typeof TRACE_PRODUCT_ID;
  service_id: string;
  role: DatabaseRole;
  protocol_version: number;
  runtime_version: string;
  installation_id: string | null;
  workspace_id: string | null;
  verification_state: IdentityState;
  created_at: string;
}

export interface DatabaseIdentityOptions {
  workspaceId?: string;
  installationId?: string;
  runtimeVersion?: string;
  allowLegacyIdentity?: boolean;
}

export const DATABASE_IDENTITY_COLUMNS = [
  'id', 'schema_version', 'product_id', 'service_id', 'role',
  'protocol_version', 'runtime_version', 'installation_id',
  'workspace_id', 'verification_state', 'created_at',
] as const;

function fail(code: string, message: string): never {
  throw new StorageError(code, message);
}

function safeIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value)
    && !['__proto__', 'constructor', 'prototype'].includes(value);
}

function semver(value: unknown): value is string {
  return typeof value === 'string'
    && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function safeTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
}

function realpathOrResolve(file: string): string {
  try { return fs.realpathSync.native(file); } catch { return path.resolve(file); }
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function deriveDatabaseIdentity(file: string): {workspace_id: string; installation_id: string} {
  if (!path.isAbsolute(file)) fail('INVALID_PATH', 'SQLite state file must be an absolute path');
  const target = path.resolve(file);
  const workspaceRoot = realpathOrResolve(path.dirname(target));
  const installationRoot = realpathOrResolve(path.dirname(workspaceRoot));
  return {
    workspace_id: `workspace-${digest(workspaceRoot).slice(0, 40)}`,
    installation_id: `installation-${digest(installationRoot).slice(0, 40)}`,
  };
}

export function databaseIdentityTemplate(input: {
  role: DatabaseRole;
  serviceId: string;
  file?: string;
  workspaceId?: string;
  installationId?: string;
  runtimeVersion?: string;
  verificationState?: IdentityState;
  createdAt?: string;
}): DatabaseIdentity {
  const state = input.verificationState ?? 'verified';
  if (!Object.values(DATABASE_ROLES).includes(input.role)) fail('INVALID_DATABASE_ROLE', 'unknown Trace database role');
  if (!safeIdentity(input.serviceId)) fail('INVALID_IDENTITY', 'service_id is not a valid Trace identity');
  const runtimeVersion = input.runtimeVersion ?? '0.7.1';
  if (!semver(runtimeVersion)) fail('RUNTIME_VERSION_INVALID', 'runtime_version must be a semantic version');
  if (!['verified', 'legacy', 'unverified'].includes(state)) fail('INVALID_IDENTITY_STATE', 'unknown database identity state');
  const derived = input.file === undefined ? undefined : deriveDatabaseIdentity(input.file);
  const workspace = input.workspaceId ?? derived?.workspace_id;
  const installation = input.installationId ?? derived?.installation_id;
  if (state === 'verified' && (!safeIdentity(workspace) || !safeIdentity(installation))) {
    fail('IDENTITY_MISSING', 'verified database identity requires installation/workspace identity');
  }
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!safeTimestamp(createdAt)) fail('INVALID_IDENTITY', 'created_at is not a valid identity timestamp');
  return {
    id: 1,
    schema_version: DATABASE_IDENTITY_SCHEMA_VERSION,
    product_id: TRACE_PRODUCT_ID,
    service_id: input.serviceId,
    role: input.role,
    protocol_version: RUNTIME_IDENTITY_PROTOCOL_VERSION,
    runtime_version: runtimeVersion,
    installation_id: state === 'verified' ? workspaceIdentity(installation) : null,
    workspace_id: state === 'verified' ? workspaceIdentity(workspace) : null,
    verification_state: state,
    created_at: createdAt,
  };
}

function workspaceIdentity(value: string | undefined): string {
  // The caller has already checked the value in the verified branch. Keeping
  // this narrow assertion local makes the returned interface non-optional.
  if (!safeIdentity(value)) fail('IDENTITY_MISSING', 'verified database identity requires installation/workspace identity');
  return value;
}

export function validateDatabaseIdentity(value: unknown, expected: {
  role?: DatabaseRole;
  serviceId?: string;
  workspaceId?: string;
  installationId?: string;
} = {}): DatabaseIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('DATABASE_IDENTITY_INVALID', 'database identity metadata is not an object');
  const candidate = value as Record<string, unknown>;
  if (candidate.id !== 1 || candidate.schema_version !== DATABASE_IDENTITY_SCHEMA_VERSION
    || candidate.protocol_version !== RUNTIME_IDENTITY_PROTOCOL_VERSION || candidate.product_id !== TRACE_PRODUCT_ID
    || !Object.values(DATABASE_ROLES).includes(candidate.role as DatabaseRole)
    || !safeIdentity(candidate.service_id) || !semver(candidate.runtime_version)
    || !['verified', 'legacy', 'unverified'].includes(String(candidate.verification_state))
    || !safeTimestamp(candidate.created_at)) {
    fail('DATABASE_IDENTITY_INVALID', 'database identity metadata is not a supported Trace identity');
  }
  const state = candidate.verification_state as IdentityState;
  if (state === 'verified') {
    if (!safeIdentity(candidate.workspace_id) || !safeIdentity(candidate.installation_id)) fail('DATABASE_IDENTITY_INVALID', 'verified database identity is missing IDs');
  } else if (candidate.workspace_id !== null || candidate.installation_id !== null) {
    fail('DATABASE_IDENTITY_INVALID', 'legacy database identity must not claim verified IDs');
  }
  if (expected.role !== undefined && candidate.role !== expected.role) fail('DATABASE_ROLE_MISMATCH', 'database role does not match the requested Trace service');
  if (expected.serviceId !== undefined && candidate.service_id !== expected.serviceId) fail('DATABASE_ROLE_MISMATCH', 'database service does not match the requested Trace service');
  if (expected.workspaceId !== undefined && candidate.workspace_id !== expected.workspaceId) fail('DATABASE_IDENTITY_MISMATCH', 'database workspace identity does not match');
  if (expected.installationId !== undefined && candidate.installation_id !== expected.installationId) fail('DATABASE_IDENTITY_MISMATCH', 'database installation identity does not match');
  return {
    id: candidate.id,
    schema_version: candidate.schema_version,
    product_id: TRACE_PRODUCT_ID,
    service_id: candidate.service_id,
    role: candidate.role as DatabaseRole,
    protocol_version: candidate.protocol_version,
    runtime_version: candidate.runtime_version,
    installation_id: candidate.installation_id as string | null,
    workspace_id: candidate.workspace_id as string | null,
    verification_state: state,
    created_at: String(candidate.created_at),
  };
}
