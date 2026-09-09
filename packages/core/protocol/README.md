# protocol/

协议包是所有入口共享的唯一字段定义来源。JSONL、CLI、TS SDK、Python SDK 和未来 native launcher 都只能消费它，不各自复制字段或状态机。

