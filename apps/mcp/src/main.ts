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
    const value = await new TraceProductClient().receive({projectDir: project_dir, ...(work_id === undefined ? {} : {workId: work_id})});
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
    const value = await new TraceProductClient().returnResult({
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

  server.registerTool('trace_zhihu_status', {
    description: 'Inspect the local Zhihu provider and OAuth connection. No credentials, user data, login identity, or token is returned.', inputSchema: {},
  }, async () => invoke(() => new TraceZhihuClient().call('status')));
  for (const source of ['zhihu', 'global'] as const) server.registerTool(source === 'zhihu' ? 'trace_zhihu_search' : 'trace_global_search', {
    description: `Search ${source === 'zhihu' ? 'Zhihu community' : 'the wider web via Zhihu global search'} using the backend credential. Sends only this query. Returns bounded summaries, authors and actual provider URLs, not full articles or adopted understanding. No automatic capture.`,
    inputSchema: {query: z.string().min(1).max(500), count: z.number().int().min(1).max(source === 'zhihu' ? 10 : 20).optional(),
      ...(source === 'global' ? {filter: z.string().max(200).optional(), search_db: z.enum(['all', 'realtime', 'static']).optional()} : {})},
  }, async input => invoke(() => new TraceZhihuClient().search(source, input)));
  server.registerTool('trace_zhihu_login', {
    description: 'Only when the user asks to connect their Zhihu account: prepare a short-lived local authorization link. Give the link to the user to open and approve in their browser. Never complete approval yourself or ask for codes/tokens in chat. Does not read user data. Status alone is not verified account identity.', inputSchema: {},
  }, async () => invoke(() => new TraceZhihuClient().call('oauth/start', {})));
  server.registerTool('trace_zhihu_login_check', {
    description: 'After the user has authorized in their browser, finish the pending connection on the local backend. Returns status only; never returns codes, verifier, App Key or tokens. Call once on user return, not a polling loop.', inputSchema: {},
  }, async () => invoke(() => new TraceZhihuClient().call('oauth/check', {})));
  server.registerTool('trace_zhihu_disconnect', {
    description: 'When the user asks to disconnect: clear the current local OAuth connection and pending authorization. No provider-side token revocation endpoint is available; other sessions are not revoked.', inputSchema: {},
  }, async () => invoke(() => new TraceZhihuClient().call('oauth/disconnect', {})));
  server.registerTool('trace_zhihu_user_read', {
    description: 'Only on an explicit user request, read a bounded page of the OAuth-authorized user’s public content, recent favorites, favorite lists/items or followees. Never falls back to the developer account. No automatic pagination, account profiling, storage or adoption.',
    inputSchema: {kind: z.enum(['contents', 'favorites', 'favorite_lists', 'favorite_items', 'followees']), limit: z.number().int().min(1).max(20).optional(),
      offset: z.string().regex(/^(0|[1-9]\d{0,18})$/).optional(), favorite_id: z.string().regex(/^[1-9]\d{0,18}$/).optional()},
  }, async input => invoke(() => new TraceZhihuClient().call('user/read', input)));
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
