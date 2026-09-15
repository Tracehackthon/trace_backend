import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { AgentError, demand, hash, TERMINAL } from './protocol.mjs';

const APP_ID = 0x54524131; // TRA1; never a web.sqlite or cognitive ledger.
export function createAgentStore({ file, workspaceKey, maxRuns = 1000 } = {}) {
  demand(typeof file === 'string' && path.isAbsolute(file) && !['web.sqlite', 'trace.sqlite'].includes(path.basename(file).toLowerCase()),
    'INVALID_AGENT_DB', 'Agent 记录必须使用独立绝对路径，不能使用 web.sqlite 或 trace.sqlite。', 500);
  demand(typeof workspaceKey === 'string' && workspaceKey.length > 0, 'INVALID_WORKSPACE', '缺少工作区绑定。', 500);
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
    demand(appId === APP_ID && database.prepare('PRAGMA user_version').get().user_version === 1
      && JSON.stringify(tables) === JSON.stringify(['agent_events', 'agent_meta', 'agent_runs']), 'WRONG_AGENT_DB', '不是受支持的 Trace Agent 数据库，未修改。', 503);
    demand(database.prepare('PRAGMA quick_check').get().quick_check === 'ok', 'AGENT_STORE_CORRUPT', 'Agent 数据库完整性检查失败。', 503);
    return true;
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
  try {
    if (fs.existsSync(file)) { const probe = new DatabaseSync(file, { readOnly: true }); try { verify(probe, true); } finally { probe.close(); } }
    db = new DatabaseSync(file); const exists = verify(db, true);
    if (exists) demand(db.prepare('SELECT workspace_key FROM agent_meta WHERE id=1').get()?.workspace_key === workspaceKey, 'AGENT_WORKSPACE_MISMATCH', 'Agent 记录绑定了不同工作区。', 503);
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    if (!exists) transaction(() => {
      db.exec(`PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;
        CREATE TABLE agent_meta(id INTEGER PRIMARY KEY CHECK(id=1),workspace_key TEXT NOT NULL);
        CREATE TABLE agent_runs(id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL);
        CREATE TABLE agent_events(run_id TEXT NOT NULL REFERENCES agent_runs(id),sequence INTEGER NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,PRIMARY KEY(run_id,sequence));`);
      db.prepare('INSERT INTO agent_meta(id,workspace_key) VALUES(1,?)').run(workspaceKey);
    });
    transaction(() => {
      for (const row of db.prepare('SELECT payload,payload_hash FROM agent_runs').all()) {
        const run = decode(row);
        if (!TERMINAL.has(run.status)) {
          run.status = 'interrupted'; run.finishedAt = new Date().toISOString(); run.error = { code: 'PROCESS_RESTARTED', message: '服务重启；未自动重复执行可能已计费的模型请求。' };
          event(run, 'run.interrupted', { status: run.status, error: run.error });
        }
      }
    });
  } catch (error) { db?.close(); release(); throw error; }
  return {
    file, get,
    find(requestId) { return decode(db.prepare('SELECT payload,payload_hash FROM agent_runs WHERE request_id=?').get(requestId)); },
    count() { return db.prepare('SELECT COUNT(*) AS n FROM agent_runs').get().n; },
    create(request, context, profile = { profileId: request.profileId ?? 'legacy', kind: 'codex', ownerId: 'local-user', version: 1, revision: 'legacy' }) {
      return transaction(() => {
        demand(db.prepare('SELECT COUNT(*) AS n FROM agent_runs').get().n < maxRuns, 'RUN_STORAGE_LIMIT', 'Agent 记录达到本机保留上限；请归档后再执行。', 507);
        const run = { id: randomUUID(), request, requestHash: hash(request), context, profile, status: 'queued', createdAt: new Date().toISOString(),
          startedAt: null, finishedAt: null, lastEventId: 0, result: null, error: null, runtime: null };
        db.prepare('INSERT INTO agent_runs(id,request_id,request_hash,payload,payload_hash) VALUES(?,?,?,?,?)').run(run.id, request.requestId, run.requestHash, JSON.stringify(run), hash(run));
        event(run, 'run.queued', { status: run.status }); return run;
      });
    },
    update(id, patch, type, data) {
      return transaction(() => {
        const run = get(id); demand(run, 'RUN_NOT_FOUND', '没有这个运行记录。', 404);
        if (TERMINAL.has(run.status)) return { run, event: null };
        demand(run.lastEventId < 4096 || type.startsWith('run.'), 'EVENT_LIMIT', '事件流达到本次预算。', 502);
        Object.assign(run, patch); return { run, event: event(run, type, data) };
      });
    },
    events(id, after = 0, limit = 512) {
      return db.prepare('SELECT payload,payload_hash FROM agent_events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(id, after, limit).map(decode);
    },
    close() { if (closed) return; closed = true; db.close(); release(); },
  };
}
