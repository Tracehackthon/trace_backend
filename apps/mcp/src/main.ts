/** Trace's local MCP bridge for Codex and other compatible hosts. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod/v3';
import {
  applyCodexHookEnable,
  applyProfileMigration,
  applyProfileUpdate,
  applyProjectInitialize,
  inspectCodexHook,
  inspectProject,
  inspectSource,
  inspectUpgrade,
  listAbilities,
  listInbox,
  proposeCodexHookEnable,
  proposeProfileMigration,
  proposeProfileUpdate,
  proposeProjectInitialize,
  receiveContextSkillPackage,
  type CodexHookInput,
  type ProfileUpdateInput,
  type ProjectInitializeInput,
} from '../../../packages/product/application/src/index.js';
import type {ProjectActivationConfigurationInput, ProjectSourceProfileInput} from '../../../packages/core/instance/src/index.js';
import {
  beginDialogue,
  candidateReviewApply,
  candidateReviewView,
  decisionPathView,
  dialogueState,
  stepDialogue,
} from '../../../packages/product/application/src/dialogue.js';
import type {BeginDialogueInput, CandidateReviewApplyInput, StepDialogueInput} from '../../../packages/product/application/src/dialogue.js';
import {currentCodexSessionId, TraceProductClient, type TraceProductArtifact} from './product-client.js';
import {TraceZhihuClient} from './zhihu-client.js';

function textResult(value: unknown, isError = false) {
  return {content: [{type: 'text' as const, text: JSON.stringify(value, null, 2)}], ...(isError ? {isError: true} : {})};
}

function errorResult(error: unknown) {
  const known = error as {code?: unknown; message?: unknown};
  return textResult({ok: false, error: {code: typeof known?.code === 'string' ? known.code : 'TRACE_MCP_ERROR', message: error instanceof Error ? error.message : String(error)}}, true);
}

async function invoke(operation: () => unknown) {
  try {
    const value = await operation();
    const payload = value && typeof value === 'object' && !Array.isArray(value) ? {ok: true, ...(value as Record<string, unknown>)} : {ok: true, result: value};
    return textResult(payload);
  } catch (error) { return errorResult(error); }
}

function optionalProject(project_dir: string | undefined): {project_dir?: string} { return project_dir === undefined ? {} : {project_dir}; }
function optionalHook(project_dir: string | undefined, hooks_file: string | undefined): CodexHookInput {
  return {...optionalProject(project_dir), ...(hooks_file === undefined ? {} : {hooks_file})};
}

const projectDirectory = {project_dir: z.string().min(1).optional().describe('Existing project directory. Omit to use the host process working directory.')};
const productProjectDirectory = {project_dir: z.string().min(1).describe('Absolute directory of the current Codex project. This binds a Trace handoff to the project that is actually running.')};
const sourceMode = z.enum(['local', 'external', 'team', 'empty']);
const sourceProfile = z.record(z.unknown()).describe('A structured source profile prepared from the user-adopted source selection; it is not shown as CLI JSON to the user.');
const activationConfiguration = z.object({
  collaboration_model: z.record(z.unknown()),
  source_activation: z.record(z.unknown()),
}).describe('A structured configuration prepared from a user-visible semantic proposal.');

export function createTraceMcpServer(): McpServer {
  const server = new McpServer({name: 'trace', version: '0.3.0'}, {
    capabilities: {logging: {}},
    instructions: 'Trace can deliver two distinct forms of context into Codex. For the user’s project collaboration/context Skill package, call trace_context_skill_receive with the absolute current project directory; apply it only in the bound task/project and treat source entries as navigation, not read evidence. For a user-confirmed product work handoff, call trace_product_context_receive and later trace_product_result_return after real work completes. Neither flow installs a global Skill or changes the user’s understanding automatically.',
  });
  // Keep one client per MCP process.  Each operation still handshakes before
  // the request, while the client-level pin survives the successful handshake
  // instead of being discarded by a fresh object for every tool call.
  let productClient: TraceProductClient | undefined;
  const getProductClient = () => productClient ??= new TraceProductClient();
  const zhihuClient = new TraceZhihuClient();

  server.registerTool('trace_project_status', {
    title: 'Trace project status',
    description: 'Read the current Trace project’s safe status: configuration state, runtime version difference, pending reviews and host-retrieval evidence counts. It never returns prompt bodies, source bodies, source roots or credentials.',
    inputSchema: projectDirectory,
  }, async ({project_dir}) => invoke(() => inspectProject(project_dir)));

  server.registerTool('trace_source_view', {
    title: 'Trace cognitive source view',
    description: 'Read the selected cognitive-source policy and activation map without returning source bodies or the private source root.',
    inputSchema: projectDirectory,
  }, async ({project_dir}) => invoke(() => inspectSource(project_dir)));

  server.registerTool('trace_inbox_list', {
    title: 'Trace pending review list',
    description: 'List candidate cases, precedents and capabilities waiting for the user’s review. It returns metadata only, never raw prompt content.',
    inputSchema: projectDirectory,
  }, async ({project_dir}) => invoke(() => listInbox(project_dir)));

  server.registerTool('trace_capabilities_list', {
    title: 'Trace capability candidates',
    description: 'List visible capability candidates in the current project. It never calls a candidate published or silently replaces a user Skill.',
    inputSchema: projectDirectory,
  }, async ({project_dir}) => invoke(() => listAbilities(project_dir)));

  server.registerTool('trace_dialogue_begin', {
    title: 'Begin or resume a Trace dialogue',
    description: 'Begin or resume the project-owned onboarding, collaboration-adaptation, or candidate-review dialogue. The engine returns the current scripted step and visible decision forks; it never stores a raw transcript.',
    inputSchema: {...projectDirectory, intent: z.enum(['onboard', 'adapt', 'review'])},
  }, async input => invoke(() => beginDialogue(input as unknown as BeginDialogueInput)));

  server.registerTool('trace_dialogue_step', {
    title: 'Advance a Trace dialogue',
    description: 'Advance one visible dialogue step using a host-authored summary and, when required, an explicit decision. Decision revisions remain visible in the project decision path.',
    inputSchema: {
      ...projectDirectory,
      thread_id: z.string().min(1),
      move: z.object({
        action: z.enum(['answer', 'decide', 'revise', 'confirm', 'abort']),
        summary: z.string(),
        decision_id: z.string().min(1).optional(),
        expected_revision: z.number().int().min(1).optional(),
        chosen: z.string().optional(),
        rationale: z.string().optional(),
        revised_prompt: z.string().optional(),
        revised_options: z.array(z.string()).optional(),
      }).strict(),
    },
  }, async input => invoke(() => stepDialogue(input as unknown as StepDialogueInput)));

  server.registerTool('trace_dialogue_state', {
    title: 'Read Trace dialogue state',
    description: 'Read active project dialogue metadata and pending decision forks without raw conversation content.',
    inputSchema: {...projectDirectory, thread_id: z.string().min(1).optional()},
  }, async ({project_dir, thread_id}) => invoke(() => dialogueState(project_dir, thread_id)));

  server.registerTool('trace_path_view', {
    title: 'Read a Trace decision path',
    description: 'Read the visible forks, selected branches, rationales, superseded rounds, and revisions for one project dialogue.',
    inputSchema: {...projectDirectory, thread_id: z.string().min(1)},
  }, async ({project_dir, thread_id}) => invoke(() => decisionPathView(project_dir, thread_id)));

  server.registerTool('trace_candidate_review_view', {
    title: 'Inspect a Trace candidate',
    description: 'Inspect one pending candidate and its available user decisions. A candidate is not a published capability.',
    inputSchema: {...projectDirectory, record_id: z.string().min(1)},
  }, async ({project_dir, record_id}) => invoke(() => candidateReviewView(project_dir, record_id)));

  server.registerTool('trace_candidate_review_apply', {
    title: 'Apply a Trace candidate review decision',
    description: 'Save or reject one candidate only after the user explicitly chooses. Saving requires a user-selected local content file and exact approval; rejection requires a rationale that remains visible as a negative example.',
    inputSchema: {
      ...projectDirectory,
      record_id: z.string().min(1),
      action: z.enum(['save', 'reject']),
      approval: z.string().min(1),
      save_mode: z.enum(['summary', 'redacted_excerpt', 'full_private']).optional(),
      content_file: z.string().min(1).optional(),
      title: z.string().optional(),
      rationale: z.string().optional(),
    },
  }, async input => invoke(() => candidateReviewApply(input as unknown as CandidateReviewApplyInput)));

  server.registerTool('trace_upgrade_inspect', {
    title: 'Trace upgrade inspection',
    description: 'Inspect version differences for an existing Trace project. This is read-only: an installed runtime never rewrites the project automatically.',
    inputSchema: projectDirectory,
  }, async ({project_dir}) => invoke(() => inspectUpgrade(project_dir)));

  server.registerTool('trace_project_initialize_propose', {
    title: 'Propose Trace initialization',
    description: 'Build a no-write proposal for initializing Trace in a new project. Call the matching apply tool only after the user explicitly adopts this exact proposal.',
    inputSchema: {
      ...projectDirectory,
      template_id: z.string().min(1).optional(),
      source_mode: sourceMode.optional(),
      source_profile: sourceProfile.optional(),
      user_id: z.string().min(1).optional(),
    },
  }, async input => invoke(() => proposeProjectInitialize(input as unknown as ProjectInitializeInput)));

  server.registerTool('trace_project_initialize_apply', {
    title: 'Apply adopted Trace initialization',
    description: 'Create a new Trace project only after explicit adoption. approval must exactly equal adopt:<proposal_id>; existing Trace state is never overwritten.',
    inputSchema: {
      ...projectDirectory,
      template_id: z.string().min(1).optional(),
      source_mode: sourceMode.optional(),
      source_profile: sourceProfile.optional(),
      user_id: z.string().min(1).optional(),
      proposal_id: z.string().min(1),
      approval: z.string().min(1),
    },
  }, async input => invoke(() => applyProjectInitialize({...input, source_profile: input.source_profile as ProjectSourceProfileInput | undefined} as ProjectInitializeInput & {proposal_id: string; approval: string})));

  server.registerTool('trace_profile_migrate_propose', {
    title: 'Propose legacy Trace profile migration',
    description: 'Build a no-write compatibility migration proposal for a pre-profile Trace project. The migration locks its current compatibility model/map without changing source, SQLite state, abilities or hooks.',
    inputSchema: projectDirectory,
  }, async ({project_dir}) => invoke(() => proposeProfileMigration(project_dir)));

  server.registerTool('trace_profile_migrate_apply', {
    title: 'Apply adopted legacy profile migration',
    description: 'Lock an old Trace project’s existing compatibility configuration after explicit adoption. approval must exactly equal adopt:<proposal_id>.',
    inputSchema: {...projectDirectory, proposal_id: z.string().min(1), approval: z.string().min(1)},
  }, async ({project_dir, proposal_id, approval}) => invoke(() => applyProfileMigration({...optionalProject(project_dir), proposal_id, approval})));

  server.registerTool('trace_profile_update_propose', {
    title: 'Propose a Trace collaboration profile update',
    description: 'Validate and describe a new project-local collaboration model and source activation map. Use it only after explaining the behavioral change to the user; this call writes nothing.',
    inputSchema: {...projectDirectory, configuration: activationConfiguration},
  }, async ({project_dir, configuration}) => invoke(() => proposeProfileUpdate({...optionalProject(project_dir), configuration: configuration as unknown as ProjectActivationConfigurationInput} as ProfileUpdateInput)));

  server.registerTool('trace_profile_update_apply', {
    title: 'Apply an adopted Trace collaboration profile update',
    description: 'Write the user-adopted collaboration profile with a backup and a new hash-only lock. approval must exactly equal adopt:<proposal_id>. It does not rewrite SQLite history or hooks.',
    inputSchema: {...projectDirectory, configuration: activationConfiguration, proposal_id: z.string().min(1), approval: z.string().min(1)},
  }, async ({project_dir, configuration, proposal_id, approval}) => invoke(() => applyProfileUpdate({...optionalProject(project_dir), configuration: configuration as unknown as ProjectActivationConfigurationInput, proposal_id, approval})));

  server.registerTool('trace_codex_hook_status', {
    title: 'Trace Codex hook status',
    description: 'Preview whether the Codex hook configuration is already current. It reads hook configuration metadata only and does not install or replace hooks.',
    inputSchema: {...projectDirectory, hooks_file: z.string().min(1).optional()},
  }, async ({project_dir, hooks_file}) => invoke(() => inspectCodexHook(optionalHook(project_dir, hooks_file))));

  server.registerTool('trace_codex_hook_enable_propose', {
    title: 'Propose enabling Trace for Codex',
    description: 'Build a no-write proposal to add Trace-managed Codex hooks. The hooks are user-level but route each event to the nearest Trace project; unrelated hooks are preserved.',
    inputSchema: {...projectDirectory, hooks_file: z.string().min(1).optional()},
  }, async ({project_dir, hooks_file}) => invoke(() => proposeCodexHookEnable(optionalHook(project_dir, hooks_file))));

  server.registerTool('trace_codex_hook_enable_apply', {
    title: 'Apply adopted Trace Codex hook integration',
    description: 'Install Trace-managed Codex hooks after explicit adoption. approval must exactly equal adopt:<proposal_id>. It creates a rollback backup and never persists raw prompt bodies.',
    inputSchema: {...projectDirectory, hooks_file: z.string().min(1).optional(), proposal_id: z.string().min(1), approval: z.string().min(1)},
  }, async ({project_dir, hooks_file, proposal_id, approval}) => invoke(() => applyCodexHookEnable({...optionalHook(project_dir, hooks_file), proposal_id, approval})));

  server.registerTool('trace_context_skill_receive', {
    title: 'Receive the Trace context Skill package',
    description: 'Compile this Trace project’s locked collaboration model and cognitive-source map into a bounded, virtual Codex SKILL.md for the current task. The session identity comes from the MCP process environment and cannot be supplied by the model. The call writes a privacy-safe activation receipt, but does not read source bodies, install a global Skill, or update the profile.',
    inputSchema: productProjectDirectory,
  }, async ({project_dir}) => invoke(() => receiveContextSkillPackage({project_dir, host_session_id: currentCodexSessionId()})));

  server.registerTool('trace_product_context_receive', {
    title: 'Receive Trace context in Codex',
    description: 'Receive one user-confirmed Trace work handoff for this Codex task. The MCP process binds it to the real Codex task/session identity; project_dir must be the current absolute workspace. Returned roles and boundaries are authoritative. This call creates a server-issued delivery receipt but does not change the user understanding.',
    inputSchema: {...productProjectDirectory, work_id: z.string().min(1).max(512).optional().describe('Specific Trace work ID. Omit only when exactly one work is pending for this project.')},
  }, async ({project_dir, work_id}) => invoke(async () => {
    const value = await getProductClient().receive({projectDir: project_dir, ...(work_id === undefined ? {} : {workId: work_id})});
    return {...value, user_notice: 'Trace 已把这份上下文绑定到当前 Codex 任务；仅按每条 role 用于本次工作，尚未产生工作结果。'};
  }));

  server.registerTool('trace_product_result_return', {
    title: 'Return a Codex result to Trace',
    description: 'Return the actual result of a previously received Trace handoff. Use the delivery_id, context_hash, work_id and matter_id from trace_product_context_receive. Report verified facts separately from interpretation and uncertainty. Trace stores an immutable external return plus a review draft; it never updates the user understanding until the user confirms in Trace.',
    inputSchema: {
      ...productProjectDirectory,
      work_id: z.string().min(1).max(512),
      delivery_id: z.string().min(1).max(512),
      context_hash: z.string().regex(/^[a-f0-9]{64}$/),
      matter_id: z.string().min(1).max(512),
      fact: z.string().min(1).max(65536).describe('Concrete outcome and verification evidence from the work that actually ran.'),
      summary: z.string().max(65536).optional(),
      interpretation: z.string().max(65536).optional(),
      unconfirmed: z.string().max(65536).optional(),
      proposed_understanding: z.string().max(65536).optional().describe('Optional candidate only; never present it as an adopted user understanding.'),
      artifacts: z.array(z.object({
        title: z.string().min(1).max(1000),
        kind: z.enum(['file', 'test', 'link', 'note']),
        path: z.string().max(4096).optional(),
        url: z.string().max(4096).optional(),
        digest: z.string().max(512).optional(),
      }).strict()).max(20).optional(),
    },
  }, async input => invoke(async () => {
    const value = await getProductClient().returnResult({
      projectDir: input.project_dir,
      workId: input.work_id,
      deliveryId: input.delivery_id,
      contextHash: input.context_hash,
      matterId: input.matter_id,
      fact: input.fact,
      ...(input.summary === undefined ? {} : {summary: input.summary}),
      ...(input.interpretation === undefined ? {} : {interpretation: input.interpretation}),
      ...(input.unconfirmed === undefined ? {} : {unconfirmed: input.unconfirmed}),
      ...(input.proposed_understanding === undefined ? {} : {proposedUnderstanding: input.proposed_understanding}),
      ...(input.artifacts === undefined ? {} : {artifacts: input.artifacts as TraceProductArtifact[]}),
    });
    return {...value, user_notice: 'Codex 的实际结果已回到 Trace 复核区；当前个人理解没有自动改变。'};
  }));

  server.registerTool('trace_host_session_attach', {
    title: 'Attach the current Codex host session',
    description: 'Explicitly opt the current Codex task/session into Trace host-session ingest. Until this is called, global hooks do not persist prompts or assistant messages. The MCP process supplies the session identity; an optional project_dir is only a binding hint.',
    inputSchema: {project_dir: z.string().min(1).optional()},
  }, async ({project_dir}) => invoke(async () => getProductClient().attachHostSession(project_dir === undefined ? {} : {projectDir: project_dir})));

  server.registerTool('trace_host_session_pause', {
    title: 'Pause Codex host-session ingest',
    description: 'Pause automatic capture for the current Codex task/session. Hook events remain successful no-ops until the session is explicitly attached again; existing captured turns stay unchanged.',
    inputSchema: {},
  }, async () => invoke(async () => getProductClient().pauseHostSession()));

  server.registerTool('trace_host_session_detach', {
    title: 'End Codex host-session ingest',
    description: 'End automatic capture for the current Codex task/session. The ended identity cannot be revived; a later task must use its own session identity.',
    inputSchema: {},
  }, async () => invoke(async () => getProductClient().detachHostSession()));

  server.registerTool('trace_workflow_finding_capture', {
    title: 'Capture an explicit workflow finding',
    description: 'Save one user-explicit $trace workflow discovery and associate it with a captured HostTurn. It is stored as scope=unknown, target_kind=unresolved, status=captured; it never creates a Skill, changes understanding, or publishes a rule.',
    inputSchema: {
      turn_id: z.string().min(1).max(512).optional().describe('Optional current turn. Omit to bind the newest open HostTurn.'),
      observation: z.string().min(1).max(1_000_000),
      desired_behavior: z.string().max(1_000_000).optional(),
    },
  }, async ({turn_id, observation, desired_behavior}) => invoke(async () => getProductClient().captureWorkflowFinding({...(turn_id === undefined ? {} : {turnId: turn_id}), observation, ...(desired_behavior === undefined ? {} : {desiredBehavior: desired_behavior})})));

  server.registerTool('trace_workflow_findings_list', {
    title: 'List captured Trace workflow findings',
    description: 'Read captured and worker-candidate findings for the current Codex session. Raw HostTurn prompt/final bodies are never returned by this list.',
    inputSchema: {},
  }, async () => invoke(async () => getProductClient().listWorkflowFindings()));

  server.registerTool('trace_routing_proposals_list', {
    title: 'List Trace routing proposals',
    description: 'Read deterministic routing proposals. Proposed, trial, adopted and rejected are distinct; this never publishes a Skill or changes canonical understanding.',
    inputSchema: {},
  }, async () => invoke(async () => getProductClient().listRoutingProposals()));

  server.registerTool('trace_routing_propose', {
    title: 'Propose a Trace finding route',
    description: 'Run the bounded deterministic Finding Router for one captured WorkflowFinding. It creates only a reviewable RoutingProposal; it does not adopt, publish a Skill or change canonical understanding.',
    inputSchema: {finding_id: z.string().min(1).max(512)},
  }, async ({finding_id}) => invoke(async () => getProductClient().proposeRouting({findingId: finding_id})));

  server.registerTool('trace_routing_decide', {
    title: 'Decide a Trace routing proposal',
    description: 'Adopt, trial or reject one routing proposal using compare-and-swap. Adoption creates only a receipt-backed route decision; it does not publish a Skill.',
    inputSchema: {proposal_id: z.string().min(1).max(512), action: z.enum(['adopt', 'trial', 'reject']), expected_revision: z.number().int().min(0), note: z.string().max(2_000).optional()},
  }, async ({proposal_id, action, expected_revision, note}) => invoke(async () => getProductClient().decideRouting({proposalId: proposal_id, action, expectedRevision: expected_revision, ...(note === undefined ? {} : {note})})));

  server.registerTool('trace_host_activation_query', {
    title: 'Show Trace activation for this Codex task',
    description: 'Offer a small activation pack from adopted findings, with trial items explicitly marked. The receipt is offered-not-used until a separate mark call.',
    inputSchema: {task_intent: z.string().max(8_000).optional(), project_ref: z.string().min(1).optional().describe('Optional absolute stable Product Workspace project binding; omit to use the attached session binding.'), include_trial: z.boolean().optional(), max_items: z.number().int().min(1).max(16).optional(), max_tokens: z.number().int().min(128).max(12_000).optional()},
  }, async ({task_intent, project_ref, include_trial, max_items, max_tokens}) => invoke(async () => getProductClient().queryActivation({...(task_intent === undefined ? {} : {taskIntent: task_intent}), ...(project_ref === undefined ? {} : {projectRef: project_ref}), ...(include_trial === undefined ? {} : {includeTrial: include_trial}), ...(max_items === undefined ? {} : {maxItems: max_items}), ...(max_tokens === undefined ? {} : {maxTokens: max_tokens})})));

  server.registerTool('trace_host_activation_mark', {
    title: 'Mark Trace activation receipt',
    description: 'Record whether an offered activation was used, affected work, dismissed, snoozed or released. Uses CAS and an idempotent receipt.',
    inputSchema: {receipt_id: z.string().min(1).max(512), status: z.enum(['used', 'affected', 'dismissed', 'snoozed', 'released']), expected_revision: z.number().int().min(0)},
  }, async ({receipt_id, status, expected_revision}) => invoke(async () => getProductClient().markActivation({receiptId: receipt_id, status, expectedRevision: expected_revision})));

  server.registerTool('trace_host_activation_history', {
    title: 'List Trace activation history',
    description: 'Read activation receipts and their current offered/used/affected/dismissed state for the current Codex session.',
    inputSchema: {},
  }, async () => invoke(async () => getProductClient().listActivationHistory()));

  server.registerTool('trace_sensemaking_worker_status', {
    title: 'Show Trace sensemaking worker status',
    description: 'Read resident sensemaking worker health, queue depth, failed count, profile identity, limits and last error. If the Product/Agent service is not running, return a recoverable error; never start or switch a profile silently.',
    inputSchema: {},
  }, async () => invoke(async () => getProductClient().sensemakingWorkerStatus()));

  server.registerTool('trace_sensemaking_worker_drain', {
    title: 'Drain Trace sensemaking jobs',
    description: 'Explicitly drain a bounded number of already queued HostTurn sensemaking jobs. The hook itself never waits for this worker; this call does not change routing or adoption policy.',
    inputSchema: {limit: z.number().int().min(1).max(1_000).optional()},
  }, async ({limit}) => invoke(async () => getProductClient().sensemakingWorkerDrain(limit ?? 16)));

  server.registerTool('trace_repository_preflight', {
    title: 'Suggest a Trace repository branch preflight',
    description: 'Read-only repository guard. It returns proceed-current, create-branch, use-managed-worktree, ask-user or block-dirty with a sanitized proposed branch; it never mutates git.',
    inputSchema: {repo_root: z.string().min(1), task_intent: z.string().max(8_000).optional(), execution_mode: z.enum(['local', 'managed-worktree', 'cloud', 'unknown']).optional(), proposal_id: z.string().min(1).max(512).optional(), user_requested_current_branch: z.boolean().optional()},
  }, async ({repo_root, task_intent, execution_mode, proposal_id, user_requested_current_branch}) => invoke(async () => getProductClient().repositoryPreflight({repoRoot: repo_root, ...(task_intent === undefined ? {} : {taskIntent: task_intent}), ...(execution_mode === undefined ? {} : {executionMode: execution_mode}), ...(proposal_id === undefined ? {} : {proposalId: proposal_id}), ...(user_requested_current_branch === undefined ? {} : {userRequestedCurrentBranch: user_requested_current_branch})})));

  server.registerTool('trace_repository_guard_apply', {
    title: 'Apply an adopted Trace repository guard',
    description: 'Create one proposed branch only after an adopted runtime-guard proposal, clean local state and a matching preflight CAS. Never pushes, merges, deletes or changes managed worktrees.',
    inputSchema: {preflight_id: z.string().min(1).max(512), proposal_id: z.string().min(1).max(512), expected_state_hash: z.string().regex(/^[a-f0-9]{64}$/), approval: z.string().min(1).max(600)},
  }, async ({preflight_id, proposal_id, expected_state_hash, approval}) => invoke(async () => getProductClient().repositoryGuardApply({preflightId: preflight_id, proposalId: proposal_id, expectedStateHash: expected_state_hash, approval})));

  server.registerTool('trace_repository_recovery_preview', {
    title: 'Preview repository guard recovery',
    description: 'Read-only crash recovery preview for a Repository Guard journal. It can recommend retryable, commit_receipt or recovery_required; it never switches, deletes, resets or cleans Git.',
    inputSchema: {journal_id: z.string().min(1).max(512).optional(), command_id: z.string().min(1).max(512).optional()},
  }, async ({journal_id, command_id}) => invoke(async () => getProductClient().repositoryRecoveryPreview({...(journal_id === undefined ? {} : {journalId: journal_id}), ...(command_id === undefined ? {} : {commandId: command_id})})));

  server.registerTool('trace_repository_recovery_reconcile', {
    title: 'Reconcile repository guard journal',
    description: 'Reconcile a journal only when the current Git branch, HEAD and clean state prove the prepared intent. Ambiguous state is recorded as recovery_required and no Git mutation is attempted.',
    inputSchema: {journal_id: z.string().min(1).max(512)},
  }, async ({journal_id}) => invoke(async () => getProductClient().repositoryRecoveryReconcile(journal_id)));

  server.registerTool('trace_repository_recovery_status', {
    title: 'List repository guard journals',
    description: 'Read Repository Guard journal states and recovery evidence without changing the repository.',
    inputSchema: {state: z.enum(['prepared', 'git_applied', 'receipt_committed', 'recovery_required', 'reconciled', 'failed']).optional()},
  }, async ({state}) => invoke(async () => getProductClient().repositoryRecoveryStatus(state)));

  server.registerTool('trace_publication_policy_preview', {
    title: 'Preview capability publication policy',
    description: 'Build a bounded standing PublicationPolicy preview. Preview is not adoption; ordinary prompts, findings and routing never create a policy.',
    inputSchema: {scope: z.enum(['personal', 'project', 'cross-project']), target_root: z.string().min(1), allowed_capability_kinds: z.array(z.string().min(1).max(64)).min(1).max(16).optional(), validation_requirements: z.record(z.string()).optional(), expires_at: z.string().nullable().optional()},
  }, async ({scope, target_root, allowed_capability_kinds, validation_requirements, expires_at}) => invoke(async () => getProductClient().previewPublicationPolicy({scope, targetRoot: target_root, ...(allowed_capability_kinds === undefined ? {} : {allowedCapabilityKinds: allowed_capability_kinds}), ...(validation_requirements === undefined ? {} : {validationRequirements: validation_requirements}), ...(expires_at === undefined ? {} : {expiresAt: expires_at})})));

  server.registerTool('trace_publication_policy_adopt', {
    title: 'Adopt capability publication policy',
    description: 'Adopt exactly the displayed PublicationPolicy with approval=adopt:<policy_id> supplied by the user. Policy scope, target root, allowed kinds, validation requirements and expiry are immutable after adoption.',
    inputSchema: {scope: z.enum(['personal', 'project', 'cross-project']), target_root: z.string().min(1), allowed_capability_kinds: z.array(z.string().min(1).max(64)).min(1).max(16).optional(), validation_requirements: z.record(z.string()).optional(), expires_at: z.string().nullable().optional(), approval: z.string().min(1).max(256)},
  }, async ({scope, target_root, allowed_capability_kinds, validation_requirements, expires_at, approval}) => invoke(async () => getProductClient().adoptPublicationPolicy({scope, targetRoot: target_root, ...(allowed_capability_kinds === undefined ? {} : {allowedCapabilityKinds: allowed_capability_kinds}), ...(validation_requirements === undefined ? {} : {validationRequirements: validation_requirements}), ...(expires_at === undefined ? {} : {expiresAt: expires_at}), approval})));

  server.registerTool('trace_publication_policy_revoke', {
    title: 'Revoke capability publication policy',
    description: 'Revoke a standing PublicationPolicy using CAS. Revocation immediately blocks subsequent capability publication.',
    inputSchema: {policy_id: z.string().min(1).max(512), expected_revision: z.number().int().min(0), reason: z.string().max(2_000).optional()},
  }, async ({policy_id, expected_revision, reason}) => invoke(async () => getProductClient().revokePublicationPolicy(policy_id, expected_revision, reason)));

  server.registerTool('trace_publication_policies_list', {
    title: 'List capability publication policies',
    description: 'List active, revoked and expired PublicationPolicy metadata; no raw HostTurn text is returned.',
    inputSchema: {status: z.enum(['active', 'revoked', 'expired']).optional()},
  }, async ({status}) => invoke(async () => getProductClient().listPublicationPolicies(status)));

  server.registerTool('trace_capability_orchestrations_list', {
    title: 'List capability candidate orchestrations',
    description: 'Read adopted capability-candidate orchestration states. Candidate, trial, producer_required, staged, validated, published and rolled_back remain distinct.',
    inputSchema: {status: z.enum(['candidate', 'trial_queued', 'staged', 'validated', 'published', 'rolled_back', 'producer_required', 'failed']).optional()},
  }, async ({status}) => invoke(async () => getProductClient().listCapabilityOrchestrations(status)));

  server.registerTool('trace_capability_trials_list', {
    title: 'List capability trials',
    description: 'Read first-class CapabilityTrial records with fixed capability hashes, evidence references and support/limit/challenge/inconclusive outcomes.',
    inputSchema: {orchestration_id: z.string().min(1).max(512).optional()},
  }, async ({orchestration_id}) => invoke(async () => getProductClient().listCapabilityTrials(orchestration_id)));

  server.registerTool('trace_capability_trial_create', {
    title: 'Queue a capability trial',
    description: 'Queue a bounded behavior trial for an adopted capability candidate. It records evidence references and never publishes a Skill.',
    inputSchema: {orchestration_id: z.string().min(1).max(512), expected_revision: z.number().int().min(0), capability_version: z.string().min(1).max(128), capability_hash: z.string().min(1).max(128), scenario: z.string().min(1).max(4_000), task: z.string().min(1).max(4_000), expected: z.string().min(1).max(8_000), host: z.string().max(512).optional(), model: z.string().max(256).optional(), tool_config: z.record(z.unknown()).optional(), evidence_refs: z.array(z.string().max(512)).max(64).optional()},
  }, async input => invoke(async () => getProductClient().createCapabilityTrial({orchestrationId: input.orchestration_id, expectedRevision: input.expected_revision, capabilityVersion: input.capability_version, capabilityHash: input.capability_hash, scenario: input.scenario, task: input.task, expected: input.expected, ...(input.host === undefined ? {} : {host: input.host}), ...(input.model === undefined ? {} : {model: input.model}), ...(input.tool_config === undefined ? {} : {toolConfig: input.tool_config}), ...(input.evidence_refs === undefined ? {} : {evidenceRefs: input.evidence_refs})})));

  server.registerTool('trace_capability_trial_complete', {
    title: 'Complete a capability trial',
    description: 'Record observed behavior and outcome for a queued CapabilityTrial. Evidence is required as references; a passing trial is not itself publication.',
    inputSchema: {trial_id: z.string().min(1).max(512), expected_revision: z.number().int().min(0), outcome: z.enum(['support', 'limit', 'challenge', 'inconclusive']), observed: z.string().min(1).max(8_000), evidence_refs: z.array(z.string().max(512)).max(64).optional()},
  }, async ({trial_id, expected_revision, outcome, observed, evidence_refs}) => invoke(async () => getProductClient().completeCapabilityTrial({trialId: trial_id, expectedRevision: expected_revision, outcome, observed, ...(evidence_refs === undefined ? {} : {evidenceRefs: evidence_refs})})));

  server.registerTool('trace_capability_stage', {
    title: 'Stage capability candidate',
    description: 'Record a candidate produced through the existing CapabilityPublisher/Change Set path. Without a verified candidate directory this remains producer_required and does not fabricate a Skill.',
    inputSchema: {orchestration_id: z.string().min(1).max(512), expected_revision: z.number().int().min(0), candidate_dir: z.string().min(1).optional(), manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), producer_status: z.enum(['required', 'staged']).optional()},
  }, async ({orchestration_id, expected_revision, candidate_dir, manifest_sha256, producer_status}) => invoke(async () => getProductClient().stageCapability({orchestrationId: orchestration_id, expectedRevision: expected_revision, ...(candidate_dir === undefined ? {} : {candidateDir: candidate_dir}), ...(manifest_sha256 === undefined ? {} : {manifestSha256: manifest_sha256}), ...(producer_status === undefined ? {} : {producerStatus: producer_status})})));

  server.registerTool('trace_capability_validate', {
    title: 'Validate capability candidate',
    description: 'Record independent schema, replay, behavior, rollback and source-hash validation for an immutable staged candidate. Validation failure is durable and fail-closed.',
    inputSchema: {orchestration_id: z.string().min(1).max(512), expected_revision: z.number().int().min(0), validation: z.object({schema: z.enum(['passed', 'failed', 'pending', 'not_run']), replay: z.enum(['passed', 'failed', 'pending', 'not_run']), behavior: z.enum(['passed', 'failed', 'pending', 'not_run']), rollback: z.enum(['passed', 'failed', 'pending', 'not_run']), source_hashes: z.enum(['passed', 'failed', 'pending', 'not_run'])}).strict()},
  }, async ({orchestration_id, expected_revision, validation}) => invoke(async () => getProductClient().validateCapability({orchestrationId: orchestration_id, expectedRevision: expected_revision, validation})));

  server.registerTool('trace_capability_publish', {
    title: 'Record capability publication',
    description: 'Finalize publication only after the existing CapabilityPublisher has actually published, all validation gates pass, hashes/provenance match and rollback evidence is present. Without a standing policy, approval=publish:<orchestration_id> is required.',
    inputSchema: {orchestration_id: z.string().min(1).max(512), expected_revision: z.number().int().min(0), policy_id: z.string().min(1).max(512).optional(), approval: z.string().max(2_000).optional(), publication_receipt: z.record(z.unknown()), rollback_receipt: z.string().min(1).max(4_000), producer_status: z.literal('published').optional()},
  }, async ({orchestration_id, expected_revision, policy_id, approval, publication_receipt, rollback_receipt, producer_status}) => invoke(async () => getProductClient().publishCapability({orchestrationId: orchestration_id, expectedRevision: expected_revision, ...(policy_id === undefined ? {} : {policyId: policy_id}), ...(approval === undefined ? {} : {approval}), publicationReceipt: publication_receipt, rollbackReceipt: rollback_receipt, ...(producer_status === undefined ? {} : {producerStatus: producer_status})})));

  server.registerTool('trace_capability_rollback', {
    title: 'Rollback published capability',
    description: 'Record rollback after the existing CapabilityPublisher restores its receipt-backed files. Product never performs push, delete or an independent publication.',
    inputSchema: {orchestration_id: z.string().min(1).max(512), expected_revision: z.number().int().min(0), rollback_receipt: z.string().min(1).max(4_000), producer_status: z.literal('rolled_back')},
  }, async ({orchestration_id, expected_revision, rollback_receipt, producer_status}) => invoke(async () => getProductClient().rollbackCapability({orchestrationId: orchestration_id, expectedRevision: expected_revision, rollbackReceipt: rollback_receipt, producerStatus: producer_status})));

  server.registerTool('trace_zhihu_status', {
    description: 'Inspect the local Zhihu provider and OAuth connection. No credentials, user data, login identity, or token is returned.', inputSchema: {},
  }, async () => invoke(() => zhihuClient.call('status')));
  for (const source of ['zhihu', 'global'] as const) server.registerTool(source === 'zhihu' ? 'trace_zhihu_search' : 'trace_global_search', {
    description: `Search ${source === 'zhihu' ? 'Zhihu community' : 'the wider web via Zhihu global search'} using the backend credential. Sends only this query. Returns bounded summaries, authors and actual provider URLs, not full articles or adopted understanding. No automatic capture.`,
    inputSchema: {query: z.string().min(1).max(500), count: z.number().int().min(1).max(source === 'zhihu' ? 10 : 20).optional(),
      ...(source === 'global' ? {filter: z.string().max(200).optional(), search_db: z.enum(['all', 'realtime', 'static']).optional()} : {})},
  }, async input => invoke(() => zhihuClient.search(source, input)));
  server.registerTool('trace_zhihu_login', {
    description: 'Only when the user asks to connect their Zhihu account: prepare a short-lived local authorization link. Give the link to the user to open and approve in their browser. Never complete approval yourself or ask for codes/tokens in chat. Does not read user data. Status alone is not verified account identity.', inputSchema: {},
  }, async () => invoke(() => zhihuClient.call('oauth/start', {})));
  server.registerTool('trace_zhihu_login_check', {
    description: 'After the user has authorized in their browser, finish the pending connection on the local backend. Returns status only; never returns codes, verifier, App Key or tokens. Call once on user return, not a polling loop.', inputSchema: {},
  }, async () => invoke(() => zhihuClient.call('oauth/check', {})));
  server.registerTool('trace_zhihu_disconnect', {
    description: 'When the user asks to disconnect: clear the current local OAuth connection and pending authorization. No provider-side token revocation endpoint is available; other sessions are not revoked.', inputSchema: {},
  }, async () => invoke(() => zhihuClient.call('oauth/disconnect', {})));
  server.registerTool('trace_zhihu_user_read', {
    description: 'Only on an explicit user request, read a bounded page of the OAuth-authorized user’s public content, recent favorites, favorite lists/items or followees. Never falls back to the developer account. No automatic pagination, account profiling, storage or adoption.',
    inputSchema: {kind: z.enum(['contents', 'favorites', 'favorite_lists', 'favorite_items', 'followees']), limit: z.number().int().min(1).max(20).optional(),
      offset: z.string().regex(/^(0|[1-9]\d{0,18})$/).optional(), favorite_id: z.string().regex(/^[1-9]\d{0,18}$/).optional()},
  }, async input => invoke(() => zhihuClient.call('user/read', input)));
  return server;
}

export async function startTraceMcpServer(): Promise<void> {
  const server = createTraceMcpServer();
  await server.connect(new StdioServerTransport());
}

const ownEntry = path.resolve(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === ownEntry) {
  startTraceMcpServer().catch(error => {
    const known = error as {message?: unknown};
    process.stderr.write(`Trace MCP failed to start: ${typeof known?.message === 'string' ? known.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
