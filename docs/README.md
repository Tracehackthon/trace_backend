# Trace 文档

Trace 管理的是认知变更，而不是把内容、prompt 或聊天记录堆成“记忆”：真实协作中的理解从 Before 走向 After，经过候选、用户采用、未来激活与后续验证。当前产品以 Codex-first 方式实现这条循环，并保留明确的来源、隐私、版本与恢复边界。

> **先按你的任务读文档，不要从 package 目录或 CLI 参数反推产品使用方式。**

## 我是使用者：从 Codex 开始

1. [Trace Codex Plugin](codex-plugin.md)：一次性连接 Codex，在对话中用 `$trace` / `$trace-adapt` / `$trace-review`。
2. [第一次使用](getting-started.md)：理解项目 `.trace/`、初始化边界与可选来源模式。
3. [日常协作、认知变化与沉淀](daily-workflow.md)：知道哪些只是 transient、哪些候选等待决定、何时能采用或发布。
4. [让 Agent 逐步适配使用者](personalization.md)：冷启动协作模型、个人/项目 profile、来源地图与更新方式。
5. [维护、备份与恢复](operations.md)：Plugin 不可用、需要诊断或恢复时的操作。

## 我是已有用户：先检查版本，不要覆盖项目

- [版本、协议与发布](versioning.md)：区分 runtime、Plugin、workspace package 与协议版本；理解 `locked`、`legacy_unlocked`、显式迁移和 fail-closed。
- [Trace Codex Plugin](codex-plugin.md#旧用户与版本变化)：Plugin 更新为何不会迁移 `.trace/`、profile、来源、模板或 hooks。

## 我在开发或接入宿主

- [产品边界与架构](architecture.md)：用户层、宿主层、application 层与协议层如何分工。
- [Codex 原生检索与 Trace 证据架构](host-native-retrieval.md)：Codex 保留搜索/读取/推理，Trace 只管理来源 lease 与真实访问 evidence。
- [产品边界与架构](architecture.md)：外部来源、候选前例、模板、能力、application 层与协议层的分工。
- [packages 数据与协议说明](../packages/README.md)：schema、envelope、lineage、revision、hash、upcaster 与分包边界。
- [效果评估 fixtures 与边界](../tests/evals/README.md)：evidence coverage 验证不等同于模型效果。

CLI、SDK、native 与 package README 都是这些产品文档的补充，不是普通用户的起点。
