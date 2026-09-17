import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {enqueueSensemakingJob, ensureHostWorkflowSchema} from './host-workflow.mjs';

/**
 * The Codex host stream is deliberately stored beside Product Workspace, not
 * in a project `.trace` ledger or in the optional Agent runtime database.
 * These tables are append-only at the event/receipt boundary; the session and
 * turn rows are the small current-state indexes used to answer the next hook.
 */
export const HOST_SESSION_TABLES = Object.freeze([
  'host_sessions',
  'host_turns',
  'host_ingest_events',
  'host_control_commands',
  'workflow_findings',
]);

export const HOST_SESSION_STATUSES = Object.freeze(['attached', 'paused', 'ended']);
export const HOST_TURN_STATES = Object.freeze(['started', 'completed', 'interrupted']);
export const HOST_EVENT_KINDS = Object.freeze([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'Interrupt',
  'SessionEnd',
]);

const MAX_ID = 512;
const MAX_HOST = 128;
const MAX_TEXT = 1_000_000;
const CONTROL_OPERATIONS = new Set(['attach', 'pause', 'detach', 'finding']);
const EVENT_KINDS = new Set(HOST_EVENT_KINDS);
const TURN_STATES = new Set(HOST_TURN_STATES);
const SESSION_STATUSES = new Set(HOST_SESSION_STATUSES);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const PROJECT_INSTANCE_PROTOCOL_ID = 'trace.project-instance';
const PROJECT_INSTANCE_PROTOCOL_VERSIONS = new Set(['0.1.0', '0.2.0']);

export class HostIngestError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'HostIngestError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, status = 422, details = undefined) {
  throw new HostIngestError(status, code, message, details);
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validText(value, field, max = MAX_TEXT, {empty = false} = {}) {
  // Prompt and assistant messages are allowed to contain normal newlines and
  // tabs. NUL/DEL are rejected because they make receipts and diagnostics
  // ambiguous; identity validation below remains stricter and rejects all
  // control characters.
  if (typeof value !== 'string' || value.length > max || /[\x00\x7f]/.test(value) || (!empty && value.trim().length === 0)) {
    fail('INVALID_HOST_EVENT', `${field} must be a valid text value`);
  }
  return value;
}

function optionalText(value, field, max = MAX_TEXT) {
  if (value === undefined || value === null) return null;
  return validText(value, field, max, {empty: true});
}

function identity(value, field, max = MAX_ID) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\x00-\x1f\x7f]/.test(value) || FORBIDDEN_KEYS.has(value)) {
    fail('INVALID_HOST_IDENTITY', `${field} must be a usable host identity`);
  }
  return value;
}

function optionalIdentity(value, field, max = MAX_ID) {
  if (value === undefined || value === null || value === '') return null;
  return identity(value, field, max);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function stableHostJson(value) {
  return JSON.stringify(canonical(value));
}

function sha(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function boundedBodyHash(value, field) {
  let encoded;
  try { encoded = stableHostJson(value); } catch { fail('INVALID_HOST_EVENT', `${field} must be JSON serializable`); }
  if (typeof encoded !== 'string' || encoded.length > MAX_TEXT) fail('INVALID_HOST_EVENT', `${field} exceeds the bounded host event size`);
  return sha(encoded);
}

/*
 * Project identity is intentionally resolved here, at the host boundary,
 * rather than inferred by callers from a directory name.  `.trace/project.json`
 * is only a candidate marker.  A candidate is usable only after its descriptor,
 * path and Git repository can all be checked, and an event cwd must agree with
 * the candidate selected by an explicit project_ref.
 *
 * This is kept as a small dependency-free resolver because host-ingest is also
 * loaded directly by the desktop Node adapter (before the TypeScript build is
 * materialised).  The same shape is used by the CLI so diagnostics survive the
 * source/dist boundary without adding another state owner.
 */
function pathKey(value) {
  const resolved = path.resolve(value);
  try { return fs.realpathSync.native(resolved); } catch { return resolved; }
}

function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  try {
    const a = pathKey(left), b = pathKey(right);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch { return false; }
}

function insidePath(child, parent) {
  if (typeof child !== 'string' || typeof parent !== 'string') return false;
  try {
    const childKey = pathKey(child), parentKey = pathKey(parent);
    const childValue = process.platform === 'win32' ? childKey.toLowerCase() : childKey;
    const parentValue = process.platform === 'win32' ? parentKey.toLowerCase() : parentKey;
    if (childValue === parentValue) return true;
    // Keep a single component separator for filesystem roots (for example
    // `C:\\` or `/`). Prefix matching is intentionally component-aware.
    const prefix = parentValue.endsWith(path.sep) ? parentValue : `${parentValue}${path.sep}`;
    return childValue.startsWith(prefix);
  } catch { return false; }
}

function markerDiagnostic(root, traceDir, descriptorFile) {
  try {
    // A project marker is not authoritative when `.trace` or its descriptor is
    // redirected outside the canonical project.  Reject both POSIX symlinks
    // and Windows junctions/reparse redirects rather than following another
    // workspace's identity through the same path.
    let traceStat;
    try { traceStat = fs.lstatSync(traceDir); }
    catch (error) { if (error?.code === 'ENOENT') return null; return bindingDiagnostic('PROJECT_DESCRIPTOR_INVALID', 'Trace project marker could not be inspected', 'descriptor'); }
    if (traceStat.isSymbolicLink()) return bindingDiagnostic('PROJECT_SYMLINK_UNSAFE', 'Trace project marker or descriptor is redirected through a symlink/junction', 'descriptor');
    if (!traceStat.isDirectory()) return bindingDiagnostic('PROJECT_DESCRIPTOR_INVALID', 'Trace project marker is not a directory', 'descriptor');
    let descriptorStat;
    try { descriptorStat = fs.lstatSync(descriptorFile); }
    catch (error) { if (error?.code === 'ENOENT') return null; return bindingDiagnostic('PROJECT_DESCRIPTOR_INVALID', 'Trace project descriptor could not be inspected', 'descriptor'); }
    if (descriptorStat.isSymbolicLink()) return bindingDiagnostic('PROJECT_SYMLINK_UNSAFE', 'Trace project marker or descriptor is redirected through a symlink/junction', 'descriptor');
    if (!descriptorStat.isFile()) return bindingDiagnostic('PROJECT_DESCRIPTOR_INVALID', 'Trace project descriptor is not a regular file', 'descriptor');
    const traceTarget = pathKey(traceDir);
    const descriptorTarget = pathKey(descriptorFile);
    if (!insidePath(traceTarget, root) || !insidePath(descriptorTarget, traceTarget)) {
      return bindingDiagnostic('PROJECT_SYMLINK_UNSAFE', 'Trace project marker or descriptor is redirected through a symlink/junction', 'descriptor');
    }
  } catch {
    return bindingDiagnostic('PROJECT_DESCRIPTOR_INVALID', 'Trace project marker or descriptor could not be inspected', 'descriptor');
  }
  return null;
}

function bindingDiagnostic(code, message, field = undefined) {
  return {code, message, ...(field === undefined ? {} : {field})};
}

function gitValue(root, args) {
  try {
    const value = execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'pipe']}).trim();
    return value.length === 0 ? null : value;
  } catch { return null; }
}

function repositoryIdentity(root) {
  const gitRootText = gitValue(root, ['rev-parse', '--show-toplevel']);
  if (gitRootText === null) return {
    status: 'unverified', root: null, common_dir: null, remote: null,
    diagnostics: [bindingDiagnostic('GIT_ROOT_UNVERIFIABLE', 'Git repository root could not be verified', 'git_root')],
  };
  const gitRoot = pathKey(gitRootText);
  const commonText = gitValue(root, ['rev-parse', '--git-common-dir']);
  const commonDir = commonText === null ? null : pathKey(path.isAbsolute(commonText) ? commonText : path.resolve(gitRoot, commonText));
  const remote = gitValue(root, ['remote', 'get-url', 'origin']);
  return {
    status: 'verified', root: gitRoot, common_dir: commonDir, remote,
    diagnostics: [],
  };
}

