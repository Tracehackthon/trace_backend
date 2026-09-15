import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridge, captureInput, dispatchChain, selectChain, openComparison, dispatchComparison,
  selectComparison, applyPendingComparison, deliverComparisonResult, commitComparison, returnFromComparison,
  createWorkFromHandoff, dispatchWorksite, selectWorksite, selectComparisonAnchor, recoverPendingComparisons } from '../src/product/bridge.mjs';

const ID = 'user:matter-42';
const ORIGINAL = '收藏后为什么接不回当时的问题？';
const BEFORE = '开头保留。收藏时必须写附言。结尾保留。';
const SELECTED = '收藏时必须写附言。';
const AFTER = '附言只是恢复当时问题的一种方式。';
const cd = (h, type, fields = {}, matterId = ID) => dispatchChain(h, { matterId, action: { type, ...fields } });
const xd = (h, type, fields = {}, sessionId = 'cmp:1') => dispatchComparison(h, { sessionId, action: { type, ...fields } });
const wd = (h, type, fields = {}, workId = 'work:1') => dispatchWorksite(h, { workId, action: { type, ...fields } });
const current = h => selectChain(h, ID).matter;
function captured() { return captureInput(createBridge(), { matterId: ID, text: ORIGINAL }); }
function saved() {
  let h = captured();
  h = cd(h, 'UNDERSTANDING_DRAFT', { text: BEFORE });
  h = cd(h, 'SAVE_UNDERSTANDING');
  h = cd(h, 'STOP_DRAFT', { text: '还需要哪些条件？' });
  return h;
}
function comparison(h = saved(), sessionId = 'cmp:1') {
  const start = BEFORE.indexOf(SELECTED);
  const anchor = { field: 'understanding', expressionId: `${ID}:understanding`, start, end: start + SELECTED.length,
    text: SELECTED, baseVersion: 1 };
  return openComparison(h, { sessionId, matterId: ID, anchor,
    returnTarget: { view: 'chain', matterId: ID, screen: 'understanding', anchor, contextMode: 'resume',
      query: '收藏', filter: 'all', resultId: 'quote:42', scrollAnchor: { objectId: `${ID}:understanding`, offsetY: 60 } } });
}
function imported(h = comparison()) {
  return xd(h, 'IMPORT_MATERIAL', { material: { title: '我实际带来的材料', excerpt: '有时回到原问题也能恢复思考。', context: '我的观察；尚未验证普遍性。', url: null } });
}
function reviseRequest(h = imported()) {
  h = xd(h, 'OPEN_REVISION');
  h = xd(h, 'REVISION_DRAFT', { text: AFTER });
  return xd(h, 'CONFIRM_REVISION');
}
function ids(h, sessionId = 'cmp:1') { return { sessionId, requestId: selectComparison(h, sessionId).request?.id }; }
function work(h = saved(), workId = 'work:1') {
  return createWorkFromHandoff(h, { matterId: ID, workId, destination: { agent: 'Codex', project: 'fixture-project', task: '一次隔离试用' }, role: 'trial' });
}
function workReview(h = work()) {
  h = wd(h, 'RESULT_DRAFT', { patch: { matterId: ID, fact: '实际找到了昨天的问题。', interpretation: '可能与问题线索有关。',
    unconfirmed: '还未验证更长间隔。', proposedUnderstanding: '问题线索可能帮助恢复，但仍需分情形验证。', relation: 'limit' } });
  return wd(h, 'OPEN_REVISION_REVIEW');
}

test('closed loop calls existing chain/compare reducers: one ID, link is not adoption, receipt, exact return anchor', () => {
  let h = captured();
  assert.equal(current(h).id, ID);
  assert.equal(current(h).originalText, ORIGINAL);
  assert.equal(current(h).understanding, '');
  assert.equal(h.chain.sources.length, 0);
  // This is an explicit user save, not an adapter-generated understanding.
  h = cd(h, 'UNDERSTANDING_DRAFT', { text: BEFORE });
  assert.equal(current(h).understanding, '');
  h = cd(h, 'SAVE_UNDERSTANDING');
  h = comparison(h);
  assert.deepEqual(selectComparison(h, 'cmp:1').candidates, []);
  h = imported(h);
  const sourceId = selectComparison(h, 'cmp:1').selectedId;
  assert.equal(current(h).sources.length, 0);
  assert.equal(h.chain.sources.length, 1);
  h = xd(h, 'LINK');
  assert.equal(current(h).understandingVersion, 1);
  assert.equal(selectComparison(h, 'cmp:1').receipt, null);
  h = commitComparison(h, ids(h));
  assert.equal(current(h).understanding, BEFORE);
  assert.equal(current(h).understandingVersion, 1);
  assert.equal(current(h).observations[0].sourceId, sourceId);
  assert.equal(selectComparison(h, 'cmp:1').screen, 'compare');
  h = reviseRequest(h);
  assert.equal(current(h).understanding, BEFORE);
  assert.equal(selectComparison(h, 'cmp:1').screen, 'compare');
  h = commitComparison(h, ids(h));
  assert.equal(selectComparison(h, 'cmp:1').screen, 'returned');
  assert.equal(current(h).understanding, BEFORE.replace(SELECTED, AFTER));
  assert.equal(current(h).understandingVersion, 2);
  h = returnFromComparison(h, 'cmp:1');
  assert.equal(h.route.matterId, ID);
  assert.equal(h.route.anchor.text, AFTER);
  assert.equal(h.route.anchor.baseVersion, 2);
  assert.equal(h.route.query, '收藏');
  assert.equal(h.route.resultId, 'quote:42');
  assert.equal(h.route.scrollAnchor.offsetY, 60);
  assert.equal(selectChain(h, ID).focus.text, AFTER);
  assert.equal(h.chain.matters.length, 1);
});

