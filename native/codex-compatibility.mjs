/**
 * Codex compatibility is an evidence gate, not a semver allow-list.
 *
 * The app-server is an experimental wire protocol and a CLI may change its
 * schema without changing the shape of its version string.  The compatibility
 * decision therefore combines four independently replayable facts:
 *
 *   1. the executable's reported version and binary identity;
 *   2. a locally generated schema bundle and its content fingerprint;
 *   3. the required method surface extracted from that schema; and
 *   4. a live initialize/account/thread/interrupt probe performed on the
 *      executable that generated the bundle.
 *
 * A recorded version is useful as a cache key and a human-readable label, but
 * never grants compatibility by itself.  Keep this module dependency-free so
 * it can run from a packaged runtime before the plugin is installed.
 */

import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CODEX_PLUGIN_PROTOCOL_PROFILE = Object.freeze({
  id: 'codex-plugin-marketplace-v1',
  tested_versions: Object.freeze(['0.154.0-alpha.6.2']),
  tested_cli: 'codex-cli 0.154.0-alpha.6.2',
  required_commands: Object.freeze(['marketplace', 'add', 'list', 'remove']),
  marketplace_manifest: '.agents/plugins/marketplace.json',
});

// The app-server handshake is a separate protocol boundary from the plugin
// marketplace CLI.  0.153.4 has a recorded live wire/e2e run in
// `artifacts/trace-agent-runtime-20260915`; 0.154.0-alpha.6.2 has an
// isolated protocol check; 0.155.0-alpha.2.6 is the current machine's
// generated-schema fixture and live handshake target.  Do not turn this into
// a semver range: an unknown Codex build must be requalified first.
export const CODEX_APP_SERVER_PROTOCOL_PROFILE = Object.freeze({
  id: 'codex-app-server-v1',
  // This list is a registry of locally witnessed records, not an allow-list.
  // A new version must pass qualifyCodexAppServer before it can be added here.
  tested_versions: Object.freeze(['0.153.4', '0.154.0-alpha.6.2', '0.155.0-alpha.2.6']),
  default_version: '0.155.0-alpha.2.6',
  // These are the minimum wire surfaces checked against the generated schema
  // fixture for the current installed CLI.  A version string alone is not
  // compatibility evidence.
  protocol_requirements: Object.freeze({
    '0.155.0-alpha.2.6': Object.freeze({
      client_methods: Object.freeze(['initialize', 'account/read', 'thread/start', 'thread/resume', 'turn/start', 'turn/interrupt']),
      server_methods: Object.freeze(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval',
        'item/tool/requestUserInput', 'mcpServer/elicitation/request', 'item/tool/call', 'applyPatchApproval', 'execCommandApproval']),
      notifications: Object.freeze(['thread/started', 'turn/started', 'item/agentMessage/delta', 'item/started', 'item/completed', 'turn/completed']),
    }),
  }),
});

/**
 * The smallest app-server surface Trace's native adapter currently needs.
 * These are intentionally method names rather than a version-specific map.
 * The generated schema is the authority for their actual request shapes.
 */
export const CODEX_APP_SERVER_REQUIRED_SURFACE = Object.freeze({
  client_methods: Object.freeze(['initialize', 'account/read', 'thread/start', 'thread/resume', 'turn/start', 'turn/interrupt']),
  server_methods: Object.freeze(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval',
    'item/permissions/requestApproval', 'item/tool/requestUserInput', 'mcpServer/elicitation/request',
    'item/tool/call', 'applyPatchApproval', 'execCommandApproval']),
  notifications: Object.freeze(['thread/started', 'turn/started', 'item/agentMessage/delta', 'item/started', 'item/completed', 'turn/completed']),
});

const SCHEMA_FILES = Object.freeze({
  clientRequest: 'ClientRequest.json',
  serverRequest: 'ServerRequest.json',
  serverNotification: 'ServerNotification.json',
});

const QUALIFICATION_VERSION = 1;

function versionParts(value) {
  const match = String(value ?? '').match(/(?:^|\s)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)/);
  if (!match) return null;
  const [core, pre = ''] = match[1].split('-', 2);
  const numbers = core.split('.').map(Number);
  if (numbers.some(number => !Number.isInteger(number))) return null;
  return {raw: match[1], numbers, pre};
}

