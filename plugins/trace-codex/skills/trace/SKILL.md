---
name: trace
description: "Guides Trace use in Codex: start or inspect a project, adapt collaboration to a person's working style, review retained candidates, inspect upgrades, and enable Codex integration. Use when the user explicitly invokes $trace or asks about their Trace setup, cognitive source, retained context, collaboration adaptation, or Trace upgrade."
---

# Trace

Trace does not replace Codex's reasoning, browsing, coding, or native source retrieval. It gives those activities a visible project lifecycle: scripted dialogues, recorded decision forks, safe evidence, reviewable candidates, explicit profile changes, and non-destructive version migration.

## Start with the project state

Call `trace_project_status` before offering configuration advice.

- If no Trace project exists, start the scripted onboarding instead of improvising: call `trace_dialogue_begin` with `intent: "onboard"`.
- The dialogue engine owns the script. Show its `instruction` to the user in ordinary language, ask exactly what it asks (never merge questions, never skip ahead), and report the user's answer with `trace_dialogue_step`.
- Every fork the engine returns in `pending_decisions` is a real decision the user must make. Record it with a `decide` move (`decision_id`, `chosen`, `rationale`); record a requested change with a `revise` move. The rationale is required — a decision without its reason is a dead end.
- Configuration writes still follow `propose → explicit adopt → apply`: the engine will tell you when to call `trace_project_initialize_propose`/`_apply`. Supply the tool's exact `proposal_id` and `approval: "adopt:<proposal_id>"`; never ask the user to type an approval token.

## Adapt the collaboration, not the person to a config file

When the user wants the Agent to better fit how they think or work, call `trace_dialogue_begin` with `intent: "adapt"` (see the `$trace-adapt` skill). The engine runs the interview: elicit → reflect → draft (with past rejection rationales as negative examples) → negotiate round by round → adopt → follow-up. Your job is to carry the conversation, not to design it.

Do not put a private source root, raw source body, raw prompt, credential, or tool parameter into a Trace profile. `move.summary` is always your own summary of what the user said, never the raw prompt.

## Let the user see accumulation

- Use `trace_inbox_list` for “what did Trace retain?” and explain that candidate means **not yet adopted as a capability**. Review runs as a scripted dialogue: `trace_dialogue_begin` with `intent: "review"`.
- Use `trace_path_view` to replay any thread's decision path: every fork, the branch taken with its rationale, and the branches not taken.
- Use `trace_source_view` to show which source is connected and its activation boundaries. It intentionally does not expose source bodies or private roots.
- Use `trace_upgrade_inspect` for updates. It is read-only: a runtime update never overwrites a user project.

## Resume what previous sessions left open

At session start Trace injects open threads, pending decision forks, and suggested next prompts. Mention them once and ask whether to resume — never decide for the user. `trace_dialogue_state` lists active scripted dialogues; `trace_dialogue_begin` with the same intent resumes one instead of restarting it.

## Existing projects and version changes

If status says `legacy_unlocked`, explain that the project predates the local collaboration-profile lock. Use `trace_profile_migrate_propose`; its migration materializes the same compatibility model/map already being used and leaves source, SQLite history, capabilities, and hooks unchanged. Apply only after adoption.

Never imply that an upgrade migrates templates, source data, or user profile automatically. Refer to [MCP workflow reference](references/mcp-workflows.md) and [dialogue workflows](references/dialogue-workflows.md) for the operation map.

## Enable passive Codex integration only by choice

For “enable Trace in Codex”, first call `trace_codex_hook_enable_propose`. State clearly that it updates the Codex user-level hook configuration, creates a rollback backup, preserves unrelated hooks, and routes every event by its own current project directory. Apply only after the user adopts it.

## Response style

Use product language, not raw CLI commands or JSON. Each state-changing response should include: **what changed**, **what stayed untouched**, **where the user can see the result**, and **a natural next sentence** they can say.