test('original/discussion basis opens directly without promoting any expression into understanding', () => {
  let h = captured();
  h = cd(h, 'COMPOSER_DRAFT', { text: '我的讨论表达' });
  h = cd(h, 'SEND');
  for (const field of ['originalText', 'discussion']) {
    const opened = openComparison(h, { sessionId: 'original', matterId: ID, anchor: selectComparisonAnchor(h, ID, { field }) });
    assert.equal(opened.error, null);
    assert.equal(current(opened).understanding, '');
    assert.equal(current(opened).understandingVersion, 0);
    assert.equal(selectComparison(opened, 'original').matter.basis.field, field);
    assert.equal(selectComparison(opened, 'original').matter.understanding, '');
    assert.deepEqual(opened.chain, h.chain);
  }
});

function originalComparison(h = captured()) {
  return openComparison(h, { sessionId: 'cmp:1', matterId: ID,
    anchor: selectComparisonAnchor(h, ID, { field: 'originalText' }),
    returnTarget: { view: 'chain', matterId: ID, screen: 'resume', contextMode: 'resume', query: '收藏' } });
}

test('original expression → pasted material → LINK → original anchor, understanding remains empty', () => {
  let h = imported(originalComparison());
  h = xd(h, 'LINK');
  assert.equal(selectComparison(h, 'cmp:1').request.target.field, 'originalText');
  h = commitComparison(h, ids(h));
  assert.equal(h.error, null);
  assert.equal(current(h).understanding, '');
  assert.equal(current(h).understandingVersion, 0);
  assert.equal(current(h).observations[0].target.field, 'originalText');
  h = returnFromComparison(h, 'cmp:1');
  assert.equal(h.route.anchor.field, 'originalText');
  assert.equal(h.route.anchor.text, ORIGINAL);
  assert.equal(h.route.query, '收藏');
  assert.equal(selectChain(h, ID).focus.text, ORIGINAL);
});

test('original basis explicitly creates understanding only after persist/ACK split; original return survives', () => {
  let h = imported(originalComparison());
  h = xd(h, 'OPEN_REVISION');
  assert.equal(selectComparison(h, 'cmp:1').revision.mode, 'create');
  assert.equal(selectComparison(h, 'cmp:1').revision.before, '');
  assert.equal(selectComparison(h, 'cmp:1').revision.draft, '');
  h = xd(h, 'REVISION_DRAFT', { text: '我现在愿意留下的理解' });
  h = xd(h, 'CONFIRM_REVISION');
  assert.equal(selectComparison(h, 'cmp:1').request.kind, 'create');
  assert.equal(current(h).understanding, '');
  const request = ids(h), applied = applyPendingComparison(h, request);
  assert.equal(applied.outcome.ok, true);
  assert.equal(current(applied.host).understanding, '我现在愿意留下的理解');
  assert.equal(selectComparison(applied.host, 'cmp:1').screen, 'compare');
  h = deliverComparisonResult(applied.host, { ...request, outcome: applied.outcome });
  assert.equal(selectComparison(h, 'cmp:1').receipt.kind, 'create');
  assert.equal(selectComparison(h, 'cmp:1').screen, 'returned');
  assert.equal(current(h).originalText, ORIGINAL);
  h = returnFromComparison(h, 'cmp:1');
  assert.equal(h.route.anchor.field, 'originalText');
  assert.equal(h.route.anchor.text, ORIGINAL);
  assert.equal(h.route.currentUnderstandingVersion, 1);
});

test('creation can be undone without deleting original input, source or link; version remains monotonic', () => {
  let h = reviseRequest(imported(originalComparison()));
  h = commitComparison(h, ids(h));
  h = xd(h, 'UNDO_REVISION');
  h = commitComparison(h, ids(h));
  assert.equal(h.error, null);
  assert.equal(current(h).understanding, '');
  assert.equal(current(h).understandingVersion, 2);
  assert.equal(current(h).originalText, ORIGINAL);
  assert.equal(current(h).sources.length, 1);
  assert.equal(current(h).observations.length, 1);
});

test('stale creation is refused after another surface has already saved an understanding', () => {
  let h = reviseRequest(imported(originalComparison()));
  h = cd(h, 'UNDERSTANDING_DRAFT', { text: '别处先保存的理解' });
  h = cd(h, 'SAVE_UNDERSTANDING');
  h = commitComparison(h, ids(h));
  assert.equal(h.error.code, 'version_conflict');
  assert.equal(current(h).understanding, '别处先保存的理解');
  assert.equal(selectComparison(h, 'cmp:1').revision.draft, AFTER);
});

