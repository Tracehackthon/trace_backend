# Trace for Codex

`trace-codex` 是 Trace 在 Codex 中的日常入口。用户使用 `$trace` 查看状态、开始项目、检查升级或启用接续；使用 `$trace-adapt` 讨论协作方式；使用 `$trace-review` 查看等待决定的候选。

它由 Skill 与本地 MCP 共同组成：Skill 理解自然语言、解释提案并等待用户决定；MCP 读取安全摘要，且仅在用户明确 adopt 后执行项目初始化、profile 迁移/更新或 hooks 变更。

## Trace 不替代 Codex

Codex 仍自行搜索、读取、推理、调用工具和交付。Trace 不注入来源全文、不预选页面，也不把“提供过来源”伪装成“Agent 已读”；它只管理受控来源 lease、真实访问 evidence、候选与可回放的采用记录。

## 安装与版本

普通用户不手动配置此目录。使用已安装 runtime 的一次性连接器：

```powershell
node <installed-runtime-directory>
ative\install-codex-plugin.mjs --dry-run
node <installed-runtime-directory>
ative\install-codex-plugin.mjs --confirm true
```

该动作只安装/连接 Plugin 和 MCP，不会改动既有 `.trace/`。Plugin 更新也不迁移项目：已 lock 项目继续用自己的 profile；`legacy_unlocked` 项目必须由用户在 `$trace` 中明确采用迁移提案。详见[Trace Codex Plugin](../../docs/codex-plugin.md)。
