# `@trace/case-capture`

这是用户 prompt 进入 Trace 的**显式案例沉淀边界**，不是 Codex hook 的自动存档器。

```text
transient raw prompt
  → prompt_capture_proposal (hash + 用户摘要/理由，无正文)
  → user chooses summary | redacted_excerpt | full_private
  → explicit approval + selected content
  → source_snapshot
  → outcome evidence + Change Set
  → candidate_precedent
```

- `propose()` 不接收 raw prompt bytes，只接收调用方在 transient 阶段计算的 `prompt_hash`；proposal 默认 `private`，用户可以在回执中看到它和下一步 approval token。
- `capture()` 需要精确的 `approve:<proposal_record_id>`，并要求在该时刻重新提供用户选择的内容。它不会从 hook、thread 或 event 回读原 prompt。
- `full_private` 强制为 private snapshot，且 selected content 的 SHA-256 必须与 transient proposal hash 相同；`summary` 与 `redacted_excerpt` 默认 private。只有这一步、且用户明确选择 full private 时，完整 prompt 才会存入 SQLite。
- `createPrecedent()` 必须有已捕获 prompt source、至少一条 outcome evidence 及 Change Set；案例本身不等于已发布能力。

CLI 对应 `prompt-case propose|capture|precedent`。正常响应只含 refs、mode、classification 和下一步，不回显 selected content。