function validateProjectDescriptor(root, file) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {descriptor: null, diagnostics: [bindingDiagnostic('PROJECT_DESCRIPTOR_INVALID', 'Trace project descriptor is unreadable', 'descriptor')]}; }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {descriptor: null, diagnostics: [bindingDiagnostic('PROJECT_DESCRIPTOR_INVALID', 'Trace project descriptor must be a JSON object', 'descriptor')]};
  const diagnostics = [];
  const allowed = new Set(['protocol_id', 'protocol_version', 'project_id', 'instance_id', 'template_id', 'template_version', 'source_mode', 'source_scope', 'state_file', 'source_root', 'created_at']);
  const unknown = Object.keys(raw).filter(key => !allowed.has(key));
  if (unknown.length > 0) diagnostics.push(bindingDiagnostic('PROJECT_DESCRIPTOR_UNKNOWN_FIELD', 'Trace project descriptor contains unsupported fields', 'descriptor'));
  if (raw.protocol_id !== PROJECT_INSTANCE_PROTOCOL_ID) diagnostics.push(bindingDiagnostic('PROJECT_DESCRIPTOR_PROTOCOL', 'Trace project descriptor protocol is unsupported', 'protocol_id'));
  if (!PROJECT_INSTANCE_PROTOCOL_VERSIONS.has(raw.protocol_version)) diagnostics.push(bindingDiagnostic('PROJECT_DESCRIPTOR_VERSION', 'Trace project descriptor version is unsupported', 'protocol_version'));
  if (typeof raw.project_id !== 'string' || raw.project_id.trim().length === 0) diagnostics.push(bindingDiagnostic('PROJECT_DESCRIPTOR_PROJECT_ID', 'Trace project descriptor project_id is missing', 'project_id'));
  for (const [field, label] of [['instance_id', 'instance identity'], ['template_id', 'template identity'], ['template_version', 'template version'], ['created_at', 'creation time']]) {
    if (typeof raw[field] !== 'string' || raw[field].trim().length === 0) diagnostics.push(bindingDiagnostic('PROJECT_DESCRIPTOR_FIELD', `Trace project descriptor ${label} is missing`, field));
  }
  if (!['local', 'external', 'team', 'empty'].includes(raw.source_mode)) diagnostics.push(bindingDiagnostic('PROJECT_DESCRIPTOR_SOURCE_MODE', 'Trace project descriptor source_mode is unsupported', 'source_mode'));
  if (!['personal', 'project', 'team', 'domain'].includes(raw.source_scope)) diagnostics.push(bindingDiagnostic('PROJECT_DESCRIPTOR_SOURCE_SCOPE', 'Trace project descriptor source_scope is unsupported', 'source_scope'));
  if (raw.state_file !== '.trace/state/trace.sqlite') diagnostics.push(bindingDiagnostic('PROJECT_DESCRIPTOR_STATE_PATH', 'Trace project descriptor state_file is not project-local', 'state_file'));
  if (typeof raw.source_root !== 'string' || !raw.source_root.startsWith('.trace/')) diagnostics.push(bindingDiagnostic('PROJECT_DESCRIPTOR_SOURCE_PATH', 'Trace project descriptor source_root is not project-local', 'source_root'));
  if (diagnostics.length > 0) return {descriptor: null, diagnostics};
  return {descriptor: {
    protocol_id: raw.protocol_id,
    protocol_version: raw.protocol_version,
    project_id: raw.project_id,
    instance_id: raw.instance_id,
    template_id: raw.template_id,
    template_version: raw.template_version,
    source_mode: raw.source_mode,
    source_scope: raw.source_scope,
    state_file: raw.state_file,
    source_root: raw.source_root,
    created_at: raw.created_at,
  }, diagnostics};
}

