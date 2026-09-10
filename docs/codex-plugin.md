# Trace Codex Plugin

`trace-codex` 是 Trace 的日常入口。它把用户看得见的协作流程放在 Codex 对话里，而不是把 SQLite 文件、绝对路径、JSON 参数和一长串 CLI flag 留给用户。

它由三部分组成：

| 部分 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| Skills：`$trace`、`$trace-adapt`、`$trace-review` | 理解自然语言意图、解释提案、引导下一步 | 静默替用户采用变更 |
| 本地 MCP | 读取项目状态、生成稳定的 proposal、执行已采用的初始化/迁移/适配/hook 变更 | 读取或持久化 raw prompt、来源正文、凭证或工具参数 |
| Trace runtime | `.trace/` 状态、协议、SQLite、回执、备份与 Codex hook 路由 | 取代 Codex 的原生搜索、读取、推理或编码能力 |

因此，Trace 不是第二个 Agent，也不是“给 Codex 塞更多上下文”的插件。Codex 仍自己决定何时搜索、读哪些已授权来源、怎样推理和执行；Trace 让用户看见这些工作在哪个项目发生、哪些候选在等待决定，以及协作方式是否发生过明确变更。

## 一次性连接 Codex

Trace runtime 已安装后，运行：

```powershell
node <TRACE_RUNTIME>\native\install-codex-plugin.mjs --dry-run
node <TRACE_RUNTIME>\native\install-codex-plugin.mjs --confirm true
```

第一条只展示计划。第二条在确认后：

1. 将当前版本的 `trace-codex` Plugin 复制到 Codex 用户目录下的受管理 marketplace；
2. 将该 marketplace 注册给 Codex，并安装 `trace-codex`；
3. 为 MCP 写入当前 Trace runtime 的位置，使 Plugin 不依赖开发者电脑路径。

它**不会**创建 `.trace/`、读取任何认知源、改动已有项目、迁移 profile，或启用 Codex hooks。插件安装与项目状态是两条独立生命周期。

如果只想检查安装方案，请始终先用 `--dry-run`。若更新 Plugin，先在 Codex 里确认当前项目没有未完成的变更，再显式运行相同命令并加入 `--replace`；它会备份旧 managed marketplace，并只刷新 `trace-codex@trace-runtime-local`，不会替任何项目做迁移。

## 用户在 Codex 里怎么说

| 你说的话 | Trace 的行为 | 你需要看见的内容 |
| --- | --- | --- |
| `$trace 帮我开始这个项目` | 检查项目；若尚未初始化，提出创建方案 | 项目边界、starter、来源模式、会创建与不会触碰的内容 |
| `$trace 现在是什么状态？` | 读取状态 | 当前 profile/lock、版本差异、待审阅数量、实际来源 evidence 数量 |
| `$trace-adapt 我希望你更适配我的工作方式` | 先讨论适配含义，再形成 profile proposal | 新增/避免的协作行为、来源边界、仍保持 transient 的信息 |
| `$trace-review 你沉淀了什么？` | 列出待审阅候选 | 候选是什么、为什么仍未采用、下一步由谁决定 |
| `$trace 我升级后需要做什么？` | 只读检查版本与 lock | 哪些项目没有变、哪些变化需要显式采用 |
| `$trace 在 Codex 中启用接续` | 先预览 hooks 配置 | 用户级影响、备份、保留的无关 hooks、按 cwd 路由的范围 |

每一次可能写入状态的动作都遵循：

```text
讨论 / 检查 → 提案（无写入）→ 用户明确采用 → apply → 可见 receipt
```

MCP 的 `approval: adopt:<proposal_id>` 是 Agent 在用户明确采用后传递的完整性令牌；用户无需记忆或输入它。proposal 含有当时的状态指纹，项目/profile/hook 在提案后被其他进程改动时会变成 stale，必须重新展示提案。

## 什么可见，什么不必可见

**始终可见**：当前项目和模板、协作模型/来源地图的名称与版本、是否为旧兼容状态、待审阅数量、实际来源使用的安全 evidence、每次变更的影响与备份/receipt。

**默认不展示，也不会通用入库**：raw prompt、完整来源正文、外部来源 root、凭证、工具参数、SQLite 表、lineage/correlation ID 与隐藏推理。需要把一次 prompt 变成案例时，仍走显式的 `transient → capture proposal → 用户选择摘要/脱敏片段/完整私有案例 → source_snapshot → precedent` 链路。

## 旧用户与版本变化

安装新版 runtime 或新版 Plugin 不会覆盖任何已有 `.trace/`：

| 旧项目状态 | 它会怎样继续运行 | 用户何时需要决定 |
| --- | --- | --- |
| `locked` | 继续使用自己的本地协作模型、来源地图和 hash lock | 只有想改变协作方式时才采用 profile update |
| `legacy_unlocked` | 使用兼容 starter；状态页明确显示它尚未写入 activation lock | `$trace` 提出 profile migration 后，用户采用才固化当前兼容配置 |
| runtime 版本不同 | 新 runtime 读取并报告差异，不重写 project/template/SQLite | 先检查；专用迁移存在且被采用时才执行 |
| Plugin 更新 | 只更新 Codex 的 Plugin/MCP 入口 | 不等于项目升级，不触发 profile、模板、能力或 hooks 迁移 |

新 starter/template 默认只给**以后初始化的新项目**。现有模板三方合并仍不是已实现能力，因此 Trace 不会把“发现新模板”伪装成“一键安全更新”。完整规则见 [版本、协议与发布](versioning.md)。

## 当 Plugin 不可用时

Trace 的数据底座不依赖 Plugin。CLI 仍提供 `trace status`、`trace upgrade`、`trace doctor`、`trace backup create` 等恢复和自动化入口；它们与 MCP 调用同一套项目 instance、profile lock、runtime 和 storage 语义。日常协作优先 `$trace`，CLI 只在运维、脚本或 Plugin 暂不可用时使用。
