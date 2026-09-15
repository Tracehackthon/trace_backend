---
name: trace-context
description: "Receive and apply the user's locked Trace context package as a task-bound virtual Codex Skill. Use when the user asks for 我的上下文包, skill 包, 当前协作方式, 认知源入口, or wants their Trace collaboration context brought into the current Codex project."
---

# Trace Context

Use this workflow for the user's collaboration/context package. It is distinct from `$trace-work`, which carries selected content for one concrete product work item.

## Receive and verify

1. Call `trace_context_skill_receive` with the absolute current project directory.
2. Continue only when the receipt has `status: "received"` and its session, project, package ID, and content hash match the returned package and current task.
3. Apply `package.skill.instructions` for this task and project only. The included `skill_md` is a verifiable virtual Skill artifact; do not copy it into a global Skill directory.
4. Treat source-map entry points as navigation. Do not claim a source page was read until Codex actually reads it through the authorized source path and Trace records the corresponding evidence.

## Boundaries

- A received package does not update the collaboration profile, publish a capability, or adopt a new understanding.
- Never broaden its project/task scope or infer access when source availability says false.
- Do not persist or expose raw source bodies, absolute source roots, raw prompts, credentials, or tool arguments.
- If the project is `legacy_unlocked`, explain that the existing compatibility profile must first go through `$trace` profile migration proposal and explicit adoption. Do not silently lock it.

State once which collaboration model/source map version was received and whether source navigation is available. Do not describe package delivery as proof that its guidance affected a later result; use actual decisions, diffs, tests, or artifacts for that claim.
