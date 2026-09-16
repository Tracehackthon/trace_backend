import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applyProductOperations, validateProductCommand, ProductCommandError } from './commands.mjs';
import {
  CodexBridgeError,
  codexRequestFingerprint,
  findCodexBridgeResponse,
  receiveCodexContext,
  returnCodexResult,
  validateCodexReceiveRequest,
  validateCodexReturnRequest,
} from './codex-bridge.mjs';

// This database is deliberately independent of the cognitive/adopted ledgers.
// The caller owns TRACE_WEB_STATE_FILE and chooses an explicit absolute path.
const APPLICATION_ID = 0x54525731; // TRW1
const SCHEMA_VERSION = 1;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_ENTITIES = 10000;
const KINDS = ['host-meta', 'chain-meta', 'matter', 'source', 'chain-session', 'comparison', 'worksite-meta', 'work', 'worksite-session', 'work-guard'];
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stableJson = value => Array.isArray(value) ? `[${value.map(stableJson).join(',')}]` : plain(value)
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}` : JSON.stringify(value);

class WebStoreError extends Error {
  constructor(status, code, message, revision) { super(message); this.status = status; this.code = code; this.revision = revision; }
}
function demand(condition, code, message, status = 422) { if (!condition) throw new WebStoreError(status, code, message); }
function identity(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value) && !FORBIDDEN_KEYS.has(value); }
function checkTree(value) {
  const queue = [[value, 0]]; let nodes = 0;
  while (queue.length) {
    const [node, depth] = queue.pop();
    demand(++nodes <= 250000 && depth <= 64, 'HOST_TOO_COMPLEX', '工作区数据超过结构限制。');
    if (typeof node === 'number') demand(Number.isFinite(node), 'INVALID_HOST', '工作区数字必须有限。');
    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        demand(!FORBIDDEN_KEYS.has(key), 'INVALID_HOST', '工作区包含无效对象键。');
        queue.push([child, depth + 1]);
      }
    }
  }
}
function arrayMap(items, name) {
  demand(Array.isArray(items), 'INVALID_HOST', `${name} 必须是实体数组。`);
  const result = new Map();
  for (const item of items) {
    demand(plain(item) && identity(item.id) && !result.has(item.id), 'INVALID_IDENTITY', `${name} 的 ID 无效或重复。`);
    result.set(item.id, item);
  }
  return result;
}
function objectMap(items, name) {
  demand(plain(items), 'INVALID_HOST', `${name} 必须是按 ID 索引的对象。`);
  for (const [id, item] of Object.entries(items)) demand(identity(id) && plain(item), 'INVALID_IDENTITY', `${name} 的 ID 或对象无效。`);
  return new Map(Object.entries(items));
}

/** Canonical entities plus separately scoped recovery state, never an opaque host blob. */
function normalizeHost(input) {
  checkTree(input);
  demand(plain(input) && input.schemaVersion === 1, 'INVALID_HOST', '需要 schemaVersion 1 的工作区对象。');
  const allowed = new Set(['schemaVersion', 'chain', 'comparisons', 'worksite', 'workGuards', 'preferences', 'route', 'error']);
  demand(Object.keys(input).every(key => allowed.has(key)), 'INVALID_HOST', '工作区包含未支持的顶层字段。');
  if (input.preferences !== undefined) demand(plain(input.preferences) && typeof input.preferences.displayName === 'string' && input.preferences.displayName.length <= 200 && typeof input.preferences.reduceMotion === 'boolean' && Object.keys(input.preferences).every(key => ['displayName', 'reduceMotion'].includes(key)), 'INVALID_PREFERENCES', '偏好需包含有效 displayName 和 reduceMotion。');
  demand(plain(input.chain) && input.chain.schemaVersion === 1 && plain(input.worksite) && input.worksite.schemaVersion === 1, 'INVALID_HOST', '事项和工作模型版本无效。');
  demand(input.chain.isDemo !== true && input.worksite.isDemo !== true, 'DEMO_NOT_PERSISTABLE', '示例工作区不能写入真实工作区。');
  demand(!Object.hasOwn(input.worksite, 'matters'), 'DUPLICATE_MATTER_OWNER', '工作投影不能另存第二份事项库。');
  const host = structuredClone(input), chain = host.chain, worksite = host.worksite;
  const matters = arrayMap(chain.matters, 'chain.matters'), sources = arrayMap(chain.sources, 'chain.sources');
  const sessions = objectMap(chain.sessions, 'chain.sessions'), comparisons = objectMap(host.comparisons, 'comparisons');
  const works = objectMap(worksite.works, 'worksite.works'), workSessions = objectMap(worksite.sessions, 'worksite.sessions'), guards = objectMap(host.workGuards, 'workGuards');
  demand(matters.size + sources.size + sessions.size + comparisons.size + works.size + workSessions.size + guards.size <= MAX_ENTITIES, 'TOO_MANY_ENTITIES', '工作区实体数量超过限制。');
  demand(Number.isSafeInteger(chain.nextId) && chain.nextId >= 1, 'INVALID_HOST', '事项序号无效。');
  demand(chain.selectedId === null || matters.has(chain.selectedId), 'INVALID_REFERENCE', '所选事项不存在。');
  demand(worksite.selectedWorkId === null || works.has(worksite.selectedWorkId), 'INVALID_REFERENCE', '所选工作不存在。');
  for (const [id, matter] of matters) {
    demand(sessions.has(id), 'INVALID_REFERENCE', '事项缺少自己的恢复会话。');
    demand(Number.isSafeInteger(matter.understandingVersion) && matter.understandingVersion >= 0, 'INVALID_HOST', '理解版本无效。');
    demand(typeof matter.understanding === 'string' && typeof matter.understandingDraft === 'string', 'INVALID_HOST', '理解正文及草稿必须是字符串。');
    if (matter.sourceIds !== undefined) demand(Array.isArray(matter.sourceIds) && matter.sourceIds.every(sourceId => sources.has(sourceId)), 'INVALID_REFERENCE', '事项引用了不存在的来源。');
  }
  for (const id of sessions.keys()) demand(matters.has(id), 'INVALID_REFERENCE', '事项会话没有对应事项。');
  for (const source of sources.values()) {
    demand(!String(source.kind || '').startsWith('example-'), 'DEMO_NOT_PERSISTABLE', '示例来源不能写入真实工作区。');
    if (source.ownerMatterId != null) demand(matters.has(source.ownerMatterId), 'INVALID_REFERENCE', '来源归属的事项不存在。');
  }
  for (const [id, comparison] of comparisons) {
    demand(matters.has(comparison.matterId) && plain(comparison.model) && comparison.model.matter?.id === comparison.matterId && comparison.model.sessionId === id, 'INVALID_REFERENCE', '对照会话与原事项身份不一致。');
    // The existing comparison reducer hardcodes isDemo even for user-only catalogs.
    // Do not infer authorship from that UI flag; the host owns supplied evidence.
    comparison.model.notice = '';
  }
  for (const [id, work] of works) demand(work.id === id && workSessions.has(id), 'INVALID_REFERENCE', '工作实体 ID 或恢复会话不一致。');
  for (const [id, session] of workSessions) {
    demand(works.has(id), 'INVALID_REFERENCE', '工作会话没有对应工作。');
    if (session.intake !== undefined) demand(Array.isArray(session.intake) && session.intake.every(item => plain(item) && matters.has(item.matterId)), 'INVALID_REFERENCE', '工作带入引用了不存在的事项。');
  }
  for (const [id, guard] of guards) demand(works.has(id) && matters.has(guard.matterId), 'INVALID_REFERENCE', '工作版本保护引用了不存在的实体。');
  host.route = { view: 'home' }; host.error = null;
  chain.notice = ''; worksite.notice = '';
  return host;
}

function splitHost(host) {
  const rows = []; const add = (kind, id, payload, ordinal = 0) => rows.push({ kind, id, ordinal, payload: stableJson(payload) });
  add('host-meta', '$', { schemaVersion: host.schemaVersion, ...(host.preferences === undefined ? {} : { preferences: host.preferences }) });
  const { matters, sources, sessions, ...chainMeta } = host.chain;
  add('chain-meta', '$', chainMeta);
  matters.forEach((item, ordinal) => add('matter', item.id, item, ordinal));
  sources.forEach((item, ordinal) => add('source', item.id, item, ordinal));
  Object.entries(sessions).forEach(([id, item]) => add('chain-session', id, item));
  Object.entries(host.comparisons).forEach(([id, item]) => add('comparison', id, item));
  const { works, sessions: workSessions, ...worksiteMeta } = host.worksite;
  add('worksite-meta', '$', worksiteMeta);
  Object.entries(works).forEach(([id, item]) => add('work', id, item));
  Object.entries(workSessions).forEach(([id, item]) => add('worksite-session', id, item));
  Object.entries(host.workGuards).forEach(([id, item]) => add('work-guard', id, item));
  return rows;
}

function databaseError(error) {
  if (error instanceof WebStoreError || error instanceof ProductCommandError || error instanceof CodexBridgeError) return error;
  if (/SQLITE_BUSY|database is locked|database is busy/i.test(String(error))) return new WebStoreError(503, 'STORAGE_BUSY', '工作区存储正忙，请保留草稿并稍后重试。');
  return new WebStoreError(503, 'STORAGE_FAILURE', '工作区存储读取或写入失败，未重置原数据。');
}
function assertDatabase(db, allowEmpty) {
  const integrity = db.prepare('PRAGMA quick_check').all();
  demand(integrity.length === 1 && integrity[0].quick_check === 'ok', 'STORAGE_CORRUPT', '工作区数据库损坏，未重置。', 503);
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
  if (allowEmpty && tables.length === 0 && db.prepare('PRAGMA application_id').get().application_id === 0) return false;
  demand(db.prepare('PRAGMA application_id').get().application_id === APPLICATION_ID && db.prepare('PRAGMA user_version').get().user_version === SCHEMA_VERSION, 'WRONG_DATABASE', '这不是独立 Trace Web 数据库，未写入。', 503);
  demand(['web_workspace', 'web_snapshots', 'web_entities', 'web_commands'].every(table => tables.includes(table)) && tables.length === 4, 'STORAGE_CORRUPT', '工作区数据表缺失或不一致，未重置。', 503);
  return true;
}

function reply(res, status, value, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin', ...extra });
  res.end(JSON.stringify(value));
}
function checkOrigin(req, write) {
  const host = req.headers.host;
  demand(typeof host === 'string' && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host), 'UNTRUSTED_HOST', '仅支持本机同源工作区访问。', 403);
  const protocol = req.socket.encrypted ? 'https:' : 'http:';
  const expected = new URL(`${protocol}//${host}`).origin;
  const origin = req.headers.origin;
  if (write || origin !== undefined) demand(typeof origin === 'string' && origin === expected, 'ORIGIN_REQUIRED', '写入必须来自当前工作区的同源页面。', 403);
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined) demand(site === 'same-origin' || (!write && site === 'none'), 'CROSS_SITE_REQUEST', '不接受跨站工作区请求。', 403);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, settled = false;
    const done = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', aborted); if (error) { req.resume(); reject(error); } else resolve(value); };
    const fail = () => done(new WebStoreError(400, 'REQUEST_INTERRUPTED', '请求未完整接收，未保存。'));
    const aborted = fail;
    const data = chunk => { size += chunk.length; if (size > MAX_BODY_BYTES) done(new WebStoreError(413, 'BODY_TOO_LARGE', '工作区请求超过 8 MiB 限制。')); else chunks.push(chunk); };
    const end = () => {
      try { const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); done(null, JSON.parse(decoded)); }
      catch { done(new WebStoreError(400, 'INVALID_JSON', '请求必须是有效 UTF-8 JSON。')); }
    };
    const timer = setTimeout(() => done(new WebStoreError(408, 'REQUEST_TIMEOUT', '请求接收超时，未保存。')), 10000);
    timer.unref?.();
    req.on('data', data); req.on('end', end); req.on('error', fail); req.on('aborted', aborted);
  });
}

