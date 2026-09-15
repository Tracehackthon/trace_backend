# 对话引擎与决策路径

> Trace 的对话不再依靠宿主即兴发挥：脚本由 Trace 自己拥有，语言由宿主负责。每一次呈给你的岔路、你的选择和理由，都记录在项目自己的决策路径里。

## 为什么有对话引擎

早期的 Trace 把"对话"完全交给三份 Skill Markdown 和宿主 LLM 的现场发挥：`$trace-adapt` 号称"先讨论再提案"，但讨论没有结构、没有追问、没有"信息够不够"的判断；每个动作都是"提案 → 一句话采纳"，拒绝是死胡同，跨会话接续是空架子。

对话引擎改变分工：

```text
宿主 LLM：语言、同理、解释、总结
Trace 对话引擎：步骤、顺序、追问、岔路、记录、推进条件
```

## 对话即状态，状态即可见

一次 scripted dialogue 完全落在项目自己的 continuity 账本里，没有隐藏状态：

| 对话中的事物 | 账本里的记录 |
|---|---|
| 一次访谈/审阅 | 一个 `thread`（dialogue- 前缀） |
| 一轮问答 | 一条 `discussion_turn`（摘要，不是原文） |
| 呈给你的每个岔路 | 一个 `decision_point`：问题、分支、选择、理由、轮次 |
| 一次草案修改 | 旧节点 `superseded` + 子节点（`parent_decision_id` 指回），轮次 +1 |
| 对话结束 | `persistence_receipt` + thread 进入 `resolved` / `watching` |

当前步骤从账本推导（thread 的 step token），所以对话可以在任何时刻中断、在任何后续会话中继续——`trace_dialogue_begin` 用同一个 intent 调用时，进行中的对话会接续；已结束的 adapt / review 对话会在同一条 thread 上开启新一轮，历史轮次留在决策路径里。

## 三个脚本

### onboard（`$trace` 初始化）

来源模式岔路（local / external / team / empty）→ 边界逐条确认（可以返回修改，形成第二轮）→ 标准 `propose → adopt → apply` 初始化。引擎本身永远不写配置。

### adapt（`$trace-adapt`，链路最长的对话）

```text
elicit（5 个主题，一次一题）
  → reflect（回放理解，不准确就回去重问——往返会被记录）
  → draft（逐条草案；指令自动携带全项目历史拒绝理由作为"避免"候选）
  → 逐条协商（revise 产生子岔路，协商几轮路径就有几节）
  → adopt（结构化配置 → trace_profile_update_propose → 明确采纳 → apply）
  → followup（thread 保持 watching：用几轮后回来验证适配效果）
```

### review（`$trace-review`）

逐个候选呈现岔路：保存摘要 / 保存脱敏片段 / 保存完整私有 / 拒绝（必须给理由）/ 暂不决定。保存通过 `trace_candidate_review_apply` 完成；拒绝理由进入决策路径，成为以后 adapt 草案必须绕开的负例——反馈环由此闭合。

## 决策路径（择路视图）

每条 thread 的完整岔路史可以回放：

- MCP：`trace_path_view`（thread_id）
- CLI：`trace path`（列出所有路径）/ `trace path <thread_id>`（单条回放）

你会看到：每一轮的问题、所有分支、实际走的那条、当时的理由、被修订取代的旧节点、以及仍然悬而未决的岔路。

## 会话接续

`SessionStart` 时 Codex hook 会把未决事项注入上下文：open/watching 的 thread、待决的岔路、上次留下的建议下一步。宿主会在开场提一次"要不要继续"，但不替你做决定。

## 边界

1. 引擎不写配置；`adopt:<proposal_id>` 的 propose/apply 对仍是唯一写路径。
2. `move.summary`、岔路 prompt、理由都必须是摘要级文本：不进原始 prompt、来源正文、绝对路径、凭证。
3. 被拒绝的方向是持久的负例，不会被删除或换个说法再提。
