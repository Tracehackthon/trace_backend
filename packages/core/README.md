# Trace Core

`packages/core/` 是 Trace 的稳定行为内核：协议、数据、版本兼容、连续性、候选、运行时、观测和存储都在这里。它不依赖 Codex、桌面端、知乎或 Python；宿主只能经 runtime、application service 或 SDK 使用它，不能直接修改 SQLite。

用户不会直接配置 core 包。用户看到的是 `$trace` 中的项目状态、候选、采用提案与 receipt；这些视图由 core 的 append-only revision、hash、lineage、CAS 与 fail-closed 协议规则支撑。

| 领域 | 子包 |
|---|---|
| 协议与数据 | `protocol`、`data`、`storage`、`migration` |
| 协作与来源 | `context`、`continuity`、`collaboration-context`、`retrieval-evidence`、`observability` |
| 认知演化 | `change-set`、`case-capture`、`precedent`、`capability-candidate`、`capability` |
| 项目运行 | `instance`、`runtime`、`operations`、`source` |

新字段、状态与迁移必须先落在协议/validator，再由 application service 暴露为产品操作；不要让某个宿主私自复制或扩展 core 语义。
