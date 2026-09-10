# 版本、协议与发布

Trace 不是只有一个版本号的单体。为了让用户知道一次更新影响了什么，发行时明确区分三类版本：

| 层级 | 身份 | 含义 |
|---|---|---|
| 产品发行版 | 根目录 `trace-runtime` | 用户安装、CLI、native launcher 与整套产品文档的版本。 |
| Workspace 包 | `@trace/*` | 供 SDK、adapter、host 或未来插件独立依赖的包版本；当前采用 independent versioning。 |
| 协议 | `trace.*` protocol version | 持久化/交互数据的兼容性身份；不能用产品版本或包版本替代。 |

## 当前约定

- 发布分支是 `main`；Changesets 也以 `main` 计算发布差异。
- 包发布的唯一计划来源是 `.changeset/`。在没有明确发布决策前，不能执行 `pnpm version-packages`。
- `trace.continuity`、`trace.context-record` 与 `trace.project-instance` 当前各自处于 `0.2.0`。它们都有显式历史 in-memory upcaster；未知版本继续 fail-closed。
- 产品 `trace-runtime` 当前是 `0.6.0`。它不表示每个 workspace 包或每个协议都等于 `0.6.0`。
- 发布前必须运行 `corepack pnpm audit:versions`、`corepack pnpm changeset status`、`corepack pnpm check:all`。

`governance/version-policy.json` 是机器可检查的版本事实。`audit:versions` 会检查发布分支、根发行版、workspace package 版本、受管协议版本，以及 Changeset 中引用的包是否真实存在。它不自动改版本，也不替代真实行为验证。

## 发布决策顺序

```text
协议 / 产品行为 / 模板变更
  → 加入对应 Changeset
  → 通过版本审计与完整测试
  → 审阅 changeset status 的实际 release plan
  → 明确批准后 version-packages
  → 构建、安装、端到端回放
```

这样“runtime 已更新”“协议已迁移”“模板已更新”和“用户已经完成安装”不会被混成一句“版本已升级”。
