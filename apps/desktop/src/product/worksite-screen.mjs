// Runtime derivative of artifacts/trace-worksite-v1-20260915/ui; original layout retained.
import {icon, mark, escapeHTML as esc} from './worksite-icons.mjs';

const SCREENS=['overview','intake','impact','finding','results'];
const ROLES={reference:'这次参考',trial:'这次先试',contrast:'这次只作对照',exclude:'这次不用'};
const RELATIONS={support:'支持',limit:'限制',challenge:'挑战',unknown:'暂判断'};
const ANCHORS={overview:[709,376],intake:[1174,178],impact:[450,380],finding:[506,400],results:[928,354]};
const PATHS={
  overview:['M659 393C752 393 730 322 812 322','M653 517C738 513 723 640 777 640'],
  intake:['M1162 193C1255 157 1223 282 1280 282','M414 637C462 637 449 567 482 567'],
  impact:['M403 398C462 398 464 335 515 335'],
  finding:['M443 425C510 425 529 345 593 345','M1203 398C1259 398 1247 359 1280 359'],
  results:['M440 458C474 458 481 408 490 408','M886 384C917 384 924 327 962 327'],
};
const contour='M75 5 C275 -2 530 8 801 3 C936 -1 987 18 995 67 L998 232 C997 281 977 296 917 298 L116 298 C42 298 4 284 3 232 L3 74 C2 30 20 11 75 5 Z';
let instanceCounter=0;

const button=(action,text,{cls='',glyph='',attrs=''}={})=>`<button type="button" class="worksite-button ${cls}" data-action="${action}" ${attrs}>${glyph?icon(glyph):''}<span>${text}</span></button>`;
const back=()=>button('overview','工作总览',{cls:'worksite-back',glyph:'back'});
const surface=(name,classes,content,tone='cool')=>`<section class="worksite-surface ${classes}" data-surface="${name}" data-tone="${tone}"><div class="worksite-material" aria-hidden="true"></div><div class="worksite-surface-content">${content}</div></section>`;
const orbit=name=>`<span class="worksite-orbit">${icon(name)}</span>`;
const label=(id,text)=>`<label for="${id}">${text}</label>`;

