# Trace Host-Retrieval Evidence Evaluation

这套目录验证 **Trace 不抢占宿主检索，而是能如实证明宿主实际访问了什么**。Codex 自己决定是否检索、怎样检索、读取哪些正式页；Trace 的责任是：按项目提供受控来源入口、在本地工具事件后保留安全访问证据、让用户看到“已提供 / 已检索 / 已读取 / 未分类访问”的区别。

它**不**把 fixture 或宿主 hook 回放伪装成模型效果评估，更不声称 Trace 的 lexical provider 代表 Codex 的语义检索能力。

## Case contract

每个 `cases/*.json` 仍定义 synthetic fixture 的预期页面与禁止页：

```json
{
  "case_id": "retrieval-zh-001",
  "prompt": "只用于测试执行，不写入 eval snapshot",
  "expected_pages": ["wiki/context-boundary.md"],
  "forbidden_pages": ["wiki/private-finance.md"]
}
```

`hook-replay.test.mjs` 将 `expected_pages` 作为**测试提供的宿主 native-read 回放决策**，而非 Trace 自动选择结果。它验证：

- `UserPromptSubmit` 只提供正式来源根与预算，不返回预选页面或 `read_pointers`；
- 真实 `PostToolUse` 输入会产生 `source_read` evidence，保存相对 locator、当时 revision/hash 与输入/输出 hash；
- 搜索只能标成 `source_search`，不会伪造成已读取；
- prompt、来源正文、工具输入/输出与绝对根路径不进入 SQLite 或 snapshot；
- `PreToolUse` 对可识别的 native read 执行单轮预算；它不是文件系统隔离边界。

fixture prompt 与 fixture source body 都是测试输入；`scripts/run-evals.mjs` 的 snapshot 不保存它们，只保存 case ID、fixture hash、相对页面定位符和**evidence 覆盖率**。

## 运行

```powershell
corepack pnpm eval:pair
corepack pnpm test:evals
```

- `baseline`：不写 Trace host-retrieval evidence 的对照；
- `trace`：以相同 fixture native-read replay 写入预期 evidence；
- `eval:pair` 的 delta 是 evidence coverage，不是 precision/recall 或模型质量提升；
- `test:evals` 同时回放真实 `trace internal codex hook-stdio --route-from-event-cwd`，验证 cwd 项目隔离和 SQLite privacy boundary。

## 真实 Agent 效果验收

要评估“Codex 在真实问题上是否检索得更好”，必须另行在干净项目、固定模型/权限/cwd/上下文预算下运行可复现任务，并记录最终 artifact、宿主实际 `source_search` / `source_read` evidence、用户纠正次数、完成 turns 与延迟。Trace 现在已经可以提供这条**实际访问证据**；它不会再把“给了两个页面指针”误报成“Agent 已读并有效利用”。
