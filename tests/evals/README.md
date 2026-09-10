# Trace Host-Retrieval Evidence Evaluation

此目录验证 **Trace 不抢占宿主检索，而是能如实证明宿主实际访问了什么**。Codex 自己决定是否检索、怎样检索、读取哪些正式页；Trace 的责任是提供受控来源入口、保存安全访问 evidence，并让用户区分“已提供 / 已检索 / 已读取 / 未分类访问”。

它不是模型效果评估，也不把 fixture 或 hook 回放伪装成“Codex 检索更好”。真实效果需要独立的、干净项目上的用户任务研究。

## Case contract

`cases/*.json` 里的 prompt、页面与禁止页都是 synthetic 测试输入。`hook-replay.test.mjs` 将 `expected_pages` 作为测试提供的 host native-read 回放决策，而不是 Trace 自动选择结果。它验证：

- `UserPromptSubmit` 只提供来源 lease 与预算，不返回预选页面或正文；
- `PostToolUse` 可以记录 `source_read` 的相对 locator、revision/hash 与受控事件 hash；
- 搜索只能标为 `source_search`，不会伪装为已读；
- prompt、来源正文、工具输入/输出、绝对 root 不进入 SQLite 或 eval snapshot；
- `PreToolUse` 的预算检查不是文件系统 ACL。

## 运行

```powershell
corepack pnpm eval:pair
corepack pnpm test:evals
```

- `baseline`：不写 Trace host-retrieval evidence 的对照；
- `trace`：以同一 fixture native-read replay 写预期 evidence；
- `eval:pair` 的 delta 是 evidence coverage，不是 precision / recall 或模型质量提升；
- `test:evals` 同时回放 `trace internal codex hook-stdio --route-from-event-cwd`，验证 cwd 隔离和 SQLite privacy boundary。

真实 Agent 效果验收应固定模型、权限、cwd 和上下文预算，记录最终 artifact、实际 source evidence、用户纠正次数、完成 turns 与延迟；不要将这套 fixture 结果外推为真实用户提升。
