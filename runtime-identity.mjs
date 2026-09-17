import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Runtime identity is deliberately a small, dependency-free contract shared
 * by the HTTP hosts and the SQLite owners.  Ports are only discovery hints;
 * callers must verify these values before treating a response as Trace data.
 */
export const RUNTIME_IDENTITY_PROTOCOL_VERSION = 1;
export const RUNTIME_IDENTITY_PROTOCOL = 'trace.runtime.identity@1';
export const TRACE_PRODUCT_ID = 'trace';
export const TRACE_PRODUCT_SERVICE_ID = 'trace-product-service';
export const TRACE_AGENT_SERVICE_ID = 'trace-agent-service';
export const TRACE_PROJECT_SERVICE_ID = 'trace-project-runtime';
export const DATABASE_IDENTITY_SCHEMA_VERSION = 1;
export const DATABASE_IDENTITY_TABLE = 'trace_runtime_identity';
export const DATABASE_ROLES = Object.freeze({
  product: 'product-web',
  agent: 'agent-runtime',
  project: 'project-runtime',
});
export const IDENTITY_STATES = Object.freeze(['verified', 'legacy', 'unverified']);

// These are intentionally source and package entrypoints, not a list of
// arbitrary files that happens to exist in a checkout.  A root is usable only
// when all three bounded service seams are present.
export const REQUIRED_RUNTIME_ENTRYPOINTS = Object.freeze([
  'apps/desktop/server.mjs',
  'apps/agent/backend.mjs',
  'packages/product/workspace/src/workspace.mjs',
]);
const REQUIRED_RELEASE_FILES = Object.freeze(['runtime.json', ...REQUIRED_RUNTIME_ENTRYPOINTS]);

