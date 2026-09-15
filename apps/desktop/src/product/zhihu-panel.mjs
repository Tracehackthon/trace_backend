import {h} from './library.mjs';

const failures = {
  AUTH_REQUIRED: '检索还没有配置：请在本机后端设置知乎 Access Secret。',
  OAUTH_NOT_CONFIGURED: '授权还没有配置：请在后端设置 App ID、App Key 和登记的回调地址。',
  OAUTH_RELAY_UNAVAILABLE: '登记的回调服务还不可用。请先部署回调服务，再重新发起授权。',
  OAUTH_STATE_MISSING: '知乎回调没有返回校验用的 state，已停止授权。需与平台确认回调支持后再试。',
  OAUTH_DENIED: '这次授权未完成。没有读取你的知乎内容。',
  OAUTH_ALREADY_AUTHORIZED: '已有授权连接。更换账号前请先断开本机连接。',
  USER_AUTH_REQUIRED: '请先在知乎页面完成授权，然后检查连接。不会改用开发者账号。',
  RATE_LIMITED: '知乎暂时限流。请稍后再试，不会自动重复请求。',
  PROVIDER_BUSY: '还有一个知乎请求正在进行，请等它完成。',
};
const url = value => {
  try {const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;} catch {return null;}
};

/** Live HTTP results only. No demo fallback, HTML rendering, implicit search,
 * automatic private-data read or writes to the user's Trace understanding. */
