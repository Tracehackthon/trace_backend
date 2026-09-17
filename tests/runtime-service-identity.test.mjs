import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createProductWorkspace} from '../packages/product/workspace/src/workspace.mjs';
import {createAgentStore} from '../apps/agent/store.mjs';
import {runtimeRootCandidate, resolveRuntimeRoot} from '../runtime-identity.mjs';
import {SqliteVersionedStore, openSqlite} from '../dist/packages/core/storage/src/index.js';
import {TraceRuntime} from '../dist/packages/core/runtime/src/index.js';
import {validateProductServiceIdentity, TraceProductClient, TraceProductClientError} from '../dist/apps/mcp/src/product-client.js';

function temp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function remove(directory) { fs.rmSync(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 20}); }

test('verified Product and project identities survive database rename but reject a copy in another workspace', () => {
  const directory = temp('trace-identity-role-');
  try {
    const web = path.join(directory, 'web.sqlite');
    let product = createProductWorkspace({file: web});
    assert.equal(product.identity.role, 'product-web');
    const productIdentity = product.identity;
    product.close();
    const renamed = path.join(directory, 'renamed.sqlite');
    fs.renameSync(web, renamed);
    product = createProductWorkspace({file: renamed});
    assert.deepEqual(product.identity, productIdentity);
    product.close();

    const other = temp('trace-identity-other-');
    try {
      const copied = path.join(other, 'web.sqlite');
      fs.copyFileSync(renamed, copied);
      const before = fs.readFileSync(copied);
      assert.throws(() => createProductWorkspace({file: copied}), error => error?.code === 'DATABASE_IDENTITY_MISMATCH');
      assert.deepEqual(fs.readFileSync(copied), before, 'a misrouted Product database is rejected before WAL/schema mutation');
    } finally { remove(other); }

    const projectFile = path.join(directory, 'project.sqlite');
    const project = new SqliteVersionedStore(projectFile, 'records');
    assert.equal(project.identity.role, 'project-runtime');
    project.append({record_id: 'one', revision: 1, value: 'ok'});
    project.close();
    assert.throws(() => new SqliteVersionedStore(renamed, 'records'), error => error?.code === 'DATABASE_ROLE_MISMATCH');
  } finally { remove(directory); }
});

test('legacy Product and project databases are readable, explicitly marked, and write-locked until upgrade', () => {
  const directory = temp('trace-identity-legacy-');
  try {
    const web = path.join(directory, 'web.sqlite');
    let product = createProductWorkspace({file: web});
    product.close();
    const productDb = new DatabaseSync(web);
    productDb.exec('DROP TABLE trace_runtime_identity');
    productDb.close();
    product = createProductWorkspace({file: web});
    assert.equal(product.identity.verification_state, 'legacy');
    assert.throws(() => product.execute({}), error => error?.code === 'LEGACY_IDENTITY_UNVERIFIED');
    const upgradedProduct = product.upgradeIdentity({workspaceId: 'workspace-test', installationId: 'installation-test'});
    assert.equal(upgradedProduct.verification_state, 'verified');
    product.close();

    const state = path.join(directory, 'state.sqlite');
    let project = new SqliteVersionedStore(state, 'records');
    project.append({record_id: 'legacy', revision: 1});
    project.close();
    const stateDb = openSqlite(state).db;
    stateDb.exec('DROP TABLE trace_runtime_identity');
    stateDb.close();
    project = new SqliteVersionedStore(state, 'records');
    assert.equal(project.identity.verification_state, 'legacy');
    assert.throws(() => project.append({record_id: 'blocked', revision: 1}), error => error?.code === 'LEGACY_IDENTITY_UNVERIFIED');
    project.upgradeIdentity({workspaceId: 'workspace-test', installationId: 'installation-test'});
    project.append({record_id: 'allowed', revision: 1});
    project.close();
    const runtime = new TraceRuntime({sqliteStateFile: path.join(directory, 'runtime.sqlite')});
    assert.equal(runtime.identity.role, 'project-runtime');
    runtime.close();
  } finally { remove(directory); }
});

