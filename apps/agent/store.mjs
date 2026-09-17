import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { AgentError, demand, hash, TERMINAL } from './protocol.mjs';
import {
  DATABASE_IDENTITY_SCHEMA_VERSION,
  DATABASE_IDENTITY_TABLE,
  DATABASE_ROLES,
  RUNTIME_IDENTITY_PROTOCOL_VERSION,
  TRACE_AGENT_SERVICE_ID,
  TRACE_PRODUCT_ID,
  databaseIdentityTemplate,
  deriveDatabaseIdentity,
  isSemver,
  isSafeIdentity,
  validateDatabaseIdentity,
} from '../../runtime-identity.mjs';

const APP_ID = 0x54524131; // TRA1; never a web.sqlite or cognitive ledger.
const BASE_TABLES = ['agent_events', 'agent_meta', 'agent_runs'];
const SENSEMAKING_TABLES = ['sensemaking_events', 'sensemaking_runs'];
const AGENT_TABLES = [...BASE_TABLES, ...SENSEMAKING_TABLES, DATABASE_IDENTITY_TABLE];
const IDENTITY_COLUMNS = ['id', 'schema_version', 'product_id', 'service_id', 'role', 'protocol_version', 'runtime_version', 'installation_id', 'workspace_id', 'verification_state', 'created_at'];
export function createAgentStore({ file, workspaceKey, workspaceIdentity, legacyWorkspaceKey, runtimeVersion = '0.7.1', maxRuns = 1000, allowLegacyIdentity = false, upgradeLegacyIdentity = false } = {}) {
  demand(typeof file === 'string' && path.isAbsolute(file), 'INVALID_AGENT_DB', 'Agent 记录必须使用独立绝对路径，不能依赖数据库文件名。', 500);
  demand(workspaceIdentity === undefined || workspaceIdentity && typeof workspaceIdentity === 'object' && !Array.isArray(workspaceIdentity), 'INVALID_WORKSPACE', '工作区绑定身份无效。', 500);
  demand(workspaceIdentity === undefined || workspaceIdentity.verification_state === 'verified'
    && isSafeIdentity(workspaceIdentity.workspace_id) && isSafeIdentity(workspaceIdentity.installation_id),
  'INVALID_WORKSPACE', 'Agent 需要已验证的 Product workspace identity。', 500);
  const expectedWorkspace = workspaceIdentity?.workspace_id ?? workspaceKey;
  const derivedIdentity = deriveDatabaseIdentity(path.resolve(file));
  const expectedInstallation = workspaceIdentity?.installation_id ?? derivedIdentity.installation_id;
  demand(typeof expectedWorkspace === 'string' && isSafeIdentity(expectedWorkspace), 'INVALID_WORKSPACE', '缺少工作区绑定。', 500);
  demand(typeof expectedInstallation === 'string' && isSafeIdentity(expectedInstallation), 'INVALID_INSTALLATION', '缺少安装绑定。', 500);
  workspaceKey = expectedWorkspace;
  demand(typeof runtimeVersion === 'string' && runtimeVersion.length > 0 && runtimeVersion.length <= 128 && isSemver(runtimeVersion), 'INVALID_RUNTIME_VERSION', 'Agent runtimeVersion 配置无效。', 500);
  demand(typeof allowLegacyIdentity === 'boolean' && typeof upgradeLegacyIdentity === 'boolean', 'INVALID_IDENTITY_POLICY', 'Agent 数据库身份兼容策略无效。', 500);
  file = path.resolve(file); fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.owner`, owner = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  try { fs.writeFileSync(lock, owner, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    demand(error.code === 'EEXIST', 'AGENT_STORE_UNAVAILABLE', '无法取得 Agent 记录锁。', 503);
    let saved, dead = false;
    try { saved = fs.readFileSync(lock, 'utf8'); const pid = JSON.parse(saved).pid;
      if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); } catch (e) { dead = e.code === 'ESRCH'; } }
    } catch { /* Unknown owner is never assumed dead. */ }
    demand(dead && fs.readFileSync(lock, 'utf8') === saved, 'AGENT_STORE_IN_USE', 'Agent 记录已由另一服务占用；不能启动第二个执行者。', 503);
    fs.unlinkSync(lock);
    try { fs.writeFileSync(lock, owner, { flag: 'wx', mode: 0o600 }); }
    catch { throw new AgentError('AGENT_STORE_IN_USE', '另一服务已取得 Agent 记录锁。', 503); }
  }
  let db, closed = false;
  const release = () => { try { if (fs.readFileSync(lock, 'utf8') === owner) fs.unlinkSync(lock); } catch {} };
  function verify(database, allowEmpty = false) {
    const appId = database.prepare('PRAGMA application_id').get().application_id;
    const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name).sort();
    if (allowEmpty && appId === 0 && tables.length === 0) return false;
    const supportedShapes = [
      BASE_TABLES,
      [...BASE_TABLES, DATABASE_IDENTITY_TABLE],
      [...BASE_TABLES, ...SENSEMAKING_TABLES],
      AGENT_TABLES,
    ].map(shape => JSON.stringify([...shape].sort()));
    const supported = supportedShapes.includes(JSON.stringify(tables));
    demand(appId === APP_ID && database.prepare('PRAGMA user_version').get().user_version === 1
      && supported, 'WRONG_AGENT_DB', '不是受支持的 Trace Agent 数据库，未修改。', 503);
    demand(database.prepare('PRAGMA quick_check').get().quick_check === 'ok', 'AGENT_STORE_CORRUPT', 'Agent 数据库完整性检查失败。', 503);
    if (tables.includes(DATABASE_IDENTITY_TABLE)) {
      const columns = database.prepare(`PRAGMA table_info(${DATABASE_IDENTITY_TABLE})`).all().map(row => row.name);
      demand(IDENTITY_COLUMNS.every(column => columns.includes(column)) && columns.every(column => IDENTITY_COLUMNS.includes(column)),
        'AGENT_IDENTITY_INVALID', 'Agent 数据库身份元数据缺失或不一致。', 503);
      const identity = database.prepare(`SELECT ${IDENTITY_COLUMNS.join(',')} FROM ${DATABASE_IDENTITY_TABLE} WHERE id=1`).get();
      demand(identity, 'AGENT_IDENTITY_INVALID', 'Agent 数据库身份元数据缺失。', 503);
      try { validateDatabaseIdentity(identity, {role: DATABASE_ROLES.agent, serviceId: TRACE_AGENT_SERVICE_ID}); }
      catch { demand(false, 'WRONG_AGENT_DB', '不是受支持的 Trace Agent 数据库，未修改。', 503); }
    }
    return true;
  }
  function assertAgentIdentityBinding(database) {
    const present = database.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name=?").get(DATABASE_IDENTITY_TABLE);
    if (!present) return;
    const row = database.prepare(`SELECT ${IDENTITY_COLUMNS.join(',')} FROM ${DATABASE_IDENTITY_TABLE} WHERE id=1`).get();
    demand(row, 'AGENT_IDENTITY_INVALID', 'Agent 数据库身份元数据缺失。', 503);
    if (row.verification_state === 'verified') {
      demand(row.workspace_id === expectedWorkspace, 'AGENT_WORKSPACE_MISMATCH', 'Agent 记录绑定了不同工作区。', 503);
      demand(row.installation_id === expectedInstallation, 'AGENT_INSTALLATION_MISMATCH', 'Agent 记录绑定了不同安装。', 503);
    }
  }
  function transaction(fn) {
    demand(!closed, 'AGENT_CLOSED', 'Agent 记录已关闭。', 503);
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  function decode(row) {
    if (!row) return null;
    let value;
    try { value = JSON.parse(row.payload); } catch { throw new AgentError('AGENT_STORE_CORRUPT', 'Agent 记录无法解析。', 503); }
    demand(hash(value) === row.payload_hash, 'AGENT_STORE_CORRUPT', 'Agent 记录校验失败。', 503); return value;
  }
  function get(id) { return decode(db.prepare('SELECT payload,payload_hash FROM agent_runs WHERE id=?').get(id)); }
  function write(run) { db.prepare('UPDATE agent_runs SET payload=?,payload_hash=? WHERE id=?').run(JSON.stringify(run), hash(run), run.id); }
  function event(run, type, data) {
    const sequence = ++run.lastEventId;
    const value = { protocolVersion: 1, runId: run.id, sequence, type, at: new Date().toISOString(),
      matterId: run.request.matterId, contextEpoch: run.request.contextEpoch, contextHash: run.context.contextHash,
      profile: run.profile ? { profileId: run.profile.profileId, kind: run.profile.kind, ownerId: run.profile.ownerId,
        version: run.profile.version, revision: run.profile.revision } : null, data };
    db.prepare('INSERT INTO agent_events(run_id,sequence,payload,payload_hash) VALUES(?,?,?,?)').run(run.id, sequence, JSON.stringify(value), hash(value));
    write(run); return value;
  }
  function decodeSense(row) {
    if (!row) return null;
    let value;
    try { value = JSON.parse(row.payload); } catch { throw new AgentError('AGENT_STORE_CORRUPT', 'Sensemaking 运行记录无法解析。', 503); }
    demand(hash(value) === row.payload_hash, 'AGENT_STORE_CORRUPT', 'Sensemaking 运行记录校验失败。', 503);
    return value;
  }
  function getSense(id) { return decodeSense(db.prepare('SELECT payload,payload_hash FROM sensemaking_runs WHERE id=?').get(id)); }
  function writeSense(run) { db.prepare('UPDATE sensemaking_runs SET payload=?,payload_hash=? WHERE id=?').run(JSON.stringify(run), hash(run), run.id); }
  function senseEvent(run, type, data) {
    const sequence = ++run.lastEventId;
    const value = {protocolVersion: 1, runId: run.id, sequence, type, at: new Date().toISOString(),
      jobId: run.jobId, host: run.host, sessionId: run.sessionId, turnId: run.turnId,
      profile: run.profile, inputHash: run.inputHash, resultHash: run.resultHash ?? null, data};
    db.prepare('INSERT INTO sensemaking_events(run_id,sequence,payload,payload_hash) VALUES(?,?,?,?)').run(run.id, sequence, JSON.stringify(value), hash(value));
    writeSense(run); return value;
  }
  function ensureSensemakingTables() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sensemaking_runs(
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        payload_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sensemaking_events(
        run_id TEXT NOT NULL REFERENCES sensemaking_runs(id),
        sequence INTEGER NOT NULL,
        payload TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        PRIMARY KEY(run_id,sequence)
      );
    `);
  }
  function createIdentityTable() {
    db.exec(`CREATE TABLE ${DATABASE_IDENTITY_TABLE}(
      id INTEGER PRIMARY KEY CHECK(id=1),
      schema_version INTEGER NOT NULL,
      product_id TEXT NOT NULL,
      service_id TEXT NOT NULL,
      role TEXT NOT NULL,
      protocol_version INTEGER NOT NULL,
      runtime_version TEXT NOT NULL,
      installation_id TEXT,
      workspace_id TEXT,
      verification_state TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
  }
  function identityForAgent(state = 'verified') {
    return databaseIdentityTemplate({role: DATABASE_ROLES.agent, serviceId: TRACE_AGENT_SERVICE_ID, runtimeVersion,
      workspaceId: expectedWorkspace, installationId: expectedInstallation, verificationState: state});
  }
  function insertIdentity(value) {
    db.prepare(`INSERT INTO ${DATABASE_IDENTITY_TABLE}(${IDENTITY_COLUMNS.join(',')}) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      1, value.schema_version, TRACE_PRODUCT_ID, value.service_id, value.role, value.protocol_version, value.runtime_version,
      value.installation_id, value.workspace_id, value.verification_state, value.created_at,
    );
  }
  function updateIdentity(value) {
    db.prepare(`UPDATE ${DATABASE_IDENTITY_TABLE} SET schema_version=?,product_id=?,service_id=?,role=?,protocol_version=?,runtime_version=?,installation_id=?,workspace_id=?,verification_state=?,created_at=? WHERE id=1`).run(
      value.schema_version, TRACE_PRODUCT_ID, value.service_id, value.role, value.protocol_version, value.runtime_version,
      value.installation_id, value.workspace_id, value.verification_state, value.created_at,
    );
  }
  function readIdentity() {
    const exists = db.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name=?").get(DATABASE_IDENTITY_TABLE);
    if (!exists) return null;
    const row = db.prepare(`SELECT ${IDENTITY_COLUMNS.join(',')} FROM ${DATABASE_IDENTITY_TABLE} WHERE id=1`).get();
    demand(row, 'AGENT_IDENTITY_INVALID', 'Agent 数据库身份元数据缺失。', 503);
    try { validateDatabaseIdentity(row, {role: DATABASE_ROLES.agent, serviceId: TRACE_AGENT_SERVICE_ID}); }
    catch { demand(false, 'WRONG_AGENT_DB', '不是受支持的 Trace Agent 数据库，未修改。', 503); }
    return row;
  }
  let databaseIdentity;
  let writableIdentity;
  try {
    if (fs.existsSync(file)) {
      const probe = new DatabaseSync(file, { readOnly: true });
      try {
        const recognized = verify(probe, true);
        if (recognized) {
          const legacyKey = probe.prepare('SELECT workspace_key FROM agent_meta WHERE id=1').get()?.workspace_key;
          demand(legacyKey === workspaceKey || legacyKey === legacyWorkspaceKey, 'AGENT_WORKSPACE_MISMATCH', 'Agent 记录绑定了不同工作区。', 503);
          assertAgentIdentityBinding(probe);
        }
      } finally { probe.close(); }
    }
    db = new DatabaseSync(file); const exists = verify(db, true);
    if (exists) {
      const legacyKey = db.prepare('SELECT workspace_key FROM agent_meta WHERE id=1').get()?.workspace_key;
      demand(legacyKey === workspaceKey || legacyKey === legacyWorkspaceKey, 'AGENT_WORKSPACE_MISMATCH', 'Agent 记录绑定了不同工作区。', 503);
      assertAgentIdentityBinding(db);
    }
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    if (!exists) transaction(() => {
      db.exec(`PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;
        CREATE TABLE agent_meta(id INTEGER PRIMARY KEY CHECK(id=1),workspace_key TEXT NOT NULL);
        CREATE TABLE agent_runs(id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL);
        CREATE TABLE agent_events(run_id TEXT NOT NULL REFERENCES agent_runs(id),sequence INTEGER NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,PRIMARY KEY(run_id,sequence));`);
      ensureSensemakingTables();
      createIdentityTable();
      db.prepare('INSERT INTO agent_meta(id,workspace_key) VALUES(1,?)').run(workspaceKey);
      insertIdentity(identityForAgent('verified'));
    });
    if (exists) transaction(() => {
      ensureSensemakingTables();
      const current = readIdentity();
      if (current === null) {
        // Existing Agent v1 ledgers are retained as explicitly legacy until
        // the owning Product service supplies a verified workspace identity.
        createIdentityTable(); databaseIdentity = identityForAgent(upgradeLegacyIdentity ? 'verified' : 'legacy'); insertIdentity(databaseIdentity);
      } else if (current.verification_state !== 'verified' && upgradeLegacyIdentity) {
        databaseIdentity = identityForAgent('verified'); updateIdentity(databaseIdentity);
      } else databaseIdentity = current;
      if (databaseIdentity.verification_state === 'verified') {
        demand(databaseIdentity.workspace_id === expectedWorkspace, 'AGENT_WORKSPACE_MISMATCH', 'Agent 记录绑定了不同工作区。', 503);
        demand(databaseIdentity.installation_id === expectedInstallation, 'AGENT_INSTALLATION_MISMATCH', 'Agent 记录绑定了不同安装。', 503);
      }
      if (databaseIdentity.runtime_version !== runtimeVersion) {
        db.prepare(`UPDATE ${DATABASE_IDENTITY_TABLE} SET runtime_version=? WHERE id=1`).run(runtimeVersion);
        databaseIdentity = {...databaseIdentity, runtime_version: runtimeVersion};
      }
    });
    if (!exists) databaseIdentity = readIdentity();
    writableIdentity = () => demand(databaseIdentity?.verification_state === 'verified' || allowLegacyIdentity,
      'LEGACY_IDENTITY_UNVERIFIED', '旧 Agent 数据库仅允许读取；请先升级 Product/Agent identity。', 503);
    // A restart recovery is a state mutation. Do not mutate an unverified
    // legacy ledger merely because it was opened for inspection.
    if (databaseIdentity?.verification_state === 'verified' || allowLegacyIdentity) transaction(() => {
      for (const row of db.prepare('SELECT payload,payload_hash FROM agent_runs').all()) {
        const run = decode(row);
        if (!TERMINAL.has(run.status)) {
          writableIdentity();
          run.status = 'interrupted'; run.finishedAt = new Date().toISOString(); run.error = { code: 'PROCESS_RESTARTED', message: '服务重启；未自动重复执行可能已计费的模型请求。' };
          event(run, 'run.interrupted', { status: run.status, error: run.error });
        }
      }
    });
  } catch (error) { db?.close(); release(); throw error; }
  function upgradeIdentity(input = {}) {
    demand(!closed, 'AGENT_CLOSED', 'Agent 记录已关闭。', 503);
    demand(databaseIdentity.verification_state !== 'verified', 'IDENTITY_ALREADY_VERIFIED', 'Agent 数据库身份已经验证，无需升级。', 409);
    demand(isSafeIdentity(input.workspaceId) && isSafeIdentity(input.installationId), 'LEGACY_IDENTITY_UPGRADE_REQUIRED', '升级旧 Agent 数据库需要明确的 workspaceId 和 installationId。', 409);
    demand(input.workspaceId === expectedWorkspace && input.installationId === expectedInstallation, 'AGENT_IDENTITY_MISMATCH', 'Agent identity 必须与当前 Product workspace identity 一致。', 409);
    const upgraded = databaseIdentityTemplate({role: DATABASE_ROLES.agent, serviceId: TRACE_AGENT_SERVICE_ID, runtimeVersion,
      workspaceId: input.workspaceId, installationId: input.installationId, verificationState: 'verified', createdAt: databaseIdentity.created_at});
    transaction(() => { updateIdentity(upgraded); });
    databaseIdentity = upgraded;
    return structuredClone(databaseIdentity);
  }
  return {
    file,
    get identity() { return databaseIdentity ? structuredClone(databaseIdentity) : null; },
    getIdentity() { return databaseIdentity ? structuredClone(databaseIdentity) : null; },
    upgradeIdentity,
    get,
    find(requestId) { return decode(db.prepare('SELECT payload,payload_hash FROM agent_runs WHERE request_id=?').get(requestId)); },
    count() { return db.prepare('SELECT COUNT(*) AS n FROM agent_runs').get().n; },
    create(request, context, profile = { profileId: request.profileId ?? 'legacy', kind: 'codex', ownerId: 'local-user', version: 1, revision: 'legacy' }) {
      writableIdentity();
      return transaction(() => {
        demand(db.prepare('SELECT COUNT(*) AS n FROM agent_runs').get().n < maxRuns, 'RUN_STORAGE_LIMIT', 'Agent 记录达到本机保留上限；请归档后再执行。', 507);
        const run = { id: randomUUID(), request, requestHash: hash(request), context, profile, status: 'queued', createdAt: new Date().toISOString(),
          startedAt: null, finishedAt: null, lastEventId: 0, result: null, error: null, runtime: null };
        db.prepare('INSERT INTO agent_runs(id,request_id,request_hash,payload,payload_hash) VALUES(?,?,?,?,?)').run(run.id, request.requestId, run.requestHash, JSON.stringify(run), hash(run));
        event(run, 'run.queued', { status: run.status }); return run;
      });
    },
    update(id, patch, type, data) {
      writableIdentity();
      return transaction(() => {
        const run = get(id); demand(run, 'RUN_NOT_FOUND', '没有这个运行记录。', 404);
        if (TERMINAL.has(run.status)) return { run, event: null };
        demand(run.lastEventId < 4096 || type.startsWith('run.'), 'EVENT_LIMIT', '事件流达到本次预算。', 502);
        Object.assign(run, patch); return { run, event: event(run, type, data) };
      });
    },
    setAdoption(id, status, receipt = null) {
      writableIdentity();
      return transaction(() => {
        const run = get(id); demand(run && run.status === 'succeeded' && run.result, 'RUN_NOT_ADOPTABLE', '只有已完成的 Agent 结果可以处理。', 409);
        demand(['applied', 'dismissed', 'undone'].includes(status), 'INVALID_ADOPTION', '不支持这个候选处理状态。', 422);
        const before = run.result.adoption;
        if (before === status) return {run, event:null};
        demand((before === 'not_applied' && ['applied','dismissed'].includes(status)) || before === 'applied' && status === 'undone',
          'ADOPTION_CONFLICT', '这个候选已经以另一种方式处理。', 409);
        run.result.adoption = status; run.adoptionReceipt = receipt; run.adoptedAt = new Date().toISOString();
        return {run, event:event(run, 'run.adoption.changed', {before, status, receipt})};
      });
    },
    events(id, after = 0, limit = 512) {
      return db.prepare('SELECT payload,payload_hash FROM agent_events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(id, after, limit).map(decode);
    },
    findSensemaking(jobId) {
      demand(typeof jobId === 'string' && jobId.length > 0, 'INVALID_SENSEMAKING_JOB', 'job_id 无效。', 400);
      return decodeSense(db.prepare('SELECT payload,payload_hash FROM sensemaking_runs WHERE job_id=?').get(jobId));
    },
    createSensemaking(job) {
      writableIdentity();
      demand(job && typeof job.jobId === 'string' && job.jobId.length > 0 && typeof job.host === 'string'
        && typeof job.sessionId === 'string' && typeof job.turnId === 'string' && typeof job.inputHash === 'string',
      'INVALID_SENSEMAKING_JOB', 'Sensemaking run 身份或输入哈希无效。', 400);
      return transaction(() => {
        const existing = decodeSense(db.prepare('SELECT payload,payload_hash FROM sensemaking_runs WHERE job_id=?').get(job.jobId));
        if (existing) return existing;
        const run = {id: randomUUID(), jobId: job.jobId, host: job.host, sessionId: job.sessionId, turnId: job.turnId,
          inputHash: job.inputHash, profile: {profileId: job.profileId ?? 'fixture-sensemaking', profileVersion: job.profileVersion ?? '1', modelVersion: job.modelVersion ?? 'fixture-1'},
          status: 'running', attempt: job.attempt ?? 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          resultHash: null, result: null, error: null, lastEventId: 0};
        db.prepare('INSERT INTO sensemaking_runs(id,job_id,payload,payload_hash) VALUES(?,?,?,?)').run(run.id, run.jobId, JSON.stringify(run), hash(run));
        senseEvent(run, 'sensemaking.started', {status: run.status, attempt: run.attempt});
        return run;
      });
    },
    updateSensemaking(id, patch, type = 'sensemaking.updated', data = {}) {
      writableIdentity();
      return transaction(() => {
        const run = getSense(id); demand(run, 'SENSEMAKING_RUN_NOT_FOUND', '没有这个 Sensemaking run。', 404);
        Object.assign(run, patch, {updatedAt: new Date().toISOString()});
        return {run, event: senseEvent(run, type, data)};
      });
    },
    sensemakingEvents(id, after = 0, limit = 512) {
      return db.prepare('SELECT payload,payload_hash FROM sensemaking_events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(id, after, limit).map(decodeSense);
    },
    close() { if (closed) return; closed = true; db.close(); release(); },
  };
}
