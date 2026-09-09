# apps/

应用入口只做组合和边界适配，不承载领域判断：

- `cli/`：一次性命令、人工审计和本地脚本；
- SDK server 已归入 `packages/sdk/server/`，给 TypeScript/Python SDK 使用 stdio JSONL RPC 服务；
- `codex/`（下一阶段）：Codex hook/MCP adapter，只负责把宿主事件映射到 runtime contract。
- `desktop/`（预留）：桌面 shell/main/renderer 边界，只通过 SDK/RPC 驱动 runtime，不直接读写 core storage；未来提供工作、审核、诊断、数据管理四种渐进式视图。

应用入口可替换；`packages/` 中的协议、状态机和存储不依赖具体宿主。
