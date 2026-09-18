import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {CODEX_APP_SERVER_PROTOCOL_PROFILE, CODEX_PLUGIN_PROTOCOL_PROFILE, parseCodexAppServerVersion, parseCodexVersion, validateCodexAppServerProtocolFixture, validateCodexAppServerVersion, validateCodexPluginProtocol} from '../native/codex-compatibility.mjs';
import {createExecutorRegistry} from '../apps/agent/profiles.mjs';

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

test('Codex app-server accepts only separately evidenced versions', () => {
  assert.equal(parseCodexAppServerVersion('Codex Desktop/0.154.0-alpha.6.2 (Windows 10; x86_64)'), '0.154.0-alpha.6.2');
  assert.equal(parseCodexAppServerVersion('codex_cli_rs/0.153.4 (Windows; x86_64)'), '0.153.4');
  const current = validateCodexAppServerVersion('codex_cli_rs/0.155.0-alpha.2.6 (Windows 10.0.26200; x86_64)');
  assert.equal(current.protocol_id, 'codex-app-server-v1');
  assert.deepEqual(current.verified_versions, [...CODEX_APP_SERVER_PROTOCOL_PROFILE.tested_versions]);
  assert.throws(() => validateCodexAppServerVersion('Codex Desktop/0.154.0-alpha.6.3 (Windows; x86_64)'), /Unsupported Codex app-server version/);
  assert.throws(() => validateCodexAppServerVersion('Codex Desktop/0.155.0 (Windows; x86_64)'), /Unsupported Codex app-server version/);
  assert.throws(() => validateCodexAppServerVersion('other/0.154.0-alpha.6.2'), /Unsupported Codex app-server version/);
});

test('current Codex app-server version is backed by generated protocol schema fixtures, not only a version string', () => {
  const fixture = path.join(process.cwd(), 'tests', 'fixtures', 'codex-app-server-0.155.0-alpha.2.6');
  const read = name => JSON.parse(fs.readFileSync(path.join(fixture, name), 'utf8'));
  const result = validateCodexAppServerProtocolFixture({ version: '0.155.0-alpha.2.6',
    clientRequest: read('ClientRequest.json'), serverRequest: read('ServerRequest.json'), serverNotification: read('ServerNotification.json') });
  assert.equal(result.status, 'compatible');
  assert.ok(result.counts.client_requests >= 6);
  assert.ok(result.counts.server_requests >= 4);
  assert.ok(result.counts.notifications >= 6);
});

test('Agent capabilities advertise dynamic qualification; the live check reports the verified runtime version', () => {
  const codex = createExecutorRegistry({env: {}}).describe().profiles.find(profile => profile.kind === 'codex');
  assert.equal(codex.serviceIdentity, 'codex-app-server/dynamic-qualified');
  assert.equal(codex.qualificationRequiredAtConnect, true);
  assert.equal('verifiedRuntimeVersion' in codex, false);
  assert.equal('verifiedRuntimeVersions' in codex, false);
});
