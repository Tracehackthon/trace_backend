export const platforms = {
  deepseek: { name: 'DeepSeek', logo: './public/logos/deepseek.svg' },
  kimi: { name: 'Kimi', logo: './public/logos/kimi.svg' },
  zhihu: { name: '知乎', logo: './public/logos/zhihu.svg' },
  codex: { name: 'Codex', logo: './public/logos/codex.svg' },
  claude: { name: 'Claude', logo: './public/logos/claude.svg' },
}

export function createSeed(params) {
  const threads = [
    { id: 'observation-agent-collaboration', title: '多 Agent 交接：从聊天摘要到决策卡', text: '多 Agent 交接时，与其传递聊天摘要，不如传递带证据和待回答问题的决策卡。', platform: 'deepseek', date: '2026-09-14T15:12:00', kind: '事件记忆', source: 'DeepSeek Harness · Cursor 实验 #18', response: '这条观察里有两个值得区分的问题：是摘要质量不够，还是摘要本身就不是合适的交接载体？可以先找一次失败的交接，对比遗漏的证据、决策和待回答问题。' },
    { id: 'thread-evidence', title: '检索结果必须附带可追溯证据', text: '将可验证来源作为回答质量的一部分，关键事实需要能回到原始证据。', platform: 'codex', date: '2026-09-14T09:42:00', kind: '事实记忆', source: 'Codex · Research agent · 失败复盘', response: '可以把证据要求放在研究任务的验收标准中：每一项关键结论对应一个可访问来源，并区分原始信息与推断。纯创意任务可以不套用这条规则。' },
    { id: 'thread-uncertainty', title: '复杂任务先显式陈述不确定性', text: '处理复杂问题时，先列出已知事实、待验证假设和信息缺口，再给出方案。', platform: 'kimi', date: '2026-09-13T16:35:00', kind: '偏好记忆', source: 'Kimi · 方案讨论 · 结果复盘', response: '先把假设写出来，可以让我们尽早发现理解分歧。建议在结论前保留一个简短的“已知 / 假设 / 未知”清单。' },
    { id: 'thread-writing', title: '方案写作：结论先行，保留事实依据', text: '我希望方案先给结论，再按事实、判断和行动展开，减少泛泛的表述。', platform: 'kimi', date: '2026-09-13T11:08:00', kind: '偏好记忆', source: 'Kimi · 写作偏好讨论', response: '可以采用“结论、依据、下一步”的顺序。没有证据的部分标为假设，行动则写明负责人和完成条件。' },
    { id: 'thread-positioning', title: 'Trace 是思考沉淀层', text: 'Trace 承接真实协作中形成的判断，由用户决定哪些变化值得被带到下一次工作。', platform: 'deepseek', date: '2026-09-12T18:20:00', kind: '事实记忆', source: 'DeepSeek · 产品定位讨论', response: '这个定位强调的是判断形成和复用的过程。下一步可以检验：用户能否看见判断的来源，以及能否修改或撤回它。' },
    { id: 'thread-discovery', title: '先保留模糊感受，再追问问题归属', text: '用户还没有想清楚时，先保留原话，再追问它属于哪一类问题。', platform: 'zhihu', date: '2026-09-12T14:16:00', kind: '事件记忆', source: '知乎 · 产品发现 · 讨论回看', response: '可以先问一个具体的现场问题：最近一次出现这种感受是什么时候？得到例子后，再识别问题类型。' },
    { id: 'thread-sources', title: '研究资料要区分事实与个人经验', text: '使用社区讨论作参考时，区分可核查事实、作者经验和观点，保留适用情境。', platform: 'zhihu', date: '2026-09-11T16:08:00', kind: '事实记忆', source: '知乎 · 研究资料整理', response: '个人经验可以提供线索，但不能直接代表普遍规律。可以补充一份原始资料或一个独立案例来交叉核对。' },
    { id: 'thread-team', title: '多代理交接的失败案例复盘', text: '本次交接遗漏了两个尚未回答的问题，导致接手方重复调查。下次尝试决策卡。', platform: 'codex', date: '2026-09-11T10:47:00', kind: '事件记忆', source: 'Codex · 团队讨论 · 交接失败案例', response: '先保留现场、当前决策、证据和未决问题，再记录接手方第一次追问发生在哪里。这样可以验证决策卡是否减少返工。' },
  ]
  if (params.get('text')) {
    const requestedPlatform = params.get('platform')
    const source = params.get('source') || threads[0].source
    const inferredPlatform = /kimi/i.test(source) ? 'kimi' : /codex/i.test(source) ? 'codex' : /zhihu|知乎/i.test(source) ? 'zhihu' : 'deepseek'
    Object.assign(threads[0], {
      id: params.get('observationId') || threads[0].id,
      title: params.get('text'), text: params.get('text'),
      source,
      platform: Object.hasOwn(platforms, requestedPlatform) ? requestedPlatform : inferredPlatform,
    })
  }
  for (const thread of threads) {
    thread.messages = [
      { role: 'user', content: thread.text, meta: thread.source },
      { role: 'agent', content: thread.response },
    ]
  }
  const changes = [
    { id: 'T-042', title: '检索结果必须附带可追溯证据', status: '待确认', confidence: 78, threadId: 'thread-evidence', platform: 'codex', scope: 'Research agent', source: 'Codex 实验 #18 · 失败复盘', evidence: 4, before: '将来源链接视为可选附注', after: '将可验证来源作为回答质量的组成部分', boundary: '研究、事实核验与需要复盘的方案判断；不适用于纯创意发散。', activation: '任务包含“调研、比较、证据、出处”时带回。', verification: '下一次交付中，关键事实均能在 2 步内回到原始来源。', date: '2026-09-14T09:42:00' },
    { id: 'T-041', title: '复杂任务先显式陈述不确定性', status: '已采用', confidence: 91, threadId: 'thread-uncertainty', platform: 'kimi', scope: 'Codex orchestrator', source: 'Kimi 工作会话 · 结果复盘', evidence: 6, before: '直接给出单一路径的结论', after: '先陈述已知、假设和信息缺口，再提出可验证的方案', boundary: '复杂决策、跨领域研究和多阶段规划。', activation: '存在关键假设或多个可选路径时带回。', verification: '用户能在执行前识别关键假设，并明确最先验证的事项。', date: '2026-09-13T16:35:00' },
    { id: 'T-039', title: '多代理交接以决策卡代替聊天摘要', status: '需回顾', confidence: 64, threadId: 'thread-team', platform: 'codex', scope: 'Product team', source: '团队讨论 · 交接失败案例', evidence: 3, before: '传递完整聊天摘要', after: '保留决策、证据、待回答问题和下一步验证', boundary: '跨会话、跨 Agent 的长任务交接；短任务需继续验证。', activation: '任务交接给其他 Agent 或下次会话时带回。', verification: '接手方能准确复述当前决策，且无需重复已完成的调查。', date: '2026-09-12T17:05:00' },
    { id: 'T-036', title: '先保留模糊感受，再追问它属于哪类问题', status: '已发布', confidence: 86, threadId: 'thread-discovery', platform: 'zhihu', scope: 'Product discovery', source: '知乎产品讨论 · 讨论回看', evidence: 5, before: '迅速将模糊想法总结成方法', after: '先接住原始表达，再通过具体场景澄清问题', boundary: '需求发现、开放讨论和早期探索。', activation: '用户尚未明确问题或表达模糊感受时带回。', verification: '在形成方法前，至少得到一个具体现场和一个待回答问题。', date: '2026-09-12T14:16:00' },
  ]
  for (const candidate of changes) {
    candidate.evidence = threads.find(t => t.id === candidate.threadId)?.messages.length || 0
  }
  return { threads, changes, foxCount: 0 }
}

