import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

// The desktop host and offline maintenance share this sidecar. Unknown owners
// fail closed; a dead PID can be reclaimed after comparing the exact contents.
export function acquireStateOwner(file) {
  const lock = `${file}.owner`;
  const owner = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  try { fs.writeFileSync(lock, owner, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let saved, dead = false;
    try {
      saved = fs.readFileSync(lock, 'utf8');
      const pid = JSON.parse(saved).pid;
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); } catch (cause) { dead = cause.code === 'ESRCH'; }
      }
    } catch { /* An unreadable or malformed owner is not proof of staleness. */ }
    if (!dead || fs.readFileSync(lock, 'utf8') !== saved) throw new Error(`数据库仍被占用或 owner 无法确认：${file}`);
    fs.unlinkSync(lock);
    try { fs.writeFileSync(lock, owner, { flag: 'wx', mode: 0o600 }); }
    catch { throw new Error(`另一进程已取得数据库 owner：${file}`); }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try { if (fs.readFileSync(lock, 'utf8') === owner) fs.unlinkSync(lock); } catch {}
  };
}
