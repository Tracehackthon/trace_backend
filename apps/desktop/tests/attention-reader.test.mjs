import test from 'node:test';
import assert from 'node:assert/strict';
import {
  READER_LANES,
  createSelectionAnchor,
  createReaderState,
  normalizeReaderSource,
  projectReader,
  reduceReaderState,
  readerDraftCanSave,
  renderReaderMarkup,
  safeSourceUrl,
} from '../src/attention/attention-reader.mjs';

const SOURCE = {
  id: 'source-1',
  title: '一份真实材料',
  author: '公开作者',
  sourceKind: '知乎公开内容',
  url: 'https://example.test/article?id=1',
  fullText: '全文内容，不是用户理解。',
  fragmentText: 'Spec 固定做什么和不做什么。',
  summaryText: '这是摘要。',
  userExcerpt: '用户当时摘下的原句。',
};

test('safeSourceUrl only permits http(s), while source metadata stays displayable', () => {
  assert.equal(safeSourceUrl('https://example.test/a'), 'https://example.test/a');
  assert.equal(safeSourceUrl('HTTP://EXAMPLE.TEST/a'), 'http://example.test/a');
  assert.equal(safeSourceUrl('https://user:pass@example.test/a'), null);
  assert.equal(safeSourceUrl('https://user@example.test/a'), null);
  assert.equal(safeSourceUrl('javascript:alert(1)'), null);
  assert.equal(safeSourceUrl('data:text/html,hello'), null);
  assert.equal(safeSourceUrl('/relative/path'), null);
  const source = normalizeReaderSource({...SOURCE, url: 'javascript:alert(1)'});
  assert.equal(source.locator, 'javascript:alert(1)');
  assert.equal(source.safeUrl, null);
});

test('projection keeps original, user, and Agent lanes independent', () => {
  const state = createReaderState({
    open: true,
    source: SOURCE,
    user: {text: '已经保存的用户理解', revision: 2},
    userDraft: '仍未保存的用户草稿',
    agent: {status: 'ready', output: 'Agent 的候选解释', expanded: false},
  });
  const model = projectReader(state);
  assert.deepEqual(Object.keys(model.lanes), READER_LANES);
  assert.equal(model.lanes.original.fullText, SOURCE.fullText);
  assert.equal(model.lanes.user.savedText, '已经保存的用户理解');
  assert.equal(model.lanes.user.draft, '仍未保存的用户草稿');
  assert.equal(model.lanes.agent.output, 'Agent 的候选解释');
  assert.equal(model.lanes.agent.expanded, false);
  assert.notEqual(model.lanes.original.fullText, model.lanes.user.draft);
  assert.notEqual(model.lanes.user.draft, model.lanes.agent.output);
});

test('projection is idempotent for a saved understanding with an empty draft slot', () => {
  const state = createReaderState({
    open: true,
    source: SOURCE,
    user: {text: '已经保存的用户理解', revision: 2},
  });
  assert.equal(projectReader(state).lanes.user.status, 'saved');
  assert.equal(projectReader(projectReader(state)).lanes.user.status, 'saved');
});

test('reader draft save control follows typed text without a tab change', () => {
  assert.equal(readerDraftCanSave('', 'idle'), false);
  assert.equal(readerDraftCanSave('   ', 'idle'), false);
  assert.equal(readerDraftCanSave('刚写下的一句', 'idle'), true);
  assert.equal(readerDraftCanSave('刚写下的一句', 'saving'), false);
  const markup = renderReaderMarkup(createReaderState({open: true, source: SOURCE, userDraft: '刚写下的一句'}));
  assert.match(markup, /data-reader-action="save-user-draft"(?![^>]*disabled)/);
});

