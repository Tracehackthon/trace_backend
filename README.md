# Trace

> **不让 AI 协作只留下对话；让一次真正改变了理解的工作，能够进入下一次行动。**

Trace 是 AI Agent 时代的**认知变更管理层**（cognitive change management）。

它管理的核心不是笔记、聊天记录、向量、prompt 或“模型记忆了什么”，而是一次真实协作后，人的理解如何从 **Before** 变成 **After**：什么触发了变化、这个判断适用于哪里、谁确认采用、下次何时应被带回，以及后来它被事实支持、限制还是撤回。

Codex、Claude、Cursor、ChatGPT、项目工作、知乎和团队讨论是思考真正发生的现场；Trace 不重造一个聊天窗口，也不试图自动接管一切。它负责让其中值得进入未来的认知变化，拥有清晰、可审阅、可验证的生命周期。

## Trace 的核心循环

```text
真实工作与 Agent 协作
  → 出现线索、误解、失败、外部前例或新的连接
  → 澄清为「理解改变」的候选
  → 用户讨论、确认采用或拒绝
  → 成为有范围的长期判断
  → 编译为能力 / 激活策略
  → 在下一次相关工作中被带回
  → 由结果验证：supported / limited / revoked
```

一条候选判断至少应能回答：

| 要素 | Trace 关心的问题 |
|---|---|
| Before | 原来怎样理解、怎样行动？ |
| Trigger | 哪个工作现场、失败、对话或来源促成了变化？ |
| After | 现在准备如何理解或行动？ |
| Scope | 它适用于什么，不适用于什么？ |
| Adoption | 这只是 Agent 的候选，还是用户 / 团队已确认的判断？ |
| Activation | 下一次什么场景应该把它带回来？ |
| Validation | 后续什么结果会支持、限制或推翻它？ |

**Capture 只是入口。** Trace 的价值在于：候选被人采用后，能在未来真正改变 prompt、计划、代码、验收标准、产品表达或决策方式；并且这个影响还可以被继续验证和修正。

## Trace 不是什么

| 容易被误解为 | Trace 与它的区别 |
|---|---|
| 知识库 / 笔记系统 | 内容是证据或来源；Trace 管理的是理解变化的生命周期。 |
| AI memory / RAG | 它们负责记忆或召回；Trace 只让已确认、仍适用的判断进入未来行动。 |
| prompt 管理器 | prompt、Skill、Rule、MCP context 都可能是发布格式，不是核心对象。 |
| 聊天记录器 | 对话是 provenance，不自动等于长期认知状态。 |
| 自动自我改进 Agent | Agent 可以提出、执行、验证；人或团队保留判断采用与能力发布的权利。 |

因此，Trace 的目标不是让 Agent “记得更多”，而是让**人、团队与 Agent 在多次协作中共同演化，而不把未经确认的内容、旧结论或偶然上下文当成真理。**

## 谁看见什么、谁做决定

Trace 是人参与的协作系统，不是静默后台。

用户应持续看见：

- 当前工作线与尚未解决的问题；
- Agent 引用了哪些已授权来源；
- 出现了哪些候选、为什么值得讨论、其建议作用域和风险；
- 哪些内容已保存、尚未保存、已采用、已发布或已被替代；
- 下一步可以如何继续讨论、验证、采用或拒绝。

用户默认**不需要**看见或填写：SQLite 表、lineage、`correlation_id`、工具参数、凭证、完整来源正文或隐藏推理。它们由 Trace 的协议与审计层保护；需要审计时才按权限查看。

Agent 可以提出候选、生成摘要、携带受控引用和执行验证；它不能静默把一个 prompt、外部页面、对话结论或个人观察写成已采用判断，更不能自动替换用户的能力或规则。

## 当前 Codex-first 版本已经提供什么

Trace 当前先服务于长期使用 Codex 的个人与团队。每个项目有独立的 `.trace/` 状态边界，避免不同项目、认知源和会话相互污染。

已实现的基础能力包括：

- 为冷启动用户提供一份**可查看、可替换、不会伪造熟悉感**的协作模型：它把“先接住未完成的思考、避免默认问卷、友好但不盲从、明确执行即执行、证据与沉淀分层”做成通用 starter，而不复制任何个人历史；个人/项目适配则由显式版本化的协作模型与认知源地图完成；
- 为 Codex 提供 `trace-codex` Plugin：`$trace`、`$trace-adapt` 和 `$trace-review` 用自然语言引导用户，标准 MCP 负责读取状态、生成提案和执行已采用的变更；它不通过 shell 拼接 CLI，也不要求用户填写 JSON；
- 为 Codex 提供受控的认知源 access lease：Trace 只给正式来源根、前缀、预算与隐私规则；**Codex 自己**用原生搜索/读取工具决定和执行检索。Trace 不再用词法算法预选页面；用户级 hook 按每次事件的 cwd 路由到对应项目，不会被最后一次启用的项目绑死；
- 把 prompt 和外部材料先做成可见候选；raw prompt 不会静默写入状态库；
- 让用户明确选择保存摘要、脱敏片段或完整私有案例；
- 让知乎等外部来源先成为带相似性、差异和风险的候选前例，而非自动真理；
- 将候选前例与能力候选、来源、版本和验证证据连成可追溯链；
- 记录 activation / persistence receipt 与 host retrieval evidence，让用户知道来源是“已提供、已检索、已读取还是未分类访问”，以及哪些内容没有沉淀；状态库只保存相对 locator、revision/hash 和事件 hash，不保存绝对路径、来源正文、prompt 或工具参数；
- 通过 `doctor`、backup、restore、revision、hash 与 lineage 保证数据可核验、可恢复；
- 用 hook 回放验证真实的 Codex `UserPromptSubmit` / `PreToolUse` / `PostToolUse` 路径、项目 cwd 路由、读取预算和 privacy boundary；评估清单只衡量 evidence coverage，不把“测试通过”或 fixture 回放冒充为模型效果结论。

