/**
 * The Codex plugin bridge is intentionally compatible with a tested protocol
 * profile, not with every future CLI that happens to expose a `plugin`
 * command.  Keep this module dependency-free so it can run from a packaged
 * runtime before the plugin is installed.
 */

export const CODEX_PLUGIN_PROTOCOL_PROFILE = Object.freeze({
  id: 'codex-plugin-marketplace-v1',
  tested_versions: Object.freeze(['0.154.0-alpha.6.2']),
  tested_cli: 'codex-cli 0.154.0-alpha.6.2',
  required_commands: Object.freeze(['marketplace', 'add', 'list', 'remove']),
  marketplace_manifest: '.agents/plugins/marketplace.json',
});

// The app-server handshake is a separate protocol boundary from the plugin
// marketplace CLI.  0.153.4 has a recorded live wire/e2e run in
// `artifacts/trace-agent-runtime-20260915`; 0.154.0-alpha.6.2 is the current
// machine's isolated protocol check and live handshake target.  Do not turn
// this into a semver range: an unknown Codex build must be requalified first.
export const CODEX_APP_SERVER_PROTOCOL_PROFILE = Object.freeze({
  id: 'codex-app-server-v1',
  tested_versions: Object.freeze(['0.153.4', '0.154.0-alpha.6.2']),
  default_version: '0.154.0-alpha.6.2',
});

function versionParts(value) {
  const match = String(value ?? '').match(/(?:^|\s)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)/);
  if (!match) return null;
  const [core, pre = ''] = match[1].split('-', 2);
  const numbers = core.split('.').map(Number);
  if (numbers.some(number => !Number.isInteger(number))) return null;
  return {raw: match[1], numbers, pre};
}

export function parseCodexVersion(value) {
  const parsed = versionParts(value);
  if (!parsed) throw new Error(`Unable to parse Codex CLI version: ${String(value ?? '').slice(0, 200)}`);
  return parsed;
}

export function parseCodexAppServerVersion(userAgent) {
  const match = String(userAgent ?? '').match(/(?:trace_agent|Codex Desktop|codex_cli_rs|codex)\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=\s|\(|$)/i);
  return match?.[1] ?? null;
}

export function validateCodexAppServerVersion(userAgent) {
  const version = parseCodexAppServerVersion(userAgent);
  if (!version || !CODEX_APP_SERVER_PROTOCOL_PROFILE.tested_versions.includes(version)) {
    throw new Error(`Unsupported Codex app-server version: ${version ?? 'unparseable'}`);
  }
  return {
    protocol_id: CODEX_APP_SERVER_PROTOCOL_PROFILE.id,
    status: 'compatible',
    verified_version: version,
    verified_versions: [...CODEX_APP_SERVER_PROTOCOL_PROFILE.tested_versions],
  };
}

function hasCommand(help, command) {
  return new RegExp(`(?:^|\\s)${command.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?:\\s|$)`, 'm').test(help);
}

export function validateCodexPluginProtocol({versionOutput, pluginHelpOutput, marketplaceListOutput}) {
  const version = parseCodexVersion(versionOutput);
  const tested = CODEX_PLUGIN_PROTOCOL_PROFILE.tested_versions.includes(version.raw);
  if (!tested) {
    throw new Error(`Unsupported Codex CLI version ${version.raw}; verified versions: ${CODEX_PLUGIN_PROTOCOL_PROFILE.tested_versions.join(', ')}`);
  }
  const help = String(pluginHelpOutput ?? '');
  const missing = CODEX_PLUGIN_PROTOCOL_PROFILE.required_commands.filter(command => !hasCommand(help, command));
  if (missing.length) throw new Error(`Codex plugin protocol is missing commands: ${missing.join(', ')}`);
  let marketplace;
  try { marketplace = JSON.parse(String(marketplaceListOutput ?? '')); }
  catch { throw new Error('Codex plugin marketplace list did not return JSON'); }
  if (!marketplace || !Array.isArray(marketplace.marketplaces)) throw new Error('Codex plugin marketplace list has no marketplaces array');
  return {
    protocol_id: CODEX_PLUGIN_PROTOCOL_PROFILE.id,
    status: 'compatible',
    verified_version: version.raw,
    marketplace_manifest: CODEX_PLUGIN_PROTOCOL_PROFILE.marketplace_manifest,
    checks: ['version', 'plugin-help', 'marketplace-list-json'],
  };
}
