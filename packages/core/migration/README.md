# Trace Migration

此包提供旧 JSONL 状态到 SQLite 的可验证迁移。它只读取源文件，先校验协议、revision 连续性和 hash，在同目录写 staging 数据库并验证后原子替换目标；旧 JSONL 始终保留为回滚证据。

这是一条历史兼容/恢复路径，不是当前日常 runtime 的双写链路。新项目使用 SQLite；产品升级、模板更新和 profile 变更必须走各自的显式 proposal、backup 与 receipt，不能借“迁移”名义静默覆盖用户项目。
