# storage/

存储包只负责可审计的 append-only JSONL/SQLite、最新 revision 投影、CAS、revision gap 和冲突 duplicate 检查。数据文件路径由运行时/调用方注入；不在源码中写死用户目录或仓库路径。SQLite 产品模式按逻辑表隔离 change/data/continuity，并使用事务保护写入。领域必填字段和 lineage 校验由 `core/data`/`core/protocol` 负责。

