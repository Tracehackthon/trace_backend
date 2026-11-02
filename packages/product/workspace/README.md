# Product Workspace

Trace Web 产品状态的权威 Module。它集中维护事项、原表达、理解、来源关系、对照、工作、命令版本、持久化回执，以及 Codex 工作交接记录。

## Interface

- `src/index.mjs`：浏览器安全的状态转换、选择器与产品命令。没有文件、数据库或网络访问。
- `src/workspace.mjs`：Node 本机 Adapter，导出 `createProductWorkspace()`；封装 `web.sqlite`、事务、CAS、幂等回执和同源 HTTP 处理。
- `@trace/product-workspace/{bridge,chain-model,comparison-model,worksite-model}`：显式纯模块子入口，保留已有Web导出面；不得从浏览器导入`./node`。

`apps/desktop` 只负责页面和本机宿主组装；`apps/agent` 只通过产品快照读取能力使用这里的状态，不导入 desktop 实现。

### 内容schema 2与独立资源/布局（完整前端重做 W1，实施中）

当前在途代码版本为 `0.3.0-frontend.18`（尚未打包/消费），固定包的采用与实际验收范围以唯一前端任务记录为准。已消费的版本不覆盖字节；15的三项静态P2、16的流式接回/标题漂移两项静态P2，以及17重试快照指针P2均保留，18继续修复，尚未端到端验收。早期1→2解决的画布文档/历史读取与原件等长损坏边界继续保留。

- `workbench-model.mjs`维护材料、独立用户表达、关系、能力正文版本、人工思考与任务准备的纯规则。布局中的`version:null`只跟随当前内容呈现；交给协作时必须冻结数字版本。
- `canvas-model.mjs`维护独立布局revision、CAS和撤销；严格验证当前文档及历史。移动卡片不增加内容revision。`canvas-store.mjs`使用同一SQLite owner下的独立表、二进制资源目录与同源接口；不把原件塞入业务JSON。
- 旧schema 1的正文/ID/草稿可在测试副本中显式迁入2；旧动作不得通过whole-host覆盖2。旧Codex/Agent/深链mutation适配尚未完成，因此个人已有数据的UI转换仍关闭；不是宣称正式迁移完成。
- 能力发布仅代表个人库的固定正文版本；明确版本包及反馈已分范围接入，完整分享/试用/反馈业务仍以任务的欠项和证据限定。人工讨论/准备记录不代表真实Agent执行；外部Skill文件仍由既有Publisher拥有。

### 旧schema 1固定包的兼容来源


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


## Frontend.6: explicit capability packets

`prepareCapabilityPacket`, `encodeCapabilityPacket` and `decodeCapabilityPacket` implement the fixed v1 `.tracecap` file contract. Files are uncompressed binary originals, not media-base64 business state. Shared optional fields/sources are explicit; identity labels are unverified, hash integrity is not author authentication. The adapters validate the actual stored file against commands before atomic receive/export records.

The existing schema-2 catalogs and database tables remain. Typed transfer events, source-packet provenance and the inactive `received` state require a matching frontend. New imports cannot be effective references until explicit adoption; updates require a higher version from the same declared source plus the exact local expectedVersion. Old versions, unpublished drafts and omitted-field choices are retained. A frontend.5 reader is not a rollback tool for a newer extended profile: restore the prior copy, never point it at the new profile. File creation does not prove delivery or use. E2E acceptance is recorded separately by the consuming project.


Frontend.7 fixes the UI-proven referenced-method privacy defect found in the unreleased frontend.6 checkpoint: selecting a capability as a source exports only the displayed method/prompt excerpt, never a JSON dump of its optional evidence/examples or references. The package wire format stays v1; existing material-only packet fixtures remain readable. The consuming project retains the failing actual-download evidence and must rerun the real sender/receiver journeys. Never overwrite a consumed frontend.6 tarball or equate this package build with release acceptance.


## Frontend.8: version-bound capability feedback

The optional schema-2 `feedbacks` catalog stores immutable observations, interpretation, scope, exact capability version (or explicit unknown), source context and subsequent decisions. It shares Product commands and `web_entities`; it is not a second feedback store. Manual observations, saved messages, prepared tasks and verified native results have different evidence strengths. A frozen reference is not proof that an Agent followed the method or that the method is generally valid.

