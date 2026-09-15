# Trace dialogue workflows

The dialogue engine (`trace_dialogue_*` tools) owns conversation scripts; the host owns language. State is derived from the project's own continuity ledger — engagement = thread, exchange = discussion_turn, fork = decision_point — so a dialogue can be interrupted and resumed at any time.

## Moves

| Move | When | Required fields | Effect |
| --- | --- | --- | --- |
| `answer` | User answered an open question | `summary` | records a discussion_turn, advances the script |
| `decide` | User chose a branch of a pending fork | `decision_id`, `chosen`, `rationale` | resolves the decision_point; rationale is mandatory |
| `revise` | User wants the proposal changed | `decision_id`, `revised_prompt`, `revised_options`, `rationale` | supersedes the fork and creates a child node (round + 1) |
| `confirm` | Script step finished (e.g. apply succeeded, user said "enough") | `summary` | advances or closes the dialogue |
| `abort` | User walked away | `summary` | closes the dialogue; the trail stays visible |

`summary` is always the host's own words, never raw prompt text.

## Scripts

### onboard (`intent: "onboard"`)

`source-mode` (fork: local / external / team / empty) → `boundaries` (fork: confirm / revise / abort) → `propose` (engine directs the standard `trace_project_initialize_propose` → user adopts → `trace_project_initialize_apply`) → done.

### adapt (`intent: "adapt"`)

`elicit` (five topics, one at a time) → `reflect` (fork: accurate / correct me / abort) → `draft` (itemized draft; the instruction carries project-wide rejection rationales as negative examples) → negotiate with `revise` rounds, each a visible fork → `adopt` (`trace_profile_update_propose` → explicit adoption → `trace_profile_update_apply`) → `followup` (thread stays `watching`; the user returns later to verify the fit).

### review (`intent: "review"`)

`triage` walks every pending candidate with a fork: 保存摘要 / 保存脱敏片段 / 保存完整私有 / 拒绝 / 暂不决定. Save choices are completed through `trace_candidate_review_apply` (`action: "save"`, `approval: "approve:<record_id>"`); rejections need a rationale that lands in the decision trail and feeds future adapt drafts.

## Decision path （择路视图）

`trace_path_view` (MCP) or `trace path [thread_id]` (CLI) replays a thread: each fork with its options, the branch taken with its rationale, superseded rounds linked to their revisions, and whatever is still pending.

## Session resume

At `SessionStart` the Codex hook injects open threads, pending forks and the last suggested next prompts. The host mentions them once and asks whether to resume; `trace_dialogue_begin` with the same intent resumes the existing dialogue instead of starting over.

## Boundaries

1. The engine never writes configuration: propose/apply pairs with `adopt:<proposal_id>` remain the only write path.
2. No raw prompts, source bodies, absolute source roots or credentials in `move.summary`, decision prompts, or rationales.
3. A rejected direction is a durable negative example, not a deleted one.