test('Agent identity is an independent role and never opens Product state', () => {
  const directory = temp('trace-identity-agent-');
  try {
    const web = path.join(directory, 'web.sqlite');
    const product = createProductWorkspace({file: web});
    const identity = product.identity;
    assert.throws(() => createAgentStore({file: web, workspaceIdentity: identity}), error => error?.code === 'WRONG_AGENT_DB');
    const agentFile = path.join(directory, 'agent.sqlite');
    let agent = createAgentStore({file: agentFile, workspaceIdentity: identity});
    assert.equal(agent.identity.role, 'agent-runtime');
    assert.equal(agent.identity.workspace_id, identity.workspace_id);
    agent.close();
    const agentDb = new DatabaseSync(agentFile);
    agentDb.exec('DROP TABLE trace_runtime_identity');
    agentDb.close();
    agent = createAgentStore({file: agentFile, workspaceIdentity: identity});
    assert.equal(agent.identity.verification_state, 'legacy');
    const upgraded = agent.upgradeIdentity({workspaceId: identity.workspace_id, installationId: identity.installation_id});
    assert.equal(upgraded.verification_state, 'verified');
    agent.close(); product.close();
  } finally { remove(directory); }
});

test('compatible runtime upgrades refresh only the recorded version and preserve owner IDs', () => {
  const directory = temp('trace-identity-upgrade-');
  try {
    const web = path.join(directory, 'web.sqlite');
    let product = createProductWorkspace({file: web, runtimeVersion: '0.7.1'});
    const originalProduct = product.identity;
    product.close();
    product = createProductWorkspace({file: web, runtimeVersion: '0.7.2'});
    assert.equal(product.identity.runtime_version, '0.7.2');
    assert.equal(product.identity.workspace_id, originalProduct.workspace_id);
    assert.equal(product.identity.installation_id, originalProduct.installation_id);
    product.close();

    const projectFile = path.join(directory, 'project.sqlite');
    let project = new SqliteVersionedStore(projectFile, 'records', {runtimeVersion: '0.7.1'});
    const originalProject = project.identity;
    project.close();
    project = new SqliteVersionedStore(projectFile, 'records', {runtimeVersion: '0.7.2'});
    assert.equal(project.identity.runtime_version, '0.7.2');
    assert.equal(project.identity.workspace_id, originalProject.workspace_id);
    assert.equal(project.identity.installation_id, originalProject.installation_id);
    project.close();

    let agent = createAgentStore({file: path.join(directory, 'agent.sqlite'), workspaceIdentity: originalProduct, runtimeVersion: '0.7.1'});
    agent.close();
    agent = createAgentStore({file: path.join(directory, 'agent.sqlite'), workspaceIdentity: originalProduct, runtimeVersion: '0.7.2'});
    assert.equal(agent.identity.runtime_version, '0.7.2');
    assert.equal(agent.identity.workspace_id, originalProduct.workspace_id);
    assert.equal(agent.identity.installation_id, originalProduct.installation_id);
    agent.close();
  } finally { remove(directory); }
});

