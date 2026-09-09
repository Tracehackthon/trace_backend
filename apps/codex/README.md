# Codex adapter

Codex adapter 只处理 Codex hook/MCP 事件、Activation Pack 输入以及宿主能力发现/审批/执行状态映射。它不会修改 core 状态机，也不会把宿主授权推断为 Trace 的能力采纳。

## 第一次接入

先为项目建立 `.trace/`，再把项目状态库接给 Codex：

```powershell
node <RUNTIME_DIR>/dist/apps/cli/src/main.js project init `
  --project-dir <PROJECT_DIR> `
  --user-id <USER_ID> `
  --template trace.codex-starter `
  --source-mode local `
  --confirm true

node <RUNTIME_DIR>/dist/apps/cli/src/main.js codex trigger `
  --sqlite-state-file <PROJECT_DIR>/.trace/state/trace.sqlite `
  --event-file <CODEX_TURN_EVENT_JSON>
```

`codex trigger` 只产生 Activation Pack 和用户可见 activation receipt，不发布能力，也不把来源全文注入宿主。事件必须明确声明 `codex.turn.started`、目的、摘要和来源引用。

## Hook 触发

正式安装前先预览命令；安装器会原子替换、备份旧配置并产生 rollback receipt：

```powershell
node <RUNTIME_DIR>/dist/apps/cli/src/main.js hooks preview `
  --hooks-file <CODEX_HOOKS_FILE> `
  --command "node <RUNTIME_DIR>/dist/apps/cli/src/main.js codex hook-stdio --sqlite-state-file <PROJECT_DIR>/.trace/state/trace.sqlite --source-profile <PROJECT_DIR>/.trace/profiles/source.profile.json"
```

Codex hook/MCP 输入只读取授权的 source profile 和版本化引用；项目认知源位于 `<PROJECT_DIR>/.trace/source/wiki/`，外部个人/团队认知源则仍由 profile 指向其正式页面。用户可以看到 activation receipt、候选引用和未沉淀清单，但 Trace 不会假装把完整对话自动写入认知源。
