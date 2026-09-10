# 产品入口与宿主边界

`apps/` 放置用户接触到的入口和宿主适配层。它们不拥有领域规则：协议、版本、状态机和 SQLite 语义全部在 `packages/`，因此 Codex、未来桌面端和 SDK 可以共享同一个项目本地 `.trace/`。

## 用户应该从哪里开始

日常 Codex 使用者从 `trace-codex` Plugin 开始，而不是从 CLI 命令列表开始：

```text
$trace 帮我开始这个项目，并说明什么会被保存。
$trace-adapt 我希望你更适配我的协作方式。
$trace-review 看看有哪些候选正在等我决定。
```

Plugin 的 Skill 负责理解意图和解释选择；本地 MCP 负责读取安全摘要、生成 proposal，并且只在用户明确采用后执行变更。完整接入见[Trace Codex Plugin](../docs/codex-plugin.md)。

CLI 仅是恢复、备份、诊断、脚本和无 Plugin 环境的回退入口；它不是面向普通用户的主流程。

## 目录职责

| 目录 | 作用 | 不做什么 |
|---|---|---|
| `mcp/` | 标准 stdio MCP server，将 Codex 的自然语言入口接到 application service | 不保存 raw prompt、来源正文、凭证或工具参数；不 shell-out 拼 CLI |
| `cli/` | 发行包 CLI、运维和兼容入口 | 不定义日常交互产品模型 |
| `codex/` | 将 Codex hook 事件变成 source lease、预算检查与安全 evidence | 不替 Codex 搜索、读取、推理或决定采纳 |
| `desktop/` | 未来桌面工作台的明确宿主边界 | 当前没有伪造的 desktop 实现 |

任何新宿主先定义事件、权限、回放与验收契约，再通过 application service / SDK 接入；不得直接读写 core storage。
