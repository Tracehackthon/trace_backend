import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {
  codexBinaryIdentity,
  createCodexQualificationRecord,
  readCodexAppServerSchemaBundle,
  writeCodexQualificationRecord,
} from '../native/codex-compatibility.mjs';

const executable = process.env.TRACE_CODEX_COMMAND ?? 'codex';
const projectCwd = path.resolve(process.env.TRACE_CODEX_QUALIFY_PROJECT ?? process.cwd());
const recordPath = path.resolve(process.env.TRACE_CODEX_QUALIFICATION_RECORD
  ?? path.join(os.homedir(), '.trace-runtime', 'codex-app-server-qualification.json'));
const schemaCacheRoot = path.resolve(process.env.TRACE_CODEX_SCHEMA_CACHE
  ?? path.join(os.homedir(), '.trace-runtime', 'codex-app-server-schema'));
const timeoutMs = 15_000;

function fail(message) { throw new Error(message); }

function runVersion() {
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8', shell: false, windowsHide: true, env: process.env });
  if (result.error) fail(`Could not launch ${executable}: ${result.error.message}`);
  if (result.status !== 0) fail(`${executable} --version failed: ${(result.stderr || result.stdout || '').trim().slice(0, 800)}`);
  return (result.stdout || result.stderr || '').trim();
}

function generateSchema(root, versionOutput) {
  const result = spawnSync(executable, ['app-server', 'generate-json-schema', '--experimental', '--out', root], {
    encoding: 'utf8', shell: false, windowsHide: true, env: process.env,
  });
  if (result.error) fail(`Could not generate Codex app-server schema: ${result.error.message}`);
  if (result.status !== 0) fail(`Codex schema generation failed for ${versionOutput}: ${(result.stderr || result.stdout || '').trim().slice(0, 1200)}`);
}

class WireProbe {
  constructor({ liveTurn = false } = {}) {
    this.child = null; this.buffer = ''; this.sequence = 0; this.pending = new Map(); this.calls = [];
    this.liveTurn = liveTurn; this.turnStarted = null; this.interruptPromise = null; this.interruptSent = false;
  }
  start() {
    const env = { ...process.env };
    this.child = spawn(executable, ['app-server', '--stdio'], { cwd: projectCwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8'); this.child.stdout.on('data', chunk => this.read(chunk));
    this.child.stderr.on('data', () => {});
    this.child.on('error', error => { for (const pending of this.pending.values()) pending.reject(error); this.pending.clear(); });
  }
  read(chunk) {
    this.buffer += chunk;
    let offset;
    while ((offset = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, offset); this.buffer = this.buffer.slice(offset + 1);
      if (!line.trim()) continue;
      let value; try { value = JSON.parse(line); } catch { continue; }
      if (value.id !== undefined && !value.method) {
        const pending = this.pending.get(value.id); if (!pending) continue;
        this.pending.delete(value.id); clearTimeout(pending.timer);
        pending.call.result = value.result; pending.call.error = value.error;
        if (value.error) pending.reject(new Error(String(value.error.message ?? 'Codex RPC error'))); else pending.resolve(value.result);
      } else if (value.method) {
        const call = { direction: value.id === undefined ? 'notification' : 'server-request', method: value.method, params: value.params };
        this.calls.push(call);
        if (this.liveTurn && value.method === 'turn/started' && !this.interruptSent && value.params?.turn?.id) {
          this.turnStarted = value.params.turn.id;
          this.interruptPromise = this.rpc('turn/interrupt', { threadId: value.params.threadId, turnId: this.turnStarted });
          this.interruptSent = true;
        }
        if (value.id !== undefined) this.child.stdin.write(`${JSON.stringify({ id: value.id, error: { code: -32601, message: 'qualification probe does not answer server requests' } })}\n`);
      }
    }
  }
  rpc(method, params) {
    const id = ++this.sequence;
    const call = { direction: 'request', id, method, params };
    this.calls.push(call);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex qualification RPC timed out: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, call });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
  notify(method, params) {
    this.calls.push({ direction: 'notification', method, params });
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }
  async close() {
    if (!this.child) return;
    this.child.stdin.end();
    if (this.child.exitCode === null) this.child.kill();
    await Promise.race([once(this.child, 'close').catch(() => {}), new Promise(resolve => setTimeout(resolve, 1000))]);
  }
}

async function probe(versionOutput) {
  const liveTurn = process.env.TRACE_CODEX_LIVE_TURN_PROBE === '1';
  const wire = new WireProbe({ liveTurn }); wire.mode = liveTurn ? 'turn-interrupt' : 'no-model'; wire.start();
  try {
    const initializeParams = { clientInfo: { name: 'trace_compatibility_qualifier', title: 'Trace compatibility qualifier', version: '0.1.0' }, capabilities: { experimentalApi: true } };
    const initialize = await wire.rpc('initialize', initializeParams);
    wire.notify('initialized', {});
    await wire.rpc('account/read', { refreshToken: false });
    const started = await wire.rpc('thread/start', { cwd: projectCwd, ephemeral: true, approvalPolicy: 'never' });
    const threadId = started?.thread?.id;
    if (!threadId) fail('Codex qualification thread/start returned no thread id');
    if (liveTurn) {
      const turnPromise = wire.rpc('turn/start', { threadId, effort: 'minimal', input: [{ type: 'text', text: 'Trace compatibility probe; interrupt immediately.', text_elements: [] }] });
      // The turn/started notification triggers the interrupt from WireProbe.
      // This opt-in mode can incur model/provider work and is never used by
      // the automatic startup qualification.
      await Promise.race([turnPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('Codex qualification turn did not reach interrupt window')), timeoutMs))]).catch(() => {});
      if (wire.interruptPromise) await wire.interruptPromise;
      else fail('Codex qualification probe never observed turn/started');
    }
    return { initialize, initializeParams, calls: wire.calls, mode: liveTurn ? 'turn-interrupt' : 'no-model' };
  } finally { await wire.close(); }
}

async function main() {
  const versionOutput = runVersion();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-codex-schema-'));
  try {
    generateSchema(tempRoot, versionOutput);
    const schemaBundle = readCodexAppServerSchemaBundle(tempRoot);
    const wire = await probe(versionOutput);
    const identity = codexBinaryIdentity({ executable, versionOutput, env: process.env });
    const record = createCodexQualificationRecord({ executableIdentity: identity, versionOutput,
      initializeResult: wire.initialize, initializeParams: wire.initializeParams, schemaBundle,
      probeCalls: wire.calls, probeMode: wire.mode, expectedCwd: projectCwd, generatedBy: 'scripts/qualify-codex-app-server.mjs' });
    const cacheRoot = path.join(schemaCacheRoot, record.cache_key);
    fs.mkdirSync(schemaCacheRoot, { recursive: true });
    fs.cpSync(tempRoot, cacheRoot, { recursive: true });
    record.schema.source = cacheRoot;
    writeCodexQualificationRecord(recordPath, record);
    process.stdout.write(`${JSON.stringify({ status: 'compatible', recordPath, schemaRoot: cacheRoot, result: {
      version: record.cli_version, schemaFingerprint: record.schema.fingerprint, cacheKey: record.cache_key,
      checks: ['executable-version', 'binary-sha256', 'generated-schema', 'initialize', 'account/read', 'thread/start', 'no-model-turn'],
    } }, null, 2)}\n`);
  } finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }
}

main().catch(error => { process.stderr.write(`${JSON.stringify({ status: 'incompatible', error: error instanceof Error ? error.message : String(error) })}\n`); process.exitCode = 1; });