`feedback.record/edit/state/apply` use command identity and revision CAS. Explicit keep, revise and disable append feedback history; revise/disable update the current method atomically, retaining the original target version and a causal link to the exact feedback revision. Withdrawing a feedback record does not undo a previously adopted method revision. Capability packets do not silently include the feedback catalog.

A native result requires the trusted Node composition root to supply `resolveFeedbackEvidence` (or `configureFeedbackEvidenceResolver`). The resolver must read the actual run ledger and verify task/input/result hashes and frozen fragments. This callback is not an HTTP or renderer capability. Browser manual feedback remains available without it; unverified result claims are rejected. Existing verified historical records can be annotated without rerunning a model.

No DDL migration is required for the new catalog; previous snapshots are conservatively read with it absent. Old frontend readers are not a rollback mechanism for profiles containing the new kind/counts: use a pre-upgrade copy. This version is an implementation checkpoint, not acceptance of live execution, old-user-profile migration or the full frontend replacement. End-to-end evidence belongs to the consuming project.


## Frontend.9: exact reference selections

`validateReferenceSelection` validates a new precise citation against its saved version. Text offsets refer to `value.text` and preserve whole characters. Media anchors use original coordinates/time, can only narrow a known saved material range, and preserve PDF page/rotation. Unknown time/page bounds cannot be guessed. The wire format and schema remain2; no DDL or new content owner.

New/changed feedback citations use the shared rule in Browser and SQLite. Historical reads are not silently rewritten, and the same old citation can be retained while annotating its observation. Effective future uses also validate selection bounds. Do not treat old readers as equivalent enforcement or point them at an upgraded user profile as a rollback. Product build/identity does not replace consuming-app E2E evidence.

### frontend.10：每段原话的独立冻结范围

新消息保存 refs/excluded/historyIds 的 scope，讨论起始引用不改写。历史字段缺失仍可读，不能反推当时精确范围；新调用需另留原话核对，旧运行仍按原冻结payload。包含/排除按范围相交校验，不以JSON不相等绕过局部排除。任务与反馈使用同一准确范围规则；消息来源反馈读取该消息冻结范围，后续默认指令/选区不改旧来源。新增 message-reference-scope-v1 特性，不创建新DDL或业务store。实际只读输入预览由消费端生产Native owner构建，无模型执行，不以静态检查代证E2E。


## frontend.11：写回表达与关系历史

- 内容schema仍为2，无新DDL。新增`attempt`用户表达类型；它不是已执行任务，也不自动发布能力。
- 关系可带准确`sources`引用；`relation.edit`及状态变更先保留旧完整说明/两端/版本/状态，再写新版本。`modifiedBy`区分用户改写，旧关系没有历史时仍可读，不编造更早版本。
- 原件、布局、Agent结果账本仍是独立owner。AI原稿不可编辑；后端核对真实运行与原稿后，才以既有原子命令保存用户选择的写回。
- `.10`已被消费，不覆写其归档。新字段对新reader是显式增量，旧严格reader不得作为`.11`数据的回退writer；没有自动升级个人库或安装。
- 本段是契约说明，不代表端到端验收或provider已使用能力；以Trace完整前端任务的对应冻结源/实际运行证据为准。

## frontend.12：用户原话摘录与包内隐私边界

- `prepareThinkingMessageCapture`构造明确选取的dialogue材料；`material.create`在同一纯规则中核对准确用户消息及UTF-16选段，禁止越界、截断代理对、正文不匹配、假资源或将AI结果伪作用户原话。原消息不改写，摘录可独立保留，不要求形成结论。
- `origin.kind=thinking-message`只携准确本地消息身份及范围；原件仍是既有append-only消息，不另建媒体Blob或第四种ContentRef。只读`projectThinkingMessageSource`区分可定位、不可用与片段变化，不猜同文/同名替代来源，不自动展开到协作输入。
- `prepareContentWriteback`统一人工表达及经复核AI返回的目标构造；原件创建与正文/关系使用同一原子命令，布局另存。该构造器不执行或持久化；命令规则与CAS仍是实际权限/完整性边界。
- 分享新原话摘录时，仅携所选摘录；本地讨论ID/消息ID/原话范围不会迁出，包内以`{"kind":"withheld","reason":"thinking-message"}`明确说明未带原讨论。此包manifest版本2；普通包继续版本1。接收只形成shared材料，保留`origin.packet.withheld`的说明，不按发送方ID读取本地消息。
- 新reader严格接受v1/v2对应格式；旧v1读端明确拒绝v2，而非被宣称兼容。内容schema2/无新DDL不等于旧writer可写12的新字段；回退使用升级前副本，不自动升级个人库。构建/类型生成不代表功能或分享隐私端到端通过。

