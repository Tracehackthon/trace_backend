# 底层架构：职责、数据与入口

**当前工作区基线：2026-09-15。** 下方区分已实现执行底座与仍未完成的远程生产边界。生产化改造顺序见[阶段计划](production-plan.md)。

## 已确认方向：独立、可配置的 Agent

2026-09-15 用户确认：**远程版优先使用 Trace 自己的轻量 Agent Runtime，接入可配置模型；可扩展接入完整外部 Agent 服务。Codex 是本机可选适配器，不是远程版的必需依赖。** 通用执行接缝与三类 adapter 现已实现；这不表示公网身份、恢复、发行或真实供应方已经验收。

```text
Web → Trace 产品后端 → AgentService（内容范围、版本、运行与候选）
                          ↓ 统一执行适配接口
                          ├─ Trace Agent Runtime → 可配置模型接口〔执行接缝已实现〕
                          ├─ External Agent Adapter → 完整 Agent 服务〔协议已实现〕
                          └─ Codex Adapter → 本机 Codex〔已有实现〕
```

### 模型连接不等于 Agent 服务

| 接入类型 | 对方提供 | Trace 的责任 |
| --- | --- | --- |
| 模型接口 | 模型响应、可能包含工具调用请求 | 自建执行循环：判断工具请求、授权校验、执行工具、回传结果、再次调用、终止与输出校验 |
| 完整 Agent 服务 | 对方自己的任务执行与工具体系 | 适配身份、事件、取消与结果；核验对方权限是否符合本次范围，不替对方虚构隔离或实际读取证据 |
| 本机 Codex | 现有 app-server 协议与原生执行 | 保留专属登录、版本与隔离策略；不将这些要求写入通用运行层 |

第一版内置 Runtime 只承接讨论、解释、所选材料比较和局部修订；工具优先复用有界上下文及明确授权的来源 provider。不复刻 Codex 的完整编码工作台，不默认开放 Shell、任意文件与网络。来源 provider 与模型 provider 是不同角色。

### 配置与执行契约（执行底座已实现）

- **连接配置**：类型、协议、endpoint、模型/服务标识和 credential reference。**执行配置**：允许工具、上下文范围、步数/工具次数、超时及可执行的用量上限。凭据由服务端保管，浏览器和模型只得到必要信息；不读取个人 Codex 登录作为云端共享账号。
- Web 只选择已获授权的 Agent profile ID；后端校验其归属，并为每次 run 固定配置版本与能力集。当前请求支持可选 `profileId`，省略使用服务端默认值；改 profile、撤权或移除凭据会中断旧任务，迟到结果不能复活。
- 统一接缝围绕能力声明、连接检查、执行、事件与取消；复用现有 `adapter.check / execute`，不从 HTTP 层直接依赖 Codex 版本常量。明确声明流式、工具调用、结构化输出、服务端取消等能力，不支持就显式拒绝或采用已说明的兼容路径。
- 模型适配器转换不同供应方的消息/工具/输出格式；“兼容某 API”不等于已经通过全部能力验收。工具参数逐字段校验，执行前检查授权，结果有大小上限；工具返回内容不取得新的执行权限。
- 外部 Agent 的“完成”先视为待核验结果。只有可核验的回执才记录实际工具使用；无法可靠停止远端执行时，区分 Trace 已停止接收与远端取消未确认，不承诺停止计费。
- endpoint 由服务端配置并限制出站目的地、重定向与内部网络访问；显式授权的自托管服务按白名单管理。配置模型服务不等于允许模型通过工具访问同一网络范围。
- 延续现有幂等请求、SSE 游标、超时、旧结果失效、独立运行记录与用户确认边界。执行失败不能静默切换模型/Agent，不能自动重试可能已计费或产生副作用的任务。

首个内部模型协议采用 `openai-chat-completions-v1` 请求形状；完整外部 Agent 协议采用 `trace-external-agent-v1`，详见 [Agent profiles](../apps/agent/docs/profiles.md)。仍待选择真实供应方、凭据/费用归属和生产 endpoint；这些缺口阻止声称真实远程连接已验收。

## 当前实现：一张图理解底层