export function parseCodexVersion(value) {
  const parsed = versionParts(value);
  if (!parsed) throw new Error(`Unable to parse Codex CLI version: ${String(value ?? '').slice(0, 200)}`);
  return parsed;
}

export function parseCodexAppServerVersion(userAgent) {
  const match = String(userAgent ?? '').match(/(?:trace_agent|Codex Desktop|codex_cli_rs|codex)\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=\s|\(|$)/i);
  return match?.[1] ?? null;
}

export function validateCodexAppServerVersion(userAgent) {
  const version = parseCodexAppServerVersion(userAgent);
  if (!version || !CODEX_APP_SERVER_PROTOCOL_PROFILE.tested_versions.includes(version)) {
    throw new Error(`Unsupported Codex app-server version: ${version ?? 'unparseable'}`);
  }
  return {
    protocol_id: CODEX_APP_SERVER_PROTOCOL_PROFILE.id,
    status: 'compatible',
    verified_version: version,
    verified_versions: [...CODEX_APP_SERVER_PROTOCOL_PROFILE.tested_versions],
  };
}

function schemaMethods(schema, kind) {
  if (!schema || !Array.isArray(schema.oneOf)) throw new Error(`${kind} schema must contain oneOf`);
  const methods = schema.oneOf.flatMap(variant => {
    const values = variant?.properties?.method?.enum;
    return Array.isArray(values) && values.length === 1 && typeof values[0] === 'string' ? values : [];
  });
  if (new Set(methods).size !== methods.length) throw new Error(`${kind} schema contains duplicate methods`);
  return methods;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** JSON canonicalization used for fingerprints and qualification records. */
export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot fingerprint a non-finite JSON number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  throw new Error(`Cannot fingerprint ${typeof value}`);
}

export function sha256(value) {
  const input = Buffer.isBuffer(value) || value instanceof Uint8Array ? value : typeof value === 'string' ? value : canonicalJson(value);
  return crypto.createHash('sha256').update(input).digest('hex');
}