/** Pure view-driven native DOM screen. No internal business store. */
export function mountWorksiteScreen({root,view,onAction,onHome,onBack,onWorkspaces,onCreateWork,onProfile,onOpenMatter,onOpenArtifact,onReturnToAgent,assets={},services={}}={}) {
  if(!root?.appendChild || typeof onAction!=='function') throw new TypeError('mountWorksiteScreen requires root and onAction');
  const uid=`worksite-${++instanceCounter}`;
  let current=view||{},destroyed=false,localPanel='',previousFocus=null,toastTimer=0,birdAnimation=null,panelAnimation=null,panelTarget=null,pendingOrigin=null;
  let activeScreen='',activeWork='',lastLists='',lastWorkList='',lastMatterOptions='';
  const composition=new WeakSet(),glass=[],fontFaces=[];
  const host=document.createElement('div'); host.className='worksite-root'; host.dataset.worksite=uid;
  const fieldId=name=>`${uid}-${name}`;
  host.innerHTML=`
    <div class="worksite-viewport">
      <div class="worksite-scene">
        <header class="worksite-header">
          <button class="worksite-brand" type="button" data-action="home" aria-label="返回 Trace 首页"><span class="worksite-brand-mark">${mark}</span><strong>Trace</strong></button>
          <nav aria-label="当前工作操作">${onBack?button('back','返回原处',{glyph:'back'}):''}${button('switch','切换工作',{glyph:'switch'})}<span class="worksite-nav-divider"></span>${button('agent','查看本次带入内容',{glyph:'box',cls:'worksite-agent-button'})}${icon('external')}</nav>
        </header>
        <div class="worksite-task-anchor"><p>工作现场</p><h1 data-text="work-title"></h1><div class="worksite-task-meta"><span class="worksite-project">${icon('box')}<span data-text="work-agent"></span></span><span class="worksite-meta-divider"></span><span>当前查看的工作</span><span class="worksite-demo-indicator" data-text="demo-status"></span></div></div>
        <svg class="worksite-connections" viewBox="0 0 1672 941" aria-hidden="true"><defs><linearGradient id="${uid}-gold"><stop stop-color="#ffc35d"/><stop offset=".5" stop-color="#c7730d"/><stop offset="1" stop-color="#e8a649"/></linearGradient></defs><g class="worksite-path-group"></g><path class="worksite-flight-path" fill="none" stroke="none"/></svg><svg class="worksite-nodes" viewBox="0 0 1672 941" aria-hidden="true"><g class="worksite-node-group"></g></svg>
        <div class="worksite-state" data-screen="overview">
          ${surface('intake-list','worksite-overview-intake',`<h2>本次带入 <span data-text="intake-count"></span></h2><div class="worksite-intake-list"></div><div class="worksite-empty-intake" hidden><h3>还没有本次带入</h3><p>先从一件事中选择要带去用的理解；这里不会自动选中全部内容。</p>${onCreateWork?button('create-work','建立本次工作',{cls:'worksite-primary'}):''}</div>`)}
          ${surface('decision','worksite-overview-decision',`<div class="worksite-amber-label">${orbit('bulb')}<span>这次怎样处理</span></div><h2 data-text="decision-title"></h2><p class="worksite-decision-description" data-text="decision-description"></p>${button('artifact','保存交互原型',{cls:'worksite-artifact-link',glyph:'link'})}${button('impact','查看实际影响',{cls:'worksite-primary worksite-impact-button',glyph:'arrow'})}<p class="worksite-footnote">${icon('info')}<span data-text="decision-truth"></span></p>`,'warm')}
          <div class="worksite-observation">${icon('chart')}<span data-text="observation"></span></div>
          <div class="worksite-capture-row"><form class="worksite-composer" data-form="capture">${orbit('link')}<textarea id="${fieldId('composer')}" data-field="composer" rows="1" aria-label="补一句现场发现" placeholder="补一句现场发现，或带回一个结果……"></textarea><button type="submit" class="worksite-send" aria-label="展开现场发现" data-submit="capture">${icon('up')}</button></form>${button('results','带回结果',{cls:'worksite-result-entry',glyph:'box'})}</div>
        </div>
        <div class="worksite-state" data-screen="intake" hidden>
          ${surface('intake-detail','worksite-intake-detail',`${back()}<div class="worksite-intake-heading"><p>本次带入</p><h2 data-text="intake-title"></h2><span class="worksite-role-summary" data-text="role-summary"></span></div><div class="worksite-intake-copy"><section><div class="worksite-row-heading"><h3>原来怎么想</h3>${button('source','查看来处',{cls:'worksite-text-button',glyph:'external'})}${button('matter','我的想法已经变了',{cls:'worksite-text-button'})}</div><p data-text="source-text"></p></section><section><h3>为什么与这次有关</h3><p data-text="relevance"></p></section><section><h3>这次准备怎样用</h3><p data-text="use-plan"></p><p class="worksite-context-instruction" data-text="context-instruction"></p></section></div><div class="worksite-role-options" role="group" aria-label="这条理解怎样参与本次工作">${Object.entries(ROLES).map(([role,text])=>button('role',text,{attrs:`data-role="${role}" aria-pressed="false"`})).join('')}</div><p class="worksite-footnote">${icon('info')}<span>仅调整本次工作，不自动修改长期理解。</span></p><div class="worksite-composer worksite-intake-note">${orbit('link')}<textarea id="${fieldId('intake-note')}" data-field="intake-note" rows="1" aria-label="本次使用说明" placeholder="也可以直接说：这次只作对照……"></textarea></div>`)}
          ${surface('intake-decision','worksite-intake-decision',`<div class="worksite-amber-label">${orbit('bulb')}<span>本次取舍</span></div><h2 data-text="decision-short"></h2>${button('impact','查看实际影响',{glyph:'arrow'})}`,'warm')}
          ${surface('intake-other','worksite-intake-other',`<button type="button" data-action="other-intake">${orbit('file')}<span><strong data-text="other-title"></strong><small data-text="other-relevance"></small></span></button>`)}
        </div>
        <div class="worksite-state" data-screen="impact" hidden>
          ${surface('impact-intake','worksite-impact-intake',`${orbit('file')}<div><p>带入的理解</p><h3 data-text="impact-source-title"></h3><small data-text="impact-source-use"></small></div>`)}
          ${surface('impact','worksite-impact-detail',`${back()}<div class="worksite-impact-grid"><div class="worksite-impact-left"><div class="worksite-amber-label">${orbit('bulb')}<span>实际影响</span></div><h2 data-text="decision-short"></h2><div class="worksite-choice"><h3><i></i>本次取舍</h3><p data-text="decision-description"></p></div><div class="worksite-artifact-preview"><header><span data-text="artifact-demo-title"></span>${button('artifact','打开对应原型',{cls:'worksite-text-button',glyph:'external'})}</header><div class="worksite-mini-prototype"><div>${orbit('quote')}<span>一个有触动的片段，不必立刻变成结论。</span><span class="worksite-mini-saved">${icon('check')}示例已留下</span></div><p>${icon('plus')}补一句我的感受（可选）</p></div></div><div class="worksite-stage-list" aria-label="影响程度与独立证据"></div></div><div class="worksite-impact-right"><section><h3>${orbit('check')}目前能确认</h3><div class="worksite-confirmed"></div><div class="worksite-evidence"></div></section><section><h3>${orbit('circle')}还不能确认</h3><div class="worksite-unconfirmed"></div></section></div></div><footer class="worksite-impact-footer">${button('correction','这条影响关系不准确',{cls:'worksite-text-button',glyph:'info'})}<div>${button('results','补一份实际结果',{cls:'worksite-primary',glyph:'arrow'})}<p>实现完成，不等于真实使用有效。</p></div></footer>`)}
        </div>
        <div class="worksite-state" data-screen="finding" hidden>
          <div class="worksite-finding-back">${back()}</div>
          ${surface('finding-artifact','worksite-finding-artifact',`<h2>本次原型</h2><div>${orbit('file')}<p data-text="decision-short"></p>${button('artifact','',{glyph:'link',attrs:'aria-label="查看本次原型"'})}</div>`)}
          ${surface('finding','worksite-finding-detail',`<div class="worksite-amber-label">${orbit('bulb')}<span>工作中留下一点</span></div><div class="worksite-finding-original">${label(fieldId('finding-text'),'现场发现')}<textarea id="${fieldId('finding-text')}" data-field="finding-text" rows="2" placeholder="工作中，有什么让你停了一下？"></textarea><p>一个待观察的想法，不是已验证的结论。</p><div class="worksite-finding-source">${orbit('link')}<span data-text="finding-source"></span>${button('finding-source','查看现场',{cls:'worksite-text-button',glyph:'external'})}</div></div><div class="worksite-finding-note">${label(fieldId('finding-note'),'还想补一句吗？')}<textarea id="${fieldId('finding-note')}" data-field="finding-note" rows="2" placeholder="不用现在想完整……"></textarea></div><div class="worksite-finding-actions">${button('keep-finding','先留一下',{cls:'worksite-primary'})}${button('expand-finding','展开想想')}${button('use-finding','用于当前工作',{cls:'worksite-text-button',glyph:'external'})}</div><p class="worksite-footnote" data-text="finding-receipt"></p>`,'warm')}
          ${surface('finding-relation','worksite-finding-relation',`<p class="worksite-candidate-label">${orbit('spark')}可能接到</p><div class="worksite-related-matter"><h2 data-text="suggested-matter-title"></h2><p data-text="suggested-stop"></p></div><div class="worksite-relation-actions">${button('link-finding','接到这件事',{glyph:'arrow',cls:'worksite-text-button'})}${button('unlink-finding','暂不关联',{cls:'worksite-text-button'})}</div><p class="worksite-relation-feedback" data-text="finding-relation"></p>`)}
        </div>
        <div class="worksite-state" data-screen="results" hidden>
          <div class="worksite-results-heading">${back()}<span></span><h2>结果回来</h2></div>
          ${surface('result-stop','worksite-result-stop',`${orbit('file')}<div><h2>上次停在</h2><p data-text="matter-stop"></p></div><footer>${button('result-matter','原问题',{cls:'worksite-text-button',glyph:'external'})}</footer>`)}
          ${surface('result-fact','worksite-result-fact',`<div class="worksite-field-title">${orbit('wave')}${label(fieldId('result-fact'),'这次实际发生')}</div><textarea id="${fieldId('result-fact')}" data-field="result-fact" rows="4" placeholder="先写下实际发生的事，不急着解释。"></textarea><div class="worksite-fact-source">${button('artifact','查看本次工作来源',{cls:'worksite-text-button',glyph:'external'})}</div><p class="worksite-footnote">单次观察，不代表普遍成立</p>`)}
          ${surface('result-understanding','worksite-result-understanding',`<header><h2>${orbit('bulb')}可能改变的理解</h2><span class="worksite-pending" data-text="revision-status"></span></header><div class="worksite-result-matter-select">${label(fieldId('result-matter'),'选择一件事')}<select id="${fieldId('result-matter')}" data-field="result-matter"></select></div><div class="worksite-original-understanding" data-text="matter-understanding"></div><div class="worksite-proposed">${label(fieldId('result-proposed'),'候选理解')}<textarea id="${fieldId('result-proposed')}" data-field="result-proposed" rows="2" placeholder="这次观察可能怎样改变你的理解？"></textarea></div><div class="worksite-result-unknown">${label(fieldId('result-unknown'),'仍未分清')}<textarea id="${fieldId('result-unknown')}" data-field="result-unknown" rows="1" placeholder="还有哪些情况需要再看？"></textarea>${label(fieldId('result-interpretation'),'你的解释')}<textarea id="${fieldId('result-interpretation')}" data-field="result-interpretation" rows="1" placeholder="这是待确认的解释，不是已经证明的原因。"></textarea></div><div class="worksite-result-relations" role="group" aria-label="这次结果与原理解的关系">${Object.entries(RELATIONS).map(([relation,text])=>button('result-relation',text,{attrs:`data-relation="${relation}" aria-pressed="false"`})).join('')}</div>`,'warm')}
          <div class="worksite-result-actions">${button('review','查看修改并确认',{cls:'worksite-primary',glyph:'arrow'})}${button('keep-result','只留下结果')}${button('retry','再试一次')}<p>仅在你确认后更新「我的理解」。</p></div>
          <div class="worksite-result-receipt" hidden><span data-text="receipt"></span>${button('undo','撤销这次修改',{cls:'worksite-text-button'})}</div>
        </div>
        <div class="worksite-bird" aria-hidden="true"><img class="worksite-bird-perched" alt=""><img class="worksite-bird-flying" alt=""></div>
        <button type="button" class="worksite-profile" data-action="profile" aria-label="个人区域">${icon('user')}</button>
        <p class="worksite-prototype-note">独立交互模块 · 本次会话<span data-text="prototype-demo"></span></p>
      </div>
    </div>
    <div class="worksite-notice" role="status" aria-live="polite" hidden><span></span><button type="button" data-action="dismiss-notice" aria-label="关闭提示">${icon('close')}</button></div>
    <div class="worksite-panel-backdrop" hidden></div>
    <section class="worksite-panel" tabindex="-1" hidden role="dialog" aria-modal="true" aria-labelledby="${fieldId('panel-title')}"><header><h2 id="${fieldId('panel-title')}"></h2>${button('close-panel','',{glyph:'close',attrs:'aria-label="关闭面板"'})}</header><div class="worksite-panel-body"></div></section>
    <section class="worksite-review" tabindex="-1" hidden role="dialog" aria-modal="true" aria-labelledby="${fieldId('review-title')}"><header><h2 id="${fieldId('review-title')}">确认修改我的理解</h2>${button('cancel-review','',{glyph:'close',attrs:'aria-label="取消修改"'})}</header><p class="worksite-review-truth">仅查看差异，不会自动生效。</p><div class="worksite-review-fact"><strong>这次事实</strong><p data-text="review-fact"></p></div><div class="worksite-review-columns"><section><h3>修改前</h3><p data-text="review-before"></p></section><section>${label(fieldId('review-after'),'修改后')}<textarea id="${fieldId('review-after')}" data-field="review-after" rows="6"></textarea></section></div><p class="worksite-review-error" data-text="review-error" role="alert"></p><footer>${button('cancel-review','取消修改')}${button('confirm-review','确认修改',{cls:'worksite-primary'})}</footer></section>`;
  root.appendChild(host);
  const q=selector=>host.querySelector(selector),qa=selector=>[...host.querySelectorAll(selector)];
  const viewport=q('.worksite-viewport'),scene=q('.worksite-scene'),bird=q('.worksite-bird');
  const text=(key,value)=>qa(`[data-text="${key}"]`).forEach(el=>{const next=String(value??'');if(el.textContent!==next)el.textContent=next;});
  const field=(name,value,force=false)=>{const el=q(`[data-field="${name}"]`); if(el && !composition.has(el) && (force||document.activeElement!==el) && el.value!==String(value??''))el.value=String(value??'');};
  const setDisabled=(selector,value)=>qa(selector).forEach(el=>{el.disabled=Boolean(value);});
  const dispatch=action=>{if(!destroyed)onAction(action);};

  // FontFace names are instance-scoped; consumers need not install fonts globally.
  for(const [kind,path] of [['serif',assets.serifFont],['sans',assets.sansFont]]) {
    if(path && typeof FontFace==='function') {
      const family=`Trace Worksite ${kind} ${uid}`;
      const face=new FontFace(family,`url(${JSON.stringify(String(path))})`,{weight:kind==='serif'?'250 900':'100 900',display:'swap'});
      fontFaces.push(face);document.fonts.add(face);
      face.load().catch(()=>{host.dataset.fontFallback='true';});
      host.style.setProperty(`--worksite-${kind}`,`"${family}", ${kind==='serif'?'"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", SimSun, serif':'"Noto Sans CJK SC", "Microsoft YaHei", sans-serif'}`);
    }
  }
  if(assets.background) viewport.style.backgroundImage=`url(${JSON.stringify(String(assets.background))})`;
  for(const [selector,path] of [['.worksite-bird-perched',assets.birdPerched],['.worksite-bird-flying',assets.birdTakeoff]]){
    const img=q(selector); if(path)img.src=path; else img.hidden=true;
    img.addEventListener('error',()=>{img.hidden=true;host.dataset.birdMissing='true';});
  }
  if(typeof services.mountSceneGlass==='function' && assets.background) for(const panel of qa('[data-surface]')) {
    try{glass.push(services.mountSceneGlass({host:panel.querySelector('.worksite-material'),scene:viewport,backgroundUrl:assets.background,path:contour,width:600,height:340,tone:panel.dataset.tone}));panel.dataset.material='scene-glass';}
    catch{panel.dataset.material='css-fallback';}
  }

  function resize(){
    if(destroyed)return;
    const width=host.clientWidth,height=host.clientHeight;
    const narrow=width<1000;host.classList.toggle('worksite-narrow',narrow);
    if(narrow){scene.style.transform='none';scene.style.left='0';scene.style.top='0';}
    else {const scale=Math.min(width/1672,Math.max(.70,height/941));scene.style.transform=`scale(${scale})`;scene.style.left=`${Math.max(0,(width-1672*scale)/2)}px`;scene.style.top=`${Math.max(0,(height-941*scale)/2)}px`;}
    glass.forEach(item=>item.refresh());
  }
  const resizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(resize):null;resizeObserver?.observe(host);
  window.addEventListener('resize',resize);

  function showNotice(message){
    clearTimeout(toastTimer);const el=q('.worksite-notice');el.firstElementChild.textContent=message;el.hidden=!message;
    if(message)toastTimer=setTimeout(()=>{if(!current.notice)el.hidden=true;},6500);
  }
  function callExternal(callback,payload,fallback){
    if(typeof callback!=='function'){showNotice(fallback);return;}
    try{Promise.resolve(callback(payload)).catch(()=>showNotice('操作暂未完成，请稍后再试。'));}
    catch{showNotice('操作暂未完成，请稍后再试。');}
  }
  function openArtifact(artifact=current.decision?.artifact){
    if(!artifact?.url || typeof onOpenArtifact!=='function'){showNotice('尚未连接这份产物；不会打开示例来替代。');return;}
    callExternal(onOpenArtifact,artifact,'尚未连接这份产物。');
  }
  function openMatter(matterId){
    if(!matterId){showNotice('暂未选择一件事，可以先保留现场发现。');return;}
    callExternal(onOpenMatter,matterId,'这件事尚未连接，可先保留现场发现。');
  }
  function closePanel(restore=true){
    localPanel='';q('.worksite-panel').hidden=true;
    if(!current.review?.open)q('.worksite-panel-backdrop').hidden=true;
    if(restore&&previousFocus?.isConnected)previousFocus.focus();
  }
  function openPanel(name){
    previousFocus=document.activeElement;localPanel=name;
    const panel=q('.worksite-panel'),body=q('.worksite-panel-body');
    const item=current.selectedIntake;
    let title='',html='';
    if(name==='switch'){
      title='切换工作';html='<p>选择一个工作后，带入、发现和结果会分别保留。</p><div class="worksite-work-list"></div><p class="worksite-panel-note">保存本次带入不代表内容已经发送、实现或验证。</p>'+(onCreateWork?button('create-work','建立本次工作',{cls:'worksite-primary'}):'');
    } else if(name==='source') {
      title='原文快照';html=`<p class="worksite-panel-note">${esc(item?.source?.title||'本次带入')} · 版本 ${esc(item?.sourceVersion??'—')}</p><blockquote>${esc(item?.sourceText||item?.source?.excerpt||'暂未选择带入内容。')}</blockquote><p>来源没有可打开的链接，原文仍可在这里核对。</p>`;
      if(item?.source?.url)html+=button('open-source-url','查看来处',{glyph:'external'});
    } else if(name==='correction') {
      title='修正这条影响关系';html=`<p>纠错仅保留本次说明，不抹去既有证据。</p>${label(fieldId('correction'),'说明哪里不准确')}<textarea id="${fieldId('correction')}" data-local-field="correction" rows="5">${esc(current.impact?.correction||'')}</textarea><footer>${button('close-panel','取消')}${button('save-correction','保留纠错',{cls:'worksite-primary'})}</footer>`;
    } else if(name==='profile'){
      title='个人区域';html='<p>当前没有账户接入。</p><p>数据保存范围以宿主显示为准；这里不提供云同步。</p>';
    } else if(name==='finding-source'){
      title='查看现场';html=`<p>${esc(current.finding?.source?.title||current.work?.title||'当前工作')}</p><blockquote>${esc(current.finding?.source?.excerpt||current.decision?.description||'尚无现场来源。')}</blockquote><p>来源没有可打开的链接，原文仍可在这里核对。</p>`;
    } else if(name==='finding-matter'){
      title='选择一件事';html=`<p>原始发现会保留，不必接受建议关联。</p><div class="worksite-work-list">${(current.matters||[]).map(matter=>button('choose-finding-matter',`${esc(matter.title)}<small>${esc(matter.stop)}</small>`,{attrs:`data-id="${esc(matter.id)}"`})).join('')}</div>`;
    }
    panel.querySelector('h2').textContent=title;body.innerHTML=html;panel.hidden=false;q('.worksite-panel-backdrop').hidden=false;
    if(name==='switch')renderWorkList(true);
    setDisabled('[data-action="save-correction"]',!q('[data-local-field="correction"]')?.value.trim());
    panel.focus();
  }
  function renderWorkList(force=false){
    const list=q('.worksite-work-list');if(!list||localPanel!=='switch')return;
    const signature=JSON.stringify([current.works,current.selectedWorkId]);if(!force&&signature===lastWorkList)return;lastWorkList=signature;
    list.innerHTML=(current.works||[]).length?current.works.map(work=>button('select-work',`${esc(work.title)}<small>${esc(work.agent)} · ${esc(work.project)}</small>`,{cls:work.id===current.selectedWorkId?'worksite-selected':'',attrs:`data-id="${esc(work.id)}" aria-pressed="${work.id===current.selectedWorkId}"`})).join(''):'<p>当前没有接入的工作</p>';
  }
  function updateLists(){
    const signature=JSON.stringify([current.intake,current.context,current.contextSummary,current.selectedIntakeId]);if(signature===lastLists)return;lastLists=signature;
    q('.worksite-intake-list').innerHTML=(current.intake||[]).map((item,index)=>`<article class="worksite-intake-row ${item.role==='exclude'?'worksite-excluded':''}">${orbit('file')}<div><h3>${esc(item.title)}</h3><p>${esc(item.relevance||item.usePlan)}</p><small>${esc(ROLES[item.role]||ROLES.reference)}</small></div>${button('open-intake',index===0?'查看这次怎样用':'查看',{glyph:'arrow',attrs:`data-id="${esc(item.id)}" aria-label="查看这次怎样用：${esc(item.title)}"`})}</article>`).join('');
    q('.worksite-empty-intake').hidden=Boolean(current.intake?.length);
  }
  function updateImpact(){
    const impact=current.impact||{},stages=impact.stages||{};
    const stageNames={provided:'已提供',decision:'给出取舍',artifact:'产物实现',usage:'真实使用'};
    q('.worksite-stage-list').innerHTML=Object.entries(stageNames).map(([key,title])=>`<span data-stage="${key}" data-confirmed="${Boolean(stages[key])}">${icon(stages[key]?'check':'circle')}${title} · ${stages[key]?(current.isDemo?'示例':'有依据'):'待核验'}</span>`).join('');
    q('.worksite-confirmed').replaceChildren(...((impact.confirmed?.length?impact.confirmed:['暂无可核验依据。']).map(value=>{const p=document.createElement('p');p.textContent=value;return p;})));
    q('.worksite-unconfirmed').replaceChildren(...((impact.unconfirmed?.length?impact.unconfirmed:['实际使用效果仍需观察。']).map(value=>{const p=document.createElement('p');p.textContent=value;return p;})));
    q('.worksite-evidence').innerHTML=(impact.evidence||[]).map(entry=>`<p><span>${entry.isDemo?'示例依据：':'依据：'}${esc(entry.text)}</span>${entry.source?.url?button('evidence-source','查看',{attrs:`data-id="${esc(entry.id)}"`,cls:'worksite-text-button',glyph:'external'}):''}</p>`).join('');
    const correctionButton=q('[data-action="correction"] span');correctionButton.textContent=impact.relation==='disputed'?'关系待核对 · 查看纠错':'这条影响关系不准确';
  }
  function animateState(next,previous){
    birdAnimation?.cancel?.();birdAnimation?.pause?.();bird.classList.remove('worksite-flying');
    const from=ANCHORS[previous]||ANCHORS[next],to=ANCHORS[next];
    const group=q('.worksite-path-group');
    group.innerHTML=(PATHS[next]||[]).map((path,index)=>`<path d="${path}" class="worksite-thread ${index===0&&next!=='results'||next==='results'&&index===1?'worksite-thread-gold':''}"/>`).join('');
    q('.worksite-node-group').innerHTML=(PATHS[next]||[]).map((path,index)=>{const nums=path.match(/-?\d+(?:\.\d+)?/g).map(Number);return `<circle cx="${nums[0]}" cy="${nums[1]}" r="${index===0?9:6}" class="worksite-node ${index===0&&next!=='results'||next==='results'&&index===1?'worksite-node-gold':''}"/><circle cx="${nums.at(-2)}" cy="${nums.at(-1)}" r="5" class="worksite-node ${index===0&&next!=='results'||next==='results'&&index===1?'worksite-node-gold':''}"/>`;}).join('');
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(!previous||reduced||!services.animate){bird.style.transform=`translate(${to[0]}px,${to[1]}px)`;return;}
    bird.classList.add('worksite-flying');
    const flight=q('.worksite-flight-path');flight.setAttribute('d',`M${from[0]} ${from[1]} Q${(from[0]+to[0])/2} ${Math.min(from[1],to[1])-95} ${to[0]} ${to[1]}`);
    try{
      const movement=services.svg?.createMotionPath?services.svg.createMotionPath(flight):{translateX:[from[0],to[0]],translateY:[from[1],to[1]]};
      delete movement.rotate;
      birdAnimation=services.animate(bird,{...movement,duration:650,ease:'out(3)',onComplete:()=>{bird.classList.remove('worksite-flying');bird.style.transform=`translate(${to[0]}px,${to[1]}px)`;}});
    }catch{bird.classList.remove('worksite-flying');bird.style.transform=`translate(${to[0]}px,${to[1]}px)`;}
  }

  function unfoldSurface(screen,previous){
    panelAnimation?.cancel?.();panelAnimation?.pause?.();
    if(panelTarget)panelTarget.style.transform='';
    const primary={overview:'decision',intake:'intake-detail',impact:'impact',finding:'finding',results:'result-understanding'};
    panelTarget=q(`[data-surface="${primary[screen]}"]`);
    const origin=pendingOrigin;pendingOrigin=null;
    if(!previous||!origin||host.classList.contains('worksite-narrow')||window.matchMedia('(prefers-reduced-motion: reduce)').matches||typeof services.animate!=='function')return;
    const target=panelTarget,box=target.getBoundingClientRect(),scale=scene.getBoundingClientRect().width/1672;
    if(!box.width||!box.height||!scale)return;
    const x=(origin.left+origin.width/2-box.left-box.width/2)/scale,y=(origin.top+origin.height/2-box.top-box.height/2)/scale;
    target.style.transformOrigin='center';
    try{panelAnimation=services.animate(target,{translateX:[x,0],translateY:[y,0],scaleX:[Math.max(.35,Math.min(1,origin.width/box.width)),1],scaleY:[Math.max(.35,Math.min(1,origin.height/box.height)),1],duration:520,ease:'out(4)',onComplete:()=>{target.style.transform='';glass.forEach(item=>item.refresh());}});}
    catch{target.style.transform='';}
  }

  function update(nextView){
    if(destroyed)return;
    const previous=current;current=nextView||{};
    const screen=SCREENS.includes(current.screen)?current.screen:'overview';
    const switched=activeWork!==current.selectedWorkId;
    const changed=activeScreen!==screen;
    if(switched){closePanel(false);lastLists='';lastMatterOptions='';}
    host.dataset.screen=screen;host.dataset.demo=String(Boolean(current.isDemo));host.dataset.hasIntake=String(Boolean(current.intake?.length));
    qa('.worksite-state').forEach(el=>el.hidden=el.dataset.screen!==screen);
    text('work-title',current.work?.title||'当前没有接入的工作');
    text('work-agent',current.work?`${current.work.agent||'Agent'} · ${current.work.project||'未选择项目'}`:'尚未连接');
    text('demo-status',current.isDemo?'示例':'');text('prototype-demo',current.isDemo?' · 示例内容':'');
    q('.worksite-agent-button span').textContent=current.work?.connected?`回到 ${current.work?.agent||'Agent'}`:'查看本次带入内容';
    text('intake-count',`· ${current.intake?.length||0}`);
    const decision=current.decision||{};
    text('decision-title',decision.title||'暂无具体取舍');text('decision-short',decision.title||'暂无具体取舍');text('decision-description',!current.isDemo&&!decision.id?'本次尚无工作取舍或产物依据。':decision.description||'外部 Agent 尚未连接，不会自动生成工作影响。');
    text('decision-truth',current.isDemo?'原型检查仅为示例，真实使用效果尚未确认。':current.work?.connected?'各项影响需要独立证据，不能由提供内容推定。':'外部 Agent 尚未连接，不代表已提供或已实现。');
    text('observation',current.impact?.unconfirmed?.[0]||'还没有带回实际观察。');
    qa('[data-action="artifact"] span').forEach(el=>{if(el.closest('.worksite-artifact-link'))el.textContent=decision.artifact?.title||'查看工作产物';if(el.closest('.worksite-fact-source'))el.textContent='查看本次工作来源';});
    q('.worksite-prototype-note').hidden=!current.isDemo;
    updateLists();renderWorkList();
    const intake=current.selectedIntake||current.intake?.find(item=>item.id===current.selectedIntakeId)||current.intake?.[0]||null;
    const other=current.intake?.find(item=>item.id!==intake?.id);
    text('intake-title',intake?.title||'还没有本次带入');text('role-summary',`当前：${ROLES[intake?.role]||'尚未选择'}`);
    text('source-text',intake?.sourceText||'先从一件事中选择要带去用的理解。');text('relevance',intake?.relevance||'尚无关联说明。');text('use-plan',intake?.usePlan||'尚未设置本次用法。');
    const context=current.context?.find(item=>item.id===intake?.id);
    text('context-instruction',intake?.role==='exclude'?'原文和过去的影响记录仍保留，不再进入本次上下文。':context?.instruction||'');
    field('intake-note',intake?.note,switched||previous.selectedIntakeId!==current.selectedIntakeId);
    qa('[data-action="role"]').forEach(el=>{el.setAttribute('aria-pressed',String(el.dataset.role===intake?.role));el.disabled=!intake;});
    text('other-title',other?.title||'暂无其他带入');text('other-relevance',other?.relevance||'');q('[data-surface="intake-other"]').hidden=!other;
    text('impact-source-title',intake?.title||'暂无带入的理解');text('impact-source-use',intake?.relevance||'');
    text('artifact-demo-title',`${decision.artifact?.title||'工作产物'}${decision.artifact?.isDemo&&!decision.artifact.title.includes('示例')?' · 示例':!decision.artifact?.isDemo&&!decision.artifact?.url?' · 尚未连接':''}`);
    q('.worksite-mini-prototype').hidden=!decision.artifact?.isDemo;
    updateImpact();
    field('composer',current.composer?.text,switched);
    const finding=current.finding||{};
    field('finding-text',finding.text,switched);field('finding-note',finding.note,switched);
    text('finding-source',finding.source?.title||`${current.work?.agent||'Agent'} · ${current.work?.project||'未选择项目'}`);
    const candidate=current.matters?.find(item=>item.id===finding.suggestedMatterId);
    text('suggested-matter-title',candidate?.title||'暂无可关联的事');text('suggested-stop',candidate?`上次停在：${candidate.stop||'尚无停点'}`:'原始发现会保留，不必接受建议关联。');
    text('finding-relation',finding.relation==='linked'?'已关联':finding.relation==='unrelated'?'已选择不关联':'无需现在决定。');
    q('[data-action="link-finding"]').setAttribute('aria-pressed',String(finding.relation==='linked'));q('[data-action="unlink-finding"]').setAttribute('aria-pressed',String(finding.relation==='unrelated'));
    text('finding-receipt',finding.useInCurrentWork?'仅用于本次工作，未发送给外部 Agent。':finding.saved?'已留在本次会话，留下后可以继续当前工作。':'留下后可以继续当前工作。');
    setDisabled('[data-action="link-finding"]',!candidate&&!current.matters?.length);setDisabled('[data-action="keep-finding"],[data-action="expand-finding"],[data-action="use-finding"]',!finding.text?.trim());
    const result=current.result||{},matter=current.matters?.find(item=>item.id===result.matterId)||null;
    const matterOptions=JSON.stringify(current.matters?.map(item=>({id:item.id,title:item.title}))||[]);
    if(lastMatterOptions!==matterOptions){lastMatterOptions=matterOptions;q('[data-field="result-matter"]').innerHTML='<option value="">选择一件事</option>'+(current.matters||[]).map(item=>`<option value="${esc(item.id)}">${esc(item.title)}</option>`).join('');}
    const resultIntake=(intake?.matterId===result.matterId?intake:null)||current.intake?.find(item=>item.matterId===result.matterId);
    field('result-matter',result.matterId,true);
    text('matter-stop',matter?(matter.stop||'当时没有留下停点'):'暂未选择一件事');
    text('matter-understanding',resultIntake?`本次带入 v${resultIntake.sourceVersion} · 当前理解 v${matter?.version??'—'}\n${resultIntake.sourceText}`:matter?`当前理解 v${matter.version} · 本次未带入这件事的理解快照\n${matter.understanding||'尚未写下理解。'}`:'选择一件事，再对照它的理解。');
    q('[data-action="result-matter"] span').textContent=`原问题：${matter?.title||'尚未选择'}`;
    field('result-fact',result.fact,switched);field('result-proposed',result.proposedUnderstanding,switched);field('result-unknown',result.unconfirmed,switched);field('result-interpretation',result.interpretation,switched);
    text('revision-status',result.decision==='revised'?'已确认修改':result.decision==='result-only'?'结果已留 · 理解未变':'建议修改 · 尚未生效');
    qa('[data-action="result-relation"]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.relation===(result.relation||'unknown'))));
    const hasFact=Boolean(result.fact?.trim()),revised=result.decision==='revised';
    setDisabled('[data-action="keep-result"]',!hasFact||revised);setDisabled('[data-action="retry"]',!hasFact);setDisabled('[data-action="review"]',revised||!hasFact||!result.proposedUnderstanding?.trim()||!matter);
    q('[data-action="review"] span').textContent=revised?'本次修改已确认':'查看修改并确认';
    const receipt=current.receipt,receiptVisible=Boolean(receipt||current.retry||result.decision==='result-only');q('.worksite-result-receipt').hidden=!receiptVisible;
    text('receipt',receipt?(receipt.undone?'已撤销，结果仍保留':`已确认修改 · 版本 ${receipt.version}`):current.retry?'已保留再试计划，不会自动创建外部任务。':'已保存结果，理解未变');
    q('[data-action="undo"]').hidden=!current.undo?.revision;
    const review=current.review||{};q('.worksite-review').hidden=!review.open;
    if(review.open){closePanel(false);q('.worksite-panel-backdrop').hidden=false;}
    else if(!localPanel)q('.worksite-panel-backdrop').hidden=true;
    text('review-fact',result.fact);text('review-before',review.before);field('review-after',review.after,switched||!previous.review?.open);
    text('review-error',review.stale?'内容已变化，请取消后重新查看差异。':'');
    setDisabled('[data-action="confirm-review"]',!review.open||review.stale||!review.after?.trim()||!hasFact);
    if(review.open&&!previous.review?.open){previousFocus=document.activeElement;queueMicrotask(()=>q('.worksite-review').focus());}
    if(!review.open&&previous.review?.open&&previousFocus?.isConnected)queueMicrotask(()=>previousFocus.focus());
    setDisabled('[data-submit="capture"]',!current.composer?.text?.trim());
    if(current.notice)showNotice(current.notice);
    else q('.worksite-notice').hidden=true;
    if(changed){animateState(screen,activeScreen);unfoldSurface(screen,activeScreen);if(activeScreen){q('.worksite-viewport').scrollTop=0;const title=q(`[data-screen="${screen}"] h2`);if(title){title.tabIndex=-1;queueMicrotask(()=>{if(!localPanel&&!current.review?.open)title.focus({preventScroll:true});});}}}
    activeScreen=screen;activeWork=current.selectedWorkId;
    resize();
  }
  function onClick(event){
    const el=event.target.closest('[data-action]');if(!el||!host.contains(el)||el.disabled)return;
    const type=el.dataset.action,intake=current.selectedIntake||current.intake?.[0];
    if(SCREENS.includes(type)||type==='open-intake'||type==='other-intake')pendingOrigin=(el.closest('[data-surface]')||el).getBoundingClientRect();
    if(type==='home')callExternal(onHome,undefined,'首页尚未连接。');
    else if(SCREENS.includes(type))dispatch({type:'NAVIGATE',screen:type});
    else if(type==='agent'){if(typeof onReturnToAgent!=='function')showNotice('此工作尚未连接外部 Agent。');else callExternal(onReturnToAgent,current.work,'此工作尚未连接外部 Agent。');}
    else if(type==='profile'&&onProfile)callExternal(onProfile,current,'个人设置尚未连接。');
    else if(type==='switch'&&onWorkspaces)callExternal(onWorkspaces,current,'工作列表尚未连接。');
    else if(type==='create-work')callExternal(onCreateWork,current,'工作创建入口尚未连接。');
    else if(type==='back'&&onBack)callExternal(onBack,current,'返回位置尚未连接。');
    else if(['switch','source','correction','profile','finding-source'].includes(type))openPanel(type);
    else if(type==='close-panel')closePanel();
    else if(type==='select-work'){closePanel(false);dispatch({type:'SELECT_WORK',id:el.dataset.id});}
    else if(type==='open-intake')dispatch({type:'OPEN_INTAKE',id:el.dataset.id});
    else if(type==='other-intake'){const other=current.intake?.find(item=>item.id!==intake?.id);if(other)dispatch({type:'OPEN_INTAKE',id:other.id});}
    else if(type==='role'&&intake)dispatch({type:'SET_INTAKE_ROLE',id:intake.id,role:el.dataset.role});
    else if(type==='artifact')openArtifact();
    else if(type==='matter')openMatter(intake?.matterId);
    else if(type==='result-matter')openMatter(current.result?.matterId);
    else if(type==='open-source-url')callExternal(onOpenArtifact,intake?.source,'来源尚未连接。');
    else if(type==='evidence-source'){const source=current.impact?.evidence?.find(item=>item.id===el.dataset.id)?.source;callExternal(onOpenArtifact,source,'来源尚未连接。');}
    else if(type==='save-correction'){const value=q('[data-local-field="correction"]')?.value.trim();if(value){closePanel();dispatch({type:'DISPUTE_IMPACT',text:value});}}
    else if(type==='keep-finding')dispatch({type:'KEEP_FINDING'});
    else if(type==='use-finding')dispatch({type:'USE_FINDING_IN_WORK'});
    else if(type==='expand-finding'){dispatch({type:'KEEP_FINDING'});openMatter(current.finding?.relation==='linked'?current.finding.suggestedMatterId:null);}
    else if(type==='link-finding'){if(current.finding?.suggestedMatterId)dispatch({type:'SET_FINDING_RELATION',decision:'linked',matterId:current.finding.suggestedMatterId});else openPanel('finding-matter');}
    else if(type==='choose-finding-matter'){closePanel(false);dispatch({type:'SET_FINDING_RELATION',decision:'linked',matterId:el.dataset.id});}
    else if(type==='unlink-finding')dispatch({type:'SET_FINDING_RELATION',decision:'unrelated'});
    else if(type==='result-relation')dispatch({type:'RESULT_DRAFT',patch:{relation:el.dataset.relation}});
    else if(type==='review')dispatch({type:'OPEN_REVISION_REVIEW'});
    else if(type==='cancel-review')dispatch({type:'CANCEL_REVISION_REVIEW'});
    else if(type==='confirm-review')dispatch({type:'CONFIRM_REVISION'});
    else if(type==='keep-result')dispatch({type:'KEEP_RESULT_ONLY'});
    else if(type==='retry')dispatch({type:'TRY_AGAIN'});
    else if(type==='undo')dispatch({type:'UNDO_REVISION'});
    else if(type==='dismiss-notice'){clearTimeout(toastTimer);q('.worksite-notice').hidden=true;dispatch({type:'CLEAR_NOTICE'});}
  }
  function input(event){
    const el=event.target,name=el.dataset.field,value=el.value;
    if(el.dataset.localField==='correction')setDisabled('[data-action="save-correction"]',!value.trim());
    if(composition.has(el)||event.isComposing)return;
    if(name==='composer')dispatch({type:'COMPOSER_DRAFT',text:value});
    else if(name==='intake-note'&&current.selectedIntake)dispatch({type:'SET_INTAKE_NOTE',id:current.selectedIntake.id,text:value});
    else if(name==='finding-text'||name==='finding-note')dispatch({type:'FINDING_DRAFT',patch:{[name==='finding-text'?'text':'note']:value}});
    else if(name==='review-after')dispatch({type:'REVISION_DRAFT',text:value});
    else if(name?.startsWith('result-')){const key={'result-fact':'fact','result-proposed':'proposedUnderstanding','result-unknown':'unconfirmed','result-interpretation':'interpretation','result-matter':'matterId'}[name];if(key)dispatch({type:'RESULT_DRAFT',patch:{[key]:value|| (key==='matterId'?null:'')}});}
  }
  function submit(event){if(event.target.dataset.form==='capture'){event.preventDefault();if(!composition.has(q('[data-field="composer"]'))&&current.composer?.text?.trim()){pendingOrigin=event.target.getBoundingClientRect();dispatch({type:'OPEN_FINDING'});}}}
  function keydown(event){
    if(event.key==='Escape'){if(current.review?.open){event.preventDefault();dispatch({type:'CANCEL_REVISION_REVIEW'});}else if(localPanel){event.preventDefault();closePanel();}else if(activeScreen!=='overview'){event.preventDefault();dispatch({type:'BACK'});}return;}
    if(event.key==='Enter'&&!event.shiftKey&&event.target.dataset.field==='composer'&&!event.isComposing&&!composition.has(event.target)){event.preventDefault();if(current.composer?.text?.trim()){pendingOrigin=event.target.closest('.worksite-composer').getBoundingClientRect();dispatch({type:'OPEN_FINDING'});}}
    if(event.key==='Tab'&&(localPanel||current.review?.open)){
      const panel=current.review?.open?q('.worksite-review'):q('.worksite-panel');
      const items=[...panel.querySelectorAll('button:not(:disabled),input,textarea,select,a[href]')].filter(el=>!el.hidden&&el.getClientRects().length);if(!items.length)return;
      const first=items[0],last=items.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel)){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===panel)){event.preventDefault();first.focus();}
    }
  }
  const startComposition=event=>composition.add(event.target);
  const endComposition=event=>{composition.delete(event.target);input(event);};
  host.addEventListener('click',onClick);host.addEventListener('input',input);host.addEventListener('change',input);host.addEventListener('submit',submit);host.addEventListener('keydown',keydown);host.addEventListener('compositionstart',startComposition);host.addEventListener('compositionend',endComposition);
  q('.worksite-panel-backdrop').addEventListener('click',()=>{if(localPanel)closePanel();});
  update(view);resize();
  return {update,destroy(){if(destroyed)return;destroyed=true;clearTimeout(toastTimer);birdAnimation?.cancel?.();birdAnimation?.pause?.();panelAnimation?.cancel?.();panelAnimation?.pause?.();resizeObserver?.disconnect();window.removeEventListener('resize',resize);glass.forEach(item=>item.destroy());fontFaces.forEach(face=>document.fonts.delete(face));host.remove();}};
}
