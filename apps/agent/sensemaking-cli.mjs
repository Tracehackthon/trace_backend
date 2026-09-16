import path from 'node:path';
import process from 'node:process';
import {createSensemakingWorker} from './sensemaking-worker.mjs';

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1];
}
function required(args, name) {
  const value = option(args, name); if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`); return path.resolve(value);
}
const args = process.argv.slice(2);
const action = args[0] ?? 'once';
if (!['once', 'drain'].includes(action)) throw new Error('usage: sensemaking-cli.mjs once|drain --web-state-file ABS [--agent-state-file ABS] [--limit N]');
const webFile = required(args, '--web-state-file');
const agentFile = option(args, '--agent-state-file', process.env.TRACE_AGENT_STATE_FILE);
if (!agentFile || !path.isAbsolute(agentFile)) throw new Error('--agent-state-file or TRACE_AGENT_STATE_FILE must be an absolute path');
const worker = createSensemakingWorker({webFile, agentFile});
try {
  // Profile/shadow execution is asynchronous.  Await the drain before
  // closing the worker; otherwise the finally block would close its stores
  // while the provider call is still in flight and print `{}` for a Promise.
  const result = await (action === 'once' ? worker.once() : worker.drain({limit: Number(option(args, '--limit', '16'))}));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally { worker.close(); }