function discoverProjectCandidate(directory, {explicit = false} = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) return {candidate: null, diagnostics: [bindingDiagnostic('PROJECT_PATH_NOT_ABSOLUTE', 'Project path must be absolute', explicit ? 'project_ref' : 'cwd')]};
  const resolved = pathKey(directory);
  try {
    if (!fs.statSync(resolved).isDirectory()) return {candidate: null, diagnostics: [bindingDiagnostic('PROJECT_PATH_NOT_FOUND', 'Project path does not exist or is not a directory', explicit ? 'project_ref' : 'cwd')]};
  } catch (error) {
    const code = error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? 'PROJECT_PATH_NOT_FOUND' : 'PROJECT_PATH_UNREADABLE';
    return {candidate: null, diagnostics: [bindingDiagnostic(code, code === 'PROJECT_PATH_NOT_FOUND' ? 'Project path does not exist or is not a directory' : 'Project path could not be inspected', explicit ? 'project_ref' : 'cwd')]};
  }
  let cursor = resolved;
  while (true) {
    const traceDir = path.join(cursor, '.trace');
    const descriptorFile = path.join(traceDir, 'project.json');
    const redirectDiagnostic = markerDiagnostic(cursor, traceDir, descriptorFile);
    if (redirectDiagnostic !== null) return {candidate: null, root: cursor, descriptor: null, diagnostics: [redirectDiagnostic]};
    if (fs.existsSync(descriptorFile)) {
      const descriptorResult = validateProjectDescriptor(cursor, descriptorFile);
      if (descriptorResult.descriptor === null) return {candidate: null, root: cursor, descriptor: null, diagnostics: descriptorResult.diagnostics};
      const repository = repositoryIdentity(cursor);
      return {
        candidate: {
          root: cursor,
          project_dir: cursor,
          project_ref: cursor,
          trace_dir: traceDir,
          descriptor: descriptorResult.descriptor,
          repository,
        },
        diagnostics: [...repository.diagnostics],
      };
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return {candidate: null, diagnostics: explicit ? [bindingDiagnostic('PROJECT_DESCRIPTOR_NOT_FOUND', 'No Trace project descriptor was found for project_ref', 'project_ref')] : []};
}

function unresolvedBinding(diagnostics, extra = {}) {
  return {
    status: 'unresolved', state: 'unresolved', project_ref: extra.project_ref ?? null,
    project_dir: extra.project_dir ?? null, project_id: extra.project_id ?? null,
    cwd: extra.cwd ?? null, git_root: extra.git_root ?? null,
    repository: extra.repository ?? null, diagnostics,
  };
}

function conflictBinding(diagnostics, extra = {}) {
  return {
    status: 'conflict', state: 'conflict', project_ref: extra.project_ref ?? null,
    project_dir: extra.project_dir ?? null, project_id: extra.project_id ?? null,
    cwd: extra.cwd ?? null, git_root: extra.git_root ?? null,
    repository: extra.repository ?? null, diagnostics,
  };
}

/**
 * Resolve a project candidate from an explicit project_ref and/or host cwd.
 * The result is always structured: `personal` means no project was requested,
 * while `unresolved` and `conflict` are fail-closed states.  No caller should
 * treat the candidate marker alone as an authoritative project binding.
 */
export function resolveProjectBinding(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return unresolvedBinding([bindingDiagnostic('PROJECT_BINDING_INPUT_INVALID', 'Project binding input must be an object')]);
  const rawProjectRef = input.project_ref ?? input.projectRef;
  const hasProjectRef = rawProjectRef !== undefined && rawProjectRef !== null && rawProjectRef !== '';
  // `cwd: null`/empty is different from an omitted cwd: once a caller claims
  // to provide host identity, an unverifiable value must not downgrade to a
  // personal/no-candidate result.
  const hasCwd = input.cwd !== undefined;
  const cwdValue = hasCwd && typeof input.cwd === 'string' && path.isAbsolute(input.cwd) ? pathKey(input.cwd) : hasCwd ? String(input.cwd) : null;
  if (rawProjectRef === '') return {status: 'personal', state: 'personal', project_ref: null, project_dir: null, project_id: null, cwd: cwdValue, git_root: null, repository: null, diagnostics: []};
  const cwdResult = hasCwd ? discoverProjectCandidate(input.cwd) : {candidate: null, diagnostics: []};
  if (cwdResult.diagnostics.length > 0 && cwdResult.candidate === null && hasCwd && cwdResult.diagnostics.some(item => item.code !== 'PROJECT_DESCRIPTOR_NOT_FOUND')) {
    return unresolvedBinding(cwdResult.diagnostics, {cwd: cwdValue});
  }
  if (!hasProjectRef && cwdResult.candidate === null) {
    // No project is a valid user-level host session.  A malformed explicit cwd
    // was handled above; a normal directory without a descriptor remains
    // personal rather than manufacturing a project binding.
    return {status: 'personal', state: 'personal', project_ref: null, project_dir: null, project_id: null, cwd: cwdValue, git_root: null, repository: null, diagnostics: []};
  }
  if (!hasProjectRef && cwdResult.candidate !== null) {
    const candidate = cwdResult.candidate;
    if (candidate.repository.status !== 'verified') return unresolvedBinding([...cwdResult.diagnostics, ...candidate.repository.diagnostics], {cwd: cwdValue, project_ref: candidate.project_ref, project_dir: candidate.root, project_id: candidate.descriptor.project_id, repository: candidate.repository});
    if (!insidePath(candidate.root, candidate.repository.root)) return unresolvedBinding([bindingDiagnostic('PROJECT_GIT_ROOT_MISMATCH', 'Project descriptor is outside its Git repository root', 'git_root')], {cwd: cwdValue, project_ref: candidate.project_ref, project_dir: candidate.root, project_id: candidate.descriptor.project_id, git_root: candidate.repository.root, repository: candidate.repository});
    const cwdRepository = repositoryIdentity(cwdValue);
    if (cwdRepository.status !== 'verified') return unresolvedBinding([...cwdRepository.diagnostics], {cwd: cwdValue, project_ref: candidate.project_ref, project_dir: candidate.root, project_id: candidate.descriptor.project_id, git_root: candidate.repository.root, repository: cwdRepository});
    if (candidate.repository.common_dir !== null && cwdRepository.common_dir !== null && !samePath(candidate.repository.common_dir, cwdRepository.common_dir)) return unresolvedBinding([bindingDiagnostic('PROJECT_REPOSITORY_MISMATCH', 'Host cwd belongs to a different Git repository', 'git_root')], {cwd: cwdValue, project_ref: candidate.project_ref, project_dir: candidate.root, project_id: candidate.descriptor.project_id, git_root: cwdRepository.root, repository: cwdRepository});
    if (!samePath(candidate.repository.root, cwdRepository.root)) return unresolvedBinding([bindingDiagnostic('PROJECT_GIT_ROOT_MISMATCH', 'Host cwd has a different Git root from the Trace project', 'git_root')], {cwd: cwdValue, project_ref: candidate.project_ref, project_dir: candidate.root, project_id: candidate.descriptor.project_id, git_root: cwdRepository.root, repository: cwdRepository});
    return {status: 'resolved', state: 'resolved', project_ref: candidate.project_ref, project_dir: candidate.root, project_id: candidate.descriptor.project_id, descriptor: candidate.descriptor, cwd: cwdValue, git_root: candidate.repository.root, repository: candidate.repository, diagnostics: []};
  }
  if (typeof rawProjectRef !== 'string' || !path.isAbsolute(rawProjectRef)) return unresolvedBinding([bindingDiagnostic('PROJECT_PATH_NOT_ABSOLUTE', 'project_ref must be an absolute project directory', 'project_ref')], {project_ref: typeof rawProjectRef === 'string' ? rawProjectRef : null, cwd: cwdValue});
  const explicitResult = discoverProjectCandidate(rawProjectRef, {explicit: true});
  if (explicitResult.candidate === null) return unresolvedBinding(explicitResult.diagnostics, {project_ref: path.isAbsolute(rawProjectRef) ? pathKey(rawProjectRef) : rawProjectRef, cwd: cwdValue, project_dir: explicitResult.root ?? null});
  const explicitCandidate = explicitResult.candidate;
  const base = {project_ref: explicitCandidate.project_ref, project_dir: explicitCandidate.root, project_id: explicitCandidate.descriptor.project_id, cwd: cwdValue, git_root: explicitCandidate.repository.root, repository: explicitCandidate.repository};
  if (explicitCandidate.repository.status !== 'verified') return unresolvedBinding([...explicitResult.diagnostics, ...explicitCandidate.repository.diagnostics], base);
  if (!insidePath(explicitCandidate.root, explicitCandidate.repository.root)) return unresolvedBinding([bindingDiagnostic('PROJECT_GIT_ROOT_MISMATCH', 'Project descriptor is outside its Git repository root', 'git_root')], base);
  if (cwdResult.candidate !== null) {
    if (!samePath(explicitCandidate.root, cwdResult.candidate.root)) return conflictBinding([bindingDiagnostic('PROJECT_REF_CWD_MISMATCH', 'project_ref and host cwd resolve to different Trace projects', 'cwd')], base);
    const cwdRepository = repositoryIdentity(cwdValue);
    if (cwdRepository.status !== 'verified') return unresolvedBinding([...cwdRepository.diagnostics], base);
    if (explicitCandidate.repository.common_dir !== null && cwdRepository.common_dir !== null && !samePath(explicitCandidate.repository.common_dir, cwdRepository.common_dir)) return conflictBinding([bindingDiagnostic('PROJECT_REPOSITORY_MISMATCH', 'project_ref and host cwd belong to different Git repositories', 'git_root')], base);
    if (!samePath(explicitCandidate.repository.root, cwdRepository.root)) return conflictBinding([bindingDiagnostic('PROJECT_GIT_ROOT_MISMATCH', 'project_ref and host cwd have different Git roots', 'git_root')], base);
  } else if (hasCwd) {
    // A project-bound session cannot follow a cwd outside the bound project,
    // even when that cwd has no own .trace marker.  This closes the common
    // same-name/sibling-repository drift case.
    if (cwdValue === null || !insidePath(cwdValue, explicitCandidate.root)) return conflictBinding([bindingDiagnostic('PROJECT_REF_CWD_MISMATCH', 'host cwd is outside the explicitly bound Trace project', 'cwd')], base);
    const cwdRepository = repositoryIdentity(cwdValue);
    if (cwdRepository.status !== 'verified') return unresolvedBinding([...cwdRepository.diagnostics], base);
    if (explicitCandidate.repository.common_dir !== null && cwdRepository.common_dir !== null && !samePath(explicitCandidate.repository.common_dir, cwdRepository.common_dir)) return conflictBinding([bindingDiagnostic('PROJECT_REPOSITORY_MISMATCH', 'project_ref and host cwd belong to different Git repositories', 'git_root')], base);
    if (!samePath(explicitCandidate.repository.root, cwdRepository.root)) return conflictBinding([bindingDiagnostic('PROJECT_GIT_ROOT_MISMATCH', 'project_ref and host cwd have different Git roots', 'git_root')], base);
  }
  return {status: 'resolved', state: 'resolved', ...base, descriptor: explicitCandidate.descriptor, diagnostics: []};
}

/** Verify a stored session binding against a hook cwd without rebinding it. */
export function verifyHostSessionProjectBinding(input = {}) {
  const projectRef = input?.project_ref ?? input?.projectRef;
  if (projectRef === undefined || projectRef === null || projectRef === '') return {
    status: 'personal', state: 'personal', project_ref: null, project_dir: null, project_id: null,
    // Personal sessions deliberately have no filesystem binding.  Do not
    // reflect an arbitrary caller-supplied cwd into a durable receipt.
    cwd: null, git_root: null, repository: null, diagnostics: [],
  };
  if (input?.cwd === undefined) return unresolvedBinding([bindingDiagnostic('PROJECT_CWD_REQUIRED', 'A project-bound host event must include its absolute cwd', 'cwd')], {project_ref: projectRef});
  const binding = resolveProjectBinding({project_ref: projectRef, cwd: input.cwd});
  if (binding.status !== 'resolved') return binding;
  // The path is only one part of a project identity.  Persisted sessions pin
  // the descriptor project_id and both Git roots when available, so replacing
  // a descriptor or moving a session onto another worktree cannot silently
  // keep the same path-bound session alive.
  const expectedProjectId = input?.project_id ?? input?.projectId;
  if (expectedProjectId !== undefined && expectedProjectId !== null && expectedProjectId !== '' && binding.project_id !== expectedProjectId) {
    return conflictBinding([bindingDiagnostic('PROJECT_ID_MISMATCH', 'Trace project descriptor identity changed for this host session', 'project_id')], binding);
  }
  const expectedGitRoot = input?.git_root ?? input?.gitRoot;
  if (expectedGitRoot !== undefined && expectedGitRoot !== null && expectedGitRoot !== '' && (binding.git_root === null || !samePath(binding.git_root, expectedGitRoot))) {
    return conflictBinding([bindingDiagnostic('PROJECT_GIT_ROOT_MISMATCH', 'Trace project Git root changed for this host session', 'git_root')], binding);
  }
  const expectedCommonDir = input?.git_common_dir ?? input?.gitCommonDir;
  const actualCommonDir = binding.repository?.common_dir ?? null;
  if (expectedCommonDir !== undefined && expectedCommonDir !== null && expectedCommonDir !== '' && (actualCommonDir === null || !samePath(actualCommonDir, expectedCommonDir))) {
    return conflictBinding([bindingDiagnostic('PROJECT_REPOSITORY_MISMATCH', 'Trace project Git worktree identity changed for this host session', 'git_common_dir')], binding);
  }
  return binding;
}

function now() {
  return new Date().toISOString();
}

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}

