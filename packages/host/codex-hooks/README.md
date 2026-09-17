# `@trace/host-codex-hooks`

Codex hooks 安装器以 preview、明确采用、backup、hash CAS 和 rollback receipt 管理用户级 `hooks.json`。安装的入口不绑定某个项目路径：每次 hook 事件按 cwd 查找最近的 `.trace/`，因此多个项目共享同一份用户 hooks 时仍保持 profile 与 SQLite 隔离。

用户不需要手动编辑 `hooks.json`。日常在 Codex 中说 `$trace 在 Codex 中启用接续`；Trace 先展示影响和备份，再在明确 adopt 后调用本安装器。安装/更新 Plugin 本身不会启用 hooks。

## 生命周期 hook

默认安装的受管事件为 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`、`Interrupt`、`SessionEnd`。其中后面三个只负责把 Codex 官方生命周期边界交给宿主适配器；它们不会单独打开捕获，也不会在没有用户明确附着时保存 prompt 或 assistant message。

Host Session Ingest 的附着策略由 Product Workspace 持有：只有明确调用 attach 后，`UserPromptSubmit` 才能保存用户输入，`Stop` 才能保存 `last_assistant_message`。pause 会让后续事件成为成功 no-op，detach 或 `SessionEnd` 会封口会话和未完成 turn。没有 `.trace/` 的 cwd 仍可在**已附着**会话下进入用户级 `web.sqlite`，但运行 hook 的 Codex 环境必须与 Product Service 共享同一个绝对 `TRACE_WEB_STATE_FILE`；未配置服务或变量时仍返回安全 no-op。未附着 hook 不创建数据库、不写入 project `trace.sqlite`。
