import {h} from './library.mjs';
import {ensureRuntimeIdentity} from './runtime-identity.mjs';

const terminal = ['succeeded', 'failed', 'cancelled', 'stale', 'timed_out', 'interrupted'];
const purposeLabels = {discuss:'一起分清', explain:'解释这一处', compare:'比较不同条件', revise:'建议修改选中部分'};
const safeUrl = value => { try { const u = new URL(value); return ['http:','https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; } };

/** Same-origin Agent controller. It renders only validated terminal results;
 * streamed JSON fragments are progress evidence and never become Product text. */
export function mountAgentPanel(root, {workspace, matterId, selection = null, sourceIds = [], onWorkspace} = {}) {
  let capabilities, run, events, busy = false, closed = false, workspaceRevision = workspace?.revision;
  const session = workspace?.host?.chain?.sessions?.[matterId];
  if (!session) throw new TypeError('mountAgentPanel requires a current Product Workspace matter');
  root.classList.add('web-agent-dialog');
  root.insertAdjacentHTML('beforeend', `<p>让 Trace 调用已配置的 Agent 来讨论、解释或比较。结果先作为候选返回，不会自动写进「我的理解」。</p>
    <p data-agent-capability role="status" aria-live="polite">正在检查 Agent Runtime…</p>
    <form data-agent-form>
      <label>怎么帮助<select name="purpose">${Object.entries(purposeLabels).map(([value,label])=>`<option value="${value}" ${value==='revise'&&!selection?'disabled':''}>${label}</option>`).join('')}</select></label>
      <label>使用哪个 Agent<select name="profile" disabled><option>正在读取…</option></select></label>
      <fieldset data-retrieval hidden><legend>本次允许联网（默认不选）</legend><label><input type="checkbox" name="zhihu"> 知乎搜索</label><label><input type="checkbox" name="global"> 全网搜索</label></fieldset>
      ${selection ? `<p class="web-agent-selection"><small>已选中理解草稿中的一处</small><q>${h(selection.text)}</q></p>` : ''}
      <label>这次想问什么<textarea name="input" rows="4" maxlength="16000" required placeholder="例如：这里还混在一起的两个条件是什么？"></textarea></label>
      <footer><button type="button" data-cancel-run hidden>停止这次运行</button><button class="web-primary" type="submit" disabled>开始</button></footer>
    </form>
    <p data-agent-status role="status" aria-live="polite"></p><section data-agent-result></section>`);
  const find = selector => root.querySelector(selector), status = find('[data-agent-status]'), result = find('[data-agent-result]');
  const form = find('[data-agent-form]'), submit = form.querySelector('[type=submit]'), cancel = find('[data-cancel-run]');
  function setBusy(value) { busy=value; submit.disabled=value || !capabilities?.enabled; cancel.hidden=!value; for (const field of form.querySelectorAll('select,input,textarea')) field.disabled=value || field.dataset.unavailable==='true' || field.name==='profile'&&!capabilities?.enabled; }
  async function request(path, body) {
    await ensureRuntimeIdentity(path.split('?')[0]);
    const response = await fetch(path, {method:body===undefined?'GET':'POST', cache:'no-store', headers:{'x-trace-runtime-protocol':'1', ...(body===undefined?{}:{'content-type':'application/json', origin: location.origin, 'sec-fetch-site':'same-origin'})}, ...(body===undefined?{}:{body:JSON.stringify(body)})});
    let value; try { value=await response.json(); } catch { throw Error(`Agent Runtime 返回了无法读取的响应（${response.status}）。`); }
    if (!response.ok) throw Error(value.error?.message || `Agent Runtime 请求失败（${response.status}）。`);
    return value;
  }
  function line(tag, text, className) { const node=document.createElement(tag); if(className)node.className=className; node.textContent=text; return node; }
  function renderResult(current) {
    result.replaceChildren(); run=current;
    if (current.status!=='succeeded') { result.append(line('p', current.error?.message || '本次运行没有产生可用结果。','web-agent-error')); return; }
    const card=document.createElement('article'); card.className='web-agent-answer';
    card.append(line('small', `${purposeLabels[current.purpose] || current.purpose} · ${current.profile?.label || current.profile?.profileId || 'Agent'}`));
    card.append(line('h3', current.result.kind==='revision_candidate'?'Agent 给出了一处修改候选':'Agent 的回答'));
    card.append(line('p', current.result.answer));
    if (current.result.replacement !== null) { const box=document.createElement('section'); box.className='web-agent-replacement'; box.append(line('strong','候选替换为')); box.append(line('p',current.result.replacement)); card.append(box); }
    if (current.result.citations?.length) { card.append(line('h4','引用')); const list=document.createElement('ul'); for(const citation of current.result.citations) list.append(line('li',`${citation.quote} · ${citation.contextId}`)); card.append(list); }
    if (current.result.sources?.length) { card.append(line('h4','本次联网来源')); for(const source of current.result.sources){ const item=document.createElement('div'); item.className='web-agent-source'; item.append(line('strong',source.title||source.id)); item.append(line('p',source.excerpt||'')); const url=safeUrl(source.url); if(url){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='查看原文 ↗';item.append(a);} card.append(item); } }
    if (current.result.uncertainties?.length) { card.append(line('h4','仍不确定')); const list=document.createElement('ul'); for(const text of current.result.uncertainties)list.append(line('li',text)); card.append(list); }
    const actions=document.createElement('footer');
    if(current.result.kind==='revision_candidate'&&current.result.adoption==='not_applied'){
      const accept=line('button',current.usableAsCurrent?'接受这一处':'事项已变化，不能接受');accept.type='button';accept.className='web-primary';accept.disabled=!current.usableAsCurrent||!capabilities?.candidateAdoption;accept.dataset.adopt='accept';actions.append(accept);
      const dismiss=line('button','放弃候选');dismiss.type='button';dismiss.dataset.adopt='dismiss';actions.append(dismiss);
    } else if(current.result.adoption==='applied') { const undo=line('button','撤销这次采纳');undo.type='button';undo.dataset.adopt='undo';actions.append(undo); }
    if(actions.children.length)card.append(actions); result.append(card);
  }
  async function loadRun(id) { const current=await request(`/api/agent/runs/${encodeURIComponent(id)}`); if(closed)return; setBusy(false); status.textContent=terminal.includes(current.status)?`本次运行：${current.status}`:'仍在运行…'; renderResult(current); }
  async function follow(id) {
    const eventPath=`/api/agent/runs/${encodeURIComponent(id)}/events`;
    await ensureRuntimeIdentity(eventPath);
    if (closed) return;
    events?.close(); events=new EventSource(eventPath);
    for(const state of terminal)events.addEventListener(`run.${state}`,()=>{events.close();void loadRun(id).catch(error=>{setBusy(false);status.textContent=error.message;});});
    events.addEventListener('runtime.connected',()=>{status.textContent='Agent 已连接，正在处理…';});
    events.addEventListener('tool.completed',()=>{status.textContent='Agent 已读取本次允许的材料，正在形成结果…';});
    events.onerror=()=>{if(!terminal.includes(run?.status))status.textContent='事件连接暂时中断；运行仍由后端继续，可关闭后重新查看运行记录。';};
  }
  form.onsubmit=async event=>{
    event.preventDefault(); if(busy||!capabilities?.enabled)return; const data=new FormData(form), purpose=String(data.get('purpose')), retrieval=['zhihu','global'].filter(name=>data.get(name)==='on');
    result.replaceChildren(); setBusy(true); status.textContent='正在创建一次有身份的 Agent 运行…';
    const body={protocolVersion:1,requestId:crypto.randomUUID(),expectedRevision:workspaceRevision,matterId,
      contextMode:session.contextMode,contextEpoch:session.contextEpoch,purpose,input:String(data.get('input')||'').trim(),
      profileId:String(data.get('profile')||''),...(sourceIds.length?{sourceIds:sourceIds.slice(0,8)}:{}),
      ...(purpose==='revise'&&selection?{selection}:{}),...(retrieval.length?{retrieval:{sources:retrieval}}:{})};
    try { const created=await request('/api/agent/runs',body); if(closed)return; run=created.run; status.textContent='请求已保存，等待 Agent…'; void follow(run.runId).catch(error=>{if(!closed)status.textContent=error.message;}); if(terminal.includes(run.status))await loadRun(run.runId); }
    catch(error){setBusy(false);status.textContent=error.message;}
  };
  cancel.onclick=async()=>{if(!run||!busy)return;cancel.disabled=true;try{await request(`/api/agent/runs/${encodeURIComponent(run.runId)}/cancel`,{});await loadRun(run.runId);}catch(error){status.textContent=error.message;}finally{cancel.disabled=false;}};
  result.onclick=async event=>{
    const button=event.target.closest('[data-adopt]');if(!button||!run)return;button.disabled=true;
    try { const action=button.dataset.adopt, body=action==='dismiss'?{action}:{action,commandId:crypto.randomUUID(),expectedRevision:workspaceRevision};
      const changed=await request(`/api/agent/runs/${encodeURIComponent(run.runId)}/adoption`,body); run=changed.run;
      if(changed.product){workspaceRevision=changed.product.revision;onWorkspace?.(changed.product);}
      status.textContent=action==='accept'?'候选已应用到草稿，尚未替你保存为当前理解。':action==='undo'?'这次采纳已撤销；其他后来内容没有被覆盖。':'候选已放弃，原内容没有变化。';renderResult(run);
    } catch(error){button.disabled=false;status.textContent=error.message;}
  };
  void request('/api/agent/capabilities').then(value=>{
    if(closed)return;capabilities=value;const profile=form.elements.profile;profile.replaceChildren();
    for(const item of value.profiles||[]){const option=document.createElement('option');option.value=item.profileId;option.textContent=`${item.label} · ${item.kind}`;option.selected=item.profileId===value.defaultProfileId;profile.append(option);}
    find('[data-agent-capability]').textContent=value.enabled?`Agent Runtime 已启用 · ${value.profiles.length} 个服务端 profile · 自动写入关闭`:'Agent Runtime 尚未启用。启动本机后端时设置 TRACE_AGENT_ENABLED=1。';
    const retrieval=find('[data-retrieval]');retrieval.hidden=!value.externalRetrieval;for(const name of ['zhihu','global'])form.elements[name].dataset.unavailable=String(!value.searchSources?.includes(name));
    setBusy(false);
  }).catch(error=>{find('[data-agent-capability]').textContent=error.message;setBusy(false);});
  root.traceCleanup=()=>{closed=true;events?.close();};
}
