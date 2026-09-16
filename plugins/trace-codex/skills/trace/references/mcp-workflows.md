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
| Receive the current context Skill package | `trace_context_skill_receive` | none | task/project-bound virtual `SKILL.md` + privacy-safe activation receipt; no global install |
| Receive a prepared work handoff | `trace_product_context_receive` | none | server-issued delivery receipt bound to Codex session + project + context hash |
| Return actual Codex work | none | `trace_product_result_return` | immutable external return + review draft; no automatic understanding change |
| Scripted dialogues (onboard / adapt / review) | `trace_dialogue_begin`, `trace_dialogue_state` | `trace_dialogue_step` | continuity thread + turns + decision forks only |
| Replay a decision path | `trace_path_view` | none | read-only |
| Review one candidate | `trace_candidate_review_view` | `trace_candidate_review_apply` | save → private source_snapshot; reject → rationale in decision trail |
| Follow Codex host session | `trace_host_session_attach` / `trace_host_session_pause` / `trace_host_session_detach` | explicit attach/pause/end | web.sqlite host session + append-only HostTurn events; no automatic capture before attach |
| Capture a workflow improvement | `trace_workflow_finding_capture` | `trace_routing_propose` → `trace_routing_decide` | captured finding → deterministic routing proposal → adopt/trial/reject; never direct Skill publication |
| See returned activation | `trace_host_activation_query` / `trace_host_activation_history` | `trace_host_activation_mark` | offered is distinct from used/affected and is budgeted |
| Review pending host findings | `trace_workflow_findings_list` / `trace_routing_proposals_list` | `trace_routing_decide` | unresolved/captured remains out of activation by default |

All apply tools require `approval: adopt:<proposal_id>`. The agent derives that token after the user explicitly adopts the displayed proposal; the user never has to see or type it.

## Version policy

1. A new runtime is never permission to rewrite an existing project.
2. A missing activation lock means `legacy_unlocked`, not a broken project. It retains compatibility behavior until the user adopts migration.
3. A locked project keeps its own local collaboration model and source activation map. A newer starter template is used only for new initialization until a separate template migration exists.
4. Profile updates are project-local, backed up, and atomically lock the exact selected configuration.

## Host worker / guard / capability 高级入口

这些入口都使用当前宿主环境的身份和 Product Workspace CAS；没有 Product Service、`TRACE_PRODUCT_URL`、attached session 或目标 journal 时必须报告可恢复错误：

| 目的 | MCP | 约束 |
| --- | --- | --- |
| 查看/有限排空 sensemaking | `trace_sensemaking_worker_status` / `trace_sensemaking_worker_drain` | hook 只入队；drain 有界，不等待模型，不切换 profile |
| 处理 Guard 崩溃 | `trace_repository_recovery_preview` → `trace_repository_recovery_reconcile` | preview 先证明 branch/HEAD/clean/hash；不自动 reset、切回、删除或远程操作 |
| 管理 standing publication policy | `trace_publication_policy_preview` → `trace_publication_policy_adopt` / `trace_publication_policy_revoke` | 默认 manual；policy 不能由普通 prompt 或 finding 创建/扩大，撤回立即生效 |
| 试验并发布能力候选 | `trace_capability_trial_create/complete` → `trace_capability_stage` → `trace_capability_validate` → `trace_capability_publish` | candidate ≠ adopted ≠ Skill；需现有 publisher、source/hash、行为 trial、rollback receipt 和 CAS |

`trace_capability_publish` 只记录既有 CapabilityPublisher 已实际完成的发布，不是第二个文件写入器；没有 candidate producer 时保持 `producer_required`。云同步、ADrive、多租户和远程鉴权不由这些工具实现。