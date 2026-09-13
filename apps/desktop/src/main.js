const params = new URLSearchParams(window.location.search)

const defaultObservation = {
  id: 'observation-agent-collaboration',
  text: '多 Agent 交接时，与其传递聊天摘要，不如传递带证据和待回答问题的决策卡。',
  status: '待确认',
  source: 'DeepSeek Harness · Cursor 实验 #18',
}

const incomingObservation = {
  id: params.get('observationId') || defaultObservation.id,
  text: params.get('text') || defaultObservation.text,
  status: params.get('status') || defaultObservation.status,
  source: params.get('source') || defaultObservation.source,
}

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

const state = {
  activeThreadId: incomingObservation.id,
  candidateState: '讨论中',
  messages: [
    {
      role: 'user',
      content: incomingObservation.text,
      meta: `来自 ${incomingObservation.source}`,
    },
    {
      role: 'agent',
      content: '我先不急着把它总结成方法。你现在抓到的核心张力是：信息交接得越完整，接手 Agent 的理解成本反而可能越高。我们可以先区分两个问题——究竟是摘要质量不够，还是“摘要”本身就不是适合协作交接的载体？',
      prompts: ['找一个反例', '拆开两个问题', '查找知乎前例'],
    },
  ],
}

const relatedThreads = [
  { id: incomingObservation.id, title: incomingObservation.text, meta: '正在讨论', active: true },
  { id: 'thread-positioning', title: 'Trace 不是知识库，而是思考沉淀层', meta: '昨天 · 候选判断' },
  { id: 'thread-evidence', title: '检索结果必须附带可追溯证据', meta: '9 月 11 日 · 已采用' },
]

function renderMessage(message, index) {
  const isAgent = message.role === 'agent'
  const prompts = message.prompts?.length
    ? `<div class="message-prompts">${message.prompts.map((prompt) => `<button type="button" data-prompt="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`).join('')}</div>`
    : ''
  return `
    <article class="message ${isAgent ? 'message-agent' : 'message-user'}" data-message-index="${index}">
      <div class="message-avatar">${isAgent ? '<img src="/public/liukanshan.png" alt="刘看山" />' : '你'}</div>
      <div class="message-content">
        <div class="message-role">${isAgent ? 'Trace Agent' : '现场观察'}</div>
        <p>${escapeHtml(message.content)}</p>
        ${message.meta ? `<small>${escapeHtml(message.meta)}</small>` : ''}
        ${prompts}
      </div>
    </article>`
}

function appTemplate() {
  return `
    <div class="desktop-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark"><img src="/public/liukanshan.png" alt="刘看山" /></div>
          <div><strong>Trace</strong><span>让想法继续生长</span></div>
        </div>

        <button class="new-thread" type="button" id="new-thread-button"><span>＋</span> 新建讨论</button>

        <div class="sidebar-label">最近的思考</div>
        <nav class="thread-list">
          ${relatedThreads.map((thread) => `
            <button class="thread-item ${thread.active ? 'thread-item-active' : ''}" type="button" data-thread-id="${escapeHtml(thread.id)}">
              <span class="thread-status-dot"></span>
              <span><strong>${escapeHtml(thread.title)}</strong><small>${escapeHtml(thread.meta)}</small></span>
            </button>`).join('')}
        </nav>

        <div class="sidebar-footer">
          <span class="runtime-dot"></span>
          <span><strong>UI 原型已连接</strong><small>Mock Agent · 未写入长期记忆</small></span>
        </div>
      </aside>

      <main class="workspace">
        <header class="workspace-header">
          <div>
            <div class="eyebrow">深度讨论 · ${escapeHtml(incomingObservation.status)}</div>
            <h1>${escapeHtml(incomingObservation.text)}</h1>
          </div>
          <div class="header-actions">
            <button class="quiet-button" type="button" id="show-source-button">查看原始现场</button>
            <button class="primary-button" type="button" id="candidate-button">形成候选</button>
          </div>
        </header>

        <section class="conversation" id="conversation" aria-live="polite">
          <div class="discussion-intro">
            <span>本轮目标</span>
            <p>把一句随手观察推进成更清楚的判断：它为什么成立、在哪里不成立，以及下一步如何验证。</p>
          </div>
          <div id="message-list">${state.messages.map(renderMessage).join('')}</div>
        </section>

        <footer class="composer-shell">
          <div class="composer">
            <textarea id="composer-input" rows="1" placeholder="继续补充你的观察，或直接追问一个冲突……"></textarea>
            <div class="composer-bottom">
              <div class="composer-tools">
                <button type="button" title="添加现场">＋</button>
                <button type="button" title="引用证据">⌁</button>
                <span>Enter 发送 · Shift + Enter 换行</span>
              </div>
              <button class="send-button" id="send-button" type="button" aria-label="发送">↑</button>
            </div>
          </div>
          <p>Trace 只在你明确选择后沉淀内容；当前演示回复来自 Mock Agent。</p>
        </footer>
      </main>

      <aside class="context-panel">
        <div class="context-heading">
          <div><span class="eyebrow">THINKING CONTEXT</span><h2>这条想法的现场</h2></div>
          <button class="icon-button" id="close-context-button" type="button" aria-label="关闭现场">×</button>
        </div>

        <section class="context-card source-card">
          <div class="card-label">原始现场</div>
          <p>${escapeHtml(incomingObservation.text)}</p>
          <div class="source-meta"><span>${escapeHtml(incomingObservation.source)}</span><span>刚刚</span></div>
        </section>

        <section class="context-card">
          <div class="card-label">当前理解</div>
          <div class="understanding-row"><span>观察清晰度</span><strong>68%</strong></div>
          <div class="progress"><span style="width:68%"></span></div>
          <ul class="signal-list">
            <li><span class="signal signal-green"></span>问题对象已经明确</li>
            <li><span class="signal signal-yellow"></span>适用范围仍需验证</li>
            <li><span class="signal signal-gray"></span>缺少一次失败反例</li>
          </ul>
        </section>

        <section class="context-card">
          <div class="card-label">待回答问题</div>
          <ol class="question-list">
            <li>决策卡比聊天摘要多保留了什么？</li>
            <li>什么类型的任务不适合这种交接？</li>
            <li>怎样证明下一个 Agent 理解得更快？</li>
          </ol>
        </section>

        <section class="candidate-card" id="candidate-card">
          <div><span class="candidate-dot"></span><span id="candidate-state">${state.candidateState}</span></div>
          <strong>它还不是长期方法</strong>
          <p>继续讨论、补充证据后，再由你决定是否进入候选变化。</p>
        </section>
      </aside>
    </div>

    <div class="toast" id="toast" role="status"></div>`
}

