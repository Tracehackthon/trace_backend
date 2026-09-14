import { mountRiverScene } from './river-scene.js'
import { readOAuthCallback } from './oauth-callback.js'

const app = document.querySelector('#app')
let riverScene

const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`
const traceMark = () => '<img class="trace-mark" src="./public/logos/trace.png" alt="" width="42" height="42" />'

function loginTemplate() {
  return `<main class="auth-shell">
    <div class="auth-frame">
      <img class="river-backdrop" src="./public/scenes/river.png" alt="" fetchpriority="high" />
      <canvas class="river-scene" aria-hidden="true"></canvas>
      <header class="auth-header">
          <a class="auth-brand" href="/" aria-label="Trace 首页"><span class="auth-brand-mark">${traceMark()}</span><h1>Trace</h1></a>
      </header>
      <section class="auth-welcome" aria-labelledby="auth-title">
        <h2 id="auth-title"><span>让思想蜕变，</span><span>认知不再局限</span></h2>
        <p class="auth-lede">Trace认知助手帮你留下一段触动、一个问题或工作中的惊喜发现</p>
        <div class="auth-entry">
          <button class="zhihu-login" id="zhihu-login" type="button"><img src="./public/logos/zhihu.svg" alt="" /><span>进入体验 · 访客模式</span>${icon('arrow-up-right')}</button>
          <p class="auth-register">登录 / 注册你的 Trace 账号</p>
          <p class="auth-notice">${icon('shield-check')}演示环境为访客模式 · 正式版支持知乎安全授权</p>
          <p class="auth-status" id="auth-status" role="status" aria-live="polite"></p>
        </div>
      </section>
      <div class="auth-journey-wrap" aria-hidden="true">
        <ol class="auth-journey"><li><span class="journey-marker"></span><span>留下一点</span></li><li><span class="journey-marker marker-warm"></span><span>接着想</span></li><li><span class="journey-marker"></span><span>带去用</span></li><li><span class="journey-marker"></span><span>让结果回来</span></li></ol>
      </div>
      <footer class="auth-footer"><span>Trace · 思考的下一程</span><strong class="footer-emergence">认知涌现，点亮Trace飞鸟效应</strong><span>${icon('lock-keyhole')}知乎安全授权</span></footer>
    </div>
  </main>`
}

function renderLogin(message = '') {
  riverScene?.destroy()
  app.innerHTML = loginTemplate()
  document.querySelector('#auth-status').textContent = message
  window.lucide?.createIcons()
  document.querySelector('#zhihu-login').addEventListener('click', bootGuest)
  riverScene = mountRiverScene(document.querySelector('.river-scene'))
}

async function startZhihuLogin() {
  const button = document.querySelector('#zhihu-login')
  const status = document.querySelector('#auth-status')
  button.disabled = true
  button.classList.add('is-loading')
  status.textContent = '正在连接知乎…'
  try {
    const redirectUri = `${location.origin}/callback`
    const response = await fetch(`/api/auth/zhihu/url?redirect_uri=${encodeURIComponent(redirectUri)}`)
    const result = await response.json()
    if (!response.ok || !result.authorize_url) throw new Error(result.error || '无法生成授权地址')
    location.href = result.authorize_url
  } catch (error) {
    button.disabled = false
    button.classList.remove('is-loading')
    status.textContent = error.message || '授权暂时不可用，请稍后重试'
  }
}

async function handleCallback() {
  let callback
  try { callback = readOAuthCallback(location.search, location.hash) } catch (error) { return renderLogin(error.message) }
  if (callback.error) {
    history.replaceState({}, '', '/')
    return renderLogin(callback.error === 'access_denied' ? '你已取消知乎授权，可以重新登录' : '知乎未完成授权，请重新登录')
  }
  const { code, state } = callback
  if (!code) return renderLogin('当前页面缺少知乎授权码，请返回首页重新发起登录')
  if (!state) return renderLogin('知乎回调缺少登录校验参数，无法验证本次登录，请重新发起授权')
  riverScene?.destroy()
  app.innerHTML = `<main class="callback-state"><div class="callback-spinner"></div><p>正在完成知乎授权…</p></main>`
  try {
    const response = await fetch('/api/auth/zhihu/callback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, state, redirect_uri: `${location.origin}/callback` }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || '授权失败')
    history.replaceState({}, '', '/')
    await bootWorkspace()
  } catch (error) {
    history.replaceState({}, '', '/?auth_error=callback')
    renderLogin(error.message || '授权失败，请重新尝试')
  }
}

async function bootWorkspace() {
  const response = await fetch('/api/auth/me', { cache: 'no-store' })
  if (!response.ok) return renderLogin()
  const result = await response.json()
  window.traceUser = result.user
  riverScene?.destroy()
  await import('./workspace.js')
}

async function bootGuest() {
  window.traceUser = { uid: 'trace-visitor', fullname: 'Trace 体验访客', headline: '知乎黑客松 · 演示', avatar_path: '', provider: 'guest' }
  riverScene?.destroy()
  await import('./workspace.js')
}
bootGuest()
