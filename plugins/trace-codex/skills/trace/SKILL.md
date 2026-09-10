---
name: trace
description: "Guides Trace use in Codex: start or inspect a project, adapt collaboration to a person's working style, review retained candidates, inspect upgrades, and enable Codex integration. Use when the user explicitly invokes $trace or asks about their Trace setup, cognitive source, retained context, collaboration adaptation, or Trace upgrade."
---

# Trace

Trace does not replace Codex's reasoning, browsing, coding, or native source retrieval. It gives those activities a visible project lifecycle: selected context, safe evidence, reviewable candidates, explicit profile changes, and non-destructive version migration.

## Start with the project state

Call `trace_project_status` before offering configuration advice.

- If no Trace project exists, call `trace_project_initialize_propose` with `source_mode: "local"` unless the user has explicitly selected another source mode.
- Show the proposal in ordinary language: what will be created, what will not be read or installed, and what the user can change later.
- Apply only after the user explicitly adopts the displayed proposal. Supply the tool's exact `proposal_id` and `approval: "adopt:<proposal_id>"`; never ask the user to type an approval token.

## Adapt the collaboration, not the person to a config file

When the user wants the Agent to better fit how they think or work:

1. Discuss the working preference and evidence first. Do not silently turn a conversation into a profile.
2. Explain a concise behavioral proposal: what the Agent will prioritize, what it will avoid, which source entry points it may use, and what stays transient.
3. Build the structured collaboration model/source map from the adopted meaning, then call `trace_profile_update_propose`.
4. Show the returned before/after summary. Apply only after an explicit adoption with `trace_profile_update_apply`.

Do not put a private source root, raw source body, raw prompt, credential, or tool parameter into a Trace profile.

## Let the user see accumulation

- Use `trace_inbox_list` for “what did Trace retain?” and explain that candidate means **not yet adopted as a capability**.
- Use `trace_source_view` to show which source is connected and its activation boundaries. It intentionally does not expose source bodies or private roots.
- Use `trace_upgrade_inspect` for updates. It is read-only: a runtime update never overwrites a user project.

## Existing projects and version changes

If status says `legacy_unlocked`, explain that the project predates the local collaboration-profile lock. Use `trace_profile_migrate_propose`; its migration materializes the same compatibility model/map already being used and leaves source, SQLite history, capabilities, and hooks unchanged. Apply only after adoption.

Never imply that an upgrade migrates templates, source data, or user profile automatically. Refer to [MCP workflow reference](references/mcp-workflows.md) for the operation map.

## Enable passive Codex integration only by choice

For “enable Trace in Codex”, first call `trace_codex_hook_enable_propose`. State clearly that it updates the Codex user-level hook configuration, creates a rollback backup, preserves unrelated hooks, and routes every event by its own current project directory. Apply only after the user adopts it.

## Response style

Use product language, not raw CLI commands or JSON. Each state-changing response should include: **what changed**, **what stayed untouched**, **where the user can see the result**, and **a natural next sentence** they can say.
