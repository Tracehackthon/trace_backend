import { routeFor } from './home-model.js'
import { createPrototypeSession } from './prototype-session.js'

const root = document.querySelector('#app')
const session = createPrototypeSession()
const styles = new Map()
let screen, activeRoute, homeSnapshot, revision = 0

async function stylesheet(route) {
  if (!styles.has(route)) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.dataset.desktopStyle = route
    link.href = new URL(({home:'./home.css',matters:'./matters/matters.css',discussion:'./style.css'})[route], import.meta.url).href
    link.media = 'not all'
    const ready = new Promise((resolve,reject) => {link.onload=resolve;link.onerror=reject})
    styles.set(route,{link,ready});document.head.append(link)
  }
  await styles.get(route).ready
}

function urlFor(route, view) {
  const url = new URL(location.href);url.search='';url.hash=''
  if(route==='home')url.searchParams.set('view','home')
  if(route==='matters') {
    url.searchParams.set('view','matters')
    if(view.mode==='search') url.searchParams.set('q',view.query)
    if(['reentry','deep'].includes(view.mode)) {
      url.searchParams.set('matter',view.selectedId)
      url.searchParams.set('step',view.mode)
      if(view.mode==='deep')url.searchParams.set('tab',view.deepTab)
      if(view.contextMode==='fresh')url.searchParams.set('context','fresh')
    }
  }
  return url
}

function updateHistory(url, replace=false) {
  if(url.href===location.href)return
  history[replace?'replaceState':'pushState'](null,'',url)
}

function navigate(route, options={}) {
  if(route==='matters') {
    if(options.id)session.dispatch({type:'OPEN',id:options.id})
    else if(options.query)session.dispatch({type:'SEARCH',query:options.query})
    else session.dispatch({type:'OVERVIEW'})
  }
  updateHistory(urlFor(route,session.view()))
  void renderRoute({focusSearch:options.focusSearch})
}

function fromUrl() {
  const p = new URLSearchParams(location.search)
  if(routeFor(location.search)!=='matters')return
  if(p.get('q'))session.dispatch({type:'SEARCH',query:p.get('q')})
  else if(p.has('matter')) {
    const id=p.get('matter')
    if(!session.getState().matters.some(item=>item.id===id)){session.dispatch({type:'OVERVIEW'});return}
    session.dispatch({type:'OPEN',id})
    if(p.get('context')==='fresh')session.dispatch({type:'FRESH'})
    if(p.get('step')==='deep')session.dispatch({type:'CONTINUE',tab:p.get('tab')||'comparison'})
  } else session.dispatch({type:'OVERVIEW'})
  updateHistory(urlFor('matters',session.view()),true)
}

function act(action) {
  const before=session.view()
  const view=session.dispatch(action)
  const navChanged=before.mode!==view.mode||before.selectedId!==view.selectedId||before.deepTab!==view.deepTab||before.contextMode!==view.contextMode
  if(navChanged||action.type==='SEARCH')updateHistory(urlFor('matters',view),action.type==='SEARCH'&&before.mode==='search')
  screen.update(view)
}

async function renderRoute({focusSearch=false}={}) {
  const token=++revision, route=routeFor(location.search)
  try {
    await stylesheet(route)
    const module = await import(route==='home'?'./home.js':route==='matters'?'./matters/matters-screen.mjs':'./discussion.js')
    if(token!==revision)return
    // Legacy discussion retains its one-shot document lifecycle and plain home link.
    if(route!=='discussion') {
      if(activeRoute==='home')homeSnapshot=screen?.snapshot?.()
      screen?.destroy?.();root.replaceChildren()
    }
    for(const [key,value]of styles)value.link.media=key===route?'all':'not all'
    document.body.classList.toggle('home-page',route==='home')
    document.body.classList.toggle('matters-page',route==='matters')
    activeRoute=route;root.dataset.route=route
    if(route==='home') {
      screen=module.mountHome({
        snapshot:homeSnapshot, entries:session.homeEntries(),
        onOpen:entry=>navigate('matters',{id:session.homeMatterId(entry)}),
        onAll:()=>navigate('matters'),onSearch:()=>navigate('matters',{focusSearch:true}),
        onCapture:text=>{const id=session.capture(text);if(id)navigate('matters',{id})},
      })
    } else if(route==='matters') {
      document.title='Trace · 在意的事'
      const [{animate,svg},{mountSceneGlass}]=await Promise.all([import('./vendor/anime.esm.js'),import('./home/scene-glass.js')])
      if(token!==revision)return
      const asset=path=>new URL(`../public/${path}`,import.meta.url).href
      screen=module.mountMattersScreen({root,view:session.view(),onAction:act,onHome:()=>navigate('home'),
        assets:{background:asset('matters/environment.png'),birdPerched:asset('home/bird-perched.png'),birdTakeoff:asset('home/bird-takeoff.png'),serifFont:asset('matters/fonts/TraceMattersSerif-fixed.woff2'),sansFont:asset('matters/fonts/TraceMattersSans-fixed.woff2')},
        services:{animate,svg,mountSceneGlass},
      })
      if(focusSearch)root.querySelector('input[type="search"]')?.focus()
    } else {
      document.title='Trace · 深度讨论'
      const back=document.createElement('a');back.href='?view=home';back.textContent='← 返回首页'
      back.style.cssText='display:block;margin:0 8px 14px;color:#406c57;font:13px system-ui;text-decoration:none'
      document.querySelector('.sidebar .new-thread')?.before(back)
    }
  } catch(error) {
    if(token!==revision)return
    console.error(error);screen?.destroy?.()
    root.replaceChildren()
    const message=document.createElement('p');message.textContent='页面资源未能加载，请刷新重试。'
    const retry=document.createElement('button');retry.type='button';retry.textContent='重新加载';retry.onclick=()=>location.reload()
    root.append(message,retry)
  }
}

window.addEventListener('popstate',()=>{fromUrl();void renderRoute()})
window.addEventListener('pagehide',()=>{
  if(activeRoute==='home')homeSnapshot=screen?.snapshot?.()
  screen?.destroy?.()
})
window.addEventListener('pageshow',event=>{if(event.persisted)void renderRoute()})
fromUrl();void renderRoute()
