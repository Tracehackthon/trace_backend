// Runtime derivative of artifacts/trace-compare-v1-20260915/ui; original layout retained.
/** Trace compare UI. Native DOM; all business decisions belong to the supplied view/host. */
const GLASS_PATH = 'M 91 14 C 280 -2 705 3 859 17 C 961 28 999 68 992 153 C 986 247 941 286 834 291 C 624 305 263 299 114 287 C 21 279 0 227 9 139 C 14 63 31 26 91 14 Z';
// Reused and adapted from desktop/src/home-icons.js, local Trace-native icons.
const paths = {
  search:'<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  file:'<path d="M6 3h8l5 5v13H6zM14 3v6h5M9 13h6M9 17h6"/>',
  message:'<path d="M4 4h16v13H9l-5 4V4Z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/>',
  back:'<path d="M20 12H4m7-7-7 7 7 7"/>', next:'<path d="M4 12h16m-7-7 7 7-7 7"/>',
  arrow:'<path d="M12 21V3M4 11l8-8 8 8"/>', down:'<path d="m5 9 7 7 7-7"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>', check:'<path d="m5 12 5 5L20 7"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2Z"/>',
  edit:'<path d="m15 3 6 6-12 12H3v-6Z M12 6l6 6"/>',
  clip:'<path d="m8 14 8-8a3 3 0 0 1 4 4L9 21a5 5 0 0 1-7-7L14 2M7 15l8-8"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  idea:'<path d="M9 19h6M10 22h4M8 15a7 7 0 1 1 8 0l-1 3H9Z M12 1V0M2 5l-2-1M22 5l2-1"/>',
  users:'<circle cx="10" cy="7" r="3"/><path d="M3 20v-2a7 7 0 0 1 14 0v2H3ZM17 4a3 3 0 0 1 0 6M19 13a5 5 0 0 1 3 5v2"/>',
  switch:'<path d="M3 6h4c5 0 5 12 10 12h4M17 14l4 4-4 4M3 18h4c5 0 5-12 10-12h4M17 2l4 4-4 4"/>',
  folder:'<path d="M3 7V4h7l3 3h8v14H3Z"/>',
};
const icon = name => `<svg class="compare-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
const mark = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 11V7a3 3 0 1 0-3 3h16a3 3 0 1 0-3-3v18a3 3 0 1 0 3-3H8a3 3 0 1 0 3 3V11Z"/></svg>';
const button = (action,label,cls='',name='') => `<button type="button" class="compare-button ${cls}" data-action="${action}">${name?icon(name):''}<span>${label}</span></button>`;
const templates = {
 search: `<section class="compare-heading"><h1 tabindex="-1">从这一处找</h1><p>不用重新交代背景，就从这句话开始。</p></section>
  <svg class="compare-threads compare-search-thread" viewBox="0 0 1672 941" aria-hidden="true"><path d="M539 443 C620 448 628 346 705 346"/><circle cx="539" cy="443" r="8"/><circle cx="705" cy="346" r="9"/></svg>
  <section class="compare-anchor compare-glass-panel"><div class="compare-glass" data-glass></div><div class="compare-anchor-copy"><p class="compare-kicker">正在推敲的一句</p><blockquote data-text="focus"></blockquote></div></section>
  <img class="compare-bird compare-search-bird" data-bird="fly" alt="" aria-hidden="true">
  <form class="compare-search-form compare-paper" data-form="search"><h2>这次想弄清楚</h2>
   <div class="compare-question-row"><label class="compare-sr" for="compare-question">这次想弄清楚</label><input id="compare-question" data-field="question" autocomplete="off"><button type="button" data-action="focus-question" class="compare-button compare-quiet">${icon('edit')}修改这一处</button></div>
   <div class="compare-directions" role="group" aria-label="寻找方向"><button type="button" class="compare-button" data-direction="counterexample">${icon('search')}找个反例</button><button type="button" class="compare-button" data-direction="experience">${icon('users')}看看别人怎么做</button><button type="button" class="compare-button" data-direction="condition">${icon('switch')}换一种条件</button></div>
   <label class="compare-sr" for="compare-instructions">补充寻找条件</label><textarea id="compare-instructions" data-field="instructions" rows="3" placeholder="说说你想找的情况……"></textarea>
   <div class="compare-search-bottom"><div class="compare-scopes-wrap">${button('scopes','查找范围','compare-scopes-button','down')}<div class="compare-scopes-popover" hidden><p>范围中所列平台仅作为演示条件，不会实际请求平台。</p><div data-options="scopes"></div></div></div>${button('import','已有材料，直接带入','','clip')}<button type="submit" class="compare-button compare-primary" data-search-submit>开始找</button></div>
   <div class="compare-search-help"><p>${icon('info')}假设情形会单独标明，不会作为真实案例。<small>本次只查看本地演示材料，不会联网搜索。</small></p>${button('return','先放着')}</div>
  </form>`,
 candidates:`<section class="compare-heading"><h1 tabindex="-1" data-text="candidatesHeading">找到三处值得看看</h1><p>先看看条件，再决定有没有关系。</p></section>
  <div class="compare-query-strip">${icon('search')}<strong data-text="shortQuestion"></strong>${button('adjust','调整寻找方向','compare-text-button','next')}</div>
  <svg class="compare-threads compare-candidates-thread" viewBox="0 0 1672 941" aria-hidden="true"><path d="M541 453 C605 449 608 516 653 518"/><path d="M1054 524 C1100 523 1105 480 1165 480" class="compare-amber-thread"/><circle cx="541" cy="453" r="9"/><circle cx="653" cy="518" r="6"/><circle cx="1054" cy="524" r="6" class="compare-amber-node"/><circle cx="1165" cy="480" r="8" class="compare-amber-node"/></svg>
  <img class="compare-bird compare-candidates-bird" data-bird="perch" alt="" aria-hidden="true"><section class="compare-candidate-list" aria-label="待确认候选"></section>
  <section class="compare-empty compare-paper" hidden><h2>没有找到贴切的候选</h2><p>调整条件，或带入一段你已有的材料。</p>${button('adjust','调整寻找方向','compare-primary')}</section>
  <div class="compare-candidates-footer"><div class="compare-adjust-strip">${icon('message')}<label class="compare-sr" for="compare-adjust">调整寻找条件</label><input id="compare-adjust" data-field="adjust" placeholder="这些都不贴切？说说条件差在哪里……">${button('adjust-with-text','调整后再找','compare-text-button','next')}</div>${button('import','带入自己的材料','compare-link-button','clip')}</div>`,
 compare:`<section class="compare-heading compare-heading-small"><h1 tabindex="-1">放在一起看</h1><p>把你的疑问，和一份相关的材料放在一起，看看它们哪里相同，哪里不同。</p></section>
  <button type="button" class="compare-back-candidates compare-button compare-text-button" data-action="back-candidates">${icon('back')}<span data-text="candidateIndex">返回候选</span></button>
  <svg class="compare-threads compare-reading-thread" viewBox="0 0 1672 941" aria-hidden="true"><path d="M742 333 C824 286 855 355 904 392"/><circle cx="742" cy="333" r="8"/><circle cx="904" cy="392" r="7" class="compare-amber-node"/></svg>
  <img class="compare-bird compare-reading-bird" data-bird="perch" alt="" aria-hidden="true">
  <section class="compare-thought compare-reading compare-paper"><h2><span class="compare-round-icon">${icon('message')}</span>我正在推敲的这一处</h2><blockquote data-text="focus"></blockquote><div class="compare-question-context"><span class="compare-question-mark">?</span><div><strong>当时的疑问</strong><p data-text="question"></p></div></div></section>
  <section class="compare-source compare-reading compare-paper"><h2><span class="compare-round-icon">${icon('file')}</span>这份材料实际说了什么</h2><p class="compare-meta" data-text="sourceMeta"></p><blockquote data-text="excerpt"></blockquote><div class="compare-source-actions">${button('context','查看原文上下文','compare-text-button','file')}${button('material-info','材料信息','compare-text-button','info')}</div></section>
  <section class="compare-suggestions compare-paper"><div class="compare-suggestion-label"><span class="compare-round-icon compare-warm-icon">${icon('idea')}</span><div><h2>Trace 的关系建议 · 尚未确认</h2><p>这只是初步的对照分析，是否采纳由你决定。</p></div></div><div class="compare-suggestion-rows"><p><i></i><strong>相同：</strong><span data-text="same"></span></p><p><i></i><strong>不同：</strong><span data-text="different"></span></p><p><i></i><strong>尚不能说明：</strong><span data-text="unknown"></span></p></div></section>
  <form class="compare-note-form compare-paper" data-form="note"><label for="compare-note">${icon('edit')}你怎么看这一处不同？</label><div><textarea id="compare-note" data-field="comparisonDraft" rows="1" placeholder="留下你对条件差异的判断……"></textarea><button type="submit" class="compare-button compare-primary compare-send" aria-label="保存这次判断">${icon('arrow')}</button></div></form>
  <div class="compare-reading-actions">${button('link','接到这件事','compare-primary')}${button('revision','补进我的理解')}${button('reject','这次无关')}<small>${icon('info')}接入材料，不会自动修改你的理解。</small></div>`,
 returned:`<section class="compare-return-sheet compare-paper"><div class="compare-return-title"><p class="compare-kicker" data-text="receiptStatus">我的理解 · 已更新</p><h1 tabindex="-1">这处理解，刚有变化</h1></div><div class="compare-receipt-actions">${icon('file')}<span>只更新了这一处</span>${button('changes','查看改动')}${button('undo','撤销')}</div>
  <div class="compare-before"><span>原来：</span><p data-text="before"></p></div><div class="compare-after"><span>现在：</span><p data-text="after"></p></div>
  <details class="compare-reason" open><summary>${icon('down')}看看为什么改变</summary><article><div><span class="compare-round-icon">${icon('file')}</span><div><h2 data-text="sourceTitle"></h2><p data-text="linkedMeta"></p></div><span class="compare-relation-badge" data-text="relationLabel"></span></div><p class="compare-reason-text" data-text="rationale"></p></article></details>
  <section class="compare-unresolved"><div><p>还没分清</p><blockquote><span>?</span><span data-text="unresolved"></span></blockquote></div><div class="compare-next-actions">${button('continue','从这里继续','compare-primary')}${button('another','再找一种情形')}${button('return','先停在这里')}</div></section>
  <div class="compare-trajectory"><svg viewBox="0 0 1180 95" aria-hidden="true"><path d="M90 45 C252 -34 309 99 520 45 S804 95 996 45"/><circle cx="90" cy="45" r="10"/><circle cx="520" cy="45" r="10"/><circle cx="996" cy="45" r="11"/></svg><div><section><h3>原来的理解</h3><p data-text="before"></p></section><section><h3>这次对照</h3><p data-text="sourceTitle"></p><small data-text="linkedMeta"></small></section><section><h3>当前理解</h3><p data-text="after"></p></section></div></div><img class="compare-bird compare-return-bird" data-bird="fly" alt="" aria-hidden="true"></section>`,
};

const kindLabel = candidate => candidate?.kind === 'hypothetical' ? '假设情形' : candidate?.kind === 'user' ? '用户带入材料' : '演示材料';
const relationLabels = {limit:'限制',limitation:'限制',supplement:'补充',support:'支持',challenge:'挑战',related:'有关',uncertain:'有关'};
const asText = value => value == null ? '' : typeof value === 'string' ? value : Array.isArray(value) ? value.join('；') : String(value.text ?? value.label ?? '');

/** CSS is intentionally separately supplied. root is owned exclusively by this mounted instance. */
export function mountComparisonScreen({root,view,onAction=()=>{},onReturn=()=>{},onContinue=()=>{},onAll=()=>{},onProfile,assets={},services={}}) {
  if (!root || typeof root.replaceChildren !== 'function') throw new TypeError('A root element is required.');
  let current = view;
  let screen = '';
  let selectedId = null;
  let dead = false;
  let modalType = null;
  let priorFocus = null;
  let scopeOpen = false;
  let glass = [];
  let animation = null;
  let adjustDraft = '';
  const composing = new WeakSet();
  const fonts = [];
  root.classList.add('compare-root');
  root.innerHTML = `<div class="compare-scene"><header class="compare-header"><div class="compare-brand"><span>${mark}</span><strong>Trace</strong></div><nav aria-label="当前位置"><span data-shell="first"></span><i>/</i><strong data-shell="last">找个对照</strong></nav><button type="button" class="compare-button compare-top-return" data-action="return">${icon('back')}<span>返回原来的事情</span></button><span class="compare-demo">演示内容</span></header><main class="compare-main"></main><button type="button" class="compare-profile" data-action="profile" aria-label="个人设置">${icon('user')}</button><div class="compare-notice" role="status" aria-live="polite" hidden><span></span><button class="compare-button" type="button" aria-label="关闭提示" data-action="clear-notice">${icon('close')}</button></div></div><dialog class="compare-dialog" aria-labelledby="compare-dialog-title"><div class="compare-dialog-heading"><h2 id="compare-dialog-title"></h2><button type="button" class="compare-button compare-icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div><div class="compare-dialog-content"></div></dialog>`;
  const scene = root.querySelector('.compare-scene');
  const main = root.querySelector('.compare-main');
  const dialog = root.querySelector('dialog');
  const $ = selector => root.querySelector(selector);
  const all = selector => [...root.querySelectorAll(selector)];
  if (assets.background) root.style.backgroundImage = `url(${JSON.stringify(String(assets.background))})`;
  root.dataset.environment = assets.background ? 'supplied' : 'missing';
  for (const [key,name] of [['serifFont','Trace Compare Serif'],['sansFont','Trace Compare Sans']]) {
    if (!assets[key] || typeof FontFace === 'undefined') continue;
    const face = new FontFace(name,`url(${JSON.stringify(String(assets[key]))})`,{weight:key==='serifFont'?'250 900':'100 900',display:'swap'});
    face.load().then(loaded=>{if(!dead){document.fonts.add(loaded);fonts.push(loaded);}}).catch(()=>{if(!dead)root.dataset.fontFallback='true';});
  }
  function emit(action) { if(!dead) onAction(action); }
  function candidate() { return current.selectedCandidate || current.candidates?.find(item=>item.id===current.selectedId); }
  function text(key,value) { all(`[data-text="${key}"]`).forEach(el=>{el.textContent=asText(value);}); }
  function emphasizeTerm(element,term,tag='mark') {
    if(!element || !element.textContent.includes(term))return;
    const parts=element.textContent.split(term);element.replaceChildren();
    parts.forEach((part,index)=>{if(index){const mark=document.createElement(tag);mark.textContent=term;element.append(mark);}element.append(document.createTextNode(part));});
  }
  function field(key,value,force=false) {
    const el=$(`[data-field="${key}"]`);
    if (el && el.value !== asText(value) && !composing.has(el) && (force || document.activeElement!==el)) el.value=asText(value);
  }
  function options(element,items,selected) {
    if(!element)return;
    element.replaceChildren();
    items.forEach(item=>{const option=document.createElement('option');option.value=item.value;option.textContent=item.label;option.selected=item.value===selected;element.append(option);});
  }
  function relLabel(type) { return current.relationOptions?.find(o=>o.value===type)?.label || relationLabels[type] || '有关'; }
  function relationTarget(item) { return asText(item?.relationship?.target) || asText(current.matter?.focus?.text); }
  function resize() {
    const rect=root.getBoundingClientRect();
    const compact=rect.width<1000;
    root.classList.toggle('compare-compact',compact);
    if(!compact)scene.style.setProperty('--compare-scale',String(Math.min(rect.width/1672,rect.height/941)));
    glass.forEach(g=>g.refresh?.());
  }
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  observer?.observe(root);
  function setupGlass() {
    glass.forEach(g=>g.destroy());glass=[];
    if(typeof services.mountSceneGlass!=='function')return;
    all('[data-glass]').forEach(host=>{try{glass.push(services.mountSceneGlass({host,scene:root,backgroundUrl:assets.background,path:GLASS_PATH,width:host.clientWidth,height:host.clientHeight,tone:'cool'}));}catch{host.dataset.material='fallback';}});
  }
  function animateScreen() {
    animation?.cancel?.();
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof services.animate!=='function')return;
    animation=services.animate(main,{opacity:[0,1],translateY:[6,0],duration:380,ease:'outQuad'});
  }
  function setBirds() { all('[data-bird]').forEach(el=>{const url=el.dataset.bird==='fly'?assets.birdTakeoff:assets.birdPerched;if(url){el.src=url;el.hidden=false;}else{el.hidden=true;}}); }
  function renderCandidates() {
    const list=$('.compare-candidate-list');if(!list)return;
    const items=current.candidates||[];
    const signature=JSON.stringify(items);
    if(list.dataset.signature===signature)return;
    list.dataset.signature=signature;list.replaceChildren();
    items.forEach((item,index)=>{
      const article=document.createElement('article');article.className=`compare-candidate compare-paper ${index===0?'compare-candidate-emphasis':''}`;
      article.innerHTML=`${index===0?'<div class="compare-glass" data-glass></div>':''}<div class="compare-candidate-head"><span class="compare-round-icon ${index===2?'compare-warm-icon':''}">${icon(index===2?'folder':'file')}</span><div><h2></h2><p class="compare-source-badge"></p></div></div><p class="compare-candidate-excerpt"></p><p class="compare-candidate-relation"><i></i><span></span></p><button type="button" class="compare-button ${index===0?'compare-primary':''}" data-action="open-candidate"><span>${index===0?'放在一起看':'看看这一处'}</span>${icon('next')}</button><span class="compare-decision" hidden></span>`;
      article.querySelector('h2').textContent=item.title;
      article.querySelector('.compare-source-badge').textContent=`${kindLabel(item)} · ${item.sourceType||'自带摘录'}`;
      article.querySelector('.compare-candidate-excerpt').textContent=item.summary || item.preview || item.excerpt;
      const summary=item.relationship?.summary || item.relationship?.reason;
      article.querySelector('.compare-candidate-relation span').textContent=summary || `可能${relLabel(item.relationship?.type)}：${relationTarget(item)}`;
      article.querySelector('button').dataset.id=item.id;
      if(item.decision!=='pending') {const el=article.querySelector('.compare-decision');el.hidden=false;el.textContent=item.decision==='linked'?'已接入':item.decision==='rejected'?'已排除':'待确认';}
      list.append(article);
    });
    $('.compare-empty').hidden=items.length>0;
    $('.compare-candidates-thread').hidden=items.length!==3;
    if($('.compare-candidates-bird'))$('.compare-candidates-bird').hidden=items.length===0 || !assets.birdPerched;
    setupGlass();
  }
  function modal(title,html,type) {
    if(modalType===type)return;
    if(dialog.open)dialog.close();
    priorFocus=document.activeElement;modalType=type;
    $('#compare-dialog-title').textContent=title;
    $('.compare-dialog-content').innerHTML=html;
    dialog.showModal();
    requestAnimationFrame(()=>{if(!dead&&dialog.open)(dialog.querySelector('textarea,input,select')||dialog.querySelector('button')).focus();});
  }
  function closeModal(cancelRevision=false) {
    const was=modalType;modalType=null;if(dialog.open)dialog.close();
    priorFocus?.isConnected&&priorFocus.focus();
    if(cancelRevision&&was==='revision')emit({type:'CANCEL_REVISION'});
  }
  function revisionModal() {
    const creating=current.revision?.mode==='create';
    modal(creating?'写下新的个人理解':'确认局部修订',`<p class="compare-dialog-help">先看内容，再确认留下。接入材料与修改理解是两件不同的事。</p><section class="compare-dialog-before"><h3>${creating?'当前理解':'原来的这一处'}</h3><p data-modal="before"></p></section><label for="compare-revision">${creating?'新的个人理解':'修改为'}</label><textarea id="compare-revision" data-field="revision" rows="5"></textarea><section class="compare-dialog-after"><h3>${creating?'将留下的理解':'确认后的这一处'}</h3><p data-modal="after"></p></section><p class="compare-dialog-help">${creating?'原表达与材料不改动，只有你确认的文字会成为个人理解。':'此次只替换选中片段，不重写其他内容。'}</p><p class="compare-dialog-version"></p><div class="compare-dialog-actions">${button('cancel-revision','先不修改')}${button('confirm-revision',creating?'确认留下理解':'确认更新这一处','compare-primary')}</div>`, 'revision');
    $('[data-modal="before"]').textContent=creating?'还没有保存的理解。':asText(current.revision?.before);
    $('[data-modal="after"]').textContent=asText(current.revision?.after || current.revision?.draft);
    field('revision',current.revision?.draft);
    $('.compare-dialog-version').textContent=`事项版本：${current.revision?.baseVersion ?? current.matter?.version ?? ''}`;
    $('[data-action="confirm-revision"]').disabled=!current.revision?.canConfirm || !!current.pending;
  }
  function openLink() {
    const item=candidate();if(!item)return;
    modal('关联位置与关系',`<p class="compare-dialog-help">接入材料，不会自动修改你的理解。</p><h3>具体位置</h3><blockquote data-modal="target"></blockquote><label for="compare-relation">关系</label><select id="compare-relation" data-field="relation"></select><p class="compare-dialog-help" data-modal="reason"></p><div class="compare-dialog-actions">${button('close-modal','保持当前理解不变')}${button('confirm-link','接到这件事','compare-primary')}</div>`, 'link');
    $('[data-modal="target"]').textContent=asText(current.matter?.focus?.text);
    $('[data-modal="reason"]').textContent=item.relationship?.reason || '关系由你决定，材料本身保持不变。';
    options($('#compare-relation'),current.relationOptions || Object.entries(relationLabels).filter(([key])=>!['limitation','uncertain'].includes(key)).map(([value,label])=>({value,label})),item.relationship?.type);
  }
  function openMaterial(type) {
    const item=candidate();if(!item)return;
    if(type==='context') {
      modal('查看原文上下文','<p class="compare-meta" data-modal="meta"></p><h3 data-modal="title"></h3><div class="compare-source-context" data-modal="context"></div><p class="compare-dialog-help">此材料没有外网原文链接。</p>','context');
      $('[data-modal="context"]').textContent=asText(item.context) || item.excerpt;
    }else{
      modal('材料信息','<p class="compare-meta" data-modal="meta"></p><h3 data-modal="title"></h3><dl class="compare-material-info"><dt>材料性质</dt><dd data-modal="kind"></dd><dt>来源类型</dt><dd data-modal="source"></dd><dt>关系</dt><dd data-modal="relationship"></dd></dl><p class="compare-dialog-help">此材料没有外网原文链接。</p>','material-info');
      $('[data-modal="kind"]').textContent=kindLabel(item);$('[data-modal="source"]').textContent=item.sourceType||'自带摘录';$('[data-modal="relationship"]').textContent=`${relLabel(item.relationship?.type)} · ${item.decision==='linked'?'已接入':'待确认'}`;
    }
    $('[data-modal="title"]').textContent=item.title;$('[data-modal="meta"]').textContent=`${kindLabel(item)} · ${item.sourceType||'自带摘录'}`;
  }
  function openImport() {
    modal('带入自己的材料',`<form data-form="import"><p class="compare-dialog-help">仅带入你粘贴的文字，不会读取文件或外部网页。</p><label for="compare-material-title">材料标题</label><input id="compare-material-title" name="title" required maxlength="240"><label for="compare-material-excerpt">粘贴摘录</label><textarea id="compare-material-excerpt" name="excerpt" required rows="4"></textarea><label for="compare-material-context">材料上下文（可选）</label><textarea id="compare-material-context" name="context" rows="3"></textarea><div class="compare-dialog-actions"><button type="submit" class="compare-button compare-primary">带入这段材料</button></div></form>`,'import');
  }
  function openChanges() {
    modal('查看改动','<div class="compare-dialog-before"><h3>原来的这一处</h3><p data-modal="before"></p></div><div class="compare-dialog-after"><h3>现在的这一处</h3><p data-modal="after"></p></div><p class="compare-dialog-help" data-modal="receipt"></p>','changes');
    $('[data-modal="before"]').textContent=asText(current.receipt?.before);$('[data-modal="after"]').textContent=asText(current.receipt?.after);$('[data-modal="receipt"]').textContent=`修订编号：${current.receipt?.revisionId||'—'} · 事项版本：${current.matter?.version??'—'}`;
  }
  function update(nextView) {
    if(dead)return;
    current=nextView || current;
    const nextScreen=templates[current?.screen]?current.screen:'search';
    const changed=screen!==nextScreen;
    const changedCandidate=selectedId!==current.selectedId;
    if(changed){closeModal();glass.forEach(g=>g.destroy());glass=[];screen=nextScreen;main.innerHTML=templates[screen];root.dataset.screen=screen;setBirds();setupGlass();animateScreen();}
    selectedId=current.selectedId;
    const item=candidate();
    $('[data-shell="first"]').textContent=screen==='returned'?'在意的事':asText(current.matter?.title);
    $('[data-shell="last"]').textContent=screen==='returned'?asText(current.matter?.title):'找个对照';
    $('.compare-top-return span').textContent=screen==='returned'?'全部轨迹':'返回原来的事情';
    $('.compare-demo').textContent=current.isDemo?'演示内容':'本地对照';
    $('.compare-profile').hidden=typeof onProfile!=='function';
    text('focus',current.matter?.focus?.text);text('question',current.query?.question);
    if(current.isDemo)all('[data-text="focus"]').forEach(el=>emphasizeTerm(el,'必须'));
    text('shortQuestion',current.query?.shortQuestion || current.query?.question);
    if(screen==='search') {
      field('question',current.query?.question);field('instructions',current.query?.instructions);
      all('[data-direction]').forEach(el=>{const selected=el.dataset.direction===current.query?.direction;el.classList.toggle('compare-selected',selected);el.setAttribute('aria-pressed',String(selected));});
      const scopes=current.scopeOptions || [{value:'past',label:'既往思考'},{value:'zhihu',label:'知乎公开内容'}];
      const wrap=$('[data-options="scopes"]');
      if(wrap && !wrap.children.length)scopes.forEach(item=>{const label=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.value=item.value;input.dataset.field='scope';label.append(input,document.createTextNode(item.label));wrap.append(label);});
      all('[data-field="scope"]').forEach(el=>{el.checked=(current.query?.scopes||[]).includes(el.value);});
      const labels=scopes.filter(o=>(current.query?.scopes||[]).includes(o.value)).map(o=>o.label);
      $('.compare-scopes-button span').textContent=`查找范围：${labels.join(' · ') || '请选择'}`;
      const unavailable=current.search?.capabilityAvailable===false;
      $('[data-search-submit]').disabled=unavailable || !current.query?.question?.trim() || !!current.pending;
      $('[data-search-submit]').textContent=unavailable?'自动查找未连接':'开始找';
      $('[data-action="import"] span').textContent=unavailable?'粘贴一段材料作对照':'已有材料，直接带入';
      $('[data-action="import"]').classList.toggle('compare-primary',unavailable);
      $('.compare-search-help small').textContent=unavailable?'尚未连接自动查找。你可以直接带入一段材料，原表达与理解不会因此改变。':current.isDemo?'本次只查看演示材料，不会联网搜索。':'查找当前可用材料，不代表材料关系已确认。';
      $('.compare-scopes-popover > p').textContent=unavailable?'自动查找尚未连接；选择范围不会访问外部平台。':'只在宿主已连接的来源范围内查找。';
    }
    if(screen==='candidates'){
      text('candidatesHeading',(current.candidates?.length===3)?'找到三处值得看看':current.candidates?.length?`找到 ${current.candidates.length} 处值得看看`:'再换个角度找找');
      field('adjust',adjustDraft);renderCandidates();
    }
    if(screen==='compare'){
      text('candidateIndex',`返回候选 · ${Math.max(0,current.candidates?.findIndex(c=>c.id===current.selectedId)??0)+1} / ${current.candidates?.length||0}`);
      text('sourceMeta',`${kindLabel(item)} · ${item?.sourceType||'自带摘录'}`);text('excerpt',item?.excerpt);
      text('same',current.comparison?.same || '请结合两处原文判断。');text('different',current.comparison?.different || item?.relationship?.reason || '条件差异尚待确认。');text('unknown',current.comparison?.unknown || item?.relationship?.uncertain || '尚不能据此形成结论。');
      field('comparisonDraft',current.comparisonDraft,changedCandidate);
      $('[data-action="link"] span').textContent=item?.decision==='linked'?'已接到这件事':'接到这件事';
      $('[data-action="link"]').disabled=!!current.pending || item?.decision==='linked';
      $('[data-action="reject"]').disabled=!!current.pending || item?.decision==='linked';
      $('[data-action="reject"]').title=item?.decision==='linked'?'已关联材料不会在这里被解除；仍可单独补进理解。':'';
      $('[data-action="revision"]').disabled=!!current.pending;
      $('[data-action="revision"] span').textContent=current.matter?.understanding?'补进我的理解':'写进我的理解';
      $('[data-action="revision"]').title=current.matter?.understanding&&current.matter?.basis?.field!=='understanding'?'请先回到我的理解选择要修改的片段；原表达不改动。':'';
      $('.compare-suggestion-label h2').textContent=current.isDemo?'Trace 的关系建议 · 尚未确认':'关系核对 · 尚未确认';
      $('.compare-suggestion-label p').textContent='结合原表达与材料核对，是否接入由你决定。';
      $('.compare-note-form [type="submit"]').disabled=!current.comparisonDraft?.trim() || !!current.pending;
    }
    if(screen==='returned'){
      const receipt=current.receipt;
      const linked=receipt?.linkedSource;
      const source=typeof linked==='object'?linked:item;
      const before=receipt?.before || '';
      const after=receipt?.after || '';
      const type=receipt?.relationship?.type || receipt?.relation?.type || source?.relationship?.type || item?.relationship?.type;
      text('receiptStatus',receipt?.kind==='create'?'已留下新的理解 · 原表达未改动':receipt?'我的理解 · 已更新':'尚无已提交修订');
      const creating=receipt?.kind==='create';
      $('.compare-return-title h1').textContent=creating?'这次，写下自己的理解':'这处理解，刚有变化';
      $('.compare-receipt-actions > span').textContent=creating?'原表达未改动':'只更新了这一处';
      $('.compare-before > span').textContent=creating?'此前尚无个人理解':'原来：';
      $('.compare-trajectory section h3').textContent=creating?'此前尚无理解':'原来的理解';
      text('before',before);text('after',after);text('sourceTitle',source?.title || receipt?.sourceTitle || item?.title || '这次对照');
      if(current.isDemo&&!asText(after).includes('必须'))emphasizeTerm($('.compare-before p'),'必须','s');
      text('linkedMeta',`${kindLabel(source||item)} · 已接为${relLabel(type)}`);text('relationLabel',relLabel(type));
      text('rationale',receipt?.rationale || receipt?.note || current.savedComparisonNote || source?.relationship?.reason || '这次只更新了选中的表达；材料与判断分别保留。');
      text('unresolved',current.matter?.unresolved || '下一步，还想分清什么？');
      $('[data-action="undo"]').disabled=!current.canUndo || !!current.pending;
    }
    const notice=current.notice || (current.pending?'等待事项确认':'');
    $('.compare-notice').hidden=!notice;$('.compare-notice > span').textContent=asText(notice);
    if(current.revision?.open)revisionModal();else if(modalType==='revision')closeModal();
    if(modalType==='link' && current.pending)$('[data-action="confirm-link"]').disabled=true;
    if(changed)resize();
  }
  function click(event) {
    const direction=event.target.closest('[data-direction]');if(direction){emit({type:'QUERY_PATCH',patch:{direction:direction.dataset.direction}});return;}
    const target=event.target.closest('[data-action]');if(!target || target.disabled)return;
    const action=target.dataset.action;
    if(action==='return'){screen==='returned'&&target.classList.contains('compare-top-return')?onAll(current):onReturn(current);return;}
    if(action==='continue'){onContinue(current);return;}
    if(action==='profile'){if(onProfile)onProfile(current);else{current={...current,notice:'个人设置尚未连接。'};update(current);}return;}
    if(action==='focus-question'){$('[data-field="question"]')?.focus();return;}
    if(action==='scopes'){scopeOpen=!scopeOpen;$('.compare-scopes-popover').hidden=!scopeOpen;target.setAttribute('aria-expanded',String(scopeOpen));return;}
    if(action==='import'){openImport();return;}
    if(action==='context'||action==='material-info'){openMaterial(action);return;}
    if(action==='link'){openLink();return;}
    if(action==='confirm-link'){closeModal();emit({type:'LINK'});return;}
    if(action==='close-modal'){closeModal(true);return;}
    if(action==='cancel-revision'){closeModal(true);return;}
    if(action==='changes'){openChanges();return;}
    if(action==='adjust-with-text'){if(adjustDraft.trim())emit({type:'QUERY_PATCH',patch:{instructions:adjustDraft}});emit({type:'ADJUST_SEARCH'});return;}
    const mapped={adjust:'ADJUST_SEARCH',another:'ADJUST_SEARCH','back-candidates':'BACK_TO_CANDIDATES',revision:'OPEN_REVISION','confirm-revision':'CONFIRM_REVISION',reject:'REJECT',undo:'UNDO_REVISION','clear-notice':'CLEAR_NOTICE'};
    if(action==='open-candidate')emit({type:'OPEN_CANDIDATE',id:target.dataset.id});else if(mapped[action])emit({type:mapped[action]});
  }
  function input(event) {
    const el=event.target;if(composing.has(el))return;
    const key=el.dataset.field;
    if(key==='question'||key==='instructions')emit({type:'QUERY_PATCH',patch:{[key]:el.value}});
    if(key==='comparisonDraft')emit({type:'COMPARISON_DRAFT',text:el.value});
    if(key==='revision')emit({type:'REVISION_DRAFT',text:el.value});
    if(key==='adjust')adjustDraft=el.value;
  }
  function change(event){const el=event.target;if(el.dataset.field==='scope')emit({type:'QUERY_PATCH',patch:{scopes:all('[data-field="scope"]:checked').map(i=>i.value)}});if(el.dataset.field==='relation')emit({type:'RELATION_PATCH',patch:{type:el.value}});}
  function submit(event) {
    const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();
    if(form.dataset.form==='search'&&current.search?.capabilityAvailable!==false)emit({type:'SEARCH'});
    if(form.dataset.form==='note')emit({type:'SAVE_COMPARISON_NOTE'});
    if(form.dataset.form==='import'){
      const data=new FormData(form);const title=String(data.get('title')||'').trim();const excerpt=String(data.get('excerpt')||'').trim();
      if(!title||!excerpt){form.reportValidity();return;}
      closeModal();emit({type:'IMPORT_MATERIAL',material:{title,excerpt,context:String(data.get('context')||''),sourceType:'用户带入摘录',url:null}});
    }
  }
  function compositionStart(event){composing.add(event.target);}
  function compositionEnd(event){composing.delete(event.target);input(event);}
  function keydown(event){if(event.isComposing)return;if(event.key==='Escape'&&!dialog.open&&scopeOpen){scopeOpen=false;$('.compare-scopes-popover').hidden=true;$('.compare-scopes-button').focus();}}
  function cancel(event){event.preventDefault();closeModal(true);}
  root.addEventListener('click',click);root.addEventListener('input',input);root.addEventListener('change',change);root.addEventListener('submit',submit);root.addEventListener('compositionstart',compositionStart);root.addEventListener('compositionend',compositionEnd);root.addEventListener('keydown',keydown);dialog.addEventListener('cancel',cancel);
  update(view);resize();
  return {update,destroy(){if(dead)return;dead=true;observer?.disconnect();animation?.cancel?.();glass.forEach(g=>g.destroy());fonts.forEach(f=>document.fonts.delete(f));root.removeEventListener('click',click);root.removeEventListener('input',input);root.removeEventListener('change',change);root.removeEventListener('submit',submit);root.removeEventListener('compositionstart',compositionStart);root.removeEventListener('compositionend',compositionEnd);root.removeEventListener('keydown',keydown);dialog.removeEventListener('cancel',cancel);if(dialog.open)dialog.close();root.replaceChildren();root.classList.remove('compare-root','compare-compact');root.style.removeProperty('background-image');delete root.dataset.screen;delete root.dataset.environment;delete root.dataset.fontFallback;}};
}
