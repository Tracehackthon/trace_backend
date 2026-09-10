# `@trace/plugin-contract`

宿主无关的 Plugin 契约：插件身份、宿主兼容性、权限、schema 声明与生命周期。它不持有 Trace 领域状态，也不把 Codex、DeepSeek Harness 或 desktop 的私有实现塞进 core。

当前 `codex` 是真实宿主；`deepseek-harness` 与 `desktop` 仍是未实现边界。`trace.plugin` descriptor 只允许显式、可验证的 in-memory upcast；未知版本 fail-closed。插件可以注册 schema、来源 adapter 或 runtime observer，但数据写入仍须经过 `@trace/data` / runtime 的验证、lineage 与 adoption 规则。

Plugin 目录或 manifest 的存在不代表某个宿主已经接入或已对用户启用。