export function mountZhihuPanel(root, {onSelect} = {}) {
  let connection, active = null, closed = false;
  root.classList.add('web-zhihu-dialog');
  root.insertAdjacentHTML('beforeend', `<p>从知乎的真实经验出发，也看看全网的证据。搜到的摘要先留在这里，不会自动改变你的理解。</p>
    <p data-provider-status role="status" aria-live="polite">正在检查本机连接…</p>
    <form data-search-form><label>想找什么<input type="text" name="query" maxlength="500" required placeholder="例如：第一次带团队，有哪些容易忽略的事？"></label>
      <label>到哪里找 <select name="source"><option value="zhihu">知乎 · 经验与观点</option><option value="global">全网 · 外部资料</option></select></label>
      <footer><button class="web-primary" type="submit" disabled data-search>搜索 3 条来源</button></footer></form>
    <p data-search-status role="status" aria-live="polite"></p><div data-results></div>
    <details><summary>连接我的知乎</summary><p>在知乎页面由你亲自授权。授权用于读取你自己的公开内容，不是 Trace 账号登录。Token 仅保留在本机后端内存，重启后需重新授权。</p>
      <p data-account-status></p><div data-login-link></div><footer>
      <button type="button" data-login disabled>去知乎授权</button><button type="button" data-check disabled>我已授权，检查连接</button>
      <label>读取范围 <select data-user-kind><option value="favorites">近期收藏</option><option value="contents">我的创作</option><option value="favorite_lists">我的收藏夹</option><option value="followees">我的关注</option></select></label>
      <button type="button" data-user-read disabled>读取 3 条</button><button type="button" data-disconnect disabled>断开本机连接</button></footer>
      <small>只在你点击后读取这 3 条；不自动翻页或保存。断开只清除本机连接，不撤销知乎平台上的授权。</small></details>`);
  const find = selector => root.querySelector(selector), notice = find('[data-search-status]');
  const configured = () => connection?.enabled && connection?.search_configured;
  function buttons() {
    find('[data-search]').disabled = !!active || !configured();
    find('[data-login]').disabled = !!active || !connection?.oauth?.configured || connection?.oauth?.status === 'authorized';
    find('[data-check]').disabled = !!active || connection?.oauth?.status !== 'pending_user_authorization';
    find('[data-disconnect]').disabled = !!active || !['authorized', 'pending_user_authorization'].includes(connection?.oauth?.status);
    find('[data-user-read]').disabled = !!active || !configured() || connection?.oauth?.status !== 'authorized';
    find('[data-user-kind]').disabled = !!active || connection?.oauth?.status !== 'authorized';
  }
  /** The panel deliberately maps each user action to one bounded API domain:
   * search sources use /api/search; OAuth and private reads use /api/zhihu. */
  async function request(path, data) {
    if (closed || active) return;
    const controller = new AbortController(); active = controller; buttons();
    const timeout = setTimeout(() => controller.abort(), 35000);
    try {
      const res = await fetch(path, {method: data === undefined ? 'GET' : 'POST', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: {'content-type': 'application/json'}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
      if (res.status === 404) throw Error('当前服务尚未启用知乎入口。请更新并启用本机知乎后端；没有用演示内容代替。');
      const value = await res.json();
      if (!res.ok) throw Error(failures[value.error?.code] || `请求没有完成（${value.error?.code || res.status}）。没有把失败当成空结果。`);
      if (closed || !root.isConnected) return;
      return value;
    } catch (e) {if (!closed) notice.textContent = controller.signal.aborted ? '请求已停止，没有自动重试。' : e.message;}
    finally {clearTimeout(timeout); active = null; if (!closed) buttons();}
  }
  function showStatus(value) {
    connection = value; buttons();
    find('[data-provider-status]').textContent = configured() ? '已连接本机知乎接口 · 只发送你输入的查询' : '知乎检索尚未启用。需要在本机后端开启并配置 Access Secret。';
    find('[data-account-status]').textContent = value.oauth?.status === 'authorized' ? '当前本机已授权；尚未自动读取任何收藏。'
      : value.oauth?.status === 'pending_user_authorization' ? '等待你在知乎页面授权，完成后点击「检查连接」。' : '当前没有有效的知乎授权连接。';
  }
  function showResults(value, personal = false) {
    const selectedSource = personal ? 'authorized' : value.source === 'global' ? 'global' : 'zhihu';
    const resourceLabels = {favorites:'我的近期收藏',contents:'我的创作',favorite_lists:'我的收藏夹',favorite_items:'收藏夹内容',followees:'我的关注'};
    const heading = personal ? resourceLabels[value.resource] || '我的知乎内容' : value.source === 'global' ? '全网来源' : '知乎来源';
    find('[data-results]').innerHTML = value.items.map((item, index) => {
      const sourceUrl = url(item.url);
      const excerpt = item.excerpt || '';
      return `<article class="web-linked-item"><small>${h(heading)} · ${h(item.author || '未提供作者')} · ${excerpt ? '摘要' : '元数据'}</small>
        <h3>${h(item.title || '未提供标题')}</h3><p>${h((item.excerpt || '').slice(0, 260))}${item.excerpt?.length > 260 ? '…' : ''}</p>
        ${item.excerpt?.length > 260 ? `<details class="web-zhihu-excerpt"><summary>展开完整接口摘要</summary><p>${h(item.excerpt)}</p></details>` : ''}
        <footer>${sourceUrl ? `<a href="${h(sourceUrl)}" target="_blank" rel="noopener noreferrer">查看原文 ↗</a>` : '<small>接口未提供有效链接，不补造原文地址。</small>'}
        ${personal && value.resource === 'favorite_lists' && item.id ? `<button type="button" data-open-favorite="${index}">打开这个收藏夹</button>` : ''}
        ${excerpt && typeof onSelect === 'function' ? `<button type="button" class="web-primary" data-use-source="${index}">用作这件事的对照</button>` : ''}</footer></article>`;
    }).join('');
    if (typeof onSelect === 'function') for (const button of root.querySelectorAll('[data-use-source]')) button.onclick = async () => {
      const item = value.items[Number(button.dataset.useSource)]; if (!item || active) return;
      button.disabled = true; notice.textContent = '正在把这份来源接到当前对照…';
      const accepted = await onSelect({id: item.id, provider: item.provider || 'zhihu', source: selectedSource,
        title: item.title || '联网来源', author: item.author || '', url: url(item.url), excerpt: item.excerpt || '',
        sourceType: personal ? '知乎授权资料' : selectedSource === 'global' ? '全网来源' : '知乎公开内容',
        contentType: item.content_type || 'unknown', contentMode: item.content_mode || 'summary', fetchedAt: item.fetched_at || ''});
      if (root.isConnected) {button.disabled = false; notice.textContent = accepted === false ? '这份来源没有接入；原事项未改变。' : '已进入对照。关联与是否修改理解仍由你确认。';}
    };
    for (const button of root.querySelectorAll('[data-open-favorite]')) button.onclick = async () => {
      const item=value.items[Number(button.dataset.openFavorite)];if(!item?.id||active)return;
      notice.textContent='正在读取这个收藏夹的 3 条内容…';const detail=await request('/api/zhihu/user/read',{kind:'favorite_items',favorite_id:String(item.id),offset:'0',limit:3});if(detail)showResults(detail,true);
    };
    notice.textContent = value.items.length ? `收到 ${value.items.length} 条${personal ? heading : '来源'}。${value.items.some(item=>item.excerpt)?'这些是接口摘要，不是全文；':''}尚未保存到 Trace。`
      : '这次没有返回内容。可以换个具体的关键词，不会自动扩大搜索或翻页。';
  }
  find('[data-search-form]').onsubmit = async e => {
    e.preventDefault(); if (active || !configured()) return;
    const form = new FormData(e.target); notice.textContent = '正在检索…'; find('[data-results]').replaceChildren();
    const source = form.get('source');
    const value = await request(source === 'global' ? '/api/search/global' : '/api/search/zhihu', {query: String(form.get('query')).trim(), count: 3}); if (value) showResults(value);
  };
  find('[data-login]').onclick = async () => {
    notice.textContent = ''; const value = await request('/api/zhihu/oauth/start', {}); if (!value) return;
    const login = url(value.login_url);
    if (!login || !(login.startsWith('https://') || new URL(login).origin === location.origin)) {notice.textContent = '后端没有返回有效授权地址。'; return;}
    showStatus({...connection, oauth: {...connection.oauth, status: 'pending_user_authorization'}});
    find('[data-login-link]').innerHTML = `<a href="${h(login)}" target="_blank" rel="noopener noreferrer">打开知乎授权页面 ↗</a>`;
  };
  find('[data-check]').onclick = async () => {
    notice.textContent = ''; const value = await request('/api/zhihu/oauth/check', {});
    if (value) {showStatus({...connection, oauth: value}); if (value.status === 'authorized') find('[data-login-link]').replaceChildren();}
    else {const status = await request('/api/zhihu/status'); if (status) showStatus(status);}
  };
  find('[data-disconnect]').onclick = async () => {
    const value = await request('/api/zhihu/oauth/disconnect', {}); if (value) {
      showStatus({...connection, oauth: {...connection.oauth, status: 'not_authorized'}}); find('[data-login-link]').replaceChildren(); find('[data-results]').replaceChildren(); notice.textContent = '已清除本机连接。未撤销知乎平台上的授权。';
    }
  };
  find('[data-user-read]').onclick = async () => {
    const kind=find('[data-user-kind]').value;notice.textContent = '正在读取你刚刚选择的知乎内容…'; find('[data-results]').replaceChildren();
    const value = await request('/api/zhihu/user/read', {kind, limit: 3, ...(kind==='contents'||kind==='followees'?{offset:'0'}:{})}); if (value) showResults(value, true);
    else {const status = await request('/api/zhihu/status'); if (status) showStatus(status);}
  };
  void request('/api/zhihu/status').then(value => {if (value) showStatus(value); else if (!closed) find('[data-provider-status]').textContent = '尚未连接知乎后端。';});
  root.traceCleanup = () => {closed = true; active?.abort();};
}
