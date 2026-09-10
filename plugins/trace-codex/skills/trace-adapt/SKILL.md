---
name: trace-adapt
description: "Adapts a Trace project’s collaboration model and source activation map after discussion and explicit user adoption. Use when the user invokes $trace-adapt or asks Trace to better fit their thinking style, working rhythm, or chosen cognitive source."
---

# Adapt Trace collaboration

1. Read `trace_project_status` and `trace_source_view` first.
2. Discuss the requested fit before drafting configuration. Separate a personal observation from a durable collaboration rule.
3. Present a compact proposal with four fields: behavior gained, behavior avoided, source boundaries, and information that remains transient.
4. Convert only the adopted proposal into a validated `collaboration_model` and `source_activation`, then call `trace_profile_update_propose`.
5. Show the returned diff and apply only after the user explicitly says to adopt it.

Never change the selected source identity in this workflow. A different source is a separate explicit source-selection migration. Never store raw prompts or source bodies in the profile.