document.querySelector('#app').innerHTML = appTemplate()

const messageList = document.querySelector('#message-list')
const conversation = document.querySelector('#conversation')
const composerInput = document.querySelector('#composer-input')
const sendButton = document.querySelector('#send-button')
const contextPanel = document.querySelector('.context-panel')
const toast = document.querySelector('#toast')

function showToast(message) {
  toast.textContent = message
  toast.classList.add('toast-visible')
  window.setTimeout(() => toast.classList.remove('toast-visible'), 2200)
}

function appendMessage(message) {
  state.messages.push(message)
  messageList.insertAdjacentHTML('beforeend', renderMessage(message, state.messages.length - 1))
  conversation.scrollTo({ top: conversation.scrollHeight, behavior: 'smooth' })
}

function sendMessage(text) {
  const content = text.trim()
  if (!content) return
  appendMessage({ role: 'user', content })
  composerInput.value = ''
  composerInput.style.height = 'auto'
  sendButton.disabled = true

  window.setTimeout(() => {
    appendMessage({
      role: 'agent',
      content: `我把你刚才补充的“${content}”放回原始观察里看。它让问题更具体了，但还不能直接证明这个判断成立。下一步最有价值的是找一个不适用决策卡的任务，看看边界究竟出现在任务长度、协作者数量，还是信息变化速度。`,
      prompts: ['继续追问边界', '把它变成验证问题', '暂时停在这里'],
    })
    sendButton.disabled = false
  }, 420)
}

sendButton.addEventListener('click', () => sendMessage(composerInput.value))
composerInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage(composerInput.value)
  }
})
composerInput.addEventListener('input', () => {
  composerInput.style.height = 'auto'
  composerInput.style.height = `${Math.min(composerInput.scrollHeight, 150)}px`
})

document.addEventListener('click', (event) => {
  const promptButton = event.target.closest('[data-prompt]')
  if (promptButton) {
    composerInput.value = promptButton.dataset.prompt
    composerInput.focus()
  }
})

document.querySelector('#candidate-button').addEventListener('click', () => {
  state.candidateState = state.candidateState === '候选中' ? '讨论中' : '候选中'
  document.querySelector('#candidate-state').textContent = state.candidateState
  document.querySelector('#candidate-card').classList.toggle('candidate-card-active', state.candidateState === '候选中')
  showToast(state.candidateState === '候选中' ? '已进入候选，但尚未采用或写入长期能力。' : '已撤回候选，继续保持讨论状态。')
})

document.querySelector('#show-source-button').addEventListener('click', () => contextPanel.classList.remove('context-panel-hidden'))
document.querySelector('#close-context-button').addEventListener('click', () => contextPanel.classList.add('context-panel-hidden'))
document.querySelector('#new-thread-button').addEventListener('click', () => {
  composerInput.value = ''
  composerInput.focus()
  showToast('新讨论入口已准备；V0.1 不会自动保存空会话。')
})

for (const threadButton of document.querySelectorAll('[data-thread-id]')) {
  threadButton.addEventListener('click', () => {
    if (threadButton.dataset.threadId === state.activeThreadId) return
    showToast('历史讨论切换将在接入 Trace Runtime 后开放。')
  })
}
