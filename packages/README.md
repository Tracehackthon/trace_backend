# Trace packages

`packages/` 是 Trace 的可复用产品底座，不是用户需要逐个配置的模块列表。普通用户从 Codex 的 `$trace` 进入；Plugin/MCP 和 CLI 将调用组合好的 application service。每个包按稳定契约和单一职责拆分，宿主与 SDK 不得绕过这些边界直接写数据库。

## 分层与职责

| 组 | 代表目录 | 负责什么 |
|---|---|---|
| Core | `core/protocol`、`core/data`、`core/storage`、`core/runtime` | 协议、版本兼容、append-only 数据、CAS、生命周期与恢复 |
| Collaboration | `core/continuity`、`core/collaboration-context`、`core/retrieval-evidence` | 用户可见连续性、协作模型、来源地图、宿主实际访问证据 |
| Evolution | `core/case-capture`、`core/precedent`、`core/capability-candidate`、`core/capability` | 显式案例沉淀、前例、能力候选、验证与发布 |
| Product application | `product/application` | 将项目初始化、profile lock、版本检查与 Codex hooks 组合为 proposal → adopt → apply |
| Host / integration | `host/*`、`integration/*`、`plugin/contract` | 宿主安装器和外部来源 adapter；不拥有核心状态机 |
| Template / bundle | `template/*`、`bundle/*` | 冷启动默认值和可复现组合；不覆盖用户实例 |
| SDK | `sdk/`、`python/sdk/` | 明确的跨进程协议边界；不是第二套 runtime |

## 依赖与产品边界

- core 不依赖 Codex、桌面端、知乎或 Python；
- product application 只组合已验证的 core/host 服务，不向用户暴露 JSON 参数或 SQLite 表；
- Codex 保留原生检索、读取、推理和执行；Trace 只保存有边界的来源 lease 与 evidence；
- `apps/desktop` 与 `integration/deepseek-harness` 仍是刻意未实现的边界，目录存在不等于功能已交付；
- 用户项目的 `.trace/`、个人来源 root、正文、prompt 与凭证不属于任何公共 bundle 或 package。

产品入口、日常使用与版本迁移请从根目录 [README](../README.md) 和[文档导航](../docs/README.md)开始。
