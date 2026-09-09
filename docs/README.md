# Trace 文档

这里按使用者任务导航；不要从 package 目录反推产品使用方式。

## 使用 Trace

1. [第一次使用](getting-started.md)：初始化项目、启用 Codex、理解 `.trace/`。
2. [日常协作与沉淀](daily-workflow.md)：查看 Agent 沉淀、审核案例、理解前例与能力。
3. [维护、备份与恢复](operations.md)：健康检查、备份、恢复与常见边界。

## 开发 Trace

- [产品边界与架构](architecture.md)：用户层、宿主层、协议层，以及为什么它们必须分开。
- `packages/core/*/README.md`：稳定领域契约。
- `packages/integration/*/README.md`：来源 adapter 与宿主边界。
- `apps/desktop/README.md`、`packages/integration/deepseek-harness/README.md`：刻意未实现的宿主边界，不代表已接入。
- `MIGRATION_STATUS.md`、`AUDIT_20260909.md`：迁移与验收记录，不是新用户教程。