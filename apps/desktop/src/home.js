import { animate, svg as animeSvg } from './vendor/anime.esm.js'
import { createState, transition, ENTRIES, LAYOUTS, PATHS, NODE_POSITIONS } from './home-model.js'
import { icon, mark } from './home-icons.js'
import { mountSceneGlass } from './home/scene-glass.js'

export function mountHome({ snapshot, entries = {}, onOpen, onAll, onSearch, onCapture, onProfile, onWorks, onMatters, onDraft, product = false } = {}) {
const controller = new AbortController()
const timers = new Set()
const setTimeout = (callback, delay) => { const id = window.setTimeout(() => { timers.delete(id); callback() }, delay); timers.add(id); return id }
const clearTimeout = id => { timers.delete(id); window.clearTimeout(id) }
const listen = (target, event, callback, options = {}) => target.addEventListener(event, callback, { ...options, signal: controller.signal })
const $ = s => document.querySelector(s)
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const backgroundUrl = new URL('../public/home/environment.png', import.meta.url).href
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
let state = snapshot?.state || createState(new URLSearchParams(location.search).get('state'))
let prototypePreview = !product && (snapshot?.prototypePreview ?? new URLSearchParams(location.search).has('state'))
if(product) state=createState('overview')
let actionRevision = 0
let toastTimer
let lastFocus
const drafts = new Map(snapshot?.drafts || [])
const materials = new Map()
const animations = new Set()
const bubblePaths = [
  'M75 21 C177 -8 383 24 514 19 C679 9 832 1 928 57 C1010 101 1007 210 917 257 C831 299 650 266 489 279 C289 302 138 299 57 235 C-10 182 -2 65 75 21Z',
  'M97 24 C235 -6 414 33 543 16 C751 -12 900 10 958 79 C1033 170 969 270 881 284 C731 315 610 267 459 270 C238 292 110 270 43 219 C-20 157 3 54 97 24Z',
  'M105 13 C256 -5 394 33 534 22 C721 0 849 -6 936 70 C1018 139 1007 232 911 276 C794 307 634 272 480 281 C265 293 127 266 48 215 C-14 160 5 43 105 13Z',
]
const fullPath = 'M68 4 C267 -3 740 6 928 6 C981 6 998 43 996 86 L996 232 C996 282 970 297 914 296 L85 296 C23 299 3 273 4 227 L4 78 C3 34 19 12 68 4Z'
const foot = { overview: [443,407], thinking: [521,379], growth: [867,521], work: [896,344], return: [1210,485] }

document.title = 'Trace · 把此刻的一点，带到以后'
document.body.classList.add('home-page')
$('#app').innerHTML = `
  <main class="home-viewport" aria-label="Trace 首页">
    <div class="scene" id="home-scene" data-state="${state.mode}">
      <header class="home-header">
        <button class="wordmark" type="button" data-action="home" aria-label="Trace，返回首页"><span class="brand-tile">${mark}</span><span>Trace</span></button>
        <nav class="home-nav" aria-label="首页导航">
          <button data-action="matters" type="button">在意的事</button>
          <button data-action="all" type="button">全部痕迹</button>
          <button data-action="project" type="button"${product?' class="home-nav-active"':''}><i></i><span>${product?'工作现场':'Codex · harness'}</span></button>
        </nav>
      </header>
      <section class="home-hero" aria-labelledby="home-title">
        <h1 id="home-title">把此刻的一点，带到以后<span>。</span></h1>
        <p>留下一段触动、一个问题或工作中的发现；继续想，带去用，再让结果回来。</p>
      </section>
      <form class="home-composer" id="capture-form">
        <label class="sr-only" for="capture-input">留下一点</label>
        <textarea id="capture-input" rows="1" placeholder="写一句，贴一段，或者带回一个结果……" maxlength="3000"></textarea>
        <div class="composer-bottom"><div class="source-pills">${product?`<span class="web-capture-hint">不必先想清楚，原话会被保留。</span>`:`<button type="button" data-action="source">${icon('link')}知乎原文</button><button type="button" data-action="project">${icon('layers')}Codex · harness</button>`}</div><button type="submit" class="send-orb" aria-label="留下这段想法" disabled>${icon('arrow')}</button></div>
      </form>
      <svg class="scene-paths" viewBox="0 0 1672 941" aria-hidden="true">
        <defs><linearGradient id="flow-color"><stop offset="0" stop-color="#fff5b0" stop-opacity="0"/><stop offset=".5" stop-color="#e9a733"/><stop offset="1" stop-color="#fff5b0" stop-opacity="0"/></linearGradient><radialGradient id="node-gold"><stop stop-color="#ffc45e"/><stop offset="1" stop-color="#e69c22"/></radialGradient><filter id="node-halo" x="-300%" y="-300%" width="700%" height="700%"><feGaussianBlur stdDeviation="10"/></filter></defs>
        <g id="threads">${PATHS.overview.map((d,i) => `<path class="thread-path thread-${i}" data-path="${i}" d="${d}"/><path class="thread-light" data-light="${i}" d="${d}" pathLength="1"/>`).join('')}</g>
        <g id="scene-nodes">${NODE_POSITIONS.overview.map(([x,y],i) => `<g class="scene-node node-${i} ${i===2||i===3?'gold':''}" data-dot="${i}" transform="translate(${x} ${y})"><circle class="node-bloom" r="17"/><circle class="node-disc" r="${i===0?11:8}"/><circle class="node-pin" r="2.2"/></g>`).join('')}</g>
        <path id="bird-route" fill="none" stroke="none" d="M443 407 L443 407"/>
      </svg>
      <section class="thought-field" aria-label="在意的事">${Object.entries(ENTRIES).map(([id,entry],i) => `<button class="thought-bubble ${entry.warm?'warm':''}" data-entry="${id}" data-shape="${i%3}" type="button" hidden><span class="bubble-material" aria-hidden="true"></span><span class="bubble-content"><span class="bubble-icon">${icon(entry.icon)}</span><span class="bubble-copy"><strong>${escape(entry.title)}</strong><span class="bubble-subtitle">${escape(entry.subtitle)}</span></span></span></button>`).join('')}</section>
      <section class="detail-card" id="detail-card" aria-labelledby="detail-title" hidden><div class="detail-material" aria-hidden="true"></div><div id="detail-content"></div></section>
      <div class="scene-bird" id="scene-bird" aria-hidden="true"><img class="bird-perched" src="./public/home/bird-perched.png" alt=""/><img class="bird-flying" src="./public/home/bird-takeoff.png" alt=""/></div>
      <button class="profile-button" data-action="about" type="button" aria-label="${product?'个人与设置':'关于此原型'}">${icon('user')}</button>
      <button class="scene-back" data-action="home" type="button" hidden>${icon('back')}收回到首页</button>
      <button class="prototype-caption" data-action="${product?'matters':'preview'}" type="button">${product?'在意的事 · 查看脉络 →':'交互原型 · 示例内容 · 仅本次会话'}</button>
      ${product&&!Object.values(entries).some(e => e?.title && e.title.trim() && !/^[\d\s.,;:!?-]+$/.test(e.title.trim()))?`<div class="web-home-empty" role="region" aria-label="入门引导"><strong>先留下一点，接续就从这里开始。</strong><span>把你的原话、判断或带入的工作写下来——以后，对照与结果会在同一件事里相遇。</span><button type="button" data-action="focus-composer">立刻写下第一点</button></div>`:''}
    </div>
    <section class="utility-panel" id="utility-panel" aria-labelledby="utility-title" hidden></section>
    <div class="home-toast" id="home-toast" role="status" aria-live="polite"></div>
    <p class="sr-only" id="scene-announcement" aria-live="polite"></p>
  </main>`

const scene = $('#home-scene')
const bird = $('#scene-bird')
const detail = $('#detail-card')
const nodeLayer=document.createElementNS('http://www.w3.org/2000/svg','svg')
nodeLayer.setAttribute('viewBox','0 0 1672 941');nodeLayer.setAttribute('class','scene-nodes-layer');nodeLayer.setAttribute('aria-hidden','true')
nodeLayer.append($('#scene-nodes'));scene.insertBefore(nodeLayer,bird)
const glassPath = el => bubblePaths[Number(el.dataset.shape)||0]

function duration(ms) { return reduced.matches || document.documentElement.dataset.reduceMotion==='true' ? 0 : ms }
function track(animation) { animations.add(animation); animation.then?.(() => animations.delete(animation)); return animation }
function cancelAnimations() { for (const a of animations) a.cancel(); animations.clear() }
function notify(text) { clearTimeout(toastTimer); const t=$('#home-toast'); t.textContent=text; t.classList.add('visible'); toastTimer=setTimeout(()=>t.classList.remove('visible'),3500) }
function ensureGlass(el, path, tone='cool') {
  const host = el.querySelector('.bubble-material,.detail-material')
  if (!materials.has(el)) materials.set(el, mountSceneGlass({host,scene:$('.home-viewport'),backgroundUrl,path,tone}))
  else materials.get(el).refresh()
}
function selectedEntry() { return ENTRIES[state.active] || ENTRIES.thought }
function draftKey() { return `${state.mode}:${state.mode==='work'?'work':state.active}` }
function originalContext() { return state.active==='thought' ? state.captured || '自己想保留的是个人表达，还是文章中的原始现场？' : selectedEntry().subtitle }
function currentTitle() { return state.active==='thought' && state.captured ? state.captured : state.active==='insight'&&state.insight ? state.insight : selectedEntry().title }
function row(symbol, title, text) { return `<div class="context-row"><span class="context-icon">${icon(symbol)}</span><div><h3>${escape(title)}</h3><p>${escape(text)}</p></div></div>` }
function detailsMarkup() {
  const work = state.mode === 'work'
  const title = work ? ENTRIES.work.title : currentTitle()
  let rows
  if (work) rows = row('file','带入工作的判断',state.insight || '工作界面不应该复制一个新的 Agent，而应该显示原生 Agent 当前工作的区域，以及被带入工作的沉淀内容。') + row('message','工作中发生了什么','新的首页方案已经形成，但还没有表现一条思考如何被重新拿起。') + row('sprout','尚未做出的判断','气泡应该原位展开，还是进入独立的详情空间？')
  else if (state.captured || state.active !== 'thought') rows = row('clock','上次停在',originalContext()) + row('message','为什么现在回来','这件事还没有结束。把此刻出现的感受，接回它原来的现场。') + row('sprout','此刻的变化','你可以继续补充，也可以写下一个新的理解；原型不会替你自动采用判断。')
  else rows = row('clock','上次停在','我还无法判断，自己想保留的是个人表达，还是文章中的原始现场。') + row('message','为什么现在回来','你刚刚收藏了一篇相关回答，其中再次出现了收藏之后很少重新使用的问题。') + row('sprout','此刻的变化','之前关注的是怎样保存，现在可能真正的问题是：什么情形会让它重新出现。')
  return `<div class="detail-topline"><span class="detail-status ${work?'warm-status':''}"><i></i>${work?'正在接续工作':'正在接续'}</span><button type="button" class="detail-close" data-action="home" aria-label="收起详情">${icon('close')}</button></div>
    <h2 id="detail-title">${escape(title)}</h2>
    ${work?`<div class="work-meta"><span>${icon('box')}项目 · harness</span><span>${icon('layers')}Agent · Codex</span><span>${icon('clock')}刚有新变化</span></div>`:''}
    <div class="detail-context">${rows}</div>
    <form id="detail-form" class="detail-composer"><label for="detail-input" class="sr-only">${work?'带回工作结果':'接着这里说'}</label><span class="input-link">${icon('link')}</span><textarea id="detail-input" rows="1" maxlength="3000" placeholder="${work?'补充实践发现，或者把结果带回来……':'接着这里说，或者带回一个新的变化……'}">${escape(drafts.get(draftKey())||'')}</textarea><button class="send-orb" type="submit" aria-label="${work?'带回结果':'形成新的理解'}" ${drafts.get(draftKey())?.trim()?'':'disabled'}>${icon('arrow')}</button></form>
    <div class="detail-actions">${work?`<button type="button" data-action="native-work">${icon('play')}回到 Codex 继续</button><button type="button" data-action="reconsider">${icon('layers')}更新判断</button><button type="button" data-action="result-input">${icon('briefcase')}带回结果</button>`:`<button type="button" data-action="discuss">${icon('play')}继续想</button><button type="button" data-action="source">${icon('layers')}查看原现场</button><button type="button" data-action="work">${icon('briefcase')}带去工作</button>`}</div>`
}

function render(immediate=false, oldState=null) {
  scene.dataset.state=state.mode
  const expanded=state.mode==='thinking'||state.mode==='work'
  $('#capture-form').hidden=expanded
  $('.scene-back').hidden=state.mode==='overview'
  const layout=LAYOUTS[state.mode]
  for (const el of document.querySelectorAll('[data-entry]')) {
    const id=el.dataset.entry, box=layout[id]
    if(!box || (product&&!entries[id])){ el.hidden=true; continue }
    const wasHidden=el.hidden; el.hidden=false
    el.style.removeProperty('opacity')
    el.classList.toggle('subdued', expanded || (state.mode==='growth' && ['fresh','handoff','work'].includes(id)) || (state.mode==='return'&&['fresh','handoff','thought'].includes(id)))
    el.classList.toggle('result-bubble',id==='result')
    el.classList.toggle('focused-bubble',id==='insight'||id==='result')
    let title = id==='thought'&&state.captured ? state.captured : id==='insight'&&state.insight ? state.insight : id==='result'&&state.result ? state.result : ENTRIES[id].title
    if (!prototypePreview && entries[id]) title = entries[id].title
    if(entries[id]) el.dataset.matterId=entries[id].matterId
    el.querySelector('strong').textContent=title
    el.setAttribute('aria-label',title)
    el.title=title
    const subtitle=el.querySelector('.bubble-subtitle')
    if(subtitle) subtitle.textContent=!prototypePreview&&entries[id] ? entries[id].subtitle : id==='work'&&state.mode==='return'?'原判断：不复制一个新的 Agent 工作界面':ENTRIES[id].subtitle
    if(id==='result') {
      el.querySelector('.bubble-content').innerHTML=`<div class="return-copy"><span class="return-label"><i></i>带回的结果</span><strong>${escape(title)}</strong><p>${escape(state.sampleResult?ENTRIES.result.subtitle:'实践中的新发现，已经回到这件事里。')}</p><span class="result-badge">${icon('check')}${state.sampleResult?'得到验证 · 示例':'已带回 · 待再判断'}</span><small>原判断 → 带去工作 → 实践结果 → 更新理解</small></div>`
    }
    const [left,top,width,height]=box
    if(immediate||wasHidden){Object.assign(el.style,{left:`${left}px`,top:`${top}px`,width:`${width}px`,height:`${height}px`})}
    else track(animate(el,{left,top,width,height,duration:duration(720),ease:'out(4)'}))
    ensureGlass(el,()=>glassPath(el),ENTRIES[id].warm?'warm':'cool')
    if(wasHidden&&!immediate) track(animate(el,{opacity:[0,1],duration:duration(800),delay:duration(130),ease:'out(3)',onComplete:()=>el.style.removeProperty('opacity')}))
  }
  const leavingDetail=!expanded&&!immediate&&['thinking','work'].includes(oldState?.mode)
  if(leavingDetail) {
    const [left,top,width,height]=LAYOUTS.overview[oldState.active]||LAYOUTS.overview.thought
    const revision=actionRevision
    track(animate($('#detail-content'),{opacity:0,duration:duration(160),ease:'out(3)'}))
    track(animate(detail,{left,top,width,height,duration:duration(650),ease:'out(4)',onComplete:()=>{if(revision===actionRevision)detail.hidden=true}}))
  } else detail.hidden=!expanded
  if(expanded) {
    $('#detail-content').style.removeProperty('opacity')
    $('#detail-content').innerHTML=detailsMarkup()
    detail.classList.toggle('work-detail',state.mode==='work')
    const dest=state.mode==='work'?{left:474,top:350,width:773,height:548}:{left:462,top:336,width:805,height:522}
    if(!immediate && oldState && !['thinking','work'].includes(oldState.mode)) {
      const origin=LAYOUTS[oldState.mode][state.active] || LAYOUTS.overview.thought
      Object.assign(detail.style,{left:`${origin[0]}px`,top:`${origin[1]}px`,width:`${origin[2]}px`,height:`${origin[3]}px`})
      track(animate(detail,{...dest,duration:duration(720),ease:'out(4)'}))
      track(animate($('#detail-content'),{opacity:[0,1],translateY:[10,0],duration:duration(380),delay:duration(300),ease:'out(3)'}))
    } else Object.assign(detail.style,Object.fromEntries(Object.entries(dest).map(([k,v])=>[k,`${v}px`])))
    ensureGlass(detail,fullPath)
  }
  for(let i=0;i<5;i++) for(const selector of [`[data-path="${i}"]`,`[data-light="${i}"]`]) {
    const path=$(selector),d=PATHS[state.mode][i]
    if(immediate) path.setAttribute('d',d)
    else track(animate(path,{d,duration:duration(760),ease:'out(3)'}))
  }
  NODE_POSITIONS[state.mode].forEach(([x,y],i)=>{
    const dot=$(`[data-dot="${i}"]`)
    dot.removeAttribute('transform')
    if(immediate) dot.style.transform=`translate(${x}px,${y}px)`
    else track(animate(dot,{translateX:x,translateY:y,duration:duration(760),ease:'out(3)'}))
  })
  const end=foot[state.mode]
  if(immediate) {bird.style.transform=`translate(${end[0]}px,${end[1]}px)`}
  else {
    const start=foot[oldState?.mode||'overview']
    $('#bird-route').setAttribute('d',`M${start[0]} ${start[1]} Q${(start[0]+end[0])/2} ${Math.min(start[1],end[1])-100} ${end[0]} ${end[1]}`)
    bird.classList.add('flying')
    const {translateX,translateY}=animeSvg.createMotionPath($('#bird-route'))
    track(animate(bird,{translateX,translateY,duration:duration(950),ease:'inOutSine',onComplete:()=>bird.classList.remove('flying')}))
  }
  const revision=actionRevision
  setTimeout(()=>{if(revision!==actionRevision)return; for(const [el,material] of materials) if(!el.hidden) material.refresh(); if(expanded&&!immediate&&$('#utility-panel').hidden) $('#detail-input')?.focus({preventScroll:true})},duration(850))
  $('#scene-announcement').textContent=({overview:'首页总览',thinking:'已接续这段思考',growth:'新的理解已形成，尚未采用',work:'正在接续工作',return:'结果已回到原判断'})[state.mode]
}

function dispatch(action) {
  closeUtility()
  const old=state,next=transition(state,action)
  if(next===state)return
  actionRevision++; cancelAnimations(); state=next
  render(false,old)
  const revision=actionRevision
  if(state.mode==='overview') setTimeout(()=>{ if(revision!==actionRevision||!$('#utility-panel').hidden)return; lastFocus?.isConnected?lastFocus.focus({preventScroll:true}):$('#capture-input').focus({preventScroll:true}) },duration(780))
}
function openEntry(id) { if(!prototypePreview&&onOpen){onOpen(id);return} lastFocus=$(`[data-entry="${id}"]`); dispatch({type:'OPEN',id}) }
function discussion() {
  const url=new URL(location.href); url.search=''; url.searchParams.set('view','discussion'); url.searchParams.set('observationId',`home-${state.active}`); url.searchParams.set('text',currentTitle()); url.searchParams.set('source','Trace 首页 · 会话内原型'); location.assign(url.href)
}

function closeUtility() { const panel=$('#utility-panel'); if(panel.hidden)return; panel.hidden=true; panel.innerHTML=''; lastFocus?.focus?.({preventScroll:true}) }
function openUtility(kind) {
  const panel=$('#utility-panel'); lastFocus=document.activeElement
  const title=({search:'找回在意的事',all:'全部在意的事',project:'当前工作现场',source:'原来的现场',about:'关于这个原型',preview:'交互状态预览'})[kind]
  let body=''
  if(kind==='search'||kind==='all') body=`<label class="search-field">${icon('search')}<input id="home-search" placeholder="搜索思考、发现或工作……" autocomplete="off"/></label><div id="search-results"></div>`
  if(kind==='source') body=`<span class="utility-tag">示例现场 · 知乎原文</span><h3>${escape(currentTitle())}</h3><p>当时留下的不只是文章，也是“为什么会在意它”。</p><blockquote>${escape(originalContext())}</blockquote><p>这是概念图对应的示例摘要，尚未绑定真实原文链接。</p><button class="utility-primary" data-action="resume">从这里接着</button>`
  if(kind==='project') body=`<span class="utility-tag">项目 · harness</span><h3>Codex 工作现场</h3><p>此处演示思考如何带入工作、以及结果如何返回。当前未连接真实 Codex 会话，不会创建新 Agent 或发送消息。</p><button class="utility-primary" data-action="work">查看工作接续</button>`
  if(kind==='about') body=`<h3>留下一点，让它继续变化。</h3><p>当前为可交互的桌面原型。输入与状态仅存在本次页面会话；刷新后重置，不写入长期状态，也不调用真实模型。</p><p>需要继续讨论时，会进入项目原有的 Mock Agent 讨论界面。</p><button class="utility-primary" data-action="preview">查看六态演示</button>`
  if(kind==='preview') body=`<p>预览使用概念图中的示例内容，不代表真实工作已经完成或判断已经验证。</p><div class="state-previews">${[['overview','01 · 首页静默总览'],['thinking','02—03 · 唤醒与思考接续'],['growth','04 · 思考生长'],['work','05 · 工作接续'],['return','06 · 结果回流']].map(([mode,label])=>`<button data-preview-mode="${mode}" type="button">${escape(label)}${icon('arrow')}</button>`).join('')}</div>`
  panel.innerHTML=`<header><h2 id="utility-title">${title}</h2><button type="button" data-action="close-utility" aria-label="关闭面板">${icon('close')}</button></header>${body}`
  panel.hidden=false
  if(kind==='search'||kind==='all'){updateSearch('');$('#home-search').focus()}
  else panel.querySelector('button').focus()
}
function updateSearch(query) {
  const entries=Object.entries(ENTRIES).filter(([id,e])=>['thought','work','fresh','handoff'].includes(id)&&`${e.title}${e.subtitle}${id==='thought'?state.captured:''}`.toLowerCase().includes(query.trim().toLowerCase()))
  $('#search-results').innerHTML=entries.length?entries.map(([id,e])=>`<button type="button" class="search-result" data-open-entry="${id}">${icon(e.icon)}<span><strong>${escape(id==='thought'&&state.captured?state.captured:e.title)}</strong><small>${escape(e.subtitle)}</small></span></button>`).join(''):'<p class="empty-search">没有找到。试试换一个词，或者先留下一点。</p>'
}

listen(document,'click',event=>{
  const button=event.target.closest('button'); if(!button)return
  if(button.dataset.entry){openEntry(button.dataset.entry);return}
  if(button.dataset.openEntry){openEntry(button.dataset.openEntry);return}
  if(button.dataset.previewMode){prototypePreview=true;dispatch({type:'MODE',mode:button.dataset.previewMode});return}
  const action=button.dataset.action
  if(action==='all'&&onAll){onAll();return}
  if(action==='search'&&onSearch){onSearch();return}
  if(action==='about'&&onProfile){onProfile();return}
  if(action==='project'&&onWorks){onWorks();return}
  if(action==='matters'&&onMatters){onMatters();return}
  if(action==='focus-composer'){$('#capture-input')?.focus({preventScroll:true});return}
  if(['search','all','project','source','about','preview'].includes(action)){openUtility(action);return}
  if(action==='home')dispatch({type:'CLOSE'})
  if(action==='close-utility')closeUtility()
  if(action==='resume')dispatch({type:'OPEN',id:state.active})
  if(action==='work')dispatch({type:'WORK'})
  if(action==='discuss')discussion()
  if(action==='native-work')notify('原型尚未连接真实 Codex 会话；不会替你发送消息。')
  if(action==='reconsider'){dispatch({type:'OPEN',id:'thought'});notify('把实践发现放回原判断，继续分清。')}
  if(action==='result-input'){$('#detail-input')?.focus();notify('写下真实发生的结果，再按箭头带回来。')}
})
listen(document,'submit',event=>{
  if(!['capture-form','detail-form'].includes(event.target.id))return
  event.preventDefault()
  const input=event.target.querySelector('textarea'),text=input.value.trim()
  if(!text)return
  if(event.target.id==='capture-form'){if(!prototypePreview&&onCapture){onCapture(text);return}input.value='';event.target.querySelector('[type=submit]').disabled=true;dispatch({type:'CAPTURE',text})}
  else{drafts.delete(draftKey());dispatch({type:state.mode==='work'?'RETURN':'GROW',text})}
})
listen(document,'input',event=>{
  if(event.target.id==='home-search'){updateSearch(event.target.value);return}
  if(event.target.matches('textarea')){event.target.form.querySelector('[type=submit]').disabled=!event.target.value.trim();if(event.target.id==='detail-input')drafts.set(draftKey(),event.target.value)}
  if(event.target.id==='capture-input')onDraft?.(event.target.value)
})
listen(document,'keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(onSearch)onSearch();else openUtility('search');return}
  if(event.key==='Escape'){if(!$('#utility-panel').hidden)closeUtility();else if(state.mode!=='overview')dispatch({type:'CLOSE'});return}
  if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.target.matches('textarea')){event.preventDefault();event.target.form.requestSubmit()}
})
listen(document,'pointerdown',event=>{if(!$('#utility-panel').hidden&&!event.target.closest('#utility-panel,.home-nav,.profile-button,.prototype-caption'))closeUtility()})
for(const el of document.querySelectorAll('[data-entry]')) {
  el.addEventListener('pointerenter',()=>{scene.dataset.awake=el.dataset.entry})
  el.addEventListener('pointerleave',()=>{delete scene.dataset.awake})
  el.addEventListener('focus',()=>{scene.dataset.awake=el.dataset.entry})
  el.addEventListener('blur',()=>{delete scene.dataset.awake})
}
let resizeTimer
function resizeScene(){
  const scale=Math.min(innerWidth/1672,innerHeight/941)
  scene.style.setProperty('--scene-scale',scale)
  scene.style.left=`${(innerWidth-1672*scale)/2}px`;scene.style.top=`${Math.max(0,(innerHeight-941*scale)/2)}px`
  clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{for(const [el,material]of materials)if(!el.hidden)material.refresh()},180)
}
listen(window,'resize',resizeScene)
for(const image of bird.querySelectorAll('img')) image.addEventListener('error',()=>{image.hidden=true;bird.classList.add('asset-unavailable')})
resizeScene();render(true)
if(snapshot?.captureDraft){$('#capture-input').value=snapshot.captureDraft;$('#capture-form [type=submit]').disabled=!snapshot.captureDraft.trim()}
function destroy() {
  controller.abort();actionRevision++;cancelAnimations()
  for(const id of timers)window.clearTimeout(id)
  timers.clear()
  for(const material of materials.values())material.destroy()
  materials.clear()
}
return { destroy, snapshot: () => ({ state, prototypePreview, drafts: [...drafts], captureDraft: $('#capture-input')?.value || '' }) }
}