export class RuntimeIdentityError extends Error {
  constructor(code, message, details = undefined, status = 503) {
    super(message);
    this.name = 'TraceRuntimeIdentityError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details, status) {
  throw new RuntimeIdentityError(code, message, details, status);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

/** Values crossing the identity boundary never contain paths or credentials. */
export function isSafeIdentity(value, max = 256) {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value)
    && !['__proto__', 'constructor', 'prototype'].includes(value);
}

export function assertSafeIdentity(value, label = 'identity', max = 256) {
  if (!isSafeIdentity(value, max)) fail('INVALID_IDENTITY', `${label} is not a valid Trace identity`, {label}, 500);
  return value;
}

export function isSemver(value) {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

export function assertRuntimeVersion(value, label = 'runtime_version') {
  if (!isSemver(value)) fail('RUNTIME_VERSION_INVALID', `${label} must be a semantic version`, {label}, 500);
  return value;
}

function realpathOrResolve(file) {
  try { return fs.realpathSync.native(file); } catch { return path.resolve(file); }
}

/**
 * The directory containing the database is the workspace identity boundary.
 * This permits a harmless database filename change while still detecting a
 * database copied into another workspace.  Installation identity uses the
 * parent of that directory, so two workspaces in one installation remain
 * distinguishable.
 */
export function deriveDatabaseIdentity(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) fail('INVALID_PATH', 'database path must be absolute', undefined, 500);
  const target = path.resolve(file);
  const workspaceRoot = realpathOrResolve(path.dirname(target));
  const installationRoot = realpathOrResolve(path.dirname(workspaceRoot));
  return {
    workspace_id: `workspace-${sha256(workspaceRoot).slice(0, 40)}`,
    installation_id: `installation-${sha256(installationRoot).slice(0, 40)}`,
  };
}

export function databaseIdentityTemplate({
  role,
  serviceId,
  runtimeVersion = '0.0.0',
  file,
  workspaceId,
  installationId,
  verificationState = 'verified',
  createdAt = new Date().toISOString(),
} = {}) {
  if (!Object.values(DATABASE_ROLES).includes(role)) fail('INVALID_DATABASE_ROLE', 'unknown Trace database role', {role}, 500);
  assertSafeIdentity(serviceId, 'service_id');
  assertRuntimeVersion(runtimeVersion);
  const derived = file === undefined ? {} : deriveDatabaseIdentity(file);
  const workspace = workspaceId ?? derived.workspace_id;
  const installation = installationId ?? derived.installation_id;
  if (verificationState === 'verified') {
    assertSafeIdentity(workspace, 'workspace_id');
    assertSafeIdentity(installation, 'installation_id');
  } else if (!IDENTITY_STATES.includes(verificationState)) {
    fail('INVALID_IDENTITY_STATE', 'unknown database identity state', {verificationState}, 500);
  }
  return {
    id: 1,
    schema_version: DATABASE_IDENTITY_SCHEMA_VERSION,
    product_id: TRACE_PRODUCT_ID,
    service_id: serviceId,
    role,
    protocol_version: RUNTIME_IDENTITY_PROTOCOL_VERSION,
    runtime_version: runtimeVersion,
    installation_id: verificationState === 'verified' ? installation : null,
    workspace_id: verificationState === 'verified' ? workspace : null,
    verification_state: verificationState,
    created_at: createdAt,
  };
}

export function validateDatabaseIdentity(value, expected = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('DATABASE_IDENTITY_INVALID', 'database identity metadata is not an object');
  if (value.id !== 1 || value.schema_version !== DATABASE_IDENTITY_SCHEMA_VERSION || value.protocol_version !== RUNTIME_IDENTITY_PROTOCOL_VERSION
    || value.product_id !== TRACE_PRODUCT_ID || !Object.values(DATABASE_ROLES).includes(value.role)
    || !isSafeIdentity(value.service_id) || !isSemver(value.runtime_version)
    || !IDENTITY_STATES.includes(value.verification_state) || !isSafeIdentity(value.created_at, 128)) {
    fail('DATABASE_IDENTITY_INVALID', 'database identity metadata is not a supported Trace identity');
  }
  if (value.verification_state === 'verified') {
    assertSafeIdentity(value.workspace_id, 'workspace_id');
    assertSafeIdentity(value.installation_id, 'installation_id');
  } else if (value.workspace_id !== null || value.installation_id !== null) {
    fail('DATABASE_IDENTITY_INVALID', 'legacy database identity must not claim verified IDs');
  }
  const expectedFields = {
    role: expected.role,
    service_id: expected.serviceId ?? expected.service_id,
    workspace_id: expected.workspaceId ?? expected.workspace_id,
    installation_id: expected.installationId ?? expected.installation_id,
  };
  for (const key of Object.keys(expectedFields)) {
    if (expectedFields[key] !== undefined && value[key] !== expectedFields[key]) {
      fail('DATABASE_IDENTITY_MISMATCH', `database ${key} does not match the requested Trace identity`, {field: key}, 503);
    }
  }
  return value;
}

export function runtimeRootCandidate(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) return {root, valid: false, code: 'INVALID_PATH'};
  const resolved = path.resolve(root);
  try {
    if (!fs.statSync(resolved).isDirectory()) return {root: resolved, valid: false, code: 'RUNTIME_ROOT_NOT_DIRECTORY'};
  } catch { return {root: resolved, valid: false, code: 'RUNTIME_ROOT_NOT_FOUND'}; }
  const runtimeFile = path.join(resolved, 'runtime.json');
  const packageFile = path.join(resolved, 'package.json');
  let runtime = null;
  let packageInfo = null;
  const runtimePresent = fs.existsSync(runtimeFile);
  try { if (runtimePresent) runtime = JSON.parse(fs.readFileSync(runtimeFile, 'utf8')); } catch { return {root: resolved, valid: false, code: 'RUNTIME_MANIFEST_INVALID'}; }
  try { if (fs.existsSync(packageFile)) packageInfo = JSON.parse(fs.readFileSync(packageFile, 'utf8')); } catch { return {root: resolved, valid: false, code: 'PACKAGE_MANIFEST_INVALID'}; }
  // A present runtime.json is a packaged-runtime claim. Treat null, arrays,
  // and primitives as an invalid manifest rather than silently falling back to
  // the neighbouring source package.json.
  const packaged = runtimePresent;
  if (!packaged && (!packageInfo || packageInfo.name !== 'trace-runtime' || !isSemver(packageInfo.version))) {
    return {root: resolved, valid: false, code: 'RUNTIME_MANIFEST_MISSING'};
  }
  if (packaged && (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)
    || !isSemver(runtime.runtime_version) || (runtime.manifest_id !== undefined && runtime.manifest_id !== 'trace.runtime.distribution'))) {
    return {root: resolved, valid: false, code: 'RUNTIME_MANIFEST_INVALID'};
  }
  const version = runtime?.runtime_version ?? packageInfo.version;
  if (!isSemver(version)) return {root: resolved, valid: false, code: 'RUNTIME_VERSION_INVALID'};
  if (packageInfo?.version !== undefined && packageInfo.version !== version) return {root: resolved, valid: false, code: 'RUNTIME_VERSION_MISMATCH'};
  const missing = REQUIRED_RUNTIME_ENTRYPOINTS.filter(entry => {
    try {
      const stat = fs.statSync(path.join(resolved, entry));
      // Empty placeholders are not a runtime entrypoint. Packaged roots are
      // checked against release-manifest hashes below; source roots only need
      // this conservative non-empty proof because their files are expected to
      // change between development commits.
      return !stat.isFile() || stat.size < 1;
    } catch { return true; }
  });
  if (missing.length > 0) return {root: resolved, valid: false, code: 'RUNTIME_ENTRYPOINT_MISSING', missing};
  const releaseFile = path.join(resolved, 'release-manifest.json');
  let release = null;
  if (packaged) {
    if (!fs.existsSync(releaseFile)) return {root: resolved, valid: false, code: 'RELEASE_MANIFEST_MISSING'};
    try { release = JSON.parse(fs.readFileSync(releaseFile, 'utf8')); } catch { return {root: resolved, valid: false, code: 'RELEASE_MANIFEST_INVALID'}; }
    if (!release || typeof release !== 'object' || release.manifest_id !== 'trace.runtime.distribution'
      || !isSemver(release.manifest_version) || !isSemver(release.runtime_version) || release.runtime_version !== version || !Array.isArray(release.files)) {
      return {root: resolved, valid: false, code: 'RELEASE_MANIFEST_INVALID'};
    }
    const releaseItems = release.files;
    if (releaseItems.some(item => !item || typeof item !== 'object' || Array.isArray(item) || typeof item.path !== 'string'
      || item.path.length === 0 || item.path.startsWith('/') || item.path.includes('\\')
      || path.posix.normalize(item.path) !== item.path || item.path.split('/').includes('..'))) {
      return {root: resolved, valid: false, code: 'RELEASE_MANIFEST_INVALID'};
    }
    const entries = new Map(releaseItems.map(item => [item.path, item]));
    if (entries.size !== releaseItems.length) return {root: resolved, valid: false, code: 'RELEASE_MANIFEST_INVALID'};
    const absentFromRelease = REQUIRED_RELEASE_FILES.filter(entry => !entries.has(entry));
    if (absentFromRelease.length > 0) return {root: resolved, valid: false, code: 'RELEASE_ENTRYPOINT_MISSING', missing: absentFromRelease};
    for (const entry of REQUIRED_RELEASE_FILES) {
      const manifestEntry = entries.get(entry);
      if (!manifestEntry || !/^[a-f0-9]{64}$/i.test(String(manifestEntry.sha256)) || !Number.isSafeInteger(manifestEntry.bytes) || manifestEntry.bytes < 0) {
        return {root: resolved, valid: false, code: 'RELEASE_ENTRYPOINT_METADATA_INVALID', missing: [entry]};
      }
      try {
        const actual = path.join(resolved, entry);
        if (fs.statSync(actual).size !== manifestEntry.bytes || sha256(fs.readFileSync(actual)) !== String(manifestEntry.sha256).toLowerCase()) {
          return {root: resolved, valid: false, code: 'RELEASE_ENTRYPOINT_MISMATCH', missing: [entry]};
        }
      } catch { return {root: resolved, valid: false, code: 'RELEASE_ENTRYPOINT_MISMATCH', missing: [entry]}; }
    }
  }
  return {root: resolved, valid: true, kind: packaged ? 'packaged' : 'source', runtime_version: version,
    manifest: runtime, package: packageInfo, release_manifest: release, reason: packaged ? 'validated-runtime-and-release-manifest' : 'validated-source-package-and-entrypoints'};
}

