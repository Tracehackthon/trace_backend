#!/usr/bin/env node
/**
 * Resolve the MCP bridge without baking a developer checkout into the plugin.
 * A packaged Trace install keeps this plugin under <runtime>/plugins/, while a
 * separately installed plugin can point TRACE_RUNTIME_ROOT at that install.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, '..');
const bundledRuntime = path.resolve(pluginRoot, '..', '..');
const requestedRuntime = process.env.TRACE_RUNTIME_ROOT;
const runtimeRoot = requestedRuntime ? path.resolve(requestedRuntime) : bundledRuntime;
const entry = path.join(runtimeRoot, 'dist', 'apps', 'mcp', 'src', 'main.js');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function main() {
  // The launcher receives TRACE_RUNTIME_ROOT from the managed installer, but
  // the environment can be edited or inherited by a stale Codex process. A
  // matching MCP filename alone is not enough: validate the package/source
  // manifest and its bounded service entrypoints before starting anything.
  let identity;
  try {
    const identityModule = await import(pathToFileURL(path.join(runtimeRoot, 'runtime-identity.mjs')).href);
    identity = identityModule.runtimeRootCandidate?.(runtimeRoot);
  } catch (error) {
    fail([
      'Trace MCP could not validate its installed runtime.',
      'The selected root is missing a usable runtime identity module.',
      `Checked: ${runtimeRoot}`,
      `Reason: ${error instanceof Error ? error.message : String(error)}`,
    ].join('\n'));
    return;
  }
  if (!identity?.valid) {
    const missing = identity?.missing?.length ? ` (${identity.missing.join(', ')})` : '';
    fail([
      'Trace MCP could not validate its installed runtime.',
      `Runtime root is not a validated Trace runtime: ${identity?.code ?? 'RUNTIME_IDENTITY_INVALID'}${missing}`,
      `Checked: ${runtimeRoot}`,
    ].join('\n'));
    return;
  }
  if (!fs.existsSync(entry)) {
    fail([
      'Trace MCP could not find its installed runtime.',
      'Install the packaged Trace runtime beside this plugin, or set TRACE_RUNTIME_ROOT to the Trace installation root.',
      `Checked: ${entry}`,
    ].join('\n'));
    return;
  }
  const child = spawn(process.execPath, [entry], {
    cwd: process.cwd(),
    env: {...process.env, TRACE_RUNTIME_ROOT: runtimeRoot},
    stdio: 'inherit',
  });
  child.once('error', error => {
    process.stderr.write(`Trace MCP launch failed: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    if (signal) process.exitCode = 1;
    else process.exitCode = code ?? 1;
  });
}

main().catch(error => fail(`Trace MCP launch failed: ${error instanceof Error ? error.message : String(error)}`));