test('original link is independent of understanding/draft versions; changing original content makes it stale', () => {
  let h = imported(originalComparison());
  h = xd(h, 'LINK');
  h = cd(h, 'UNDERSTANDING_DRAFT', { text: '一个尚未保存的草稿' });
  h = commitComparison(h, ids(h));
  assert.equal(h.error, null);
  assert.equal(current(h).understanding, '');
  assert.equal(current(h).understandingDraft, '一个尚未保存的草稿');
  let stale = imported(originalComparison());
  stale = xd(stale, 'LINK');
  stale.chain.matters[0].originalTextVersion++;
  stale = commitComparison(stale, ids(stale));
  assert.equal(stale.error.code, 'basis_conflict');
  assert.equal(current(stale).sources.length, 0);
});

test('original basis with existing understanding requires explicit understanding target, not original offsets', () => {
  let h = imported(originalComparison(saved()));
  h = xd(h, 'OPEN_REVISION');
  assert.equal(selectComparison(h, 'cmp:1').revision.open, false);
  const start = BEFORE.indexOf(SELECTED);
  h = xd(h, 'OPEN_REVISION', { target: { field: 'understanding', start, end: start + SELECTED.length, text: SELECTED } });
  assert.equal(selectComparison(h, 'cmp:1').revision.mode, 'replace');
  h = xd(h, 'REVISION_DRAFT', { text: AFTER });
  h = xd(h, 'CONFIRM_REVISION');
  h = commitComparison(h, ids(h));
  assert.equal(h.error, null);
  assert.equal(current(h).understanding, BEFORE.replace(SELECTED, AFTER));
  assert.equal(current(h).originalText, ORIGINAL);
});

test('discussion message basis links exact message ID and returns there without using combined offsets', () => {
  let h = captured();
  h = cd(h, 'COMPOSER_DRAFT', { text: '第一条消息' }); h = cd(h, 'SEND');
  h = cd(h, 'COMPOSER_DRAFT', { text: '第二条消息的独立表达' }); h = cd(h, 'SEND');
  const messageId = selectChain(h, ID).discussion.messages[1].id;
  const anchor = selectComparisonAnchor(h, ID, { field: 'discussion', objectId: messageId, start: 0, end: 5 });
  h = openComparison(h, { matterId: ID, sessionId: 'cmp:1', anchor });
  h = imported(h); h = xd(h, 'LINK'); h = commitComparison(h, ids(h));
  assert.equal(h.error, null);
  h = returnFromComparison(h, 'cmp:1');
  assert.equal(h.route.anchor.objectId, messageId);
  assert.equal(selectChain(h, ID).focus.objectId, messageId);
  assert.equal(current(h).understanding, '');
});

test('new matters have no hardcoded destination and empty handoff cannot create a pretend work', () => {
  const h = captured();
  assert.deepEqual(selectChain(h, ID).handoff.destination, { agent: '', project: '', task: '' });
  assert.equal(createWorkFromHandoff(h, { matterId: ID, workId: 'w' }).error.code, 'invalid_destination');
  const explicit = createWorkFromHandoff(h, { matterId: ID, workId: 'w', destination: { agent: '我的编辑器', project: '我的项目', task: '一项具体工作' }, selectedText: ORIGINAL });
  assert.equal(explicit.error, null);
  assert.equal(selectWorksite(explicit, 'w').intake[0].sourceText, ORIGINAL);
  assert.equal(selectWorksite(explicit, 'w').work.connected, false);
  assert.equal(selectChain(explicit, ID).handoffSnapshot.actualDelivery, false);
});

test('same literal first-line title is projected consistently without inventing a summary', () => {
  let h = captureInput(createBridge(), { matterId: ID, text: '用户自己的第一行\n第二行仍保留' });
  const expected = '用户自己的第一行';
  assert.equal(selectChain(h, ID).matter.title, expected);
  assert.equal(selectChain(h, ID).matters[0].title, expected);
  h = openComparison(h, { matterId: ID, sessionId: 'title-comparison' });
  assert.equal(selectComparison(h, 'title-comparison').matter.title, expected);
  h = createWorkFromHandoff(h, { matterId: ID, workId: 'title-work', destination: { agent: 'Agent', project: 'Project', task: 'Task' }, selectedText: '明确选择的带入原话' });
  assert.equal(selectWorksite(h, 'title-work').matters[0].title, expected);
  assert.equal(selectWorksite(h, 'title-work').intake[0].title, expected);
  assert.equal(h.chain.matters[0].title, ''); // Display fallback, not an invented saved title.
});

test('a foreign expression identity cannot be used as this matter’s anchor', () => {
  const h = captured();
  const anchor = selectComparisonAnchor(h, ID, { field: 'originalText' });
  const attempted = openComparison(h, { matterId: ID, sessionId: 'wrong-anchor', anchor: { ...anchor, objectId: 'another:original' } });
  assert.equal(attempted.error.code, 'unsupported_basis');
  assert.deepEqual(attempted.chain, h.chain);
});