test('runtime root validation rejects old/fake manifests and refuses ambiguous valid roots', () => {
  const old = temp('trace-runtime-old-');
  const fakeA = temp('trace-runtime-fake-a-');
  const fakeB = temp('trace-runtime-fake-b-');
  try {
    fs.writeFileSync(path.join(old, 'package.json'), JSON.stringify({name: 'trace-runtime', version: '0.7.1'}));
    assert.equal(runtimeRootCandidate(old).valid, false);
    fs.writeFileSync(path.join(fakeA, 'runtime.json'), JSON.stringify({runtime_version: '0.7.1', manifest_id: 'trace.runtime.distribution'}));
    fs.writeFileSync(path.join(fakeB, 'runtime.json'), JSON.stringify({runtime_version: '0.7.1', manifest_id: 'trace.runtime.distribution'}));
    assert.equal(runtimeRootCandidate(fakeA).valid, false);
    assert.throws(() => resolveRuntimeRoot([fakeA, fakeB]), error => error?.code === 'RUNTIME_ROOT_INVALID');
    for (const root of [fakeA, fakeB]) {
      const required = ['runtime.json', 'apps/desktop/server.mjs', 'apps/agent/backend.mjs', 'packages/product/workspace/src/workspace.mjs'];
      for (const relative of required.slice(1)) {
        const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, '// fake but non-empty runtime entrypoint\n');
      }
      const files = required.map(relative => ({path: relative, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex'), bytes: fs.statSync(path.join(root, relative)).size}));
      fs.writeFileSync(path.join(root, 'release-manifest.json'), JSON.stringify({manifest_id: 'trace.runtime.distribution', manifest_version: '0.2.0', runtime_version: '0.7.1', files}));
    }
    assert.throws(() => resolveRuntimeRoot([fakeA, fakeB]), error => error?.code === 'RUNTIME_ROOT_AMBIGUOUS');
  } finally { remove(old); remove(fakeA); remove(fakeB); }
});

function serviceIdentity(overrides = {}) {
  return {protocol_version: 1, protocol: 'trace.runtime.identity@1', product_id: 'trace', service_id: 'trace-product-service',
    service_role: 'product', database_role: 'product-web', runtime_version: '0.7.1', workspace_id: 'workspace-test', installation_id: 'installation-test', identity_state: 'verified',
    api_surface: {runtime: ['/api/runtime/identity'], product: ['/api/product/workspace'], host: ['/api/product/host/findings']}, ...overrides};
}

test('Product client handshakes before reads and rejects wrong protocol/service/identity', async () => {
  assert.throws(() => validateProductServiceIdentity(serviceIdentity({protocol_version: 2})), error => error?.code === 'PROTOCOL_MISMATCH');
  assert.throws(() => validateProductServiceIdentity(serviceIdentity({service_id: 'trace-agent-service'})), error => error?.code === 'SERVICE_IDENTITY_MISMATCH');
  assert.throws(() => validateProductServiceIdentity(serviceIdentity(), {workspaceId: 'workspace-other'}), error => error?.code === 'IDENTITY_MISMATCH');
  const calls = [];
  const client = new TraceProductClient({baseUrl: 'http://127.0.0.1:4173', sessionId: 'session-test', workspaceId: 'workspace-test', installationId: 'installation-test', runtimeVersion: '0.7.1',
    fetchImpl: async (url, options) => {
      calls.push({url, options});
      if (String(url).endsWith('/api/runtime/identity')) return new Response(JSON.stringify(serviceIdentity()), {status: 200, headers: {'content-type': 'application/json'}});
      return new Response(JSON.stringify({protocolVersion: 1, revision: 0}), {status: 200, headers: {'content-type': 'application/json'}});
    }});
  await client.listWorkflowFindings();
  assert.equal(calls[0].url, 'http://127.0.0.1:4173/api/runtime/identity');
  assert.equal(String(calls[1].url), 'http://127.0.0.1:4173/api/product/host/findings?host=codex&session_id=session-test');
  assert.equal(calls[0].options.headers['x-trace-runtime-protocol'], '1');
  assert.equal(calls.length, 2);
  const wrongPort = new TraceProductClient({baseUrl: 'http://127.0.0.1:4174', sessionId: 'session-test', fetchImpl: async () => new Response(JSON.stringify(serviceIdentity({service_id: 'trace-agent-service'})), {status: 200})});
  await assert.rejects(wrongPort.serviceIdentity(), error => error instanceof TraceProductClientError && error.code === 'SERVICE_IDENTITY_MISMATCH');
});

test('Product client re-handshakes after a completed call so a restarted port cannot switch workspaces', async () => {
  const calls = [];
  let current = serviceIdentity();
  const client = new TraceProductClient({baseUrl: 'http://127.0.0.1:4173', sessionId: 'session-restart', fetchImpl: async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/api/runtime/identity')) return new Response(JSON.stringify(current), {status: 200});
    return new Response(JSON.stringify({protocolVersion: 1, items: []}), {status: 200});
  }});
  await client.listWorkflowFindings();
  current = serviceIdentity({workspace_id: 'workspace-restarted', installation_id: 'installation-restarted'});
  await assert.rejects(client.listWorkflowFindings(), error => error instanceof TraceProductClientError && error.code === 'IDENTITY_MISMATCH');
  assert.equal(calls.filter(url => url.endsWith('/api/runtime/identity')).length, 2);
});
