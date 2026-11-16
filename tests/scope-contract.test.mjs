import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createProductWorkspace} from '../packages/product/workspace/src/workspace.mjs';
import {SCOPE_CONTRACT_MIGRATION_ID, SCOPE_CONTRACT_VERSION, SCOPE_CONTRACT_PROTOCOL_ID, validateScopeContract, upcastLegacyScope} from '../packages/product/workspace/src/scope-contract.mjs';

function temporary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-scope-contract-'));
  return {dir, file: path.join(dir, 'web.sqlite')};
}

function cleanup({dir, store}) {
  store?.close();
  fs.rmSync(dir, {recursive: true, force: true, maxRetries: 5, retryDelay: 25});
}

function attachTurn(store, sessionId, projectRef) {
  store.hostSessions.attach({host: 'codex', sessionId, commandId: `attach-${sessionId}`, projectRef});
  store.hostSessions.ingestEvent({host: 'codex', sessionId, turnId: `turn-${sessionId}`, hook_event_name: 'UserPromptSubmit', prompt: 'scope contract fixture'});
  return `turn-${sessionId}`;
}

function explicitContract({sessionId, turnId, projectRef, contentKind, ownerKind, ownerId, discoveryMode, discoveryProjects = [], activationMode, activationProjects = [], classification, projectLinks = []}) {
  return validateScopeContract({
    protocol_id: SCOPE_CONTRACT_PROTOCOL_ID,
    protocol_version: SCOPE_CONTRACT_VERSION,
    owner: {kind: ownerKind, id: ownerId, certainty: 'confirmed'},
    source_provenance: {
      surface: 'codex-host', source_id: `host:codex:session:${sessionId}`, project_refs: [projectRef],
      source_refs: [{type: 'host-turn', host: 'codex', session_id: sessionId, turn_id: turnId}],
    },
    attachment_context: {host: 'codex', session_id: sessionId, turn_id: turnId, project_ref: projectRef, task_id: null},
    content_scope: {kind: contentKind, project_ref: contentKind === 'project' ? projectRef : null, certainty: 'confirmed'},
    project_links: projectLinks,
    discovery_policy: {mode: discoveryMode, project_refs: discoveryProjects, certainty: 'confirmed'},
    activation_policy: {mode: activationMode, project_refs: activationProjects, requires_adoption: true, certainty: 'confirmed'},
    classification: {level: classification, certainty: 'confirmed'},
    lifecycle: {status: 'captured', certainty: 'confirmed'},
  });
}

function captureAndAdopt(store, input, commandSuffix) {
  const captured = store.hostSessions.captureWorkflowFinding(input);
  const proposal = store.hostWorkflow.createRoutingProposal({findingId: captured.finding.finding_id, commandId: `propose-${commandSuffix}`});
  const adopted = store.hostWorkflow.decideRouting({proposalId: proposal.proposal_id, action: 'adopt', expectedRevision: 0, commandId: `adopt-${commandSuffix}`});
  return {captured, proposal, adopted};
}

test('项目 A 中产生的个人判断保留项目来源，并可在用户明确跨项目激活后回带', () => {
  const fixture = temporary(); const store = createProductWorkspace({file: fixture.file});
  try {
    const turnId = attachTurn(store, 'personal-a', 'project-A');
    const contract = explicitContract({sessionId: 'personal-a', turnId, projectRef: 'project-A', contentKind: 'personal', ownerKind: 'person', ownerId: 'person:local', discoveryMode: 'personal', activationMode: 'cross-project', classification: 'private', projectLinks: [{project_ref: 'project-A', relation: 'source'}]});
    const result = captureAndAdopt(store, {host: 'codex', sessionId: 'personal-a', turnId, commandId: 'finding-personal-a', observation: '这是我的可复用判断', desiredBehavior: '在其他项目也先检查这个判断', scope_contract: contract}, 'personal-a');
    assert.equal(result.captured.finding.scope, 'unknown');
    assert.equal(result.captured.finding.scope_contract.owner.kind, 'person');
    assert.equal(result.captured.finding.scope_contract.content_scope.kind, 'personal');
    assert.deepEqual(result.captured.finding.scope_contract.project_links, [{project_ref: 'project-A', relation: 'source'}]);
    assert.equal(result.proposal.scope, 'cross-project');
    attachTurn(store, 'personal-b', 'project-B');
    const activation = store.hostWorkflow.queryActivation({host: 'codex', sessionId: 'personal-b', projectRef: 'project-B'});
    assert.equal(activation.items.length, 1);
    assert.equal(activation.items[0].scope_contract.content_scope.kind, 'personal');
  } finally { cleanup({...fixture, store}); }
});