test('reload after committed LINK or create but before ACK is recovered from ledger without another mutation', () => {
  for (const kind of ['link', 'create']) {
    let h = imported(originalComparison());
    h = kind === 'link' ? xd(h, 'LINK') : reviseRequest(h);
    const applied = applyPendingComparison(h, ids(h));
    assert.equal(applied.outcome.ok, true);
    // This is precisely the first persisted payload in web-main comparisonAction.
    const reloaded = JSON.parse(JSON.stringify(applied.host));
    assert.equal(selectComparison(reloaded, 'cmp:1').pending, true);
    assert.equal(returnFromComparison(reloaded, 'cmp:1').error.code, 'pending_request');
    const recovered = recoverPendingComparisons(reloaded);
    assert.equal(selectComparison(recovered, 'cmp:1').pending, false);
    assert.equal(selectComparison(recovered, 'cmp:1').receipt.kind, kind);
    assert.equal(selectComparison(recovered, 'cmp:1').screen, kind === 'create' ? 'returned' : 'compare');
    assert.deepEqual(recovered.chain, reloaded.chain);
    assert.deepEqual(recoverPendingComparisons(recovered), recovered);
    assert.equal(returnFromComparison(recovered, 'cmp:1').error, null);
  }
});

test('uncommitted pending request on load is not executed; draft remains editable and no success is claimed', () => {
  const h = reviseRequest(imported(originalComparison()));
  const recovered = recoverPendingComparisons(JSON.parse(JSON.stringify(h)));
  assert.equal(recovered.error.code, 'interrupted_uncommitted_request');
  assert.equal(selectComparison(recovered, 'cmp:1').pending, false);
  assert.equal(selectComparison(recovered, 'cmp:1').revision.draft, AFTER);
  assert.equal(selectComparison(recovered, 'cmp:1').receipt, null);
  assert.deepEqual(recovered.chain, h.chain);
});

test('late committed creation receipt on load cannot overwrite newer understanding or claim returned success', () => {
  let h = reviseRequest(imported(originalComparison()));
  h = applyPendingComparison(h, ids(h)).host;
  h = cd(h, 'UNDERSTANDING_DRAFT', { text: '确认后更晚写的新理解' });
  h = cd(h, 'SAVE_UNDERSTANDING');
  const recovered = recoverPendingComparisons(JSON.parse(JSON.stringify(h)));
  assert.equal(recovered.error.code, 'superseded_committed_request');
  assert.equal(selectComparison(recovered, 'cmp:1').pending, false);
  assert.equal(selectComparison(recovered, 'cmp:1').screen, 'compare');
  assert.deepEqual(recovered.chain, h.chain);
  assert.equal(current(recovered).understanding, '确认后更晚写的新理解');
});

test('recovering an original-basis LINK keeps the later understanding while acknowledging only the historical link', () => {
  let h = xd(imported(originalComparison()), 'LINK');
  h = applyPendingComparison(h, ids(h)).host;
  h = cd(h, 'UNDERSTANDING_DRAFT', { text: '关联之后形成的个人理解' });
  h = cd(h, 'SAVE_UNDERSTANDING');
  const recovered = recoverPendingComparisons(h);
  assert.equal(selectComparison(recovered, 'cmp:1').pending, false);
  assert.equal(selectComparison(recovered, 'cmp:1').receipt.kind, 'link');
  assert.equal(selectComparison(recovered, 'cmp:1').screen, 'compare');
  assert.deepEqual(recovered.chain, h.chain);
  assert.equal(current(recovered).understanding, '关联之后形成的个人理解');
});

test('tampered pending request cannot borrow a persisted receipt during recovery', () => {
  let h = reviseRequest(imported(originalComparison()));
  h = applyPendingComparison(h, ids(h)).host;
  h.comparisons['cmp:1'].model.request.after = '伪造请求正文';
  const recovered = recoverPendingComparisons(h);
  assert.equal(recovered.error.code, 'request_id_collision');
  assert.equal(selectComparison(recovered, 'cmp:1').receipt, null);
  assert.equal(selectComparison(recovered, 'cmp:1').pending, false);
  assert.deepEqual(recovered.chain, h.chain);
});

test('work TRY_AGAIN resets edited old handoff and confirms next work against latest understanding', () => {
  let h = createWorkFromHandoff(saved(), { matterId: ID, workId: 'work:1', destination: { agent: 'Agent', project: 'Project', task: 'Task' }, selectedText: '第一次明确选的旧文' });
  const first = selectWorksite(h, 'work:1').intake[0];
  h = workReview(h); h = wd(h, 'CONFIRM_REVISION');
  assert.equal(current(h).understandingVersion, 2);
  // Before the integration fix, TRY_AGAIN kept confirmed:true + selectionEdited:true.
  h = wd(h, 'TRY_AGAIN');
  const handoff = selectChain(h, ID).handoff;
  assert.equal(handoff.confirmed, false);
  assert.equal(handoff.selectedText, current(h).understanding);
  assert.equal(handoff.understandingVersion, 2);
  assert.equal(selectChain(h, ID).handoffSnapshot, null);
  assert.equal(selectChain(h, ID).handoffHistory[0].selectedText, first.sourceText);
  h = createWorkFromHandoff(h, { matterId: ID, workId: 'work:2', destination: handoff.destination, role: handoff.role, note: handoff.note });
  assert.equal(selectWorksite(h, 'work:2').intake[0].sourceVersion, 2);
  assert.equal(selectWorksite(h, 'work:2').intake[0].sourceText, current(h).understanding);
  assert.equal(selectWorksite(h, 'work:1').intake[0].sourceText, '第一次明确选的旧文');
});