test('source markup makes full, fragment, summary and user excerpt explicit', () => {
  const markup = renderReaderMarkup(createReaderState({open: true, source: SOURCE}));
  for (const [key, label, text] of [
    ['full', '全文', SOURCE.fullText],
    ['fragment', '片段', SOURCE.fragmentText],
    ['summary', '摘要', SOURCE.summaryText],
    ['user-excerpt', '用户摘录', SOURCE.userExcerpt],
  ]) {
    assert.match(markup, new RegExp(`data-original-view="${key}"`));
    assert.match(markup, new RegExp(label));
    assert.match(markup, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(markup, /data-canvas-lane="original"/);
  assert.match(markup, /data-canvas-lane="user"/);
  assert.match(markup, /data-canvas-lane="agent"/);
  assert.match(markup, /展开 Agent 解读/);
});

test('unsafe source and Agent content are escaped and never executable markup', () => {
  const text = '<img src=x onerror=alert(1)>'; // treated as literal user/source content
  const markup = renderReaderMarkup(createReaderState({
    open: true,
    source: {...SOURCE, fullText: text, url: 'javascript:alert(1)'},
    agent: {status: 'ready', output: text, expanded: true},
  }));
  assert.doesNotMatch(markup, /<img src=x/);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(markup, /data-reader-link-status="unavailable"/);
  assert.doesNotMatch(markup, /href="javascript:/i);
});

test('selection anchor opens compare without saving a domain object', () => {
  const anchor = createSelectionAnchor({sourceId: SOURCE.id, quote: SOURCE.fragmentText, start: 4, end: 30, revision: 1});
  let state = createReaderState({open: true, source: SOURCE, selectedAnchor: anchor});
  state = reduceReaderState(state, {type: 'OPEN_COMPARE', payload: {anchor}});
  assert.equal(state.mode, 'compare');
  assert.deepEqual(state.selectedAnchor, anchor);
  assert.equal(state.open, true);
  assert.match(renderReaderMarkup(state), /data-reader-compare="selection"/);
  assert.match(renderReaderMarkup(state), /保存对照只记录关系/);
  // A reader transition cannot invent a workspace command or a new revision.
  assert.equal(state.user.revision, null);
  assert.equal(state.user.savedText, '');
});

test('copying an Agent candidate only creates a user draft; explicit save is an outward event', () => {
  let state = createReaderState({
    open: true,
    source: SOURCE,
    user: {text: '旧理解', revision: 2},
    agent: {status: 'ready', candidates: [{id: 'proposal-1', text: '候选修订'}]},
  });
  state = reduceReaderState(state, {type: 'COPY_AGENT_TO_DRAFT', payload: {text: '候选修订'}});
  assert.equal(state.userDraft, '候选修订');
  assert.equal(state.user.savedText, '旧理解');
  assert.equal(state.user.revision, 2);
  const projected = projectReader(state);
  assert.equal(projected.lanes.agent.candidates[0].text, '候选修订');
  assert.equal(projected.lanes.user.status, 'draft');
});

test('loading, empty, error and unavailable states remain truthful', () => {
  const cases = [
    [{sourceStatus: 'loading', source: SOURCE}, '正在核验原文'],
    [{source: {...SOURCE, fullText: '', fragmentText: '', summaryText: '', userExcerpt: ''}}, '还没有可显示的原文摘录'],
    [{sourceStatus: 'denied', source: SOURCE}, '来源未获授权'],
    [{source: SOURCE, agent: {status: 'unavailable'}}, '尚未连接 Agent'],
    [{source: SOURCE, saveStatus: 'error', saveError: 'CAS stale'}, '草稿尚未保存'],
  ];
  for (const [input, label] of cases) {
    const markup = renderReaderMarkup(createReaderState({open: true, ...input}));
    assert.match(markup, new RegExp(label));
  }
});

test('close transition is reversible UI state and preserves content/draft', () => {
  const anchor = createSelectionAnchor({sourceId: SOURCE.id, quote: '一处选区'});
  let state = createReaderState({open: true, mode: 'compare', source: SOURCE, selectedAnchor: anchor, userDraft: '我的草稿'});
  state = reduceReaderState(state, {type: 'CLOSE'});
  assert.equal(state.open, false);
  assert.equal(state.userDraft, '我的草稿');
  assert.deepEqual(state.selectedAnchor, anchor);
  assert.equal(state.mode, 'source');
});
