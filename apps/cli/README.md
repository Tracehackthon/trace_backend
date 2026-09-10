# Trace CLI

CLI 是 Trace 的恢复、自动化和维护入口，不是 Codex 用户的日常产品界面。日常协作应从 `$trace`、`$trace-adapt` 与 `$trace-review` 开始；它们通过本地 MCP 调用与 CLI 相同的 application/runtime 语义，但不要求用户理解 flag 或内联 JSON。

CLI 适合以下场景：

- Plugin 尚未安装或不可用；
- `doctor`、backup、restore、版本检查；
- CI、脚本、发行和故障恢复；
- 维护者使用 `trace internal ...` 调用 hooks / SDK 协议入口。

面向用户的命令应输出安全、稳定的摘要 JSON，不回显 prompt、来源正文、凭证或工具参数。新日常功能先设计 MCP proposal / adoption UX；CLI 只提供可自动化的等价回退。