/** Product commands plus read/export compatibility. Snapshot writes are disabled
 * by default; allowSnapshotWrites is an explicit library-only legacy import aid,
 * never a request field or an option enabled by the desktop server. Schema v1 is
 * retained; product command fingerprints are namespaced in the existing ledger. */
/** Authoritative local Product Workspace: product entities, command CAS,
 * receipts and Codex delivery/return records share one transactional owner. */
export function createProductWorkspace({ file, allowSnapshotWrites = false, desktopSnapshotToken } = {}) {
  demand(typeof file === 'string' && path.isAbsolute(file), 'INVALID_PATH', 'Web SQLite 路径必须明确为绝对路径。');
  demand(desktopSnapshotToken === undefined || typeof desktopSnapshotToken === 'string' && desktopSnapshotToken.length >= 32 && desktopSnapshotToken.length <= 256,
    'INVALID_DESKTOP_TOKEN', '桌面工作区令牌配置无效。');
  file = path.resolve(file);
  demand(path.basename(file).toLowerCase() !== 'trace.sqlite', 'WRONG_DATABASE', 'Web 状态不得写入认知 trace.sqlite。');
  // Probe existing files read-only before WAL/schema pragmas can touch them.
  if (fs.existsSync(file)) {
    const probe = new DatabaseSync(file, { readOnly: true });
    try { assertDatabase(probe, true); } finally { probe.close(); }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file); let closed = false;
  const storage = { kind: 'sqlite', location: file };
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { try { db.exec('ROLLBACK'); } catch { /* original failure wins */ } throw error; }
  }
  function readSnapshot(revision) {
    if (revision === 0) return { revision: 0, host: null, storage };
    try {
      const snapshot = db.prepare('SELECT entity_counts FROM web_snapshots WHERE revision=?').get(revision);
      demand(snapshot, 'STORAGE_CORRUPT', '工作区修订缺失，未重置。', 503);
      const expected = JSON.parse(snapshot.entity_counts), counts = Object.fromEntries(KINDS.map(kind => [kind, 0]));
      const entities = db.prepare('SELECT kind,object_id,ordinal,payload,payload_sha256 FROM web_entities WHERE workspace_revision=? ORDER BY kind,ordinal,object_id').all(revision);
      const groups = Object.fromEntries(KINDS.map(kind => [kind, []]));
      for (const row of entities) {
        demand(Object.hasOwn(groups, row.kind) && sha(row.payload) === row.payload_sha256, 'STORAGE_CORRUPT', '实体完整性检查失败，未重置。', 503);
        const payload = JSON.parse(row.payload);
        demand(plain(payload), 'STORAGE_CORRUPT', '实体格式损坏，未重置。', 503);
        groups[row.kind].push({ id: row.object_id, payload }); counts[row.kind]++;
      }
      demand(stableJson(counts) === stableJson(expected), 'STORAGE_CORRUPT', '实体数量不一致，未重置。', 503);
      const meta = kind => { demand(groups[kind].length === 1 && groups[kind][0].id === '$', 'STORAGE_CORRUPT', '工作区恢复元数据缺失。', 503); return groups[kind][0].payload; };
      const map = kind => Object.fromEntries(groups[kind].map(row => [row.id, row.payload]));
      for (const kind of ['matter', 'source', 'work']) for (const row of groups[kind]) demand(row.payload.id === row.id, 'STORAGE_CORRUPT', '实体 ID 与数据库行不一致。', 503);
      const host = { ...meta('host-meta'), chain: { ...meta('chain-meta'), matters: groups.matter.map(row => row.payload), sources: groups.source.map(row => row.payload), sessions: map('chain-session') }, comparisons: map('comparison'), worksite: { ...meta('worksite-meta'), works: map('work'), sessions: map('worksite-session') }, workGuards: map('work-guard'), route: { view: 'home' }, error: null };
      return { revision, host: normalizeHost(host), storage };
    } catch (error) {
      if (error instanceof WebStoreError && error.status === 503) throw error;
      throw new WebStoreError(503, 'STORAGE_CORRUPT', '已保存工作区无法还原，未清空或覆盖。');
    }
  }
  function currentRevision() {
    // One SQLite read view: a concurrent commit cannot split these counters.
    const rows = db.prepare(`SELECT revision,
      (SELECT COALESCE(MAX(revision),0) FROM web_snapshots) AS latest,
      (SELECT COUNT(*) FROM web_snapshots) AS snapshots,
      (SELECT COUNT(*) FROM web_commands) AS commands,
      (SELECT COUNT(DISTINCT committed_revision) FROM web_commands) AS committed
      FROM web_workspace WHERE singleton=1`).all();
    demand(rows.length === 1 && Number.isSafeInteger(rows[0].revision) && rows[0].revision >= 0, 'STORAGE_CORRUPT', '工作区修订头损坏，未重置。', 503);
    const row = rows[0];
    demand(row.latest === row.revision && row.snapshots === row.revision && row.commands === row.revision && row.committed === row.revision, 'STORAGE_CORRUPT', '工作区修订链或命令记录不一致，未回退到空状态。', 503);
    return rows[0].revision;
  }
  try {
    const exists = assertDatabase(db, true);
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    if (!exists) transaction(() => {
      db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION};
        CREATE TABLE web_workspace(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL CHECK(revision>=0));
        INSERT INTO web_workspace(singleton,revision) VALUES(1,0);
        CREATE TABLE web_snapshots(revision INTEGER PRIMARY KEY CHECK(revision>0),entity_counts TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE web_entities(workspace_revision INTEGER NOT NULL REFERENCES web_snapshots(revision),kind TEXT NOT NULL,object_id TEXT NOT NULL,ordinal INTEGER NOT NULL,payload TEXT NOT NULL,payload_sha256 TEXT NOT NULL,PRIMARY KEY(workspace_revision,kind,object_id));
        CREATE TABLE web_commands(command_id TEXT PRIMARY KEY,request_sha256 TEXT NOT NULL,committed_revision INTEGER NOT NULL REFERENCES web_snapshots(revision),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    });
    readSnapshot(currentRevision()); // A corrupt stored workspace must fail startup, not become empty.
  } catch (error) { db.close(); throw error; }
  function persist(host, fingerprint, commandId, revision) {
    demand(revision < Number.MAX_SAFE_INTEGER, 'REVISION_EXHAUSTED', '工作区修订已达上限。', 503);
    const next = revision + 1, rows = splitHost(host), counts = Object.fromEntries(KINDS.map(kind => [kind, rows.filter(row => row.kind === kind).length]));
    db.prepare('INSERT INTO web_snapshots(revision,entity_counts) VALUES(?,?)').run(next, stableJson(counts));
    const insert = db.prepare('INSERT INTO web_entities(workspace_revision,kind,object_id,ordinal,payload,payload_sha256) VALUES(?,?,?,?,?,?)');
    for (const row of rows) insert.run(next, row.kind, row.id, row.ordinal, row.payload, sha(row.payload));
    db.prepare('INSERT INTO web_commands(command_id,request_sha256,committed_revision) VALUES(?,?,?)').run(commandId, fingerprint, next);
    db.prepare('UPDATE web_workspace SET revision=? WHERE singleton=1').run(next);
    return { revision: next, host, storage };
  }
  function put(body) {
    demand(plain(body) && Number.isSafeInteger(body.expectedRevision) && body.expectedRevision >= 0 && identity(body.commandId) && body.commandId.length <= 200, 'INVALID_COMMAND', '需要有效的 expectedRevision、commandId 和 host。', 400);
    demand(Object.keys(body).every(key => ['expectedRevision', 'host', 'commandId'].includes(key)), 'INVALID_COMMAND', '请求包含未支持的字段。', 400);
    const host = normalizeHost(body.host), fingerprint = sha(stableJson({ expectedRevision: body.expectedRevision, host }));
    return transaction(() => {
      const revision = currentRevision();
      // Validate the authoritative current snapshot before accepting any replacement.
      readSnapshot(revision);
      const known = db.prepare('SELECT request_sha256,committed_revision FROM web_commands WHERE command_id=?').get(body.commandId);
      if (known) {
        if (known.request_sha256 !== fingerprint) throw new WebStoreError(409, 'COMMAND_CONFLICT', '相同 commandId 不能提交不同内容。', revision);
        return readSnapshot(known.committed_revision);
      }
      if (body.expectedRevision !== revision) throw new WebStoreError(409, 'REVISION_CONFLICT', '工作区已有更新，未覆盖；请重新读取并保留当前草稿。', revision);
      return persist(host, fingerprint, body.commandId, revision);
    });
  }
  function productResult(commandId, known, headRevision) {
    const after = known.committed_revision;
    return { ...readSnapshot(after), headRevision,
      receipt: { protocolVersion: 1, receiptId: `product:${commandId}`, commandId, status: 'committed',
        beforeRevision: after - 1, afterRevision: after, requestHash: known.request_sha256.slice('product-v1:'.length), hostDelivery: 'not_requested' } };
  }
  function executeProduct(body) {
    validateProductCommand(body);
    const fingerprint = `product-v1:${sha(stableJson(body))}`;
    return transaction(() => {
      const revision = currentRevision();
      const current = readSnapshot(revision);
      const known = db.prepare('SELECT request_sha256,committed_revision FROM web_commands WHERE command_id=?').get(body.commandId);
      if (known) {
        if (known.request_sha256 !== fingerprint) throw new WebStoreError(409, 'COMMAND_CONFLICT', '同一命令 ID 不能提交不同动作。', revision);
        return productResult(body.commandId, known, revision);
      }
      if (body.expectedRevision !== revision) throw new WebStoreError(409, 'REVISION_CONFLICT', '工作区已有更新；动作尚未执行，草稿应保留。', revision);
      // All domain guards and mutations run under the same SQLite write lock.
      // No caller-supplied host, receipt or final state is accepted.
      const next = applyProductOperations(current.host, body.operations);
      persist(normalizeHost(next), fingerprint, body.commandId, revision);
      return productResult(body.commandId, {request_sha256: fingerprint, committed_revision: revision + 1}, revision + 1);
    });
  }
  function agentAdoptionResult(candidate, known, headRevision) {
    const normalized = {...known, request_sha256:`product-v1:${known.request_sha256.slice('agent-adopt-v1:'.length)}`};
    const result = productResult(candidate.commandId, normalized, headRevision);
    result.receipt.agentRunId = candidate.runId; result.receipt.resultHash = candidate.resultHash;
    result.receipt.effect = 'understanding-draft-only';
    return result;
  }
  function applyAgentCandidate(candidate) {
    demand(plain(candidate) && identity(candidate.commandId) && identity(candidate.runId) && identity(candidate.matterId)
      && Number.isSafeInteger(candidate.expectedRevision) && candidate.expectedRevision >= 0
      && Number.isSafeInteger(candidate.baseRevision) && candidate.baseRevision >= 0
      && Number.isSafeInteger(candidate.contextEpoch) && candidate.contextEpoch >= 0
      && Number.isSafeInteger(candidate.understandingDraftVersion) && candidate.understandingDraftVersion >= 0
      && plain(candidate.selection) && candidate.selection.field === 'understandingDraft'
      && Number.isSafeInteger(candidate.selection.start) && Number.isSafeInteger(candidate.selection.end)
      && candidate.selection.end > candidate.selection.start && typeof candidate.selection.text === 'string'
      && typeof candidate.replacement === 'string' && candidate.replacement.length <= 16000
      && typeof candidate.resultHash === 'string' && /^[a-f0-9]{64}$/.test(candidate.resultHash),
    'INVALID_AGENT_CANDIDATE', 'Agent 修订候选缺少受信任的运行、版本、选区或结果身份。', 422);
    const fingerprint = `agent-adopt-v1:${sha(stableJson(candidate))}`;
    return transaction(() => {
      const revision = currentRevision(), current = readSnapshot(revision);
      const known = db.prepare('SELECT request_sha256,committed_revision FROM web_commands WHERE command_id=?').get(candidate.commandId);
      if (known) {
        if (known.request_sha256 !== fingerprint) throw new WebStoreError(409, 'COMMAND_CONFLICT', '同一采纳命令 ID 不能对应不同候选。', revision);
        return agentAdoptionResult(candidate, known, revision);
      }
      demand(candidate.expectedRevision === revision && candidate.baseRevision === revision, 'REVISION_CONFLICT', '工作区已经变化；旧 Agent 候选没有覆盖当前草稿。', 409);
      const matter = current.host?.chain.matters.find(item => item.id === candidate.matterId);
      const session = current.host?.chain.sessions[candidate.matterId];
      demand(matter && session && session.contextEpoch === candidate.contextEpoch, 'AGENT_TARGET_STALE', 'Agent 候选对应的事项或上下文已经变化。', 409);
      demand(matter.understandingDraftVersion === candidate.understandingDraftVersion
        && candidate.selection.end <= matter.understandingDraft.length
        && matter.understandingDraft.slice(candidate.selection.start, candidate.selection.end) === candidate.selection.text,
      'AGENT_TARGET_STALE', '理解草稿或准确选区已经变化；旧候选没有应用。', 409);
      const next = applyProductOperations(current.host, [
        {type:'chain.action',matterId:candidate.matterId,action:{type:'SUGGEST',start:candidate.selection.start,end:candidate.selection.end,replacement:candidate.replacement}},
        {type:'chain.action',matterId:candidate.matterId,action:{type:'ACCEPT_SUGGESTION'}},
      ]);
      next.chain.sessions[candidate.matterId].suggestion.origin = {type:'agent-run',runId:candidate.runId,resultHash:candidate.resultHash};
      persist(normalizeHost(next), fingerprint, candidate.commandId, revision);
      return agentAdoptionResult(candidate, {request_sha256:fingerprint, committed_revision:revision+1}, revision+1);
    });
  }
  function codexResult(kind, commandId, known, headRevision) {
    const snapshot = readSnapshot(known.committed_revision);
    const bridge = findCodexBridgeResponse(snapshot.host, commandId, kind);
    return {
      protocolVersion: 1,
      revision: snapshot.revision,
      headRevision,
      ...bridge,
      receipt: {
        ...bridge.receipt,
        beforeRevision: snapshot.revision - 1,
        afterRevision: snapshot.revision,
      },
    };
  }
  function executeCodex(kind, body) {
    if (kind === 'receive') validateCodexReceiveRequest(body); else validateCodexReturnRequest(body);
    const fingerprint = codexRequestFingerprint(kind, body);
    return transaction(() => {
      const revision = currentRevision();
      const current = readSnapshot(revision);
      const known = db.prepare('SELECT request_sha256,committed_revision FROM web_commands WHERE command_id=?').get(body.commandId);
      if (known) {
        if (known.request_sha256 !== fingerprint) throw new WebStoreError(409, 'COMMAND_CONFLICT', '同一 Codex 命令 ID 不能提交不同内容。', revision);
        return codexResult(kind, body.commandId, known, revision);
      }
      const outcome = kind === 'receive' ? receiveCodexContext(current.host, body) : returnCodexResult(current.host, body);
      // A second receive from the same Codex task is a domain-level recovery.
      // It returns the original delivery receipt and does not manufacture a new
      // workspace revision merely because the caller lost its first response.
      if (!outcome.changed) {
        const original = db.prepare('SELECT request_sha256,committed_revision FROM web_commands WHERE command_id=?').get(outcome.receipt.commandId);
        demand(original?.request_sha256.startsWith('codex-receive-v1:'), 'STORAGE_CORRUPT', 'Codex 原始接收命令缺失。', 503);
        return codexResult('receive', outcome.receipt.commandId, original, revision);
      }
      persist(normalizeHost(outcome.host), fingerprint, body.commandId, revision);
      return codexResult(kind, body.commandId, { request_sha256: fingerprint, committed_revision: revision + 1 }, revision + 1);
    });
  }
  async function handle(req, res) {
    const rawPath = String(req.url || '').split('?')[0];
    const product = rawPath === '/api/product' || rawPath.startsWith('/api/product/');
    if (!product && rawPath !== '/api/web' && !rawPath.startsWith('/api/web/')) return false;
    try {
      if (closed) throw new WebStoreError(503, 'STORE_CLOSED', '工作区存储已关闭。');
      checkOrigin(req, ['PUT', 'POST'].includes(req.method));
      if (product) {
        const commandMatch = /^\/api\/product\/commands\/([^/]+)$/.exec(rawPath);
        const codexKind = rawPath === '/api/product/codex/receive' ? 'receive' : rawPath === '/api/product/codex/return' ? 'return' : null;
        const methods = rawPath === '/api/product/workspace' || commandMatch ? ['GET'] : rawPath === '/api/product/commands' || codexKind ? ['POST'] : null;
        if (!methods) { reply(res, 404, {error:{code:'NOT_FOUND', message:'没有这个产品接口。'}}); return true; }
        if (!methods.includes(req.method)) { reply(res,405,{error:{code:'METHOD_NOT_ALLOWED',message:'不支持这个请求方法。'}},{allow:methods.join(', ')}); return true; }
        if (req.method === 'POST') {
          demand(/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(req.headers['content-type'] || ''), 'JSON_REQUIRED', '命令只接受 application/json。', 415);
          demand(!req.headers['content-encoding'] || req.headers['content-encoding'] === 'identity', 'ENCODING_NOT_SUPPORTED', '不接受压缩命令。', 415);
          const body = await readBody(req);
          reply(res, 200, codexKind ? executeCodex(codexKind, body) : executeProduct(body));
        } else if (commandMatch) {
          let commandId;
          try { commandId = decodeURIComponent(commandMatch[1]); } catch { throw new WebStoreError(400,'INVALID_COMMAND','命令 ID 编码无效。'); }
          demand(identity(commandId) && commandId.length <= 200, 'INVALID_COMMAND', '命令 ID 无效。', 400);
          const known = db.prepare('SELECT request_sha256,committed_revision FROM web_commands WHERE command_id=?').get(commandId);
          demand(known?.request_sha256.startsWith('product-v1:'), 'UNKNOWN_COMMAND', '没有该命令的已提交回执；不要推定已经保存。', 404);
          reply(res, 200, productResult(commandId, known, currentRevision()));
        } else reply(res,200,{...readSnapshot(currentRevision()), protocolVersion:1, writeMode:'product-commands'});
        return true;
      }
      const suppliedDesktopToken = req.headers['x-trace-desktop-token'];
      const desktopSnapshotWrite = rawPath === '/api/web/workspace' && req.method === 'PUT'
        && typeof suppliedDesktopToken === 'string' && desktopSnapshotToken !== undefined
        && Buffer.byteLength(suppliedDesktopToken) === Buffer.byteLength(desktopSnapshotToken)
        && crypto.timingSafeEqual(Buffer.from(suppliedDesktopToken), Buffer.from(desktopSnapshotToken));
      if (rawPath === '/api/web/reset' || rawPath === '/api/web/workspace' && req.method === 'PUT' && !allowSnapshotWrites && !desktopSnapshotWrite) {
        reply(res, 410, {error:{code:'LEGACY_WRITE_DISABLED',message:'整份工作区写入与旧重置已停用，请使用明确的产品命令。'}}); return true;
      }
      if (!['/api/web/workspace', '/api/web/export', '/api/web/reset'].includes(rawPath)) { reply(res, 404, { error: { code: 'NOT_FOUND', message: '没有这个工作区接口。' } }); return true; }
      const allowed = rawPath === '/api/web/workspace' ? ['GET', 'PUT'] : rawPath === '/api/web/reset' ? ['POST'] : ['GET'];
      if (!allowed.includes(req.method)) { reply(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '不支持这个请求方法。' } }, { allow: allowed.join(', ') }); return true; }
      if (req.method === 'GET') {
        const result = readSnapshot(currentRevision());
        reply(res, 200, result, rawPath === '/api/web/export' ? { 'content-disposition': 'attachment; filename="trace-web-workspace.json"' } : {});
      } else {
        demand(/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(req.headers['content-type'] || ''), 'JSON_REQUIRED', '工作区写入只接受 application/json。', 415);
        demand(!req.headers['content-encoding'] || req.headers['content-encoding'] === 'identity', 'ENCODING_NOT_SUPPORTED', '不接受压缩的工作区请求。', 415);
        if (req.headers['content-length'] !== undefined) {
          const length = Number(req.headers['content-length']);
          demand(Number.isSafeInteger(length) && length >= 0, 'INVALID_LENGTH', '无效的请求长度。', 400);
          demand(length <= MAX_BODY_BYTES, 'BODY_TOO_LARGE', '工作区请求超过 8 MiB 限制。', 413);
        }
        reply(res, 200, put(await readBody(req)));
      }
    } catch (cause) {
      const error = databaseError(cause);
      req.resume();
      if (!res.headersSent) reply(res, error.status, { error: { code: error.code, message: error.message }, ...(error.revision === undefined ? {} : { revision: error.revision }), storage });
      else if (!res.writableEnded) res.end();
    }
    return true;
  }
  return { file, handle,
    // Read-only application seam for the Agent backend. No whole-host write API.
    read() { demand(!closed, 'STORE_CLOSED', '工作区存储已关闭。', 503); return readSnapshot(currentRevision()); },
    execute(command) { demand(!closed, 'STORE_CLOSED', '工作区存储已关闭。', 503); return executeProduct(command); },
    adoptAgentCandidate(candidate) { demand(!closed, 'STORE_CLOSED', '工作区存储已关闭。', 503); return applyAgentCandidate(candidate); },
    close() { if (closed) return; closed = true; db.close(); } };
}
