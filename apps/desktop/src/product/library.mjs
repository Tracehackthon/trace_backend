import { mark, icon } from '../home-icons.js';
export const h = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const titleOf = matter => matter?.title || (matter?.originalText || matter?.whyCare || '未命名的事').split('\n')[0];
export const short = (value,n=70) => Array.from(value||'').slice(0,n).join('')+(Array.from(value||'').length>n?'…':'');
const label = {matter:'在意的事',expression:'原表达',understanding:'当前理解',discussion:'补充',source:'对照材料',result:'工作结果',revision:'修订记录',work:'工作现场',branch:'旁支'};
export function recordsOf(host) {
  const rows=[];
  for(const m of host.chain.matters) {
    const route={view:'chain',matterId:m.id,screen:'resume'};
    const push=(kind,id,text,extra={})=>rows.push({kind,id,matterId:m.id,title:titleOf(m),text,route:{...route},...extra});
    push('expression',`${m.id}:original`,m.originalText,{route:{...route,anchor:{field:'originalText',start:0,end:m.originalText.length,text:m.originalText,baseVersion:m.originalTextVersion}}});
    if(m.understanding)push('understanding',`${m.id}:understanding`,m.understanding,{meta:`当前 v${m.understandingVersion}`,route:{...route,screen:'understanding'}});
    for(const msg of host.chain.sessions[m.id]?.discussion?.messages||[])push('discussion',`${m.id}:${msg.id}`,msg.text,{route:{...route,screen:'discussion'}});
    for(const b of m.branches||[])push('branch',`${m.id}:${b.id}`,b.text||b.title,{route:{...route,screen:'discussion'}});
    for(const r of m.revisions||[])push('revision',`${m.id}:${r.id}`,r.after||r.text||'',{meta:`历史记录 · v${r.version||r.afterVersion||r.toVersion||'—'}`,before:r.before,route:{...route,screen:'understanding'}});
  }
  for(const s of host.chain.sources) {
    const m=host.chain.matters.find(m=>m.id===s.ownerMatterId);
    const links=(m?.links||[]).filter(l=>l.sourceId===s.id);
    const provenance=s.kind==='external'?`${s.source==='authorized'?'我的知乎内容':s.source==='global'?'全网来源':'知乎来源'}${s.author?` · ${s.author}`:''}`:'用户粘贴，来源未核验';
    rows.push({kind:'source',id:s.id,matterId:m?.id,title:s.title||'手工带入的材料',text:s.excerpt||'',url:s.url||null,provider:s.provider||null,author:s.author||null,meta:links.length?`已关联 · ${links.map(l=>({limit:'限制',limitation:'限制',support:'支持',supplement:'补充',challenge:'挑战'}[l.relationship.type]||'有关')).join('、')} · ${provenance} · 未自动采用`:`尚未关联 · ${provenance}`,route:m?{view:'chain',matterId:m.id,screen:'resume'}:null});
  }
  for(const w of Object.values(host.worksite.works)) {
    const s=host.worksite.sessions[w.id];
    const matterId=s?.intake[0]?.matterId;
    rows.push({kind:'work',id:w.id,matterId,title:w.title,text:`${w.agent} · ${w.project}`,meta:'本地工作记录 · 尚未发送',route:{view:'worksite',workId:w.id,matterId,screen:'overview'}});
    for(const r of s?.results||[]) rows.push({kind:'result',id:`${w.id}:${r.id}`,matterId:r.matterId,title:w.title,text:r.fact,interpretation:r.interpretation,unconfirmed:r.unconfirmed,meta:r.decision==='revised'?'依据此结果确认过修订':'只留下结果 · 理解未改变',route:{view:'worksite',workId:w.id,matterId:r.matterId,screen:'results',resultId:r.id}});
    for(const f of s?.findings||[])rows.push({kind:'discussion',id:`${w.id}:${f.id}`,matterId:f.matterId,title:w.title,text:f.text,meta:'工作中留下的发现',route:{view:'worksite',workId:w.id,matterId,screen:'finding'}});
  }
  return rows;
}
export function queryRecords(host,{q='',kind='',matterId=''}={}) {
  const needle=q.trim().toLocaleLowerCase();
  return recordsOf(host).filter(r=>(!kind||r.kind===kind)&&(!matterId||r.matterId===matterId)&&(!needle||[r.title,r.text,r.interpretation,r.unconfirmed,r.before].join('\n').toLocaleLowerCase().includes(needle))).reverse();
}
export function homeEntries(host) {
  return Object.fromEntries([...host.chain.matters].reverse().slice(0,4).map((m,i)=>[['thought','work','fresh','handoff'][i],{matterId:m.id,title:short(titleOf(m),40),subtitle:m.stop?`停在：${short(m.stop,35)}`:m.understanding?`我的理解 v${m.understandingVersion} · ${short(m.understanding,30)}`:'原话已保留 · 从这里接着'}]));
}
export function mattersView(host) {
  return {mode:'overview',query:'',notice:'',example:false,selectedId:null,selected:null,matters:[...host.chain.matters].reverse().map(m=>({id:m.id,title:short(titleOf(m),34),whyCare:m.whyCare,lastStop:m.stop||short(m.understanding,42)||'原话已保留，还可以继续想',contextHint:m.stop?'从你自己留下的停点继续。':'继续补充、找对照，或写下自己的理解。',hasComparison:!!m.links?.length,changed:false,branch:null})),search:{counts:{matters:0,quotes:0,sources:0},matters:[],quotes:[],sources:[]}};
}
export function mountLibrary({root,host,route,onNavigate,onBack,onProfile}) {
  const control=new AbortController();
  let disposed=false;
  const on=(target,event,fn)=>target.addEventListener(event,fn,{signal:control.signal});
  const works=route.view==='works';
  const heading=works?'工作现场':route.view==='search'?'找回之前的那一点':'全部痕迹';
  let current={...route,kind:works?'work':route.kind||''};
  root.innerHTML=`<section class="web-library" data-scroll-key="library"><header class="web-header"><button class="web-brand" data-go="home" aria-label="Trace，返回首页"><span>${mark}</span>Trace</button><nav><button data-go="matters">在意的事</button><button data-go="all">全部痕迹</button><button data-go="works">工作现场</button></nav></header><main class="web-library-main"><button class="web-back" data-back>← 返回来处</button><div class="web-library-title"><div><h1>${heading}<span>。</span></h1><p class="web-library-description">${works?'从理解出发，把实际结果带回来':'原话、材料和结果，仍有各自的来处'}</p></div><span class="web-count"></span></div>${route.matterId?`<div class="web-scope">只看「${h(short(titleOf(host.chain.matters.find(m=>m.id===route.matterId)),45))}」<button data-clear-scope>查看全部事项 ×</button></div>`:''}<form class="web-search" role="search">${icon('search')}<input type="search" aria-label="搜索全部痕迹" placeholder="搜原话、理解、材料或结果……" value="${h(route.q||'')}" autocomplete="off"><button type="submit">搜索</button></form><nav class="web-filters" aria-label="内容类型" ${works?'hidden':''}>${[['','全部'],['expression','原表达'],['understanding','我的理解'],['source','对照材料'],['result','结果'],['revision','修订'],['work','工作']].map(([kind,text])=>`<button data-kind="${kind}" aria-pressed="${current.kind===kind}">${text}</button>`).join('')}</nav><div class="web-records"></div></main><button class="web-profile" aria-label="个人与设置">${icon('user')}</button></section>`;
  function paint(){
    if(disposed)return;
    const rows=queryRecords(host,current);
    root.querySelector('.web-count').textContent=`${rows.length} 条${current.q?'匹配':''}痕迹`;
    root.querySelectorAll('[data-kind]').forEach(b=>b.setAttribute('aria-pressed',String(current.kind===b.dataset.kind)));
    root.querySelector('.web-records').innerHTML=rows.length?rows.map(r=>`<article class="web-record" id="record-${h(r.id)}" data-record="${h(r.id)}"><div class="web-record-meta"><span>${label[r.kind]}</span><span>${h(r.meta||'你的内容')}</span></div><button class="web-record-open" data-open="${h(r.id)}"><h2>${h(short(r.title,70))}</h2><p>${h(r.text)}</p>${r.interpretation?`<p class="web-secondary">解释：${h(r.interpretation)}</p>`:''}${r.unconfirmed?`<p class="web-secondary">还不确定：${h(r.unconfirmed)}</p>`:''}</button><div class="web-record-bottom">${r.matterId?'属于同一件事 · ':''}${r.route?'打开原处 →':'原材料保留在这里，尚未关联事项'}</div></article>`).join(''):`<section class="web-empty"><h2>${works?'还没有工作记录':current.q?'没有找到这次想找的内容':'这里还没有痕迹'}</h2><p>${works?'从一件事的「我的理解」进入「带去用」，确认本次任务和带入的内容。':'可以换一个关键词，或从首页留下一点。你的内容不会被示例替换。'}</p><button class="web-primary" data-go="home">回首页留下一点</button></section>`;
  }
  function change(patch){if(disposed)return;clearTimeout(debounce);current={...current,q:input.value,...patch};onNavigate(current,{replace:true,render:false});paint();}
  on(root,'click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-back'))onBack();
    if(b.dataset.go)onNavigate({view:b.dataset.go});
    if(b.hasAttribute('data-clear-scope'))onNavigate({...current,matterId:null});
    if(b.hasAttribute('data-kind'))change({kind:b.dataset.kind});
    if(b.classList.contains('web-profile'))onProfile();
    if(b.dataset.open){if(current.q!==input.value)change({q:input.value});const r=recordsOf(host).find(r=>r.id===b.dataset.open);if(r?.route)onNavigate({...r.route,recordId:r.id},{origin:current});}
  });
  const input=root.querySelector('input');let composing=false;let debounce;
  on(input,'compositionstart',()=>composing=true);
  on(input,'compositionend',()=>{composing=false;change({q:input.value});});
  on(input,'input',()=>{if(!composing){clearTimeout(debounce);debounce=setTimeout(()=>change({q:input.value}),150);}});
  on(root.querySelector('form'),'submit',event=>{event.preventDefault();if(!composing){clearTimeout(debounce);change({q:input.value});}});
  paint();if(route.view==='search'&&!route.recordId)input.focus();
  return {destroy(){disposed=true;clearTimeout(debounce);control.abort();},update(nextHost){host=nextHost;paint();}};
}
