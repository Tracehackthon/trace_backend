# `@trace/case-capture`

这是用户 prompt 进入 Trace 的**显式案例沉淀边界**，不是 Codex hook 的自动存档器。

```text
transient raw prompt
  → prompt_capture_proposal（hash + 用户摘要/理由，无正文）
  → 用户选择 summary | redacted_excerpt | full_private
  → explicit approval + selected content
  → source_snapshot
  → outcome evidence + Change Set
  → candidate_precedent
```

- `propose()` 不接收 raw prompt bytes，只接收 transient 阶段计算的 `prompt_hash`；
- `capture()` 要求精确 approval token，并要求在该时刻重新提供用户选择的内容；不会从 hook/thread/event 回读原 prompt；
- `full_private` 强制 private snapshot，并校验 selected content SHA-256；`summary` 和 `redacted_excerpt` 默认 private；
- `createPrecedent()` 需要已捕获的 prompt source、至少一条 outcome evidence 及 Change Set；案例不等于已发布能力。

在 Codex 中，用户先通过 `$trace-review` 看“有什么候选、为什么值得保留、尚未保存什么”；只有明确表达要沉淀后，Agent 才进入 capture proposal。正常响应只包含 refs、mode、classification 与下一步，不回显 selected content。