function safeRelativePath(root, name) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, name);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Schema manifest path escapes bundle: ${name}`);
  return resolved;
}

function schemaBundleObject(bundle) {
  if (!isRecord(bundle)) throw new Error('Codex app-server schema bundle must be an object');
  const normalized = {};
  for (const [key, file] of Object.entries(SCHEMA_FILES)) {
    const value = bundle[key];
    if (!isRecord(value) || !Array.isArray(value.oneOf)) throw new Error(`Codex schema bundle is missing ${file}`);
    normalized[key] = value;
  }
  return normalized;
}

/**
 * Read a schema bundle generated by `codex app-server generate-json-schema`.
 * If a generator manifest is present every listed file is hash-checked before
 * the bundle is accepted.  This prevents a hand-edited root schema from being
 * treated as evidence for a binary it did not come from.
 */
export function readCodexAppServerSchemaBundle(root, { verifyManifest = true, maxFileBytes = 32 * 1024 * 1024 } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Codex schema bundle root must be an absolute path');
  const manifestPath = path.join(root, 'manifest.json');
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch { throw new Error('Codex schema bundle manifest is not valid JSON'); }
    if (!isRecord(manifest) || !isRecord(manifest.files)) throw new Error('Codex schema bundle manifest has no files map');
    if (verifyManifest) {
      for (const [name, expected] of Object.entries(manifest.files)) {
        if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected)) throw new Error(`Invalid schema manifest hash for ${name}`);
        const filePath = safeRelativePath(root, name);
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > maxFileBytes) throw new Error(`Invalid schema bundle file: ${name}`);
        const actual = sha256(fs.readFileSync(filePath));
        if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`Schema manifest hash mismatch: ${name}`);
      }
    }
  }
  const bundle = {};
  for (const [key, name] of Object.entries(SCHEMA_FILES)) {
    const filePath = safeRelativePath(root, name);
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > maxFileBytes) throw new Error(`Invalid schema bundle file: ${name}`);
    try { bundle[key] = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { throw new Error(`Codex schema file is not valid JSON: ${name}`); }
  }
  return { ...schemaBundleObject(bundle), ...(manifest ? { manifest: structuredClone(manifest) } : {}) };
}

export function codexAppServerSchemaFingerprint(bundle) {
  const normalized = schemaBundleObject(bundle);
  return sha256(normalized);
}

function requiredSurfaceFor(version, requiredSurface) {
  if (requiredSurface !== undefined) return requiredSurface;
  return CODEX_APP_SERVER_PROTOCOL_PROFILE.protocol_requirements[version] ?? CODEX_APP_SERVER_REQUIRED_SURFACE;
}

function requireArray(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value;
}

function missingMethods(actual, expected) {
  return expected.filter(method => !actual.includes(method));
}

function assertRequiredSurface(bundle, requiredSurface = CODEX_APP_SERVER_REQUIRED_SURFACE) {
  if (!isRecord(requiredSurface)) throw new Error('Codex required protocol surface must be an object');
  const client = schemaMethods(bundle.clientRequest, 'ClientRequest');
  const server = schemaMethods(bundle.serverRequest, 'ServerRequest');
  const notifications = schemaMethods(bundle.serverNotification, 'ServerNotification');
  for (const [kind, actual, expected] of [['client_methods', client, requiredSurface.client_methods], ['server_methods', server, requiredSurface.server_methods], ['notifications', notifications, requiredSurface.notifications]]) {
    requireArray(expected, `required surface ${kind}`);
    const missing = missingMethods(actual, expected);
    if (missing.length) throw new Error(`${kind} schema is missing required methods: ${missing.join(', ')}`);
  }
  return { client, server, notifications };
}

/**
 * Validate a generated app-server protocol fixture in addition to the
 * handshake version.  This stays dependency-free so production can use the
 * version gate while tests can prove that the version was backed by actual
 * protocol shapes.
 */
export function validateCodexAppServerProtocolFixture({ version, clientRequest, serverRequest, serverNotification, requiredSurface }) {
  if (typeof version !== 'string' || !versionParts(version)) throw new Error(`Invalid Codex app-server version: ${version ?? 'missing'}`);
  const bundle = schemaBundleObject({ clientRequest, serverRequest, serverNotification });
  const methods = assertRequiredSurface(bundle, requiredSurfaceFor(version, requiredSurface));
  return { protocol_id: CODEX_APP_SERVER_PROTOCOL_PROFILE.id, status: 'compatible', version,
    schema_fingerprint: codexAppServerSchemaFingerprint(bundle),
    counts: { client_requests: methods.client.length, server_requests: methods.server.length, notifications: methods.notifications.length },
    checks: ['schema-method-surface', 'schema-fingerprint'] };
}

function normalizeVersionOutput(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
}

// The app-server userAgent contains caller-selected client labels both before
// and after the server version (for example `trace_agent/… dumb (trace_agent;
// 0.1.0)`). Those labels vary between the qualifier and Trace and therefore
// cannot be a binary compatibility identity. Keep the persisted record intact
// for auditability, but compare the stable version/platform portion.
function stableUserAgent(value) {
  const match = String(value ?? '').match(/\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s+(\([^)]*\))/);
  return match ? `${match[1]} ${match[2]}` : String(value ?? '').replace(/\s+dumb\s+\([^)]*\)\s*$/i, '').trim();
}

function probeWorkingDirectory(calls) {
  return calls?.find(item => item?.direction === 'request' && item.method === 'thread/start')?.params?.cwd ?? null;
}

function resolveExecutable(executable, env = process.env) {
  if (typeof executable !== 'string' || !executable.trim()) throw new Error('Codex executable is required for qualification');
  const candidate = executable.trim();
  if (path.isAbsolute(candidate)) return fs.realpathSync(candidate);
  const pathValue = env.PATH ?? env.Path ?? '';
  const extensions = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const file = path.join(directory, process.platform === 'win32' && !path.extname(candidate) ? `${candidate}${extension}` : candidate);
      try { if (fs.statSync(file).isFile()) return fs.realpathSync(file); } catch { /* continue PATH search */ }
    }
  }
  throw new Error(`Could not resolve Codex executable: ${candidate}`);
}

/**
 * Hash the actual executable rather than trusting a version string.  A binary
 * replacement with the same reported version invalidates the qualification.
 */