function requireColumns(db, table, columns) {
  const actual = tableColumns(db, table);
  if (columns.some(column => !actual.has(column))) fail('STORAGE_CORRUPT', `Host ingest table ${table} is missing a required column`, 503);
}

/** Create or validate only the host-ingest extension of the web database. */
export function ensureHostSessionSchema(db, {allowSchemaMigration = true} = {}) {
  // Opening a legacy Product database is a read-only operation until its
  // owner identity is explicitly adopted.  In that mode callers may still
  // construct the service so core workspace reads remain available, but no
  // host table/index/column migration is allowed here.
  if (!allowSchemaMigration) return false;
  db.exec(`
    CREATE TABLE IF NOT EXISTS host_sessions(
      host TEXT NOT NULL,
      session_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('attached','paused','ended')),
      capture_policy TEXT NOT NULL CHECK(capture_policy='explicit'),
      project_ref TEXT,
      project_id TEXT,
      git_root TEXT,
      git_common_dir TEXT,
      created_at TEXT NOT NULL,
      attached_at TEXT NOT NULL,
      paused_at TEXT,
      ended_at TEXT,
      updated_at TEXT NOT NULL,
      last_event_at TEXT,
      PRIMARY KEY(host, session_id)
    );
    CREATE TABLE IF NOT EXISTS host_turns(
      host TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('started','completed','interrupted')),
      prompt TEXT NOT NULL,
      last_assistant_message TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      interrupted_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(host, session_id, turn_id),
      FOREIGN KEY(host, session_id) REFERENCES host_sessions(host, session_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS host_turns_recent_idx ON host_turns(host, session_id, updated_at);
    CREATE TABLE IF NOT EXISTS host_ingest_events(
      event_key TEXT PRIMARY KEY,
      host TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_id TEXT,
      event_kind TEXT NOT NULL,
      tool_use_id TEXT,
      content_sha256 TEXT NOT NULL,
      event_json TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('applied','ignored')),
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS host_ingest_events_session_idx ON host_ingest_events(host, session_id, created_at);
    CREATE TABLE IF NOT EXISTS host_control_commands(
      command_id TEXT PRIMARY KEY,
      operation TEXT NOT NULL CHECK(operation IN ('attach','pause','detach','finding')),
      host TEXT NOT NULL,
      session_id TEXT NOT NULL,
      request_sha256 TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_findings(
      finding_id TEXT PRIMARY KEY,
      host TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      observation TEXT NOT NULL,
      desired_behavior TEXT,
      scope TEXT NOT NULL CHECK(scope='unknown'),
      target_kind TEXT NOT NULL CHECK(target_kind='unresolved'),
      status TEXT NOT NULL CHECK(status='captured'),
      source_event_key TEXT,
      created_at TEXT NOT NULL,
      finding_kind TEXT NOT NULL DEFAULT 'captured',
      origin TEXT NOT NULL DEFAULT 'explicit',
      source_refs TEXT NOT NULL DEFAULT '[]',
      run_id TEXT,
      input_hash TEXT,
      result_hash TEXT,
      target_hint TEXT,
      FOREIGN KEY(host, session_id, turn_id) REFERENCES host_turns(host, session_id, turn_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS workflow_findings_session_idx ON workflow_findings(host, session_id, created_at);
  `);
  // v1 databases predate the durable project identity columns.  This additive
  // migration is deliberately limited to the host extension and runs under
  // the Product owner's startup transaction when one is available.
  const hostColumns = tableColumns(db, 'host_sessions');
  for (const column of ['project_id', 'git_root', 'git_common_dir']) {
    if (!hostColumns.has(column)) db.exec(`ALTER TABLE host_sessions ADD COLUMN ${column} TEXT`);
  }
  requireColumns(db, 'host_sessions', ['host', 'session_id', 'status', 'capture_policy', 'project_ref', 'project_id', 'git_root', 'git_common_dir', 'created_at', 'attached_at', 'paused_at', 'ended_at', 'updated_at', 'last_event_at']);
  requireColumns(db, 'host_turns', ['host', 'session_id', 'turn_id', 'state', 'prompt', 'last_assistant_message', 'started_at', 'completed_at', 'interrupted_at', 'updated_at']);
  requireColumns(db, 'host_ingest_events', ['event_key', 'host', 'session_id', 'turn_id', 'event_kind', 'tool_use_id', 'content_sha256', 'event_json', 'outcome', 'result_json', 'created_at']);
  requireColumns(db, 'host_control_commands', ['command_id', 'operation', 'host', 'session_id', 'request_sha256', 'result_json', 'created_at']);
  requireColumns(db, 'workflow_findings', ['finding_id', 'host', 'session_id', 'turn_id', 'observation', 'desired_behavior', 'scope', 'target_kind', 'status', 'source_event_key', 'created_at']);
  ensureHostWorkflowSchema(db);
  return true;
}

function sessionView(row) {
  if (!row) return null;
  return {
    host: row.host,
    session_id: row.session_id,
    status: row.status,
    capture_policy: row.capture_policy,
    project_ref: row.project_ref ?? null,
    project_id: row.project_id ?? null,
    git_root: row.git_root ?? null,
    git_common_dir: row.git_common_dir ?? null,
    created_at: row.created_at,
    attached_at: row.attached_at,
    paused_at: row.paused_at ?? null,
    ended_at: row.ended_at ?? null,
    updated_at: row.updated_at,
    last_event_at: row.last_event_at ?? null,
  };
}

function turnView(row) {
  if (!row) return null;
  return {
    host: row.host,
    session_id: row.session_id,
    turn_id: row.turn_id,
    state: row.state,
    prompt: row.prompt,
    last_assistant_message: row.last_assistant_message ?? null,
    started_at: row.started_at,
    completed_at: row.completed_at ?? null,
    interrupted_at: row.interrupted_at ?? null,
    updated_at: row.updated_at,
  };
}

function findingView(row) {
  return {
    finding_id: row.finding_id,
    host: row.host,
    session_id: row.session_id,
    turn_id: row.turn_id,
    observation: row.observation,
    desired_behavior: row.desired_behavior ?? null,
    desiredBehavior: row.desired_behavior ?? null,
    scope: row.scope,
    target_kind: row.target_kind,
    targetKind: row.target_kind,
    status: row.status,
    finding_kind: row.finding_kind ?? 'captured',
    origin: row.origin ?? 'explicit',
    source_refs: (() => { try { return JSON.parse(row.source_refs ?? '[]'); } catch { return []; } })(),
    run_id: row.run_id ?? null,
    input_hash: row.input_hash ?? null,
    result_hash: row.result_hash ?? null,
    target_hint: row.target_hint ?? null,
    source_event_key: row.source_event_key ?? null,
    created_at: row.created_at,
  };
}

