import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDataEnvelope} from '../dist/packages/core/data/src/index.js';
import {buildZhihuCandidatePrecedent, captureZhihuAnswer, normalizeZhihuAnswer} from '../dist/packages/integration/zhihu-precedent/src/index.js';

const raw = {
  question: {id: '1982512240482619481', title: '有没有大佬分享一下做agent时的一些经验？'},
  answer: {id: '2041200823053587542', url: 'https://www.zhihu.com/question/1982512240482619481/answer/2041200823053587542', excerpt: '工具失败、检索不准和上下文变长后的混乱需要被拆开治理。'},
  captured_at: '2026-09-09T00:00:00.000Z',
};

test('independent Zhihu adapter produces source and candidate records without leaking full content', () => {
  const answer = normalizeZhihuAnswer(raw);
  assert.equal(answer.question_id, '1982512240482619481');
  const source = buildDataEnvelope(captureZhihuAnswer(raw, {run_id: 'zhihu-adapter-test'}));
  assert.equal(source.origin.provider, 'zhihu');
  assert.equal(source.payload.content_mode, 'bounded_public_summary');
  assert.equal(source.payload.content, raw.answer.excerpt);

  const candidate = buildDataEnvelope(buildZhihuCandidatePrecedent(raw, {
    source_ref: {record_id: source.record_id, revision: source.revision, kind: source.kind, schema_id: source.schema_id, schema_version: source.schema_version},
    change_id: 'change-zhihu-adapter-test',
    run_id: 'zhihu-adapter-test',
    claim: 'Agent 协作治理需要把上下文边界、工具失败和验证回退拆开。',
    rationale: '来源只提供有界公开摘要；采用仍由 Change Set 和用户决定。',
  }));
  assert.equal(candidate.kind, 'candidate_precedent');
  assert.deepEqual(candidate.lineage.parent_refs, [{record_id: source.record_id, revision: 1, kind: source.kind, schema_id: source.schema_id, schema_version: source.schema_version}]);
  assert.equal(candidate.lineage.change_id, 'change-zhihu-adapter-test');
  assert.equal(candidate.payload.adapter_id, 'trace.zhihu-precedent-adapter');
  assert.equal(JSON.stringify(candidate).includes('<html>'), false);
});

test('Zhihu adapter refuses unbounded or non-Zhihu input', () => {
  assert.throws(() => normalizeZhihuAnswer({...raw, answer: {...raw.answer, excerpt: ''}}), /summary/);
  assert.throws(() => normalizeZhihuAnswer({...raw, answer: {...raw.answer, url: 'https:\/\/example.com\/answer'}}), /zhihu.com/);
});