test('fresh discussion → comparison → return does not restore old understanding or start another fresh epoch', () => {
  let h = saved();
  h = cd(h, 'FRESH_CONTEXT');
  h = cd(h, 'COMPOSER_DRAFT', { text: '只带这次新的表达' }); h = cd(h, 'SEND');
  const epoch = h.chain.sessions[ID].contextEpoch;
  h = openComparison(h, { sessionId: 'cmp:1', matterId: ID, anchor: selectComparisonAnchor(h, ID, { field: 'discussion' }),
    returnTarget: { view: 'chain', matterId: ID, screen: 'discussion', contextMode: 'fresh' } });
  h = imported(h); h = xd(h, 'LINK'); h = commitComparison(h, ids(h));
  h = returnFromComparison(h, 'cmp:1');
  assert.equal(selectChain(h, ID).contextMode, 'fresh');
  assert.equal(h.chain.sessions[ID].contextEpoch, epoch);
  assert.equal(selectChain(h, ID).context.understanding, '');
  assert.deepEqual(selectChain(h, ID).context.sources, []);
  assert.equal(current(h).understanding, BEFORE); // Historical record exists, not used as fresh context.
});

test('empty captures/saves, duplicate IDs, missing sources, and unknown matters never mutate facts', () => {
  let h = createBridge();
  assert.equal(captureInput(h, { matterId: ID, text: '  ' }).error.code, 'empty_capture');
  h = saved();
  assert.equal(captureInput(h, { matterId: ID, text: 'another' }).error.code, 'invalid_identity');
  assert.equal(captureInput(h, { matterId: 'bad', source: { id: 's', excerpt: ' ' } }).error.code, 'empty_capture');
  const unknown = dispatchChain(h, { matterId: 'missing', action: { type: 'SAVE_UNDERSTANDING' } });
  assert.equal(unknown.error.code, 'unknown_matter');
  assert.deepEqual(unknown.chain, h.chain);
  h = cd(h, 'UNDERSTANDING_DRAFT', { text: '' });
  h = cd(h, 'SAVE_UNDERSTANDING');
  assert.equal(h.error.code, 'empty_understanding');
  assert.equal(current(h).understanding, BEFORE);
});

test('external matter IDs cannot collide with reducer generated creation IDs', () => {
  let h = captureInput(createBridge(), { matterId: 'matter-2', text: 'first' });
  h = captureInput(h, { matterId: 'second', text: 'second' });
  assert.equal(selectChain(h, 'matter-2').matter.originalText, 'first');
  assert.equal(selectChain(h, 'second').matter.originalText, 'second');
  assert.equal(h.chain.matters.length, 2);
});

test('source excerpts stay separate from user expression and demo fixtures never leak', () => {
  const h = captureInput(createBridge(), { matterId: ID, text: ORIGINAL, source: { id: 'source:user', title: '我粘贴的原文', excerpt: '原文不是我的判断', url: null } });
  assert.equal(current(h).whyCare, ORIGINAL);
  assert.equal(current(h).originalText, '原文不是我的判断');
  assert.equal(current(h).sources[0].id, 'source:user');
  assert.equal(current(h).understanding, '');
  assert.equal(selectChain(h, ID).isDemo, false);
  assert.ok(h.chain.sources.every(s => s.kind === 'user'));
});

test('no fake search capability or externally readable URL', () => {
  let h = comparison();
  h = xd(h, 'SEARCH');
  assert.equal(h.error.code, 'capability_missing');
  assert.deepEqual(selectComparison(h, 'cmp:1').candidates, []);
  assert.equal(selectComparison(h, 'cmp:1').search.capabilityAvailable, false);
  h = xd(h, 'IMPORT_MATERIAL', { material: { excerpt: 'some text', url: 'https://example.invalid' } });
  assert.equal(h.chain.sources.length, 0);
});

test('return mismatch, stale anchor, invalid range and unsaved draft reject before opening', () => {
  const h = saved(), anchor = { field: 'understanding', start: 0, end: 1, text: BEFORE[0], baseVersion: 1 };
  assert.equal(openComparison(h, { sessionId: 's', matterId: ID, anchor, returnTarget: { matterId: 'wrong' } }).error.code, 'return_mismatch');
  assert.equal(openComparison(h, { sessionId: 's', matterId: ID, anchor: { ...anchor, baseVersion: 0 } }).error.code, 'version_conflict');
  assert.equal(openComparison(h, { sessionId: 's', matterId: ID, anchor: { ...anchor, text: 'wrong' } }).error.code, 'invalid_anchor');
  const draft = cd(h, 'UNDERSTANDING_DRAFT', { text: 'uncommitted' });
  assert.equal(openComparison(draft, { sessionId: 's', matterId: ID, anchor }).error.code, 'draft_conflict');
});

