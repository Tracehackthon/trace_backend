# Trace Templates

模板是冷启动输入，不是用户认知源、聊天记录或人格画像。它把可替换的默认能力、来源路由与协作治理分开，让新用户有一个可用起点，同时不伪造“系统已经理解你”。

## 用户选择方式

在 Codex 中优先说：

```text
$trace 帮我开始这个项目，并说明可选模板和来源边界。
```

Trace 先展示 template / source mode proposal；用户明确 adopt 后才创建项目 `.trace/`。CLI `template list`、`template preview`、`project init` 只保留为自动化或无 Plugin 环境的回退入口。

| 模式 | 用途 | 默认边界 |
|---|---|---|
| `local` | 冷启动或项目自己的认知源 | 在项目内创建空来源目录 |
| `external` | 用户已授权的个人来源 | profile 只保存为本地配置，lock 不含 root |
| `team` | 明确授权的团队来源 | 需要显式团队 profile / 项目副本 |
| `empty` | 不授权任何认知源 | 只安装协议与空上下文 |

可选 starter：`trace.codex-starter`、`trace.codex-empty`、`trace.codex-team`。模板更新只影响以后初始化的新项目；已有项目必须有独立 preview、三方 diff 和 adoption，当前不自动合并。
