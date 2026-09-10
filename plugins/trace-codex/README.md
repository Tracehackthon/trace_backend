# Trace for Codex

This plugin is the conversational entry to Trace. In Codex, use **`$trace`** for setup, status, adaptation, version inspection, and Codex integration; use **`$trace-review`** to see pending accumulation.

The plugin provides:

- **Skills** for natural-language, proposal-first collaboration.
- **A local MCP server** for structured project status and approved state changes.
- **No replacement retrieval layer**: Codex keeps using its native search/read/coding tools; Trace records only bounded, safe evidence of actual source use.

## Runtime location

The packaged Trace runtime places this plugin under `<trace-runtime>/plugins/trace-codex`, so its launcher finds `<trace-runtime>/dist/apps/mcp/src/main.js` automatically. If the plugin is installed separately, configure `TRACE_RUNTIME_ROOT` to the installed Trace runtime root. The launcher intentionally fails rather than guessing a personal checkout path.

## Version behavior

Installing or updating this plugin does not rewrite existing Trace projects. Open `$trace` and inspect the project first. Older projects show `legacy_unlocked` until the user explicitly adopts their compatibility-profile migration; newer projects retain their locked profile until a separate, adopted change is made.