test('cancel and reject preserve pasted source without changing understanding', () => {
  let h = imported();
  h = xd(h, 'OPEN_REVISION');
  h = xd(h, 'REVISION_DRAFT', { text: AFTER });
  h = xd(h, 'CANCEL_REVISION');
  h = xd(h, 'CONFIRM_REVISION');
  assert.equal(selectComparison(h, 'cmp:1').request, null);
  h = xd(h, 'REJECT');
  assert.equal(h.chain.sources.length, 1);
  assert.equal(current(h).sources.length, 0);
  assert.equal(current(h).understanding, BEFORE);
  h = returnFromComparison(h, 'cmp:1');
  assert.equal(h.route.anchor.text, SELECTED);
});

test('missing or reassigned source blocks the final authoritative mutation', () => {
  for (const mode of ['missing', 'wrong-owner', 'changed-excerpt']) {
    let h = reviseRequest();
    if (mode === 'missing') h.chain.sources = [];
    if (mode === 'wrong-owner') h.chain.sources[0].ownerMatterId = 'other';
    if (mode === 'changed-excerpt') h.chain.sources[0].excerpt = 'changed';
    h = commitComparison(h, ids(h));
    assert.equal(h.error.code, 'source_conflict');
    assert.equal(current(h).understanding, BEFORE);
    assert.equal(selectComparison(h, 'cmp:1').screen, 'compare');
  }
});

test('new saved version and ABA draft editing invalidate comparison requests', () => {
  for (const mode of ['saved', 'draft-ABA']) {
    let h = reviseRequest();
    h = cd(h, 'UNDERSTANDING_DRAFT', { text: 'later edit' });
    if (mode === 'saved') h = cd(h, 'SAVE_UNDERSTANDING');
    else h = cd(h, 'UNDERSTANDING_DRAFT', { text: BEFORE });
    const text = current(h).understanding;
    h = commitComparison(h, ids(h));
    assert.equal(h.error.code, mode === 'saved' ? 'version_conflict' : 'draft_conflict');
    assert.equal(current(h).understanding, text);
    assert.equal(selectComparison(h, 'cmp:1').revision.draft, AFTER);
  }
});

test('duplicate request is idempotent; mismatched and duplicate ACKs cannot update an unrelated view', () => {
  let h = reviseRequest();
  const request = ids(h);
  const first = applyPendingComparison(h, request);
  const second = applyPendingComparison(first.host, request);
  assert.equal(second.outcome.ok, true);
  assert.equal(second.outcome.receipt.replayed, true);
  assert.deepEqual(second.host.chain, first.host.chain);
  h = deliverComparisonResult(second.host, { ...request, requestId: 'wrong', outcome: second.outcome });
  assert.equal(selectComparison(h, 'cmp:1').screen, 'compare');
  h = deliverComparisonResult(h, { ...request, outcome: second.outcome });
  assert.equal(selectComparison(h, 'cmp:1').screen, 'returned');
  assert.deepEqual(deliverComparisonResult(h, { ...request, outcome: first.outcome }), h);
});

test('request ID collision with different payload is refused by real comparison host helper', () => {
  let h = reviseRequest();
  const request = ids(h);
  h = applyPendingComparison(h, request).host;
  h.comparisons['cmp:1'].model.request.after = 'different payload';
  const result = applyPendingComparison(h, request);
  assert.equal(result.outcome.error.code, 'request_id_collision');
  assert.deepEqual(result.host.chain, h.chain);
});

test('late success ACK cannot silently overwrite a later version or report old returned success', () => {
  let h = reviseRequest();
  const request = ids(h);
  const applied = applyPendingComparison(h, request);
  h = cd(applied.host, 'UNDERSTANDING_DRAFT', { text: '更晚的明确保存' });
  h = cd(h, 'SAVE_UNDERSTANDING');
  h = deliverComparisonResult(h, { ...request, outcome: applied.outcome });
  assert.equal(h.error.code, 'late_or_unproven_receipt');
  assert.equal(current(h).understanding, '更晚的明确保存');
  assert.equal(current(h).understandingVersion, 3);
  assert.equal(selectComparison(h, 'cmp:1').screen, 'compare');
  h = returnFromComparison(h, 'cmp:1');
  assert.equal(h.route.anchor, null);
  assert.equal(h.route.matterId, ID);
  assert.equal(h.error.code, 'stale_anchor');
});

test('forged view COMMIT_RESULT and forged ACK do not create success or mutate host', () => {
  let h = reviseRequest();
  const request = ids(h);
  const fake = applyPendingComparison(h, request).outcome;
  const direct = xd(h, 'COMMIT_RESULT', { requestId: request.requestId, ...fake });
  assert.equal(direct.error.code, 'host_receipt_only');
  h = deliverComparisonResult(h, { ...request, outcome: fake });
  assert.equal(h.error.code, 'late_or_unproven_receipt');
  assert.equal(current(h).understanding, BEFORE);
});

