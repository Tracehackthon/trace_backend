# 第一次使用 Trace

## 你会得到什么

在项目中运行 `trace init` 后，Trace 创建一个本地 `.trace/` 边界：

```text
.trace/
├─ project.json       # 项目与模板身份，不保存外部来源绝对路径
├─ source/wiki/       # local 模式下的项目认知源
├─ state/trace.sqlite # 本项目的运行状态
├─ receipts/          # 用户可查看的启用、沉淀与发布回执
├─ candidates/        # 候选产物目录
└─ backups/           # 状态和来源操作备份
```

它不复制你的个人 Wiki，不会隐式读取外部目录，也不会让另一个项目共享状态。

## 初始化

进入项目目录：

```powershell
trace init
```

默认创建：

- `trace.codex-starter` 冷启动模板；
- `local` 项目认知源；
- 项目级 SQLite 状态库；
- 尚未启用的 Codex 接续。

需要明确选择来源时：

```powershell
trace init --source empty
trace init --source external --source-profile <来源配置绝对路径>
trace init --source team --source-profile <团队来源配置绝对路径>
```

外部 / 团队 profile 是用户本地配置；项目 descriptor 只保存其身份与 hash，不把外部 root 写进可提交的项目记录。

## 启用 Codex

先预览：

```powershell
trace codex enable --dry-run
```

确认后：

```powershell
trace codex enable
```

Trace 只添加自己管理的 `SessionStart` 与 `UserPromptSubmit` hook，保留其他 hook，并把旧配置备份与本次 receipt 放入可追溯位置。

接着执行：

```powershell
trace status
```

如果看到“Codex：尚未启用”或“待确认沉淀：0”，这不是错误：前者表示尚未执行 enable，后者表示尚未出现需要你判断的候选。