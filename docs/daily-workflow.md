# 日常协作、认知变化与沉淀

Trace 不替你决定什么值得留下，更不会把所有聊天自动变成知识。它负责把真实协作中可能发生的**理解变化**做成可见候选：原来怎样理解、什么触发了变化、现在准备怎样行动、还需要什么验证。

只有经过讨论和你的确认，候选才可能成为长期判断、前例或能力；保存一段内容本身不是终点。

## 每次协作后看什么

```powershell
trace status
trace inbox
```

`status` 是概览：项目、已授权来源、开放主题、候选前例、候选能力，以及最近一次 activation 的安全回执。它还区分宿主来源状态：Trace 已提供入口、Codex 已搜索、Codex 已读取、或检测到但无法可靠分类的访问。`trace sources` 用相对 locator、revision/hash 显示这份证据。

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

- Agent 此次拿到了哪个已授权来源入口，以及它实际搜索、读取或未分类访问了什么；
- 新出现了哪些候选，以及它们的理由、作用域和风险；
- 这些候选是否保存、验证、采纳、发布、限制或撤回；
- 哪些内容仍未保存；
- 下一步可以如何继续与 Codex 讨论。

formal source root 的绝对路径只在当前 Codex hook 返回给宿主，用于 Codex 自己的 native search/read；Trace 持久化的 evidence 只有来源 ID、相对 locator、revision/hash、事件 hash 与时间。用户不需要日常填写 `producer`、`lineage`、`correlation_id`、`causation_id` 或 SQLite 文件路径。这些属于 Trace 的宿主与协议层。
