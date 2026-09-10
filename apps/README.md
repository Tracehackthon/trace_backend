# apps/

`apps/` 只做**产品入口或宿主边界适配**，不承载领域判断。协议、状态机和存储位于 `packages/`，不依赖某个宿主。

## 用户从哪里开始

日常 Codex 用户从 `trace-codex` Plugin 的 `$trace` 开始；它通过本地 MCP 显示状态、提案与回执，不要求用户填写 CLI 参数。CLI 是脚本、恢复与无 Plugin 环境的后备入口：

```powershell
trace init
trace codex enable
trace status
trace inbox
```

它会把项目状态放在 `<项目>/.trace/`，不会要求用户理解 SQLite、protocol version、lineage 或内部 JSON 参数。完整说明见根目录 [README](../README.md)。

## 目录职责

- `mcp/`：标准 stdio MCP server。直接调用 product application service，不 shell-out 到 CLI；所有写操作都走 proposal + explicit adoption；
- `cli/`：产品 CLI 与维护者的协议命令。默认 `trace` 呈现 init/status/inbox/review/sources/abilities/codex/doctor/backup；内部自动化使用 `trace internal ...`；
- `codex/`：当前 Codex hook adapter，只把受控事件映射到 runtime。原始 prompt 只作 transient lookup，不会自动进入持久化状态；
- SDK server：位于 `packages/sdk/server/`，给 TypeScript/Python SDK 提供 stdio JSONL RPC；
- `desktop/`：**刻意保留、尚未实现**的 desktop shell/main/renderer 边界。没有真实桌面事件协议前，不伪造完成状态；未来只能通过 SDK/RPC 驱动 runtime，不能直接读写 core storage。

产品入口可替换；任何新宿主都必须先定义事件、权限、回放和验收边界，再接入 runtime。
