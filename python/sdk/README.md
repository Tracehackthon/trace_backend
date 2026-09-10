# Trace Python SDK

Python SDK 是 TypeScript runtime 的薄 JSONL RPC 客户端，不复制领域逻辑，也不是旧 Python runtime 的延续。调用方显式提供 runtime 命令、状态文件和环境配置；SDK 不读取默认用户目录、不导入 TS 源码，也不绕过 schema、CAS 或状态机校验。

```python
from trace_runtime_sdk import TraceRuntime

with TraceRuntime(
    ["node", "<runtime>/dist/packages/sdk/server/src/main.js", "--sqlite-state-file", "<trace-db>"],
) as trace:
    changes = trace.list_changes()
    records = trace.list_data()
```

普通 Codex 用户不需要调用这个 SDK，应使用 `$trace`。Python 适合自动化、集成测试或已有 Python 宿主；产品状态仍应由 TypeScript runtime 统一裁决。
