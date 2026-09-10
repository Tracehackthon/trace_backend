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
  type CodexHookInput,
  type ProfileUpdateInput,
  type ProjectInitializeInput,
} from '../../../packages/product/application/src/index.js';
import type {ProjectActivationConfigurationInput, ProjectSourceProfileInput} from '../../../packages/core/instance/src/index.js';

function textResult(value: unknown, isError = false) {
  return {content: [{type: 'text' as const, text: JSON.stringify(value, null, 2)}], ...(isError ? {isError: true} : {})};
}

function errorResult(error: unknown) {
  const known = error as {code?: unknown; message?: unknown};
  return textResult({ok: false, error: {code: typeof known?.code === 'string' ? known.code : 'TRACE_MCP_ERROR', message: error instanceof Error ? error.message : String(error)}}, true);
}

async function invoke(operation: () => unknown) {
  try {
    const value = operation();
    const payload = value && typeof value === 'object' && !Array.isArray(value) ? {ok: true, ...(value as Record<string, unknown>)} : {ok: true, result: value};
    return textResult(payload);
  } catch (error) { return errorResult(error); }
}

function optionalProject(project_dir: string | undefined): {project_dir?: string} { return project_dir === undefined ? {} : {project_dir}; }
function optionalHook(project_dir: string | undefined, hooks_file: string | undefined): CodexHookInput {
  return {...optionalProject(project_dir), ...(hooks_file === undefined ? {} : {hooks_file})};
}

const projectDirectory = {project_dir: z.string().min(1).optional().describe('Existing project directory. Omit to use the host process working directory.')};
const sourceMode = z.enum(['local', 'external', 'team', 'empty']);
const sourceProfile = z.record(z.unknown()).describe('A structured source profile prepared from the user-adopted source selection; it is not shown as CLI JSON to the user.');
const activationConfiguration = z.object({
  collaboration_model: z.record(z.unknown()),
  source_activation: z.record(z.unknown()),
}).describe('A structured configuration prepared from a user-visible semantic proposal.');

export function createTraceMcpServer(): McpServer {
  const server = new McpServer({name: 'trace', version: '0.1.0'}, {capabilities: {logging: {}}});

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