/**
 * Resolve only an explicitly supplied root or one unambiguous validated root.
 * An ambiguous set is an error rather than an implicit preference for cwd or
 * whichever source checkout happens to appear first on disk.
 */
export function resolveRuntimeRoot(candidates, {explicit = false} = {}) {
  const values = Array.isArray(candidates) ? candidates : [candidates];
  const unique = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) continue;
    const resolved = path.resolve(value);
    let key = resolved.toLowerCase();
    try { key = fs.realpathSync.native(resolved).toLowerCase(); } catch { /* validation reports not found */ }
    if (!seen.has(key)) { seen.add(key); unique.push(resolved); }
  }
  if (explicit && unique.length !== 1) fail('RUNTIME_ROOT_REQUIRED', 'TRACE_RUNTIME_ROOT must name one absolute runtime root', {candidates: unique}, 500);
  const diagnostics = unique.map(runtimeRootCandidate);
  const valid = diagnostics.filter(item => item.valid);
  if (valid.length === 0) fail('RUNTIME_ROOT_INVALID', '没有找到包含有效 runtime/release manifest 和必要入口的 Trace runtime', {candidates: diagnostics}, 503);
  if (valid.length > 1) fail('RUNTIME_ROOT_AMBIGUOUS', '检测到多个有效 Trace runtime；请设置 TRACE_RUNTIME_ROOT 明确选择', {candidates: valid.map(item => ({root: item.root, kind: item.kind, runtime_version: item.runtime_version, reason: item.reason}))}, 409);
  return valid[0];
}

