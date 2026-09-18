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
export const OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answer', 'replacement', 'citations', 'uncertainties'],
  properties: {
    answer: { type: 'string' }, replacement: { type: ['string', 'null'] },
    citations: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['contextId', 'quote'], properties: { contextId: { type: 'string' }, quote: { type: 'string' } } } },
    uncertainties: { type: 'array', items: { type: 'string' } },
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
export function validateRequest(value) {
  demand(keys(value, ['protocolVersion', 'requestId', 'expectedRevision', 'matterId', 'contextMode', 'contextEpoch', 'purpose', 'input', 'selection', 'sourceIds', 'previousRunId', 'retrieval', 'profileId', 'threadId']), 'INVALID_REQUEST', '请求包含不支持的字段。', 400);
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
  return structuredClone(value);
}
export function validateOutput(raw, context, request) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new AgentError('INVALID_OUTPUT', 'Agent 没有返回有效的结构化结果。', 502); }
  demand(keys(value, ['answer', 'replacement', 'citations', 'uncertainties']) && text(value.answer, 64000) && value.answer.trim()
    && (value.replacement === null || text(value.replacement, 16000)) && Array.isArray(value.citations) && value.citations.length <= 16
    && Array.isArray(value.uncertainties) && value.uncertainties.length <= 16 && value.uncertainties.every(x => text(x, 4000)),
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
