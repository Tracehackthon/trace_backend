import { createHash } from 'node:crypto';

export class AgentError extends Error {
  constructor(code, message, status = 422) { super(message); this.name = 'AgentError'; this.code = code; this.status = status; }
}
export function demand(ok, code, message, status) { if (!ok) throw new AgentError(code, message, status); }
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const stableJson = value => Array.isArray(value) ? `[${value.map(v => stableJson(v ?? null)).join(',')}]` : plain(value)
  ? `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}` : JSON.stringify(value);
export const hash = value => createHash('sha256').update(stableJson(value)).digest('hex');
export const identity = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200
  && !/[\x00-\x1f\x7f]/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
export const integer = value => Number.isSafeInteger(value) && value >= 0;
export const text = (value, max = 16000) => typeof value === 'string' && value.length <= max && !value.includes('\u0000');
export function keys(value, allowed) { return plain(value) && Object.keys(value).every(key => allowed.includes(key)); }
export const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'stale', 'timed_out', 'interrupted']);
export const PURPOSES = ['discuss', 'explain', 'compare', 'revise'];
const WORKSITE_ROLES = ['reference', 'trial', 'contrast', 'exclude', 'mixed'];
const WORKSITE_INTAKE_ROLES = ['reference', 'trial', 'contrast', 'exclude'];
export const OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answer', 'replacement', 'citations', 'uncertainties'],
  properties: {
    answer: { type: 'string' }, replacement: { type: ['string', 'null'] },
    citations: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['contextId', 'quote'], properties: { contextId: { type: 'string' }, quote: { type: 'string' } } } },
    uncertainties: { type: 'array', items: { type: 'string' } },
    worksite: { type: 'object', additionalProperties: false, properties: {
      fact: {type: 'string'}, interpretation: {type: 'string'}, unconfirmed: {type: 'string'}, proposedUnderstanding: {type: 'string'},
    } },
  },
};
export const SENSEMAKING_OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schema_id', 'schema_version', 'kind', 'confidence', 'observation', 'desired_behavior', 'scope', 'target_kind', 'target_hint', 'understanding_delta', 'open_questions', 'source'],
  properties: {
    schema_id: {type: 'string', const: 'trace.sensemaking-result'}, schema_version: {type: 'integer', const: 1},
    kind: {type: 'string', enum: ['candidate', 'noop']}, confidence: {type: 'number', minimum: 0, maximum: 1},
    observation: {type: ['string', 'null'], maxLength: 16000}, desired_behavior: {type: ['string', 'null'], maxLength: 16000},
    scope: {type: 'string', const: 'unknown'}, target_kind: {type: 'string', const: 'unresolved'}, target_hint: {type: ['string', 'null'], maxLength: 128},
    understanding_delta: {type: ['object', 'null']}, open_questions: {type: 'array', maxItems: 16, items: {type: 'string', maxLength: 2000}},
    source: {type: 'object', additionalProperties: false, required: ['host', 'session_id', 'turn_id', 'run_id', 'input_hash'], properties: {
      host: {type: 'string'}, session_id: {type: 'string'}, turn_id: {type: 'string'}, run_id: {type: ['string', 'null']}, input_hash: {type: 'string'},
    }},
  },
};

function worksiteProject(value) {
  const projectText = item => typeof item === 'string' && item.trim().length > 0 && item.length <= 4096 && !/[\x00-\x1f\x7f]/.test(item)
    && !['__proto__', 'constructor', 'prototype'].includes(item);
  if (typeof value === 'string') return projectText(value);
  if (!plain(value)) return false;
  return keys(value, ['name', 'identity', 'projectDir', 'projectRealpath'])
    && (value.name === undefined || projectText(value.name))
    && (value.identity === undefined || projectText(value.identity))
    && (value.projectDir === undefined || projectText(value.projectDir))
    && (value.projectRealpath === undefined || projectText(value.projectRealpath))
    && [value.name, value.identity, value.projectDir, value.projectRealpath].some(item => projectText(item));
}

