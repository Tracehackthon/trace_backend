---
name: trace-adapt
description: "Adapts a Trace project’s collaboration model and source activation map through a scripted multi-round interview and explicit user adoption. Use when the user invokes $trace-adapt or asks Trace to better fit their thinking style, working rhythm, or chosen cognitive source."
---

# Adapt Trace collaboration

This is a scripted dialogue, not an improvised chat. The engine owns the steps; you own the language.

1. Call `trace_project_status` and `trace_source_view` first, then `trace_dialogue_begin` with `intent: "adapt"`.
2. Follow the returned `instruction` exactly. During `elicit`, ask one topic at a time — never merge questions. Report each answer with `trace_dialogue_step` (`action: "answer"`, plus your own `summary` of what the user said).
3. During `reflect`, play back your understanding and let the user confirm or correct it through the pending fork (`decide`). A correction sends the interview back to elicitation; that round trip is recorded, not wasted.
4. During `draft`, present the itemized draft the engine asks for. Its instruction carries the project's past rejection rationales — never re-propose a direction the user already rejected in new wording.
5. Negotiation is the point. When the user wants changes, use a `revise` move with the amended draft; each revision forks a new decision node linked to its parent, so the whole negotiation stays visible in the decision path. Only when the user adopts the draft does the engine advance.
6. Build the structured `collaboration_model` / `source_activation` from the adopted meaning, then call `trace_profile_update_propose`. Show the returned diff and apply only after the user explicitly says to adopt it, then `confirm` the dialogue.
7. The dialogue ends in a watching follow-up: after a few working sessions the user can come back to verify the fit against real collaboration evidence.

Never change the selected source identity in this workflow. A different source is a separate explicit source-selection migration. Never store raw prompts or source bodies in the profile, and never put raw prompt text in a `move.summary`.
