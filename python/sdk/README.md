# Trace Python SDK

这是 TS runtime 的薄客户端，不复制领域逻辑。调用方传入完整的 runtime 命令（Node bundle 或未来的 native 可执行文件），产品模式建议使用 SQLite，开发兼容模式也可使用分离 JSONL；SDK 通过 newline-delimited JSON-RPC 调用 Change Set、Data Ledger 和 Continuity。

```python
from trace_runtime_sdk import TraceRuntime

with TraceRuntime(
    ["node", "dist/packages/sdk/server/src/main.js", "--sqlite-state-file", "<absolute-trace-db>"],
) as trace:
    result = trace.list_changes()
    records = trace.list_data()
```

路径、Node、native executable、环境变量和凭证均由调用方显式提供；SDK 不读取默认目录，不导入 TS 源码，也不绕过 runtime 的 schema/CAS/状态机校验。

