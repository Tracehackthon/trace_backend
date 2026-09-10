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

Trace 添加自己管理的 `SessionStart`、`UserPromptSubmit`、`PreToolUse` 和 `PostToolUse` hook，保留其他 hook，并把旧配置备份与本次 receipt 放入可追溯位置。`hooks.json` 虽然是用户级配置，但安装的是一个不绑定项目路径的路由入口：每次 Codex 事件都用自己的 `cwd` 向上找到最近的 `.trace/`。因此在项目 A、B 都执行 enable 后，A 只会使用 A 的状态和来源，B 也只会使用 B 的。

Trace 不会先替 Codex 挑两个页面。它只把当前项目已授权的 formal source root、范围与单轮读取预算交给 Codex；Codex 用自己的原生搜索/读取工具完成工作。随后 Trace 记录安全 evidence，区分“来源已提供 / 已搜索 / 已读取 / 未分类访问”。

接着执行：

```powershell
trace status
```

如果看到“Codex：尚未启用”或“待确认沉淀：0”，这不是错误：前者表示尚未执行 enable，后者表示尚未出现需要你判断的候选。开始一次 Codex 协作后，`trace status` 显示最近一次 activation 的安全回执和宿主来源实际使用计数；`trace sources` 显示相对 locator、revision/hash 层面的搜索/读取证据。二者都不会显示 raw prompt、来源正文、绝对路径或工具参数。
