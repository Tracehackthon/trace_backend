import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {Client} from '../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import {createWebStore} from '../apps/desktop/web-store.mjs';

const root = path.resolve(process.cwd());
const mcpEntry = path.join(root, 'dist', 'apps', 'mcp', 'src', 'main.js');

async function connect(project, env) {
  const client = new Client({name: 'trace-mcp-test', version: '0.1.0'});
  const transport = new StdioClientTransport({command: process.execPath, args: [mcpEntry], cwd: project, stderr: 'pipe', ...(env === undefined ? {} : {env})});
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
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'));
  environment.CODEX_THREAD_ID = 'codex-context-skill-task';
  delete environment.CODEX_SESSION_ID;
  const client = await connect(project, environment);
  try {
    const tools = await client.listTools();
    for (const name of ['trace_project_status', 'trace_project_initialize_propose', 'trace_profile_migrate_propose', 'trace_profile_update_propose', 'trace_codex_hook_enable_propose', 'trace_capabilities_list', 'trace_context_skill_receive']) {
      assert.equal(tools.tools.some(tool => tool.name === name), true, `${name} must be exposed by MCP`);
    }
    const contextSkillTool = tools.tools.find(tool => tool.name === 'trace_context_skill_receive');
    assert.deepEqual(Object.keys(contextSkillTool.inputSchema.properties), ['project_dir'], 'the model cannot supply or override Codex session identity');

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
    const contextSkill = await call(client, 'trace_context_skill_receive', {project_dir: project});
    assert.equal(contextSkill.receipt.status, 'received');
    assert.equal(contextSkill.receipt.session_id, 'codex-context-skill-task');
    assert.equal(contextSkill.receipt.package_id, contextSkill.package.package_id);
    assert.equal(contextSkill.package.session_binding.session_id, 'codex-context-skill-task');
    assert.equal(contextSkill.package.scope.project_id, path.basename(project).toLowerCase());
    assert.equal(contextSkill.package.provenance.source_activation.available, true);
    assert.match(contextSkill.package.skill.skill_md, /^---\nname: trace-project-context\n/);
    assert.equal(JSON.stringify(contextSkill).includes(project), false, 'context Skill output must not expose the project/source absolute path');
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
    const rejectedContext = await client.callTool({name: 'trace_context_skill_receive', arguments: {project_dir: project}});
    assert.equal(rejectedContext.isError, true);
    const rejectedBody = rejectedContext.content?.find(item => item.type === 'text');
    assert.ok(rejectedBody);
    assert.equal(JSON.parse(rejectedBody.text).error.code, 'PROFILE_MIGRATION_REQUIRED');
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

test('Trace MCP binds a product handoff to the real Codex environment and returns a reviewable result', async t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-mcp-product-'));
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-mcp-product-state-'));
  const store = createWebStore({file: path.join(stateDirectory, 'web.sqlite')});
  const server = http.createServer(async (req, res) => { if (!await store.handle(req, res)) { res.writeHead(404); res.end('{}'); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    store.close();
    fs.rmSync(project, {recursive: true, force: true});
    fs.rmSync(stateDirectory, {recursive: true, force: true});
  });
  const post = async (route, body) => {
    const response = await fetch(`${origin}${route}`, {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: JSON.stringify(body)});
    return {status: response.status, value: await response.json()};
  };
  const projectName = path.basename(project);
  const seed = await post('/api/product/commands', {
    protocolVersion: 1, commandId: 'mcp-product-seed', expectedRevision: 0, operations: [
      {type: 'capture.create', matterId: 'mcp-matter', text: '让 Codex 实际接收本次上下文。'},
      {type: 'chain.action', matterId: 'mcp-matter', action: {type: 'UNDERSTANDING_DRAFT', text: '需要真实 delivery 和 return receipt。'}},
      {type: 'chain.action', matterId: 'mcp-matter', action: {type: 'SAVE_UNDERSTANDING'}},
      {type: 'handoff.create', matterId: 'mcp-matter', workId: 'mcp-work', destination: {agent: 'Codex', project: projectName, task: 'MCP 往返'}, role: 'reference', note: '只用于本测试'},
    ],
  });
  assert.equal(seed.status, 200, JSON.stringify(seed.value));

  const environment = Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'));
  environment.TRACE_PRODUCT_URL = origin;
  environment.CODEX_THREAD_ID = 'codex-real-task-id';
  delete environment.CODEX_SESSION_ID;
  const client = await connect(project, environment);
  try {
    const tools = await client.listTools();
    assert.equal(tools.tools.some(tool => tool.name === 'trace_product_context_receive'), true);
    assert.equal(tools.tools.some(tool => tool.name === 'trace_product_result_return'), true);
    const received = await call(client, 'trace_product_context_receive', {project_dir: project, work_id: 'mcp-work'});
    assert.equal(received.receipt.sessionId, 'codex-real-task-id');
    assert.equal(received.receipt.projectDir, project);
    assert.equal(received.context.context.intake[0].text, '需要真实 delivery 和 return receipt。');
    assert.equal(received.context.context.intake[0].instruction.includes('当前明确要求'), true);

    const returned = await call(client, 'trace_product_result_return', {
      project_dir: project,
      work_id: received.receipt.workId,
      delivery_id: received.receipt.deliveryId,
      context_hash: received.receipt.contextHash,
      matter_id: received.context.context.intake[0].matterId,
      fact: 'MCP client 完成了一次真实 receive → return。',
      interpretation: '环境中的 Codex task identity 已在服务端回执中绑定。',
      unconfirmed: '尚未由用户确认新的理解。',
      artifacts: [{title: 'MCP integration test', kind: 'test', path: 'tests/mcp.test.mjs'}],
    });
    assert.equal(returned.receipt.status, 'returned_for_review');
    assert.equal(returned.receipt.sessionId, 'codex-real-task-id');
    assert.equal(returned.receipt.understandingChanged, false);
    const workspace = await (await fetch(`${origin}/api/product/workspace`, {headers: {origin}})).json();
    assert.equal(workspace.host.worksite.sessions['mcp-work'].codexReturns.length, 1);
    assert.equal(workspace.host.chain.matters[0].understanding, '需要真实 delivery 和 return receipt。');
  } finally { await client.close(); }
});
