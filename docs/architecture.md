# 底层架构：职责、数据与入口

**当前工作区基线：2026-09-15。** 本页描述已存在的模块，不是把拟建架构写成完成。生产化改造顺序见[阶段计划](production-plan.md)。

## 一张图理解底层

```text
本机 Web / 同源 API 调用方
  ├─ 产品命令 ── apps/desktop/web-store + src/product ── web.sqlite
  └─ 生成请求 ── apps/agent ── Codex app-server
                       ├─ 只读当前产品版本与允许内容
                       └─ agent.sqlite（运行/事件/候选，不是正式理解）

Codex 原生任务
  └─ trace-codex Plugin ── apps/mcp
       ├─ 工作领取/结果回流 ── 本机产品 API ── web.sqlite
       └─ 项目协作/上下文包 ── packages/product/application
                                  └─ packages/core ── 项目 trace.sqlite
```

**这不是三个 Agent。** 产品后端维护内容；Agent 后端调用 Codex 生成；Plugin 让原生 Codex 任务使用 Trace。两种 Codex 接入共享产品边界，但运行身份、授权范围和入口不同。

## 模块归属与真实缺口

| 层 | 当前代码 | 负责 | 不负责 / 待整理 |
| --- | --- | --- | --- |
| HTTP 宿主 | `apps/desktop/server.mjs` | 同源页面、产品和 Agent middleware | 不是 Electron 安装包，也没有公网租户认证 |
| 产品领域 | `apps/desktop/src/product/*model.mjs`、`commands.mjs`、`codex-bridge.mjs` | 事项/理解/对照/工作状态机、版本化动作与回执 | 仍在 desktop 路径中；并非全部已迁入 packages |
| 产品存储 | `apps/desktop/web-store.mjs` | SQLite 事务、工作区 CAS、命令重放 | 不调用模型，不接受默认整份 host 覆盖 |
| Agent 执行 | `apps/agent` | 上下文范围、运行、流式事件、取消、Codex adapter、候选校验 | 不自动采纳，不兼任所有来源检索与原生编码任务 |
| Codex 桥接 | `plugins/trace-codex`、`apps/mcp` | 用户意图入口、上下文包、工作快照领取与结果送回复核 | 安装不会启用生成 API，不等于部署 Web 服务 |
| 原生协作底座 | `packages/product/application`、`packages/core`、`apps/codex` | profile、来源授权、认知接续、提案/采用、hooks evidence | 不是六项 Web 功能已经统一抽出的领域包 |
| 维护与集成 | `apps/cli`、`packages/sdk`、`native` | CLI、RPC、安装更新和认知账本维护 | 现有发行不覆盖新 Web/Agent；backup 不覆盖其两库 |
| 探索形态 | `legacy.html`、`plugins/trace-harness-plugin`、`artifacts` | 旧原型、宿主实验与历史验证材料 | 不作为当前产品入口或生产发行依据 |

**先明确归属，不立即搬动目录。** 当前领域逻辑确实混在 desktop 下；后续抽包需保持 API 和数据库行为不变，用既有事务/回放测试证明。仅改名或多包一层 wrapper 不能解决状态边界。

## 数据不要混用

| 数据 | 权威内容 | 维护边界 |
| --- | --- | --- |
| `web.sqlite` | 用户原表达、理解、来源关系、工作及产品回执 | 产品命令唯一写入边界；生成只能读 |
| `agent.sqlite` | 运行输入/上下文、候选、工具事件与 SSE 游标 | 独立 owner，与产品库身份绑定；包含敏感内容，不是匿名日志 |
| 项目 `trace.sqlite` | 协作配置相关状态、接续、候选/采用与 evidence | 现有 CLI backup/restore 的范围 |
| trace-portal 的 IndexedDB | 当前浏览器站点内的独立产品内容 | 另一个前端仓库的实现；无自动同步或本机配对 |

生成采用整工作区 revision 校验：别的事项写入也可能让运行过期。已有回答只能作为历史，真实候选的采纳命令、细粒度版本和归档仍需实现，不能靠前端绕过。

## 原生认知 runtime 的内部机制

