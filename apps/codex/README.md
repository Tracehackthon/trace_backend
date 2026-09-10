# Codex adapter

Codex adapter 把受控的 Codex hook 事件映射成 Trace 的 Activation Pack、activation receipt 和候选入口。它不修改 core 状态机，也不会把宿主授权推断为 Trace 的能力采纳。

## 正常用户接入

在项目根目录运行：

```powershell
trace init
trace codex enable --dry-run
trace codex enable
trace codex status
```

第一次 `init` 创建项目本地 `.trace/`；`codex enable` 会更新用户级 `hooks.json`，保留原配置备份并保存可回滚 receipt。`--dry-run` 只展示计划，不写用户配置。

### 多项目不会串线

`hooks.json` 是用户级的，但 Trace 写入的命令**不带固定 `--project-dir`**。每次 `SessionStart` / `UserPromptSubmit` 事件会用事件自己的绝对 `cwd` 向上寻找最近的 `.trace/project.json`：

```text
Codex event cwd
  → nearest .trace/project.json
  → this project state.sqlite + source.profile.json
  → bounded activation output
```

所以在项目 A、项目 B 都启用 Trace 后，A 只读取 A 的 profile 和 SQLite，B 只读取 B 的 profile 和 SQLite。没有 `.trace/` 的普通项目会得到成功的 `{}` no-op：不创建 Trace 状态，也不会拿到别的项目来源。旧版固定项目 hook 会被 `trace codex status` 标为“需要升级”；重新执行 `trace codex enable` 即可替换为 cwd 路由。

## 指针模式与可见性

外部或本地来源 profile 会在对应项目 hook 中自动读取。对匹配当前 prompt 的正式页，adapter 返回给**当前 Codex 进程**：

- `read_pointers`：绝对路径、用途、优先级、停止条件；Codex 按需读取，不应全量加载。
- `pages_considered`：相对路径、标题、content hash、内容 revision。

Trace 不会把完整认知源正文、原始 prompt、工具参数或凭证塞进 Activation Pack，也不会因为找到了页面就创建 `source_snapshot`。它只在项目 SQLite 的 activation receipt 中保存安全身份：`source_id`、相对 `locator`、`revision`、`content_hash`、用途与停止条件。绝对路径和正文不持久化。

用户可以用 `trace status` 看到最近一次 activation 的持久化引用、读取指针和未自动保存内容；用 `trace inbox` / `trace review <ID>` 决定是否让真实协作结果进入候选沉淀。

## 宿主和集成维护者

实际安装命令是：

```text
trace internal codex hook-stdio --route-from-event-cwd
```

这个入口给 hooks、SDK 和宿主自动化使用；它不属于日常用户命令。若要在隔离环境中手动回放事件，可使用高级命令：

```powershell
trace --help --advanced
trace internal codex trigger `
  --sqlite-state-file <PROJECT_DIR>/.trace/state/trace.sqlite `
  --event-file <CODEX_TURN_EVENT_JSON>
```

事件必须明确声明 `codex.turn.started`、目的、摘要和来源引用。`codex trigger` 只产生 Activation Pack 和用户可见 activation receipt，不发布能力，也不把来源全文注入宿主。

任何新 hook/MCP host 都必须保持同样边界：只读取授权 source profile 与版本化引用；项目认知源位于 `<PROJECT_DIR>/.trace/source/wiki/`，外部个人/团队认知源由 profile 指向正式页面；正式页写入仍走 proposal + explicit approval + revision/hash CAS + backup + atomic write。
