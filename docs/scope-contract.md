# Trace 多维 Scope Contract

- 状态：已实现第一条 Product Workspace / Host Workflow 纵切
- 版本：`trace.scope-contract@1`
- 读者：Product Workspace、Host adapter、Agent worker 的维护者
- 权威实现：`packages/product/workspace/src/scope-contract.mjs`

## 背景与边界

Host Session 的项目附着关系只是**工作现场上下文**，不能单独证明一条思考属于该项目，也不能证明它可以在其他项目自动发现。旧的 `scope=personal|project|team|domain` 只有一个维度，无法同时表达个人归属、项目来源、项目关联、可发现范围和未来激活范围。

本协议把下列维度分开：

| 字段 | 作用 |
| --- | --- |
| `owner` | 谁拥有或负责最终判断；不确定时必须是 `unknown` |
| `source_provenance` | 来源表面、来源 ID、来源项目和 evidence pointers |
| `attachment_context` | 当前 Host、session、turn、task、project attachment |
| `content_scope` | 内容本身属于 personal/project/team/domain/task/unknown |
| `project_links` | 来源、相关、适用或目标项目的明确关联 |
| `discovery_policy` | 哪些项目或个人空间可以发现 |
| `activation_policy` | 哪些任务/项目可以带回；是否必须先采用 |
| `classification` | private、project-internal、team、internal、public 或 unknown |
| `lifecycle` | captured、candidate、validated、adopted 等状态 |

`attachment_context`、`content_scope`、`discovery_policy` 和 `activation_policy` 不得互相替代。尤其是“在项目 A 中产生”不等于“属于项目 A”。

## 当前接入路径

当前最小端到端路径是：

```text
Codex Host Session attach(project A)
  → UserPromptSubmit(HostTurn)
  → trace_workflow_finding_capture(scope_contract)
  → web.sqlite.workflow_findings.scope_contract_json
  → Host Workflow routing proposal
  → user adopt/trial
  → activation query(project B)
```

`workflow_findings.scope` 继续保留为 `unknown` 的旧字段，以保持既有 CHECK 约束和 API 兼容；真实多维语义从 `scope_contract_json` 读取。新读路径返回 `scope_contract`，并保留 `scopeContract` 兼容别名。

## 个人与项目示例

### 项目 A 中产生的个人判断

```yaml
owner: {kind: person, id: person:local, certainty: confirmed}
attachment_context: {project_ref: project-A, ...}
content_scope: {kind: personal, project_ref: null, certainty: confirmed}
project_links:
  - {project_ref: project-A, relation: source}
discovery_policy: {mode: personal, project_refs: [], certainty: confirmed}
activation_policy:
  {mode: cross-project, project_refs: [], requires_adoption: true, certainty: confirmed}
```

它保留项目 A 的来源，但在用户采用后可以被项目 B 的 Host Workflow 有界回带。

### 项目 A 私有事实

```yaml
owner: {kind: project, id: project-A, certainty: confirmed}
content_scope: {kind: project, project_ref: project-A, certainty: confirmed}
project_links:
  - {project_ref: project-A, relation: source}
discovery_policy:
  {mode: current-project, project_refs: [project-A], certainty: confirmed}
activation_policy:
  {mode: project, project_refs: [project-A], requires_adoption: true, certainty: confirmed}
classification: {level: project-internal, certainty: confirmed}
```

即使它由个人创建，也不会因为 `owner` 或来源可追溯而自动出现在项目 B。

### 个人判断关联多个项目

`project_links` 可以同时列出 `source`、`related` 或 `applicable` 项目；`activation_policy.mode=selected-projects` 时，带回仅接受策略中明确列出的项目。

## Legacy upcast

`upcastLegacyScope()` 将旧值转换为内存中的 v1 contract，不重写旧记录：

- `owner` 始终为 `unknown`，不会把旧 `personal` 自动冒充已确认的个人所有权；
- `classification` 始终为 `unknown`；
- `personal` 只推断个人发现入口，不推断跨项目激活；
- `project` 只有在存在明确的 Host Session project attachment 时，才填入项目链接和当前项目发现策略；
- 缺少项目 ID、来源或激活信息的字段保留 `unknown`，并列在 `legacy.uncertain_fields`；
- `legacy.scope` 和 `legacy.upcasted=true` 保留迁移来源。

旧行在读取时通过 `scopeContractFromFindingRow()` upcast；只有用户显式提交新 contract 的写入才会落 `scope_contract_json`。

## SQLite migration

迁移由 `ensureScopeContractSchema()` 完成，属于 `web.sqlite` 的 additive extension：

```text
workflow_findings.scope_contract_json TEXT NULL
trace_schema_migrations(
  migration_id = product-workspace.scope-contract.v1,
  component = product-workspace,
  version = 1
)
```

Product Workspace 的 `PRAGMA user_version` 继续保持 v1；迁移不复制或重建 `workflow_findings`，也不打开或修改项目 `trace.sqlite`。启动时会验证迁移记录的 component/version；字段缺失会通过 `ALTER TABLE ... ADD COLUMN` 补齐，重复启动无变化。

## Activation 过滤

Host Workflow 读取 proposal 时会同时读取 finding 的 contract：

- `content_scope=project` 或 `discovery_policy=current-project` 必须匹配当前稳定 project binding；
- `explicit-projects` 和 `selected-projects` 只接受列出的项目；
- `discovery_policy=private` 仅允许同一 Host Session；
- `content_scope=personal` 可以保持个人范围，也可以在显式 `cross-project` 采用后回带；
- contract 与旧 `scope` 语义都无法确定时，保持不激活。

Activation 仍然只返回 bounded summary、scope contract 和 provenance refs，不注入原始 transcript 或项目 `.trace` 全文。

## 未实现边界

- 当前 contract 存在于 Product Workspace 的 workflow finding 路径；项目 `trace.sqlite`、Continuity、Data Ledger 的完整多维 upcast 尚未切换。
- 当前 `project_ref` 仍以宿主附着值为边界，稳定项目 UUID/repository identity 尚未替换所有 basename/路径绑定。
- `classification` 目前是协议字段和激活过滤条件，不等同于操作系统 ACL 或团队成员权限。
- 浏览器 IndexedDB 与本机 `web.sqlite` 仍没有自动同步；本协议只定义逻辑作用域，不改变物理存储 provider。
