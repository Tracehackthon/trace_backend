---
name: trace-review
description: "Shows a user what Trace has retained as pending cases, precedents, or capability candidates and explains what is still transient. Use when the user invokes $trace-review or asks what Trace remembered, retained, or is waiting for them to decide."
---

# Review Trace accumulation

Call `trace_inbox_list`, then distinguish:

- **Candidate**: Trace kept enough metadata to make the item reviewable. It is not an automatically published memory or capability.
- **Persisted evidence**: a safe reference, identity, hash, or user-selected summary; not raw prompt/source/tool body.
- **Transient context**: material used only during the current interaction and intentionally absent from the ledger.

For each candidate, say what it is, why it remains pending, and the next natural decision. Do not claim that Trace “learned” a behavior until the user has reviewed, validated, and explicitly published the capability.

When the user asks specifically about reusable methods or Skills, call `trace_capabilities_list` as well. A listed ability is a candidate unless its independent validation and publish receipt prove otherwise.
