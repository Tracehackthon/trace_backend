// Runtime derivative of artifacts/trace-one-thing-v1-20260915/ui; original assets/layout retained.
import {escapeHTML as h, icon, mark, patchDOM, selectedRange} from './chain-helpers.mjs';

const TITLES = {resume:'接着这里',discussion:'接着这里',understanding:'',reentry:'这次带着新材料回来',revised:'接着这里'};
const ARTICLE = [
  '我们每个人都会收藏一些内容。也许是一篇文章、一个网页，或者一段话。当时觉得很重要，担心以后找不到，就先保存下来。',
  '但一段时间后再回头看，收藏夹里已经堆满了各种内容。真正能想起来为什么收藏的，却寥寥无几。',
  '这并不是因为我们不够自律，而是人的记忆在当下和未来之间，本就存在落差。保存一段内容，不一定保存了当时为什么在意。重新读到时，我们可能认得这些文字，却想不起自己的问题。',
  '也许我们需要的，不只是一个收藏的动作，而是在收藏的同时，留下一点当时的想法，哪怕只是一句话。',
];
const RELATIONS = {challenge:'挑战',supplement:'补充',limitation:'限制',branch:'旁支'};
const btn = (action, label, name, kind='', extra='') => `<button type="button" class="chain-button ${kind.split(' ').filter(Boolean).map(k => `chain-${k}`).join(' ')}" data-action="${action}" ${extra}>${name ? icon(name) : ''}<span>${h(label)}</span></button>`;
const field = (key, value, placeholder='', cls='', attrs='') => `<textarea class="chain-field ${cls}" data-key="field-${key}" data-field="${key}" aria-label="${h(placeholder || key)}" placeholder="${h(placeholder)}" ${attrs}>${h(value)}</textarea>`;
const smallInput = (key,value,label,attrs='') => `<label class="chain-label">${h(label)}<input data-key="field-${key}" data-field="${key}" class="chain-field" aria-label="${h(label)}" value="${h(value)}" ${attrs}></label>`;
const chip = (label, name='file') => `<span class="chain-chip">${icon(name)}${h(label)}</span>`;
const row = (title,text,name='file',extra='') => `<section class="chain-context-row"><span class="chain-round">${icon(name)}</span><div><h2>${h(title)}</h2><p>${h(text)}</p>${extra}</div></section>`;