export function codexBinaryIdentity({ executable, versionOutput, env } = {}) {
  const resolved = resolveExecutable(executable, env);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size > 512 * 1024 * 1024) throw new Error('Codex executable is not a regular file within the qualification limit');
  return { path: resolved, sha256: sha256(fs.readFileSync(resolved)), size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs), versionOutput: normalizeVersionOutput(versionOutput) };
}

function parseInitializeVersion(result) {
  if (!isRecord(result) || typeof result.userAgent !== 'string') throw new Error('Codex initialize response has no userAgent');
  const version = parseCodexAppServerVersion(result.userAgent);
  if (!version) throw new Error('Codex initialize response has an unparseable userAgent');
  for (const [field, predicate] of [['codexHome', value => typeof value === 'string' && path.isAbsolute(value)],
    ['platformFamily', value => value === 'windows' || value === 'unix'], ['platformOs', value => typeof value === 'string' && value.length > 0 && value.length <= 32]]) {
    if (!predicate(result[field])) throw new Error(`Codex initialize response has invalid ${field}`);
  }
  return version;
}

/**
 * Check the live initialize evidence. `initializeParams` is included so the
 * record proves which capability negotiation was actually requested; the
 * server response is never treated as an authority for methods.
 */
export function validateCodexAppServerInitialize({ initializeResult, initializeParams, cliVersion, versionOutput, expectedCodexHome } = {}) {
  const userAgentVersion = parseInitializeVersion(initializeResult);
  const reportedVersion = cliVersion ?? (versionOutput ? parseCodexVersion(versionOutput).raw : null);
  if (reportedVersion && userAgentVersion !== reportedVersion) {
    throw new Error(`Codex initialize userAgent version ${userAgentVersion} does not match executable version ${reportedVersion}`);
  }
  if (expectedCodexHome && path.resolve(initializeResult.codexHome) !== path.resolve(expectedCodexHome)) {
    throw new Error('Codex initialize response points at a different CODEX_HOME');
  }
  const capabilities = initializeParams?.capabilities;
  if (!isRecord(capabilities) || capabilities.experimentalApi !== true) {
    throw new Error('Codex initialize did not negotiate experimentalApi=true');
  }
  return { user_agent: initializeResult.userAgent, verified_version: userAgentVersion,
    codex_home: initializeResult.codexHome, platform_family: initializeResult.platformFamily,
    platform_os: initializeResult.platformOs, requested_capabilities: structuredClone(capabilities) };
}

function probeCall(calls, method, predicate, label, direction = 'request') {
  const call = calls.find(item => (direction === '*' || item?.direction === direction) && item.method === method && predicate(item));
  if (!call) throw new Error(`Codex protocol probe is missing ${label}`);
  return call;
}

function sanitizeProbeCalls(calls) {
  if (!Array.isArray(calls)) throw new Error('Codex protocol probe calls must be an array');
  return calls.map(item => {
    if (!isRecord(item) || typeof item.method !== 'string') throw new Error('Codex protocol probe contains an invalid call');
    const out = { direction: item.direction, method: item.method };
    if (item.direction === 'request') {
      if (item.method === 'account/read') out.params = { refreshToken: item.params?.refreshToken === false ? false : null };
      else if (item.method === 'thread/start') out.params = { cwd: item.params?.cwd ?? null, ephemeral: item.params?.ephemeral === true, approvalPolicy: item.params?.approvalPolicy ?? null };
      else if (item.method === 'turn/start') out.params = { threadId: item.params?.threadId ?? null };
      else if (item.method === 'turn/interrupt') out.params = { threadId: item.params?.threadId ?? null, turnId: item.params?.turnId ?? null };
      else out.params = {};
      if (item.method === 'thread/start') out.result = { cwd: item.result?.cwd ?? null, thread: { id: item.result?.thread?.id ?? null, ephemeral: item.result?.thread?.ephemeral === true } };
      else if (item.method === 'turn/start') out.result = { turn: { id: item.result?.turn?.id ?? null } };
      else if (item.method === 'turn/interrupt') out.result = { turn: { id: item.result?.turn?.id ?? null } };
    } else if (item.method === 'turn/started') out.params = { threadId: item.params?.threadId ?? null, turn: { id: item.params?.turn?.id ?? null } };
    else out.params = {};
    return out;
  });
}

