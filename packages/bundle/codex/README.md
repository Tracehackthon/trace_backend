# Codex bundle

`trace.codex@0.3.0` 声明的是 Codex-first 的组合边界：`core/runtime`、Codex adapter、Continuity/Activation Pack、host retrieval evidence、MyWiKi formal source 与 hooks installer。

它不在 bundle 内复制用户认知源、聊天记录或运行时状态。产品模式使用项目 SQLite；开发兼容模式使用分离 JSONL；冷启动模板必须先 preview，再生成 instance lockfile。

Codex 保留检索、文件读取、工具调用、推理和执行：Trace 在 `UserPromptSubmit` 提供正式来源 lease，在 `PreToolUse` 检查可识别的读取预算，在 `PostToolUse` 保存 `trace.host-retrieval-evidence@0.1.0`。因此 bundle 不再把 MyWiKi lexical search 的预选页面当作 Codex 实际读取。

完整边界与 profile 约定见 [Codex 原生检索与 Trace 证据架构](../../../docs/host-native-retrieval.md)。
