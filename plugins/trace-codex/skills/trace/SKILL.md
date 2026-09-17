---
name: trace
description: "Guides Trace use in Codex: start or inspect a project, adapt collaboration to a person's working style, review retained candidates, inspect upgrades, and enable Codex integration. Use when the user explicitly invokes $trace or asks about their Trace setup, cognitive source, retained context, collaboration adaptation, or Trace upgrade."
---

# Trace

Trace does not replace Codex's reasoning, browsing, coding, or native source retrieval. It gives those activities a visible project lifecycle: scripted dialogues, recorded decision forks, safe evidence, reviewable candidates, explicit profile changes, and non-destructive version migration.

## Bring the user's context Skill package into this task

When the user asks for their context package, Skill package, current collaboration style, or cognitive-source entry map, use `$trace-context`. It compiles the project’s already locked profile into a task-bound virtual `SKILL.md`, verifies the package and writes an activation receipt. It does not install a global Skill, read source bodies, or replace the separate `$trace-work` handoff flow.

## Bring a prepared Trace work item into Codex

When the user asks to use, continue, or receive context they prepared in Trace, use the `$trace-work` workflow. Call `trace_product_context_receive` with the current absolute project directory; do not copy an entire Web workspace or invent a delivery receipt. Respect each returned item's `role` and `instruction`, and keep the context scoped to the current task.

After real work and verification finish, call `trace_product_result_return` once with the original delivery identifiers. Separate verified `fact`, your `interpretation`, and `unconfirmed` points. Returning a result creates a review draft in Trace; it never adopts a new personal understanding on the user's behalf.

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

## Follow the current Codex host session (explicitly)

When the user says one of these natural requests, route it to the matching
host-session MCP call. The session identity comes from the host environment;
never ask the user to paste a session ID:

| Natural request | MCP route | Boundary |
| --- | --- | --- |
| `$trace 跟着这个任务` | `trace_host_session_attach` | Starts explicit capture for this Codex session; no earlier prompt is retroactively imported. |
| `$trace 暂停跟随` | `trace_host_session_pause` | Pauses capture; existing turns remain. |
| `$trace 结束跟随` | `trace_host_session_detach` | Ends this session identity and closes unfinished turns. |
| `$trace 记下这个流程改进：...` | `trace_workflow_finding_capture` | Captures one finding against the current HostTurn; omit `turn_id` when the current open turn is unambiguous. |
| `$trace 这次带回了什么` | `trace_host_activation_history` / `trace_host_activation_query` | Shows offered/used activation receipts; do not claim an offer was used. |
| `$trace 查看待处理发现` | `trace_workflow_findings_list` then `trace_routing_proposals_list` | Read-only review; captured/unresolved is not injected or adopted. |

If the Product service is not running, `TRACE_PRODUCT_URL` is missing, the
session is not attached, or no current HostTurn can be found, report the short
recoverable error and ask the user to start/attach/resume instead of pretending
the action succeeded. An ordinary `$trace` sentence never saves a global rule,
changes canonical understanding, or publishes a Skill. Routing is always a
proposal; adoption/trial/rejection uses `trace_routing_decide` with the latest
revision.

For a cwd without `.trace/`, an explicitly attached session can still reach the
user-level Product `web.sqlite` only when the Codex hook process and Product
Service share the same absolute `TRACE_WEB_STATE_FILE`; otherwise the hook's
successful `{}` response is a safe no-op and does not guess a database path.

When a captured finding has no proposal yet, call `trace_routing_propose` with the
finding identity returned by the read-only list before presenting its deterministic
route. The proposal remains review-only until the user chooses adopt, trial, or reject.

## Host workflow and publication boundaries

`Stop` only queues one bounded sensemaking job. Use
`trace_sensemaking_worker_status` to inspect the server-selected mode and profile;
`disabled`, offline `fixture-dev`, bound `profile`, and non-routing `shadow` are
explicit modes. `fixture-dev` proves an offline contract, not real provider
quality; a missing profile or credential must stay disabled rather than silently
switching executors. Product `web.sqlite` owns HostSession/HostTurn/finding and
workflow state; `agent.sqlite` owns only run/profile/event/result hashes.

Show the user the Host UI at `http://127.0.0.1:4173/?view=host` when the Product
Service is running. Repository Guard is always preview → explicit apply → receipt
or recovery; it never resets, cleans, switches back, pushes, or merges by itself.
Capability candidates remain `producer_required` without an existing publisher;
`CapabilityTrial` and `PublicationPolicy` are separate CAS/receipt gates, and no
candidate or trial is a published Skill. Cloud sync, ADrive, multi-tenant service,
remote authentication, and real supplier quality are outside this local Plugin.

## Response style

Use product language, not raw CLI commands or JSON. Each state-changing response should include: **what changed**, **what stayed untouched**, **where the user can see the result**, and **a natural next sentence** they can say.
