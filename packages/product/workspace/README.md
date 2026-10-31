# Product Workspace

Trace Web 产品状态的权威 Module。它集中维护事项、原表达、理解、来源关系、对照、工作、命令版本、持久化回执，以及 Codex 工作交接记录。

## Interface

- `src/index.mjs`：浏览器安全的状态转换、选择器与产品命令。没有文件、数据库或网络访问。
- `src/workspace.mjs`：Node 本机 Adapter，导出 `createProductWorkspace()`；封装 `web.sqlite`、事务、CAS、幂等回执和同源 HTTP 处理。
- `@trace/product-workspace/{bridge,chain-model,comparison-model,worksite-model}`：显式纯模块子入口，保留已有Web导出面；不得从浏览器导入`./node`。

`apps/desktop` 只负责页面和本机宿主组装；`apps/agent` 只通过产品快照读取能力使用这里的状态，不导入 desktop 实现。

### 固定本地Web包（完整前端重做 W1）

`0.2.0-frontend.5`合并网页公开来源/阅读摘录/完整原话与能力投影，以及Runtime跨事项来源核验、历史带入和现场发现/修订状态。保持schema 1、已有ID和事务owner，不代表多媒体/布局新schema已经实现。新增严格命令`source.keep-public`、`source.provenance.attach`和既有事项的capture staging；来源不一致与不支持动作不能通过whole-host旁路提交。两个来源入口复用同一首次快照，明确不同的正文/URL/作者仍拒绝；未提供的元信息不制造冲突、也不伪造为summary或metadata，显式excerpt不混为unknown。手工导入/旧来源的provider可不同，取得时间缺失保留未知而不伪造；真正搜索结果的保留命令仍要求完整来路。

`npm run build:types`从同一纯入口生成`types/*.d.mts`，子入口包含明确的types/default导出条件；不是在Web加一个全any声明绕过缺失API。类型产物也随包固定hash，更新源码后须重新生成和验收。

Web消费项目内固定tarball及integrity，四份旧路径只薄导出；包身份记录源HEAD、dirty源文件hash及完整归档hash，不从相邻工作树路径动态加载。每次已消费字节改变必须产生新包身份并回归，不能反复用同版本覆盖；staged Runtime/安装包需另行对齐，不能靠改标识冒充包含新命令。

包为Trace内部私有代码，`UNLICENSED`不授予对外开源或再分发许可，也不继承Infinite Canvas的MIT。第三方库的许可与声明仍分别管理。

## Codex Host Session Ingest

`src/host-ingest.mjs` 是用户级 Codex 原生会话的接收边界。它使用同一
`web.sqlite` 句柄创建独立的 `host_sessions`、`host_turns`、
`host_ingest_events`、`host_control_commands` 和 `workflow_findings` 表；这些
表不参与 `web_workspace.revision`、产品快照或 `web_commands` 的计数。

宿主事件默认不保存。调用方必须先显式 `attach`；之后
`UserPromptSubmit` 保存 prompt，`Stop` 保存 `last_assistant_message`，
`PreToolUse`/`PostToolUse` 只保存安全的 event/tool identity，
`Interrupt`/`SessionEnd` 封口。`pause` 暂停自动接收，`detach` 将会话结束；
结束的 session identity 不能复活。事件键由
`(host, session_id, turn_id?, event_kind, tool_use_id?)` 构成，重复同内容
返回原回执，重复键不同内容失败。

受理的 `event_kind` 固定为 `SessionStart`、`UserPromptSubmit`、
`PreToolUse`、`PostToolUse`、`Stop`、`Interrupt`、`SessionEnd`；这套边界不读取
`transcript_path`，也不会因为 hook 已安装就自动打开捕获。

Host Session 允许 `project_ref = null`，因此不依赖 `.trace/` 或 cwd；未附着的
全局 hook 仍是成功 no-op，不创建产品状态。Workflow Finding 只有在用户明确
捕获并指向已接收 HostTurn 时保存，初始固定为
`scope=unknown / target_kind=unresolved / status=captured`，不会自动生成 Skill、
修改理解或发布规则。

