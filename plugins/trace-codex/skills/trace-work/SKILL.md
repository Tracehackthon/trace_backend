---
name: trace-work
description: "Receive a user-confirmed Trace work handoff in the current Codex task, use its bounded context, and return verified results to Trace for review. Use when the user says 带去用, 接入 Codex, 接回 Trace, 继续 Trace 里的工作, or asks Codex to use context prepared in Trace."
---

# Trace Work

Use this workflow only for an actual Trace work handoff. Trace remains the source of the selected context; Codex remains the place where the task is executed.

## Receive

1. Call `trace_product_context_receive` with the absolute current project directory. Pass `work_id` only when the user selected one or the tool reports multiple pending works.
2. Verify that the returned receipt has `status: "received"`, and that its `workId`, `sessionId`, `projectDir`, and `contextHash` agree with the returned context and current task.
3. State once that the handoff was received. Do not claim work has completed merely because delivery succeeded.
4. Apply every intake item only according to its role:
   - `reference`: useful context, never stronger than current explicit requirements.
   - `trial`: a hypothesis to test, not an established rule.
   - `contrast`: compare conditions and differences; do not turn it into a constraint.
5. Do not broaden `scope: "current-task"`, mutate Trace's stored understanding, or silently include excluded content.

## Execute and verify

Perform the user's task in Codex using normal repository tools. Keep authoritative evidence such as tests, hashes, diffs, and artifact paths. The Trace context is not proof that an implementation or outcome is correct.

## Return

After the requested work has actually completed or reached a concrete tested boundary, call `trace_product_result_return` exactly once for this delivery:

- Reuse `workId`, `deliveryId`, `contextHash`, and an included `matterId` from the receive response.
- Put observable outcomes and verification in `fact`.
- Put causal judgment in `interpretation`.
- Put remaining uncertainty or unrun validation in `unconfirmed`.
- List local files, test logs, and links in `artifacts`.
- Use `proposed_understanding` only as a review candidate, never as an adopted user belief.

Report the returned receipt. `returned_for_review` means the result reached Trace's review boundary; it does not mean the user accepted a revision.

If the local Trace product service is unavailable or reports no pending work, say so directly. Do not fabricate context, receipts, or a successful return.
