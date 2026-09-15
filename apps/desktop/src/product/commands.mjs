// Shared command contract. The server always evaluates it against its own stored
// snapshot. Browser evaluation is only a preview; it cannot issue commit receipts.
import * as B from './bridge.mjs';
import { createDemoWorkspace } from './demo-workspace.mjs';
import { SCREENS as CHAIN_SCREENS } from './chain-model.mjs';
import { SCREENS as WORK_SCREENS } from './worksite-model.mjs';
import { DIRECTION_OPTIONS, SCOPE_OPTIONS, RELATION_OPTIONS } from './comparison-model.mjs';

export class ProductCommandError extends Error {
  constructor(code, message, status = 422) { super(message); this.code = code; this.status = status; }
}
const fail = (code, message, status) => { throw new ProductCommandError(code, message, status); };
const requireThat = (ok, message, code = 'INVALID_OPERATION', status = 422) => { if (!ok) fail(code, message, status); };
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' && x.length <= 1000000;
const id = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 200 && !/[\x00-\x1f\x7f]/.test(x) && !['__proto__', 'constructor', 'prototype'].includes(x);
const version = x => Number.isSafeInteger(x) && x >= 0;
const optional = f => x => x === undefined || f(x);
const oneOf = (...xs) => x => xs.includes(x);
const strings = x => Array.isArray(x) && x.length <= 32 && x.every(text);
function shape(value, spec) {
  return plain(value) && Object.keys(value).every(key => Object.hasOwn(spec, key)) && Object.entries(spec).every(([key, check]) => check(value[key]));
}
const destination = x => shape(x, { agent: optional(text), project: optional(text), task: optional(text) });
const anchor = x => shape(x, { field: oneOf('understanding', 'originalText', 'discussion', 'source'), start: version, end: version, text,
  baseVersion: version, objectId: optional(id), expressionId: optional(id), sourceId: optional(id) });
const target = x => shape(x, { field: optional(oneOf('understanding')), start: version, end: version, text });
const route = x => shape(x, { view: text, matterId: optional(id), workId: optional(id), sessionId: optional(id), screen: optional(text), q: optional(text), kind: optional(text), recordId: optional(text),
  contextMode: optional(oneOf('fresh','resume')), anchor: optional(x => x === null || anchor(x)), returnTarget: optional(x => x === null || route(x)),
  scroll: optional(x => Array.isArray(x) && x.length <= 50 && x.every(item => shape(item, {key: optional(text), className: optional(text), top: version}))),
  anchorStatus: optional(text), currentUnderstandingVersion: optional(version) });