```text
本机 Web / 同源 API 调用方
  ├─ `/api/product/*` 产品命令 ── packages/product/workspace ── web.sqlite
  ├─ `/api/search/{zhihu,global}` 公共来源搜索 ── ZhihuProvider
  ├─ `/api/zhihu/*` OAuth／账号状态／授权后用户读取 ── ZhihuProvider
  └─ `/api/agent/*` 生成请求 ── apps/agent ── ExecutorRegistry
                       ├─ Codex / bounded model / external Agent
                       ├─ 只读当前产品版本与允许内容
                       └─ agent.sqlite（运行/profile身份/事件/候选，不是正式理解）

Codex 原生任务
  └─ trace-codex Plugin ── apps/mcp
       ├─ 工作领取/结果回流 ── 本机产品 API ── web.sqlite
       └─ 项目协作/上下文包 ── packages/product/application
                                  └─ packages/core ── 项目 trace.sqlite
```

**这不是多个产品状态 owner。** 产品后端维护内容；Agent Runtime 选择一种执行器生成；Plugin 让原生 Codex 任务使用 Trace。各入口共享产品边界，但运行身份、授权范围和协议不同。

## 模块归属与真实缺口

| 层 | 当前代码 | 负责 | 不负责 / 待整理 |
| --- | --- | --- | --- |
| HTTP 宿主 | `apps/desktop/server.mjs` | 同源页面及四个明确 API 域：`product`、`search`、`zhihu`、`agent`；向 Agent 进程内注入只读 source provider | 不是 Electron 安装包，也没有公网租户认证 |
| Product Workspace | `packages/product/workspace` | 事项／理解／来源关系／对照／工作状态机，以及 SQLite 事务、工作区 CAS、命令回放和 Codex 交接记录 | 不负责页面渲染、Agent 生成或项目协作账本 |
| Web 页面 Adapter | `apps/desktop/src/product/*screen.mjs`、`web-main.js` | 渲染 Product Workspace 投影、把明确用户动作提交给产品命令 | 不拥有产品规则，不建立第二份事项状态 |
| Agent 执行 | `apps/agent` | profile、通用工具桥、运行/SSE/取消、Codex/模型/外部 Agent adapter、候选校验与受信任采纳编排 | 不自动采纳；产品写入仍由 Product Workspace 裁决；远程 adapter 不代表公网服务已有租户隔离 |
| 知乎内容来源 | `packages/integration/zhihu-transport`、`apps/agent/retrieval.mjs` | 知乎／全网接口、用户授权、摘要规范化、实际来源注册与引用校验 | source provider，不是模型 provider；本机单用户，不自动保存／采纳；[接入与回调](zhihu-native.md) |
| Codex 桥接 | `plugins/trace-codex`、`apps/mcp` | 用户意图入口、上下文包、工作快照领取与结果送回复核 | 安装不会启用生成 API，不等于部署 Web 服务 |
| 原生协作底座 | `packages/product/application`、`packages/core`、`apps/codex` | profile、来源授权、认知接续、提案/采用、hooks evidence | 不是六项 Web 功能已经统一抽出的领域包 |
| 维护与集成 | `apps/cli`、`packages/sdk`、`native` | CLI、RPC、安装更新和认知账本维护 | 现有发行不覆盖新 Web/Agent；backup 不覆盖其两库 |
| 探索形态 | `legacy.html`、`plugins/trace-harness-plugin`、`artifacts` | 旧原型、宿主实验与历史验证材料 | 不作为当前产品入口或生产发行依据 |

Product Workspace 已从 desktop 页面目录迁入独立 Module，并由浏览器安全 Interface 与 Node 持久化 Interface 共同维护同一套规则。当前仍待深化的是 Agent Runtime：`apps/desktop` 仍导入 `apps/agent` 的组装入口，下一步应让两个可执行宿主共同依赖独立 Agent Runtime Module，而不是让一个 app 依赖另一个 app。

接口级纵向验收由 `tests/backend-api-flow.test.mjs` 提供：不加载前端，从空库依次经过产品命令、知乎／全网来源、Agent 工具循环、SSE、运行读取、进程重启和两库恢复，并明确验证生成结果不自动采纳。外部模型与知乎上游使用受控 fixture，因此该测试验证执行链和状态权威性，不代替真实供应方质量或额度验收。

## 数据不要混用

| 数据 | 权威内容 | 维护边界 |
| --- | --- | --- |
| `web.sqlite` | 用户原表达、理解、来源关系、工作及产品回执 | 产品命令唯一写入边界；生成只能读 |
| `agent.sqlite` | 运行输入/上下文、候选、工具事件与 SSE 游标 | 独立 owner，与产品库身份绑定；包含敏感内容，不是匿名日志 |
| 项目 `trace.sqlite` | 协作配置相关状态、接续、候选/采用与 evidence | 现有 CLI backup/restore 的范围 |
| trace-portal 的 IndexedDB | 当前浏览器站点内的独立产品内容 | 另一个前端仓库的实现；无自动同步或本机配对 |

生成采用整工作区 revision 校验：别的事项写入也可能让运行过期。已有回答仍可作为历史；真实修订候选已有绑定运行与结果哈希的采纳／撤销命令，但细粒度事项 revision 和运行归档仍需实现，不能靠前端绕过。

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
