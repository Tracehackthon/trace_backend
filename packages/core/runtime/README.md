# Runtime

Runtime 组合 Change Set、Data Ledger、Continuity、案例 capture 与 storage，并暴露稳定应用接口。产品模式将逻辑表隔离在项目 SQLite 中；兼容/开发路径可使用分离 JSONL，但当前 active runtime 不再调用旧 Python runtime。

Runtime 不决定 Codex 怎样搜索、审批或推理，也不生成提示词全文。raw prompt 只在 transient 阶段用于生成 hash-only proposal；只有用户明确 capture 后的选定内容才能成为 source snapshot。

Plugin/MCP 与 CLI 应通过 `@trace/product-application` 或 SDK 访问 runtime，而不要复制状态机或直接写数据库。
