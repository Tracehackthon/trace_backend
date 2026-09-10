# Codex bundle

`trace.codex@0.4.1` 是当前已发布的 Codex-first 组合边界：`core/runtime`、`core/collaboration-context`、项目 instance、Codex adapter、Continuity/Activation Pack、host retrieval evidence、正式认知来源 adapter 与 hooks installer。`trace-codex` Plugin/MCP 已在本源码中以 Changeset 进入下一次 bundle 发行计划；产品 runtime/bundle/profile 的发布身份仍需独立批准，不能把当前 checkout 误称为用户已安装版本。

它不在 bundle 内复制用户认知源、聊天记录或运行时状态。产品模式使用项目 SQLite；开发兼容模式使用分离 JSONL；冷启动模板必须先 preview，再生成 instance lockfile。

Codex 保留检索、文件读取、工具调用、推理和执行：Trace 在 `UserPromptSubmit` 提供版本化、用户可查看的协作模型和来源地图（不含正文）以及正式来源 lease，在 `PreToolUse` 检查可识别的读取预算，在 `PostToolUse` 保存 `trace.host-retrieval-evidence@0.1.0`。详细 profile 作为项目本地配置保存，`activation.lock.json` 只锁定 hash；因此 bundle 不再把 旧式词法来源搜索的预选页面当作 Codex 实际读取，也不把个人协作上下文打包进公共发行物。

完整边界与 profile 约定见 [Codex 原生检索与 Trace 证据架构](../../../docs/host-native-retrieval.md) 和[适配使用者](../../../docs/personalization.md)。
