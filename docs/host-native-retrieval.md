# Codex 原生检索与 Trace 证据架构

## 要解决的问题

Trace 不能把“根据 prompt 用自己的词法算法挑出两页”当作 Agent 已经检索、读取或理解了来源。那会同时造成三件事：

1. 把 Codex 原本的文件搜索、工具编排和推理能力降级成接收指针；
2. 把 `pages_considered` 误报为真实使用来源；
3. 让用户无法区分“Trace 提供了入口”与“Agent 实际读过并基于它工作”。

现在的架构将这三件事拆开：**宿主负责检索和工作；Trace 负责来源边界、证据、长期状态与人类可见性。**

```text
用户 prompt（只留在 Codex 当轮）
  → Trace UserPromptSubmit：按 event cwd 发现候选，核验 descriptor/Git/worktree 后读取 source profile
  → 提供 source access lease：正式根、允许前缀、单轮读取预算、隐私规则
  → Codex 自己用 native Bash / 本地函数 / MCP 工具搜索、读取、推理、执行
  → Trace PreToolUse：对可识别的 formal-page read 检查单轮预算
  → Trace PostToolUse：观察实际工具事件
       ├─ source_search
       ├─ source_read（relative locator + 读取时 revision/hash）
       └─ source_access_unclassified（不假装已读）
  → SQLite host_retrieval_evidence + trace_events
  → trace sources / trace status：用户看见提供、检索、读取和未分类访问
  → 用户讨论后才进入 proposal → adopt → publish
```

## 职责边界

| 主体 | 负责 | 不负责 |
|---|---|---|
| Codex | 判断当前问题是否需要认知源、生成搜索策略、调用原生工具、读取内容、推理与交付 | 把一次工具调用自动变成长期判断或能力 |
| Trace | 发现项目边界、提供已授权 formal source lease、记录实际访问证据、控制候选/采用/发布/回滚、给用户回执 | 用 lexical 预选替代 Codex 的检索判断；存储原始 prompt、正文或工具参数 |
| 用户 / 团队 | 选择认知源、查看 Trace 收到什么证据、选择案例保存方式、采用判断、发布能力 | 维护 SQLite、lineage 或工具调用日志细节 |

## Host Retrieval Evidence 协议

每条可持久化记录使用 Data Ledger 的 `host_retrieval_evidence` kind 与：

```text
schema_id: trace.host-retrieval-evidence
schema_version: 0.1.0
```

它只允许保存：

- `event_kind`：`source_access_offered`、`source_search`、`source_read` 或 `source_access_unclassified`；
- `source_id`、host/session/turn/tool 的安全标识；
- 相对 Markdown `locators`；
- 对于 `source_read`，读取后核验的 `page_versions[].revision/content_hash`；
- `input_hash` / `output_hash` 与受控 policy hash；
- correlation、causation、时间和完整性 hash。

它**明确没有** raw prompt、来源正文、绝对 source root、工具 input、工具 output、凭证或任意自由 `payload` 字段。`trace sources` 默认展示的也是这一安全视图。

`source_search` 不带页面版本；它表示 Agent 在来源范围内搜索过，不能推断它读过任何一个页面。未知命令形态一律标为 `source_access_unclassified`，而不是伪造 `source_read`。

## Source profile

```json
{
  "source_id": "my-cognitive-source",
  "root": "<user-local-absolute-path>",
  "formal_prefix": "wiki",
  "read_enabled": true,
  "write_enabled": false,
  "host_retrieval": {
    "mode": "native_observed",
    "allowed_prefixes": ["wiki"],
    "max_reads_per_turn": 8
  }
}
```

- `native_observed`：将 `allowed_prefixes` 对应的绝对根只交给**当前 Codex hook 响应**，由 Codex 原生工具使用；SQLite 不保存根路径。
- `disabled`：不向 Codex 提供 host-native source lease。
- `max_reads_per_turn`：对可识别 native formal-page read 由 `PreToolUse` 检查；PostToolUse 仍记录实际结果。
- `activation_excluded_paths` 仍仅用于显式 Trace/MyWiKi interactive search 的自动候选过滤；它**不是** native host 的 per-file 安全 ACL。

## 安全边界的真实含义

Codex hooks 能观察 Bash、`apply_patch`、MCP 与多数本地函数工具，并可在 `PreToolUse` 拒绝可识别调用；但官方文档明确说明某些专用工具路径可能不经过默认 hook。因此 `native_observed` 是**可观测、可预算的协作边界，不是文件系统沙箱**。

如果某份来源要求硬 per-file 隔离，不能把其 root 暴露给 `native_observed`。应设置 `host_retrieval.mode: "disabled"`，只通过单独的强制访问适配器提供它；这种适配器必须先有真实的 host/MCP 权限与事件契约，不能用当前 hook 冒充实现。

