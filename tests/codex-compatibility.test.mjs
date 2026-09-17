import test from 'node:test';
import assert from 'node:assert/strict';
import {CODEX_PLUGIN_PROTOCOL_PROFILE, parseCodexVersion, validateCodexPluginProtocol} from '../native/codex-compatibility.mjs';

const help = `Manage Codex plugins\n\nCommands:\n  add\n  list\n  marketplace\n  remove\n`;

test('Codex plugin protocol accepts only the verified 0.154 alpha profile', () => {
  const result = validateCodexPluginProtocol({
    versionOutput: `codex-cli ${CODEX_PLUGIN_PROTOCOL_PROFILE.tested_versions[0]}\n`,
    pluginHelpOutput: help,
    marketplaceListOutput: JSON.stringify({marketplaces: []}),
  });
  assert.equal(result.status, 'compatible');
  assert.equal(result.protocol_id, 'codex-plugin-marketplace-v1');
  assert.equal(result.marketplace_manifest, '.agents/plugins/marketplace.json');
});

test('Codex protocol validation rejects an unverified future CLI instead of widening compatibility', () => {
  assert.throws(() => validateCodexPluginProtocol({
    versionOutput: 'codex-cli 0.155.0',
    pluginHelpOutput: help,
    marketplaceListOutput: JSON.stringify({marketplaces: []}),
  }), /Unsupported Codex CLI version/);
  assert.throws(() => validateCodexPluginProtocol({
    versionOutput: 'codex-cli 0.154.0-alpha.6.3',
    pluginHelpOutput: help,
    marketplaceListOutput: JSON.stringify({marketplaces: []}),
  }), /Unsupported Codex CLI version/);
});

test('Codex protocol validation checks command and JSON boundaries separately', () => {
  assert.deepEqual(parseCodexVersion('codex-cli 0.154.0-alpha.6.2'), {raw: '0.154.0-alpha.6.2', numbers: [0, 154, 0], pre: 'alpha.6.2'});
  assert.throws(() => validateCodexPluginProtocol({
    versionOutput: 'codex-cli 0.154.0-alpha.6.2',
    pluginHelpOutput: 'Commands: add list',
    marketplaceListOutput: JSON.stringify({marketplaces: []}),
  }), /missing commands/);
  assert.throws(() => validateCodexPluginProtocol({
    versionOutput: 'codex-cli 0.154.0-alpha.6.2',
    pluginHelpOutput: help,
    marketplaceListOutput: 'not-json',
  }), /did not return JSON/);
});
