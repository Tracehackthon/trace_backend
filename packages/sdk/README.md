# packages/sdk/

SDK 是跨进程边界：`protocol/` 定义线协议，`server/` 暴露 TS runtime 的 JSONL RPC，`typescript/` 是调用方客户端。Python SDK 放在仓库根的 `python/sdk/`，与 TypeScript 客户端共享这条 wire contract。除 Change Set/Data Ledger 外，RPC 还提供 continuity thread、discussion turn、persistence/activation receipt，供 Codex 和桌面端显示用户可见连续性。