test('项目 A 私有事实只在当前项目可发现，不能因为个人拥有而回带到项目 B', () => {
  const fixture = temporary(); const store = createProductWorkspace({file: fixture.file});
  try {
    const turnId = attachTurn(store, 'private-a', 'project-A');
    const contract = explicitContract({sessionId: 'private-a', turnId, projectRef: 'project-A', contentKind: 'project', ownerKind: 'project', ownerId: 'project-A', discoveryMode: 'current-project', discoveryProjects: ['project-A'], activationMode: 'project', activationProjects: ['project-A'], classification: 'project-internal', projectLinks: [{project_ref: 'project-A', relation: 'source'}]});
    const result = captureAndAdopt(store, {host: 'codex', sessionId: 'private-a', turnId, commandId: 'finding-private-a', observation: '项目 A 的私有部署事实', desiredBehavior: '只在 A 内使用', scope_contract: contract}, 'private-a');
    assert.equal(result.proposal.scope, 'project');
    assert.equal(store.hostWorkflow.queryActivation({host: 'codex', sessionId: 'private-a', projectRef: 'project-A'}).items.length, 1);
    attachTurn(store, 'private-b', 'project-B');
    assert.equal(store.hostWorkflow.queryActivation({host: 'codex', sessionId: 'private-b', projectRef: 'project-B'}).items.length, 0);
  } finally { cleanup({...fixture, store}); }
});

test('一条个人判断可以关联多个项目，但激活策略仍可限制为明确的项目集合', () => {
  const fixture = temporary(); const store = createProductWorkspace({file: fixture.file});
  try {
    const turnId = attachTurn(store, 'linked-a', 'project-A');
    const contract = explicitContract({sessionId: 'linked-a', turnId, projectRef: 'project-A', contentKind: 'personal', ownerKind: 'person', ownerId: 'person:local', discoveryMode: 'explicit-projects', discoveryProjects: ['project-A', 'project-B'], activationMode: 'selected-projects', activationProjects: ['project-A', 'project-B'], classification: 'internal', projectLinks: [{project_ref: 'project-A', relation: 'source'}, {project_ref: 'project-B', relation: 'applicable'}]});
    captureAndAdopt(store, {host: 'codex', sessionId: 'linked-a', turnId, commandId: 'finding-linked', observation: '跨两个项目都适用的个人判断', desiredBehavior: '在 A 和 B 中验证', scope_contract: contract}, 'linked');
    attachTurn(store, 'linked-b', 'project-B'); attachTurn(store, 'linked-c', 'project-C');
    assert.equal(store.hostWorkflow.queryActivation({host: 'codex', sessionId: 'linked-b', projectRef: 'project-B'}).items.length, 1);
    assert.equal(store.hostWorkflow.queryActivation({host: 'codex', sessionId: 'linked-c', projectRef: 'project-C'}).items.length, 0);
  } finally { cleanup({...fixture, store}); }
});

test('旧 scope 保守 upcast，保留来源但不伪造 owner/classification/跨项目激活；web.sqlite 只追加迁移记录', () => {
  for (const scope of ['personal', 'project', 'team', 'domain']) {
    const contract = upcastLegacyScope({scope, project_ref: 'project-A', host: 'codex', session_id: 'legacy-session', turn_id: 'legacy-turn'});
    assert.equal(contract.legacy.upcasted, true);
    assert.equal(contract.owner.kind, 'unknown');
    assert.equal(contract.classification.level, 'unknown');
    assert.equal(contract.activation_policy.requires_adoption, true);
    assert.equal(contract.legacy.scope, scope);
    if (scope === 'project') assert.deepEqual(contract.project_links, [{project_ref: 'project-A', relation: 'source'}]);
    else assert.deepEqual(contract.project_links, []);
  }

  const fixture = temporary(); const store = createProductWorkspace({file: fixture.file});
  try {
    const db = new DatabaseSync(fixture.file, {readOnly: true});
    try {
      const migration = db.prepare('SELECT migration_id,component,version,details_json FROM trace_schema_migrations WHERE migration_id=?').get(SCOPE_CONTRACT_MIGRATION_ID);
      assert.equal(migration.component, 'product-workspace');
      assert.equal(migration.version, 1);
      assert.equal(JSON.parse(migration.details_json).additive, true);
      assert.equal(db.prepare("SELECT name FROM pragma_table_info('workflow_findings') WHERE name='scope_contract_json'").get().name, 'scope_contract_json');
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    } finally { db.close(); }
  } finally { cleanup({...fixture, store}); }
});

