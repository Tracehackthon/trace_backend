# 日常协作与沉淀

Trace 不替你决定什么值得留下。它负责把值得你判断的内容做成可见候选。

## 每次协作后看什么

```powershell
trace status
trace inbox
```

`status` 是概览：项目、已授权来源、开放主题、候选前例、候选能力。

`inbox` 只显示仍等待你决定的内容，例如：

- 一条 prompt 是否应保存为案例；
- 一个外部来源是否已经形成候选前例；
- 一个经过验证的前例是否值得升级为能力。

## 审核 prompt 案例

```powershell
trace review <ID>
```

你能看到：主题、为什么建议沉淀、建议保存方式、当前已保存和未保存的内容、下一步。

proposal 阶段只保存 hash、意图摘要和理由，不保存 raw prompt。确认后把你选择的内容写到文件，再执行：

```powershell
trace review <ID> --save <绝对内容文件路径>
```

三种保存方式：

| 方式 | 保存的内容 | 默认可见范围 |
|---|---|---|
| `summary` | 你确认的摘要 | private |
| `redacted_excerpt` | 你确认的脱敏片段 | private |
| `full_private` | 与 transient hash 完全匹配的完整 prompt | private，强制 |

保存一个案例不等于发布能力。它会先成为 `source_snapshot`；只有补充结果证据、形成 candidate precedent、经过验证和你的采纳后，才可进入能力发布流程。

## 用户应该持续看见什么

- Agent 此次引用了哪些已授权来源；
- 新出现了哪些候选；
- 这些候选是否保存、验证、采纳或发布；
- 哪些内容仍未保存；
- 下一步可以如何继续与 Codex 讨论。

用户不需要日常填写 `producer`、`lineage`、`correlation_id`、`causation_id` 或 SQLite 文件路径。这些属于 Trace 的宿主与协议层。