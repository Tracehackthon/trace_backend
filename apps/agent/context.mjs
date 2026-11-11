import { demand, hash, identity, keys, text } from './protocol.mjs';

const boundary = (s, n) => n <= 0 || n >= s.length || !(s.charCodeAt(n - 1) >= 0xd800 && s.charCodeAt(n - 1) <= 0xdbff && s.charCodeAt(n) >= 0xdc00 && s.charCodeAt(n) <= 0xdfff);
const safeSource = (s, m) => s && (s.ownerMatterId === m.id || m.sourceIds?.includes(s.id))
  && !['revoked', 'excluded', 'deleted', 'inactive'].includes(s.status) && s.excluded !== true;

const projectValue = value => {
  if (typeof value === 'string') { const normalized = value.normalize('NFKC').trim().replaceAll('\\', '/'); return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return projectValue(value.identity ?? value.name ?? value.projectDir ?? value.projectRealpath ?? '');
};
const sameText = (provided, expected) => provided === undefined || provided === expected;

/**
 * Resolve and pin the worksite envelope from the Product Workspace.  The
 * request still carries the complete browser projection so the executor can
 * see what the user selected, but no caller-supplied work/matter/project
 * identity is trusted without matching the stored session.
 */
export function validateWorksiteContext(snapshot, request) {
  if (request.workId === undefined) return request;
  const work = snapshot.host?.worksite?.works?.[request.workId];
  const session = snapshot.host?.worksite?.sessions?.[request.workId];
  demand(work && session, 'WORKSITE_NOT_FOUND', '没有找到这项工作现场。', 404);
  demand(request.matterId && Array.isArray(session.intake), 'WORKSITE_CONTEXT_INVALID', '工作现场缺少有效带入。', 409);
  const included = session.intake.filter(item => item.role !== 'exclude');
  demand(included.length > 0, 'WORKSITE_CONTEXT_EMPTY', '这项工作没有可带入 Agent 的内容。', 422);
  const matterIds = new Set(included.map(item => item.matterId));
  demand(matterIds.has(request.matterId), 'MATTER_MISMATCH', 'Agent 运行事项不属于当前工作现场。', 409);
  const roles = new Set(included.map(item => item.role));
  const expectedRole = roles.size === 1 ? [...roles][0] : 'mixed';
  demand(request.role === expectedRole, 'WORKSITE_CONTEXT_MISMATCH', 'Agent 运行参与方式与工作现场不一致。', 409);
  const expectedProject = projectValue(work.project), expectedProjectIdentity = projectValue(work.projectIdentity ?? work.projectRealpath ?? work.projectDir ?? work.project);
  demand(expectedProject && expectedProjectIdentity && projectValue(request.project) === expectedProject && projectValue(request.projectIdentity) === expectedProjectIdentity,
    'PROJECT_MISMATCH', 'Agent 运行项目与工作现场绑定不一致。', 409);
  const requestedIntake = new Map(request.intake.map(item => [item.id, item]));
  demand(requestedIntake.size === included.length && included.every(item => {
    const value = requestedIntake.get(item.id);
    return value && value.matterId === item.matterId && value.role === item.role
      && sameText(value.title, item.title) && sameText(value.sourceText ?? value.text, item.sourceText)
      && sameText(value.sourceVersion, item.sourceVersion) && sameText(value.note, item.note);
  }), 'WORKSITE_CONTEXT_MISMATCH', 'Agent 带入内容与当前工作现场不一致。', 409);
  const findings = (session.findings ?? []).filter(item => item.useInCurrentWork === true);
  const requestedFindings = new Map(request.findings.map(item => [item.id, item]));
  demand(requestedFindings.size === findings.length && findings.every(item => {
    const value = requestedFindings.get(item.id);
    return value && value.text === item.text && sameText(value.matterId, item.matterId) && sameText(value.note, item.note);
  }), 'WORKSITE_CONTEXT_MISMATCH', 'Agent 发现与当前工作现场不一致。', 409);
  return {...request,
    role: expectedRole,
    project: work.project,
    projectIdentity: work.projectIdentity ?? work.projectRealpath ?? work.projectDir ?? work.project,
    intake: included.map(item => ({id: item.id, matterId: item.matterId, title: item.title, sourceText: item.sourceText,
      sourceVersion: item.sourceVersion, role: item.role, note: item.note})),
    findings: findings.map(item => ({id: item.id, matterId: item.matterId, text: item.text, note: item.note,
      relation: item.relation, useInCurrentWork: true})),
  };
}

/** Only stored, selected, bounded text is externalized. No URL/file fetching or
 * implicit personal-history retrieval. Every run starts a new Codex thread. */
export function assembleContext(snapshot, request, history = [], maxBytes = 64 * 1024) {
  demand(snapshot.revision === request.expectedRevision, 'REVISION_CONFLICT', '工作区已变化，请重读版本；请求尚未执行。', 409);
  const m = snapshot.host?.chain.matters.find(x => x.id === request.matterId), s = snapshot.host?.chain.sessions[request.matterId];
  demand(m && s, 'MATTER_NOT_FOUND', '事项不存在。', 404);
  demand(s.contextMode === request.contextMode && s.contextEpoch === request.contextEpoch, 'CONTEXT_CONFLICT', '上下文模式或 epoch 已变化。', 409);
  const fragments = [], omitted = [];
  const add = (id, role, content, revision, required = false) => {
    if (typeof content !== 'string' || content.length === 0) return;
    const fragment = { id, role, text: content, revision };
    if (Buffer.byteLength(JSON.stringify([...fragments, fragment])) > maxBytes - 20000) {
      demand(!required, 'CONTEXT_TOO_LARGE', '明确选择的材料超过上下文预算，请缩小选区。', 413);
      omitted.push({ id, reason: 'budget' }); return;
    }
    fragments.push(fragment);
  };
  const selection = request.selection;
  if (selection) {
    const content = m[selection.field];
    demand(typeof content === 'string' && selection.end <= content.length && boundary(content, selection.start) && boundary(content, selection.end)
      && content.slice(selection.start, selection.end) === selection.text, 'SELECTION_CONFLICT', '选区与当前正文不匹配。', 409);
    add('selection', 'explicit_selection', selection.text, selection.field === 'understandingDraft' ? m.understandingDraftVersion : snapshot.revision, true);
  }
  for (const id of request.sourceIds ?? []) {
    const source = snapshot.host.chain.sources.find(x => x.id === id);
    demand(safeSource(source, m), 'SOURCE_NOT_ALLOWED', '来源不属于当前事项或当前不可使用。', 403);
    demand(typeof source.excerpt === 'string' && source.excerpt.trim(), 'SOURCE_EMPTY', '选中来源没有可提供的摘录。');
    // Do not send absolute locator, credentials in URLs, or unselected full text.
    add(`source:${id}`, 'explicit_source_excerpt', source.excerpt, hash({ excerpt: source.excerpt, status: source.status ?? null }), true);
  }
  if (request.contextMode === 'resume') {
    add('matter:stop', 'current_stop', m.stop, m.stopVersion);
    add('matter:understanding', 'current_understanding', m.understanding, m.understandingVersion);
    add('matter:original', 'original_expression', m.originalText, snapshot.revision);
  }
  if (request.workId !== undefined) {
    for (const item of request.intake ?? []) add(`worksite:intake:${item.id}`, `worksite_${item.role}`, item.sourceText, item.sourceVersion, true);
    for (const item of request.findings ?? []) add(`worksite:finding:${item.id}`, 'worksite_finding', item.text, item.id, true);
  }
  for (const entry of history) {
    add(`history:${entry.runId}:user`, 'previous_user_input', entry.input, entry.runId);
    add(`history:${entry.runId}:assistant`, 'previous_agent_suggestion_not_fact', entry.answer, entry.runId);
  }
  const context = { protocolVersion: 1, baseRevision: snapshot.revision, matterId: m.id, contextMode: s.contextMode, contextEpoch: s.contextEpoch,
    target: { understandingVersion: m.understandingVersion, understandingDraftVersion: m.understandingDraftVersion },
    fragments, omitted, externalRetrieval: request.retrieval ? {sources: [...request.retrieval.sources].sort(), maxQueries: 3} : 'disabled' };
  demand(Buffer.byteLength(JSON.stringify(context)) <= maxBytes, 'CONTEXT_TOO_LARGE', '上下文超过预算。', 413);
  return { ...context, contextHash: hash(context) };
}

export const CONTEXT_TOOLS = [{ type: 'function', name: 'trace_context_read',
  description: 'Read one exact fragment from this run only. Never reads files, URLs, other matters, or omitted history.',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
{ type: 'function', name: 'trace_context_search',
  description: 'Literal search within the bounded fragments supplied for this run. This is NOT web or personal-history search.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } }];

export function callContextTool(context, name, args) {
  if (name === 'trace_context_read') {
    demand(keys(args, ['id']) && typeof args.id === 'string', 'INVALID_TOOL_INPUT', '片段 ID 无效。');
    const fragment = context.fragments.find(f => f.id === args.id);
    demand(fragment, 'CONTEXT_NOT_AVAILABLE', '片段不在本次允许的上下文内。', 403);
    return fragment;
  }
  demand(name === 'trace_context_search' && keys(args, ['query']) && text(args.query, 200) && args.query.trim(), 'TOOL_NOT_ALLOWED', '工具或查询不可用。', 403);
  return { scope: 'current_run_only', matches: context.fragments.filter(f => f.text.toLocaleLowerCase().includes(args.query.toLocaleLowerCase())).slice(0, 5).map(f => {
    const offset = f.text.toLocaleLowerCase().indexOf(args.query.toLocaleLowerCase());
    return { id: f.id, excerpt: f.text.slice(Math.max(0, offset - 100), offset + args.query.length + 300) };
  }) };
}
