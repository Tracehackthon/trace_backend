# Trace CLI

CLI 是 Trace 的恢复、自动化和维护入口，不是 Codex 用户的日常产品界面。日常协作应从 `$trace`、`$trace-adapt` 与 `$trace-review` 开始；它们通过本地 MCP 调用与 CLI 相同的 application/runtime 语义，但不要求用户理解 flag 或内联 JSON。

CLI 适合以下场景：

- Plugin 尚未安装或不可用；
- `doctor`、backup、restore、版本检查；
- CI、脚本、发行和故障恢复；
- 维护者使用 `trace internal ...` 调用 hooks / SDK 协议入口。

Host Session 与第三阶段维护入口也在 CLI/MCP 中，但仍保持高级、显式和可回放：`trace-runtime codex host-session attach|pause|detach` 控制接收；`trace-runtime codex sensemaking-worker status|once|drain` 查看或有限排空 job；`repository preflight` / `recovery-preview` / `recovery-reconcile` 处理只读预检与崩溃恢复；PublicationPolicy、CapabilityTrial 与 stage/validate/publish/rollback 均要求 proposal、CAS、用户 approval 和 receipt。它们不会把普通 `$trace` 变成全局捕获、静默切分支或自动发布。

面向用户的命令应输出安全、稳定的摘要 JSON，不回显 prompt、来源正文、凭证或工具参数。新日常功能先设计 MCP proposal / adoption UX；CLI 只提供可自动化的等价回退。
