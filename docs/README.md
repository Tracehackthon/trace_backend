# Trace 产品文档

这里不是“代码目录的说明书”，而是 Trace 的产品使用手册：帮助使用者理解 Trace 能给协作带来什么、在 Codex 中怎么开始、哪些内容会被保留、如何适配自己，以及更新后为什么不会覆盖已有项目。

## 我想开始使用 Trace

1. [Trace for Codex](codex-plugin.md)：一次性连接 Codex，之后用 `$trace`、`$trace-adapt`、`$trace-review` 工作。
2. [第一次使用](getting-started.md)：建立项目 `.trace/`，选择 local / external / team / empty 来源边界。
3. [日常协作、候选与沉淀](daily-workflow.md)：理解讨论、候选、采用、案例、前例和能力之间的关系。
4. [适配使用者](personalization.md)：让通用 starter 逐步变成个人、项目或团队明确拥有的协作方式。

## 我想知道 Trace 会不会记住或泄露什么

- [Codex 原生检索与来源 evidence](host-native-retrieval.md)：Codex 仍自己检索；Trace 只管理来源授权、访问 evidence 与预算。
- [日常协作、候选与沉淀](daily-workflow.md)：哪些内容默认 transient，如何显式把 prompt / 外部材料变成私有案例或前例。
- [维护、备份与恢复](operations.md)：项目状态、诊断、backup、restore 与安全边界。

## 我是旧用户，或刚更新了 runtime / Plugin

- [版本、协议与发布](versioning.md)：区分 runtime、Plugin、profile、模板与协议版本。
- [Trace for Codex：旧用户与版本变化](codex-plugin.md#旧用户与版本变化)：为什么更新入口不等于迁移项目，怎样处理 `legacy_unlocked`。

## 我在接入或开发产品

- [产品架构](architecture.md)：用户体验、宿主、application service、核心协议和存储如何分工。
- [packages 产品边界](../packages/README.md)：核心、候选、能力、adapter、SDK、模板与 bundle 的职责。
- [apps 宿主入口](../apps/README.md)：Plugin/MCP、CLI、Codex hooks 与未来 desktop 的边界。
- [效果评估 fixtures](../tests/evals/README.md)：访问 evidence 覆盖率的验证边界，不把 fixture 冒充模型效果。

普通用户不需要从 packages、CLI flag 或 SQLite 表开始。先进入 Codex 的 `$trace`；产品会在需要时把状态、选择和下一步显示给你。
