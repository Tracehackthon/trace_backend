# Trace

Trace 是给长期使用 Codex 的个人与团队准备的项目认知底座：它让你看见 Agent 参考了什么、发现了什么值得沉淀、哪些候选等待你决定，以及哪些经验已经成为可复用能力。

Trace 不会把完整对话、raw prompt、工具参数或个人认知源自动打包、自动发布或静默写入。沉淀始终经过**候选 → 你的选择 → 可验证记录 → 前例 / 能力**。

## 3 分钟开始

安装 Trace 后，在你的项目目录中执行：

```powershell
trace init
trace codex enable
trace status
```

`trace init` 会创建项目本地 `.trace/`：状态、候选、回执、备份和项目认知源都在这里。它不复制其他用户的 Wiki，也不会自动连接外部来源。

`trace codex enable` 为当前项目配置 Codex 接续，并保留原 hooks 配置备份。先只看计划可运行：

```powershell
trace codex enable --dry-run
```

> 从源码仓库开发时，使用 `corepack pnpm exec trace <command>`；发行包安装后的 Windows launcher 同时提供 `trace` 与 `trace-runtime`。

## 日常使用

```powershell
trace status       # 当前项目、来源、待确认候选、能力概览
trace inbox        # Agent 发现、但仍等待你决定的内容
trace review <ID>  # 查看一个候选的来源、理由、状态和下一步
trace sources      # 查看当前项目已授权的认知源
trace abilities    # 查看候选能力
```

当一条 prompt 值得留下，Codex 或自动化会先创建一个**不含正文**的候选。你在 `trace inbox` 中看见它，再通过：

```powershell
trace review <ID> --save <绝对内容文件路径>
```

确认你选择保存的内容。保存方式由候选指定为 `summary`、`redacted_excerpt` 或 `full_private`；只有 `full_private` 才会保存完整私有 prompt，并且必须与最初的 transient hash 匹配。

## 数据是否由我掌控？

是。用户需要看见的是主题、来源、候选状态、保存方式、证据数量、能力状态和下一步；Trace 不会默认展示或要求你填写协议字段、SQLite 表名、`lineage`、`correlation_id` 或 `source_ref` JSON。

```powershell
trace doctor
trace backup create
trace backup restore --file <备份文件绝对路径> --replace
```

`doctor` 检查项目状态链路；backup / restore 均带完整性校验和恢复前 staging 验证。

## 文档

- [第一次使用](docs/getting-started.md)
- [日常协作与沉淀](docs/daily-workflow.md)
- [维护、备份与恢复](docs/operations.md)
- [产品边界与架构](docs/architecture.md)
- [完整文档导航](docs/README.md)

## 高级接口

Trace 的协议、连接器和宿主自动化仍有稳定接口，但它们不属于默认用户入口：

```powershell
trace --help --advanced
```

`trace internal ...` 给 Codex hooks、SDK 与宿主调用；旧的低层命令在迁移期间保持兼容。它们需要显式状态文件、版本和 lineage 参数，不应用于日常产品使用。