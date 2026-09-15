import * as B from '/runtime/product-workspace/index.mjs';
import { applyProductOperations } from '/runtime/product-workspace/index.mjs';
import { ASSETS } from './product/assets.mjs';
import { h, titleOf, homeEntries, mattersView, recordsOf, mountLibrary } from './product/library.mjs';

const root=document.querySelector('#app'),styles=new Map(),copy=structuredClone;
let host,revision=0,storage,screen,route,renderId=0,dirty=0,saved=0,timer,tail=Promise.resolve(),pending=null,pendingGeneration=0,continuation=null,busy=false,dialog,queued=[];
const uid=kind=>`${kind}-${crypto.randomUUID()}`;
const sourceUrl=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}};
const matter=()=>host?.chain.matters.find(m=>m.id===route?.matterId);
const status=document.createElement('aside');status.className='web-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');document.body.append(status);
const nav=document.createElement('nav');nav.className='web-continuity';nav.setAttribute('aria-label','接续导航');document.body.append(nav);
const menu=document.createElement('nav');menu.className='web-context-menu';menu.setAttribute('aria-label','事项工具');document.body.append(menu);
const allowed=['home','matters','chain','compare','worksite','works','search','all','discussion'];
function urlFor(r){const u=new URL(location.href);u.search='';u.hash='';u.searchParams.set('view',r.view);for(const [key,param]of [['matterId','matter'],['workId','work'],['sessionId','session'],['screen','screen'],['q','q'],['kind','kind'],['recordId','record']])if(r[key])u.searchParams.set(param,r[key]);return u;}
function fromUrl(){
  const p=new URLSearchParams(location.search);let view=p.get('view')||(['from','observationId','text','status','source'].some(k=>p.has(k))?'discussion':'home');if(!allowed.includes(view))view='home';
  if(view==='matters'&&p.has('matter'))view='chain';if(view==='matters'&&p.has('q'))view='search';
  let memory;try{memory=history.state?.traceRoute||JSON.parse(sessionStorage.getItem(`trace:${location.search}`)||'null');}catch{}
  const r={view};for(const [key,param]of [['matterId','matter'],['workId','work'],['sessionId','session'],['screen','screen'],['q','q'],['kind','kind'],['recordId','record']])if(p.has(param))r[key]=p.get(param);
  return memory&&urlFor(memory).search===location.search?memory:r;
}
function retain(){if(!route)return;route.scroll=[];for(const el of root.querySelectorAll('[data-scroll-key]')){if(el.scrollTop>0)route.scroll.push({key:el.dataset.scrollKey,top:el.scrollTop});}history.replaceState({traceRoute:route},'',location.href);try{sessionStorage.setItem(`trace:${location.search.slice(0,512)}`,JSON.stringify(route));}catch{}}
function go(next,{replace=false,render=true,origin}={}){if(pending&&continuation){message('本次保存尚未确认，请先重试或导出内容。');return;}retain();const r={...next};if(r.view==='home')delete r.returnTarget;else if(!Object.hasOwn(r,'returnTarget'))r.returnTarget=copy(origin||(r.view===route?.view&&((r.view==='chain'&&r.matterId===route.matterId)||(r.view==='worksite'&&r.workId===route.workId))?route.returnTarget:route)||{view:'home'});route=r;history[replace?'replaceState':'pushState']({traceRoute:r},'',urlFor(r));try{sessionStorage.setItem(`trace:${location.search}`,JSON.stringify(r));}catch{}if(render)void renderRoute();}
const back=()=>go(route.returnTarget||{view:'home'});
function statusText(state,text){status.dataset.state=state;status.innerHTML=`<i></i><span>${h(text)}</span>${state==='error'?'<button data-retry>重试保存</button><button data-export>导出未保存内容</button><button data-load>载入已保存版本</button>':''}`;}
async function style(name){if(!styles.has(name)){const file={web:'product/web.css',home:'home.css',matters:'matters/matters.css',chain:'product/chain.css',compare:'product/comparison.css',worksite:'product/worksite.css',discussion:'style.css'}[name];if(!file)return;const link=document.createElement('link');link.rel='stylesheet';link.media='not all';link.href=new URL(file,import.meta.url).href;link.dataset.desktopStyle=name;const ready=new Promise((yes,no)=>{link.onload=yes;link.onerror=()=>no(new Error(`样式未加载：${name}`));});styles.set(name,{link,ready});document.head.append(link);}await styles.get(name).ready;}
async function read(){const r=await fetch('/api/product/workspace',{cache:'no-store'});if(!r.ok)throw new Error(r.status===404?'当前服务尚未载入产品命令接口，请重启 Trace 服务；没有修改原数据。':`读取本机内容失败（${r.status}），没有重置数据。`);const data=await r.json();if(!Number.isInteger(data.revision)||data.writeMode!=='product-commands')throw new Error('服务版本不支持产品命令，请重启服务');return data;}
async function write(payload){
  pending=payload;statusText('saving','正在保存在本机…');let r,data;
  try{r=await fetch('/api/product/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});data=await r.json();}catch{statusText('error','保存未确认。内容仍在页面中，请重试或导出。');throw new Error('保存连接中断');}
  if(!r.ok){const msg=r.status===409?'另一处已有更新，未覆盖它。请先导出，再载入新版本。':`保存失败：${data.error?.message||r.status}`;statusText('error',msg);throw new Error(msg);}
  if(data.receipt?.commandId!==payload.commandId||data.receipt?.status!=='committed'||data.receipt.afterRevision!==data.revision||!data.host){statusText('error','回执不完整，未把这次操作标记为已保存。');throw new Error('无效提交回执');}
  if(data.headRevision!==data.revision||data.revision<revision){statusText('error','本次操作曾保存，但另一处已有后来修改。请导出草稿再载入最新版本。');throw new Error('回执不是当前版本');}
  revision=data.revision;storage=data.storage;pending=null;statusText('saved','已保存在本机');return data;
}
const save=(operations,commandId=uid('command'),generation=dirty)=>{pendingGeneration=generation;return write({protocolVersion:1,expectedRevision:revision,operations:copy(operations),commandId});};
async function flush(){clearTimeout(timer);await tail;if(pending)throw new Error('请先处理未确认的保存');if(!queued.length)return;const operations=queued.splice(0,256),generation=dirty-queued.length;const job=tail.then(()=>save(operations,uid('command'),generation)).then(data=>{host=queued.length?replayQueued(data.host):data.host;saved=Math.max(saved,generation);});tail=job.catch(()=>{});await job;if(queued.length)await flush();}
function replayQueued(base){let next=base;for(let i=0;i<queued.length;i+=256)next=applyProductOperations(next,queued.slice(i,i+256));return next;}
function draft(operation){try{host=applyProductOperations(host,[operation]);}catch(e){message(e.message);return false;}queued.push(copy(operation));dirty++;if(!pending)statusText('saving','草稿待保存…');clearTimeout(timer);timer=setTimeout(()=>void flush().catch(()=>{}),350);return true;}
function preferences(){document.documentElement.dataset.reduceMotion=String(!!host.preferences?.reduceMotion);}
async function commit(operations,after=update){
  if(busy)return;busy=true;root.inert=nav.inert=menu.inert=true;
  if(!Array.isArray(operations))operations=[operations];
  try{await flush();applyProductOperations(host,operations);const finish=data=>{host=data.host;saved=++dirty;preferences();after(host);};continuation=finish;const data=await save(operations);continuation=null;finish(data);}
  catch(e){if(!pending)message(e.message);}finally{busy=false;root.inert=nav.inert=menu.inert=!!continuation;}
}
function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function close(){dialog?.traceCleanup?.();dialog?.close();dialog?.remove();dialog=null;}
function modal(title,body,setup){close();dialog=document.createElement('dialog');dialog.className='web-dialog';dialog.setAttribute('aria-label',title);dialog.innerHTML=`<header><h2>${h(title)}</h2><button aria-label="关闭">×</button></header>${body}`;document.body.append(dialog);dialog.querySelector('header button').onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};setup?.(dialog);dialog.showModal();}
function message(text){modal('这一步还没有完成',`<p>${h(text)}</p><footer><button class="web-primary" data-ok>回到原处</button></footer>`,d=>d.querySelector('[data-ok]').onclick=close);}
status.onclick=async e=>{
  if(e.target.matches('[data-export]'))download({revision,host,pendingPayload:pending,queuedOperations:queued,unsaved:true},`Trace-recovery-${Date.now()}.json`);
  if(e.target.matches('[data-retry]')&&pending&&!busy){busy=true;root.inert=nav.inert=menu.inert=true;try{const generation=pendingGeneration;const data=await write(pending);saved=Math.max(saved,generation);const finish=continuation;continuation=null;if(finish)finish(data);else host=queued.length?replayQueued(data.host):data.host;if(queued.length)await flush();}catch{}finally{busy=false;root.inert=nav.inert=menu.inert=!!continuation;}}
  if(e.target.matches('[data-load]'))modal('载入已保存版本','<p>不会合并或覆盖磁盘上的新版本。请先导出未保存内容，再载入。</p><footer><button data-recovery>导出当前内容</button><button class="web-primary" data-confirm>载入已保存版本</button></footer>',d=>{d.querySelector('[data-recovery]').onclick=()=>download({host,pendingPayload:pending,queuedOperations:queued,unsaved:true},'Trace-recovery.json');d.querySelector('[data-confirm]').onclick=async()=>{try{const data=await read();clearTimeout(timer);host=data.host||B.createBridge();revision=data.revision;storage=data.storage;queued=[];pending=continuation=null;dirty=saved=0;root.inert=nav.inert=menu.inert=false;close();statusText('saved','已载入本机保存的版本');void renderRoute();}catch(e){message(e.message);}};});
};
async function zhihuPanel(){
  const {mountZhihuPanel}=await import('./product/zhihu-panel.mjs');
  modal('知乎与全网，找一份对照','',d=>mountZhihuPanel(d,{onSelect:async material=>{
    if(!matter()||!['chain','compare'].includes(route.view))return false;
    close();
    if(route.view==='compare')await commit({type:'comparison.action',sessionId:route.sessionId,action:{type:'IMPORT_MATERIAL',material}});
    else openCompare(undefined,material);
    return true;
  }}));
}
async function agentPanel(){
  try{await flush();}catch(e){message(`草稿还没有保存，暂不启动 Agent：${e.message}`);return;}
  const m=matter();if(!m)return;
  const focus=B.selectChain(host,m.id)?.focus;
  const selection=focus?.field==='understanding'&&m.understandingDraft.slice(focus.start,focus.end)===focus.text
    ?{field:'understandingDraft',start:focus.start,end:focus.end,text:focus.text}:null;
  const {mountAgentPanel}=await import('./product/agent-panel.mjs');
  modal('问 Agent，继续分清','',d=>mountAgentPanel(d,{workspace:{revision,host},matterId:m.id,selection,
    sourceIds:[...new Set([...(m.sourceIds||[]),...(m.links||[]).map(link=>link.sourceId)])],onWorkspace:data=>{
      host=data.host;revision=data.revision;storage=data.storage;saved=++dirty;preferences();statusText('saved','Agent 候选已由你确认并保存在本机草稿');update();
    }}));
}
function profile(){
  const p=host.preferences||{};
  modal('个人与设置',`<p>这是你在本机的 Trace 空间。没有开通 Trace 账号或云同步；知乎连接需单独授权。</p><p><button type="button" data-zhihu>知乎与全网 · 检索和授权</button></p><form><label>怎么称呼你<input name="name" type="text" maxlength="60" value="${h(p.displayName)}" placeholder="你的称呼（可不填）"></label><label><input name="motion" type="checkbox" ${p.reduceMotion?'checked':''}> 减少界面动效</label><h3>你的内容保存在这里</h3><p>${h(storage?.location)}</p><p>${host.chain.matters.length} 件事 · ${host.chain.sources.length} 份材料 · ${Object.keys(host.worksite.works).length} 个工作记录</p><h3>重置与示例</h3><p>替换当前工作区前请导出内容。重置不等于物理清除数据库历史。</p><footer><button type="button" data-reset-demo>载入示例</button><button type="button" data-reset-clear>清空本机内容</button></footer><footer><a href="/api/web/export" download>导出全部内容</a><button class="web-primary" type="submit">保存设置</button></footer></form>`,d=>{
    d.querySelector('[data-zhihu]').onclick=zhihuPanel;
    d.querySelector('form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);void commit({type:'preferences.update',displayName:String(f.get('name')||'').trim(),reduceMotion:f.get('motion')==='on'},()=>{close();statusText('saved','设置已保存');});};
    d.querySelector('[data-reset-demo]').onclick=()=>resetWorkspace({demo:true});
    d.querySelector('[data-reset-clear]').onclick=()=>resetWorkspace({demo:false});
  });
}
function resetWorkspace({demo}){
  if(pending||busy){message('请先处理尚未确认的保存，不能跳过它重置。');return;}
  modal(demo?'确认载入示例':'确认清空本机内容',`<p>${demo?'将用三条明确标记的示例替换当前工作区。':'将把当前工作区替换为空。'}旧修订仍保留在数据库历史中，不是永久删除。</p><p>建议先<a href="/api/web/export" download>导出当前内容</a>。</p><footer><button data-cancel>取消</button><button class="web-primary" data-confirm>确认替换</button></footer>`,d=>{
    d.querySelector('[data-cancel]').onclick=close;
    d.querySelector('[data-confirm]').onclick=()=>{close();void commit({type:'workspace.reset',mode:demo?'demo':'empty',confirm:'replace-current-workspace'},()=>go({view:'home'}));};
  });
}
function sources(){const m=matter();if(!m)return;const list=host.chain.sources.filter(s=>s.ownerMatterId===m.id);modal('这件事的对照与来处',`<p>${h(titleOf(m))}</p>${list.length?list.map(s=>{const link=m.links?.find(l=>l.sourceId===s.id),url=sourceUrl(s.url);return `<section class="web-linked-item"><strong>${h(s.title)}</strong><small>${h(s.kind==='external'?(s.source==='authorized'?'我的知乎内容':s.source==='global'?'全网来源':'知乎来源')+(s.author?` · ${s.author}`:''):'用户带入材料')}</small><p>${h(s.excerpt)}</p>${url?`<a href="${h(url)}" target="_blank" rel="noopener noreferrer">查看原文 ↗</a>`:''}<small>${link?`已接为${h(({limit:'限制',limitation:'限制',support:'支持',challenge:'挑战',supplement:'补充'})[link.relationship.type]||'有关')} · 关联本身不改变理解`:'尚未关联 · 原材料仍保留'}</small></section>`;}).join(''):'<p>还没有材料，可以先选一句原话找个对照。</p>'}<footer><button data-all>查看这件事的全部痕迹</button></footer>`,d=>d.querySelector('[data-all]').onclick=()=>{close();go({view:'all',matterId:m.id});});}
function workContext(){const v=B.selectWorksite(host,route.workId);if(!v)return;const text=[`任务：${v.work.title}`,`项目：${v.work.project}`,`工具 / Agent：${v.work.agent}`,'',...v.context.flatMap(i=>[`【${i.role} · 理解 v${i.sourceVersion}】`,i.instruction,i.text,i.note||'','']),...v.contextFindings.map(i=>i.text)].join('\n'),connection=v.work.connection;const connected=connection?.hostType==='codex';const returned=connection?.status==='returned_for_review';const state=connected?returned?`Codex 已带回结果，正在等你复核。接收任务 ${h(connection.sessionId)}，上下文 ${h(connection.contextHash.slice(0,12))}…`:`Codex 已真实接收这份上下文。接收任务 ${h(connection.sessionId)}，上下文 ${h(connection.contextHash.slice(0,12))}…`:'这份上下文正在等待 Codex 接收；也可以先复制，作为手工降级路径。';modal('本次带入的内容',`<p>${state}</p><pre>${h(text)}</pre><footer><button class="web-primary" data-copy>复制本次上下文</button></footer>`,d=>d.querySelector('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(text);d.querySelector('[data-copy]').textContent=connected?'已复制 · Codex 回执仍保留':'已复制 · 等待 Codex 接收';}catch{d.querySelector('[data-copy]').textContent='请手动选择文字复制';}});}
function projection(){let v;if(route.view==='chain'){v=B.selectChain(host,route.matterId);if(v&&route.anchor?.field==='originalText')v.focus=route.anchor;}if(route.view==='compare')v=B.selectComparison(host,route.sessionId);if(route.view==='worksite')v=B.selectWorksite(host,route.workId);if(v)v.notice=(v.notice||'').replaceAll('本次会话','本机').replaceAll('本地原型','本地记录');return v;}
function chrome(){nav.replaceChildren();menu.replaceChildren();const add=(parent,text,fn)=>{const b=document.createElement('button');b.textContent=text;b.onclick=fn;parent.append(b);};if(route.returnTarget&&route.view!=='home')add(nav,`← ${route.returnTarget.view==='search'?'返回搜索结果':route.returnTarget.view==='all'?'返回全部痕迹':route.returnTarget.view==='worksite'?'返回这次工作':route.returnTarget.view==='chain'?'返回原来的事情':'返回来处'}`,route.view==='compare'?returnComparison:back);if(['chain','compare'].includes(route.view))add(menu,'知乎与全网',zhihuPanel);if(['chain','compare','worksite'].includes(route.view)&&matter())add(menu,'问 Agent',agentPanel);const m=matter();if(m&&['chain','compare','worksite'].includes(route.view)){add(nav,m.understanding?`我的理解 v${m.understandingVersion}`:'原话已保留 · 还没有写理解',()=>go({view:'chain',matterId:m.id,screen:'understanding'}));if(m.links?.length)add(nav,`${m.links.length} 份对照已关联`,sources);}if(route.view==='chain'){add(menu,'搜索',()=>go({view:'search'}));add(menu,'全部痕迹',()=>go({view:'all',matterId:route.matterId}));add(menu,'个人与设置',profile);}}
function update(){screen?.update?.(['all','search','works'].includes(route.view)?host:route.view==='matters'?mattersView(host):projection());chrome();}
function restore(){for(const entry of route.scroll||[]){const el=[...root.querySelectorAll('*')].find(e=>e.className===entry.className);if(el)el.scrollTop=entry.top;}const a=route.anchor;if(!a||route.view!=='chain')return;const el=root.querySelector(`[data-selection="${a.field}"]`);if(!el)return;const value=el instanceof HTMLTextAreaElement?el.value:el.textContent;if(value.slice(a.start,a.end)!==a.text)return;if(el instanceof HTMLTextAreaElement){el.focus({preventScroll:true});el.setSelectionRange(a.start,a.end);return;}const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let offset=0,n,start,end;while(n=walker.nextNode()){if(!start&&offset+n.length>=a.start)start=[n,a.start-offset];if(offset+n.length>=a.end){end=[n,a.end-offset];break;}offset+=n.length;}if(start&&end){const r=document.createRange();r.setStart(...start);r.setEnd(...end);getSelection().removeAllRanges();getSelection().addRange(r);}}
function openCompare(focus,material){
  retain();const m=matter();if(!m)return;
  const fresh=host.chain.sessions[m.id].contextMode==='fresh',selected=focus||route.anchor;
  const basis=fresh&&!selected?{field:'discussion'}:selected||{field:route.screen==='understanding'?'understanding':route.screen==='discussion'?'discussion':'originalText'};
  const anchor=B.selectComparisonAnchor(host,m.id,basis);
  if(!anchor){message('没有可比较的文字。先选一句原话、补充或已保存的理解。');return;}
  const sessionId=uid('compare');
  const operations=[{type:'comparison.open',sessionId,matterId:m.id,anchor,returnTarget:{...copy(route),anchor}}];
  if(material)operations.push({type:'comparison.action',sessionId,action:{type:'IMPORT_MATERIAL',material}});
  void commit(operations,()=>go({view:'compare',matterId:m.id,sessionId}));
}
function returnComparison(){
  const operation={type:'comparison.return',sessionId:route.sessionId};
  if(draft(operation))go(host.route);
}
function chainAction(a){
  if(busy)return;
  if(a.type==='FOCUS'){const anchor=B.selectComparisonAnchor(host,route.matterId,a);if(anchor)route.anchor=anchor;if(a.field==='originalText'){update();return;}}
  if(['CLEAR_FOCUS','FRESH_CONTEXT','RESUME_CONTEXT'].includes(a.type))delete route.anchor;
  if(a.type==='OPEN_COMPARISON'||a.type==='NAVIGATE'&&a.screen==='comparison'){openCompare(a.focus);return;}
  if(a.type==='NAVIGATE'&&['work','results','revised'].includes(a.screen)){const works=Object.values(host.worksite.works).filter(w=>host.worksite.sessions[w.id].intake.some(i=>i.matterId===route.matterId));if(works.length)go({view:'worksite',workId:works.at(-1).id,matterId:route.matterId,screen:a.screen==='work'?'overview':'results'});else message('还没有本次工作。先从「带去用」确认工作和带入的内容。');return;}
  if(a.type==='CONFIRM_HANDOFF'){
    const handoff=B.selectChain(host,route.matterId).handoff,workId=uid('work'),matterId=route.matterId;
    void commit({type:'handoff.create',matterId,workId,destination:handoff.destination,role:handoff.role,note:handoff.note,selectedText:handoff.selectedText},()=>go({view:'worksite',matterId,workId,screen:'overview'}));return;
  }
  if(a.type==='OPEN'&&a.id!==route.matterId){go({view:'chain',matterId:a.id,screen:a.screen||'resume'});return;}
  const operation={type:'chain.action',matterId:route.matterId,action:a};
  if(/_DRAFT$/.test(a.type)||['FOCUS','CLEAR_FOCUS'].includes(a.type)){if(draft(operation))update();return;}
  if(['NAVIGATE','BACK','CLEAR_NOTICE'].includes(a.type)){if(draft(operation))go({...route,screen:host.chain.screen,anchor:a.type==='NAVIGATE'?undefined:route.anchor},{replace:a.type==='CLEAR_NOTICE'});return;}
  void commit(operation,next=>next.chain.screen!==route.screen?go({...route,screen:next.chain.screen}):update());
}
async function comparisonAction(a){
  if(busy)return;
  const operation={type:'comparison.action',sessionId:route.sessionId,action:a};
  if(/_DRAFT$|_PATCH$/.test(a.type)){if(draft(operation))update();return;}
  // LINK / CONFIRM / UNDO are evaluated and acknowledged by the server in one
  // transaction. No browser-created outcome or receipt crosses the write API.
  void commit(operation);
}
function workAction(a){
  if(busy)return;
  if(a.type==='SELECT_WORK'){go({view:'worksite',workId:a.id,screen:'overview'});return;}
  const operation={type:'worksite.action',workId:route.workId,action:a};
  if(/_DRAFT$/.test(a.type)){if(draft(operation))update();return;}
  if(a.type==='NAVIGATE'){if(draft(operation))go({...route,screen:host.worksite.sessions[route.workId].screen});return;}
  void commit(operation,()=>{if(a.type==='TRY_AGAIN')go({view:'chain',matterId:route.matterId,screen:'handoff'});else {const nextScreen=B.selectWorksite(host,route.workId).screen;nextScreen!==route.screen?go({...route,screen:nextScreen}):update();}});
}
function missing(){root.innerHTML='<section class="web-loading"><h1>没有找到这段来处。</h1><p>这个地址对应的内容不在当前空间里，没有用示例替换它。</p><button>到全部痕迹里找找</button></section>';root.querySelector('button').onclick=()=>go({view:'all'});}
async function renderRoute(){
  const token=++renderId,view=route.view;close();
  try{
    await Promise.all([style('web'),style(view)]);if(token!==renderId)return;screen?.destroy?.();screen=null;root.replaceChildren();root.className='';root.removeAttribute('style');for(const [key,v]of styles)v.link.media=key==='web'||key===view?'all':'not all';document.body.className=view==='home'?'home-page':view==='matters'?'matters-page':'';root.dataset.route=view;preferences();chrome();
    if(['chain','compare'].includes(view)&&!matter()||view==='compare'&&!host.comparisons[route.sessionId]||view==='worksite'&&!host.worksite.works[route.workId]){missing();return;}
    if(view==='home'){
      const {mountHome}=await import('./home.js');if(token!==renderId)return;
      screen=mountHome({product:true,entries:homeEntries(host),snapshot:{captureDraft:host.chain.capture.text||''},onOpen:key=>{const entry=homeEntries(host)[key];if(entry)go({view:'chain',matterId:entry.matterId,screen:'resume'});},onAll:()=>go({view:'all'}),onSearch:()=>go({view:'search'}),onMatters:()=>go({view:'matters'}),onWorks:()=>go({view:'works'}),onProfile:profile,onDraft:text=>draft({type:'capture.draft',text}),onCapture:text=>{const matterId=uid('matter');void commit({type:'capture.create',matterId,text},()=>go({view:'chain',matterId,screen:'resume'}));}});
    }else if(['all','search','works'].includes(view)){
      document.title=`Trace · ${view==='works'?'工作现场':view==='search'?'搜索':'全部痕迹'}`;screen=mountLibrary({root,host,route,onNavigate:go,onBack:back,onProfile:profile});
    }else if(view==='discussion'){location.href=`./legacy.html${location.search}`;return;}
    else{
      const [{animate,svg},{mountSceneGlass}]=await Promise.all([import('./vendor/anime.esm.js'),import('./home/scene-glass.js')]);if(token!==renderId)return;const services={animate:(target,params)=>animate(target,host.preferences?.reduceMotion?{...params,duration:0,delay:0}:params),svg,mountSceneGlass};
      if(view==='matters'){const {mountMattersScreen}=await import('./matters/matters-screen.mjs');screen=mountMattersScreen({root,view:mattersView(host),assets:ASSETS.matters,services:{...services,onWorks:()=>go({view:'works'})},onHome:()=>go({view:'home'}),onAll:()=>go({view:'all'}),onAction:a=>{if(a.type==='OPEN')go({view:'chain',matterId:a.id,screen:'resume'});else if(a.type==='SEARCH')go({view:'search',q:a.query});else if(a.type==='BACK')back();}});}
      if(view==='chain'){
        if(host.chain.screen !== (route.screen||'resume') || host.chain.selectedId !== route.matterId) draft({type:'chain.action',matterId:route.matterId,action:{type:'OPEN',id:route.matterId,screen:route.screen||'resume'}});const {mountChainScreen}=await import('./product/chain-screen.mjs');screen=mountChainScreen({root,view:projection(),assets:ASSETS.chain,services,onAction:chainAction,onHome:()=>go({view:'home'}),onMatters:()=>go({view:'matters'}),onBack:()=>route.screen==='resume'?back():go({...route,screen:'resume'}),onWorkspaces:()=>go({view:'works'})});
      }
      if(view==='compare'){const {mountComparisonScreen}=await import('./product/comparison-screen.mjs');screen=mountComparisonScreen({root,view:projection(),assets:ASSETS.compare,services,onAction:comparisonAction,onReturn:returnComparison,onContinue:()=>{if(draft({type:'comparison.return',sessionId:route.sessionId}))go({...host.route,screen:'discussion'});},onAll:()=>go({view:'all',matterId:route.matterId}),onProfile:profile});}
      if(view==='worksite'){
        route.matterId ||=host.worksite.sessions[route.workId].intake[0]?.matterId;if(host.worksite.sessions[route.workId]?.screen !== (route.screen||'overview') || host.worksite.selectedWorkId !== route.workId) draft({type:'worksite.action',workId:route.workId,action:{type:'NAVIGATE',screen:route.screen||'overview'}});const {mountWorksiteScreen}=await import('./product/worksite-screen.mjs');screen=mountWorksiteScreen({root,view:projection(),assets:ASSETS.worksite,services,onAction:workAction,onHome:()=>go({view:'home'}),onBack:back,onOpenMatter:value=>{const id=typeof value==='string'?value:value?.id||value?.matterId;if(id)go({view:'chain',matterId:id,screen:'understanding'});else message('还没有为这条发现关联事项。');},onReturnToAgent:workContext,onOpenArtifact:item=>message(item?.excerpt||'还没有实际产物或来源链接，不会跳到演示文件。'),onProfile:profile,onWorkspaces:()=>go({view:'works'}),onCreateWork:()=>go({view:'chain',matterId:route.matterId,screen:'handoff'})});
      }
    }
    if(token!==renderId)return;chrome();requestAnimationFrame(restore);
    if(route.recordId){const r=recordsOf(host).find(r=>r.id===route.recordId);if(r&&['source','result','revision'].includes(r.kind))modal(r.kind==='result'?'保存下来的这次结果':r.kind==='source'?'原材料与来处':'这次修订的记录',`<p>${h(r.meta)}</p>${r.before?`<h3>修改前</h3><p>${h(r.before)}</p>`:''}<h3>${h(r.title)}</h3><p>${h(r.text)}</p>${r.interpretation?`<h3>我的解释</h3><p>${h(r.interpretation)}</p>`:''}${r.unconfirmed?`<h3>还不确定</h3><p>${h(r.unconfirmed)}</p>`:''}`);}
  }catch(e){if(token!==renderId)return;console.error(e);root.innerHTML=`<section class="web-loading"><h1>页面没有加载完成。</h1><p>${h(e.message)}</p><button>重新载入</button></section>`;root.querySelector('button').onclick=()=>location.reload();}
}
window.addEventListener('popstate',()=>{route=fromUrl();void renderRoute();});
window.addEventListener('keydown',e=>{if(e.isComposing)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&route.view!=='home'){e.preventDefault();go({view:'search'});}if(e.key==='Escape'&&!e.defaultPrevented&&!document.querySelector('dialog[open],[role="dialog"]:not([hidden])')&&['search','all','works'].includes(route.view)){e.preventDefault();back();}});
window.addEventListener('beforeunload',e=>{if(dirty>saved||pending){e.preventDefault();e.returnValue='';}});
window.addEventListener('pagehide',()=>{retain();screen?.destroy?.();});
window.addEventListener('pageshow',e=>{if(e.persisted)void renderRoute();});
async function start(){await style('web');styles.get('web').link.media='all';root.innerHTML='<section class="web-loading"><h1>Trace</h1><p>正在接回你留在本机的内容…</p></section>';try{const data=await read();host=data.host||B.createBridge();revision=data.revision;storage=data.storage;const restored=B.recoverPendingComparisons(host);if(JSON.stringify(restored)!==JSON.stringify(host)){const recovered=await save([{type:'workspace.recover'}]);host=recovered.host;}route=fromUrl();statusText('saved','已连接本机存储');await renderRoute();}catch(e){statusText('error','本机内容未能读取，没有用空内容覆盖它。');root.innerHTML=`<section class="web-loading"><h1>暂时没有接回本机内容。</h1><p>${h(e.message)}</p><button>重新连接</button></section>`;root.querySelector('button').onclick=start;}}
void start();