function worksiteIntake(value) {
  return plain(value) && keys(value, ['id', 'matterId', 'title', 'sourceText', 'text', 'sourceVersion', 'role', 'note', 'instruction'])
    && identity(value.id) && identity(value.matterId) && (value.title === undefined || text(value.title, 4000))
    && (value.sourceText === undefined || text(value.sourceText, 16000)) && (value.text === undefined || text(value.text, 16000))
    && (value.sourceVersion === undefined || integer(value.sourceVersion)) && WORKSITE_INTAKE_ROLES.includes(value.role)
    && (value.note === undefined || text(value.note, 4000)) && (value.instruction === undefined || text(value.instruction, 4000));
}

function worksiteFinding(value) {
  return plain(value) && keys(value, ['id', 'matterId', 'text', 'note', 'relation', 'useInCurrentWork'])
    && identity(value.id) && text(value.text, 16000) && value.text.trim()
    && (value.matterId === undefined || identity(value.matterId)) && (value.note === undefined || text(value.note, 4000))
    && (value.relation === undefined || ['pending', 'linked', 'unrelated'].includes(value.relation))
    && (value.useInCurrentWork === undefined || typeof value.useInCurrentWork === 'boolean');
}

/**
 * The browser may attach one explicit worksite envelope to an Agent run.  It
 * is deliberately narrow and is re-checked against the authoritative
 * Product Workspace in the service before a run is created; these checks only
 * prevent an unbounded/ambiguous transport shape from reaching an executor.
 */
export function validateWorksiteRequest(value) {
  const keysPresent = ['workId', 'role', 'intake', 'findings', 'project', 'projectIdentity'].filter(key => value?.[key] !== undefined);
  if (!keysPresent.length) return value;
  demand(keysPresent.length === 6 && identity(value.workId), 'INVALID_WORKSITE_CONTEXT', '工作现场上下文必须同时包含 workId、role、intake、findings 和项目身份。', 400);
  demand(WORKSITE_ROLES.includes(value.role), 'INVALID_WORKSITE_CONTEXT', '工作现场参与方式无效。', 400);
  demand(Array.isArray(value.intake) && value.intake.length <= 64 && value.intake.every(worksiteIntake), 'INVALID_WORKSITE_CONTEXT', '工作现场带入内容无效。', 400);
  demand(Array.isArray(value.findings) && value.findings.length <= 64 && value.findings.every(worksiteFinding), 'INVALID_WORKSITE_CONTEXT', '工作现场发现无效。', 400);
  demand(worksiteProject(value.project) && worksiteProject(value.projectIdentity), 'INVALID_WORKSITE_CONTEXT', '工作现场项目身份无效。', 400);
  demand(new Set(value.intake.map(item => item.id)).size === value.intake.length
    && new Set(value.findings.map(item => item.id)).size === value.findings.length, 'INVALID_WORKSITE_CONTEXT', '工作现场上下文包含重复条目。', 400);
  return value;
}

