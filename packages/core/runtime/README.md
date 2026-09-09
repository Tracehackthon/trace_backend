# runtime/

Runtime 只组合领域服务并暴露稳定的应用接口。它同时持有独立的 Change Set ledger、Data ledger 和可选 Continuity ledger；产品模式允许三者在同一个 SQLite 文件中按逻辑表隔离，开发模式仍可使用分离 JSONL。它不决定 Codex 如何审批、不生成提示词全文，也不把 SDK 或 native 逻辑倒灌进领域包。