/** Presentational module; the reducer owns all domain state. */
export function mountChainScreen({root, view, onAction, onHome, onMatters, onBack, onWorkspaces, assets={}, services={}, demo=false}) {
  if (!root || typeof onAction !== 'function') throw new TypeError('mountChainScreen requires root and onAction');
  let current = view, disposed=false, composition=null, modal=null, readingOpen=true, suggestionDraft='', findingDraft='', materialDraft='';
  let lastScreen=null, lastId=null, glass=null, animation=null, returnFocus=null, selectionFocus=null;
  const pendingForms = new Map(); // Unsubmitted modal/work form text, isolated by matter.
  const abort = new AbortController();
  const listen = (target,event,handler,options={}) => target.addEventListener(event,handler,{...options,signal:abort.signal});
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  root.classList.add('chain-root');
  const stage = document.createElement('div'); stage.className='chain-stage'; root.replaceChildren(stage);
  const background = value => value ? `url("${String(value).replace(/["\\\n\r]/g, '\\$&')}")` : 'none';
  root.style.setProperty('--chain-background',background(assets.background));
  const fonts=[];
  for (const [family,url] of [['Trace Chain Serif',assets.serifFont],['Trace Chain Sans',assets.sansFont]]) {
    if (url && typeof FontFace === 'function') {
      const font = new FontFace(family,background(url),{weight:family.endsWith('Serif')?'250 900':'100 900',display:'swap'}); fonts.push(font);
      font.load().then(f => { if (!disposed) document.fonts.add(f); }).catch(() => {});
    }
  }
  const dispatch = action => { if (!disposed) onAction(action); };
  const getSource = id => [...(current.availableSources || []),...(current.matter?.sources || [])].find(s => s.id===id);
  const firstSource = () => current.matter?.sources?.[0] || current.availableSources?.[0];
  const title = () => current.matter?.title || current.matter?.originalText || current.matter?.whyCare || '刚留下的一点';
  const originalText = () => current.matter?.originalText || current.matter?.whyCare || '';
  const hasHistory = () => Boolean(current.matter?.understanding || current.matter?.stop || current.matter?.revisions?.length || current.matter?.results?.length);
  const isDemo = () => demo || current.isDemo === true;

  function header() {
    const simple = current.screen==='paused' || current.screen==='handoff';
    return `<header class="chain-header" data-key="header"><button type="button" data-action="home" class="chain-brand" aria-label="Trace 首页"><span>${mark}</span>Trace</button>${!simple ? `<div class="chain-breadcrumb"><button data-action="matters">在意的事</button><span>/</span><span>${h(title())}</span></div>` : ''}<nav>${simple ? btn('matters','全部事项','layers','bare') : btn('provenance','看看来路','search','bare')}${btn('collapse','收起','collapse','bare',current.selectedId ? '' : 'disabled')}</nav></header>`;
  }
  function scenery() {
    const s=current.screen; if (s==='reading' || s==='work') return '';
    const node = s==='results' || s==='revised' ? [1316,191] : s==='handoff' ? [1012,218] : [357,329];
    const d = s==='results'||s==='revised' ? 'M -50 143 C 108 150 168 277 310 285 C 765 271 1060 316 1238 211 Q 1288 182 1316 191 C 1450 260 1480 272 1710 323' : 'M -35 239 C 49 283 50 315 100 319 C 240 319 241 391 357 329 C 450 548 690 533 936 540 C 1265 545 1369 520 1520 427 C 1534 350 1593 319 1710 275';
    return `<div class="chain-scenery" aria-hidden="true" data-key="scenery"><svg viewBox="0 0 1672 941"><defs><linearGradient id="chain-line"><stop stop-color="#73a5a3"/><stop offset=".27" stop-color="#d39734"/><stop offset=".55" stop-color="#e1c67c"/><stop offset="1" stop-color="#76a6a6"/></linearGradient></defs><path d="${d}" fill="none" stroke="url(#chain-line)" stroke-width="1.2"/><circle cx="${node[0]}" cy="${node[1]}" r="9" fill="#e4a330" stroke="#fff8d8" stroke-width="3"/><circle cx="100" cy="319" r="8" fill="#aec5be" stroke="#fff" stroke-width="3"/></svg>${assets.birdPerched ? `<img class="chain-bird" src="${h(assets.birdPerched)}" alt="" style="left:${node[0]-77.2}px;top:${node[1]-58.8}px;width:108.6px">` : ''}${current.isDemo ? `<div class="chain-side-memory">${icon('layers')}<span>工作 UI 如何承接</span></div><div class="chain-side-memory chain-right-memory">多 Agent 交接<br>如何保留证据</div>` : ''}</div>`;
  }
  function composer(placeholder='写下现在想到的，或带来一份新材料……') {
    return `<form class="chain-composer chain-glass" data-key="composer" data-form="send">${current.focus ? `<div class="chain-focus" data-key="focus">正在围绕：<strong>${h(current.focus.text)}</strong>${btn('clear-focus','取消选区','close','icon-only')}</div>` : ''}${field('composer',current.composer?.text,placeholder,'chain-compose-input','rows="2"')}<div class="chain-composer-tools">${btn('material','粘贴材料摘录','link','subtle')}<button class="chain-send" type="submit" aria-label="发送这段想法" ${!current.composer?.text?.trim() ? 'disabled' : ''}>${icon('arrow')}</button></div></form>`;
  }
  function common(content,{wide=false,compose=true}={}) {
    const subtitle=current.screen==='resume'&&!hasHistory()?'刚留下的一点':current.screen==='reentry'&&!current.incoming?.text?'从这里继续':TITLES[current.screen];
    return `<main class="chain-main ${wide?'chain-main-wide':''}" data-key="main"><div class="chain-heading" data-key="heading"><h1>${h(title())}<b>。</b></h1>${subtitle ? `<p>${h(subtitle)}</p>`:''}</div><section class="chain-panel chain-glass" data-key="panel">${content}</section>${compose ? composer(current.screen==='revised'?'继续写，或带来下一次经历……':undefined) : ''}</main>`;
  }
  function resume() {
    const context=current.context||{},m=current.matter||{},fresh=current.contextMode==='fresh';
    const original=`<section class="chain-context-row"><span class="chain-round">${icon('file')}</span><div><h2>${hasHistory()?'当时留下的原表达':'刚才留下的原话'}</h2><p data-selection="originalText" data-key="original-expression" tabindex="0" aria-label="可选择的原表达">${h(originalText())}</p>${firstSource()?btn('source','查看原现场','file','subtle'):''}</div></section>`;
    const understanding=m.understanding&&!fresh?row(`我的理解 · v${m.understandingVersion??0}`,m.understanding,'pen',btn('understanding','继续修改','pen','subtle')):'';
    const relations=(m.observations||[]).length&&!fresh?`<section class="chain-context-row"><span class="chain-round">${icon('link')}</span><div><h2>已经接到这里的材料</h2>${m.observations.map(o=>`<p>${h(RELATIONS[o.relation]||o.relation||'关联')} · ${h(o.text||getSource(o.sourceId)?.title||'已保留材料')}</p>`).join('')}${btn('provenance','查看关联与来路','file','subtle')}</div></section>`:'';
    return common(`<div class="chain-panel-scroll">${fresh?`<div class="chain-fresh">本次未带入旧理解；原记录仍可按需查看。${btn('resume-context','恢复使用旧理解','undo','bare')}</div>`:original}${context.stop?row('上次停在这里',context.stop,'stop'):!fresh&&!hasHistory()?'<p class="chain-footnote">还没有形成理解。可以继续写，也可以直接选中原话找个对照。</p>':''}${understanding}${relations}</div><div class="chain-panel-actions">${btn('comparison','找个对照','balance')}${btn('understanding','我想先自己写','pen')}${btn('discussion','继续写一句','message','subtle')}${hasHistory()?btn(fresh?'resume-context':'fresh',fresh?'恢复使用旧理解':'这次先不带入旧理解',null,'text-link'):''}</div>`);
  }
  function discussion() {
    const d=current.discussion||{};
    const text=d.text ?? [...(d.cases||[]).map(x=>x.text),...(d.messages||[]).map(x=>x.text),d.possibility].filter(Boolean).join('\n\n');
    return common(`<div class="chain-panel-scroll"><div class="chain-section-heading"><span class="chain-round">${icon('balance')}</span><h2>${d.cases?.length?'换个情形，自己判断':'围绕这件事继续写'}</h2>${d.cases?.length ? '<span class="chain-amber-label">假设情形 · 不是实际案例</span>' : ''}</div><div class="chain-discussion-text" data-key="discussion-text" data-selection="discussion" tabindex="0" aria-label="可选择的讨论正文">${(text || '当前没有讨论。写下自己的问题即可开始。').split('\n\n').map((part,i)=>`${i?'<span class="chain-text-separator">\n\n</span>':''}<span class="chain-discussion-block">${h(part)}</span>`).join('')}</div>${current.focus?.field==='discussion' ? `<div class="chain-selection-actions" data-key="selection-actions">${btn('focus-ask','围绕这句问','message','compact')}${btn('focus-understanding','接到我的理解','link','compact')}${btn('branch','先留个旁支','branch','compact')}</div>`:''}<p class="chain-footnote">选中一段文字后，可以围绕具体位置继续。${d.possibility ? '这是示例启发，不是模型实时回复。' : ''}</p></div><div class="chain-panel-actions">${btn('comparison','找个对照','balance','subtle',current.selectedId?'':'disabled')}${btn('understanding','我想先自己写','pen','subtle')}</div>`);
  }
  function understanding() {
    const m=current.matter||{}, suggestion=current.suggestion;
    const saved=m.understandingDraft===m.understanding;
    return common(`<div class="chain-editor-heading"><span class="chain-round">${icon('file')}</span><h2>我的理解</h2><span class="chain-muted">个人理解 · ${!m.understanding&&!m.understandingDraft?'尚未写下':saved?`已保存 · v${m.understandingVersion??0}`:'草稿 · 尚未确认为当前理解'}</span><span class="chain-editor-truth">尚未作为工作要求</span></div><div class="chain-editor" data-key="editor"><div class="chain-editor-toolbar"><span>纯文本编辑</span><span>选中一句，提出局部修改</span>${btn('suggest','建议修改','pen','compact',current.focus?.field==='understanding'?'':'disabled')}${current.undo?.suggestion ? btn('undo-suggestion','撤销局部修改','undo','compact'):''}</div>${field('understanding',m.understandingDraft,'暂无已保存的理解，可以直接写。','chain-understanding-input','data-selection="understanding" spellcheck="false"')}<div class="chain-editor-sources">${(m.sources||[]).slice(0,2).map(s=>btn('source',s.title,'file','subtle',`data-source="${h(s.id)}"`)).join('')}</div>${suggestion && ['pending','stale'].includes(suggestion.status) ? `<aside class="chain-suggestion" data-key="suggestion"><h3>${icon('bulb')}建议修改 · 只改这一处</h3><p><strong>原句：</strong>${h(suggestion.original)}</p><p><strong>建议：</strong>${h(suggestion.replacement)}</p>${suggestion.status==='stale'?'<p class="chain-amber-label">局部建议已过期，请重新选择。</p>':''}<div>${btn('accept-suggestion','接受这一处',null,'primary compact',suggestion.status==='stale'?'disabled':'')}${btn('self-edit','自己改',null,'compact')}${btn('dismiss-suggestion','放弃建议',null,'compact')}</div></aside>`:''}</div><label class="chain-stop-editor">未决停点${field('stop',m.stopDraft ?? m.stop,'还没分清什么？留一句给下次。','chain-stop-input','rows="1"')}</label><div class="chain-panel-actions">${btn('save-understanding','保存我的理解','check','primary')}${btn('handoff','带去用','link')}${btn('comparison','找个对照','balance','subtle',current.selectedId?'':'disabled')}<span class="chain-footnote">保存理解不自动成为工作要求。</span></div>`,{wide:true,compose:false});
  }
  function comparison() {
    const c=current.comparison, source=getSource(c?.sourceId)||firstSource();
    return `<main class="chain-comparison-layout" data-key="main"><aside class="chain-context-side chain-glass"><p>正在分清</p><h1>${h(current.focus?.text || current.matter?.stop || title())}</h1><span class="chain-short-rule"></span><p>接到：${h(c?.target || current.matter?.stop || '当前问题')}</p></aside><section class="chain-comparison-main chain-glass"><div>${btn('back','回到刚才','back','bare')}<h1>找个对照</h1></div><div class="chain-panel-scroll"><h2 class="chain-material-heading">${icon('file')}${h(source?.title || '示例材料 · 原文片段')}</h2><blockquote>${h(source?.excerpt || '暂无来源。可以粘贴一段材料。')}</blockquote><div class="chain-comparison-explanation"><h2>${icon('bulb')}可能挑战这一处</h2><div class="chain-inference">${h(c?.reason || '先核对这段材料与当前问题的具体关系。')}${chip('这是推断','question')}</div><p>还不能说明：${h((c?.uncertain || '材料中的说法已经被采纳。').replace(/^还不能说明[：:]?\s*/,''))}</p></div><div class="chain-relation-edit"><label class="chain-label">准备接为<select class="chain-field" data-key="field-relation" data-field="relation">${Object.entries(RELATIONS).map(([key,label])=>`<option value="${key}" ${c?.relation===key?'selected':''}>${label}</option>`).join('')}</select></label>${smallInput('target',c?.target,'对照位置')}</div></div><footer class="chain-comparison-actions">${btn('link-comparison','接到这里','link','primary')}${btn('reject-comparison','这次无关','close')}${btn('source','查看原文','file','bare',source?`data-source="${h(source.id)}"`:'disabled')}<small>关系确认不等于采纳材料结论。</small></footer></section></main>`;
  }
  function paused() {
    const m=current.matter||{};
    return `<main class="chain-paused" data-key="main"><div class="chain-paused-heading"><h1>把此刻的一点，带到以后<b>。</b></h1><p>留下一段触动、一个问题或工作中的发现；继续想，带去用，再让结果回来。</p></div><div class="chain-paused-entry chain-glass">${btn('reentry','带着新材料回来','link','bare')}${btn('reopen','从停点继续','arrow','primary')}</div><svg class="chain-paused-lines" viewBox="0 0 1672 320" aria-hidden="true"><path d="M-10 0C170 10 180 131 355 142C504 62 571 183 757 112C826 97 862 267 957 239C1118 195 1190 173 1350 218C1475 208 1570 239 1710 199" fill="none" stroke="#448a7a"/><path d="M0 45C190 70 190 106 355 142C531 97 579 190 757 112C893 145 862 216 957 239C1168 260 1250 170 1350 218" fill="none" stroke="#d6ad5b"/></svg><button type="button" class="chain-matter-bubble" data-action="reopen" data-key="matter-bubble"><span class="chain-bubble-glass" data-key="bubble-glass" data-preserve="true"></span><span class="chain-round">${icon('file')}</span><span><h2>${h(title())}</h2><p>刚刚停在：${h(m.stopDraft || m.stop || '尚未留下停点。')}</p><small>${m.understanding ? '个人理解已保存' : '尚未整理成理解'}</small></span></button><div class="chain-paused-bird" aria-hidden="true">${assets.birdPerched?`<img src="${h(assets.birdPerched)}" alt="">`:''}</div><div class="chain-paused-other">${(current.matters||[]).filter(x=>x.id!==current.selectedId).slice(0,2).map(x=>btn('open-matter',x.title,'file','ghost-bubble',`data-id="${h(x.id)}"`)).join('')}</div><div class="chain-collapse-toast">${icon('check')}已收起，草稿与停点仍保留。${btn('undo-collapse','撤销收起',null,'text-link',current.undo?.collapse?'':'disabled')}</div></main>`;
  }
  function reentry() {
    const incoming=current.incoming||{};
    if(!incoming.text?.trim()&&!hasHistory())return resume();
    return common(`<div class="chain-panel-scroll"><div class="chain-last-stop">${icon('clock')}${current.matter?.stop?'上次停在：':'从原表达继续：'}${h(current.matter?.stop || originalText())}${btn('resume','查看停点','next','icon-only')}</div><div class="chain-observation"><div class="chain-section-heading"><span class="chain-round">${icon('file')}</span><h2>这次带来 · 我的观察</h2></div>${field('incoming',incoming.text,'写下这次带来的新观察……','chain-incoming-input','rows="3"')}${chip('用户补充','file')}</div><div class="chain-incoming-relation">${icon('link')}可以接回当前问题，关系由你核对。<span class="chain-amber-label">${incoming.decision==='pending'?'待核对':{linked:'已接回',unrelated:'本次不关联',saved:'仅保留材料'}[incoming.decision]}</span></div></div><div class="chain-panel-actions">${btn('incoming-link','沿着这里比较','branch','primary',incoming.text?.trim()?'':'disabled')}${btn('incoming-unrelated','这次不是这件事','no', '',incoming.text?.trim()?'':'disabled')}${btn('incoming-save','先只留下','bookmark','',incoming.text?.trim()?'':'disabled')}</div>`);
  }
  function handoff() {
    const m=current.matter||{}, ho=current.handoff||{}, dest=ho.destination||{};
    return `<main class="chain-handoff-layout" data-key="main"><section class="chain-handoff-context"><div class="chain-heading"><h1>我的理解<b>。</b></h1><p>个人草稿 · ${m.understandingDraft===m.understanding&&m.understanding?'已保存':'草稿 · 尚未确认为当前理解'}</p></div><div class="chain-glass chain-handoff-summary">${row('',m.understanding || '暂无已保存的理解，可以直接写。')}${row('还没分清',m.stop || '尚未留下停点。','stop')}${current.incoming?.text ? `<div class="chain-inference">${icon('bulb')}这次带来：${h(current.incoming.text)}</div>`:''}</div>${composer('先写下这次准备怎样尝试……')}</section><section class="chain-handoff-side chain-glass"><div class="chain-side-heading"><h1>带去这次工作</h1>${btn('back','关闭','close','icon-only')}</div><div class="chain-panel-scroll"><fieldset class="chain-destination"><legend>目的地</legend>${smallInput('agent',dest.agent,'Agent')}${smallInput('project',dest.project,'项目')}${smallInput('task',dest.task,'任务')}</fieldset><label class="chain-label">选中的内容${field('handoff-text',ho.selectedText,'选择这次实际要带入的文字','chain-handoff-text','rows="3"')}<small>来源：${h(title())}</small></label><fieldset class="chain-role"><legend>我希望这次</legend>${[['trial','这次准备试','pen'],['reference','作为参考','file'],['exclude','这次不用','no']].map(([key,label,name])=>btn('role',label,name,ho.role===key?'selected':'',`data-role="${key}" aria-pressed="${ho.role===key}"`)).join('')}</fieldset><label class="chain-label">补充说明（可选）${field('handoff-note',ho.note,'想观察什么，或不希望怎样使用？','chain-handoff-note','rows="2"')}</label><label class="chain-label">范围<select class="chain-field" data-field="scope" aria-label="范围"><option value="current-task">仅本次任务</option></select><small>试一次，不变成长期需求。</small></label></div><footer class="chain-handoff-actions">${btn('confirm-handoff','带到本次工作',null,'primary',ho.selectedText?.trim() && ho.role!=='exclude'?'':'disabled')}${btn('exclude-handoff','先不带入',null)}</footer></section></main>`;
  }
  function work() {
    const ho=current.handoffSnapshot || current.handoff || {},dest=ho.destination||{};
    return `<main class="chain-work-layout" data-key="main"><section class="chain-native-example"><header><span class="chain-native-mark">C›_</span><strong>${h(dest.agent||'未选择 Agent')} · ${h(dest.project||'未选择项目')}</strong><span class="chain-example-badge">${isDemo()?'示例工作宿主':'本次工作准备'} · 尚未连接外部 Agent</span></header><div class="chain-native-body"><h1>${h(dest.task||'未选择任务')}</h1><p>工作主场在原生 Agent</p><div class="chain-native-explanation">${icon('layers')}<div><h2>这里保留本次准备与现场发现。</h2><p>不创建第二个工作聊天，也没有发送真实任务或制造执行回执。</p></div></div><div class="chain-native-artifact"><span class="chain-round">${icon('file')}</span><div><h2>本次准备带入</h2><p>${h(ho.selectedText || '尚未带入本次工作')}</p><small>理解版本：${h(ho.understandingVersion ?? 0)} · ${ho.role==='reference'?'作为参考':'这次准备试'}</small></div></div><p class="chain-footnote">产物已实现，不等于真实使用已有结果。</p></div></section><aside class="chain-work-side chain-glass"><div class="chain-side-heading"><span class="chain-small-brand"><span>${mark}</span>Trace</span>${btn('resume','回到这件事','back','icon-only')}</div><p class="chain-muted">${h(dest.agent||'未选择 Agent')} · ${h(dest.project||'未选择项目')} / ${h(dest.task||'未选择任务')}</p><div class="chain-panel-scroll"><h2 class="chain-section-heading"><span class="chain-round">${icon('file')}</span>本次带入</h2><section class="chain-work-card"><h2>${h(ho.selectedText || '尚未带入本次工作')}</h2><p>${ho.role==='reference'?'作为参考':'这次准备试'}</p><div class="chain-status-line"><span>${icon('check')}${current.handoff?.confirmed?'已确认 · 仅本次任务':'尚未带入本次工作'}</span><span class="chain-amber-label">${(current.matter?.results||[]).length ? '已有用户带回的结果' : '真实使用结果尚未回来'}</span></div><div class="chain-two-actions">${btn('provenance','查看依据','file')}${btn('exclude-handoff','这次不用','no')}</div></section><h2 class="chain-section-heading"><span class="chain-round">${icon('bulb')}</span>工作中新增</h2><section class="chain-work-card">${(current.workFindings||[]).map(f=>`<p>${h(f.text||f)}</p>`).join('')}${field('finding',findingDraft,'写下本次工作里的新发现……','chain-finding-input','rows="3"')}<div class="chain-two-actions">${btn('save-finding','先留一下','bookmark','',findingDraft.trim()?'':'disabled')}${btn('expand-finding','展开想想','pen','',findingDraft.trim()?'':'disabled')}</div></section></div><footer>${btn('results','带回结果','arrow','primary')}${btn('resume',title(),'file','bare')}</footer></aside></main>`;
  }
  function results() {
    const r=current.result||{}, ho=current.handoffSnapshot||current.handoff||{};
    return `<main class="chain-results-layout" data-key="main"><div class="chain-heading"><h1>结果回来<b>。</b></h1><p>把这次实际发生的、你的解释和仍不确定的地方分开。</p></div><section class="chain-results-panel chain-glass"><div class="chain-panel-scroll"><div class="chain-before-after"><section><h2><span class="chain-round">${icon('file')}</span>上次准备试</h2><div class="chain-result-quote">${h(ho.selectedText || '没有确认过本次带入。')}</div></section><section><h2><span class="chain-round">${icon('file')}</span>这次实际发生</h2>${field('result-fact',r.fact,'写下这次实际发生的事实','chain-result-quote','rows="2"')}<small>来源：你带回的使用经历，不会自动生成反馈。</small></section></div><div class="chain-fact-grid"><div><span class="chain-round">${icon('stop')}</span><div><h3>事实</h3><p>${h(r.fact || '尚未带回事实。')}</p></div></div><label><span class="chain-round chain-amber">${icon('bulb')}</span><div><h3>解释</h3>${field('result-interpretation',r.interpretation,'你认为可能与什么有关？','','rows="2"')}</div></label><label><span class="chain-round">${icon('question')}</span><div><h3>未确认</h3>${field('result-unconfirmed',r.unconfirmed,'还有哪些情况不能确定？','','rows="2"')}</div></label></div><section class="chain-revision-area"><div class="chain-section-heading"><span class="chain-round">${icon('pen')}</span><h2>准备怎样改我的理解</h2><small>个人草稿 · 不自动变成工作要求</small></div><div class="chain-revision-pair"><div><label>原来的理解</label><p>${h(current.matter?.understanding || '暂无已保存的理解。')}</p></div><span aria-hidden="true">→</span><label>这次修订为${field('result-understanding',r.proposedUnderstanding,'写下这次准备修订的理解','chain-revision-input','rows="3"')}</label></div></section></div><footer class="chain-results-actions">${btn('commit-revision','保留这次修订','check','primary',r.fact?.trim()&&r.proposedUnderstanding?.trim()?'':'disabled')}${btn('keep-result','只留下结果','file','',r.fact?.trim()?'':'disabled')}${btn('try-again','再试一次','undo')}<small>修改后可撤销</small></footer></section><div class="chain-still-matter chain-glass">${btn('resume',`仍在这件事里：${title()}`,'file','bare')}</div></main>`;
  }
  function revised() {
    const m=current.matter||{};
    return common(`<div class="chain-panel-scroll"><div class="chain-editor-heading"><span class="chain-round">${icon('file')}</span><h2>我的理解</h2><span class="chain-muted">个人理解 · 已保存</span></div><p class="chain-revised-text">${h(m.understanding || '暂无已保存的理解。')}</p>${row('还没分清',m.stop || '尚未留下停点。','question')}<div class="chain-two-actions">${btn('revision-history','看看这次改了哪里','file')}${btn('result-history','查看使用经历','undo')}</div><div class="chain-inference">${icon('bulb')}已补上这次经历的条件，未写成通用结论。</div></div><div class="chain-panel-actions">${btn('understanding','继续写','pen','subtle')}${btn('handoff','带去用','link','subtle')}${current.undo?.revision ? btn('undo-revision','撤销修订','undo','text-link'):''}</div>`,{wide:true});
  }
  function reading() {
    return `<main class="chain-reading" data-key="main"><header class="chain-reading-header"><div class="chain-window-dots"><i></i><i></i><i></i></div><span>${icon('back')}</span><span class="chain-address">${icon('file')}${isDemo()?'示例阅读页':'留下一点'}</span>${btn('home','返回 Trace',null,'bare')}</header><article class="chain-article"><small>${isDemo()?'示例文章':'此刻的原话与材料'}</small><h1>${isDemo()?'为什么收藏之后，很少再回来？':'先留下，不必现在想完整。'}</h1><p class="chain-article-meta">${isDemo()?'这是用于演示的文章，不是当前浏览器内容。':'写一句自己的想法，也可以带入你明确选择的材料。'}</p><div data-selection="article" data-key="article-text" class="chain-article-text">${(isDemo()?ARTICLE:[]).map(p=>`<p>${h(p)}</p>`).join('')}</div><small>${isDemo()?'选中文章中的一段，再留下一点自己的想法。':'先写下你的原话，不需要标题或分类。'}</small></article><button class="chain-floating-entry" data-action="toggle-reading" aria-label="打开 Trace 留下一点">${mark}</button>${readingOpen?`<section class="chain-capture chain-glass" data-key="capture"><div class="chain-side-heading"><span class="chain-small-brand"><span>${mark}</span>Trace</span>${btn('toggle-reading','关闭','close','icon-only')}</div><div class="chain-capture-source">${current.capture?.excerpt ? `<blockquote>${h(current.capture.excerpt)}</blockquote>` : ''}${(current.availableSources||[]).slice(0,1).map(s=>btn('toggle-source',current.capture?.sourceIds?.includes(s.id)?'原文片段 · 已带入':'带入原文来源','file','subtle',`data-source="${h(s.id)}" aria-pressed="${current.capture?.sourceIds?.includes(s.id)||false}"`)).join('')}</div>${field('capture',current.capture?.text,'选中片段与此刻想法','chain-capture-input','rows="4"')}<p class="chain-footnote">不用起标题，也可以先不整理。</p><footer>${btn('capture-discuss','展开聊聊',null,'',canCapture()?'':'disabled')}${btn('capture-leave','留一下','bookmark','primary',canCapture()?'':'disabled')}</footer></section>`:''}</main>`;
  }
  function canCapture() { return !!(current.capture?.text?.trim() || current.capture?.excerpt?.trim() || current.capture?.sourceIds?.length); }
  function modalHTML() {
    if (!modal) return '';
    const m=current.matter||{}; let heading='', body='';
    if (modal.type==='source') { const s=getSource(modal.id)||firstSource(); heading='原文片段'; body=`<h3>${h(s?.title || '暂无来源')}</h3><blockquote>${h(s?.excerpt || m.originalText || '')}</blockquote>${s?.url ? `<p class="chain-footnote">来源地址：${h(s.url)}</p>`:''}`; }
    if (modal.type==='provenance') { heading='原文与来路'; body=`<h3>原话</h3><blockquote>${h(m.originalText||m.whyCare||'尚未留下原话。')}</blockquote><h3>来源材料</h3>${(m.sources||[]).map(s=>`<details><summary>${h(s.title)}</summary><p>${h(s.excerpt)}</p></details>`).join('')||'<p>暂无来源。可以粘贴一段材料。</p>'}<h3>对照关系</h3>${(m.observations||[]).map(o=>`<p>${h(RELATIONS[o.relation]||o.relation)} · ${h(o.text)}</p>`).join('')||'<p>暂无已确认对照。</p>'}<h3>留下的旁支</h3>${(m.branches||[]).map(b=>`<blockquote>${h(b.text)}<small>来处：${h(b.origin?.text || b.origin?.field || '')}</small></blockquote>`).join('')||'<p>暂无旁支。</p>'}`; }
    if (modal.type==='revision-history') { heading='理解修订'; body=(m.revisions||[]).map(r=>`<section class="chain-history-item"><h3>原来的理解</h3><p>${h(r.before?.text ?? r.before?.understanding ?? r.before)}</p><h3>这次修订为</h3><p>${h(r.after?.text ?? r.after?.understanding ?? r.after)}</p></section>`).join('')||'<p>暂无修订。</p>'; }
    if (modal.type==='result-history') { heading='查看使用经历'; body=(m.results||[]).map(r=>`<section class="chain-history-item"><h3>事实</h3><p>${h(r.fact)}</p><h3>解释</h3><p>${h(r.interpretation)}</p><h3>未确认</h3><p>${h(r.unconfirmed)}</p></section>`).join('')||'<p>还没有带回实际结果。</p>'; }
    if (modal.type==='suggest') { heading='建议修改 · 只改这一处';body=`<label>原句<blockquote>${h(current.focus?.text || '')}</blockquote></label><label>建议替换文字${field('suggestion-draft',suggestionDraft,'替换为……','','rows="4"')}</label><p class="chain-footnote">由你输入替换文字，确认后才改写选中的范围。</p>${btn('create-suggestion','预览这一处修改','pen','primary',suggestionDraft.trim()?'':'disabled')}`; }
    if (modal.type==='material') { heading='粘贴材料摘录';body=`<p>只带入你粘贴的文字，不会读取文件或外部网页。</p>${field('material-draft',materialDraft,'把原文粘贴在这里……','','rows="6"')}${btn('add-material','将摘录带入新材料','link','primary',materialDraft.trim()?'':'disabled')}`; }
    if (modal.type==='matters') { heading='在意的事';body=(current.matters||[]).map(m=>btn('open-matter',m.title,'file','',`data-id="${h(m.id)}"`)).join('')||'<p>还没有留下的事项。</p>'; }
    return `<div class="chain-modal-backdrop" data-key="modal"><section class="chain-modal chain-glass" role="dialog" aria-modal="true" aria-label="${h(heading)}"><div class="chain-side-heading"><h2>${heading}</h2>${btn('close-modal','关闭','close','icon-only')}</div><div class="chain-modal-content">${body}</div></section></div>`;
  }
  function render() {
    if (disposed) return;
    const changing = lastScreen !== current.screen || lastId !== current.selectedId;
    if (changing) { glass?.destroy();glass=null;modal=null;suggestionDraft=''; }
    const renderer={reading,resume,discussion,comparison,understanding,paused,reentry,handoff,work,results,revised}[current.screen]||reading;
    const fresh=document.createElement('template');
    fresh.innerHTML=`${!['reading','work'].includes(current.screen)?header():''}${scenery()}${renderer()}<footer class="chain-prototype-label" data-key="truth">${isDemo()?'示例内容 · 与你的事项分开':''}</footer>${current.notice && current.screen!=='paused' ? `<div class="chain-notice" data-key="notice" role="status"><span>${h(current.notice)}</span>${btn('clear-notice','关闭','close','icon-only')}</div>`:''}${modalHTML()}`;
    stage.dataset.screen=current.screen;
    patchDOM(stage,fresh.content,element=>element===composition);
    root.style.setProperty('--chain-background',background(current.screen==='paused' ? (assets.overviewBackground||assets.background):assets.background));
    if (changing) {
      lastScreen=current.screen;lastId=current.selectedId;
      if (services.animate && !reduced.matches) {animation?.cancel?.();animation=services.animate(stage.querySelector('main'),{opacity:[.25,1],translateY:[12,0],duration:260,ease:'outQuad'});}
      if (current.screen==='paused' && services.mountSceneGlass) {
        const host=stage.querySelector('.chain-bubble-glass');
        if (host) glass=services.mountSceneGlass({host,scene:root,backgroundUrl:assets.overviewBackground||assets.background,width:500,height:175,tone:'cool'});
      }
    }
    resize();
  }
  function resize() { if (disposed) return;const scale=Math.min(root.clientWidth/1672,root.clientHeight/941);stage.style.transform=`translate(-50%, -50%) scale(${scale})`; }
  function openModal(type,id) {returnFocus=document.activeElement;modal={type,id};render();queueMicrotask(()=>stage.querySelector('.chain-modal textarea, .chain-modal input, .chain-modal button')?.focus());}
  function closeModal() {modal=null;render();if(returnFocus?.isConnected)returnFocus.focus();}
  function selectText(element) {
    if (composition) return;
    const name=element?.dataset.selection;if(!name)return;
    const selection = element instanceof HTMLTextAreaElement ? {start:element.selectionStart,end:element.selectionEnd,text:element.value.slice(element.selectionStart,element.selectionEnd)} : selectedRange(element);
    if (!selection?.text?.trim()) return;
    if (name==='article') {const source=current.availableSources?.[0];dispatch({type:'CAPTURE_EXCERPT',text:selection.text,sourceId:source?.id});readingOpen=true;render();}
    else {selectionFocus={field:name,...selection};dispatch({type:'FOCUS',...selectionFocus});}
  }
  listen(stage,'click',event=>{
    const button=event.target.closest('[data-action]');if(!button || button.disabled)return;
    const action=button.dataset.action;
    const direct={collapse:'COLLAPSE',reopen:'REOPEN','undo-collapse':'UNDO_COLLAPSE',fresh:'FRESH_CONTEXT','resume-context':'RESUME_CONTEXT','clear-focus':'CLEAR_FOCUS',branch:'BRANCH','focus-understanding':'FOCUS_TO_UNDERSTANDING',back:'BACK','save-understanding':'SAVE_UNDERSTANDING','accept-suggestion':'ACCEPT_SUGGESTION','dismiss-suggestion':'DISMISS_SUGGESTION','undo-suggestion':'UNDO_SUGGESTION','link-comparison':'LINK_COMPARISON','reject-comparison':'REJECT_COMPARISON','confirm-handoff':'CONFIRM_HANDOFF','exclude-handoff':'EXCLUDE_HANDOFF','commit-revision':'COMMIT_REVISION','keep-result':'KEEP_RESULT_ONLY','try-again':'TRY_AGAIN','undo-revision':'UNDO_REVISION','clear-notice':'CLEAR_NOTICE'};
    if(action==='back'&&onBack){onBack(current);return;}
    if(['clear-focus','fresh','resume-context'].includes(action))selectionFocus=null;
    if (direct[action]) {dispatch({type:direct[action]});return;}
    if(['resume','discussion','understanding','reentry','handoff','results'].includes(action)){dispatch({type:'NAVIGATE',screen:action});return;}
    if(action==='home'){onHome?.();return;}
    if(action==='workspaces'){onWorkspaces?.(current);return;}
    if(action==='matters'){if(onMatters)onMatters();else openModal('matters');return;}
    if(action==='source'){openModal('source',button.dataset.source || current.comparison?.sourceId);return;}
    if(['provenance','revision-history','result-history','material'].includes(action)){openModal(action);return;}
    if(action==='close-modal'){closeModal();return;}
    if(action==='toggle-reading'){readingOpen=!readingOpen;render();return;}
    if(action==='toggle-source'){dispatch({type:'TOGGLE_SOURCE',id:button.dataset.source});return;}
    if(action.startsWith('capture-')){dispatch({type:'CAPTURE',intent:action==='capture-discuss'?'discuss':'leave'});return;}
    if(action==='comparison'){dispatch({type:'OPEN_COMPARISON',sourceId:isDemo()?(current.availableSources||[]).find(s=>s.kind==='example-comparison')?.id:undefined,focus:selectionFocus||current.focus||null});return;}
    if(action.startsWith('incoming-')){dispatch({type:'INCOMING_DECISION',decision:{'incoming-link':'linked','incoming-unrelated':'unrelated','incoming-save':'saved'}[action]});return;}
    if(action==='role'){dispatch({type:'HANDOFF_DRAFT',patch:{role:button.dataset.role}});return;}
    if(action==='focus-ask'){stage.querySelector('[data-field="composer"]')?.focus();return;}
    if(action==='suggest'){if(current.focus?.field==='understanding'){suggestionDraft=current.focus.text;openModal('suggest');}return;}
    if(action==='create-suggestion'){const focus=current.focus;const replacement=suggestionDraft;closeModal();if(focus?.field==='understanding')dispatch({type:'SUGGEST',start:focus.start,end:focus.end,replacement});return;}
    if(action==='self-edit'){const range=current.suggestion;dispatch({type:'DISMISS_SUGGESTION'});const editor=stage.querySelector('[data-field="understanding"]');editor?.focus();if(range&&editor)editor.setSelectionRange(range.start,range.end);return;}
    if(action==='save-finding'||action==='expand-finding'){const text=findingDraft;findingDraft='';dispatch({type:'WORK_FINDING',text});if(action==='expand-finding'){dispatch({type:'COMPOSER_DRAFT',text});dispatch({type:'NAVIGATE',screen:'discussion'});}return;}
    if(action==='add-material'){const text=materialDraft;materialDraft='';closeModal();dispatch({type:'INCOMING_DRAFT',text});dispatch({type:'NAVIGATE',screen:'reentry'});return;}
    if(action==='open-matter'){closeModal();dispatch({type:'OPEN',id:button.dataset.id,screen:'resume'});}
  });
  function inputEvent(event) {
    if(composition || event.isComposing)return;
    const target=event.target,key=target.dataset.field;if(!key)return;
    const text=target.value;
    const direct={capture:'CAPTURE_DRAFT',composer:'COMPOSER_DRAFT',understanding:'UNDERSTANDING_DRAFT',stop:'STOP_DRAFT',incoming:'INCOMING_DRAFT'};
    if(direct[key]){dispatch({type:direct[key],text});return;}
    if(key==='relation'||key==='target'){dispatch({type:'RELATION_DRAFT',relation:key==='relation'?text:current.comparison?.relation,target:key==='target'?text:current.comparison?.target});return;}
    if(['agent','project','task'].includes(key)){dispatch({type:'HANDOFF_DRAFT',patch:{destination:{...current.handoff?.destination,[key]:text}}});return;}
    if(key==='handoff-text'||key==='handoff-note'||key==='scope'){dispatch({type:'HANDOFF_DRAFT',patch:{[{'handoff-text':'selectedText','handoff-note':'note',scope:'scope'}[key]]:text}});return;}
    if(key.startsWith('result-')){dispatch({type:'RESULT_DRAFT',patch:{[{ 'result-fact':'fact','result-interpretation':'interpretation','result-unconfirmed':'unconfirmed','result-understanding':'proposedUnderstanding'}[key]]:text}});return;}
    if(key==='suggestion-draft')suggestionDraft=text;
    if(key==='finding')findingDraft=text;
    if(key==='material-draft')materialDraft=text;
    render();
  }
  listen(stage,'input',inputEvent);
  listen(stage,'change',event=>{if(event.target instanceof HTMLSelectElement)inputEvent(event);});
  listen(stage,'compositionstart',event=>{composition=event.target;});
  listen(stage,'compositionend',event=>{composition=null;inputEvent(event);});
  listen(stage,'mouseup',event=>{const element=event.target.closest('[data-selection]');if(element)selectText(element);});
  listen(stage,'keyup',event=>{if(event.key==='Shift'||event.key.startsWith('Arrow')){const element=event.target.closest('[data-selection]');if(element)selectText(element);}});
  listen(stage,'select',event=>{if(event.target.dataset.selection==='understanding')selectText(event.target);});
  listen(stage,'submit',event=>{event.preventDefault();if(event.target.dataset.form==='send'&&current.composer?.text?.trim())dispatch({type:'SEND'});});
  listen(stage,'keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();if(modal)closeModal();else if(current.focus||selectionFocus){selectionFocus=null;dispatch({type:'CLEAR_FOCUS'});}else if(['comparison','handoff'].includes(current.screen)){if(onBack)onBack(current);else dispatch({type:'BACK'});}return;}
    if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!composition&&event.target.dataset.field==='composer'){event.preventDefault();if(current.composer?.text?.trim())dispatch({type:'SEND'});}
    if(event.key==='Tab'&&modal){const focusable=[...stage.querySelectorAll('.chain-modal button:not([disabled]), .chain-modal input, .chain-modal textarea, .chain-modal select, .chain-modal summary')];const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  });
  const observer=new ResizeObserver(resize);observer.observe(root);
  render();
  return {
    update(nextView){
      if(disposed)return;
      if(nextView.contextMode!==current.contextMode || nextView.contextEpoch!==current.contextEpoch)selectionFocus=null;
      if(nextView.selectedId!==current.selectedId){
        selectionFocus=null;
        pendingForms.set(current.selectedId,{finding: findingDraft,material: materialDraft});
        const pending=pendingForms.get(nextView.selectedId);
        findingDraft=pending?.finding||'';materialDraft=pending?.material||'';
      }
      current=nextView;render();
    },
    destroy(){if(disposed)return;disposed=true;abort.abort();observer.disconnect();glass?.destroy();animation?.cancel?.();for(const font of fonts)document.fonts.delete(font);root.replaceChildren();root.classList.remove('chain-root');root.style.removeProperty('--chain-background');},
  };
}