以下保留原架构说明，范围仅是项目协作/认知运行时，**不是整个 Web 后端的替代说明**。

Trace 的架构不是从“数据库、RAG 或 hook”倒推出来的，而是服务于同一条产品生命周期：**候选认知变化 → 用户采用 → 能力 / 激活 → 后续验证、限制或撤回**。

```text
用户层：看见工作线、来源实际使用、候选、采用状态、能力、健康与恢复
    ↓
宿主层：Codex hooks、SDK JSONL RPC、其他宿主 adapter
    ↓
核心层：协作模型、来源地图、context、continuity、data、precedent、capability、change set、storage
```

## 用户层

用户看到的是项目、认知源、当前协作模型、来源地图、候选、能力、健康与恢复；更重要的是能知道：本轮发生了什么变化、什么只是候选、什么尚未保存、下一步怎样继续。默认 CLI 从最近的 `.trace/` 自动发现项目，避免重复填写 SQLite 路径、lineage 或 producer。`trace profile` 显示协作契约和地图；`trace sources` 显示宿主实际使用来源的 evidence。两者分别回答“应如何协作”和“实际做了什么”。

## 宿主层

Codex hook、SDK 与未来桌面端使用 `trace internal ...` 或 RPC。Codex 的用户级 hook 不携带某个固定项目路径，而是按每个事件的 `cwd` 找到最近 `.trace/`，再加载该项目 profile 与状态库；非 Trace 项目成功 no-op。它们可以传递 event、引用、correlation 与 causation，但不能绕过 runtime 直接写 SQLite / JSONL。

对于认知源检索，职责不是“Trace 检索、Codex 读取预选页”，而是：`UserPromptSubmit` 先编译版本化的协作模型与来源地图（不含来源正文），再给当前宿主 source lease（正式根、prefix、预算）；Codex 使用自己的 native search/read/tool 能力决定实际访问；`PreToolUse` 对可识别 read 检查预算；`PostToolUse` 把实际访问写成无正文的 `host_retrieval_evidence`。个人/项目地图存于 ignored `profiles/`，`instance/activation.lock.json` 只保存身份/hash；配置变更通过显式更新与备份，避免隐式 drift；source profile 漂移时不发出 source lease。`external` / `team` 的已审阅 profile 只能通过显式 source update 刷新 lock；`local` 固定指向该项目的 `.trace/source`，`empty` 固定禁用，二者不能藉 profile 更新取得任意外部 root，来源类型切换必须由单独的 selection migration 承担。因此用户可区分来源已提供、已搜索、已读取与未分类访问，不会把一个 pointer 当成 Agent 已读。完整协议见 [Codex 原生检索与 Trace 证据架构](host-native-retrieval.md) 与[适配使用者](personalization.md)。

本机 Web 与 Agent 执行现已存在，见上方模块表；DeepSeek Harness / Electron 的原型与原生认知生命周期接入不能据此视为已完成。其权限、事件顺序、replay、deactivate 与 rollback 仍须独立验收。

## 核心层

- Context 只提供受控引用、预算和禁止范围，不注入整库正文；host-native source lease 的绝对根仅存在于当前宿主响应，持久化 evidence 只保存安全相对 locator、revision/hash 与输入/输出 hash；
- Continuity 记录跨会话工作线、重要变化、激活 / 沉淀回执，而不把完整聊天伪装为认知源；
- Data Ledger 维护 hash、revision、lineage 和 fail-closed 验证；
- Change Set 管理候选、验证、采纳、发布与回滚；
- Prompt case 必须经过 transient → proposal → user-approved capture；
- 协议 upcaster 只生成内存视图，不重写历史 revision；
- Observability 不提供自由 payload 字段，避免 prompt、来源正文、凭证和工具参数误入运行日志。

`native_observed` 不是文件系统沙箱：Codex hook 可以观察 Bash、MCP 和多数本地函数工具，但不能成为所有专用工具路径的强制 ACL。对需要硬隔离的来源，profile 不能开启 native lease，必须等待真实权限 adapter。

开发者接口仍可通过 `trace --help --advanced` 发现。它们稳定、可测试，但不应成为新用户 README 或 Codex 日常提示中的默认操作。
