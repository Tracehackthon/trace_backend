import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { acquireStateOwner } from '../apps/desktop/state-owner.mjs';

const names = ['web', 'agent'];
const ids = { web: 0x54525731, agent: 0x54524131 };
const tables = { web: ['web_workspace', 'web_snapshots', 'web_entities', 'web_commands'], agent: ['agent_meta', 'agent_runs', 'agent_events'] };
function digest(file) {
  const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = fs.openSync(file, 'r');
  try {
    for (;;) {
      const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
    }
    return hash.digest('hex');
  } finally { fs.closeSync(descriptor); }
}
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const absolute = (value, label) => {
  ensure(typeof value === 'string' && path.isAbsolute(value), `${label} 必须是绝对路径`);
  return path.resolve(value);
};
function paths(web, agent) {
  const result = { web: absolute(web, '--web'), agent: absolute(agent, '--agent') };
  ensure(result.web.toLowerCase() !== result.agent.toLowerCase(), 'Web 与 Agent 必须是不同数据库');
  return result;
}
function inspect(file, kind) {
  ensure(fs.existsSync(file) && fs.statSync(file).isFile(), `${kind} 数据库缺失：${file}`);
  ensure(!fs.lstatSync(file).isSymbolicLink(), `${kind} 数据库不能是符号链接`);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    ensure(db.prepare('PRAGMA quick_check').get()?.quick_check === 'ok', `${kind} 数据库完整性检查失败`);
    ensure(db.prepare('PRAGMA application_id').get()?.application_id === ids[kind]
      && db.prepare('PRAGMA user_version').get()?.user_version === 1, `${kind} 数据库身份不符`);
    const found = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name));
    ensure(tables[kind].every(name => found.has(name)), `${kind} 数据表缺失`);
    return db;
  } catch (error) { db.close(); throw error; }
}
function withOwners(files, action) {
  const releases = [];
  try {
    // Deterministic order avoids two maintenance processes deadlocking.
    for (const file of Object.values(files).sort()) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      releases.push(acquireStateOwner(file));
    }
    return action();
  } finally { for (const release of releases.reverse()) release(); }
}
function snapshot(source, destination, kind) {
  const db = inspect(source, kind);
  try { db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`); }
  finally { db.close(); }
  const check = inspect(destination, kind); check.close();
  return { file: `${kind}.sqlite`, bytes: fs.statSync(destination).size, sha256: digest(destination) };
}
function checkedBundle(bundle) {
  bundle = absolute(bundle, '--bundle');
  ensure(fs.lstatSync(bundle).isDirectory() && !fs.lstatSync(bundle).isSymbolicLink(), '备份目录不能是符号链接');
  const manifestFile = path.join(bundle, 'manifest.json');
  ensure(!fs.lstatSync(manifestFile).isSymbolicLink(), '备份清单不能是符号链接');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  ensure(manifest.format === 'trace-product-pair-v1' && manifest.databases && typeof manifest.databases === 'object', '备份清单格式不符');
  for (const kind of names) {
    const entry = manifest.databases[kind];
    ensure(entry && entry.source === absolute(entry.source, `${kind}.source`) && typeof entry.present === 'boolean', `${kind} 来源路径无效`);
    if (!entry.present) { ensure(kind === 'agent' && entry.snapshot === null, '只允许 Agent 库缺席'); continue; }
    ensure(entry.snapshot?.file === `${kind}.sqlite` && Number.isSafeInteger(entry.snapshot.bytes)
      && /^[a-f0-9]{64}$/.test(entry.snapshot.sha256), `${kind} 摘要清单无效`);
    const file = path.join(bundle, entry.snapshot.file);
    ensure(!fs.lstatSync(file).isSymbolicLink(), `${kind} 快照不能是符号链接`);
    ensure(fs.statSync(file).size === entry.snapshot.bytes && digest(file) === entry.snapshot.sha256, `${kind} 快照缺失或摘要不符`);
    const db = inspect(file, kind); db.close();
  }
  ensure(manifest.databases.web.source.toLowerCase() !== manifest.databases.agent.source.toLowerCase(), '备份来源路径冲突');
  return { bundle, manifest };
}
export function backup({ web, agent, out }) {
  const files = paths(web, agent); out = absolute(out, '--out');
  ensure(!fs.existsSync(out), '输出目录已存在，不覆盖旧备份');
  const parent = path.dirname(out); fs.mkdirSync(parent, { recursive: true });
  const staging = path.join(parent, `${path.basename(out)}.partial-${randomUUID()}`);
  return withOwners(files, () => {
    ensure(fs.existsSync(files.web), 'Web 数据库不存在，不会新建空库');
    fs.mkdirSync(staging);
    try {
      const manifest = { format: 'trace-product-pair-v1', createdAt: new Date().toISOString(), offlineRequired: true, databases: {} };
      for (const kind of names) {
        const source = files[kind], present = fs.existsSync(source);
        manifest.databases[kind] = { source, present, snapshot: present ? snapshot(source, path.join(staging, `${kind}.sqlite`), kind) : null };
      }
      fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
      checkedBundle(staging);
      ensure(!fs.existsSync(out), '输出目录已出现，不覆盖');
      fs.renameSync(staging, out);
      return { bundle: out, manifest };
    } catch (error) {
      // This path was created by this invocation in the requested output parent.
      fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  });
}
export function verify({ bundle }) { return checkedBundle(bundle); }

export function restore({ bundle, web, agent }) {
  const files = paths(web, agent);
  const checked = checkedBundle(bundle);
  for (const kind of names) ensure(checked.manifest.databases[kind].source === files[kind], `${kind} 只允许恢复到备份来源原路径`);
  return withOwners(files, () => {
    for (const kind of names) if (fs.existsSync(files[kind])) ensure(!fs.lstatSync(files[kind]).isSymbolicLink(), `${kind} 恢复目标不能是符号链接`);
    // Verify again under ownership, then stage and hash every replacement before
    // moving any original. Never silently create a fresh empty Web database.
    checkedBundle(bundle);
    const token = randomUUID(), staged = [], moved = [], installed = [];
    try {
      for (const kind of names) {
        const entry = checked.manifest.databases[kind];
        if (!entry.present) continue;
        const target = files[kind], temp = `${target}.restore-${token}`;
        fs.copyFileSync(path.join(checked.bundle, entry.snapshot.file), temp, fs.constants.COPYFILE_EXCL);
        staged.push(temp);
        ensure(digest(temp) === entry.snapshot.sha256, `${kind} 暂存快照摘要不符`);
        const db = inspect(temp, kind); db.close();
      }
      for (const kind of names) {
        const target = files[kind];
        for (const suffix of ['', '-wal', '-shm']) {
          const original = target + suffix;
          if (!fs.existsSync(original)) continue;
          const previous = `${target}.pre-restore-${token}${suffix}`;
          fs.renameSync(original, previous); moved.push({ original, previous });
        }
      }
      for (const kind of names) {
        if (!checked.manifest.databases[kind].present) continue;
        const target = files[kind], temp = `${target}.restore-${token}`;
        fs.renameSync(temp, target); installed.push(target);
      }
      // Keep exact pre-restore main/WAL/SHM files for an operator rollback.
      return { restored: files, previous: moved.map(item => item.previous), agentPresent: checked.manifest.databases.agent.present };
    } catch (error) {
      const rollbackErrors = [];
      for (const target of installed.reverse()) try { fs.unlinkSync(target); } catch (cause) { rollbackErrors.push(cause); }
      for (const { original, previous } of moved.reverse()) try { fs.renameSync(previous, original); } catch (cause) { rollbackErrors.push(cause); }
      if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], '恢复失败且回滚不完整；请保留 .pre-restore 文件并停止写入');
      throw error;
    } finally { for (const temp of staged) if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  });
}

function args(argv) {
  const [action, ...rest] = argv;
  ensure(['backup', 'verify', 'restore'].includes(action), '用法：backup --web ABS --agent ABS --out DIR | verify --bundle DIR | restore --bundle DIR --web ABS --agent ABS');
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.replace(/^--/, '');
    ensure(['web', 'agent', 'out', 'bundle'].includes(key) && rest[i]?.startsWith('--') && rest[i + 1] && !options[key], '参数无效或重复');
    options[key] = rest[i + 1];
  }
  const expected = action === 'backup' ? ['web', 'agent', 'out'] : action === 'restore' ? ['bundle', 'web', 'agent'] : ['bundle'];
  ensure(Object.keys(options).sort().join() === expected.sort().join(), '缺少或多余参数');
  return { action, options };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { action, options } = args(process.argv.slice(2));
    console.log(JSON.stringify({ action, ...({ backup, verify, restore })[action](options) }, null, 2));
  } catch (error) { console.error(`Trace 离线维护失败：${error.message}`); process.exitCode = 1; }
}
