import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createBridge, captureInput, createWorkFromHandoff, dispatchWorksite, selectChain, selectWorksite } from '../packages/product/workspace/src/bridge.mjs';
import { receiveCodexContext, returnCodexResult } from '../packages/product/workspace/src/codex-bridge.mjs';

const projectDir = path.resolve(process.cwd());

function seededHost() {
  let host = captureInput(createBridge(), { matterId: 'matter-delivery', text: 'delivery consistency' });
  host = createWorkFromHandoff(host, {
    matterId: 'matter-delivery', workId: 'work-delivery',
    destination: { agent: 'Codex', project: path.basename(projectDir), task: 'delivery contract' },
    selectedText: 'delivery consistency', role: 'trial',
  });
  assert.equal(host.error, null);
  return host;
}

test('handoff snapshot is historical while worksite connection carries received/returned/revised delivery state', () => {
  let host = seededHost();
  const snapshot = selectChain(host, 'matter-delivery').handoffSnapshot;
  assert.equal(snapshot.historical, true);
  assert.equal(snapshot.snapshotKind, 'historical');
  assert.equal(Object.hasOwn(snapshot, 'actualDelivery'), false);
  assert.equal(selectWorksite(host, 'work-delivery').work.connection, undefined);

  // A state created by an earlier build may still have the old delivery flag;
  // receiving the real bridge context migrates it before exposing the state.
  const chainSession = host.chain.sessions['matter-delivery'];
  chainSession.handoffSnapshot = {...chainSession.handoffSnapshot, actualDelivery: false, origin: 'prototype-confirmation'};
  chainSession.handoffHistory = [{...chainSession.handoffSnapshot}];

  const delivered = receiveCodexContext(host, {
    protocolVersion: 1, commandId: 'delivery-receive', workId: 'work-delivery',
    sessionId: 'codex-delivery-session', projectDir,
  }, { deliveryId: 'delivery-1', now: '2026-09-22T00:00:00.000Z' });
  host = delivered.host;
  assert.equal(host.worksite.works['work-delivery'].connection.status, 'received');
  assert.equal(selectChain(host, 'matter-delivery').handoffSnapshot.historical, true);
  assert.equal(Object.hasOwn(selectChain(host, 'matter-delivery').handoffSnapshot, 'actualDelivery'), false);

  const returned = returnCodexResult(host, {
    protocolVersion: 1, commandId: 'delivery-return', workId: 'work-delivery',
    sessionId: 'codex-delivery-session', projectDir, deliveryId: 'delivery-1', contextHash: delivered.receipt.contextHash,
    result: { matterId: 'matter-delivery', fact: 'returned fact', proposedUnderstanding: 'revised understanding', artifacts: [] },
  }, { returnId: 'return-1', now: '2026-09-22T00:01:00.000Z' });
  host = returned.host;
  assert.equal(host.worksite.works['work-delivery'].connection.status, 'returned_for_review');

  host = dispatchWorksite(host, { workId: 'work-delivery', action: { type: 'OPEN_REVISION_REVIEW' } });
  assert.equal(host.error, null);
  host = dispatchWorksite(host, { workId: 'work-delivery', action: { type: 'CONFIRM_REVISION' } });
  assert.equal(host.error, null);
  assert.equal(host.worksite.works['work-delivery'].connection.status, 'revised');
  assert.equal(host.worksite.sessions['work-delivery'].codexDelivery.status, 'revised');
});