test('comparison undo is monotonic, keeps materials, and old undo cannot erase later edits', () => {
  let h = reviseRequest();
  h = commitComparison(h, ids(h));
  h = xd(h, 'UNDO_REVISION');
  h = commitComparison(h, ids(h));
  assert.equal(current(h).understanding, BEFORE);
  assert.equal(current(h).understandingVersion, 3);
  assert.equal(current(h).sources.length, 1);
  assert.equal(current(h).revisions[0].undoneAtVersion, 3);
  h = xd(h, 'UNDO_REVISION');
  assert.equal(selectComparison(h, 'cmp:1').request, null);
  let late = reviseRequest();
  late = commitComparison(late, ids(late));
  late = xd(late, 'UNDO_REVISION');
  late = cd(late, 'UNDERSTANDING_DRAFT', { text: '后来新内容' });
  late = cd(late, 'SAVE_UNDERSTANDING');
  late = commitComparison(late, ids(late));
  assert.equal(late.error.code, 'version_conflict');
  assert.equal(current(late).understanding, '后来新内容');
});

test('handoff snapshot remains version 1 while current canonical understanding advances to version 2', () => {
  let h = work();
  assert.equal(own(h.worksite, 'matters'), false);
  assert.equal(selectWorksite(h, 'work:1').work.connected, false);
  assert.equal(selectChain(h, ID).handoffSnapshot.actualDelivery, false);
  h = comparison(h);
  h = reviseRequest(imported(h));
  h = commitComparison(h, ids(h));
  const v = selectWorksite(h, 'work:1');
  assert.equal(v.intake[0].sourceText, BEFORE);
  assert.equal(v.intake[0].sourceVersion, 1);
  assert.equal(v.matters[0].understanding, BEFORE.replace(SELECTED, AFTER));
  assert.equal(v.matters[0].version, 2);
  h = wd(h, 'SET_INTAKE_ROLE', { id: v.intake[0].id, role: 'exclude' });
  assert.equal(selectWorksite(h, 'work:1').context.length, 0);
  assert.equal(current(h).understandingVersion, 2);
});
const own = (object, key) => Object.hasOwn(object, key);

test('existing worksite review/confirm mutates same canonical ID once and keeps fact distinct from interpretation', () => {
  let h = workReview();
  assert.equal(current(h).understanding, BEFORE);
  assert.equal(selectWorksite(h, 'work:1').receipt, null);
  h = wd(h, 'CONFIRM_REVISION');
  const v = selectWorksite(h, 'work:1');
  assert.equal(v.receipt.matterId, ID);
  assert.equal(v.receipt.version, 2);
  assert.equal(current(h).understanding, v.receipt.after);
  assert.equal(current(h).results[0].fact, '实际找到了昨天的问题。');
  assert.equal(current(h).results[0].interpretation, '可能与问题线索有关。');
  const twice = wd(h, 'CONFIRM_REVISION');
  assert.equal(current(twice).understandingVersion, 2);
  assert.equal(current(twice).results.length, 1);
  assert.equal(selectWorksite(twice, 'work:1').intake[0].sourceVersion, 1);
});

test('cancel review / keep result only do not adopt, missing fact does not create result', () => {
  let h = work();
  h = wd(h, 'KEEP_RESULT_ONLY');
  assert.equal(current(h).results.length, 0);
  h = workReview(h);
  h = wd(h, 'CANCEL_REVISION_REVIEW');
  h = wd(h, 'CONFIRM_REVISION');
  assert.equal(current(h).understandingVersion, 1);
  h = wd(h, 'KEEP_RESULT_ONLY');
  assert.equal(current(h).results[0].decision, 'result-only');
  assert.equal(current(h).understandingVersion, 1);
  assert.equal(selectWorksite(h, 'work:1').receipt, null);
});

test('later compare revision invalidates work result review instead of restoring its old understanding', () => {
  let h = workReview();
  h = comparison(h);
  h = reviseRequest(imported(h));
  h = commitComparison(h, ids(h));
  const later = current(h).understanding;
  assert.equal(selectWorksite(h, 'work:1').review.stale, true);
  h = wd(h, 'CONFIRM_REVISION');
  assert.equal(current(h).understanding, later);
  assert.equal(current(h).understandingVersion, 2);
  assert.equal(selectWorksite(h, 'work:1').receipt, null);
});

test('work review cannot overwrite a later unsaved draft, including ABA edit', () => {
  let h = workReview();
  h = cd(h, 'UNDERSTANDING_DRAFT', { text: 'scratch' });
  h = cd(h, 'UNDERSTANDING_DRAFT', { text: BEFORE });
  h = wd(h, 'CONFIRM_REVISION');
  assert.equal(h.error.code, 'draft_conflict');
  assert.equal(current(h).understandingVersion, 1);
});

test('work undo restores content with higher version and keeps original facts', () => {
  let h = wd(workReview(), 'CONFIRM_REVISION');
  h = wd(h, 'UNDO_REVISION');
  assert.equal(current(h).understanding, BEFORE);
  assert.equal(current(h).understandingVersion, 3);
  assert.equal(current(h).results[0].fact, '实际找到了昨天的问题。');
  assert.equal(current(h).results[0].decision, 'result-only');
  assert.equal(selectWorksite(h, 'work:1').receipt.undone, true);
});