function eventIdentity(input) {
  if (!plain(input)) fail('INVALID_HOST_EVENT', 'Host event must be a JSON object', 400);
  const host = identity(input.host ?? 'codex', 'host', MAX_HOST);
  const sessionId = identity(input.session_id ?? input.sessionId, 'session_id');
  const eventKind = input.event_kind ?? input.eventKind ?? input.hook_event_name ?? input.hookEventName;
  if (!EVENT_KINDS.has(eventKind)) fail('INVALID_HOST_EVENT', `Unsupported host event: ${String(eventKind)}`);
  const turnId = optionalIdentity(input.turn_id ?? input.turnId, 'turn_id');
  const toolUseId = optionalIdentity(input.tool_use_id ?? input.toolUseId, 'tool_use_id');
  if ((eventKind === 'SessionStart' || eventKind === 'SessionEnd') && toolUseId !== null) fail('INVALID_HOST_EVENT', `${eventKind} does not accept tool_use_id`);
  const eventKey = [host, sessionId, turnId ?? '', eventKind, toolUseId ?? ''].join('\u001f');
  return {host, sessionId, eventKind, turnId, toolUseId, eventKey};
}

/** Normalize only official hook fields. Arbitrary fields never enter web.sqlite. */
function normalizedEvent(input, identityValue) {
  const {eventKind} = identityValue;
  const result = {event_kind: eventKind};
  // Keep a missing prompt distinguishable from an explicitly empty prompt so
  // an attached session cannot create a started turn without the official
  // UserPromptSubmit payload. Unattached/paused events are still no-ops and
  // therefore do not need to persist or reject a missing body.
  const prompt = input.prompt;
  const lastAssistantMessage = input.last_assistant_message ?? input.lastAssistantMessage;
  const toolInput = input.tool_input ?? input.toolInput;
  const toolResponse = input.tool_response ?? input.toolResponse;
  if (eventKind === 'UserPromptSubmit') result.prompt = prompt === undefined ? null : validText(prompt, 'prompt', MAX_TEXT, {empty: true});
  if (eventKind === 'Stop') result.last_assistant_message = optionalText(lastAssistantMessage, 'last_assistant_message');
  if (eventKind === 'PreToolUse' && toolInput !== undefined) result.tool_input_sha256 = boundedBodyHash(toolInput, 'tool_input');
  if (eventKind === 'PostToolUse' && toolResponse !== undefined) result.tool_response_sha256 = boundedBodyHash(toolResponse, 'tool_response');
  // Event metadata is intentionally bounded and does not include cwd or tool bodies.
  return result;
}

function eventResult({identityValue, session, outcome, reason, turn, capturedFields = [], extra = {}}) {
  const result = {
    status: outcome === 'applied' ? 'captured' : 'ignored',
    outcome,
    event_key: identityValue.eventKey,
    event_kind: identityValue.eventKind,
    host: identityValue.host,
    session_id: identityValue.sessionId,
    turn_id: identityValue.turnId,
    session_status: session?.status ?? null,
  };
  if (reason !== undefined) result.reason = reason;
  if (turn !== undefined) result.turn = turn;
  if (capturedFields.length > 0) result.captured_fields = capturedFields;
  Object.assign(result, extra);
  // Return the same canonical property order that is persisted. This makes a
  // retry byte-for-byte JSON stable, not merely deep-equal after parsing.
  return JSON.parse(stableHostJson(result));
}

function commandIdentity(input, operation) {
  if (!plain(input)) fail('INVALID_HOST_COMMAND', 'Host control request must be an object', 400);
  const commandId = identity(input.command_id ?? input.commandId, 'command_id');
  const host = identity(input.host ?? 'codex', 'host', MAX_HOST);
  const sessionId = identity(input.session_id ?? input.sessionId, 'session_id');
  if (!CONTROL_OPERATIONS.has(operation)) fail('INVALID_HOST_COMMAND', `Unsupported host control operation: ${operation}`);
  return {commandId, host, sessionId};
}

function commandResult(status, identityValue, extra = {}) {
  return {status, operation: extra.operation, command_id: identityValue.commandId, host: identityValue.host, session_id: identityValue.sessionId, ...extra};
}

function readSession(db, host, sessionId) {
  return db.prepare('SELECT * FROM host_sessions WHERE host=? AND session_id=?').get(host, sessionId);
}

function readTurn(db, host, sessionId, turnId) {
  return db.prepare('SELECT * FROM host_turns WHERE host=? AND session_id=? AND turn_id=?').get(host, sessionId, turnId);
}

function checkSessionState(session, {allowPaused = false, operation = 'capture'}) {
  if (!session) return false;
  if (session.status === 'ended') fail('HOST_SESSION_ENDED', `Host session has ended; ${operation} cannot revive it`, 409);
  if (session.status === 'paused' && !allowPaused) return false;
  return true;
}

