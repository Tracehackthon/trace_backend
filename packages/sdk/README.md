# Trace SDK

SDK 是跨进程边界，不是第二套 runtime：`protocol/` 定义 wire contract，`server/` 暴露 TypeScript runtime 的 JSONL RPC，`typescript/` 是调用方客户端，Python client 位于仓库根的 `python/sdk/`。

SDK 可以读取/操作 Change Set、Data Ledger、Continuity、receipt 和显式 prompt-case proposal / capture，供宿主或未来桌面端显示用户可见状态；它不允许调用方直接读取 SQLite、绕开 CAS，或把完整聊天 / prompt 自动写入 Trace。

日常 Codex 用户无需配置 SDK，应使用 `$trace`。新宿主应优先复用 application service / MCP 的产品语义，只有明确的跨进程集成才使用此 JSONL RPC。
