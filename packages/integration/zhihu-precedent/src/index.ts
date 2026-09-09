import {createHash} from 'node:crypto';
import type {CreateDataRecord} from '../../../core/data/src/index.js';
import {buildCandidatePrecedentRecord} from '../../../core/precedent/src/index.js';
import type {RecordRef} from '../../../core/protocol/src/index.js';

export const ZHIHU_ADAPTER_ID = 'trace.zhihu-precedent-adapter' as const;
export const ZHIHU_ADAPTER_VERSION = '0.1.0' as const;

export interface ZhihuAnswerInput {
  question_id: string;
  question_title: string;
  answer_id: string;
  answer_url: string;
  summary: string;
  captured_at: string;
}

export interface ZhihuApiLikePayload {
  question?: {id?: string | number; title?: string};
  answer?: {id?: string | number; url?: string; excerpt?: string; summary?: string};
  question_id?: string | number;
  question_title?: string;
  answer_id?: string | number;
  answer_url?: string;
  summary?: string;
  title?: string;
  url?: string;
  content?: string;
  captured_at?: string;
}

export interface ZhihuContentInput {
  external_id?: string;
  title?: string;
  url?: string;
  content?: string;
  content_type?: string;
  captured_at: string;
  scope?: CreateDataRecord['scope'];
  classification?: 'public' | 'internal' | 'private' | 'secret';
}

export interface ZhihuAdapterOptions {
  run_id: string;
  scope?: CreateDataRecord['scope'];
  classification?: 'public' | 'internal' | 'private' | 'secret';
}

function text(value: unknown, field: string, max = 4000): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) throw new Error(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}

function id(value: unknown, field: string): string { return text(String(value ?? ''), field, 240); }

