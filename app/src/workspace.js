import { createSeed, createTeamSeed, platforms } from './data.js'

const params = new URLSearchParams(location.search)
const storageKey = 'trace-workspace-v2'
let data = createSeed(params)
let savedWorkspace = null
try {
  savedWorkspace = JSON.parse(sessionStorage.getItem(storageKey) || 'null')
  const saved = savedWorkspace?.personal || savedWorkspace
  if (!params.has('text') && Array.isArray(saved?.threads) && Array.isArray(saved?.changes)) data = saved
} catch { /* Session storage can be unavailable in a restricted browser. */ }
const workspaceData = { personal: data, team: createTeamSeed(data) }
if (Array.isArray(savedWorkspace?.team?.threads) && Array.isArray(savedWorkspace?.team?.changes)) workspaceData.team = savedWorkspace.team
const ui = {
  view: 'memory', workspace: savedWorkspace?.current === 'team' ? 'team' : 'personal', workspaceMenu: false, threadId: data.threads[0]?.id || '', changeId: data.changes[0]?.id,
  memoryQuery: '', platform: 'all', kind: 'all', factoryQuery: '', status: 'all',
  selectedMemories: new Set(), inspectorOpen: false, contextOpen: false, sidebarOpen: false,
  draft: '', foxDraft: '', foxOpen: false, pending: new Set(),
}
if (ui.workspace === 'team') { data = workspaceData.team; ui.threadId = data.threads[0]?.id || ''; ui.changeId = data.changes[0]?.id }
const app = document.querySelector('#app')
const esc = (v = '') => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`
const time = (value) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const thread = () => data.threads.find(item => item.id === ui.threadId) || data.threads[0]
const change = () => data.changes.find(item => item.id === ui.changeId)
const badge = (status) => `<span class="badge status-${{ 待确认: 'pending', 已采用: 'adopted', 需回顾: 'review', 已发布: 'published' }[status] || 'pending'}">${esc(status)}</span>`
const logo = (key, name = true) => {
  const p = platforms[key] || platforms.codex
  return `<span class="platform-logo" title="${p.name}"><img src="${p.logo}" alt="${p.name}" width="22" height="22">${name ? `<span>${p.name}</span>` : ''}</span>`
}
const teamPeople = [{ name: '林岚', initials: '林', color: '#dcefe5' }, { name: '周宁', initials: '周', color: '#e8e4f6' }, { name: 'Mia', initials: 'M', color: '#f7e8d8' }]
const memberStack = () => `<span class="member-stack" aria-label="3 位团队成员">${teamPeople.map(person => `<span title="${person.name}" style="background:${person.color}">${person.initials}</span>`).join('')}<small>3 位成员</small></span>`
const tool = (action, name, label) => `<button class="icon-button" type="button" data-action="${action}" aria-label="${label}" title="${label}">${icon(name)}</button>`
function icons() { window.lucide.createIcons({ attrs: { 'stroke-width': 1.7 } }) }
function persist() {
  try { workspaceData[ui.workspace] = data; sessionStorage.setItem(storageKey, JSON.stringify({ personal: workspaceData.personal, team: workspaceData.team, current: ui.workspace })) } catch { notify('当前浏览器无法保存会话状态') }
}
function notify(message) {
  const el = document.querySelector('#toast')
  el.textContent = message; el.classList.add('visible')
  clearTimeout(notify.timer)
  notify.timer = setTimeout(() => el.classList.remove('visible'), 2800)
}
function foxSvg(className = '') {
  return `<svg class="${className}" viewBox="0 0 120 130" role="img" aria-label="Trace 白狐" xmlns="http://www.w3.org/2000/svg">
    <path d="M27 58C14 37 18 13 36 8l15 24c6-3 13-4 19-3L85 7c17 7 20 29 8 50 11 11 16 27 12 42-4 16-19 24-36 21l-9-6-10 6c-19 2-33-8-36-24-3-15 2-29 13-38Z" fill="#fff" stroke="#D7E3DA" stroke-width="4" stroke-linejoin="round"/>
    <path d="M34 25l7 15-13-4c0-4 2-8 6-11Zm51 0 6 11-13 4 7-15Z" fill="#E6F1E9"/>
    <path d="M76 77c19-8 31 2 27 17-4 15-20 24-38 20 8-8 11-16 11-26 0-4 0-7 0-11Z" fill="#F0F6F1" stroke="#D7E3DA" stroke-width="4" stroke-linejoin="round"/>
    <circle cx="45" cy="62" r="4.5" fill="#2D6A4F"/><circle cx="71" cy="62" r="4.5" fill="#2D6A4F"/>
    <path d="M54 75c4 3 8 3 12 0" fill="none" stroke="#2D6A4F" stroke-width="3" stroke-linecap="round"/>
    <path d="M46 96c8 5 20 5 28 0" fill="none" stroke="#B7D3BE" stroke-width="4" stroke-linecap="round"/>
  </svg>`
}
function sidebar() {
  const pending = data.changes.filter(c => c.status === '待确认').length
  return `<aside class="sidebar ${ui.sidebarOpen ? 'sidebar-open' : ''}">
    <a href="#memory" class="brand"><span class="brand-mark">${icon('command')}</span><strong>T R A C E</strong><span class="beta">BETA</span></a>
    <div class="workspace-switcher-wrap"><button class="workspace-switcher" data-action="workspace-menu" aria-expanded="${ui.workspaceMenu}"><span><strong>${ui.workspace === 'team' ? '团队工作区' : '个人工作区'}</strong><small>${ui.workspace === 'team' ? '多人共创 · 3 位成员' : '我的协作空间'}</small></span>${icon('chevrons-up-down')}</button>${ui.workspaceMenu ? `<div class="workspace-menu"><button data-workspace="personal" class="${ui.workspace === 'personal' ? 'selected' : ''}"><strong>个人工作区</strong><small>我的协作空间</small>${ui.workspace === 'personal' ? icon('check') : ''}</button><button data-workspace="team" class="${ui.workspace === 'team' ? 'selected' : ''}"><strong>团队工作区</strong><small>3 位成员共同参与</small>${ui.workspace === 'team' ? icon('check') : ''}</button></div>` : ''}</div>
    <button class="new-thread" data-action="new-discussion">${icon('plus')}<span>新建讨论</span></button>
    <nav class="main-nav" aria-label="工作区导航">
      <a href="#discussion/${encodeURIComponent(ui.threadId)}" class="${ui.view === 'discussion' ? 'active' : ''}">${icon('messages-square')}<span>深度讨论</span></a>
      <a href="#memory" class="${ui.view === 'memory' ? 'active' : ''}">${icon('list-tree')}<span>记忆列表</span><span class="nav-count">${data.threads.length}</span></a>
      <a href="#factory" class="${ui.view === 'factory' ? 'active' : ''}">${icon('layers-3')}<span>认知工厂</span>${pending ? `<span class="nav-count count-green">${pending}</span>` : ''}</a>
    </nav>
    <div class="sidebar-label">来源平台</div><div class="platform-nav">${Object.entries(platforms).map(([key,p]) => `<button data-action="platform" data-platform="${key}" title="查看 ${p.name} 对话">${logo(key)}<span>${data.threads.filter(t => t.platform === key).length}</span></button>`).join('')}</div>
    <div class="pet-dock"><aside class="fox-desk-pet" aria-label="Trace 白狐轻接收入口"><span class="pet-count" title="记下的想法">${data.foxCount || ''}</span><button class="fox-button" id="fox-button" data-action="fox" aria-expanded="${ui.foxOpen}" aria-label="打开白狐想法气泡" title="记下一个想法">${foxSvg('fox-pet-svg')}</button><div class="fox-bubble" ${ui.foxOpen ? '' : 'hidden'}><label for="fox-input">随手记下一个想法</label><textarea id="fox-input" rows="4" placeholder="此刻在想什么？">${esc(ui.foxDraft)}</textarea><div class="fox-actions"><button class="quiet-button" data-action="fox-capture">记下它</button><button class="primary-button" data-action="fox-deepen">深度思考${icon('arrow-up-right')}</button></div></div></aside></div>
    <div class="sidebar-footer"><span class="runtime-dot"></span><span>${ui.workspace === 'team' ? '团队工作区' : '本地工作区'}</span><small>${ui.workspace === 'team' ? '多人共创 · 3 位成员' : '示例数据'}</small></div><div class="profile"><span class="profile-avatar">${ui.workspace === 'team' ? '共' : '我'}</span><div><strong>${ui.workspace === 'team' ? 'Trace 共创团队' : '我的 Trace'}</strong><small>${ui.workspace === 'team' ? '团队空间' : '个人空间'}</small></div></div>
  </aside>`
}
function memoryItems() {
  const q = ui.memoryQuery.toLowerCase().trim()
  return data.threads.filter(t => (ui.platform === 'all' || t.platform === ui.platform) && (ui.kind === 'all' || t.kind === ui.kind) && `${t.title} ${t.text} ${t.source} ${platforms[t.platform]?.name}`.toLowerCase().includes(q))
}
function memoryRows() {
  const items = memoryItems()
  if (!items.length) return `<tr><td colspan="6"><div class="empty-state">${icon('search-x')}<h3>没有匹配的记忆</h3><button class="quiet-button" data-action="clear-memory">清除筛选</button></div></td></tr>`
  return items.map(t => `<tr><td class="check-cell"><input type="checkbox" aria-label="选择 ${esc(t.title)}" data-select-memory="${esc(t.id)}" ${ui.selectedMemories.has(t.id) ? 'checked' : ''}></td><td class="memory-title"><a href="#discussion/${encodeURIComponent(t.id)}" title="${esc(t.title)}">${esc(t.title)}</a><small>${esc(t.text)}</small></td><td>${logo(t.platform)}</td><td><span class="type-label">${esc(t.kind)}</span></td><td class="date-cell">${time(t.date)}</td><td><a class="row-link" href="#discussion/${encodeURIComponent(t.id)}" aria-label="查看对话：${esc(t.title)}">查看对话${icon('arrow-up-right')}</a></td></tr>`).join('')
}
function memoryView() {
  return `<main class="memory-page page-scroll"><header class="page-heading"><div><div class="eyebrow">WORKSPACE / MEMORY</div><h1>记忆列表</h1><p>${data.threads.length} 条记忆<span class="meta-divider">/</span>${Object.keys(platforms).length} 个来源平台</p></div><button class="primary-button" data-action="new-discussion">${icon('plus')}新建讨论</button></header>
    <div class="memory-tabs" role="tablist" aria-label="记忆类型">${['all','事实记忆','偏好记忆','事件记忆'].map(k => `<button role="tab" aria-selected="${ui.kind === k}" data-kind="${k}">${k === 'all' ? '全部记忆' : k}<span>${k === 'all' ? data.threads.length : data.threads.filter(t => t.kind === k).length}</span></button>`).join('')}</div>
    <div class="list-toolbar"><label class="search-box">${icon('search')}<input id="memory-search" type="search" placeholder="搜索记忆或对话内容" aria-label="搜索记忆" value="${esc(ui.memoryQuery)}"></label><label class="select-box">${icon('list-filter')}<select id="platform-filter" aria-label="来源平台"><option value="all">全部平台</option>${Object.entries(platforms).map(([k,p]) => `<option value="${k}" ${ui.platform === k ? 'selected' : ''}>${p.name}</option>`).join('')}</select></label><button class="quiet-button" id="delete-memories" data-action="delete-memories" ${ui.selectedMemories.size ? '' : 'disabled'}>${icon('trash-2')}<span>删除<span id="selected-count"></span></span></button></div>
    <div class="memory-table-wrap"><table class="memory-table"><colgroup><col style="width:44px"><col><col style="width:135px"><col style="width:115px"><col style="width:148px"><col style="width:125px"></colgroup><thead><tr><th class="check-cell"><input type="checkbox" id="select-all" aria-label="选择当前列表全部记忆"></th><th>记忆 / 对话</th><th>来源平台</th><th>记忆类型</th><th>更新时间</th><th>操作</th></tr></thead><tbody id="memory-rows">${memoryRows()}</tbody></table></div><div class="list-footer"><span id="memory-result-count">共 ${memoryItems().length} 条记忆</span><span>${ui.workspace === 'team' ? '团队工作区' : '个人工作区'}</span></div></main>`
}
function filteredChanges() {
  const q = ui.factoryQuery.toLowerCase().trim()
  return data.changes.filter(c => (ui.status === 'all' || c.status === ui.status) && `${c.title} ${c.source} ${c.scope} ${c.boundary}`.toLowerCase().includes(q))
}
function changeRows() {
  const items = filteredChanges()
  if (!items.length) return `<div class="empty-state">${icon('search-x')}<h3>没有匹配的认知变化</h3><button class="quiet-button" data-action="clear-factory">清除筛选</button></div>`
  return items.map(c => `<button class="change-row ${ui.changeId === c.id ? 'selected' : ''}" data-change="${esc(c.id)}" aria-pressed="${ui.changeId === c.id}"><span class="change-symbol">${icon('git-branch')}</span><span class="change-text"><span class="change-title"><strong>${esc(c.title)}</strong>${badge(c.status)}</span><small>${esc(c.id)} · ${esc(c.source)} · ${esc(c.scope)}</small></span><span class="confidence"><strong>${c.confidence === null ? '待评估' : `${c.confidence}%`}</strong><small>证据置信度</small></span>${icon('arrow-right')}</button>`).join('')
}
function inspector() {
  const c = change()
  if (!c) return `<div class="empty-state">${icon('scan-text')}<h3>选择一条认知变化</h3></div>`
  return `<header class="inspector-heading"><div><span class="eyebrow">CHANGE INSPECTOR</span><p>${esc(c.id)} · 更新于 ${time(c.date)}</p></div>${tool('close-inspector','panel-right-close','关闭审阅详情')}</header><div class="inspector-scroll">
    <section class="inspect-summary"><div class="inspect-status">${badge(c.status)}<span>${c.confidence === null ? '置信度待评估' : `${c.confidence}% 置信度`}</span></div><h2>${esc(c.title)}</h2><p>适用于 <strong>${esc(c.scope)}</strong> 的协作判断</p></section>
    <section class="before-after"><div class="comparison"><span class="comparison-mark">B</span><div><span class="comparison-label">BEFORE</span><p>${esc(c.before)}</p></div></div><div class="comparison"><span class="comparison-mark after-mark">A</span><div><span class="comparison-label">AFTER</span><p>${esc(c.after)}</p></div></div></section>
    <section class="inspect-section"><h3>触发现场</h3><button class="source-link" data-action="change-source">${logo(c.platform,false)}<span><strong>${esc(c.source)}</strong><small>${esc(c.scope)} · ${c.evidence} 条对话记录</small></span>${icon('arrow-up-right')}</button></section><section class="inspect-section"><h3>适用边界</h3><p>${esc(c.boundary)}</p></section>
    <section class="inspect-section"><h3>激活与验证</h3><div class="validation-line">${icon('circle-dashed')}<p><strong>何时带回：</strong>${esc(c.activation)}</p></div><div class="validation-line blue-icon">${icon('list-checks')}<p><strong>如何验证：</strong>${esc(c.verification)}</p></div></section></div>
    <footer class="inspector-actions">${['已采用','已发布'].includes(c.status) ? `<button class="quiet-button" data-action="review">${icon('rotate-ccw')}撤回采用</button><button class="primary-button" data-action="change-source">查看来源${icon('arrow-up-right')}</button>` : `<button class="quiet-button" data-action="review" ${c.status === '需回顾' ? 'disabled' : ''}>${icon('clock-3')}暂存回顾</button><button class="primary-button" data-action="adopt">${icon('check')}确认采用</button>`}</footer>`
}
function factoryView() {
  const active = data.changes.filter(c => ['已采用','已发布'].includes(c.status)).length
  const pending = data.changes.filter(c => c.status === '待确认').length
  return `<main class="factory-layout"><div class="factory-main page-scroll"><header class="page-heading"><div><div class="eyebrow">WORKSPACE / COGNITION</div><h1>认知工厂</h1><p>正在发生的认知变化</p></div><button class="primary-button" data-action="record-change">${icon('plus')}记录变化</button></header>
    <section class="work-summary"><div class="summary-top"><div><div class="summary-label">${icon('activity')}本轮工作回执</div><h2>${active} 条判断已进入工作区</h2><p>当前来源 <strong>${ui.workspace === 'team' ? '团队共创' : 'Codex'}</strong><span class="meta-divider">·</span>${ui.workspace === 'team' ? memberStack() : '个人思考'}</p></div><div class="summary-numbers"><div><strong>${String(data.changes.length).padStart(2,'0')}</strong><span>认知变化</span></div><div class="pending-number"><strong>${String(pending).padStart(2,'0')}</strong><span>待你决定</span></div></div></div><ol class="flow-steps"><li><span>1</span>保留现场</li><li><span>2</span>继续讨论</li><li><span>3</span>用户确认</li><li><span>4</span>下次带回</li></ol></section>
    <div class="factory-toolbar"><label class="search-box">${icon('search')}<input type="search" id="factory-search" aria-label="搜索认知变化" placeholder="搜索变化、现场或适用范围" value="${esc(ui.factoryQuery)}"></label><div class="status-tabs" role="tablist" aria-label="候选状态">${['all','待确认','已采用','需回顾','已发布'].map(s => `<button role="tab" data-status="${s}" aria-selected="${ui.status === s}">${s === 'all' ? '全部' : s}</button>`).join('')}</div></div><div class="change-list" id="change-list">${changeRows()}</div><div class="list-footer"><span id="change-result-count">共 ${filteredChanges().length} 条变化</span><span>${ui.workspace === 'team' ? '团队工作区' : '个人工作区'}</span></div></div>
    <button class="panel-scrim" data-action="close-inspector" aria-label="关闭审阅详情" ${ui.inspectorOpen ? '' : 'hidden'}></button><aside class="inspector ${ui.inspectorOpen ? 'inspector-open' : ''}" id="inspector" aria-label="认知变化审阅">${inspector()}</aside></main>`
}
function messages(t) {
  return t.messages.map(m => { const member = m.role === 'member'; const human = m.role === 'user' || member; return `<article class="message ${human ? 'message-user' : 'message-agent'}"><div class="message-avatar">${member ? esc(m.author?.slice(0,1) || '成') : m.role === 'user' ? '你' : foxSvg()}</div><div class="message-content"><div class="message-role">${member ? esc(m.author || '团队成员') : m.role === 'user' ? '你' : 'Trace · 模拟回复'}</div><p>${esc(m.content)}</p>${m.meta ? `<small>${esc(m.meta)}</small>` : ''}</div></article>` }).join('') + (ui.pending.has(t.id) ? '<div class="thinking" role="status">正在思考…</div>' : '')
}
function discussionView() {
  const t = thread()
  if (!t) return `<main class="empty-state">${icon('messages-square')}<h2>开始一段新的讨论</h2><button class="primary-button" data-action="new-discussion">${icon('plus')}新建讨论</button></main>`
  const candidate = data.changes.find(c => c.threadId === t.id)
  return `<main class="discussion-layout"><section class="discussion-workspace"><header class="discussion-heading"><div><a class="breadcrumb" href="#memory">${icon('arrow-left')}记忆列表</a><h1>${esc(t.title)}</h1><div class="discussion-meta">${logo(t.platform)}<span>${time(t.date)}</span><span>${esc(t.kind)}</span>${ui.workspace === 'team' ? memberStack() : ''}</div></div><div class="header-actions">${tool('show-context','panel-right-open','查看原始现场')}<button class="primary-button" id="candidate-button" data-action="form-candidate">${icon('layers-3')}${candidate ? '查看候选' : '形成候选'}</button></div></header>
    <section class="conversation" id="conversation" aria-label="对话记录"><div class="discussion-intro"><span>${icon('focus')}本轮思考</span><p>${esc(t.text)}</p></div><div id="message-list">${messages(t)}</div></section><footer class="composer-shell"><form class="composer" id="message-form"><label class="sr-only" for="composer-input">继续讨论</label><textarea id="composer-input" rows="2" placeholder="继续补充你的观察…">${esc(ui.draft)}</textarea><div class="composer-bottom"><span>Trace <span class="muted">/ 模拟对话</span></span><button class="send-button" type="submit" aria-label="发送" title="发送" ${ui.pending.has(t.id) ? 'disabled' : ''}>${icon('arrow-up')}</button></div></form></footer></section>
    <aside class="discussion-context ${ui.contextOpen ? 'context-open' : ''}" aria-label="对话现场"><header><div class="eyebrow">THINKING CONTEXT</div>${tool('close-context','x','关闭现场')}</header><h2>这条想法的现场</h2>${ui.workspace === 'team' ? `<section class="inspect-section"><h3>参与成员</h3>${memberStack()}</section>` : ''}<section class="inspect-section"><h3>原始来源</h3>${logo(t.platform)}<p>${esc(t.source)}</p><small class="muted">${time(t.date)}</small></section><section class="inspect-section"><h3>原始观察</h3><p>${esc(t.text)}</p></section><section class="inspect-section"><h3>待回答问题</h3><ol class="question-list"><li>什么证据支持这条判断？</li><li>它在哪些场景下不成立？</li><li>下一次协作时如何验证？</li></ol></section><section class="inspect-section"><h3>认知变化</h3>${candidate ? `${badge(candidate.status)}<p>${esc(candidate.title)}</p><a class="row-link" href="#factory/${encodeURIComponent(candidate.id)}">进入认知工厂${icon('arrow-up-right')}</a>` : '<p class="muted">尚未形成候选</p>'}</section></aside></main>`
}
function render() {
  document.title = `Trace · ${{ memory: '记忆列表', factory: '认知工厂', discussion: '深度讨论' }[ui.view]}`
  app.innerHTML = `<div class="app-shell view-${ui.view}"><header class="mobile-header">${tool('menu','menu','打开导航')}<a href="#memory">T R A C E</a><span>${{ memory: '记忆列表', factory: '认知工厂', discussion: '深度讨论' }[ui.view]}</span></header>${ui.sidebarOpen ? '<button class="sidebar-scrim" data-action="menu" aria-label="关闭导航"></button>' : ''}${sidebar()}<div class="main-content">${ui.view === 'memory' ? memoryView() : ui.view === 'factory' ? factoryView() : discussionView()}</div></div><dialog id="editor-dialog"></dialog><div id="toast" class="toast" role="status"></div>`
  icons()
  if (ui.view === 'memory') updateMemorySelection()
}
function navigate(view,id = '') {
  const hash = `#${view}${id ? `/${encodeURIComponent(id)}` : ''}`
  if (location.hash === hash) readRoute(); else location.hash = hash
}
function readRoute() {
  const [view,encoded] = location.hash.slice(1).split('/')
  let id = ''
  try { id = decodeURIComponent(encoded || '') } catch { /* Invalid routes fall back to the list. */ }
  ui.view = ['memory','factory','discussion'].includes(view) ? view : params.has('text') ? 'discussion' : 'memory'
  if (ui.view === 'discussion' && id && data.threads.some(t => t.id === id)) { if (ui.threadId !== id) ui.draft = ''; ui.threadId = id }
  if (ui.view === 'factory') {
    if (id && data.changes.some(c => c.id === id)) {
      ui.changeId = id
      if (!filteredChanges().some(c => c.id === id)) { ui.status = 'all'; ui.factoryQuery = '' }
    }
    ui.inspectorOpen = Boolean(id)
    if (!change()) ui.changeId = filteredChanges()[0]?.id
  }
  ui.sidebarOpen = false; ui.foxOpen = false; render()
}
function updateMemorySelection() {
  const list = memoryItems(), checkbox = document.querySelector('#select-all')
  const selected = list.filter(t => ui.selectedMemories.has(t.id)).length
  checkbox.checked = list.length > 0 && selected === list.length; checkbox.indeterminate = selected > 0 && selected < list.length
  document.querySelector('#delete-memories').disabled = !ui.selectedMemories.size
  document.querySelector('#selected-count').textContent = ui.selectedMemories.size ? ` (${ui.selectedMemories.size})` : ''
}
function updateMemoryRows() {
  document.querySelector('#memory-rows').innerHTML = memoryRows(); document.querySelector('#memory-result-count').textContent = `共 ${memoryItems().length} 条记忆`; updateMemorySelection(); icons()
}
function updateChangeRows() {
  const items = filteredChanges()
  if (!items.some(c => c.id === ui.changeId)) ui.changeId = items[0]?.id
  document.querySelector('#change-list').innerHTML = changeRows(); document.querySelector('#change-result-count').textContent = `共 ${items.length} 条变化`; document.querySelector('#inspector').innerHTML = inspector(); icons()
}
function openDialog(title,content) {
  const dialog = document.querySelector('#editor-dialog')
  dialog.innerHTML = `<header><h2 id="dialog-title">${title}</h2>${tool('close-dialog','x','关闭弹窗')}</header>${content}`; dialog.setAttribute('aria-labelledby','dialog-title'); icons(); dialog.showModal()
}
function recordDialog() {
  openDialog('记录认知变化', `<form id="record-form" class="record-form"><label>变化标题<input name="title" required maxlength="160" placeholder="这次形成了什么新判断？"></label><div class="form-columns"><label>原来的做法<textarea name="before" required rows="3" maxlength="1000"></textarea></label><label>现在的判断<textarea name="after" required rows="3" maxlength="1000"></textarea></label></div><label>适用边界<input name="boundary" required maxlength="500" placeholder="适用于哪些任务或场景？"></label><div class="form-columns"><label>何时带回<input name="activation" required maxlength="500" placeholder="触发条件"></label><label>如何验证<input name="verification" required maxlength="500" placeholder="可观察的结果"></label></div><div class="form-columns"><label>来源平台<select name="platform">${Object.entries(platforms).map(([k,p]) => `<option value="${k}">${p.name}</option>`).join('')}</select></label><label>适用对象<select name="scope" required><option value="个人思考" ${ui.workspace === 'personal' ? 'selected' : ''}>个人思考</option><option value="团队共创" ${ui.workspace === 'team' ? 'selected' : ''}>团队共创</option></select></label></div><footer><button type="button" class="quiet-button" data-action="close-dialog">取消</button><button class="primary-button" type="submit">${icon('plus')}加入待确认</button></footer></form>`)
}
function nextChangeId() { return `T-${String(Math.max(42,...data.changes.map(c => Number(c.id.slice(2)) || 0)) + 1).padStart(3,'0')}` }
function formCandidate() {
  const t = thread()
  if (!t) return
  let c = data.changes.find(item => item.threadId === t.id)
  if (!c) {
    const latest = [...t.messages].reverse().find(m => m.role === 'user')
    c = { id: nextChangeId(), title: t.title, threadId: t.id, platform: t.platform, status: '待确认', confidence: null, evidence: t.messages.length, source: t.source, scope: ui.workspace === 'team' ? '团队共创' : '个人思考', before: '尚未形成可复用的协作判断', after: latest?.content || t.text, boundary: '适用范围尚待确认，请结合原始对话补充验证。', activation: '遇到相似任务时，先核对当前现场和适用边界。', verification: '在下一次相关任务中补充一个支持案例和一个边界案例。', date: new Date().toISOString() }
    data.changes.unshift(c); persist()
    if (params.get('from') === 'deepseek-harness' && window.opener) window.opener.postMessage({ type: 'trace.desktop.candidate', observationId: t.id, status: '候选中' },'http://127.0.0.1:3080')
  }
  ui.factoryQuery = ''; ui.status = 'all'; navigate('factory',c.id)
}
function addThread(title,platform = 'codex',kind = '事件记忆') {
  const id = `thought-${crypto.randomUUID()}`
  data.threads.unshift({ id,title,text: title,platform,kind,date: new Date().toISOString(),source: `Trace · ${platforms[platform].name} 工作区`,messages: [{ role: 'user',content: title }] }); persist(); return id
}
function newDiscussion() {
  openDialog('新建讨论', `<form id="new-discussion-form" class="record-form"><label>讨论主题<input name="title" required maxlength="200" placeholder="这次想讨论什么？"></label><label>来源平台<select name="platform">${Object.entries(platforms).map(([k,p]) => `<option value="${k}">${p.name}</option>`).join('')}</select></label><footer><button type="button" class="quiet-button" data-action="close-dialog">取消</button><button class="primary-button" type="submit">开始讨论${icon('arrow-right')}</button></footer></form>`)
}
function sendMessage() {
  const t = thread(), content = ui.draft.trim()
  if (!t || !content || ui.pending.has(t.id)) return
  t.messages.push({ role: 'user',content }); t.date = new Date().toISOString(); ui.draft = ''; ui.pending.add(t.id); persist(); render()
  document.querySelector('#composer-input').focus(); document.querySelector('#conversation').scrollTop = document.querySelector('#conversation').scrollHeight
  setTimeout(() => {
    t.messages.push({ role: 'agent',content: `你补充的“${content}”可以作为下一步讨论的起点。针对“${t.title}”，还需要核对支持它的原始证据，并找一个可能不适用的场景，再决定是否形成候选。` }); ui.pending.delete(t.id); persist()
    if (ui.view === 'discussion' && ui.threadId === t.id) { document.querySelector('#message-list').innerHTML = messages(t); document.querySelector('.send-button').disabled = false; document.querySelector('#conversation').scrollTop = document.querySelector('#conversation').scrollHeight }
  },550)
}
app.addEventListener('input',event => {
  const { id,value } = event.target
  if (id === 'memory-search') { ui.memoryQuery = value; updateMemoryRows() }
  if (id === 'factory-search') { ui.factoryQuery = value; updateChangeRows() }
  if (id === 'composer-input') ui.draft = value
  if (id === 'fox-input') ui.foxDraft = value
})
app.addEventListener('change',event => {
  if (event.target.id === 'platform-filter') { ui.platform = event.target.value; updateMemoryRows() }
  if (event.target.dataset.selectMemory) { const id = event.target.dataset.selectMemory; if (event.target.checked) ui.selectedMemories.add(id); else ui.selectedMemories.delete(id); updateMemorySelection() }
  if (event.target.id === 'select-all') { for (const t of memoryItems()) { if (event.target.checked) ui.selectedMemories.add(t.id); else ui.selectedMemories.delete(t.id) } updateMemoryRows() }
})
app.addEventListener('keydown',event => {
  if (event.target.id === 'composer-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); sendMessage() }
})
app.addEventListener('submit',event => {
  event.preventDefault()
  if (event.target.id === 'message-form') return sendMessage()
  const values = Object.fromEntries(new FormData(event.target))
  for (const key in values) values[key] = values[key].trim()
  if (Object.values(values).some(value => !value)) { const field = [...event.target.elements].find(el => el.required && !el.value.trim()); if (field) { field.setCustomValidity('请填写有效内容'); field.reportValidity(); field.addEventListener('input',() => field.setCustomValidity(''),{ once: true }) } return }
  if (event.target.id === 'new-discussion-form') { const id = addThread(values.title,values.platform); ui.draft = ''; navigate('discussion',id) }
  if (event.target.id === 'record-form') { const c = { ...values,id: nextChangeId(),status: '待确认',confidence: null,evidence: 0,threadId: null,source: `${platforms[values.platform].name} · 手动记录`,date: new Date().toISOString() }; data.changes.unshift(c); persist(); ui.status = 'all'; ui.factoryQuery = ''; navigate('factory',c.id) }
})
app.addEventListener('click',event => {
  const el = event.target.closest('button, [data-action]')
  if (!el) return
  if (el.dataset.workspace) {
    ui.workspace = el.dataset.workspace
    data = workspaceData[ui.workspace]
    ui.workspaceMenu = false
    ui.threadId = data.threads[0]?.id || ''
    ui.changeId = data.changes[0]?.id
    ui.platform = 'all'; ui.kind = 'all'; ui.status = 'all'; ui.memoryQuery = ''; ui.factoryQuery = ''; ui.inspectorOpen = false
    persist(); render(); return
  }
  if (el.dataset.kind) { ui.kind = el.dataset.kind; render(); return }
  if (el.dataset.status) { ui.status = el.dataset.status; updateChangeRows(); document.querySelectorAll('[data-status]').forEach(b => b.setAttribute('aria-selected',String(b.dataset.status === ui.status))); return }
  if (el.dataset.change) { navigate('factory',el.dataset.change); return }
  switch (el.dataset.action) {
    case 'menu': ui.sidebarOpen = !ui.sidebarOpen; render(); break
    case 'workspace-menu': ui.workspaceMenu = !ui.workspaceMenu; render(); break
    case 'platform': ui.platform = el.dataset.platform; ui.kind = 'all'; ui.memoryQuery = ''; navigate('memory'); break
    case 'clear-memory': ui.platform = 'all'; ui.kind = 'all'; ui.memoryQuery = ''; render(); break
    case 'clear-factory': ui.status = 'all'; ui.factoryQuery = ''; if (!change()) ui.changeId = data.changes[0]?.id; render(); break
    case 'new-discussion': newDiscussion(); break
    case 'record-change': recordDialog(); break
    case 'close-dialog': document.querySelector('#editor-dialog').close(); break
    case 'form-candidate': formCandidate(); break
    case 'close-inspector': ui.inspectorOpen = false; document.querySelector('#inspector').classList.remove('inspector-open'); document.querySelector('.panel-scrim').hidden = true; break
    case 'adopt':
    case 'review': { const c = change(); if (!c) break; c.status = el.dataset.action === 'adopt' ? '已采用' : '需回顾'; c.date = new Date().toISOString(); ui.status = 'all'; persist(); render(); notify(c.status === '已采用' ? '已确认采用这条判断' : '已移入需回顾'); break }
    case 'change-source': { const c = change(); if (!c) break; if (c.threadId && data.threads.some(t => t.id === c.threadId)) navigate('discussion',c.threadId); else openDialog('触发现场', `<div class="source-dialog">${logo(c.platform)}<h3>${esc(c.source)}</h3><p>${c.threadId ? '关联对话已从记忆列表移除。' : '此条变化由手动记录创建。'}</p><p>${esc(c.after)}</p></div>`); break }
    case 'show-context': ui.contextOpen = true; document.querySelector('.discussion-context').classList.add('context-open'); break
    case 'close-context': ui.contextOpen = false; document.querySelector('.discussion-context').classList.remove('context-open'); break
    case 'delete-memories': openDialog('删除所选记忆', `<div class="confirm-body"><p>从当前工作区移除 ${ui.selectedMemories.size} 条记忆？</p><p class="muted">关联的认知变化仍会保留来源摘要。</p><footer><button class="quiet-button" data-action="close-dialog">取消</button><button class="danger-button" data-action="confirm-delete">确认删除</button></footer></div>`); break
    case 'confirm-delete': data.threads = data.threads.filter(t => !ui.selectedMemories.has(t.id)); ui.selectedMemories.clear(); if (!data.threads.some(t => t.id === ui.threadId)) ui.threadId = data.threads[0]?.id || ''; persist(); render(); notify('所选记忆已移除'); break
    case 'fox': ui.foxOpen = !ui.foxOpen; document.querySelector('.fox-bubble').hidden = !ui.foxOpen; el.setAttribute('aria-expanded',String(ui.foxOpen)); if (ui.foxOpen) document.querySelector('#fox-input').focus(); break
    case 'fox-capture':
    case 'fox-deepen': { const text = ui.foxDraft.trim(); if (!text) { document.querySelector('#fox-input').focus(); notify('先写下一句想法'); break } const id = addThread(text); data.foxCount += 1; persist(); ui.foxDraft = ''; ui.foxOpen = false; if (el.dataset.action === 'fox-deepen') navigate('discussion',id); else { render(); notify('已加入记忆列表') } break }
  }
})
window.addEventListener('hashchange',readRoute)
document.addEventListener('keydown',event => {
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return
  ui.foxOpen = false; ui.sidebarOpen = false; ui.contextOpen = false; ui.inspectorOpen = false; render()
})
readRoute()
