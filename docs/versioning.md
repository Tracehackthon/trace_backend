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
- `trace.data-envelope` 当前为 `0.3.0`，通过 `0.1.0 → 0.2.0 → 0.3.0` in-memory upcaster 引入闭合的 `host_retrieval_evidence` kind；`trace.continuity`、`trace.context-record` 与 `trace.project-instance` 当前各自处于 `0.2.0`。`trace.collaboration-model@0.1.0` 与 `trace.source-activation@0.1.0` 是独立的本地配置协议；`trace.source-profile@0.3.0` 仅用于 import。未知版本继续 fail-closed。
- 产品 `trace-runtime` 当前是 `0.7.1`，Codex bundle 为 `trace.codex@0.4.1`，Codex starter/team/empty template 为 `0.4.0`。它们不表示每个 workspace 包或每个协议都等于相同版本。`trace-codex` Plugin/MCP 已由 Changeset 列入下一次发行计划；在产品 runtime、bundle 与 profile 得到同一次明确发布决策前，不把源码 checkout 误称为用户已安装版本。
- 发布前必须运行 `corepack pnpm audit:versions`、`corepack pnpm audit:release-plan`、`corepack pnpm changeset status`、`corepack pnpm check:all`。

`governance/version-policy.json` 是机器可检查的版本事实。`audit:versions` 会检查发布分支、根发行版、workspace package 版本、受管协议版本，以及 Changeset 中引用的包是否真实存在。它不自动改版本，也不替代真实行为验证。

`audit:release-plan` 则专门检查**产品发行身份是否一致**：根 `trace-runtime`、`profiles/codex.json`、`packages/bundle/codex/bundle.json` 的 runtime/bundle/协议和 cwd 路由 hook 命令必须相互匹配。它也会列出仍待处理的 workspace Changeset，但不会把它们误当成根产品已经升级。

根 `trace-runtime` 是 private 产品发行版，不在 pnpm workspace 内，因此 Changesets 不能自动替它、Codex profile 或 Codex bundle 做发布决定。当 workspace plan 非空时，审阅者必须显式决定：本次是否同时升级产品 runtime、bundle 与 profile；**在这个决定被批准前不要运行** `pnpm version-packages`。

## 用户项目遇到新版本时会发生什么

安装新版 runtime、拉取新版仓库或替换 native 包，和“迁移用户项目”是两件事。Trace 以项目 `.trace/instance/trace.lock.json` 记住项目初始化时的 runtime/template 身份，并坚持以下规则：

| 场景 | 运行新版后发生什么 | 用户如何处理 |
|---|---|---|
| 新用户 / 新项目执行 `trace init` | 使用发行包当前模板、starter、协议与 runtime 生成新的项目 lock。 | 正常执行 `trace init → trace codex enable → trace profile`。 |
| 已有的已 lock 项目 | 新 runtime 可以读取旧状态并执行只读 in-memory upcast；它**不**替换 `.trace/profiles/`、认知源、SQLite、模板、能力、Skill 或 hooks。 | `trace upgrade` 查看差异；`trace doctor` 验证状态；仅在需要时分别执行明确的 profile/hook/能力操作。 |
| 早于协作 profile lock 的项目 | `trace profile` 显示 `legacy_unlocked`，继续使用兼容 starter，但不会伪造“已锁定”。 | 审阅后运行一次 `trace profile migrate --confirm true`；只固化当前兼容模型/地图与 hash lock，不动数据或来源。 |
| runtime/协议不再兼容 | 未知协议、缺失 upcaster 或 source profile / lock hash 漂移会 fail-closed；不会把不确定状态静默改写。 | 先 `trace doctor`、备份，再执行随该版本提供的显式迁移命令。 |

`trace upgrade` 是**只读检查**：它显示当前 runtime、项目初始化 runtime、模板 lock 与协作配置状态，并给出下一条显式动作；`automatic_changes` 固定为空。它不执行升级、不会重建项目，也不会触碰 SQLite。`trace status` 同样会把“当前 runtime 与初始化 runtime 是否变化”显示为可见状态，而不把版本变化藏在后台。

模板、预设能力和 source profile 的更新策略必须区分：

