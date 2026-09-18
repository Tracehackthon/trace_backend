import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {StorageError} from '../../storage/src/index.js';

/** Entry points that make a directory an actual Trace runtime, not a source
 * or package-looking directory copied from an unrelated checkout. */
export const REQUIRED_RUNTIME_ENTRYPOINTS = [
  'apps/desktop/server.mjs',
  'apps/agent/backend.mjs',
  'packages/product/workspace/src/workspace.mjs',
] as const;
const REQUIRED_RELEASE_FILES = ['runtime.json', ...REQUIRED_RUNTIME_ENTRYPOINTS] as const;

export interface RuntimeRootDiagnostic {
  root: string;
  valid: boolean;
  code?: string;
  kind?: 'source' | 'packaged';
  runtime_version?: string;
  missing?: string[];
  reason?: string;
}

function semver(value: unknown): value is string {
  return typeof value === 'string'
    && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function realpathOrResolve(file: string): string {
  try { return fs.realpathSync.native(file); } catch { return path.resolve(file); }
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function invalid(root: string, code: string, extra: Partial<RuntimeRootDiagnostic> = {}): RuntimeRootDiagnostic {
  return {root, valid: false, code, ...extra};
}

export function runtimeRootCandidate(root: string): RuntimeRootDiagnostic {
  if (!path.isAbsolute(root)) return invalid(root, 'INVALID_PATH');
  const resolved = path.resolve(root);
  try {
    if (!fs.statSync(resolved).isDirectory()) return invalid(resolved, 'RUNTIME_ROOT_NOT_DIRECTORY');
  } catch { return invalid(resolved, 'RUNTIME_ROOT_NOT_FOUND'); }
  const runtimeFile = path.join(resolved, 'runtime.json');
  const packageFile = path.join(resolved, 'package.json');
  let runtime: Record<string, unknown> | undefined;
  let packageInfo: Record<string, unknown> | undefined;
  try {
    if (fs.existsSync(runtimeFile)) {
      const value: unknown = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(resolved, 'RUNTIME_MANIFEST_INVALID');
      runtime = value as Record<string, unknown>;
    }
  } catch { return invalid(resolved, 'RUNTIME_MANIFEST_INVALID'); }
  try {
    if (fs.existsSync(packageFile)) {
      const value: unknown = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(resolved, 'PACKAGE_MANIFEST_INVALID');
      packageInfo = value as Record<string, unknown>;
    }
  } catch { return invalid(resolved, 'PACKAGE_MANIFEST_INVALID'); }
  const packaged = runtime !== undefined;
  if (!packaged && (packageInfo?.name !== 'trace-runtime' || !semver(packageInfo?.version))) return invalid(resolved, 'RUNTIME_MANIFEST_MISSING');
  if (packaged && (!semver(runtime?.runtime_version) || (runtime?.manifest_id !== undefined && runtime.manifest_id !== 'trace.runtime.distribution'))) return invalid(resolved, 'RUNTIME_MANIFEST_INVALID');
  const version = packaged ? runtime!.runtime_version : packageInfo!.version;
  if (!semver(version)) return invalid(resolved, 'RUNTIME_VERSION_INVALID');
  if (packageInfo?.version !== undefined && packageInfo.version !== version) return invalid(resolved, 'RUNTIME_VERSION_MISMATCH');
  const missing = REQUIRED_RUNTIME_ENTRYPOINTS.filter(entry => {
    try {
      const stat = fs.statSync(path.join(resolved, entry));
      return !stat.isFile() || stat.size < 1;
    } catch { return true; }
  });
  if (missing.length > 0) return invalid(resolved, 'RUNTIME_ENTRYPOINT_MISSING', {missing});
  let release: Record<string, unknown> | undefined;
  const releaseFile = path.join(resolved, 'release-manifest.json');
  if (packaged) {
    if (!fs.existsSync(releaseFile)) return invalid(resolved, 'RELEASE_MANIFEST_MISSING');
    try {
      const value: unknown = JSON.parse(fs.readFileSync(releaseFile, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(resolved, 'RELEASE_MANIFEST_INVALID');
      release = value as Record<string, unknown>;
    } catch { return invalid(resolved, 'RELEASE_MANIFEST_INVALID'); }
    if (release.manifest_id !== 'trace.runtime.distribution' || !semver(release.manifest_version) || release.runtime_version !== version || !semver(release.runtime_version) || !Array.isArray(release.files)) return invalid(resolved, 'RELEASE_MANIFEST_INVALID');
    const releaseItems = release.files as unknown[];
    if (releaseItems.some(item => !item || typeof item !== 'object' || Array.isArray(item)
      || typeof (item as Record<string, unknown>).path !== 'string'
      || ((item as Record<string, unknown>).path as string).length === 0
      || ((item as Record<string, unknown>).path as string).startsWith('/')
      || ((item as Record<string, unknown>).path as string).includes('\\')
      || path.posix.normalize((item as Record<string, unknown>).path as string) !== (item as Record<string, unknown>).path
      || ((item as Record<string, unknown>).path as string).split('/').includes('..'))) return invalid(resolved, 'RELEASE_MANIFEST_INVALID');
    const entries = new Map(releaseItems.map(item => {
      const record = item as Record<string, unknown>;
      return [record.path as string, record];
    }));
    if (entries.size !== releaseItems.length) return invalid(resolved, 'RELEASE_MANIFEST_INVALID');
    const absent = REQUIRED_RELEASE_FILES.filter(entry => !entries.has(entry));
    if (absent.length > 0) return invalid(resolved, 'RELEASE_ENTRYPOINT_MISSING', {missing: absent});
    for (const entry of REQUIRED_RELEASE_FILES) {
      const manifestEntry = entries.get(entry);
      const bytes = manifestEntry?.bytes;
      if (!manifestEntry || typeof manifestEntry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifestEntry.sha256)
        || typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) return invalid(resolved, 'RELEASE_ENTRYPOINT_METADATA_INVALID', {missing: [entry]});
      try {
        const actual = path.join(resolved, entry);
        if (fs.statSync(actual).size !== bytes || sha256(actual) !== manifestEntry.sha256.toLowerCase()) return invalid(resolved, 'RELEASE_ENTRYPOINT_MISMATCH', {missing: [entry]});
      } catch { return invalid(resolved, 'RELEASE_ENTRYPOINT_MISMATCH', {missing: [entry]}); }
    }
  }
  return {root: resolved, valid: true, kind: packaged ? 'packaged' : 'source', runtime_version: version,
    reason: packaged ? 'validated-runtime-and-release-manifest' : 'validated-source-package-and-entrypoints'};
}

export function resolveRuntimeRoot(candidates: string | string[], options: {explicit?: boolean} = {}): RuntimeRootDiagnostic {
  const values = Array.isArray(candidates) ? candidates : [candidates];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!path.isAbsolute(value)) continue;
    const resolved = path.resolve(value);
    const key = realpathOrResolve(resolved).toLowerCase();
    if (!seen.has(key)) {seen.add(key); unique.push(resolved);}
  }
  if (options.explicit && unique.length !== 1) throw new StorageError('RUNTIME_ROOT_REQUIRED', 'TRACE_RUNTIME_ROOT must name one absolute runtime root');
  const diagnostics = unique.map(runtimeRootCandidate);
  const valid = diagnostics.filter(item => item.valid);
  if (valid.length === 0) throw new StorageError('RUNTIME_ROOT_INVALID', 'No valid Trace runtime manifest and required entrypoints were found');
  if (valid.length > 1) throw new StorageError('RUNTIME_ROOT_AMBIGUOUS', 'Multiple valid Trace runtimes were found; set TRACE_RUNTIME_ROOT explicitly');
  return valid[0]!;
}

/** Walk only known launch locations, then apply the same strict resolver. */
export function discoverRuntimeRoot(initials: string[], explicit = false): RuntimeRootDiagnostic {
  const candidates: string[] = [];
  for (const initial of initials) {
    if (!path.isAbsolute(initial)) continue;
    let cursor = path.resolve(initial);
    for (let steps = 0; steps < 10; steps += 1) {
      candidates.push(cursor);
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  return resolveRuntimeRoot(candidates, {explicit});
}
