# Trace × Codex：协作接续与来源 evidence

Codex 是 Trace 当前的第一个真实产品宿主。用户在 Codex 中使用 `$trace` 看见项目协作状态、候选、来源边界与升级选择；Codex 保留判断是否需要来源、搜索文件、读取文件、调用工具、推理和交付。Trace 只负责将这些工作放进可治理、可追溯、用户可见的长期协作链路。

> Trace 不再根据用户 prompt 用自己的 lexical provider 预选页面或把页面指针当作“Agent 已读”。

## 用户接入

日常入口是 Codex 中的 `$trace`，而不是要求用户了解 hook、SQLite 或 CLI 参数：

```text
$trace 帮我开始这个项目。
$trace 在 Codex 中启用接续。
$trace 现在的来源使用状态是什么？
```

`$trace` 会先展示项目边界与 hook proposal；用户明确采用后，MCP 才调用同一套安装器更新用户级 `hooks.json`。CLI `trace codex enable --dry-run` / `trace codex enable` 是无 Plugin 场景下的等价运维回退。安装的是不绑定任何项目路径的入口：

```text
Codex event cwd
  → nearest .trace/project.json
  → this project source.profile.json + state.sqlite
  → Trace source lease / evidence handler
```

所以项目 A、B 可共用用户级 hooks，仍各自使用自己的 profile 和 SQLite。没有 `.trace/` 的项目得到成功 `{}` no-op，不会创建状态或读取其他项目来源。

## 四个 hook 事件

| 事件 | Trace 的行为 | Codex 的行为 |
|---|---|---|
| `SessionStart` | 根据 cwd 找项目，可提供 source lease | 获得当前项目的协作边界 |
| `UserPromptSubmit` | 提供 formal source root、prefix、预算和隐私约束；不持久化 prompt | 决定是否需要并怎样使用来源 |
| `PreToolUse` | 对可识别的 formal Markdown native read 检查单轮预算 | 工具调用仍由 Codex 发起；超过预算的可识别读会被拒绝 |
| `PostToolUse` | 观察实际 native tool 访问，写入安全 evidence | 保持原始工具结果和推理控制权 |

安装器为 `PreToolUse` / `PostToolUse` 使用 `matcher: "*"`，让 Bash、MCP 及其他本地函数工具都可进入同一观察路径；handler 只有在当前项目的正式来源根被触及时才写状态。

## 原生检索，不是预选指针

当 source profile 启用 `host_retrieval.mode: "native_observed"` 时，hook 给当前 Codex 进程一个短暂 source lease：

```json
{
  "source_id": "my-cognitive-source",
  "mode": "native_observed",
  "allowed_roots": ["<current-host-only>/wiki"],
  "allowed_prefixes": ["wiki"],
  "max_reads_per_turn": 8,
  "evidence_contract": "trace.host-retrieval-evidence@0.1.0"
}
```

绝对 `allowed_roots` 只出现在本次 hook 的开发者上下文中，永不写入 SQLite。Codex 可用自己的 Bash、本地函数或 MCP 工具检索和读取这些正式页；Trace 不注入全文、不替它挑选两页、不替它声称“已经理解”。

`PostToolUse` 后的 Data Ledger evidence 有四种状态：

- `source_access_offered`：本轮给 Codex 提供了来源入口；
- `source_search`：Codex 确实搜索过该来源；
- `source_read`：Codex 实际读到某些相对页，Trace 核验并保存 locator + revision/hash；
- `source_access_unclassified`：检测到来源访问但不能可靠分类，绝不冒充已读。

用户通过 `$trace` 查看这些状态；`trace sources` 或 `trace status` 只保留为 CLI 回退。默认不显示 prompt、页面正文、绝对路径、工具参数或工具输出。

## profile 和边界

```json
{
  "read_enabled": true,
  "write_enabled": false,
  "host_retrieval": {
    "mode": "native_observed",
    "allowed_prefixes": ["wiki"],
    "max_reads_per_turn": 8
  }
}
```

`native_observed` 是**可观测、可预算**边界，不是文件系统 ACL。Codex 官方 hook 覆盖 Bash、MCP 和多数本地函数工具，但不是所有专用工具路径；需要硬 per-file 隔离的来源不得暴露给此模式，应设为 `disabled` 并等待具备真实权限契约的 brokered adapter。[官方 Codex Hooks 文档](https://learn.chatgpt.com/zh-Hans/docs/hooks)

`activation_excluded_paths` 只保留给旧式显式来源搜索的候选过滤；它不能用于宣称 native host 不会访问某个文件。这样避免把旧的“自动 activation”语义误当作安全控制。

## Plugin 更新与维护者接口

安装或更新 `trace-codex` Plugin 不会启用 hooks，也不会迁移任何项目。hooks 仍需单独 proposal → 用户采用 → 备份/receipt；旧项目仍按当前 cwd 找到自己的 `.trace/`。

## 维护者接口

实际 hook command：

```text
trace internal codex hook-stdio --route-from-event-cwd
```

此入口供 hooks、SDK 和宿主自动化使用，不是日常用户命令。它的输入是官方 Codex hook JSON；输出从不回显 raw prompt 或 tool body。实现与协议细节见：[Codex 原生检索与 Trace 证据架构](../../docs/host-native-retrieval.md)。

任何未来的 host adapter 都要保留同样的责任切分：host 拥有检索、推理和执行；Trace 拥有授权来源边界、provenance evidence、候选/采用/发布和用户回执。正式页写入继续走 proposal → explicit approval → revision/hash CAS → backup → atomic write。
