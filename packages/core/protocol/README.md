# protocol/

协议包是所有入口共享的唯一字段定义来源。JSONL、CLI、TS SDK、Python SDK 和未来 native launcher 都只能消费它，不各自复制字段或状态机。

`ProtocolVersionRegistry` 只接受定向、逐版本 upcaster。当前已覆盖 Change Set、Data Envelope、Context、Continuity、runtime event、template、plugin、capability content/publish 与 capability candidate 的 `0.1.0 → 0.2.0` 路径。upcast 只创建内存视图，持久化重写必须由业务更新或独立 migration receipt 触发；未知/断链版本返回 `PROTOCOL_MIGRATION_REQUIRED`。
