# apps/

应用入口只做组合和宿主边界适配，不承载领域判断：

- `cli/`：一次性命令、人工审计和本地脚本；包括 `prompt-case propose|capture|precedent` 的显式案例链；
- SDK server 已归入 `packages/sdk/server/`，给 TypeScript/Python SDK 使用 stdio JSONL RPC 服务；
- `codex/`：当前 Codex hook adapter，只把受控事件映射到 runtime；hook raw prompt 只作 transient source lookup；
- `desktop/`：**刻意保留的** desktop shell/main/renderer 边界。没有真实桌面事件协议前，不伪造实现或完成状态；未来只能通过 SDK/RPC 驱动 runtime，不能直接读写 core storage。

应用入口可替换；`packages/` 中的协议、状态机和存储不依赖具体宿主。
