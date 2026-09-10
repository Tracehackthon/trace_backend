# Protocol

协议包是所有产品入口共享的唯一字段与状态定义来源。MCP、CLI、TS SDK、Python SDK、Codex hooks 和未来桌面端只能消费它，不能各自复制字段或自行解释版本。

`ProtocolVersionRegistry` 只接受定向、逐版本的 in-memory upcaster；持久化重写必须由业务更新或专用 migration receipt 触发。未知版本、断链升级或 hash 漂移一律 fail-closed，并以 `PROTOCOL_MIGRATION_REQUIRED` 暴露给产品层。

用户不需要理解 protocol number；用户应该看见的是“项目使用哪一版、是否仍可读、是否存在可审阅迁移”。产品版本、workspace 包版本与数据协议版本是独立身份，完整规则见[版本、协议与发布](../../../docs/versioning.md)。