## Activation contract in frontend.14

The optional schema2 `activations` catalog freezes bounded seed/candidate/exclusion/instruction references and records immutable manual or verified native candidates, exact evidence, human decisions and independent placement intents. Only explicit adoption creates ordinary relations/questions/branches; rejection and coframing do not. Native import requires the controlled attempt resolver and actual-read citation proof. Layout confirmation is verified against the original canvas scene; it is not a renderer boolean. Existing schema2 data is readable, but older packages must not rewrite the new catalog. Provider execution/semantic validity is not established by packaging or the browser manual flow.

frontend.14 keeps manual save/reject interpretations optional (including all-empty input) without auto-filling the original. Acceptance still requires an explicit complete interpretation. This fixes the independent real-UI SDK13 first failure; SDK13 stays immutable and is not a valid replacement for the corrected non-adoption contract.

## Task input and native dispatch permission (frontend.18, implementation pending E2E)

`taskInput(host, taskId)` is the shared bounded text-input projection. It retains exact references, exclusions, explicit instructions and an eligible, non-excluded template, but does not project dispatch records, input-version metadata or adopted results into a later call. The template is rechecked at each future use; an excluded template ref is not sent, while user-authored goal/plan prose is not silently removed. Existing immutable input/output archives are not rewritten. Numeric source versions remain fixed; unavailable/non-text-localized sources fail explicitly rather than expanding into originals.

`Task.preparedInputVersion` is optional for old schema2 records. Native dispatch metadata belongs to the same Task, not a new task store or provider-status database. Only the trusted Node composition seam `reserveNativeDispatch` can prove a native reservation under the Product transaction. Ordinary renderer Product commands cannot supply this proof. The selected existing project is canonicalized by Node; no renderer-provided checked flag or file read authority is accepted.

Native reservation precedes insertion into the Agent attempt ledger. The request binds an immutable run ID, exact input hash, canonical prepared-input hash, project, permission mode and `previousRunId` (null for a first reservation). A repeated request recovers that same reservation. A crash with no Agent row is unconfirmed permission, not execution: explicit resume uses the original reservation/project/mode and verifies its exact terminal parent, rather than returning an older attempt or using today's default project. Product15 records with no parent field remain readable but cannot be blindly requeued. Cancellation is allowed only after the actual Agent ledger proves the run was never created. Retry retains the prior reservation in history and requires the latest real attempt to be terminal. Old `task.execution` cannot coexist with a new dispatch. Missing native proof fails closed; Browser manual preparation remains available.

The Agent owns queued/running/terminal status. A reservation is not a provider receipt. Source eligibility is checked before qualification, submission, tool use and any new adoption. A historical return instead checks its locked dispatch/input identity; later disablement does not erase an already delivered original. The native owner saves bounded raw text once before parsing, including invalid/cancelled returns, and exposes hash-bound read-only retrieval without implying success or adoption. This package does not implement protocol2 MCP receive/return yet, does not prove a real Codex host project, and does not qualify UI/browser E2E gates by compilation. Test/installation status is maintained only in the frontend replacement task.

`readTaskInput` recovers the locked input from `inputCommandId`, distinct from the current dispatch receipt's `commandId`. The first reservation points to its own input command; every retry must keep that same pointer, even when its new receipt snapshot contains today's newer display titles. The original snapshot must contain this Task's self-pointing input claim with the same input version and both hashes. Only fragment display titles may differ in the current eligibility comparison (`assertTaskInputUsable`); task fields, roles, exact reference versions, local anchors and all fragment text must still match. A newer source title cannot alter the original input or invalidate an otherwise usable selected older version. Missing/corrupt snapshots fail explicitly, never rebuild an unconfirmed input or guess a legacy retry's missing input pointer from arbitrary history.

The native Runtime adapter must advertise `TASK_EXECUTION_GATES_VERSION=1`: `isCurrent` protects run ownership/stream reception, `canUseContext` separately guards new turns, tools and positive interaction responses. Its raw callback reports received full or partial text before cleanup even when execution throws. New Task execution fails before model submission with an older adapter; the package does not silently weaken tools to preserve output. Packaging that Runtime contract and actual transport/UI verification remain required gates.