- **模板 / starter 更新**：默认只进入未来的 `trace init`。已有项目不自动接收。真实模板更新需 preview、三方 diff、显式确认和回滚；当前尚未实现三方合并，因此不能声称已有模板能一键安全升级。
- **协作模型 / 来源地图更新**：只由项目拥有者以 `trace profile update --file <ABS> --confirm true` 采用；旧配置会备份，新 hash lock 会刷新。
- **数据协议更新**：已支持的旧记录只生成内存视图，历史 revision 不改写；需要物理迁移时必须由专用命令创建备份、staging 验证并留下报告。
- **Codex hooks / 用户 Skill 更新**：只在用户执行 `trace codex enable` 或 installer 的显式 approval 后变化；检测到旧 hook 时显示 `needs_reenable`，不在 runtime 安装时修改用户级配置。

因此，仓库可以持续演化，同时每个用户项目保留自己的稳定状态。新版本提供“可识别、可审阅、可选择”的迁移，不把“最新仓库内容”误当成“应立即覆盖用户的认知与工作流”。

## Codex Plugin / MCP 的版本边界

`trace-codex` Plugin、Skills 和本地 MCP 是产品入口，不是新的项目状态格式。它们的更新遵循以下边界：

- **安装或刷新 Plugin 不迁移项目**：它只更新 Codex 能调用的 Skills/MCP；不会改 `.trace/`、SQLite、认知源、starter/template、能力或 hooks。
- **旧项目先被识别，再被迁移**：MCP `trace_upgrade_inspect` 与 `$trace` 先显示 runtime/profile 状态；`legacy_unlocked` 必须经过 proposal → 用户采用 → `trace_profile_migrate_apply` 才写 lock。
- **提案包含状态指纹**：profile、初始化与 hooks apply 前会重新计算 proposal；状态变化后 fail `STALE_PROPOSAL`，不会按旧提案覆盖新状态。
- **入口与宿主配置独立更新**：Plugin 的 managed marketplace 更新需显式 `--replace`；Codex hooks 仍需单独 proposal/adoption。两者都不是 runtime 更新的副作用。

这让“我拿到了新版 Plugin”“这个项目采用了新版协作模型”“这个项目的数据协议已经升级”成为三个可分别检查、回滚和讨论的事实。详见 [Trace Codex Plugin](codex-plugin.md)。

## 协作模型与来源地图的本地版本

`collaboration-model.json` 和 `source-activation.json` 是用户/项目本地配置，版本字段表达协作语义或地图内容的变化；它们不进入项目 Git。`activation.lock.json` 可提交但只保留两份配置的 id、version 和 SHA-256。这样团队可以审核“本项目锁定哪一版”，同时不会接收其他人的私有条款、来源 root 或正文。

更新必须走显式的 `trace profile update --file <ABS> --confirm true`：runtime 先校验 schema、来源 ID、relative locator 和 host policy，再备份旧配置、更新 lock。手改 source profile 后，hash 与 lock 不符会 fail-closed；先审阅 `external` / `team` 的新 profile，再执行 `trace source update --file <ABS> --confirm true` 才会原子刷新 selected-source lock。`local` 固定为项目 `.trace/source`，`empty` 固定为禁用，不接受此命令作为外部来源转换；需要改变来源类型时，必须等待并采用单独的 source-selection migration。协作模型/来源地图仍使用 `trace profile update`。这比静默把 Agent 换到新上下文更可回放。详见[适配使用者](personalization.md)。

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

发布前还应保留一次可比较的宿主来源访问 evidence，而不是只报告“测试通过”：

```powershell
corepack pnpm eval:pair
```

该命令在 `snapshots/evals/<pair-id>/baseline/eval-manifest.json` 和 `snapshots/evals/<pair-id>/trace/eval-manifest.json` 写入不可覆盖的评估清单，并生成 `pair-manifest.json` 对比指标。清单只保存 fixture hash、运行时/协议/bundle 身份、指标和相对页面 locator；不保存 raw prompt、来源正文、绝对来源路径或凭证。`baseline` 是无 Trace host-retrieval evidence 的对照，`trace` 是 fixture native-read replay 的 evidence coverage；它证明 hook/evidence/隐私边界，不替代 Codex 的语义检索、真实用户或模型质量评估。
