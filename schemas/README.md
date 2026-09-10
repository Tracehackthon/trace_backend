# Trace 跨语言协议 Schema

这些 JSON Schema 是 TypeScript runtime、MCP、SDK、Codex adapter 与未来 native / desktop 共同读取的结构契约。它们采用 JSON Schema 2020-12；状态机、revision、lineage、hash 与协议升级语义仍由 runtime validator 实现，并以 fixture parity 保持一致。

当前覆盖：数据 envelope、Change Set、上下文/连续性、模板、项目 instance/来源 profile、协作模型、来源 activation、能力候选/内容/发布、候选前例、prompt case、runtime event 与宿主检索 evidence。

关键边界：

- `trace.collaboration-model` 是可查看的协作契约，不是人格画像；
- `trace.source-activation` 是安全相对 locator 的导航地图，不是来源正文或“已读”事实；
- `trace.host-retrieval-evidence` 保存实际来源使用的安全证据，不保存 prompt、正文、绝对 root 或工具参数；
- 旧版本仅在有显式 registry upcaster 时生成内存视图；未知版本 fail-closed。

更新顺序必须是 schema + protocol registry → TypeScript/Python validator → fixture / migration 验证；SDK 和宿主不得私自扩展未知字段。产品版本、workspace 包版本和协议版本分别治理，见[版本、协议与发布](../docs/versioning.md)。
