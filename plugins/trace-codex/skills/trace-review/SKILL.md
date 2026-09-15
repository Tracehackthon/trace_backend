---
name: trace-review
description: "Shows a user what Trace has retained as pending cases, precedents, or capability candidates and walks them through each decision. Use when the user invokes $trace-review or asks what Trace remembered, retained, or is waiting for them to decide."
---

# Review Trace accumulation

Review is a scripted dialogue: call `trace_dialogue_begin` with `intent: "review"` and follow its instructions candidate by candidate.

For each candidate, the engine presents a fork: **保存摘要 / 保存脱敏片段 / 保存完整私有 / 拒绝 / 暂不决定**. Explain what each means before asking:

- **Candidate**: Trace kept enough metadata to make the item reviewable. It is not an automatically published memory or capability.
- **Persisted evidence**: a safe reference, identity, hash, or user-selected summary; not raw prompt/source/tool body.
- **Transient context**: material used only during the current interaction and intentionally absent from the ledger.

Rules that keep the chain honest:

- Record every choice with a `decide` move (`decision_id`, `chosen`, `rationale`). "拒绝" requires a real reason — it becomes a negative example that future `$trace-adapt` drafts must respect. "暂不决定" leaves the item pending; say so plainly.
- After a save decision, complete it with `trace_candidate_review_apply` (`action: "save"`, the matching `save_mode`, a user-supplied `content_file`, and `approval: "approve:<record_id>"` — derive the token yourself after the explicit choice).
- Rejections outside the dialogue can be applied directly with `trace_candidate_review_apply` (`action: "reject"`, `rationale` required); the reason lands in the same decision trail.
- Do not claim that Trace “learned” a behavior until the user has reviewed, validated, and explicitly published the capability. A saved case becomes a `source_snapshot`; only with outcome evidence and explicit adoption does it move toward precedent and capability publish.

When the user asks specifically about reusable methods or Skills, call `trace_capabilities_list` as well. A listed ability is a candidate unless its independent validation and publish receipt prove otherwise. Use `trace_path_view` to replay how any retained item was decided.