const handoffPatch = x => shape(x, { destination: optional(destination), selectedText: optional(text), note: optional(text), role: optional(oneOf('reference','trial','exclude')), scope: optional(oneOf('current-task')) });
const noArgs = {};
const CHAIN = {
  OPEN: {id, screen: optional(oneOf(...CHAIN_SCREENS))}, NAVIGATE: {screen: oneOf(...CHAIN_SCREENS)}, BACK: noArgs, CLEAR_NOTICE: noArgs,
  COMPOSER_DRAFT: {text}, SEND: noArgs,
  FOCUS: {field: oneOf('understanding','discussion'), start: version, end: version, text, objectId: optional(id)}, CLEAR_FOCUS: noArgs,
  BRANCH: noArgs, FOCUS_TO_UNDERSTANDING: noArgs, FRESH_CONTEXT: noArgs, RESUME_CONTEXT: noArgs,
  UNDERSTANDING_DRAFT: {text}, SAVE_UNDERSTANDING: noArgs,
  SUGGEST: {start: version, end: version, replacement: text}, ACCEPT_SUGGESTION: noArgs, DISMISS_SUGGESTION: noArgs, UNDO_SUGGESTION: noArgs,
  STOP_DRAFT: {text}, COLLAPSE: noArgs, UNDO_COLLAPSE: noArgs, REOPEN: noArgs,
  INCOMING_DRAFT: {text}, INCOMING_DECISION: {decision: oneOf('linked','unrelated','saved')},
  HANDOFF_DRAFT: {patch: handoffPatch}, EXCLUDE_HANDOFF: noArgs, TRY_AGAIN: noArgs,
};
const COMPARISON = {
  QUERY_PATCH: {patch: x => shape(x, {question: optional(text), instructions: optional(text), direction: optional(oneOf(...DIRECTION_OPTIONS.map(x=>x.value))), scopes: optional(x=>strings(x)&&x.every(oneOf(...SCOPE_OPTIONS.map(x=>x.value))))})},
  ADJUST_SEARCH: noArgs, IMPORT_MATERIAL: {material: x => shape(x, {title: optional(text), excerpt: text, context: optional(text), sourceType: optional(text), url: optional(x => x === null)})},
  OPEN_CANDIDATE: {id}, BACK_TO_CANDIDATES: noArgs, COMPARISON_DRAFT: {text}, SAVE_COMPARISON_NOTE: noArgs,
  RELATION_PATCH: {patch: x => shape(x, {type: optional(oneOf(...RELATION_OPTIONS.map(x=>x.value))), target: optional(text)})},
  LINK: noArgs, REJECT: noArgs, OPEN_REVISION: {target: optional(target)}, REVISION_DRAFT: {text}, CANCEL_REVISION: noArgs,
  CONFIRM_REVISION: noArgs, UNDO_REVISION: noArgs, CLEAR_NOTICE: noArgs,
};
const WORK = {
  NAVIGATE: {screen: oneOf(...WORK_SCREENS)}, BACK: noArgs, CLEAR_NOTICE: noArgs, OPEN_INTAKE: {id},
  SET_INTAKE_ROLE: {id, role: oneOf('reference','trial','contrast','exclude')}, SET_INTAKE_NOTE: {id, text},
  COMPOSER_DRAFT: {text}, OPEN_FINDING: noArgs, FINDING_DRAFT: {patch: x => shape(x, {text: optional(text), note: optional(text)})},
  SET_FINDING_RELATION: {decision: oneOf('linked','unrelated'), matterId: optional(id)}, KEEP_FINDING: noArgs, USE_FINDING_IN_WORK: noArgs, DISPUTE_IMPACT: {text},
  RESULT_DRAFT: {patch: x => shape(x, {matterId: optional(id), fact: optional(text), interpretation: optional(text), unconfirmed: optional(text), proposedUnderstanding: optional(text), relation: optional(oneOf('support','limit','challenge','unknown'))})},
  KEEP_RESULT_ONLY: noArgs, OPEN_REVISION_REVIEW: noArgs, REVISION_DRAFT: {text}, CANCEL_REVISION_REVIEW: noArgs,
  CONFIRM_REVISION: noArgs, UNDO_REVISION: noArgs, TRY_AGAIN: noArgs,
};
const actionShape = catalog => action => plain(action) && Object.hasOwn(catalog, action.type) && shape(action, {type: text, ...catalog[action.type]});
const OPERATION = {
  'capture.draft': {text},
  'capture.create': {matterId: id, text, source: optional(x => shape(x, {id, excerpt: text, title: optional(text), context: optional(text)}))},
  'chain.action': {matterId: id, action: actionShape(CHAIN), expectedUnderstandingVersion: optional(version)},
  'comparison.open': {sessionId: id, matterId: id, anchor, returnTarget: optional(route)},
  'comparison.action': {sessionId: id, action: actionShape(COMPARISON)},
  'comparison.return': {sessionId: id},
  'handoff.create': {matterId: id, workId: id, destination, role: oneOf('reference','trial'), note: text, selectedText: optional(text)},
  'worksite.action': {workId: id, action: actionShape(WORK)},
  'preferences.update': {displayName: x => text(x) && x.length <= 200, reduceMotion: x => typeof x === 'boolean'},
  'workspace.recover': noArgs,
  'workspace.reset': {mode: oneOf('empty','demo'), confirm: oneOf('replace-current-workspace')},
};

export function validateProductOperations(operations) {
  // Bound recursion before running any nested schema or reducer.
  const stack = [[operations, 0]]; let nodes = 0;
  while (stack.length) {
    const [value, depth] = stack.pop();
    requireThat(++nodes <= 250000 && depth <= 48, '命令结构过大。');
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      requireThat(!['__proto__','constructor','prototype'].includes(key), '命令包含无效对象键。'); stack.push([child, depth + 1]);
    }
  }
  requireThat(Array.isArray(operations) && operations.length > 0 && operations.length <= 256, '每次提交需要 1—256 个明确动作。');
  for (const op of operations) requireThat(plain(op) && Object.hasOwn(OPERATION, op.type) && shape(op, {type: text, ...OPERATION[op.type]}), '不支持的动作、字段或字段值。');
  requireThat(!operations.some(op => op.type === 'workspace.reset') || operations.length === 1, '重置必须独立确认，不能混入普通提交。');
  return operations;
}

export function validateProductCommand(command) {
  requireThat(shape(command, {protocolVersion: oneOf(1), commandId: id, expectedRevision: version, operations: Array.isArray}), '需要 protocolVersion 1、commandId、expectedRevision 与 operations；不接受客户端 host。', 'INVALID_COMMAND', 400);
  validateProductOperations(command.operations);
  return command;
}