> 当前版本已经打好候选、来源、接续、审计与发布治理的底座；完整的「判断采用 → 激活 → 验证 / 限制 / 撤回」用户工作流仍在持续产品化。Trace 不会把尚未完成的 UI 或宿主适配伪装成已实现能力。

## 3 分钟开始

### 推荐：在 Codex 中使用

安装 Trace runtime 后，首次把它连接到 Codex（只需一次）：

```powershell
node <TRACE_RUNTIME>\native\install-codex-plugin.mjs --dry-run
node <TRACE_RUNTIME>\native\install-codex-plugin.mjs --confirm true
```

第二条命令只会在你确认后创建一个受管理的本地 Codex plugin marketplace，并让 Codex 安装 `trace-codex`。它**不会**初始化、升级或改写任何项目，也不会启用 hooks。之后在你想使用的项目里直接对 Codex 说：

```text
$trace 帮我开始这个项目的 Trace，并告诉我你会保存什么、不会保存什么。
```

Trace 会先给出可见提案；你说“采用/确认”后才创建项目本地 `.trace/`。日常可直接说：`$trace 我现在的协作方式是什么？`、`$trace-adapt 我希望你更适配我的工作方式`、`$trace-review 看看有哪些内容等我决定`。详细安装、权限与版本行为见 [Trace Codex Plugin](docs/codex-plugin.md)。

### CLI 是恢复与自动化入口

CLI 仍然存在，面向脚本、诊断、备份和没有 Plugin 的环境，而不是日常协作界面：

```powershell
trace status
trace upgrade      # 只读检查 runtime 与本项目的版本/迁移状态
trace doctor
trace backup create
```

从源码仓库开发时使用 `corepack pnpm exec trace <command>`；发行包安装后的 Windows launcher 同时提供 `trace` 与兼容名称 `trace-runtime`。已有 CLI 项目不会因为安装 Plugin 或升级 runtime 自动被改写。

## 当 Plugin 暂不可用：CLI 恢复与自动化

不应把下面的命令当成普通用户的每日流程。它们服务于脚本、诊断、备份，或尚未安装 Plugin 的环境：

```powershell
trace status
trace upgrade      # 只读检查 runtime 与项目 lock 的差异
trace doctor
trace backup create
```

`trace inbox`、`trace review`、`trace sources`、`trace profile` 与 `trace abilities` 仍可作为 CLI 回退入口；在 Codex 中优先让 `$trace` / `$trace-review` 将相同状态翻译成用户能审阅的提案、候选与下一步。

一次 prompt 值得留下时，Trace 仍先创建不含正文的候选。完整案例必须由用户后续明确选择 `summary`、`redacted_excerpt` 或 `full_private`，随后才进入 `source_snapshot → candidate_precedent`；保存案例不等于发布能力。

## 保持可恢复、可审计

```powershell
trace doctor
trace backup create
trace backup restore --file <备份文件绝对路径> --replace
```

`doctor` 检查项目状态链路；backup / restore 都包含完整性校验与 staging 验证。默认输出仍保持安全：不会显示 raw prompt、完整来源正文、凭证或工具参数。

## 文档

- [第一次使用](docs/getting-started.md)
- [日常协作、认知变化与沉淀](docs/daily-workflow.md)
- [维护、备份与恢复](docs/operations.md)
- [产品边界与架构](docs/architecture.md)
- [版本、协议与发布](docs/versioning.md)
- [Codex 原生检索与 Trace 证据架构](docs/host-native-retrieval.md)
- [Trace Codex Plugin：日常入口、MCP 与一次性安装](docs/codex-plugin.md)
- [让 Agent 逐步适配使用者](docs/personalization.md)
- [效果评估 fixtures 与边界](tests/evals/README.md)
- [完整文档导航](docs/README.md)

## 高级接口

协议、连接器和宿主自动化有稳定接口，但它们不属于默认用户入口：

```powershell
trace --help --advanced
```

`trace internal ...` 给 Codex hooks、SDK 与宿主调用；旧的低层 TypeScript 命令在迁移期间保持兼容。它们需要显式状态文件、版本和 lineage 参数，不应用于日常产品使用。