export function buildServiceIdentity({
  serviceId = TRACE_PRODUCT_SERVICE_ID,
  serviceRole = 'product',
  runtimeVersion,
  installationId,
  workspaceId,
  identityState = 'verified',
  databaseRole = DATABASE_ROLES.product,
  apiSurface = undefined,
  runtimeProtocolVersion = RUNTIME_IDENTITY_PROTOCOL_VERSION,
} = {}) {
  assertSafeIdentity(serviceId, 'service_id');
  assertSafeIdentity(serviceRole, 'service_role');
  assertRuntimeVersion(runtimeVersion);
  if (runtimeProtocolVersion !== RUNTIME_IDENTITY_PROTOCOL_VERSION) fail('PROTOCOL_MISMATCH', 'unsupported Trace runtime identity protocol version', {runtimeProtocolVersion}, 500);
  if (!Object.values(DATABASE_ROLES).includes(databaseRole)) fail('INVALID_DATABASE_ROLE', 'unknown Trace service database role', {databaseRole}, 500);
  if (!IDENTITY_STATES.includes(identityState)) fail('INVALID_IDENTITY_STATE', 'unknown service identity state', {identityState}, 500);
  if (identityState === 'verified') { assertSafeIdentity(installationId, 'installation_id'); assertSafeIdentity(workspaceId, 'workspace_id'); }
  const value = {
    protocol_version: runtimeProtocolVersion,
    protocol: RUNTIME_IDENTITY_PROTOCOL,
    product_id: TRACE_PRODUCT_ID,
    product: TRACE_PRODUCT_ID,
    service_id: serviceId,
    service: serviceId,
    service_role: serviceRole,
    runtime_version: runtimeVersion,
    installation_id: identityState === 'verified' ? installationId : null,
    workspace_id: identityState === 'verified' ? workspaceId : null,
    identity_state: identityState,
    database_role: databaseRole,
    database: {role: databaseRole, installation_id: identityState === 'verified' ? installationId : null, workspace_id: identityState === 'verified' ? workspaceId : null, verification_state: identityState},
    ...(apiSurface === undefined ? {} : {api_surface: apiSurface}),
  };
  return value;
}