export function validateRequest(value) {
  demand(keys(value, ['protocolVersion', 'requestId', 'expectedRevision', 'matterId', 'contextMode', 'contextEpoch', 'purpose', 'input', 'selection', 'sourceIds', 'previousRunId', 'retrieval', 'profileId', 'threadId', 'workId', 'role', 'intake', 'findings', 'project', 'projectIdentity']), 'INVALID_REQUEST', '请求包含不支持的字段。', 400);
  demand(value.protocolVersion === 1 && identity(value.requestId) && identity(value.matterId) && integer(value.expectedRevision)
    && integer(value.contextEpoch) && ['fresh', 'resume'].includes(value.contextMode) && PURPOSES.includes(value.purpose)
    && text(value.input) && value.input.trim(), 'INVALID_REQUEST', '需要有效的请求身份、事项、版本、上下文模式、用途和输入。', 400);
  demand(value.previousRunId === undefined || identity(value.previousRunId), 'INVALID_REQUEST', 'previousRunId 无效。', 400);
  demand(value.profileId === undefined || identity(value.profileId) && value.profileId.length <= 80, 'INVALID_PROFILE_ID', 'profileId 无效。', 400);
  demand(value.threadId === undefined || identity(value.threadId) && value.threadId.length <= 200, 'INVALID_THREAD_ID', 'threadId 无效。', 400);
  if (value.retrieval !== undefined) demand(keys(value.retrieval, ['sources']) && Array.isArray(value.retrieval.sources)
    && value.retrieval.sources.length >= 1 && value.retrieval.sources.length <= 2
    && value.retrieval.sources.every(x => ['zhihu', 'global'].includes(x)) && new Set(value.retrieval.sources).size === value.retrieval.sources.length,
    'INVALID_RETRIEVAL', '需明确选择 zhihu、global 或两者；不接受凭证及自定义接口。', 400);
  demand(value.sourceIds === undefined || Array.isArray(value.sourceIds) && value.sourceIds.length <= 8 && value.sourceIds.every(identity)
    && new Set(value.sourceIds).size === value.sourceIds.length, 'INVALID_REQUEST', '最多选择八个不重复的来源。', 400);
  if (value.selection !== undefined) {
    const s = value.selection;
    demand(keys(s, ['field', 'start', 'end', 'text']) && ['originalText', 'understandingDraft'].includes(s.field)
      && integer(s.start) && integer(s.end) && s.end > s.start && text(s.text) && s.text.length > 0,
    'INVALID_SELECTION', '选区需要原文或理解草稿中的准确 UTF-16 起止位置。', 400);
  }
  demand(value.purpose !== 'revise' || value.selection?.field === 'understandingDraft', 'SELECTION_REQUIRED', '局部修订必须明确选择理解草稿中的一处。');
  validateWorksiteRequest(value);
  return structuredClone(value);
}
export function validateOutput(raw, context, request) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new AgentError('INVALID_OUTPUT', 'Agent 没有返回有效的结构化结果。', 502); }
  demand(keys(value, ['answer', 'replacement', 'citations', 'uncertainties', 'worksite']) && text(value.answer, 64000) && value.answer.trim()
    && (value.replacement === null || text(value.replacement, 16000)) && Array.isArray(value.citations) && value.citations.length <= 16
    && Array.isArray(value.uncertainties) && value.uncertainties.length <= 16 && value.uncertainties.every(x => text(x, 4000))
    && (value.worksite === undefined || keys(value.worksite, ['fact', 'interpretation', 'unconfirmed', 'proposedUnderstanding'])
      && Object.values(value.worksite).every(x => text(x, 16000))),
  'INVALID_OUTPUT', 'Codex 结果结构或长度不符合协议。', 502);
  demand(request.purpose === 'revise' ? typeof value.replacement === 'string' : value.replacement === null,
    'INVALID_OUTPUT', '非修订请求不能产生替换正文。', 502);
  for (const citation of value.citations) {
    demand(keys(citation, ['contextId', 'quote']) && identity(citation.contextId) && text(citation.quote, 4000) && citation.quote.trim(),
      'INVALID_CITATION', '引用格式不符合协议。', 502);
    demand(context.fragments.some(f => f.id === citation.contextId && f.text.includes(citation.quote)), 'INVALID_CITATION', '引用必须来自本次实际提供的片段。', 502);
  }
  return { ...value, kind: request.purpose === 'revise' ? 'revision_candidate' : 'answer', adoption: 'not_applied',
    target: { matterId: request.matterId, baseRevision: context.baseRevision, contextEpoch: request.contextEpoch,
      ...(request.selection ? { selection: request.selection, understandingDraftVersion: context.target.understandingDraftVersion } : {}) } };
}