/**
 * Validate a wire probe. The default `no-model` mode only starts an ephemeral
 * thread; it never starts a model turn. The explicit `turn-interrupt` mode is
 * available for a separately approved qualification run and must capture an
 * interrupt before any assistant output/item completion.
 */
export function validateCodexAppServerProbe({ calls, expectedCwd, threadId, turnId, mode = 'no-model' } = {}) {
  if (!Array.isArray(calls) || calls.length === 0) throw new Error('Codex protocol probe must include captured wire calls');
  const initialize = probeCall(calls, 'initialize', () => true, 'initialize');
  const initialized = probeCall(calls, 'initialized', () => true, 'initialized notification', '*');
  const account = probeCall(calls, 'account/read', item => item.params?.refreshToken === false, 'account/read(refreshToken=false)');
  const start = probeCall(calls, 'thread/start', item => item.params?.ephemeral === true, 'ephemeral thread/start');
  const actualThreadId = threadId ?? start.result?.thread?.id;
  if (typeof actualThreadId !== 'string' || !actualThreadId) throw new Error('Codex protocol probe thread/start returned no thread id');
  if (start.result?.thread?.ephemeral !== true) throw new Error('Codex protocol probe thread is not ephemeral');
  if (expectedCwd && start.result?.cwd && path.resolve(start.result.cwd) !== path.resolve(expectedCwd)) throw new Error('Codex protocol probe returned a different cwd');
  if (mode === 'no-model') {
    if (calls.some(item => item.method === 'turn/start' || item.method === 'turn/interrupt')) throw new Error('no-model Codex protocol probe must not start a turn');
    return { mode, checks: ['initialize', 'initialized', 'account/read', 'thread/start(ephemeral)', 'no-model-turn'],
      thread_id: actualThreadId, request_count: calls.length };
  }
  if (mode !== 'turn-interrupt') throw new Error(`Unknown Codex protocol probe mode: ${mode}`);
  const turnStart = probeCall(calls, 'turn/start', item => item.params?.threadId === actualThreadId, 'turn/start for the probed thread');
  const actualTurnId = turnId ?? turnStart.result?.turn?.id ?? calls.find(item => item.method === 'turn/started')?.params?.turn?.id;
  if (typeof actualTurnId !== 'string' || !actualTurnId) throw new Error('Codex protocol probe turn/start returned no turn id');
  probeCall(calls, 'turn/interrupt', item => item.params?.threadId === actualThreadId && item.params?.turnId === actualTurnId, 'turn/interrupt for the probed turn');
  const output = calls.filter(item => ['item/agentMessage/delta', 'item/completed'].includes(item.method));
  if (output.length) throw new Error('Codex protocol probe produced model output before interruption');
  return { mode, checks: ['initialize', 'initialized', 'account/read', 'thread/start(ephemeral)', 'turn/start', 'turn/interrupt', 'no-model-output'],
    thread_id: actualThreadId, turn_id: actualTurnId, request_count: calls.length,
    initialize_seen: initialize.method, initialized_seen: initialized.method, account_seen: account.method };
}

function qualificationPathValue(value, field) {
  if (typeof value !== 'string' || !value) throw new Error(`Qualification record is missing ${field}`);
  return value;
}

