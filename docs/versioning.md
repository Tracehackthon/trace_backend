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
- 发布前必须运行 `corepack pnpm audit:versions`、`corepack pnpm audit:release-plan`、`corepack pnpm changeset status`、`corepack pnpm check:all`。

`governance/version-policy.json` 是机器可检查的版本事实。`audit:versions` 会检查发布分支、根发行版、workspace package 版本、受管协议版本，以及 Changeset 中引用的包是否真实存在。它不自动改版本，也不替代真实行为验证。

`audit:release-plan` 则专门检查**产品发行身份是否一致**：根 `trace-runtime`、`profiles/codex.json`、`packages/bundle/codex/bundle.json` 的 runtime/bundle/协议和 cwd 路由 hook 命令必须相互匹配。它也会列出仍待处理的 workspace Changeset，但不会把它们误当成根产品已经升级。

根 `trace-runtime` 是 private 产品发行版，不在 pnpm workspace 内，因此 Changesets 不能自动替它、Codex profile 或 Codex bundle 做发布决定。当 workspace plan 非空时，审阅者必须显式决定：本次是否同时升级产品 runtime、bundle 与 profile；**在这个决定被批准前不要运行** `pnpm version-packages`。

## 发布决策顺序

```text
协议 / 产品行为 / 模板变更
  → 加入对应 Changeset
  → audit:versions + audit:release-plan + 完整测试
  → 审阅 changeset status 的实际 release plan
  → 明确批准 workspace 与产品发行边界后 version-packages
  → 构建、安装、端到端回放
```

这样“runtime 已更新”“协议已迁移”“模板已更新”和“用户已经完成安装”不会被混成一句“版本已升级”。

## 效果基线与发布证据

发布前还应保留一次可比较的 activation 结果，而不是只报告“测试通过”：

```powershell
corepack pnpm eval:pair
```

该命令在 `snapshots/evals/<pair-id>/baseline/eval-manifest.json` 和 `snapshots/evals/<pair-id>/trace/eval-manifest.json` 写入不可覆盖的评估清单，并生成 `pair-manifest.json` 对比指标。清单只保存 fixture hash、运行时/协议/bundle 身份、指标和相对页面 locator；不保存 raw prompt、来源正文、绝对来源路径或凭证。`baseline` 是无 Trace 激活的对照，`trace` 是当前确定性 MyWiKi pointer activation；它们证明检索/路由边界，不替代真实用户或模型质量评估。
