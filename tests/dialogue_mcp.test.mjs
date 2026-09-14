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
  const client = new Client({name: 'trace-mcp-dialogue-test', version: '0.1.0'});
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

test('Trace MCP exposes the dialogue engine, decision path and candidate review closure', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-mcp-dialogue-'));
  const client = await connect(project);
  try {
    const tools = await client.listTools();
    for (const name of ['trace_dialogue_begin', 'trace_dialogue_step', 'trace_dialogue_state', 'trace_path_view', 'trace_candidate_review_view', 'trace_candidate_review_apply']) {
      assert.equal(tools.tools.some(tool => tool.name === name), true, `${name} must be exposed by MCP`);
    }

    // Initialize through the existing proposal/adoption pair first.
    const initialization = await call(client, 'trace_project_initialize_propose', {project_dir: project, source_mode: 'local'});
    await call(client, 'trace_project_initialize_apply', {project_dir: project, source_mode: 'local', proposal_id: initialization.proposal_id, approval: `adopt:${initialization.proposal_id}`});

    // Onboard dialogue runs over MCP and records the decision trail.
    const begun = await call(client, 'trace_dialogue_begin', {project_dir: project, intent: 'onboard'});
    assert.equal(begun.step, 'source-mode');
    assert.equal(begun.pending_decisions.length, 1);
    const fork = begun.pending_decisions[0];

    const stepped = await call(client, 'trace_dialogue_step', {
      project_dir: project, thread_id: begun.thread_id,
      move: {action: 'decide', summary: '用户选择 local', decision_id: fork.record_id, chosen: 'local', rationale: '只用项目本地来源'},
    });
    assert.equal(stepped.step, 'boundaries');

    const path = await call(client, 'trace_path_view', {project_dir: project, thread_id: begun.thread_id});
    assert.equal(path.taken.length, 1);
    assert.equal(path.taken[0].chosen, 'local');
    assert.equal(path.taken[0].rationale, '只用项目本地来源');

    const state = await call(client, 'trace_dialogue_state', {project_dir: project});
    assert.equal(state.active_count, 1);
    assert.equal(state.dialogues[0].thread_id, begun.thread_id);

    // The dialogue engine never writes configuration by itself.
    const status = await call(client, 'trace_project_status', {project_dir: project});
    assert.equal(status.configuration.state, 'locked');
  } finally {
    await client.close();
  }
});