export function createCodexQualificationRecord({ executableIdentity, versionOutput, initializeResult, initializeParams,
  schemaBundle, probeCalls, probeMode = 'no-model', expectedCwd, generatedBy = 'trace-runtime' } = {}) {
  if (!isRecord(executableIdentity) || !/^[a-f0-9]{64}$/i.test(executableIdentity.sha256 ?? '')) throw new Error('Codex qualification requires a hashed executable identity');
  const parsedVersion = parseCodexVersion(versionOutput).raw;
  const init = validateCodexAppServerInitialize({ initializeResult, initializeParams, cliVersion: parsedVersion, versionOutput });
  const fixture = validateCodexAppServerProtocolFixture({ version: parsedVersion, ...schemaBundleObject(schemaBundle), requiredSurface: CODEX_APP_SERVER_REQUIRED_SURFACE });
  const probe = validateCodexAppServerProbe({ calls: probeCalls, mode: probeMode, expectedCwd });
  probe.evidence = sanitizeProbeCalls(probeCalls);
  const record = {
    format: 'trace.codex-app-server-qualification', version: QUALIFICATION_VERSION,
    protocol_id: CODEX_APP_SERVER_PROTOCOL_PROFILE.id, cli_version: parsedVersion,
    user_agent: init.user_agent, generated_by: generatedBy,
    executable: { path: qualificationPathValue(executableIdentity.path, 'executable.path'), sha256: executableIdentity.sha256,
      size: executableIdentity.size, mtimeMs: executableIdentity.mtimeMs, version_output: normalizeVersionOutput(versionOutput) },
    schema: { fingerprint: fixture.schema_fingerprint, required_surface: structuredClone(CODEX_APP_SERVER_REQUIRED_SURFACE),
      counts: fixture.counts },
    initialize: { codex_home: init.codex_home, platform_family: init.platform_family, platform_os: init.platform_os,
      requested_capabilities: init.requested_capabilities },
    probe,
    qualified_at: new Date().toISOString(),
  };
  record.cache_key = sha256({ cli_version: record.cli_version, user_agent: record.user_agent,
    executable_sha256: record.executable.sha256, schema_fingerprint: record.schema.fingerprint,
    probe_fingerprint: sha256(record.probe.evidence) });
  return record;
}

export function validateCodexQualificationRecord(record, { schemaBundle, executableIdentity, initializeResult, initializeParams, probeCalls, expectedCwd, now = Date.now(), maxAgeMs = Infinity } = {}) {
  if (!isRecord(record) || record.format !== 'trace.codex-app-server-qualification' || record.version !== QUALIFICATION_VERSION) throw new Error('Invalid Codex qualification record format');
  if (typeof record.qualified_at !== 'string' || !Number.isFinite(Date.parse(record.qualified_at))) throw new Error('Invalid Codex qualification timestamp');
  if (maxAgeMs !== Infinity && now - Date.parse(record.qualified_at) > maxAgeMs) throw new Error('Codex qualification record is expired');
  const actualFingerprint = schemaBundle ? codexAppServerSchemaFingerprint(schemaBundle) : null;
  if (actualFingerprint && actualFingerprint !== record.schema?.fingerprint) throw new Error('Codex qualification schema fingerprint is stale');
  if (executableIdentity && executableIdentity.sha256 !== record.executable?.sha256) throw new Error('Codex qualification executable identity is stale');
  if (executableIdentity?.path && record.executable?.path && path.resolve(executableIdentity.path) !== path.resolve(record.executable.path)) throw new Error('Codex qualification executable path is stale');
  if (initializeResult) {
    if (stableUserAgent(initializeResult.userAgent) !== stableUserAgent(record.user_agent)) throw new Error('Codex qualification userAgent is stale');
    validateCodexAppServerInitialize({ initializeResult, initializeParams, cliVersion: record.cli_version,
      expectedCodexHome: record.initialize?.codex_home });
    if (initializeResult.platformFamily !== record.initialize?.platform_family
      || initializeResult.platformOs !== record.initialize?.platform_os) {
      throw new Error('Codex qualification platform identity is stale');
    }
  }
  const recordedProbe = record.probe?.evidence;
  if (probeCalls) validateCodexAppServerProbe({ calls: probeCalls, mode: record.probe?.mode ?? 'no-model', expectedCwd });
  else if (recordedProbe) {
    // Qualification is installation/protocol-scoped, not project-scoped.
    // Replay the cwd captured by the probe itself; the currently selected
    // project is checked by the native adapter's realpath/thread operation.
    validateCodexAppServerProbe({ calls: recordedProbe, mode: record.probe?.mode ?? 'no-model',
      expectedCwd: probeWorkingDirectory(recordedProbe) ?? undefined });
  }
  else throw new Error('Codex qualification record has no replayable protocol probe');
  if (schemaBundle) validateCodexAppServerProtocolFixture({ version: record.cli_version, ...schemaBundleObject(schemaBundle), requiredSurface: record.schema.required_surface });
  if (typeof record.cache_key !== 'string' || record.cache_key !== sha256({ cli_version: record.cli_version,
    user_agent: record.user_agent, executable_sha256: record.executable?.sha256, schema_fingerprint: record.schema?.fingerprint,
    probe_fingerprint: sha256(recordedProbe) })) throw new Error('Codex qualification cache key is invalid');
  return { status: 'compatible', protocol_id: record.protocol_id, verified_version: record.cli_version,
    schema_fingerprint: record.schema.fingerprint, cache_key: record.cache_key, checks: ['record', 'binary', 'schema', 'initialize', 'probe'] };
}

