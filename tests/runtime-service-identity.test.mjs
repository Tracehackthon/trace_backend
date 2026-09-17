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
import {SqliteTraceEventStore} from '../dist/packages/core/observability/src/index.js';
import {TraceRuntime} from '../dist/packages/core/runtime/src/index.js';
import {validateProductServiceIdentity, TraceProductClient, TraceProductClientError} from '../dist/apps/mcp/src/product-client.js';
import {TraceZhihuClient} from '../dist/apps/mcp/src/zhihu-client.js';

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

      const unrelated = path.join(other, 'unrelated.sqlite');
      const unrelatedDb = new DatabaseSync(unrelated);
      unrelatedDb.exec('CREATE TABLE unrelated(value TEXT)'); unrelatedDb.close();
      const unrelatedBefore = fs.readFileSync(unrelated);
      assert.throws(() => new SqliteVersionedStore(unrelated, 'records'), error => error?.code === 'WRONG_DATABASE');
      assert.deepEqual(fs.readFileSync(unrelated), unrelatedBefore, 'a marker-less unrelated database is rejected before a migration journal is created');
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

    // Runtime metadata is itself durable state: opening a legacy database with
    // a newer binary must not silently rewrite it before identity adoption.
    const oldProductFile = path.join(directory, 'old-product.sqlite');
    let oldProduct = createProductWorkspace({file: oldProductFile, runtimeVersion: '0.7.0'});
    oldProduct.close();
    const oldProductDb = new DatabaseSync(oldProductFile);
    // Simulate a pre-host/workflow Product database. Mark it legacy and put
    // it back in rollback-journal mode; merely opening it must not add the
    // optional tables/indexes or rewrite the journal header.
    oldProductDb.exec('PRAGMA foreign_keys=OFF');
    for (const table of ['capability_trials', 'capability_orchestrations', 'publication_events', 'publication_policies', 'repository_guard_journal', 'repository_guard_receipts', 'repository_preflights', 'sensemaking_privacy_receipts', 'activation_events', 'activation_receipts', 'route_decisions', 'routing_proposals', 'sensemaking_jobs', 'host_workflow_commands', 'workflow_findings', 'host_control_commands', 'host_ingest_events', 'host_turns', 'host_sessions']) oldProductDb.exec(`DROP TABLE IF EXISTS ${table}`);
    oldProductDb.exec("UPDATE trace_runtime_identity SET runtime_version='0.7.0', workspace_id=NULL, installation_id=NULL, verification_state='legacy'; PRAGMA journal_mode=DELETE");
    oldProductDb.close();
    const oldProductBefore = fs.readFileSync(oldProductFile);
    oldProduct = createProductWorkspace({file: oldProductFile, runtimeVersion: '0.7.1'});
    assert.equal(oldProduct.identity.verification_state, 'legacy');
    assert.equal(oldProduct.identity.runtime_version, '0.7.0');
    assert.deepEqual(fs.readFileSync(oldProductFile), oldProductBefore, 'legacy Product startup must not migrate optional schema or switch WAL');
    assert.throws(() => oldProduct.hostSessions.attach({command_id: 'legacy-direct-attach', host: 'codex', session_id: 'legacy-direct'}), error => error?.code === 'LEGACY_IDENTITY_UNVERIFIED', 'direct host service writes must honor the legacy write lock');
    assert.throws(() => oldProduct.hostWorkflow.queryActivation({host: 'codex', session_id: 'legacy-direct'}), error => error?.code === 'LEGACY_IDENTITY_UNVERIFIED', 'direct workflow service writes must honor the legacy write lock');
    assert.deepEqual(fs.readFileSync(oldProductFile), oldProductBefore, 'blocked direct host writes must not alter the legacy database');
    const explicitlyUpgraded = oldProduct.upgradeIdentity({workspaceId: 'upgraded-workspace', installationId: 'upgraded-installation'});
    assert.equal(explicitlyUpgraded.verification_state, 'verified');
    assert.deepEqual(oldProduct.hostSessions.listSessions(), [], 'explicit identity upgrade must reopen the host schema that legacy startup left read-only');
    oldProduct.close();

    const oldProjectFile = path.join(directory, 'old-project.sqlite');
    let oldProject = new SqliteVersionedStore(oldProjectFile, 'records', {runtimeVersion: '0.7.0'});
    oldProject.append({record_id: 'legacy', revision: 1});
    oldProject.close();
    const oldProjectDb = openSqlite(oldProjectFile).db;
    oldProjectDb.exec("UPDATE trace_runtime_identity SET runtime_version='0.7.0', workspace_id=NULL, installation_id=NULL, verification_state='legacy'");
    oldProjectDb.exec('PRAGMA journal_mode=DELETE');
    oldProjectDb.close();
    const oldProjectBefore = fs.readFileSync(oldProjectFile);
    oldProject = new SqliteVersionedStore(oldProjectFile, 'records', {runtimeVersion: '0.7.1'});
    assert.equal(oldProject.identity.verification_state, 'legacy');
    assert.equal(oldProject.identity.runtime_version, '0.7.0');
    assert.deepEqual(fs.readFileSync(oldProjectFile), oldProjectBefore, 'legacy project startup must not switch WAL or rewrite runtime metadata');
    oldProject.close();
    const oldEventStore = new SqliteTraceEventStore(oldProjectFile);
    assert.throws(() => oldEventStore.byCorrelation('legacy-correlation'), error => error?.code === 'TRACE_EVENTS_UNAVAILABLE');
    oldEventStore.close();
    assert.deepEqual(fs.readFileSync(oldProjectFile), oldProjectBefore, 'legacy event-store startup must not create trace_events or switch WAL');

    // An explicit TraceRuntime upgrade must restore every store opened from a
    // legacy file, including an event store that was constructed read-only
    // before adoption.  Otherwise the identity row would say verified while
    // the first event write still failed on a missing trace_events table.
    const legacyRuntime = new TraceRuntime({sqliteStateFile: oldProjectFile, runtimeVersion: '0.7.1'});
    const runtimeIdentity = legacyRuntime.upgradeIdentity({workspaceId: 'runtime-upgraded-workspace', installationId: 'runtime-upgraded-installation'});
    assert.equal(runtimeIdentity.verification_state, 'verified');
    const event = legacyRuntime.recordTraceEvent({component: 'test', operation: 'legacy-upgrade', outcome: 'success', correlation_id: 'legacy-upgrade-correlation', causation_id: 'legacy-upgrade-causation'});
    assert.equal(legacyRuntime.listTraceEvents(event.correlation_id).length, 1);
    legacyRuntime.close();
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

    const oldAgentFile = path.join(directory, 'old-agent.sqlite');
    let oldAgent = createAgentStore({file: oldAgentFile, workspaceIdentity: identity, runtimeVersion: '0.7.0'});
    oldAgent.close();
    const oldAgentDb = new DatabaseSync(oldAgentFile);
    oldAgentDb.exec('PRAGMA foreign_keys=OFF; DROP TABLE sensemaking_events; DROP TABLE sensemaking_runs; UPDATE trace_runtime_identity SET runtime_version=\'0.7.0\', workspace_id=NULL, installation_id=NULL, verification_state=\'legacy\'; PRAGMA journal_mode=DELETE');
    oldAgentDb.close();
    const oldAgentBefore = fs.readFileSync(oldAgentFile);
    oldAgent = createAgentStore({file: oldAgentFile, workspaceIdentity: identity, runtimeVersion: '0.7.1'});
    assert.equal(oldAgent.identity.verification_state, 'legacy');
    assert.equal(oldAgent.identity.runtime_version, '0.7.0');
    assert.deepEqual(fs.readFileSync(oldAgentFile), oldAgentBefore, 'legacy Agent startup must not migrate sensemaking schema or switch WAL');
    assert.throws(() => oldAgent.findSensemaking('missing'), error => error?.code === 'AGENT_SENSEMAKING_UNAVAILABLE');
    const upgradedOldAgent = oldAgent.upgradeIdentity({workspaceId: identity.workspace_id, installationId: identity.installation_id});
    assert.equal(upgradedOldAgent.verification_state, 'verified');
    assert.equal(oldAgent.findSensemaking('missing'), null, 'explicit Agent identity upgrade must restore the missing sensemaking schema');
    oldAgent.close();
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

