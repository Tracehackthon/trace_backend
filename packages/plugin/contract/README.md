# `@trace/plugin-contract`

宿主无关的插件契约。它只描述插件身份、宿主兼容性、权限、schema 声明和生命周期，不持有 Trace 领域状态，也不把 DeepSeek Harness/Codex/Desktop 的实现塞进 `core`。

预留宿主：

- `deepseek-harness`：未来的 Harness package/plugin adapter；
- `codex`：当前 Trace 的宿主 adapter；
- `desktop`：未来桌面端 shell/renderer adapter。

插件只能通过 `PluginHost` 注册 schema、来源 adapter 或 runtime observer；数据写入仍然经过 `@trace/data`/runtime 的验证和 lineage 检查。