test('wrong result ownership and wrong work ID cannot mutate another matter', () => {
  let h = work();
  h = captureInput(h, { matterId: 'other', text: '另一件事' });
  h = wd(h, 'RESULT_DRAFT', { patch: { matterId: 'other', fact: 'fact', proposedUnderstanding: 'hijack' } });
  assert.equal(h.error.code, 'matter_mismatch');
  assert.equal(selectChain(h, 'other').matter.understanding, '');
  assert.equal(dispatchWorksite(h, { workId: 'wrong', action: { type: 'CONFIRM_REVISION' } }).error.code, 'unknown_work');
});

test('fresh context and views use existing reducer semantics; inspecting views cannot mutate canonical data', () => {
  let h = saved();
  h = cd(h, 'COMPOSER_DRAFT', { text: '之前的讨论' });
  h = cd(h, 'SEND');
  h = cd(h, 'FRESH_CONTEXT');
  const v = selectChain(h, ID);
  assert.equal(v.context.understanding, '');
  assert.deepEqual(v.context.messages, []);
  v.matter.understanding = 'view tampering';
  assert.equal(current(h).understanding, BEFORE);
  h = cd(h, 'RESUME_CONTEXT');
  assert.equal(selectChain(h, ID).context.understanding, BEFORE);
});

test('inputs are not mutated and live operations never persist or send work', () => {
  const h = saved(), before = structuredClone(h);
  work(h);
  comparison(h);
  assert.deepEqual(h, before);
  const w = work(h);
  for (const value of Object.values(selectWorksite(w, 'work:1').impact.stages)) assert.equal(value, false);
  assert.equal(selectWorksite(w, 'work:1').isDemo, false);
});

test('two simultaneous comparisons preserve candidate draft isolation and reject stale second confirmation', () => {
  let h = imported();
  h = comparison(h, 'cmp:2');
  h = xd(h, 'IMPORT_MATERIAL', { material: { title: '第二份材料', excerpt: '另一个条件', url: null } }, 'cmp:2');
  h = xd(h, 'COMPARISON_DRAFT', { text: '第二次判断草稿' }, 'cmp:2');
  h = xd(h, 'OPEN_REVISION', {}, 'cmp:2');
  h = xd(h, 'REVISION_DRAFT', { text: '第二次候选理解' }, 'cmp:2');
  h = xd(h, 'CONFIRM_REVISION', {}, 'cmp:2');
  h = reviseRequest(h);
  h = commitComparison(h, ids(h));
  h = commitComparison(h, ids(h, 'cmp:2'));
  assert.equal(h.error.code, 'version_conflict');
  assert.equal(selectComparison(h, 'cmp:2').revision.draft, '第二次候选理解');
  assert.equal(selectComparison(h, 'cmp:2').comparisonDraft, '第二次判断草稿');
  assert.equal(current(h).understanding, BEFORE.replace(SELECTED, AFTER));
});

test('same matter in two works has isolated drafts but shared current understanding', () => {
  let h = workReview();
  h = work(h, 'work:2');
  h = wd(h, 'RESULT_DRAFT', { patch: { fact: '第二个工作事实', proposedUnderstanding: '第二工作提案' } }, 'work:2');
  h = wd(h, 'OPEN_REVISION_REVIEW', {}, 'work:2');
  h = wd(h, 'CONFIRM_REVISION');
  assert.equal(selectWorksite(h, 'work:2').result.fact, '第二个工作事实');
  assert.equal(selectWorksite(h, 'work:2').review.stale, true);
  assert.equal(selectWorksite(h, 'work:2').matters[0].understanding, current(h).understanding);
  h = wd(h, 'CONFIRM_REVISION', {}, 'work:2');
  assert.equal(selectWorksite(h, 'work:2').receipt, null);
  assert.equal(current(h).understandingVersion, 2);
});

test('wrong request matter ID cannot use current selection to mutate another object', () => {
  let h = reviseRequest();
  h = captureInput(h, { matterId: 'other', text: '另一件事' });
  h.comparisons['cmp:1'].model.request.matterId = 'other';
  h = commitComparison(h, ids(h));
  assert.equal(h.error.code, 'matter_mismatch');
  assert.equal(current(h).understanding, BEFORE);
  assert.equal(selectChain(h, 'other').matter.understanding, '');
});

test('UTF-16 surrogate boundaries and unknown source toggles are validated by existing reducer', () => {
  let h = captured();
  h = cd(h, 'UNDERSTANDING_DRAFT', { text: 'A😀B' });
  h = cd(h, 'SAVE_UNDERSTANDING');
  const attempted = openComparison(h, { sessionId: 'emoji', matterId: ID,
    anchor: { field: 'understanding', start: 1, end: 2, text: '\uD83D', baseVersion: 1 } });
  assert.equal(attempted.error.code, 'invalid_anchor');
  h = cd(h, 'OPEN_COMPARISON', { sourceId: 'missing' });
  assert.match(selectChain(h, ID).notice, /来源|材料/);
  assert.equal(current(h).sources.length, 0);
});
