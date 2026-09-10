import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Client} from '../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const root = path.resolve(process.cwd());
const mcpEntry = path.join(root, 'dist', 'apps', 'mcp', 'src', 'main.js');

async function connect(project) {
  const client = new Client({name: 'trace-mcp-test', version: '0.1.0'});
  const transport = new StdioClientTransport({command: process.execPath, args: [mcpEntry], cwd: project, stderr: 'pipe'});
  await client.connect(transport);
  return client;
}

async function call(client, name, args) {
  const response = await client.callTool({name, arguments: args});
  const body = response.content?.find(item => item.type === 'text');
  assert.ok(body, `${name} must return a text result`);
  const value = JSON.parse(body.text);
  assert.equal(value.ok, true, `${name} failed: ${JSON.stringify(value)}`);
  return value;
}

test('Trace MCP uses proposal/adoption, protects source state, and migrates legacy projects without automatic rewrites', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-mcp-'));
  const client = await connect(project);
  try {
    const tools = await client.listTools();
    for (const name of ['trace_project_status', 'trace_project_initialize_propose', 'trace_profile_migrate_propose', 'trace_profile_update_propose', 'trace_codex_hook_enable_propose', 'trace_capabilities_list']) {
      assert.equal(tools.tools.some(tool => tool.name === name), true, `${name} must be exposed by MCP`);
    }

    const initialization = await call(client, 'trace_project_initialize_propose', {project_dir: project, source_mode: 'local'});
    assert.equal(initialization.operation, 'project_initialize');
    assert.deepEqual(initialization.summary.will_not_do, ['read external source bodies', 'install global hooks', 'replace existing Trace state']);
    const created = await call(client, 'trace_project_initialize_apply', {
      project_dir: project, source_mode: 'local', proposal_id: initialization.proposal_id, approval: `adopt:${initialization.proposal_id}`,
    });
    assert.equal(created.status, 'initialized');
    assert.equal(fs.existsSync(path.join(project, '.trace', 'state', 'trace.sqlite')), true);

    const source = await call(client, 'trace_source_view', {project_dir: project});
    assert.equal(source.source.root_visibility, 'private-not-returned');
    assert.equal(JSON.stringify(source).includes(path.join(project, '.trace', 'source')), false, 'source root must not enter MCP output');

    const status = await call(client, 'trace_project_status', {project_dir: project});
    assert.equal(status.configuration.state, 'locked');
    assert.equal(status.installation.state, 'matching');
    const abilities = await call(client, 'trace_capabilities_list', {project_dir: project});
    assert.equal(abilities.candidate_count, 0);
    const sqlite = path.join(project, '.trace', 'state', 'trace.sqlite');
    const databaseBefore = fs.readFileSync(sqlite);

    const instanceLock = path.join(project, '.trace', 'instance', 'trace.lock.json');
    const lock = JSON.parse(fs.readFileSync(instanceLock, 'utf8'));
    lock.runtime_version = '0.1.0';
    fs.writeFileSync(instanceLock, JSON.stringify(lock, null, 2) + '\n', 'utf8');
    const upgrade = await call(client, 'trace_upgrade_inspect', {project_dir: project});
    assert.equal(upgrade.installation.state, 'runtime_changed');
    assert.deepEqual(fs.readFileSync(sqlite), databaseBefore, 'inspection never mutates user state');

    // Simulate the precise older-project state: the durable ledger stays in
    // place while the then-new activation profile files/lock do not exist.
    fs.rmSync(path.join(project, '.trace', 'profiles', 'collaboration-model.json'));
    fs.rmSync(path.join(project, '.trace', 'profiles', 'source-activation.json'));
    fs.rmSync(path.join(project, '.trace', 'instance', 'activation.lock.json'));
    const legacy = await call(client, 'trace_project_status', {project_dir: project});
    assert.equal(legacy.configuration.state, 'legacy_unlocked');
    const migration = await call(client, 'trace_profile_migrate_propose', {project_dir: project});
    assert.equal(migration.summary.current_configuration_state, 'legacy_unlocked');
    assert.deepEqual(migration.summary.will_not_do, ['change selected source', 'read source bodies', 'rewrite SQLite state', 'change capabilities', 'install or replace Codex hooks']);
    const migrated = await call(client, 'trace_profile_migrate_apply', {
      project_dir: project, proposal_id: migration.proposal_id, approval: `adopt:${migration.proposal_id}`,
    });
    assert.equal(migrated.status, 'migrated');
    assert.deepEqual(fs.readFileSync(sqlite), databaseBefore, 'explicit compatibility migration must preserve the ledger');
    const locked = await call(client, 'trace_project_status', {project_dir: project});
    assert.equal(locked.configuration.state, 'locked');
  } finally {
    await client.close();
    fs.rmSync(project, {recursive: true, force: true});
  }
});