test('SQLite project reads and identity upgrades stop when a durable owner marker drifts', () => {
  const directory = temp('trace-identity-drift-');
  const file = path.join(directory, 'project.sqlite');
  try {
    const project = new SqliteVersionedStore(file, 'records');
    const original = project.identity;
    project.append({record_id: 'one', revision: 1});
    const external = openSqlite(file).db;
    try {
      external.prepare('UPDATE trace_runtime_identity SET workspace_id=?, installation_id=? WHERE id=1').run('other-workspace', 'other-installation');
    } finally { external.close(); }
    assert.throws(() => project.read('one'), error => error?.code === 'DATABASE_IDENTITY_CHANGED');
    assert.throws(() => project.latest(), error => error?.code === 'DATABASE_IDENTITY_CHANGED');
    assert.throws(() => project.append({record_id: 'two', revision: 1}), error => error?.code === 'DATABASE_IDENTITY_CHANGED');
    project.close();

    const restore = openSqlite(file).db;
    try {
      restore.prepare('UPDATE trace_runtime_identity SET workspace_id=?, installation_id=? WHERE id=1').run(original.workspace_id, original.installation_id);
    } finally { restore.close(); }
    const reopened = new SqliteVersionedStore(file, 'records', {workspaceId: original.workspace_id, installationId: original.installation_id});
    assert.equal(reopened.read('one')?.record_id, 'one');
    reopened.close();
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

test('Zhihu client pins a verified workspace across provider-port restarts', async () => {
  const envKeys = ['TRACE_WORKSPACE_ID', 'TRACE_INSTALLATION_ID', 'TRACE_EXPECTED_RUNTIME_VERSION'];
  const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  try {
    const calls = [];
    let current = serviceIdentity({api_surface: {
      runtime: ['/api/runtime/identity'], product: ['/api/product/workspace'],
      host: ['/api/product/host/findings'], search: ['/api/search/zhihu'],
    }});
    const client = new TraceZhihuClient('http://127.0.0.1:4173', {fetchImpl: async (url, options) => {
      calls.push({url: String(url), options});
      if (String(url).endsWith('/api/runtime/identity')) return new Response(JSON.stringify(current), {status: 200});
      return new Response(JSON.stringify({source: 'zhihu', items: []}), {status: 200});
    }});
    await client.search('zhihu', {query: 'identity'});
    current = serviceIdentity({workspace_id: 'workspace-restarted', installation_id: 'installation-restarted', api_surface: {
      runtime: ['/api/runtime/identity'], product: ['/api/product/workspace'],
      host: ['/api/product/host/findings'], search: ['/api/search/zhihu'],
    }});
    await assert.rejects(client.search('zhihu', {query: 'identity'}), error => error instanceof TraceProductClientError && error.code === 'IDENTITY_MISMATCH');
    assert.equal(calls.filter(item => item.url.endsWith('/api/search/zhihu')).length, 1, 'the mismatched provider must not receive the query');
  } finally {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
    }
  }
});

test('Product host client includes cwd for project binding but preserves personal attach', async () => {
  const calls = [];
  const identity = serviceIdentity({api_surface: {
    runtime: ['/api/runtime/identity'], product: ['/api/product/workspace'],
    host: ['/api/product/host/session/attach', '/api/product/host/finding'],
  }});
  const fetchImpl = async (url, options) => {
    calls.push({url: String(url), options});
    if (String(url).endsWith('/api/runtime/identity')) return new Response(JSON.stringify(identity), {status: 200});
    if (String(url).endsWith('/api/product/host/session/attach')) return new Response(JSON.stringify({session: {}}), {status: 200});
    return new Response(JSON.stringify({finding: {finding_id: 'finding-test'}}), {status: 200});
  };
  const client = new TraceProductClient({baseUrl: 'http://127.0.0.1:4173', sessionId: 'session-cwd', fetchImpl});
  await client.attachHostSession({projectDir: path.resolve(process.cwd())});
  await client.captureWorkflowFinding({observation: 'cwd is part of the binding'});
  const attachCall = calls.find(item => item.url.endsWith('/api/product/host/session/attach'));
  const findingCall = calls.find(item => item.url.endsWith('/api/product/host/finding'));
  const attachBody = JSON.parse(attachCall.options.body);
  const findingBody = JSON.parse(findingCall.options.body);
  assert.equal(attachBody.cwd, path.resolve(process.cwd()));
  assert.equal(findingBody.cwd, path.resolve(process.cwd()));

  const personalCalls = [];
  const personal = new TraceProductClient({baseUrl: 'http://127.0.0.1:4173', sessionId: 'session-personal', fetchImpl: async (url, options) => {
    personalCalls.push({url: String(url), options});
    if (String(url).endsWith('/api/runtime/identity')) return new Response(JSON.stringify(identity), {status: 200});
    return new Response(JSON.stringify({session: {}}), {status: 200});
  }});
  await personal.attachHostSession();
  const personalBody = JSON.parse(personalCalls.find(item => item.url.endsWith('/api/product/host/session/attach')).options.body);
  assert.equal(Object.hasOwn(personalBody, 'projectRef'), false);
  assert.equal(personalBody.cwd, path.resolve(process.cwd()), 'personal attach carries cwd only as a future re-attach proof, not as a project_ref');
});

test('browser Product entrypoint handshakes before reads/writes and pins verified identity', async () => {
  const source = fs.readFileSync(new URL('../apps/desktop/src/web-main.js', import.meta.url), 'utf8');
  assert.match(source, /import\s+\{\s*ensureRuntimeIdentity\s*\}\s+from ['"]\.\/product\/runtime-identity\.mjs['"]/);
  assert.match(source, /async function read\(\)\{await ensureRuntimeIdentity\('\/api\/product\/workspace'\)/);
  assert.match(source, /try\{await ensureRuntimeIdentity\('\/api\/product\/commands'\)/);
  assert.match(source, /async function exportWorkspace\(\)\{\s*await ensureRuntimeIdentity\('\/api\/web\/export'\)/);
  const agentSource = fs.readFileSync(new URL('../apps/desktop/src/product/agent-panel.mjs', import.meta.url), 'utf8');
  assert.match(agentSource, /async function follow\(id\)\s*\{\s*const eventPath=[\s\S]*?await ensureRuntimeIdentity\(eventPath\)/);

  const moduleUrl = new URL('../apps/desktop/src/product/runtime-identity.mjs', import.meta.url);
  moduleUrl.search = `?identity-test=${Date.now()}-${Math.random()}`;
  const browserIdentity = await import(moduleUrl.href);
  const originalFetch = globalThis.fetch;
  const calls = [];
  let current = serviceIdentity({api_surface: {runtime: ['/api/runtime/identity'], product: ['/api/product/workspace']}});
  globalThis.fetch = async (url, options) => {
    calls.push({url: String(url), options});
    return String(url).endsWith('/api/runtime/identity')
      ? new Response(JSON.stringify(current), {status: 200})
      : new Response(JSON.stringify({revision: 0, writeMode: 'product-commands'}), {status: 200});
  };
  try {
    await browserIdentity.ensureRuntimeIdentity('/api/product/workspace');
    current = serviceIdentity({workspace_id: 'workspace-restarted', installation_id: 'installation-restarted', api_surface: {runtime: ['/api/runtime/identity'], product: ['/api/product/workspace']}});
    await assert.rejects(browserIdentity.ensureRuntimeIdentity('/api/product/workspace'), error => error?.code === 'IDENTITY_MISMATCH');
    assert.equal(calls.filter(item => item.url.endsWith('/api/product/workspace')).length, 0, 'identity mismatch must stop before the Product request');
  } finally { globalThis.fetch = originalFetch; }
});

test('browser identity handshake maps malformed responses and transport failures to structured errors', async () => {
  const moduleUrl = new URL('../apps/desktop/src/product/runtime-identity.mjs', import.meta.url);
  moduleUrl.search = `?handshake-errors=${Date.now()}-${Math.random()}`;
  const browserIdentity = await import(moduleUrl.href);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{not-json', {status: 200});
    await assert.rejects(browserIdentity.ensureRuntimeIdentity('/api/product/workspace'), error => error?.code === 'SERVICE_IDENTITY_INVALID');
    globalThis.fetch = async () => { throw new TypeError('connection reset'); };
    await assert.rejects(browserIdentity.ensureRuntimeIdentity('/api/product/workspace'), error => error?.code === 'SERVICE_HANDSHAKE_UNAVAILABLE');
  } finally { globalThis.fetch = originalFetch; }
});
