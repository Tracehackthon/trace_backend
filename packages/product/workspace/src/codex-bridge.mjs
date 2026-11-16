import crypto from 'node:crypto';
import fs from 'node:fs';
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

function projectIdentity(realpath) {
  const normalized = path.normalize(path.resolve(realpath));
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

/**
 * Resolve a Codex project only after proving that it is an existing directory.
 * `projectDir` is the normalized absolute spelling supplied by the caller;
 * `projectRealpath` is the filesystem target after resolving junctions/symlinks;
 * `projectIdentity` is the stable comparison key (case-folded on Windows).
 */
function canonicalProject(projectDir) {
  requireThat(boundedText(projectDir, 4096) && path.isAbsolute(projectDir), 'INVALID_PROJECT_DIR', 'Codex 必须提供当前任务的绝对项目目录。', 400);
  const absolute = path.normalize(path.resolve(projectDir));
  let stat;
  try { stat = fs.statSync(absolute); }
  catch { fail('INVALID_PROJECT_DIR', 'Codex 项目目录必须存在且可访问。', 400); }
  requireThat(stat.isDirectory(), 'INVALID_PROJECT_DIR', 'Codex 项目路径必须是目录。', 400);
  let realpath;
  try {
    const resolveRealpath = fs.realpathSync.native ?? fs.realpathSync;
    realpath = path.normalize(resolveRealpath(absolute));
  } catch { fail('INVALID_PROJECT_DIR', 'Codex 项目目录必须存在且可解析。', 400); }
  return {projectDir: absolute, projectRealpath: realpath, projectIdentity: projectIdentity(realpath)};
}

export function resolveCodexProjectDir(projectDir) {
  return canonicalProject(projectDir);
}

function storedProjectIdentity(work) {
  if (typeof work?.projectIdentity === 'string' && path.isAbsolute(work.projectIdentity)) return projectIdentity(work.projectIdentity);
  for (const key of ['projectRealpath', 'projectDir']) {
    if (typeof work?.[key] === 'string' && path.isAbsolute(work[key])) return projectIdentity(work[key]);
  }
  if (typeof work?.project === 'string' && path.isAbsolute(work.project)) {
    try { return canonicalProject(work.project).projectIdentity; }
    catch { return null; }
  }
  return null;
}

function validateProject(work, project) {
  const expectedIdentity = storedProjectIdentity(work);
  if (expectedIdentity) {
    requireThat(expectedIdentity === project.projectIdentity, 'PROJECT_MISMATCH', `本次工作属于 ${work.project}，不会带入当前项目 ${project.projectDir}。`, 409);
    return;
  }
  const expected = projectKey(work.project), actual = projectKey(path.basename(project.projectRealpath));
  requireThat(expected.length > 0 && expected === actual, 'PROJECT_MISMATCH', `本次工作属于 ${work.project}，不会带入当前项目 ${project.projectDir}。`, 409);
}

function deliveryProjectIdentity(delivery) {
  if (typeof delivery?.projectIdentity === 'string' && path.isAbsolute(delivery.projectIdentity)) return projectIdentity(delivery.projectIdentity);
  if (typeof delivery?.projectRealpath === 'string' && path.isAbsolute(delivery.projectRealpath)) return projectIdentity(delivery.projectRealpath);
  if (typeof delivery?.projectDir === 'string' && path.isAbsolute(delivery.projectDir)) {
    try { return canonicalProject(delivery.projectDir).projectIdentity; }
    catch { return null; }
  }
  return null;
}

function validateDeliveryProject(delivery, project) {
  const expectedIdentity = deliveryProjectIdentity(delivery);
  requireThat(expectedIdentity && expectedIdentity === project.projectIdentity, 'PROJECT_MISMATCH', 'Codex 回传的项目目录与原工作绑定不一致。', 409);
}

function boundProject(delivery, fallback) {
  return {
    projectDir: typeof delivery?.projectDir === 'string' ? path.normalize(path.resolve(delivery.projectDir)) : fallback.projectDir,
    projectRealpath: typeof delivery?.projectRealpath === 'string' ? path.normalize(path.resolve(delivery.projectRealpath)) : fallback.projectRealpath,
    projectIdentity: deliveryProjectIdentity(delivery) ?? fallback.projectIdentity,
  };
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

function eligibleWorks(host, project) {
  requireThat(host?.schemaVersion === 1 && host.worksite?.schemaVersion === 1, 'NO_PRODUCT_WORKSPACE', 'Trace 产品工作区还没有可接入内容。', 404);
  const actual = projectKey(path.basename(project.projectRealpath));
  return Object.values(host.worksite.works).filter(work => {
    const configuredProject = typeof work.project === 'string' && path.isAbsolute(work.project) ? path.basename(work.project) : work.project;
    const boundIdentity = storedProjectIdentity(work);
    return projectKey(work.agent) === 'codex' && (boundIdentity === project.projectIdentity || projectKey(configuredProject) === actual);
  });
}

function selectWork(host, { workId, sessionId }, project) {
  const matches = eligibleWorks(host, project);
  if (workId !== undefined) {
    const work = host.worksite.works[workId];
    requireThat(work && projectKey(work.agent) === 'codex', 'UNKNOWN_CODEX_WORK', '没有找到这项 Codex 工作。', 404);
    validateProject(work, project);
    return work;
  }
  const resumable = matches.filter(work => {
    const delivery = host.worksite.sessions[work.id]?.codexDelivery;
    return !delivery || delivery.sessionId === sessionId;
  });
  requireThat(resumable.length > 0, 'NO_PENDING_CODEX_WORK', '当前项目没有等待 Codex 接收的 Trace 工作。', 404);
  requireThat(resumable.length === 1, 'MULTIPLE_PENDING_CODEX_WORKS', '当前项目有多项待接工作，请先明确 workId。', 409);
  validateProject(resumable[0], project);
  return resumable[0];
}

function contextSnapshot(host, work, session, deliveryId, project) {
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
    work: { id: work.id, title: work.title, agent: work.agent, project: work.project, scope: work.scope,
      projectDir: project.projectDir, projectRealpath: project.projectRealpath, projectIdentity: project.projectIdentity },
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

/** Migrate snapshots written by the pre-delivery prototype. They remain
 * historical context; the worksite connection is the only current delivery
 * status and must not be copied into this snapshot. */
function markHandoffSnapshotsHistorical(host, workSession) {
  const matterIds = new Set((workSession?.intake ?? []).map(item => item.matterId));
  for (const matterId of matterIds) {
    const chainSession = host.chain?.sessions?.[matterId];
    if (!chainSession) continue;
    const historical = snapshot => {
      if (!snapshot) return snapshot;
      const {actualDelivery: _actualDelivery, deliveryStatus: _deliveryStatus, ...rest} = snapshot;
      return {...rest, snapshotKind: 'historical', historical: true};
    };
    chainSession.handoffSnapshot = historical(chainSession.handoffSnapshot);
    chainSession.handoffHistory = Array.isArray(chainSession.handoffHistory) ? chainSession.handoffHistory.map(historical) : chainSession.handoffHistory;
  }
}

export function receiveCodexContext(host, input, { deliveryId = `delivery:${crypto.randomUUID()}`, now = new Date().toISOString() } = {}) {
  validateCodexReceiveRequest(input);
  const project = canonicalProject(input.projectDir);
  const work = selectWork(host, input, project), session = host.worksite.sessions[work.id];
  requireThat(session, 'UNKNOWN_CODEX_WORK', 'Codex 工作缺少对应会话。', 503);
  const existing = session.codexDelivery;
  if (existing) {
    requireThat(existing.sessionId === input.sessionId, 'WORK_ALREADY_DELIVERED', '这项工作已经交给另一条 Codex 任务，未重复带入。', 409);
    validateDeliveryProject(existing, project);
    return { host, context: copy(existing.snapshot), receipt: copy(existing.receipt), changed: false };
  }
  const snapshot = contextSnapshot(host, work, session, deliveryId, project);
  const contextHash = sha(stableJson(snapshot));
  const receipt = {
    protocolVersion: 1,
    kind: 'trace.codex-delivery-receipt',
    status: 'received',
    commandId: input.commandId,
    deliveryId,
    workId: work.id,
    sessionId: input.sessionId,
    projectDir: project.projectDir,
    projectRealpath: project.projectRealpath,
    projectIdentity: project.projectIdentity,
    contextHash,
    receivedAt: now,
  };
  const next = copy(host), nextWork = next.worksite.works[work.id], nextSession = next.worksite.sessions[work.id];
  markHandoffSnapshotsHistorical(next, nextSession);
  nextWork.projectDir = project.projectDir;
  nextWork.projectRealpath = project.projectRealpath;
  nextWork.projectIdentity = project.projectIdentity;
  nextWork.connected = true;
  nextWork.connection = { hostType: 'codex', deliverySource: 'worksite.connection', status: 'received', sessionId: input.sessionId, projectDir: receipt.projectDir,
    projectRealpath: receipt.projectRealpath, projectIdentity: receipt.projectIdentity, deliveryId, contextHash, connectedAt: now };
  nextSession.codexDelivery = { ...copy(receipt), snapshot: copy(snapshot), receipt: copy(receipt), returnReceipt: null };
  return { host: next, context: snapshot, receipt, changed: true };
}

export function returnCodexResult(host, input, { returnId = `return:${crypto.randomUUID()}`, now = new Date().toISOString() } = {}) {
  validateCodexReturnRequest(input);
  const project = canonicalProject(input.projectDir);
  const work = host?.worksite?.works?.[input.workId], session = host?.worksite?.sessions?.[input.workId];
  requireThat(work && session, 'UNKNOWN_CODEX_WORK', '没有找到这项 Codex 工作。', 404);
  validateProject(work, project);
  const delivery = session.codexDelivery;
  requireThat(delivery && delivery.deliveryId === input.deliveryId, 'UNKNOWN_DELIVERY', '没有找到这次 Codex 带入回执。', 404);
  validateDeliveryProject(delivery, project);
  const bound = boundProject(delivery, project);
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
    projectDir: bound.projectDir,
    projectRealpath: bound.projectRealpath,
    projectIdentity: bound.projectIdentity,
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
  nextWork.connection = { ...nextWork.connection, deliverySource: 'worksite.connection', status: 'returned_for_review', projectDir: bound.projectDir,
    projectRealpath: bound.projectRealpath, projectIdentity: bound.projectIdentity, returnedAt: now, returnId };
  return { host: next, receipt, changed: true };
}

function worksiteProjectKey(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.normalize('NFKC').trim().replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}
const worksiteProjectText = value => boundedText(value, 4096) && value.trim().length > 0 && !FORBIDDEN_KEYS.has(value);

function validateAgentWorksiteBinding(host, input) {
  requireThat(identity(input.runId) && identity(input.workId) && identity(input.matterId) && worksiteProjectText(input.project) && worksiteProjectText(input.projectIdentity), 'INVALID_WORKSITE_RETURN', 'Agent 工作现场回接身份无效。', 400);
  const work = host?.worksite?.works?.[input.workId], session = host?.worksite?.sessions?.[input.workId];
  requireThat(work && session, 'UNKNOWN_WORKSITE', '没有找到这项工作现场。', 404);
  const expectedProjectIdentity = work.projectIdentity ?? work.projectRealpath ?? work.projectDir ?? work.project;
  requireThat(worksiteProjectKey(input.project) && worksiteProjectKey(input.project) === worksiteProjectKey(work.project)
    && worksiteProjectKey(input.projectIdentity) === worksiteProjectKey(expectedProjectIdentity), 'PROJECT_MISMATCH', 'Agent 回接项目与工作现场绑定不一致。', 409);
  const included = (session.intake ?? []).filter(item => item.role !== 'exclude');
  requireThat(included.some(item => item.matterId === input.matterId), 'MATTER_MISMATCH', 'Agent 回接事项不属于本次工作现场。', 409);
  const roles = new Set(included.map(item => item.role));
  requireThat(input.role === (roles.size === 1 ? [...roles][0] : 'mixed'), 'WORKSITE_CONTEXT_MISMATCH', 'Agent 回接参与方式与工作现场不一致。', 409);
  const requestIntake = new Map((input.intake ?? []).map(item => [item.id, item]));
  requireThat(requestIntake.size === included.length && included.every(item => {
    const value = requestIntake.get(item.id);
    return value && value.matterId === item.matterId && value.role === item.role && value.sourceText === item.sourceText;
  }), 'WORKSITE_CONTEXT_MISMATCH', 'Agent 回接带入内容与工作现场不一致。', 409);
  const findings = (session.findings ?? []).filter(item => item.useInCurrentWork === true);
  const requestFindings = new Map((input.findings ?? []).map(item => [item.id, item]));
  requireThat(requestFindings.size === findings.length && findings.every(item => requestFindings.get(item.id)?.text === item.text),
    'WORKSITE_CONTEXT_MISMATCH', 'Agent 回接发现与工作现场不一致。', 409);
  return {work, session, included};
}

function worksiteResultPatch(result, matterId) {
  const explicit = result?.worksite && plain(result.worksite) ? result.worksite : {};
  const fact = typeof explicit.fact === 'string' ? explicit.fact : result?.answer;
  const interpretation = typeof explicit.interpretation === 'string' ? explicit.interpretation : result?.answer;
  const unconfirmed = typeof explicit.unconfirmed === 'string' ? explicit.unconfirmed : (result?.uncertainties ?? []).join('\n');
  const proposedUnderstanding = typeof explicit.proposedUnderstanding === 'string' ? explicit.proposedUnderstanding : (result?.replacement ?? '');
  requireThat(identity(matterId) && boundedText(fact) && fact.trim(), 'INVALID_RESULT', 'Agent 工作现场结果缺少事实。', 400);
  requireThat(optionalText(interpretation, 65536) && optionalText(unconfirmed, 65536) && optionalText(proposedUnderstanding, 65536),
    'INVALID_RESULT', 'Agent 工作现场结果文本超过限制。', 400);
  return {matterId, fact, interpretation: interpretation ?? '', unconfirmed: unconfirmed ?? '', proposedUnderstanding: proposedUnderstanding ?? '', relation: 'unknown'};
}

/** Convert a completed Agent run into a review-only worksite result.  This
 * path intentionally performs RESULT_DRAFT and never OPEN/CONFIRM_REVISION;
 * the Product Workspace command/CAS remains the only canonical understanding
 * mutation boundary.
 */
export function returnAgentWorksiteResult(host, input, { returnId = `agent-return:${input.runId}`, now = new Date().toISOString() } = {}) {
  requireThat(plain(input) && identity(input.commandId) && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0,
    'INVALID_WORKSITE_RETURN', 'Agent 工作现场回接缺少命令或版本。', 400);
  const {work, session} = validateAgentWorksiteBinding(host, input);
  const patch = worksiteResultPatch(input.result, input.matterId);
  const reduced = dispatchWorksite(host, {workId: input.workId, action: {type: 'RESULT_DRAFT', patch}});
  requireThat(!reduced.error, reduced.error?.code ?? 'RESULT_REJECTED', reduced.error?.message ?? 'Agent 结果未能进入工作现场复核区。', 409);
  const resultHash = input.resultHash && /^[a-f0-9]{64}$/.test(input.resultHash) ? input.resultHash : sha(stableJson(input.result));
  // A run is a single-return unit, independent of commandId.  The Agent
  // ledger is a separate SQLite owner, so relying on it here would allow the
  // Product transaction to commit a second candidate before the ledger can
  // reject it.  Guard the authoritative Product snapshot first, while it is
  // still only a clone, so a new commandId (or a changed result) fails before
  // RESULT_DRAFT, receipt, or revision can be persisted.
  const existing = (session.agentReturns ?? []).find(item => item.runId === input.runId);
  if (existing) {
    requireThat(existing.commandId === input.commandId && existing.resultHash === resultHash,
      'WORKSITE_RETURN_CONFLICT', '这次 Agent 结果已经绑定了另一条工作现场回接回执。', 409);
    const {result: _result, ...receipt} = existing;
    return {host, receipt: copy(receipt), changed: false};
  }
  const next = copy(reduced), nextSession = next.worksite.sessions[input.workId], nextWork = next.worksite.works[input.workId];
  const receipt = {
    protocolVersion: 1, kind: 'trace.agent-worksite-return-receipt', status: 'returned_for_review', commandId: input.commandId,
    returnId, runId: input.runId, workId: input.workId, matterId: input.matterId, project: work.project,
    projectIdentity: work.projectIdentity ?? work.projectRealpath ?? work.projectDir ?? work.project, resultHash, returnedAt: now, understandingChanged: false,
  };
  nextSession.agentReturns = [...(nextSession.agentReturns ?? []), {...copy(receipt), result: copy(patch)}];
  nextSession.result.externalReturnId = returnId;
  nextSession.result.externalSource = {hostType: 'agent', runId: input.runId, resultHash};
  nextWork.connection = {...(nextWork.connection ?? {}), hostType: 'agent', deliverySource: 'worksite.connection', status: 'returned_for_review',
    sessionId: input.runId, runId: input.runId, project: work.project, projectIdentity: work.projectIdentity ?? work.projectRealpath ?? work.projectDir ?? work.project, returnId, returnedAt: now};
  return {host: next, receipt, changed: true};
}

export function findAgentWorksiteResponse(host, commandId) {
  for (const session of Object.values(host?.worksite?.sessions ?? {})) {
    const returned = session.agentReturns?.find(item => item.commandId === commandId);
    if (returned) {
      const {result, ...receipt} = returned;
      return {receipt: copy(receipt), result: copy(result)};
    }
  }
  fail('STORAGE_CORRUPT', 'Agent 工作现场命令已有记录，但对应回执缺失。', 503);
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