export function validateServiceIdentity(value, {
  serviceId = TRACE_PRODUCT_SERVICE_ID,
  serviceRole = undefined,
  protocolVersion = RUNTIME_IDENTITY_PROTOCOL_VERSION,
  runtimeVersion = undefined,
  installationId = undefined,
  workspaceId = undefined,
  requireVerified = true,
  requiredRoute = undefined,
  databaseRole = undefined,
} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SERVICE_IDENTITY_INVALID', 'Trace service handshake is not an object', undefined, 502);
  if (value.protocol_version !== protocolVersion || value.protocol !== RUNTIME_IDENTITY_PROTOCOL) fail('PROTOCOL_MISMATCH', 'Trace service protocol is not supported', {expected: RUNTIME_IDENTITY_PROTOCOL, actual: value.protocol}, 502);
  if (value.product_id !== TRACE_PRODUCT_ID || value.service_id !== serviceId) fail('SERVICE_IDENTITY_MISMATCH', 'The endpoint is not the requested Trace service', {expected: serviceId, actual: value.service_id}, 502);
  if (serviceRole !== undefined && value.service_role !== serviceRole) fail('SERVICE_ROLE_MISMATCH', 'Trace service role is not the requested role', {expected: serviceRole, actual: value.service_role}, 502);
  if (!Object.values(DATABASE_ROLES).includes(value.database_role)
    || databaseRole !== undefined && value.database_role !== databaseRole) fail('DATABASE_ROLE_MISMATCH', 'Trace service does not own the requested database role', {expected: databaseRole, actual: value.database_role}, 502);
  if (!isSemver(value.runtime_version)) fail('RUNTIME_VERSION_INVALID', 'Trace service did not provide a valid runtime version', undefined, 502);
  if (runtimeVersion !== undefined && value.runtime_version !== runtimeVersion) fail('RUNTIME_VERSION_MISMATCH', 'Trace service runtime version does not match the caller', {expected: runtimeVersion, actual: value.runtime_version}, 409);
  if (!IDENTITY_STATES.includes(value.identity_state)) fail('SERVICE_IDENTITY_INVALID', 'Trace service returned an unknown identity state', {state: value.identity_state}, 502);
  if (requireVerified && value.identity_state !== 'verified') fail('IDENTITY_UNVERIFIED', 'Trace service identity is legacy or unverified; no state access was performed', {state: value.identity_state}, 503);
  if (value.identity_state === 'verified') {
    if (!isSafeIdentity(value.installation_id) || !isSafeIdentity(value.workspace_id)) fail('IDENTITY_MISSING', 'Trace service did not provide installation/workspace identity', undefined, 502);
    if (installationId !== undefined && value.installation_id !== installationId) fail('IDENTITY_MISMATCH', 'Trace installation identity does not match', {field: 'installation_id'}, 409);
    if (workspaceId !== undefined && value.workspace_id !== workspaceId) fail('IDENTITY_MISMATCH', 'Trace workspace identity does not match', {field: 'workspace_id'}, 409);
  }
  if (value.identity_state !== 'verified' && (value.workspace_id !== null || value.installation_id !== null)) fail('SERVICE_IDENTITY_INVALID', 'Trace service returned IDs for an unverified identity', undefined, 502);
  if (requiredRoute !== undefined && !advertisedRoutes(value.api_surface).some(advertised => routeMatches(advertised, requiredRoute))) fail('SERVICE_API_MISMATCH', 'Trace service does not advertise the requested API route', {requiredRoute}, 502);
  return value;
}

function routeMatches(advertised, requested) {
  if (advertised === requested) return true;
  if (typeof advertised !== 'string' || typeof requested !== 'string') return false;
  const left = advertised.split('/'); const right = requested.split('/');
  return left.length === right.length && left.every((part, index) => part.startsWith(':') || part === right[index]);
}

function advertisedRoutes(value) {
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.values(value).flatMap(advertisedRoutes);
}
