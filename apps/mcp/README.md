# Trace 本地 MCP

这是 `trace-codex` Plugin 的标准 stdio MCP server，也是未来桌面端可复用的产品控制面。它直接调用 `@trace/product-application`，而不通过 shell 拼接 CLI，因此 proposal、状态指纹、备份和 receipt 与 CLI 使用同一套核心语义。

## 提供什么

- 只读状态：项目、来源摘要、候选 inbox、能力候选、版本差异、Codex hooks；
- 上下文 Skill：把已锁定 collaboration model/source map 编译为当前 Codex task/project 的虚拟 `SKILL.md`，并写 privacy-safe activation receipt；
- 产品工作往返：领取用户确认的有限工作快照，真实完成后把结果送入 Trace 复核区；
- Host Session Ingest：通过 `trace_host_session_attach` / `trace_host_session_pause` / `trace_host_session_detach` 显式控制当前 Codex session 的接收，并用 `trace_workflow_finding_capture` 关联已接收 HostTurn 的用户发现；
- Host workflow：用 `trace_routing_propose` / `trace_routing_decide` 审阅 finding 落点，用 `trace_host_activation_query` 查看有预算的回带并以独立 receipt 标记实际使用，用 Repository Preflight/Guard 先建议再显式 apply；
- 显式变更：项目初始化、legacy profile lock 迁移、profile 更新、hook 启用；
- 每一项变更固定为 `inspect / discuss → propose（无写入）→ 用户 adopt → apply → receipt`；
- proposal 带状态指纹，发生并发变化时返回 `STALE_PROPOSAL`，不会按旧提案覆盖新状态。

## 不提供什么

MCP 不会通用返回 raw prompt、来源正文、认知源绝对 root、凭证、工具参数或隐藏推理；动态上下文包不会被安装到全局 Skill 目录。显式 Host Session Ingest 是例外的受控写入边界：attach 后，用户输入与 final 只由 Product Workspace 私有保存到 `web.sqlite`，不进入 MCP 通用响应或项目 `trace.sqlite`。MCP 不是检索层，Codex 仍用自己的搜索、读取、推理和编码能力。

Host Session Ingest 默认不捕获 prompt；必须先显式 attach。会话记录写入 Product Workspace 的 `web.sqlite` 独立表，不推进产品 snapshot revision，不写项目 `trace.sqlite` 或 Agent 库，也不依赖 `transcript_path`。附着时 `PreToolUse` / `PostToolUse` 仅保留安全 event/tool identity，不保留工具输入或输出。finding 初始保持 `scope=unknown`、`target_kind=unresolved`、`status=captured`，不会自动生成 Skill、修改理解或发布规则。

普通用户不直接运行本 server。一次性安装由 `native/install-codex-plugin.mjs` 完成，日常通过 `$trace` 使用。完整 UX 与版本行为见[Trace Codex Plugin](../../docs/codex-plugin.md)。

## 知乎与全网（可选本机 provider）

新增 `trace_zhihu_status`、`trace_zhihu_search`、`trace_global_search`、`trace_zhihu_login`、`trace_zhihu_login_check`、`trace_zhihu_disconnect`、`trace_zhihu_user_read`。它们通过 `TRACE_PRODUCT_URL` 访问本机后端，不在 MCP 配置或输入中接收知乎密钥；登录由用户在浏览器授权，个人内容仅按明确请求读取。

构建与配置见[知乎接入指南](../../docs/zhihu-native.md)。工具存在不代表当前本机服务已开启或线上回调已部署；不自动读取收藏、翻页或采纳来源。

## 第三阶段控制面

除 Host Session/Workflow 工具外，MCP 还提供 `trace_sensemaking_worker_status` / `trace_sensemaking_worker_drain`、`trace_repository_recovery_preview` / `trace_repository_recovery_reconcile` / `trace_repository_recovery_status`、PublicationPolicy preview/adopt/revoke、CapabilityTrial create/complete，以及 capability stage/validate/publish/rollback。worker drain 只处理已经入队的有限 job；recovery preview 是只读，ambiguous journal 会 fail closed；capability publish 必须有现有 CapabilityPublisher 的 producer、hash、完整验证、rollback receipt，并在没有 standing policy 时提供本次明确 approval。MCP 不自行写 Skill、Git 或第二份浏览器状态。

所有工具从宿主环境读取当前 Codex session identity，不要求模型提供 session id；服务未启动、`TRACE_PRODUCT_URL` 缺失、worker 未配置、会话未附着或找不到 journal/turn 时返回可恢复错误。普通 `$trace` 不会保存全局规则、扩大 PublicationPolicy 或发布 Skill。