export function createTeamSeed(base) {
  const team = structuredClone(base)
  team.threads = team.threads.map((thread) => ({ ...thread, id: `team-${thread.id}`, workspace: 'team', source: `团队共创 · ${thread.source}`, participants: ['林岚', '周宁', 'Mia'] }))
  team.changes = team.changes.map((change) => ({ ...change, id: `T-${Number(change.id.slice(2)) + 100}`, threadId: change.threadId ? `team-${change.threadId}` : null, workspace: 'team', scope: '团队共创', source: `团队共创 · ${change.source}`, participants: ['林岚', '周宁', 'Mia'] }))
  team.threads.unshift({
    id: 'team-claude-review', workspace: 'team', title: 'Claude 评审：把分歧留在认知工厂',
    text: '团队讨论里出现的不同判断，应该保留来源和参与者，再共同决定是否带回下一次工作。',
    platform: 'claude', kind: '事件记忆', date: '2026-09-14T14:18:00',
    source: 'Claude · 团队评审 · 共创现场', participants: ['林岚', '周宁', 'Mia'],
    messages: [
      { role: 'user', author: '林岚', content: '团队讨论里出现的不同判断，应该保留来源和参与者，再共同决定是否带回下一次工作。' },
      { role: 'member', author: '周宁', content: '我同意先保留分歧。认知工厂里需要让每位成员看到自己支持或保留的部分。' },
      { role: 'agent', content: '可以把分歧视为待验证的候选，补上触发现场和共同验收标准后，再由团队确认采用。' },
    ],
  })
  team.changes.unshift({
    id: 'T-152', title: '团队分歧先保留来源，再共同确认', status: '待确认', confidence: 72,
    threadId: 'team-claude-review', platform: 'claude', scope: '团队共创', source: 'Claude · 团队评审 · 共创现场',
    evidence: 3, before: '由发起人替团队总结成单一结论', after: '保留每位成员的依据和分歧，再共同决定是否采用',
    boundary: '适用于多人讨论、评审和交接；个人快速判断无需增加协作确认。', activation: '出现不同意见或需要团队共同承担结果时带回。', verification: '参与者能看见自己的分歧是否被保留，并共同确认验收标准。', date: '2026-09-14T14:18:00', workspace: 'team', participants: ['林岚', '周宁', 'Mia'],
  })
  return team
}