官方 Codex hook 合约说明了 `UserPromptSubmit` 可注入当轮开发者上下文，`PreToolUse` / `PostToolUse` 可收到本地工具名称、输入和输出，而托管工具不经过这条本地 hook 路径；本实现基于该边界设计。[OpenAI Codex Hooks 文档](https://learn.chatgpt.com/zh-Hans/docs/hooks)

## Host Session Ingest 协议

原生 hook 生命周期与认知源 evidence 分开接收。`SessionStart`、
`UserPromptSubmit`、`Stop`、`Interrupt`、`SessionEnd` 只在用户明确
`attach` 当前宿主会话后进入 Product Workspace 的 `web.sqlite`；全局 hook
看见未附着会话时保持成功 no-op。`PreToolUse` / `PostToolUse` 继续按上面的
native evidence 规则处理；附着时 Host Session 只记录它们的安全 event/tool
identity，不把工具输入或输出复制进 Host Session 表。

Host Session 的状态机为：

```text
attach → attached → pause → paused
                 └──────────────→ attach (同一未结束 identity)
attached/paused ────────────────→ detach → ended
UserPromptSubmit → HostTurn started
Stop             → HostTurn completed
Interrupt        → HostTurn interrupted
SessionEnd/detach→ 会话 ended，并将仍打开的 turn 标为 interrupted
```

Host ingest 的事实边界是独立 append-only receipt 表和同一事务内的 session/turn
索引；它不调用产品快照写入，因此任何单个 hook 事件都不会推进
`web_workspace.revision`。事件幂等键至少包含
`(host, session_id, turn_id?, event_kind, tool_use_id?)`。规范化内容只包含
官方生命周期字段（`prompt`、`last_assistant_message` 等）；同键同内容返回
原回执，同键不同内容以冲突失败，Stop/Interrupt 的乱序以错误失败。

`project_ref` 可为空，所以已附着会话即使当前 cwd 没有 `.trace/` 也能写入用户级
接收空间；不使用 `transcript_path`。Workflow Finding 只能由用户明确的
`$trace` 捕获命令关联一个已接收 HostTurn，初始为
`scope=unknown`、`target_kind=unresolved`、`status=captured`，不会自动生成
Skill、改变理解或发布规则。

## 用户看到什么

| 状态 | 用户需要知道 | 用户不必看到 |
|---|---|---|
| `source_access_offered` | 当前项目把哪一个 source 提供给 Codex、formal prefix、预算 | 绝对路径、prompt |
| `source_search` | Codex 确实搜索过该来源 | 搜索词、工具命令、输出正文 |
| `source_read` | 实际读过哪些相对页面，哪个 revision/hash | 页面全文、绝对路径、工具参数 |
| `source_access_unclassified` | Trace 检测到来源访问但不能可靠分类，需要审计 | 原始命令和输出 |
| 进入沉淀 | proposal、用户选择、采用状态、下一步 | 内部 lineage/correlation 除非用户需要诊断 |

用户的日常入口只有：

```powershell
trace sources
trace status
trace inbox
trace review <ID>
```

这避免把“Agent 做过什么”和“Agent 建议沉淀什么”混成同一件事。

## 验收

`tests/codex_hook_routing.test.mjs` 和 `tests/evals/hook-replay.test.mjs` 回放真实 `hook-stdio --route-from-event-cwd` 的 `UserPromptSubmit` / `PreToolUse` / `PostToolUse` 输入，验证多项目 cwd 路由、host-native source lease、搜索与读取的语义区分、读取预算，以及 prompt/source/tool/absolute-path 不入库。

`pnpm eval:pair` 只输出 fixture native-read replay 的 evidence coverage；它不是 Codex 模型检索质量结论。真实效果验收需要在固定模型和权限的干净项目中运行任务，结合最终 artifact、实际 `source_read` evidence、用户纠正次数与延迟比较。

## Sensemaking、隐私与恢复边界

Host Session 的 Stop 只创建 Product `web.sqlite` 中的异步 outbox/job。`apps/agent` 通过 `ExecutorRegistry` 使用服务端绑定的 profile；fixture、真实 profile 和 shadow 是显式模式，hook 永不等待 worker。发送给 executor 的输入只含 attached HostTurn 的允许字段、安全 evidence 和有界 finding 摘要，先经过 `trace.host-privacy@1` 的长度/字段 allowlist、secret/credential/path/PII 脱敏及 overlap detector。结果严格校验 `trace.sensemaking-result@1`；schema、identity、预算或回显检查失败只保存 hash、redaction/rejected receipt 和失败 job。

从 adopted runtime-guard 到 Git 的 apply 由 `repository_guard_journal` 记录 `prepared → git_applied → receipt_committed`。启动或显式 recovery 会重取当前 branch、HEAD、working tree 和 state hash；状态无法证明时标记 `recovery_required`，不自动切回、reset、clean、删除或远程操作。Capability candidate 必须沿现有 Change Set/CapabilityPublisher 进入 stage、trial、validate、publish；PublicationPolicy 默认 manual 且可撤回，candidate/adoption/trial 不等于 Skill。
