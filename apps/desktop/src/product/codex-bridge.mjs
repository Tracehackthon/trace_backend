import crypto from 'node:crypto';
import path from 'node:path';
import { dispatchWorksite } from './bridge.mjs';

const MAX_CONTEXT_BYTES = 256 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stableJson = value => Array.isArray(value) ? `[${value.map(stableJson).join(',')}]` : plain(value)
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}` : JSON.stringify(value);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);

export class CodexBridgeError extends Error {
  constructor(code, message, status = 422) { super(message); this.code = code; this.status = status; }
}

const fail = (code, message, status) => { throw new CodexBridgeError(code, message, status); };
const requireThat = (condition, code, message, status) => { if (!condition) fail(code, message, status); };
const boundedText = (value, max = 65536) => typeof value === 'string' && value.length <= max && !value.includes('\0');
const identity = value => boundedText(value, 512) && value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value) && !FORBIDDEN_KEYS.has(value);
const exactKeys = (value, allowed) => plain(value) && Object.keys(value).every(key => allowed.includes(key));
const optionalText = (value, max) => value === undefined || boundedText(value, max);

function projectKey(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, '');
}

function validateProject(work, projectDir) {
  requireThat(path.isAbsolute(projectDir), 'INVALID_PROJECT_DIR', 'Codex 必须提供当前任务的绝对项目目录。', 400);
  const expected = projectKey(work.project), actual = projectKey(path.basename(path.resolve(projectDir)));
  requireThat(expected.length > 0 && expected === actual, 'PROJECT_MISMATCH', `本次工作属于 ${work.project}，不会带入当前项目 ${path.basename(projectDir)}。`, 409);
}

function validateArtifact(value) {
  requireThat(exactKeys(value, ['title', 'kind', 'path', 'url', 'digest']), 'INVALID_RESULT', 'Codex 产物字段无效。', 400);
  requireThat(boundedText(value.title, 1000) && value.title.trim().length > 0, 'INVALID_RESULT', 'Codex 产物需要标题。', 400);
  requireThat(['file', 'test', 'link', 'note'].includes(value.kind), 'INVALID_RESULT', 'Codex 产物类型无效。', 400);
  requireThat(optionalText(value.path, 4096) && optionalText(value.url, 4096) && optionalText(value.digest, 512), 'INVALID_RESULT', 'Codex 产物内容超过限制。', 400);
  if (value.url !== undefined) {
    let parsed;
    try { parsed = new URL(value.url); } catch { fail('INVALID_RESULT', 'Codex 产物链接无效。', 400); }
    requireThat(['http:', 'https:', 'file:'].includes(parsed.protocol), 'INVALID_RESULT', 'Codex 产物链接协议无效。', 400);
  }
}

export function validateCodexReceiveRequest(value) {
  requireThat(exactKeys(value, ['protocolVersion', 'commandId', 'workId', 'sessionId', 'projectDir']), 'INVALID_CODEX_RECEIVE', 'Codex 接收请求包含未支持的字段。', 400);
  requireThat(value.protocolVersion === 1 && identity(value.commandId) && identity(value.sessionId), 'INVALID_CODEX_RECEIVE', 'Codex 接收请求版本或身份无效。', 400);
  requireThat(value.workId === undefined || identity(value.workId), 'INVALID_CODEX_RECEIVE', 'Codex 工作 ID 无效。', 400);
  requireThat(boundedText(value.projectDir, 4096) && path.isAbsolute(value.projectDir), 'INVALID_PROJECT_DIR', 'Codex 必须提供当前任务的绝对项目目录。', 400);
  return value;
}

export function validateCodexReturnRequest(value) {
  requireThat(exactKeys(value, ['protocolVersion', 'commandId', 'workId', 'sessionId', 'projectDir', 'deliveryId', 'contextHash', 'result']), 'INVALID_CODEX_RETURN', 'Codex 回传请求包含未支持的字段。', 400);
  requireThat(value.protocolVersion === 1 && [value.commandId, value.workId, value.sessionId, value.deliveryId].every(identity), 'INVALID_CODEX_RETURN', 'Codex 回传请求版本或身份无效。', 400);
  requireThat(boundedText(value.projectDir, 4096) && path.isAbsolute(value.projectDir), 'INVALID_PROJECT_DIR', 'Codex 必须提供当前任务的绝对项目目录。', 400);
  requireThat(typeof value.contextHash === 'string' && /^[a-f0-9]{64}$/.test(value.contextHash), 'INVALID_CODEX_RETURN', 'Codex 回传缺少有效上下文摘要。', 400);
  const result = value.result;
  requireThat(exactKeys(result, ['matterId', 'summary', 'fact', 'interpretation', 'unconfirmed', 'proposedUnderstanding', 'artifacts']), 'INVALID_RESULT', 'Codex 回传结果包含未支持的字段。', 400);
  requireThat(identity(result.matterId) && boundedText(result.fact) && result.fact.trim().length > 0, 'INVALID_RESULT', 'Codex 回传必须包含归属事项和实际结果。', 400);
  for (const key of ['summary', 'interpretation', 'unconfirmed', 'proposedUnderstanding']) requireThat(optionalText(result[key], 65536), 'INVALID_RESULT', 'Codex 回传文本超过限制。', 400);
  requireThat(result.artifacts === undefined || Array.isArray(result.artifacts) && result.artifacts.length <= 20, 'INVALID_RESULT', 'Codex 回传产物数量无效。', 400);
  for (const artifact of result.artifacts ?? []) validateArtifact(artifact);
  return value;
}

function roleInstruction(role) {
  return ({
    reference: '作为本次参考，不覆盖当前明确要求。',
    trial: '作为待检验的本次尝试，不当作已经成立的结论。',
    contrast: '只用于比较条件和差异，不据此约束当前实现。',
  })[role] ?? '只用于当前任务。';
}

function eligibleWorks(host, projectDir) {
  requireThat(host?.schemaVersion === 1 && host.worksite?.schemaVersion === 1, 'NO_PRODUCT_WORKSPACE', 'Trace 产品工作区还没有可接入内容。', 404);
  const actual = projectKey(path.basename(path.resolve(projectDir)));
  return Object.values(host.worksite.works).filter(work => projectKey(work.agent) === 'codex' && projectKey(work.project) === actual);
}

function selectWork(host, { workId, sessionId, projectDir }) {
  const matches = eligibleWorks(host, projectDir);
  if (workId !== undefined) {
    const work = host.worksite.works[workId];
    requireThat(work && projectKey(work.agent) === 'codex', 'UNKNOWN_CODEX_WORK', '没有找到这项 Codex 工作。', 404);
    validateProject(work, projectDir);
    return work;
  }
  const resumable = matches.filter(work => {
    const delivery = host.worksite.sessions[work.id]?.codexDelivery;
    return !delivery || delivery.sessionId === sessionId;
  });
  requireThat(resumable.length > 0, 'NO_PENDING_CODEX_WORK', '当前项目没有等待 Codex 接收的 Trace 工作。', 404);
  requireThat(resumable.length === 1, 'MULTIPLE_PENDING_CODEX_WORKS', '当前项目有多项待接工作，请先明确 workId。', 409);
  return resumable[0];
}

function contextSnapshot(host, work, session, deliveryId) {
  const intake = session.intake.filter(item => item.role !== 'exclude').map(item => ({
    intakeId: item.id,
    matterId: item.matterId,
    title: item.title,
    role: item.role,
    instruction: roleInstruction(item.role),
    text: item.sourceText,
    sourceVersion: item.sourceVersion,
    note: item.note,
  }));
  requireThat(intake.length > 0, 'EMPTY_CODEX_CONTEXT', '本次工作没有已确认可带入 Codex 的内容。', 422);
  const findings = session.findings.filter(item => item.useInCurrentWork).map(item => ({
    findingId: item.id,
    text: item.text,
    note: item.note,
  }));
  const snapshot = {
    protocolVersion: 1,
    kind: 'trace.codex-context',
    deliveryId,
    work: { id: work.id, title: work.title, agent: work.agent, project: work.project, scope: work.scope },
    context: { intake, findings },
    boundaries: {
      scope: 'current-task',
      authority: 'reference-or-trial-only',
      returnPolicy: 'return-a-reviewable-result; never mutate the user understanding directly',
    },
  };
  requireThat(Buffer.byteLength(stableJson(snapshot), 'utf8') <= MAX_CONTEXT_BYTES, 'CODEX_CONTEXT_TOO_LARGE', '本次 Codex 上下文超过 256 KiB，请缩小带入范围。', 413);
  return snapshot;
}

export function receiveCodexContext(host, input, { deliveryId = `delivery:${crypto.randomUUID()}`, now = new Date().toISOString() } = {}) {
  validateCodexReceiveRequest(input);
  const work = selectWork(host, input), session = host.worksite.sessions[work.id];
  requireThat(session, 'UNKNOWN_CODEX_WORK', 'Codex 工作缺少对应会话。', 503);
  const existing = session.codexDelivery;
  if (existing) {
    requireThat(existing.sessionId === input.sessionId && path.resolve(existing.projectDir) === path.resolve(input.projectDir), 'WORK_ALREADY_DELIVERED', '这项工作已经交给另一条 Codex 任务，未重复带入。', 409);
    return { host, context: copy(existing.snapshot), receipt: copy(existing.receipt), changed: false };
  }
  const snapshot = contextSnapshot(host, work, session, deliveryId);
  const contextHash = sha(stableJson(snapshot));
  const receipt = {
    protocolVersion: 1,
    kind: 'trace.codex-delivery-receipt',
    status: 'received',
    commandId: input.commandId,
    deliveryId,
    workId: work.id,
    sessionId: input.sessionId,
    projectDir: path.resolve(input.projectDir),
    contextHash,
    receivedAt: now,
  };
  const next = copy(host), nextWork = next.worksite.works[work.id], nextSession = next.worksite.sessions[work.id];
  nextWork.connected = true;
  nextWork.connection = { hostType: 'codex', status: 'received', sessionId: input.sessionId, projectDir: receipt.projectDir, deliveryId, contextHash, connectedAt: now };
  nextSession.codexDelivery = { ...copy(receipt), snapshot: copy(snapshot), receipt: copy(receipt), returnReceipt: null };
  return { host: next, context: snapshot, receipt, changed: true };
}

export function returnCodexResult(host, input, { returnId = `return:${crypto.randomUUID()}`, now = new Date().toISOString() } = {}) {
  validateCodexReturnRequest(input);
  const work = host?.worksite?.works?.[input.workId], session = host?.worksite?.sessions?.[input.workId];
  requireThat(work && session, 'UNKNOWN_CODEX_WORK', '没有找到这项 Codex 工作。', 404);
  validateProject(work, input.projectDir);
  const delivery = session.codexDelivery;
  requireThat(delivery && delivery.deliveryId === input.deliveryId, 'UNKNOWN_DELIVERY', '没有找到这次 Codex 带入回执。', 404);
  requireThat(delivery.sessionId === input.sessionId && delivery.contextHash === input.contextHash, 'DELIVERY_MISMATCH', 'Codex 回传与原任务或原上下文不一致。', 409);
  requireThat(delivery.returnReceipt === null, 'RESULT_ALREADY_RETURNED', '这次 Codex 工作已经回传结果；未覆盖原结果。', 409);
  requireThat(delivery.snapshot.context.intake.some(item => item.matterId === input.result.matterId), 'MATTER_MISMATCH', 'Codex 结果不能接到本次未带入的事项。', 409);

  const patch = {
    matterId: input.result.matterId,
    fact: input.result.fact,
    interpretation: input.result.interpretation ?? '',
    unconfirmed: input.result.unconfirmed ?? '',
    proposedUnderstanding: input.result.proposedUnderstanding ?? '',
  };
  const reduced = dispatchWorksite(host, { workId: input.workId, action: { type: 'RESULT_DRAFT', patch } });
  requireThat(!reduced.error, reduced.error?.code ?? 'RESULT_REJECTED', reduced.error?.message ?? 'Codex 结果未能进入复核区。', 409);
  const next = copy(reduced), nextSession = next.worksite.sessions[input.workId], nextWork = next.worksite.works[input.workId];
  const result = { ...copy(input.result), artifacts: copy(input.result.artifacts ?? []) };
  const resultHash = sha(stableJson(result));
  const receipt = {
    protocolVersion: 1,
    kind: 'trace.codex-return-receipt',
    status: 'returned_for_review',
    commandId: input.commandId,
    returnId,
    deliveryId: input.deliveryId,
    workId: input.workId,
    sessionId: input.sessionId,
    contextHash: input.contextHash,
    resultHash,
    returnedAt: now,
    understandingChanged: false,
  };
  nextSession.codexReturns = [...(nextSession.codexReturns ?? []), { ...copy(receipt), result }];
  nextSession.codexDelivery.status = 'returned_for_review';
  nextSession.codexDelivery.returnReceipt = copy(receipt);
  nextSession.result.externalReturnId = returnId;
  nextSession.result.externalSource = { hostType: 'codex', sessionId: input.sessionId, deliveryId: input.deliveryId, resultHash };
  nextWork.connection = { ...nextWork.connection, status: 'returned_for_review', returnedAt: now, returnId };
  return { host: next, receipt, changed: true };
}

export function findCodexBridgeResponse(host, commandId, kind) {
  for (const session of Object.values(host?.worksite?.sessions ?? {})) {
    if (kind === 'receive' && session.codexDelivery?.commandId === commandId) return { context: copy(session.codexDelivery.snapshot), receipt: copy(session.codexDelivery.receipt) };
    const returned = session.codexReturns?.find(item => item.commandId === commandId);
    if (kind === 'return' && returned) {
      const { result, ...receipt } = returned;
      return { receipt: copy(receipt), result: copy(result) };
    }
  }
  fail('STORAGE_CORRUPT', 'Codex 命令已有记录，但对应回执缺失。', 503);
}

export function codexRequestFingerprint(kind, body) {
  requireThat(['receive', 'return'].includes(kind), 'INVALID_CODEX_COMMAND', 'Codex 命令类型无效。', 400);
  return `codex-${kind}-v1:${sha(stableJson(body))}`;
}