export function readCodexQualificationRecord(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Codex qualification record path must be absolute');
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { throw new Error('Codex qualification record is unavailable or invalid'); }
}

/**
 * Startup consumer for the native adapter. It re-checks the installed
 * executable, generated schema, and live initialize response against the
 * user-local qualification record. No semver fallback is performed. The
 * persisted no-model probe is verified as replay evidence; rerun the CLI
 * qualifier when binary/schema identity changes.
 */
export function validateCodexAppServerInstallation({ initializeResult, initializeParams, executable, env = process.env,
  qualificationRecordPath, expectedCwd } = {}) {
  const filePath = qualificationRecordPath ?? path.join(os.homedir(), '.trace-runtime', 'codex-app-server-qualification.json');
  const record = readCodexQualificationRecord(filePath);
  const versionResult = spawnSync(executable, ['--version'], { encoding: 'utf8', shell: false, windowsHide: true, env });
  if (versionResult.error || versionResult.status !== 0) throw new Error('Unable to re-check the installed Codex version');
  const versionOutput = versionResult.stdout || versionResult.stderr || '';
  const executableIdentity = codexBinaryIdentity({ executable, versionOutput, env });
  const schemaSource = record.schema?.source;
  if (typeof schemaSource !== 'string' || !path.isAbsolute(schemaSource)) throw new Error('Codex qualification record has no local schema source');
  const schemaBundle = readCodexAppServerSchemaBundle(schemaSource);
  const result = validateCodexQualificationRecord(record, { schemaBundle, executableIdentity, initializeResult,
    initializeParams });
  return { ...result, recordPath: filePath, schemaSource, userAgent: initializeResult?.userAgent ?? null };
}

/** Atomically publish a local qualification record; never writes to source fixtures. */
export function writeCodexQualificationRecord(filePath, record) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Codex qualification record path must be absolute');
  if (!isRecord(record)) throw new Error('Codex qualification record must be an object');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { fs.renameSync(temp, filePath); }
  catch (error) {
    if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') { try { fs.rmSync(temp, { force: true }); } catch {} throw error; }
    fs.rmSync(filePath, { force: true }); fs.renameSync(temp, filePath);
  }
  return filePath;
}

function hasCommand(help, command) {
  return new RegExp(`(?:^|\\s)${command.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?:\\s|$)`, 'm').test(help);
}

export function validateCodexPluginProtocol({versionOutput, pluginHelpOutput, marketplaceListOutput}) {
  const version = parseCodexVersion(versionOutput);
  const tested = CODEX_PLUGIN_PROTOCOL_PROFILE.tested_versions.includes(version.raw);
  if (!tested) {
    throw new Error(`Unsupported Codex CLI version ${version.raw}; verified versions: ${CODEX_PLUGIN_PROTOCOL_PROFILE.tested_versions.join(', ')}`);
  }
  const help = String(pluginHelpOutput ?? '');
  const missing = CODEX_PLUGIN_PROTOCOL_PROFILE.required_commands.filter(command => !hasCommand(help, command));
  if (missing.length) throw new Error(`Codex plugin protocol is missing commands: ${missing.join(', ')}`);
  let marketplace;
  try { marketplace = JSON.parse(String(marketplaceListOutput ?? '')); }
  catch { throw new Error('Codex plugin marketplace list did not return JSON'); }
  if (!marketplace || !Array.isArray(marketplace.marketplaces)) throw new Error('Codex plugin marketplace list has no marketplaces array');
  return {
    protocol_id: CODEX_PLUGIN_PROTOCOL_PROFILE.id,
    status: 'compatible',
    verified_version: version.raw,
    marketplace_manifest: CODEX_PLUGIN_PROTOCOL_PROFILE.marketplace_manifest,
    checks: ['version', 'plugin-help', 'marketplace-list-json'],
  };
}
