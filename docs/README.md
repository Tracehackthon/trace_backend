# Trace 文档

Trace 的核心对象是**认知变更**，不是内容存储：真实协作中的理解从 Before 走向 After，经过候选、用户采用、未来激活与后续验证。当前 Codex-first 版本从受控接续、可见候选、显式保存、前例与能力治理开始实现这条循环。

这里按使用者任务导航；不要从 package 目录反推产品使用方式。

## 使用 Trace

1. [第一次使用](getting-started.md)：初始化项目、启用 Codex、理解 `.trace/`。
2. [日常协作、认知变化与沉淀](daily-workflow.md)：查看 Agent 发现的候选，理解什么已保存、什么未保存、何时可以采用或发布。
3. [维护、备份与恢复](operations.md)：健康检查、备份、恢复与常见边界。
4. [让 Agent 逐步适配使用者](personalization.md)：冷启动协作方式、个人/项目协作模型、认知源地图与版本更新。

## 开发 Trace

- [产品边界与架构](architecture.md)：产品生命周期如何约束用户层、宿主层与协议层。
- [版本、协议与发布](versioning.md)：区分产品发行版、workspace 包与数据协议，查看发布门禁。
- [Codex 原生检索与 Trace 证据架构](host-native-retrieval.md)：理解宿主检索、source lease、访问 evidence 与安全边界。
- [效果评估 fixtures 与 replay](../tests/evals/README.md)：查看 host-evidence fixture replay 与 paired baseline/Trace 边界。
- `packages/core/*/README.md`：稳定领域契约。
- `packages/integration/*/README.md`：来源 adapter 与宿主边界。
- `apps/desktop/README.md`、`packages/integration/deepseek-harness/README.md`：刻意未实现的宿主边界，不代表已接入。
- `MIGRATION_STATUS.md`、`AUDIT_20260909.md`：迁移与验收记录，不是新用户教程。