Finding 现在还可以携带 `trace.scope-contract@1` 多维作用域：它分别记录 owner、来源与
Host attachment、content scope、project links、discovery/activation policy、classification
和 lifecycle。项目附着只是工作现场，不会自动把个人判断变成项目事实；项目私有事实也不会
因为由个人创建就跨项目回带。旧 `scope=personal|project|team|domain` 只在读取时保守
upcast，owner/classification/不明确的 activation 保持 `unknown`。实现和迁移边界见
[`Trace 多维 Scope Contract`](../../../docs/scope-contract.md)。

## Host workflow second stage

`src/host-workflow.mjs` 继续复用这一个 `web.sqlite` owner：Stop 在同一事务中
只创建一个 `sensemaking_jobs` outbox/job（queued、attempt、lease、输入/结果
hash、profile/model version）。`apps/agent` 按服务端配置显式选择
`disabled`、离线 `fixture-dev`、绑定 `ExecutorRegistry` 的 `profile`，或不进入
路由的 `shadow`；`disabled` 不消费队列，`fixture-dev` 只证明离线契约，不代表真实
供应商质量，缺少真实 profile/凭据时不会静默回退。worker 不在本模块直接调用远程模型。
候选写回 `workflow_findings(finding_kind=candidate,
origin=sensemaking)`，并生成 `routing_proposals`，但不会修改 canonical
understanding 或发布 Skill。

路由决定使用 `route_decisions` 的 revision CAS 和命令回执；`adopt`、`trial`、
`reject` 始终保留为提案状态。`activation_receipts` 记录有预算的 offered/used/
affected/dismissed/snoozed/released 历史，查询只回带 adopted（试用需显式开启），
不把旧 transcript 注入宿主。Repository Guard 的 preflight 是只读 suggest，只有
绑定已采用的 `runtime-guard`、local、clean 且状态 hash 未变化时，单独 apply 才能
执行 `git switch -c`；不 push、merge、delete 或切 managed worktree。

## 第三阶段运行与能力治理

`src/host-workflow.mjs` 继续是 `web.sqlite` 中 Host workflow 的唯一内容 owner。Stop 的 job 以 `queued → running → succeeded/noop/failed` 和 lease owner/expiry 表示执行事实；`execution_mode=shadow` 只保存候选，不自动路由。`sensemaking_privacy_receipts` 保存 policy/version、字段 hash、替换计数和 overlap 元数据，不保存模型输入回显或隐藏推理。

Repository Guard 仍是只读 preflight → 用户采用 → 单独 apply。apply 的 `repository_guard_journal` 状态为 `prepared → git_applied → receipt_committed`，异常或无法证明时为 `recovery_required`；Product Service 启动和显式 recovery 只重读 branch/HEAD/clean/state hash，绝不自动 reset、切回、删除、push 或 merge。只有证据证明已切到预期分支时才能补 receipt。

被采用的 `capability-candidate` 进入 `capability_orchestrations`，但没有现有内容 producer 时保持 `producer_required`，不会生成空 Skill。`CapabilityTrial` 固定 capability version/hash、scenario、task、expected/observed、evidence refs 和 `support|limit|challenge|inconclusive` outcome；行为验证通过至少需要一个有证据的 support trial。现有 CapabilityPublisher/Change Set 仍是唯一文件发布路径，Product 只记录 stage/validate/publish/rollback orchestration 与 receipt。PublicationPolicy 默认 manual，必须先显式 adopt，撤回立即阻止后续 publish；candidate、adopted、trial 和 published 永远不是同一状态。

对应 HTTP 命令包括 `/api/product/host/repository/recovery/{preview,reconcile}`、`/api/product/host/publication-policy/{preview,adopt,revoke}` 和 `/api/product/host/capability/{trial/create,trial/complete,stage,validate,publish,rollback}`；所有状态写入都使用 command id、request hash 和 CAS。云同步、ADrive、远程鉴权不属于本地协议。