function checked(next) {
  if (next.error) fail(next.error.code.toUpperCase(), next.error.message, /conflict|stale/.test(next.error.code) ? 409 : 422);
  return next;
}
function invalid(message) { fail('INVALID_TRANSITION', message); }
function chain(host, op) {
  const item = host.chain.matters.find(m => m.id === op.matterId), session = host.chain.sessions[op.matterId];
  if (!item || !session) fail('UNKNOWN_MATTER', '没有找到这件事。', 404);
  const action = op.action;
  if (action.type === 'SEND' && !session.composer.text.trim()) invalid('空白表达不能提交。');
  if (['BRANCH','FOCUS_TO_UNDERSTANDING'].includes(action.type) && !session.focus) invalid('请先选择准确的一处。');
  const next = checked(B.dispatchChain(host, op)), after = next.chain.sessions[op.matterId];
  if (action.type === 'FOCUS' && JSON.stringify(after.focus) === JSON.stringify(session.focus) && next.chain.notice) invalid(next.chain.notice);
  if (action.type === 'SUGGEST' && JSON.stringify(after.suggestion) === JSON.stringify(session.suggestion)) invalid(next.chain.notice);
  if (action.type === 'ACCEPT_SUGGESTION' && (session.suggestion?.status !== 'pending' || after.suggestion?.status !== 'accepted')) fail('PROPOSAL_STALE', next.chain.notice || '没有可确认的建议。', 409);
  if (action.type === 'UNDO_SUGGESTION' && (!session.suggestionUndo || after.suggestionUndo)) fail('PROPOSAL_STALE', next.chain.notice || '没有可撤销的建议。', 409);
  if (action.type === 'BRANCH' && next.chain.matters.find(m=>m.id===op.matterId).branches.length === item.branches.length) invalid(next.chain.notice);
  if (action.type === 'INCOMING_DECISION' && !session.incoming.text.trim()) invalid(next.chain.notice);
  return next;
}
function comparison(host, op) {
  const local = host.comparisons[op.sessionId];
  if (!local) fail('UNKNOWN_SESSION', '没有找到本次对照。', 404);
  if (local.model.request) fail('PENDING_REQUEST', '请先恢复上次未确认的请求。', 409);
  let next = checked(B.dispatchComparison(host, op));
  const model = next.comparisons[op.sessionId].model;
  if (['LINK','CONFIRM_REVISION','UNDO_REVISION'].includes(op.action.type)) {
    if (!model.request) invalid(model.notice || '没有可提交的对照动作。');
    next = checked(B.commitComparison(next, {sessionId: op.sessionId, requestId: model.request.id}));
  } else if (op.action.type === 'IMPORT_MATERIAL' && model.catalog.length === local.model.catalog.length) invalid(model.notice);
  else if (op.action.type === 'OPEN_REVISION' && !model.revision.open) invalid(model.notice);
  return next;
}
function worksite(host, op) {
  const before = host.worksite.sessions[op.workId];
  if (!before) fail('UNKNOWN_WORK', '没有找到这次工作。', 404);
  if (op.action.type === 'CONFIRM_REVISION' && !before.review.open) invalid('必须先打开当前版本的修订预览。');
  const next = checked(B.dispatchWorksite(host, op)), after = next.worksite.sessions[op.workId];
  if (op.action.type === 'CONFIRM_REVISION' && after.receipt?.id === before.receipt?.id) fail('PROPOSAL_STALE', next.worksite.notice || '修订没有提交。', 409);
  if (op.action.type === 'OPEN_REVISION_REVIEW' && !after.review.open) invalid(next.worksite.notice);
  if (op.action.type === 'KEEP_RESULT_ONLY' && (!after.result.id || after.result.decision !== 'result-only')) invalid(next.worksite.notice);
  if (op.action.type === 'UNDO_REVISION' && (!before.receipt || before.receipt.undone || !after.receipt?.undone)) fail('REVISION_CONFLICT', next.worksite.notice || '撤销基准已变化。', 409);
  return next;
}

export function applyProductOperations(previous, operations) {
  validateProductOperations(operations);
  let host = structuredClone(previous || B.createBridge());
  // A historical view error is not a new command failure.
  host.error = null;
  for (const op of operations) {
    switch (op.type) {
      case 'capture.draft': host.chain.capture.text = op.text; break;
      case 'capture.create': host = checked(B.captureInput(host, op)); break;
      case 'chain.action': host = chain(host, op); break;
      case 'comparison.open': host = checked(B.openComparison(host, op)); break;
      case 'comparison.action': host = comparison(host, op); break;
      case 'comparison.return': {
        host = B.returnFromComparison(host, op.sessionId);
        if (host.error?.code !== 'stale_anchor') checked(host);
        host.error = null; break;
      }
      case 'handoff.create': host = checked(B.createWorkFromHandoff(host, op)); break;
      case 'worksite.action': host = worksite(host, op); break;
      case 'preferences.update': host.preferences = {displayName: op.displayName, reduceMotion: op.reduceMotion}; break;
      case 'workspace.recover': host = B.recoverPendingComparisons(host); host.error = null; break;
      case 'workspace.reset': host = op.mode === 'demo' ? createDemoWorkspace() : B.createBridge(); break;
    }
  }
  return host;
}
