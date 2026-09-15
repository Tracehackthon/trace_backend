// Explicit test-only preload. Never imported by production modules.
if (process.env.TRACE_ZHIHU_FIXTURE !== '1') throw Error('This fixture requires TRACE_ZHIHU_FIXTURE=1');
const original = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const u = new URL(input);
  if (u.href === 'https://openapi.zhihu.com/access_token') return Response.json({code: 20000, data: {access_token: 'fixture-user-only', expires_in: 3600}});
  if (u.origin !== 'https://developer.zhihu.com') return original(input, options);
  if (u.searchParams.get('Query') === '限流测试') return new Response('', {status: 429});
  if (u.searchParams.get('Query') === '空结果测试') return Response.json({Code: 0, Data: {Items: []}});
  const global = u.pathname.endsWith('/global_search'), personal = u.pathname.startsWith('/api/v1/user/');
  return Response.json({Code: 0, Data: {Items: [{Title: `${personal ? '近期收藏' : global ? '全网' : '知乎'} · 受控接口测试`,
    ContentText: '这是一条接口测试摘要。<em>高亮文字</em>不作为 HTML 渲染。<img src=x onerror="window.__unsafe=true">', AuthorName: '测试作者',
    Url: global ? 'https://example.com/evidence?utm_source=trace' : 'https://www.zhihu.com/question/1/answer/2?utm_source=trace'}]}});
};