function insertEvent(db, identityValue, normalized, outcome, result, timestamp) {
  const eventJson = stableHostJson(normalized);
  const contentSha = sha(eventJson);
  db.prepare(`INSERT INTO host_ingest_events
    (event_key,host,session_id,turn_id,event_kind,tool_use_id,content_sha256,event_json,outcome,result_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    identityValue.eventKey,
    identityValue.host,
    identityValue.sessionId,
    identityValue.turnId,
    identityValue.eventKind,
    identityValue.toolUseId,
    contentSha,
    eventJson,
    outcome,
    stableHostJson(result),
    timestamp,
  );
  return {contentSha, eventJson};
}

function duplicateEvent(db, identityValue, normalized) {
  const existing = db.prepare('SELECT content_sha256,result_json FROM host_ingest_events WHERE event_key=?').get(identityValue.eventKey);
  if (!existing) return null;
  const contentSha = sha(stableHostJson(normalized));
  if (existing.content_sha256 !== contentSha) fail('HOST_EVENT_CONFLICT', 'The same host event idempotency key was replayed with different content', 409);
  try { return JSON.parse(existing.result_json); } catch { fail('STORAGE_CORRUPT', 'Host event receipt is not valid JSON', 503); }
}

function controlReplay(db, commandId, fingerprint) {
  const existing = db.prepare('SELECT request_sha256,result_json FROM host_control_commands WHERE command_id=?').get(commandId);
  if (!existing) return null;
  if (existing.request_sha256 !== fingerprint) fail('HOST_COMMAND_CONFLICT', 'The same host command ID was replayed with different content', 409);
  try { return JSON.parse(existing.result_json); } catch { fail('STORAGE_CORRUPT', 'Host command receipt is not valid JSON', 503); }
}

function saveControl(db, identityValue, operation, fingerprint, result, timestamp) {
  const canonicalResult = JSON.parse(stableHostJson(result));
  db.prepare(`INSERT INTO host_control_commands(command_id,operation,host,session_id,request_sha256,result_json,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(identityValue.commandId, operation, identityValue.host, identityValue.sessionId, fingerprint, stableHostJson(canonicalResult), timestamp);
  return canonicalResult;
}

/**
 * Create the user-level host ingest service over an existing Product Workspace
 * DatabaseSync handle. `transaction` must run its callback under the same
 * SQLite write transaction as the web workspace owner.
 */
export function createHostSessionIngest({db, transaction, allowSchemaMigration = true}) {
  if (!db || typeof db.prepare !== 'function' || typeof transaction !== 'function') throw new TypeError('createHostSessionIngest requires db and transaction');
  ensureHostSessionSchema(db, {allowSchemaMigration});

  function attach(input) {
    const identityValue = commandIdentity(input, 'attach');
    const suppliedProjectRefValue = optionalText(input.project_ref ?? input.projectRef, 'project_ref', MAX_ID * 8);
    const suppliedProjectRef = suppliedProjectRefValue === '' ? null : suppliedProjectRefValue;
    const suppliedCwd = input.cwd !== undefined ? input.cwd : input.host_cwd;
    // Omitting project_ref is an explicit request for a personal host session;
    // a cwd candidate must never silently turn that session into a project one.
    let requestedBinding = {status: 'personal', state: 'personal', project_ref: null, project_dir: null, project_id: null, cwd: null, git_root: null, repository: null, diagnostics: []};
    let requestedProjectRef = suppliedProjectRef;
    if (suppliedProjectRef !== null) {
      // A project-bound session must prove the process cwd at attachment time
      // as well as on every later hook event.  Accepting project_ref alone
      // would create an apparently bound row that cannot be revalidated and
      // would make attach semantics weaker than ingest semantics.
      if (suppliedCwd === undefined) {
        const binding = verifyHostSessionProjectBinding({project_ref: suppliedProjectRef});
        fail('HOST_PROJECT_BINDING_UNRESOLVED', 'A project-bound host session must include its absolute cwd; no session was attached', 422, binding);
      }
      requestedBinding = resolveProjectBinding({project_ref: suppliedProjectRef, ...(suppliedCwd === undefined ? {} : {cwd: suppliedCwd})});
      if (requestedBinding.status !== 'resolved') {
        const code = requestedBinding.status === 'conflict' ? 'HOST_PROJECT_BINDING_CONFLICT' : 'HOST_PROJECT_BINDING_UNRESOLVED';
        fail(code, 'Host session project binding could not be verified; no session was attached', requestedBinding.status === 'conflict' ? 409 : 422, requestedBinding);
      }
      requestedProjectRef = requestedBinding.project_ref;
    }
    const fingerprint = sha(stableHostJson({operation: 'attach', host: identityValue.host, session_id: identityValue.sessionId,
      project_ref: requestedProjectRef, cwd: requestedBinding.cwd ?? null, project_id: requestedBinding.project_id ?? null,
      git_root: requestedBinding.git_root ?? null, git_common_dir: requestedBinding.repository?.common_dir ?? null}));
    return transaction(() => {
      const timestamp = now();
      const previous = readSession(db, identityValue.host, identityValue.sessionId);
      if (previous?.status === 'ended') fail('HOST_SESSION_ENDED', 'An ended host session cannot be re-attached; use a new session identity', 409);
      if (previous && previous.project_ref !== null && requestedProjectRef !== null && !samePath(previous.project_ref, requestedProjectRef)) fail('HOST_SESSION_BINDING_CONFLICT', 'Host session is already bound to a different project', 409);
      let binding = requestedBinding;
      if (requestedProjectRef !== null) {
        // Re-read the filesystem/Git identity while holding the Product write
        // transaction.  The preflight above is only an early diagnostic; it
        // must not be the check that authorizes the durable INSERT/UPDATE.
        binding = verifyHostSessionProjectBinding({
          project_ref: requestedProjectRef,
          ...(suppliedCwd === undefined ? {} : {cwd: suppliedCwd}),
          // A resumed session must remain attached to the identity it first
          // recorded.  Legacy rows have null pins and are upgraded from the
          // current verified binding; pinned rows reject descriptor/repo
          // replacement instead of preserving a stale path-only session.
          project_id: previous?.project_id ?? requestedBinding.project_id,
          git_root: previous?.git_root ?? requestedBinding.git_root,
          git_common_dir: previous?.git_common_dir ?? requestedBinding.repository?.common_dir,
        });
        if (binding.status !== 'resolved') {
          const code = binding.status === 'conflict' ? 'HOST_PROJECT_BINDING_CONFLICT' : 'HOST_PROJECT_BINDING_UNRESOLVED';
          fail(code, 'Host session project binding changed before it could be attached; no session was attached', binding.status === 'conflict' ? 409 : 422, binding);
        }
        requestedProjectRef = binding.project_ref;
      }
      if (previous && previous.project_ref !== null && requestedProjectRef === null) {
        // A re-attach without project_ref keeps the original project binding.
        // A project-bound re-attach must still supply cwd: without it the
        // current filesystem/Git identity cannot be verified and the request
        // remains fail-closed rather than preserving a stale path binding.
        binding = verifyHostSessionProjectBinding({project_ref: previous.project_ref, ...(suppliedCwd === undefined ? {} : {cwd: suppliedCwd}),
          project_id: previous.project_id, git_root: previous.git_root, git_common_dir: previous.git_common_dir});
        if (binding.status !== 'resolved') {
          const code = binding.status === 'conflict' ? 'HOST_PROJECT_BINDING_CONFLICT' : 'HOST_PROJECT_BINDING_UNRESOLVED';
          fail(code, 'Host session project binding could not be verified; session remains unchanged', binding.status === 'conflict' ? 409 : 422, binding);
        }
        requestedProjectRef = previous.project_ref;
      }
      const projectId = requestedProjectRef === null ? null : binding.project_id;
      const gitRoot = requestedProjectRef === null ? null : binding.git_root;
      const gitCommonDir = requestedProjectRef === null ? null : binding.repository?.common_dir ?? null;
      // Check command replay only after the same binding checks that protect a
      // new write.  A stale replay must not mask descriptor/repository drift.
      const replay = controlReplay(db, identityValue.commandId, fingerprint);
      if (replay) return replay;
      if (!previous) {
        db.prepare(`INSERT INTO host_sessions(host,session_id,status,capture_policy,project_ref,project_id,git_root,git_common_dir,created_at,attached_at,paused_at,ended_at,updated_at,last_event_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(identityValue.host, identityValue.sessionId, 'attached', 'explicit', requestedProjectRef, projectId, gitRoot, gitCommonDir, timestamp, timestamp, null, null, timestamp, null);
      } else {
        db.prepare(`UPDATE host_sessions SET status='attached', project_ref=COALESCE(project_ref,?), project_id=COALESCE(project_id,?), git_root=COALESCE(git_root,?), git_common_dir=COALESCE(git_common_dir,?), attached_at=?, paused_at=NULL, updated_at=?
          WHERE host=? AND session_id=?`).run(requestedProjectRef, projectId, gitRoot, gitCommonDir, timestamp, timestamp, identityValue.host, identityValue.sessionId);
      }
      const session = {...sessionView(readSession(db, identityValue.host, identityValue.sessionId)), project_binding: binding};
      return saveControl(db, identityValue, 'attach', fingerprint, commandResult('attached', identityValue, {operation: 'attach', session, project_binding: binding}), timestamp);
    });
  }

  function pause(input) {
    const identityValue = commandIdentity(input, 'pause');
    const fingerprint = sha(stableHostJson({operation: 'pause', host: identityValue.host, session_id: identityValue.sessionId}));
    return transaction(() => {
      const replay = controlReplay(db, identityValue.commandId, fingerprint);
      if (replay) return replay;
      const timestamp = now();
      const previous = readSession(db, identityValue.host, identityValue.sessionId);
      if (!previous) fail('HOST_SESSION_NOT_FOUND', 'Host session is not attached', 404);
      if (previous.status === 'ended') fail('HOST_SESSION_ENDED', 'An ended host session cannot be paused', 409);
      if (previous.status === 'attached') db.prepare(`UPDATE host_sessions SET status='paused', paused_at=?, updated_at=? WHERE host=? AND session_id=?`).run(timestamp, timestamp, identityValue.host, identityValue.sessionId);
      const session = sessionView(readSession(db, identityValue.host, identityValue.sessionId));
      return saveControl(db, identityValue, 'pause', fingerprint, commandResult('paused', identityValue, {operation: 'pause', session}), timestamp);
    });
  }

  function detach(input) {
    const identityValue = commandIdentity(input, 'detach');
    const fingerprint = sha(stableHostJson({operation: 'detach', host: identityValue.host, session_id: identityValue.sessionId}));
    return transaction(() => {
      const replay = controlReplay(db, identityValue.commandId, fingerprint);
      if (replay) return replay;
      const timestamp = now();
      const previous = readSession(db, identityValue.host, identityValue.sessionId);
      if (!previous) fail('HOST_SESSION_NOT_FOUND', 'Host session is not attached', 404);
      if (previous.status !== 'ended') {
        db.prepare(`UPDATE host_sessions SET status='ended', ended_at=?, updated_at=? WHERE host=? AND session_id=?`).run(timestamp, timestamp, identityValue.host, identityValue.sessionId);
        // Closing a session is also the deterministic boundary for a turn
        // whose Stop/Interrupt event never arrived.
        db.prepare(`UPDATE host_turns SET state='interrupted', interrupted_at=?, updated_at=?
          WHERE host=? AND session_id=? AND state='started'`).run(timestamp, timestamp, identityValue.host, identityValue.sessionId);
      }
      const session = sessionView(readSession(db, identityValue.host, identityValue.sessionId));
      return saveControl(db, identityValue, 'detach', fingerprint, commandResult('ended', identityValue, {operation: 'detach', session}), timestamp);
    });
  }

  function ingestEvent(input) {
    const identityValue = eventIdentity(input);
    return transaction(() => {
      const sessionRow = readSession(db, identityValue.host, identityValue.sessionId);
      // No row means no explicit attachment. Crucially, do not insert an
      // ignored event here: an unattached prompt/final answer must not enter
      // any durable Trace database merely because a global hook saw it.
      if (!sessionRow) return eventResult({identityValue, session: null, outcome: 'ignored', reason: 'not_attached'});
      // Codex includes cwd on hook events.  Once a session is project-bound,
      // every event must include a cwd that still resolves to that exact
      // project and repository.  Drift or a missing cwd is an ignored,
      // structured receipt rather than a turn/finding mutation; personal
      // sessions intentionally skip this check.
      let projectBinding;
      if (sessionRow.project_ref !== null) {
        projectBinding = verifyHostSessionProjectBinding({project_ref: sessionRow.project_ref, cwd: input.cwd,
          project_id: sessionRow.project_id, git_root: sessionRow.git_root, git_common_dir: sessionRow.git_common_dir});
        if (projectBinding.status === 'conflict' || projectBinding.status === 'unresolved') {
          const result = eventResult({identityValue, session: sessionRow, outcome: 'ignored', reason: projectBinding.status === 'conflict' ? 'project_binding_conflict' : 'project_binding_unresolved', extra: {project_binding: projectBinding}});
          return result;
        }
      } else if (sessionRow.project_ref === null) {
        projectBinding = {status: 'personal', state: 'personal', project_ref: null, project_dir: null, project_id: null, cwd: null, git_root: null, repository: null, diagnostics: []};
      }
      // Only an attached session is allowed to normalize (and, for tool
      // events, hash) an official body. This keeps an untracked global hook
      // from doing work on arbitrary tool payloads before it becomes eligible
      // for capture.
      const normalized = normalizedEvent(input, identityValue);
      const previousReceipt = duplicateEvent(db, identityValue, normalized);
      if (previousReceipt) return previousReceipt;
      if (sessionRow.status === 'ended') {
        if (identityValue.eventKind !== 'SessionEnd') fail('HOST_SESSION_ENDED', 'Host session has ended; event was not accepted', 409);
        const result = eventResult({identityValue, session: sessionRow, outcome: 'ignored', reason: 'session_ended', extra: projectBinding === undefined ? {} : {project_binding: projectBinding}});
        insertEvent(db, identityValue, normalized, 'ignored', result, now());
        return result;
      }
      if (identityValue.eventKind === 'SessionEnd') {
        const timestamp = now();
        db.prepare(`UPDATE host_sessions SET status='ended', ended_at=?, updated_at=?, last_event_at=? WHERE host=? AND session_id=?`).run(timestamp, timestamp, timestamp, identityValue.host, identityValue.sessionId);
        db.prepare(`UPDATE host_turns SET state='interrupted', interrupted_at=?, updated_at=?
          WHERE host=? AND session_id=? AND state='started'`).run(timestamp, timestamp, identityValue.host, identityValue.sessionId);
        const result = eventResult({identityValue, session: {...sessionRow, status: 'ended', ended_at: timestamp, updated_at: timestamp, last_event_at: timestamp}, outcome: 'applied', reason: 'session_ended', extra: projectBinding === undefined ? {} : {project_binding: projectBinding}});
        insertEvent(db, identityValue, normalized, 'applied', result, timestamp);
        return result;
      }
      if (sessionRow.status === 'paused') return eventResult({identityValue, session: sessionRow, outcome: 'ignored', reason: 'paused'});
      if (['UserPromptSubmit', 'Stop', 'Interrupt'].includes(identityValue.eventKind) && identityValue.turnId === null) fail('INVALID_HOST_EVENT', `${identityValue.eventKind} requires turn_id`);
      const timestamp = now();
      if (identityValue.eventKind === 'SessionStart') {
        db.prepare('UPDATE host_sessions SET updated_at=?, last_event_at=? WHERE host=? AND session_id=?').run(timestamp, timestamp, identityValue.host, identityValue.sessionId);
        const result = eventResult({identityValue, session: {...sessionRow, updated_at: timestamp, last_event_at: timestamp}, outcome: 'applied', extra: projectBinding === undefined ? {} : {project_binding: projectBinding}});
        insertEvent(db, identityValue, normalized, 'applied', result, timestamp);
        return result;
      }
      if (identityValue.eventKind === 'PreToolUse' || identityValue.eventKind === 'PostToolUse') {
        // Retain only the safe event identity. Native tool input and output
        // remain with Codex/source evidence and never enter web.sqlite.
        db.prepare('UPDATE host_sessions SET updated_at=?, last_event_at=? WHERE host=? AND session_id=?').run(timestamp, timestamp, identityValue.host, identityValue.sessionId);
        const result = eventResult({identityValue, session: {...sessionRow, updated_at: timestamp, last_event_at: timestamp}, outcome: 'applied', extra: projectBinding === undefined ? {} : {project_binding: projectBinding}});
        insertEvent(db, identityValue, normalized, 'applied', result, timestamp);
        return result;
      }
      const turnId = identityValue.turnId;
      const existingTurn = readTurn(db, identityValue.host, identityValue.sessionId, turnId);
      if (identityValue.eventKind === 'UserPromptSubmit') {
        if (normalized.prompt === null) fail('INVALID_HOST_EVENT', 'UserPromptSubmit requires prompt after explicit attachment');
        const prompt = normalized.prompt;
        if (existingTurn) {
          if (existingTurn.state !== 'started') fail('HOST_EVENT_OUT_OF_ORDER', 'A prompt cannot be appended after a turn was closed', 409);
          if (existingTurn.prompt !== prompt) fail('HOST_TURN_CONFLICT', 'The turn already has a different prompt', 409);
        } else {
          db.prepare(`INSERT INTO host_turns(host,session_id,turn_id,state,prompt,last_assistant_message,started_at,completed_at,interrupted_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)`).run(identityValue.host, identityValue.sessionId, turnId, 'started', prompt, null, timestamp, null, null, timestamp);
        }
        db.prepare('UPDATE host_sessions SET updated_at=?, last_event_at=? WHERE host=? AND session_id=?').run(timestamp, timestamp, identityValue.host, identityValue.sessionId);
        const turn = turnView(readTurn(db, identityValue.host, identityValue.sessionId, turnId));
        const result = eventResult({identityValue, session: {...sessionRow, updated_at: timestamp, last_event_at: timestamp}, outcome: 'applied', turn, capturedFields: ['prompt'], extra: projectBinding === undefined ? {} : {project_binding: projectBinding}});
        insertEvent(db, identityValue, normalized, 'applied', result, timestamp);
        return result;
      }
      if (!existingTurn || existingTurn.state !== 'started') fail('HOST_EVENT_OUT_OF_ORDER', `${identityValue.eventKind} requires an open turn`, 409);
      if (identityValue.eventKind === 'Stop') {
        db.prepare(`UPDATE host_turns SET state='completed', last_assistant_message=?, completed_at=?, updated_at=?
          WHERE host=? AND session_id=? AND turn_id=? AND state='started'`).run(normalized.last_assistant_message, timestamp, timestamp, identityValue.host, identityValue.sessionId, turnId);
        // Stop only schedules bounded asynchronous sensemaking.  The hook never
        // invokes a model and the job/input are committed with this turn so a
        // successful receipt always has one recoverable source boundary.
        const safeEvidence = db.prepare(`SELECT event_kind,tool_use_id,content_sha256,created_at
          FROM host_ingest_events WHERE host=? AND session_id=? AND turn_id=?
          ORDER BY created_at DESC LIMIT 64`).all(identityValue.host, identityValue.sessionId, turnId);
        const relatedFindings = db.prepare(`SELECT finding_id,observation,desired_behavior,status,scope,target_kind
          FROM workflow_findings WHERE host=? AND session_id=? ORDER BY created_at DESC LIMIT 16`).all(identityValue.host, identityValue.sessionId);
        const job = enqueueSensemakingJob(db, {
          host: identityValue.host,
          session_id: identityValue.sessionId,
          turn_id: turnId,
          prompt: existingTurn.prompt,
          last_assistant_message: normalized.last_assistant_message,
          safe_evidence: safeEvidence,
          related_findings: relatedFindings,
        });
        // Keep the stable job identity in the Stop receipt without exposing the
        // prompt/final body through the hook response.
        var sensemakingJobId = job.job_id;
      } else if (identityValue.eventKind === 'Interrupt') {
        db.prepare(`UPDATE host_turns SET state='interrupted', interrupted_at=?, updated_at=?
          WHERE host=? AND session_id=? AND turn_id=? AND state='started'`).run(timestamp, timestamp, identityValue.host, identityValue.sessionId, turnId);
      }
      db.prepare('UPDATE host_sessions SET updated_at=?, last_event_at=? WHERE host=? AND session_id=?').run(timestamp, timestamp, identityValue.host, identityValue.sessionId);
      const turn = turnView(readTurn(db, identityValue.host, identityValue.sessionId, turnId));
      const result = eventResult({identityValue, session: {...sessionRow, updated_at: timestamp, last_event_at: timestamp}, outcome: 'applied', turn, capturedFields: identityValue.eventKind === 'Stop' ? ['last_assistant_message'] : [], extra: {...(sensemakingJobId === undefined ? {} : {sensemaking_job_id: sensemakingJobId}), ...(projectBinding === undefined ? {} : {project_binding: projectBinding})}});
      insertEvent(db, identityValue, normalized, 'applied', result, timestamp);
      return result;
    });
  }

  function captureWorkflowFinding(input) {
    const identityValue = commandIdentity(input, 'finding');
    const suppliedTurnId = optionalIdentity(input.turn_id ?? input.turnId, 'turn_id');
    const observation = validText(input.observation, 'observation');
    const desiredBehavior = optionalText(input.desired_behavior ?? input.desiredBehavior, 'desired_behavior');
    const fingerprint = sha(stableHostJson({operation: 'finding', host: identityValue.host, session_id: identityValue.sessionId, turn_id: suppliedTurnId, observation, desired_behavior: desiredBehavior}));
    return transaction(() => {
      const session = readSession(db, identityValue.host, identityValue.sessionId);
      if (!session || session.status === 'ended') fail(session ? 'HOST_SESSION_ENDED' : 'HOST_SESSION_NOT_FOUND', 'A workflow finding requires an attached or paused host session', session ? 409 : 404);
      // Check the stored project binding before command replay.  Otherwise a
      // retried finding command could change cwd and receive the old receipt,
      // masking the drift that must remain fail-closed.
      if (session.project_ref !== null) {
        const binding = verifyHostSessionProjectBinding({project_ref: session.project_ref, cwd: input.cwd,
          project_id: session.project_id, git_root: session.git_root, git_common_dir: session.git_common_dir});
        if (binding.status === 'conflict' || binding.status === 'unresolved') {
          fail(binding.status === 'conflict' ? 'HOST_PROJECT_BINDING_CONFLICT' : 'HOST_PROJECT_BINDING_UNRESOLVED', 'Workflow finding cwd does not match the attached project; no finding was captured', binding.status === 'conflict' ? 409 : 422, binding);
        }
      }
      const replay = controlReplay(db, identityValue.commandId, fingerprint);
      if (replay) return replay;
      const turnId = suppliedTurnId ?? db.prepare(`SELECT turn_id FROM host_turns WHERE host=? AND session_id=? AND state='started' ORDER BY updated_at DESC LIMIT 1`).get(identityValue.host, identityValue.sessionId)?.turn_id;
      if (!turnId) fail('HOST_TURN_NOT_FOUND', 'A workflow finding must reference the current open HostTurn', 404);
      const turn = readTurn(db, identityValue.host, identityValue.sessionId, turnId);
      if (!turn) fail('HOST_TURN_NOT_FOUND', 'A workflow finding must reference a captured HostTurn', 404);
      const timestamp = now();
      const findingId = `workflow-finding:${fingerprint.slice(0, 40)}`;
      const existingFinding = db.prepare('SELECT * FROM workflow_findings WHERE finding_id=?').get(findingId);
      if (!existingFinding) {
        const sourceRefs = JSON.stringify([{type: 'host-turn', host: identityValue.host, session_id: identityValue.sessionId, turn_id: turnId}]);
        db.prepare(`INSERT INTO workflow_findings(finding_id,host,session_id,turn_id,observation,desired_behavior,scope,target_kind,status,source_event_key,created_at,finding_kind,origin,source_refs)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(findingId, identityValue.host, identityValue.sessionId, turnId, observation, desiredBehavior, 'unknown', 'unresolved', 'captured', null, timestamp, 'captured', 'explicit', sourceRefs);
      }
      const finding = findingView(db.prepare('SELECT * FROM workflow_findings WHERE finding_id=?').get(findingId));
      return saveControl(db, identityValue, 'finding', fingerprint, commandResult('captured', identityValue, {operation: 'finding', finding}), timestamp);
    });
  }

  function getSession(input) {
    const host = identity(input.host ?? 'codex', 'host', MAX_HOST);
    const sessionId = identity(input.session_id ?? input.sessionId, 'session_id');
    return sessionView(readSession(db, host, sessionId));
  }

  function listSessions({host} = {}) {
    if (host !== undefined) identity(host, 'host', MAX_HOST);
    const rows = host === undefined
      ? db.prepare('SELECT * FROM host_sessions ORDER BY updated_at DESC').all()
      : db.prepare('SELECT * FROM host_sessions WHERE host=? ORDER BY updated_at DESC').all(host);
    return rows.map(sessionView);
  }

  function listTurns({host, session_id: sessionId, sessionId: alternateSessionId} = {}) {
    const resolvedHost = host === undefined ? undefined : identity(host, 'host', MAX_HOST);
    const resolvedSession = sessionId ?? alternateSessionId;
    if (resolvedSession !== undefined) identity(resolvedSession, 'session_id');
    let rows;
    if (resolvedHost === undefined && resolvedSession === undefined) rows = db.prepare('SELECT * FROM host_turns ORDER BY updated_at DESC').all();
    else if (resolvedHost !== undefined && resolvedSession !== undefined) rows = db.prepare('SELECT * FROM host_turns WHERE host=? AND session_id=? ORDER BY updated_at DESC').all(resolvedHost, resolvedSession);
    else if (resolvedHost !== undefined) rows = db.prepare('SELECT * FROM host_turns WHERE host=? ORDER BY updated_at DESC').all(resolvedHost);
    else rows = db.prepare('SELECT * FROM host_turns WHERE session_id=? ORDER BY updated_at DESC').all(resolvedSession);
    return rows.map(turnView);
  }

  function listWorkflowFindings({host, session_id: sessionId, sessionId: alternateSessionId} = {}) {
    const resolvedHost = host === undefined ? undefined : identity(host, 'host', MAX_HOST);
    const resolvedSession = sessionId ?? alternateSessionId;
    if (resolvedSession !== undefined) identity(resolvedSession, 'session_id');
    let rows;
    if (resolvedHost === undefined && resolvedSession === undefined) rows = db.prepare('SELECT * FROM workflow_findings ORDER BY created_at DESC').all();
    else if (resolvedHost !== undefined && resolvedSession !== undefined) rows = db.prepare('SELECT * FROM workflow_findings WHERE host=? AND session_id=? ORDER BY created_at DESC').all(resolvedHost, resolvedSession);
    else if (resolvedHost !== undefined) rows = db.prepare('SELECT * FROM workflow_findings WHERE host=? ORDER BY created_at DESC').all(resolvedHost);
    else rows = db.prepare('SELECT * FROM workflow_findings WHERE session_id=? ORDER BY created_at DESC').all(resolvedSession);
    return rows.map(findingView);
  }

  return Object.freeze({
    attach,
    pause,
    detach,
    ingestEvent,
    captureWorkflowFinding,
    getSession,
    listSessions,
    listTurns,
    listWorkflowFindings,
  });
}
