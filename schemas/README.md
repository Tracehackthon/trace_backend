# Trace 跨语言协议 Schema

这些 JSON Schema 是 TypeScript Runtime、Python SDK、Codex Adapter 和未来 native/桌面端共同读取的结构契约。它们采用 JSON Schema 2020-12；字段之间的状态机、revision、lineage 和哈希语义仍由各语言的 runtime validator 实现，并通过 fixture parity 测试保持一致。

当前协议包括数据信封、Change Set、上下文/连续性、模板包、能力发布、能力内容和候选前例。`trace.capability-publish` 管生命周期与文件身份，`trace.capability-content` 管 SKILL.md 的触发、输入、步骤、输出、失败/停止条件、验收、安全和认知源 provenance；候选前例由 `@trace/precedent` 定义，知乎适配器只填充其来源字段。来源抓取、候选生成和能力发布仍是不同状态。

规则：先更新 schema 和协议注册表，再更新 TypeScript/Python validator；不允许 SDK 私自扩展未知字段。
