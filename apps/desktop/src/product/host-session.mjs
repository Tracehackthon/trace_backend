import {ensureRuntimeIdentity} from './runtime-identity.mjs';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const short = (value, limit = 180) => { const text = String(value ?? ''); return Array.from(text).length > limit ? `${Array.from(text).slice(0, limit).join('')}…` : text; };

/**
 * Small Product Workspace view for the host stream.  It is a projection only:
 * browser state is never saved here; every write goes through the Product
 * Workspace command/CAS endpoints.
 */
export function mountHostSession({root, onBack = () => {}} = {}) {
  const abort = new AbortController();
  let disposed = false;
  let state = {sessions: [], turns: [], findings: [], jobs: [], proposals: [], activations: [], privacy: [], guard: [], policies: [], orchestrations: [], trials: [], worker: null};
  let error = null;
  const request = async (url, options = {}) => {
    await ensureRuntimeIdentity(url.split('?')[0]);
    const response = await fetch(url, {cache: 'no-store', signal: abort.signal, ...options, headers: {'accept': 'application/json', 'x-trace-runtime-protocol': '1', ...(options.body ? {'content-type': 'application/json', origin: location.origin, 'sec-fetch-site': 'same-origin'} : {}), ...(options.headers ?? {})}});
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value?.error?.message || `Product Workspace request failed (${response.status})`);
    return value;
  };
  const post = (url, body) => request(url, {method: 'POST', body: JSON.stringify({protocolVersion: 1, ...body})});
  const id = () => globalThis.crypto?.randomUUID?.() ?? `desktop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  async function load() {
    error = null;
    try {
      const optional = url => request(url).catch(() => ({items: []}));
      const [sessions, turns, findings, jobs, proposals, activations, privacy, guard, policies, orchestrations, trials, worker] = await Promise.all([
        request('/api/product/host/sessions'), request('/api/product/host/turns'), request('/api/product/host/findings'),
        request('/api/product/host/sensemaking/jobs'), request('/api/product/host/routing/proposals'), request('/api/product/host/activation/history'),
        optional('/api/product/host/sensemaking/privacy'), optional('/api/product/host/repository/recovery/status'), optional('/api/product/host/publication-policies'), optional('/api/product/host/capability/orchestrations'), optional('/api/product/host/capability/trials'), optional('/api/agent/sensemaking/health'),
      ]);
      if (disposed) return;
      state = {sessions: sessions.items ?? [], turns: turns.items ?? [], findings: findings.items ?? [], jobs: jobs.items ?? [], proposals: proposals.items ?? [], activations: activations.items ?? [], privacy: privacy.items ?? [], guard: guard.items ?? [], policies: policies.items ?? [], orchestrations: orchestrations.items ?? [], trials: trials.items ?? [], worker: worker?.component ? worker : null};
    } catch (cause) { if (!disposed) error = cause instanceof Error ? cause.message : String(cause); }
    paint();
  }
  const turnFor = (sessionId, turnId) => state.turns.find(turn => turn.session_id === sessionId && turn.turn_id === turnId);
  const findingFor = findingId => state.findings.find(finding => finding.finding_id === findingId);
  function paint() {
    if (disposed) return;
    const sessions = state.sessions.map(session => {
      const turns = state.turns.filter(turn => turn.host === session.host && turn.session_id === session.session_id);
      const sessionFindings = state.findings.filter(finding => finding.host === session.host && finding.session_id === session.session_id);
      const jobs = state.jobs.filter(job => job.host === session.host && job.session_id === session.session_id);
      return `<article class="trace-host-session-card"><header><div><span class="trace-host-eyebrow">${escapeHtml(session.host)} · ${escapeHtml(session.session_id)}</span><h2>${escapeHtml(session.status === 'attached' ? '正在跟随' : session.status === 'paused' ? '已暂停' : '已结束')}</h2></div><span class="trace-host-status trace-host-status-${escapeHtml(session.status)}">${escapeHtml(session.status)}</span></header><p class="trace-host-meta">项目绑定：${escapeHtml(session.project_ref || '个人空间（未绑定项目）')}<br>最近活动：${escapeHtml(session.last_event_at || session.updated_at || '—')}</p><div class="trace-host-actions"><button data-host-action="attach" data-host="${escapeHtml(session.host)}" data-session="${escapeHtml(session.session_id)}" ${session.status === 'ended' ? 'disabled' : ''}>跟随</button><button data-host-action="pause" data-host="${escapeHtml(session.host)}" data-session="${escapeHtml(session.session_id)}" ${session.status !== 'attached' ? 'disabled' : ''}>暂停</button><button data-host-action="detach" data-host="${escapeHtml(session.host)}" data-session="${escapeHtml(session.session_id)}" ${session.status === 'ended' ? 'disabled' : ''}>结束跟随</button></div><section class="trace-host-subsection"><h3>Turns <small>${turns.length}</small></h3>${turns.length ? turns.map(turn => `<details class="trace-host-turn"><summary><span>${escapeHtml(turn.turn_id)}</span><b>${escapeHtml(turn.state)}</b><time>${escapeHtml(turn.updated_at)}</time></summary><div class="trace-host-private"><em>私有原始对话 · 默认折叠</em><p><strong>用户输入</strong><br>${escapeHtml(turn.prompt)}</p>${turn.last_assistant_message === null ? '' : `<p><strong>最终回复</strong><br>${escapeHtml(turn.last_assistant_message)}</p>`}</div></details>`).join('') : '<p class="trace-host-empty">还没有已接收的 turn。</p>'}</section><section class="trace-host-subsection"><h3>Sensemaking jobs <small>${jobs.length}</small></h3>${jobs.length ? jobs.map(job => `<div class="trace-host-job"><span>${escapeHtml(job.turn_id)}</span><b>${escapeHtml(job.status)}${job.execution_mode === 'shadow' ? ' · shadow' : ''}</b><small>attempt ${escapeHtml(job.attempt)} · ${escapeHtml(job.profile_id)} / ${escapeHtml(job.profile_version)} / ${escapeHtml(job.model_version)}</small>${job.privacy_policy_id || job.redaction ? `<small>脱敏策略：${escapeHtml(job.privacy_policy_id || 'trace.host-privacy')} v${escapeHtml(job.privacy_policy_version || '')} · 私有正文已省略</small>` : ''}${job.error_code ? `<small>错误：${escapeHtml(job.error_code)} · ${escapeHtml(job.error_message)}</small>` : ''}</div>`).join('') : '<p class="trace-host-empty">Stop 后异步 job 会出现在这里。</p>'}</section><section class="trace-host-subsection"><h3>Findings <small>${sessionFindings.length}</small></h3>${sessionFindings.length ? sessionFindings.map(finding => `<div class="trace-host-finding"><div><b>${escapeHtml(finding.finding_kind || finding.origin || 'captured')}</b><span>${escapeHtml(finding.status)}</span></div><p>${escapeHtml(short(finding.observation, 260))}</p><small>来源：${escapeHtml(finding.turn_id)} · target=${escapeHtml(finding.target_kind)} · refs=${escapeHtml((finding.source_refs || []).map(ref => ref.finding_id || ref.run_id || `${ref.host || ''}/${ref.session_id || ''}/${ref.turn_id || ''}`).join(', ') || '—')}</small></div>`).join('') : '<p class="trace-host-empty">还没有发现。</p>'}</section></article>`;
    }).join('');
    const proposals = state.proposals.map(proposal => `<article class="trace-host-proposal"><header><div><b>${escapeHtml(proposal.target_kind)}</b><span>${escapeHtml(proposal.scope)}</span></div><strong>${escapeHtml(proposal.status)}</strong></header><p>${escapeHtml(proposal.rationale)}</p><details><summary>适用条件与风险</summary><small>适用：${escapeHtml((proposal.applicability || []).join('；') || '—')}<br>不适用：${escapeHtml((proposal.non_applicability || []).join('；') || '—')}<br>证据：${escapeHtml((proposal.required_evidence || []).join('；') || '—')}<br>风险：${escapeHtml((proposal.risks || []).join('；') || '—')}</small></details><small>finding ${escapeHtml(proposal.finding_id)} · revision ${escapeHtml(proposal.revision)}</small>${['proposed', 'trial'].includes(proposal.status) ? `<footer><button data-route-action="trial" data-proposal="${escapeHtml(proposal.proposal_id)}" data-revision="${escapeHtml(proposal.revision)}">试用</button><button data-route-action="adopt" data-proposal="${escapeHtml(proposal.proposal_id)}" data-revision="${escapeHtml(proposal.revision)}">采用</button><button data-route-action="reject" data-proposal="${escapeHtml(proposal.proposal_id)}" data-revision="${escapeHtml(proposal.revision)}">拒绝</button></footer>` : ''}</article>`).join('');
    const activations = state.activations.map(receipt => `<article class="trace-host-activation"><header><b>${escapeHtml(receipt.status)}</b><small>${escapeHtml(receipt.created_at)}</small></header><p>${escapeHtml(receipt.item_count)} 项 · ${escapeHtml(receipt.used_tokens)}/${escapeHtml(receipt.max_tokens)} tokens · ${escapeHtml(receipt.session_id)}</p>${Array.isArray(receipt.items) && receipt.items.length ? `<details><summary>查看本次 offer（${escapeHtml(receipt.status)}，不代表已使用）</summary>${receipt.items.map(item => `<p><b>${escapeHtml(item.status)}${item.trial ? ' · trial' : ''}</b> · ${escapeHtml(item.target_kind)}<br>${escapeHtml(short(item.observation, 220))}</p>`).join('')}</details>` : ''}${receipt.status === 'offered' ? `<footer><button data-activation-action="used" data-receipt="${escapeHtml(receipt.receipt_id)}" data-revision="${escapeHtml(receipt.revision)}">标为已使用</button><button data-activation-action="dismissed" data-receipt="${escapeHtml(receipt.receipt_id)}" data-revision="${escapeHtml(receipt.revision)}">忽略</button></footer>` : ''}</article>`).join('');
    const workerPanel = state.worker ? `<div class="trace-host-ops"><b>Worker</b><span>${escapeHtml(state.worker.status)} · ${escapeHtml(state.worker.mode || '—')}</span><small>queue ${escapeHtml(state.worker.queue_depth)} · failed ${escapeHtml(state.worker.failed_count)} · profile ${escapeHtml(state.worker.profile?.profile_id || '—')} / ${escapeHtml(state.worker.profile?.model_version || state.worker.profile?.model || '—')}</small></div>` : '<div class="trace-host-ops"><b>Worker</b><span>未配置或不可用</span><small>不会静默切换到其他模型；可在 Product Service 配置 fixture-dev 或明确的 profile。</small></div>';
    const privacyPanel = state.privacy.length ? state.privacy.slice(0, 12).map(receipt => `<div class="trace-host-ops"><b>${escapeHtml(receipt.status)}</b><span>${escapeHtml(receipt.policy_id)} v${escapeHtml(receipt.policy_version)}</span><small>job ${escapeHtml(receipt.job_id)} · redaction receipt 已保存；重合检测 ${escapeHtml(receipt.overlap?.matched ? 'blocked' : 'clear')}</small></div>`).join('') : '<p class="trace-host-empty">还没有脱敏回执。</p>';
    const guardPanel = state.guard.length ? state.guard.slice(0, 12).map(journal => `<div class="trace-host-ops"><b>${escapeHtml(journal.state)}</b><span>${escapeHtml(journal.expected_branch)}</span><small>${escapeHtml(journal.journal_id)} · 仅在状态可证明时允许 reconcile；不会自动 reset/delete/push。</small></div>`).join('') : '<p class="trace-host-empty">还没有 Repository Guard journal。</p>';
    const publicationPanel = state.policies.length || state.orchestrations.length || state.trials.length ? `${state.policies.slice(0, 8).map(policy => `<div class="trace-host-ops"><b>Policy · ${escapeHtml(policy.status)}</b><span>${escapeHtml(policy.scope)} · ${escapeHtml(policy.target_root)}</span><small>${escapeHtml(policy.policy_id)} · 默认 manual；撤回后立即阻止 publish。</small></div>`).join('')}${state.orchestrations.slice(0, 12).map(item => `<div class="trace-host-ops"><b>Candidate · ${escapeHtml(item.status)}</b><span>${escapeHtml(item.candidate?.capability_id || item.orchestration_id)}</span><small>revision ${escapeHtml(item.revision)} · producer ${escapeHtml(item.candidate?.producer_status || 'required')} · publication 仍需验证/回滚回执。</small></div>`).join('')}${state.trials.slice(0, 12).map(trial => `<div class="trace-host-ops"><b>Trial · ${escapeHtml(trial.status)}</b><span>${escapeHtml(trial.outcome || '待观察')}</span><small>${escapeHtml(trial.trial_id)} · capability hash ${escapeHtml(trial.capability_hash)}</small></div>`).join('')}` : '<p class="trace-host-empty">还没有 capability policy、candidate 或 trial。</p>';
    root.innerHTML = `<section class="trace-host-view"><header class="trace-host-view-head"><div><span class="trace-host-eyebrow">PRODUCT WORKSPACE · HOST INGEST</span><h1>宿主会话跟随<span>。</span></h1><p>只在明确附着后接收 Codex 的会话边界；Stop 后的理解工作由本机异步 job 处理。</p></div><div class="trace-host-head-actions"><button data-host-refresh>刷新</button><button data-host-back>返回</button></div></header>${error ? `<div class="trace-host-error" role="alert">${escapeHtml(error)}<button data-host-refresh>重试</button></div>` : ''}<section class="trace-host-notice"><strong>隐私边界</strong><span>原始对话只在每个会话卡片的折叠区显示；捕获、提案、采用和回带均通过 Product Workspace receipt，不会在浏览器另存副本。模型输入会经过字段 allowlist、长度预算、secret/PII/path 脱敏和回显检测。</span></section><section class="trace-host-sessions">${sessions || '<div class="trace-host-empty-card">还没有宿主会话。请在 Codex 中明确说「$trace 跟着这个任务」。</div>'}</section><section class="trace-host-board"><div><header class="trace-host-board-head"><h2>Routing proposals</h2><span>只有 adopted / trial 才能进入 activation</span></header>${proposals || '<p class="trace-host-empty">异步 worker 产出候选后，路由提案会出现在这里。</p>'}</div><div><header class="trace-host-board-head"><h2>Activation history</h2><span>offered ≠ used</span></header>${activations || '<p class="trace-host-empty">还没有回带记录。</p>'}</div></section><section class="trace-host-board"><div><header class="trace-host-board-head"><h2>Runtime health</h2><span>产品事实与 worker 状态</span></header>${workerPanel}${privacyPanel}</div><div><header class="trace-host-board-head"><h2>Guard recovery</h2><span>journal / receipt 一致性</span></header>${guardPanel}</div></section><section class="trace-host-board"><div><header class="trace-host-board-head"><h2>Capability governance</h2><span>candidate ≠ Skill publish</span></header>${publicationPanel}</div></section></section>`;
  }
  root.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button || disposed) return;
    if (button.hasAttribute('data-host-back')) { onBack(); return; }
    if (button.hasAttribute('data-host-refresh')) { await load(); return; }
    try {
      if (button.dataset.hostAction) {
        const operation = button.dataset.hostAction; const host = button.dataset.host; const sessionId = button.dataset.session;
        const session = state.sessions.find(item => item.host === host && item.session_id === sessionId);
        const route = operation === 'attach' ? 'attach' : operation === 'pause' ? 'pause' : 'detach';
        await post(`/api/product/host/session/${route}`, {commandId: `desktop-${operation}-${id()}`, host, sessionId, ...(operation === 'attach' && session?.project_ref ? {projectRef: session.project_ref} : {})});
        await load(); return;
      }
      if (button.dataset.routeAction) {
        const proposal = state.proposals.find(item => item.proposal_id === button.dataset.proposal);
        await post('/api/product/host/routing/decide', {commandId: `desktop-route-${id()}`, host: proposal?.host || 'codex', sessionId: proposal?.session_id || 'desktop', proposalId: button.dataset.proposal, action: button.dataset.routeAction, expectedRevision: Number(button.dataset.revision)});
        await load(); return;
      }
      if (button.dataset.activationAction) {
        await post('/api/product/host/activation/mark', {commandId: `desktop-activation-${id()}`, host: 'codex', sessionId: state.activations.find(item => item.receipt_id === button.dataset.receipt)?.session_id || 'desktop', receiptId: button.dataset.receipt, status: button.dataset.activationAction, expectedRevision: Number(button.dataset.revision)});
        await load();
      }
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); paint(); }
  }, {signal: abort.signal});
  paint(); void load();
  return {destroy() { disposed = true; abort.abort(); }, update() { void load(); }};
}
