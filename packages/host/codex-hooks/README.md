# `@trace/host-codex-hooks`

Codex hooks 安装器以 preview、明确采用、backup、hash CAS 和 rollback receipt 管理用户级 `hooks.json`。安装的入口不绑定某个项目路径：每次 hook 事件按 cwd 查找最近的 `.trace/`，因此多个项目共享同一份用户 hooks 时仍保持 profile 与 SQLite 隔离。

用户不需要手动编辑 `hooks.json`。日常在 Codex 中说 `$trace 在 Codex 中启用接续`；Trace 先展示影响和备份，再在明确 adopt 后调用本安装器。安装/更新 Plugin 本身不会启用 hooks。
