# Trace 跨语言协议 Schema

这些 JSON Schema 是 TypeScript Runtime、Python SDK、Codex Adapter 和未来 native/桌面端共同读取的结构契约。它们采用 JSON Schema 2020-12；字段之间的状态机、revision、lineage 和哈希语义仍由各语言的 runtime validator 实现，并通过 fixture parity 测试保持一致。

当前协议包括数据信封、Change Set、上下文/连续性、模板包、项目实例/认知源 profile、协作模型、认知源激活地图、能力发布、能力内容、候选前例、prompt case 与宿主检索证据。`trace.collaboration-model` 是用户可查看的协作契约，不是人格画像；`trace.source-activation` 是安全相对 locator 的导航地图，不是来源正文或已读事实。`trace.capability-publish` 管生命周期与文件身份，`trace.capability-content` 管 SKILL.md 的触发、输入、步骤、输出、失败/停止条件、验收、安全和认知源 provenance；候选前例由 `@trace/precedent` 定义，知乎适配器只填充其来源字段。来源抓取、候选生成和能力发布仍是不同状态。

规则：先更新 schema 和协议注册表，再更新 TypeScript/Python validator；不允许 SDK 私自扩展未知字段。`0.1.0`、`0.2.0` 与 `0.3.0` schema 文件同时保留，旧文件是历史证据。source profile `0.2` 增加 `host_retrieval` policy；`0.3` 允许在 import 时带入独立的协作模型与来源地图，初始化后它们仍会拆到本地 `profiles/`。Data Envelope 通过显式 `0.1.0 → 0.2.0 → 0.3.0` in-memory upcaster 读取。`0.3.0` 新增闭合的 `host_retrieval_evidence` kind，不会把未知版本或自由 payload 视作兼容。
