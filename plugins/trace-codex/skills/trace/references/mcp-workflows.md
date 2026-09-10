# Trace MCP workflow map

| User intent | Read / proposal | Explicit apply | Durable boundary |
| --- | --- | --- | --- |
| See the current project | `trace_project_status` | none | no mutation |
| Start Trace | `trace_project_initialize_propose` | `trace_project_initialize_apply` | creates only a new `.trace/` boundary |
| See source policy | `trace_source_view` | none | no source body or root returned |
| See what accumulated | `trace_inbox_list` | none | candidate metadata only |
| Inspect an update | `trace_upgrade_inspect` | none | no automatic rewrite |
| Lock an old project’s compatibility profile | `trace_profile_migrate_propose` | `trace_profile_migrate_apply` | profile/map/lock + backup only |
| Adapt collaboration | `trace_profile_update_propose` | `trace_profile_update_apply` | private profile/map/lock + backup only |
| Enable Codex hooks | `trace_codex_hook_enable_propose` | `trace_codex_hook_enable_apply` | user hooks config + rollback backup |

All apply tools require `approval: adopt:<proposal_id>`. The agent derives that token after the user explicitly adopts the displayed proposal; the user never has to see or type it.

## Version policy

1. A new runtime is never permission to rewrite an existing project.
2. A missing activation lock means `legacy_unlocked`, not a broken project. It retains compatibility behavior until the user adopts migration.
3. A locked project keeps its own local collaboration model and source activation map. A newer starter template is used only for new initialization until a separate template migration exists.
4. Profile updates are project-local, backed up, and atomically lock the exact selected configuration.
