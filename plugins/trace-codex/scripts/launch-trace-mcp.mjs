#!/usr/bin/env node
/**
 * Resolve the MCP bridge without baking a developer checkout into the plugin.
 * A packaged Trace install keeps this plugin under <runtime>/plugins/, while a
 * separately installed plugin can point TRACE_RUNTIME_ROOT at that install.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, '..');
const bundledRuntime = path.resolve(pluginRoot, '..', '..');
const requestedRuntime = process.env.TRACE_RUNTIME_ROOT;
const runtimeRoot = requestedRuntime ? path.resolve(requestedRuntime) : bundledRuntime;
const entry = path.join(runtimeRoot, 'dist', 'apps', 'mcp', 'src', 'main.js');

if (!fs.existsSync(entry)) {
  process.stderr.write([
    'Trace MCP could not find its installed runtime.',
    'Install the packaged Trace runtime beside this plugin, or set TRACE_RUNTIME_ROOT to the Trace installation root.',
    `Checked: ${entry}`,
  ].join('\n') + '\n');
  process.exitCode = 1;
} else {
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
