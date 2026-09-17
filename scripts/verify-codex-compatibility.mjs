import {spawnSync} from 'node:child_process';
import {CODEX_PLUGIN_PROTOCOL_PROFILE, validateCodexPluginProtocol} from '../native/codex-compatibility.mjs';

const command = process.env.TRACE_CODEX_COMMAND ?? 'codex';

function run(args) {
  const result = spawnSync(command, args, {encoding: 'utf8', shell: false, windowsHide: true});
  if (result.error) throw new Error(`Could not launch ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim().slice(0, 800)}`);
  return result.stdout || result.stderr || '';
}

try {
  const result = validateCodexPluginProtocol({
    versionOutput: run(['--version']),
    pluginHelpOutput: run(['plugin', '--help']),
    marketplaceListOutput: run(['plugin', 'marketplace', 'list', '--json']),
  });
  process.stdout.write(JSON.stringify({status: 'compatible', command, profile: CODEX_PLUGIN_PROTOCOL_PROFILE, result}) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({status: 'incompatible', command, profile: CODEX_PLUGIN_PROTOCOL_PROFILE, error: error instanceof Error ? error.message : String(error)}) + '\n');
  process.exitCode = 1;
}