function sha(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export function normalizeZhihuAnswer(raw: ZhihuAnswerInput | ZhihuApiLikePayload): ZhihuAnswerInput {
  const payload = raw as ZhihuApiLikePayload;
  const questionId = payload.question_id ?? payload.question?.id;
  const questionTitle = payload.question_title ?? payload.question?.title ?? payload.title;
  const answerId = payload.answer_id ?? payload.answer?.id;
  const answerUrl = payload.answer_url ?? payload.answer?.url ?? payload.url;
  const summary = payload.summary ?? payload.answer?.summary ?? payload.answer?.excerpt ?? payload.content;
  const normalized: ZhihuAnswerInput = {
    question_id: id(questionId, 'question_id'),
    question_title: text(questionTitle, 'question_title', 500),
    answer_id: id(answerId, 'answer_id'),
    answer_url: text(answerUrl, 'answer_url', 2000),
    summary: text(summary, 'summary', 4000),
    captured_at: text(payload.captured_at, 'captured_at', 80),
  };
  if (!/^https:\/\/(www\.)?zhihu\.com\//i.test(normalized.answer_url)) throw new Error('answer_url must be an https URL on zhihu.com');
  if (Number.isNaN(Date.parse(normalized.captured_at))) throw new Error('captured_at must be an ISO timestamp');
  return normalized;
}

function sourceId(answer: ZhihuAnswerInput): string { return `zhihu:question-${answer.question_id}:answer-${answer.answer_id}`; }

export function captureZhihuContent(raw: ZhihuContentInput, options: Omit<ZhihuAdapterOptions, 'scope' | 'classification'> & Pick<ZhihuAdapterOptions, 'scope' | 'classification'> = {run_id: 'unknown'}): CreateDataRecord {
  const title = text(raw.title ?? '知乎内容', 'title', 500);
  const content = text(raw.content ?? title, 'content', 4000);
  const url = text(raw.url ?? 'https://www.zhihu.com/', 'url', 2000);
  let urlHost: string;
  let parsedUrl: URL;
  try { parsedUrl = new URL(url); urlHost = parsedUrl.hostname.toLowerCase(); } catch { throw new Error('url must be a valid URL'); }
  if (parsedUrl.protocol !== 'https:') throw new Error('url must use https');
  if (!['www.zhihu.com', 'zhihu.com', 'api.zhihu.com'].includes(urlHost)) throw new Error('url must point to an allowed Zhihu origin');
  const capturedAt = text(raw.captured_at, 'captured_at', 80);
  if (Number.isNaN(Date.parse(capturedAt))) throw new Error('captured_at must be an ISO timestamp');
  const externalId = text(raw.external_id ?? createHash('sha256').update(`${url}:${title}`).digest('hex').slice(0, 24), 'external_id', 240);
  const source = `zhihu:content-${externalId}`;
  const contentHash = sha(content);
  return {
    kind: 'source_snapshot', status: 'captured', schema_id: 'trace.source.snapshot', schema_version: '0.1.0',
    subject: {type: 'external_source', id: source}, scope: options.scope ?? {type: 'project', id: 'trace'},
    origin: {provider: 'zhihu', source_id: source, captured_at: capturedAt, content_hash: contentHash, locator: url},
    producer: {component: ZHIHU_ADAPTER_ID, version: ZHIHU_ADAPTER_VERSION, run_id: text(options.run_id, 'run_id', 200)},
    lineage: {parent_refs: [], source_refs: [], causation_id: `capture:${source}`, correlation_id: text(options.run_id, 'run_id', 200)},
    classification: options.classification ?? 'public',
    payload: {source_id: source, provider: 'zhihu', external_id: externalId, title, content, captured_at: capturedAt, content_hash: contentHash, url, content_type: raw.content_type ?? 'unknown', content_mode: 'bounded_public_summary'},
  };
}

export function captureZhihuAnswer(raw: ZhihuAnswerInput | ZhihuApiLikePayload, options: ZhihuAdapterOptions): CreateDataRecord {
  const answer = normalizeZhihuAnswer(raw);
  const contentHash = sha(answer.summary);
  const source = sourceId(answer);
  return {
    kind: 'source_snapshot',
    status: 'captured',
    schema_id: 'trace.source.snapshot',
    schema_version: '0.1.0',
    subject: {type: 'external_source', id: source},
    scope: options.scope ?? {type: 'project', id: 'trace'},
    origin: {provider: 'zhihu', source_id: source, captured_at: answer.captured_at, content_hash: contentHash, locator: answer.answer_url},
    producer: {component: ZHIHU_ADAPTER_ID, version: ZHIHU_ADAPTER_VERSION, run_id: text(options.run_id, 'run_id', 200)},
    lineage: {parent_refs: [], source_refs: [], causation_id: `capture:${source}`, correlation_id: options.run_id},
    classification: options.classification ?? 'public',
    payload: {
      source_id: source, provider: 'zhihu', external_id: `question-${answer.question_id}/answer-${answer.answer_id}`,
      title: answer.question_title, content: answer.summary, captured_at: answer.captured_at,
      content_hash: contentHash, url: answer.answer_url, content_mode: 'bounded_public_summary',
    },
  };
}

export function buildZhihuCandidatePrecedent(raw: ZhihuAnswerInput | ZhihuApiLikePayload, input: {
  source_ref: RecordRef;
  source_refs?: RecordRef[];
  change_id: string;
  run_id: string;
  claim: string;
  rationale: string;
  scope?: CreateDataRecord['scope'];
}): CreateDataRecord {
  const answer = normalizeZhihuAnswer(raw);
  const source = sourceId(answer);
  const candidateId = `candidate-zhihu-${answer.question_id}-${answer.answer_id}`;
  const claim = text(input.claim, 'claim');
  const rationale = text(input.rationale, 'rationale');
  const candidatePayload = {candidate_id: candidateId, claim, rationale, source_id: source, source_url: answer.answer_url};
  const evidenceRefs = [input.source_ref, ...(input.source_refs ?? [])];
  return buildCandidatePrecedentRecord({
    candidate_id: candidateId,
    claim,
    evidence_refs: evidenceRefs,
    rationale,
    scope: input.scope ?? {type: 'project', id: 'trace'},
    origin: {provider: 'zhihu', source_id: candidateId, captured_at: answer.captured_at, content_hash: sha(candidatePayload), locator: answer.answer_url},
    producer: {component: ZHIHU_ADAPTER_ID, version: ZHIHU_ADAPTER_VERSION, run_id: text(input.run_id, 'run_id', 200)},
    classification: 'public',
    causation_id: `precedent:${source}`,
    correlation_id: text(input.run_id, 'run_id', 200),
    change_id: text(input.change_id, 'change_id', 128),
    extra_payload: {source_id: source, source_url: answer.answer_url, adapter_id: ZHIHU_ADAPTER_ID, adapter_version: ZHIHU_ADAPTER_VERSION},
  });
}
