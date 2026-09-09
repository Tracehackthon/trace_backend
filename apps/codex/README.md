# Codex adapter

Codex adapter 把受控的 Codex hook/MCP 事件映射成 Trace 的 Activation Pack、回执和候选。它不修改 core 状态机，也不会把宿主授权推断为 Trace 的能力采纳。

## 正常用户接入

在项目根目录运行：

```powershell
trace init
trace codex enable --dry-run
trace codex enable
trace codex status
```

第一次 `init` 创建项目本地 `.trace/`；`codex enable` 会为当前项目配置 hooks，保留原 hooks 配置备份，并保存可回滚回执。`--dry-run` 只展示计划，不写用户配置。

之后每次 Codex 会话开始时，adapter 只注入来源引用、读取指针、预算和禁止范围。它不会把完整认知源正文、原始 prompt、工具参数或凭证塞进 Activation Pack。用户通过 `trace status`、`trace inbox` 和 `trace review <ID>` 查看触发结果及待确认沉淀。

## 宿主和集成维护者

`trace codex enable` 实际安装的 hook 使用 `trace internal codex hook-stdio --project-dir <PROJECT_DIR>`。这个入口给 hooks、SDK 和宿主自动化使用；它保留显式事件契约、source profile 和状态库参数，但不属于日常用户命令。

若要在隔离环境中手动回放事件，可使用高级命令：

```powershell
trace --help --advanced
trace internal codex trigger `
  --sqlite-state-file <PROJECT_DIR>/.trace/state/trace.sqlite `
  --event-file <CODEX_TURN_EVENT_JSON>
```

事件必须明确声明 `codex.turn.started`、目的、摘要和来源引用。`codex trigger` 只产生 Activation Pack 和用户可见 activation receipt，不发布能力，也不把来源全文注入宿主。

任何新 hook/MCP host 都必须保持同样边界：只读取授权 source profile 与版本化引用；项目认知源位于 `<PROJECT_DIR>/.trace/source/wiki/`，外部个人/团队认知源由 profile 指向正式页面；正式页写入仍走 proposal + explicit approval + revision/hash CAS + backup + atomic write。
