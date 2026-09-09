import fs from 'node:fs';
import path from 'node:path';
import {TraceRuntime} from '../../../packages/core/runtime/src/index.js';
import {CHANGE_KINDS, CHANGE_STATUSES, type ChangeKind, type ChangeStatus, type ChangeLineage, type Compatibility, type ScopeType, type Validation, ProtocolError} from '../../../packages/core/protocol/src/index.js';
import {DATA_KINDS, type DataKind} from '../../../packages/core/data/src/index.js';
import {StorageError} from '../../../packages/core/storage/src/index.js';
import {buildActivationPack} from '../../../packages/core/context/src/index.js';
import {buildTemplateLock, previewTemplate, validateTemplateManifest, type TemplateInstanceLock} from '../../../packages/template/contract/src/index.js';
import {createHash} from 'node:crypto';
import {migrateJsonlToSqlite} from '../../../packages/core/migration/src/index.js';
import {CapabilityPublisher} from '../../../packages/core/capability/src/index.js';
import {backupSqlite, doctorSqlite, restoreSqlite} from '../../../packages/core/operations/src/index.js';
import {activateCodexTurn, buildCodexHookOutput} from '../../codex/src/index.js';
import {ZhihuHttpTransport} from '../../../packages/integration/zhihu-transport/src/index.js';
import {MyWikiSourceProvider, type MyWikiSourceProfile} from '../../../packages/integration/mywiki-source/src/index.js';
import {CodexSkillInstaller} from '../../../packages/host/codex-skill/src/index.js';
import {CodexHookInstaller} from '../../../packages/host/codex-hooks/src/index.js';
import {SELECTABLE_TEMPLATES} from '../../../packages/template/catalog/src/index.js';
import {initializeProject, type ProjectSourceMode, type ProjectSourceProfileInput} from '../../../packages/core/instance/src/index.js';
import {hashTransientPrompt} from '../../../packages/core/case-capture/src/index.js';

const USAGE = [
    'Usage:',
    '  state flags: use --sqlite-state-file ABS, or both --change-state-file ABS --data-state-file ABS; --continuity-state-file ABS is optional for JSONL',
    '  trace-runtime change create [state flags] --change-kind KIND --subject-type TYPE --subject-id ID --base JSON --proposed JSON --impact ITEM [--impact ITEM] --compatibility JSON --requested-by ID --scope-type TYPE --scope-id ID --lineage JSON [--note TEXT]',
    '  trace-runtime change update [state flags] --change-id ID --expected-revision N --status STATUS [--schema STATE] [--replay STATE] [--behavior STATE] [--decided-by ID] [--promotion-target ID] [--rollback-target ID] [--rollback-reason TEXT] [--lineage JSON] [--note TEXT]',
    '  trace-runtime change list [state flags] [--status STATUS]',
    '  trace-runtime data create [state flags] --kind KIND --schema-id ID --schema-version VERSION --subject-type TYPE --subject-id ID --scope-type TYPE --scope-id ID --origin JSON --producer JSON --lineage JSON --classification LEVEL --payload JSON',
    '  trace-runtime data list [state flags] [--kind KIND]',
    '  trace-runtime data verify [state flags] --record-id ID',
    '  trace-runtime prompt-case propose --sqlite-state-file ABS --prompt-file ABS --mode summary|redacted_excerpt|full_private --intent-summary TEXT --rationale TEXT --scope-type TYPE --scope-id ID --producer JSON --correlation-id ID --causation-id ID [--thread-id ID] [--redacted-preview TEXT]',
    '  trace-runtime prompt-case capture --sqlite-state-file ABS --proposal-ref JSON --approval approve:RECORD_ID --content-file ABS --producer JSON --correlation-id ID --causation-id ID [--title TEXT] [--classification public|internal|private|secret]',
    '  trace-runtime prompt-case precedent --sqlite-state-file ABS --candidate-id ID --prompt-source-ref JSON --outcome-ref JSON --claim TEXT --rationale TEXT --scope-type TYPE --scope-id ID --origin JSON --producer JSON --classification LEVEL --change-id ID --correlation-id ID --causation-id ID',
    '  trace-runtime continuity thread-create [state flags] --title TEXT --summary TEXT [--question TEXT] [--next-action TEXT] [--correlation-id ID --causation-id ID]',
    '  trace-runtime continuity turn-create [state flags] --thread-id ID --input-summary TEXT --output-summary TEXT --delta-type TYPE [--context-ref REF] [--persisted-ref REF] [--question TEXT] [--correlation-id ID --causation-id ID]',
    '  trace-runtime continuity receipt-create [state flags] --thread-id ID --receipt-kind persistence|activation --summary TEXT [--persisted-ref REF] [--activated-ref REF] [--not-persisted TEXT] [--next-prompt TEXT] [--required-action TEXT] [--correlation-id ID --causation-id ID]',
    '  trace-runtime continuity list [state flags] [--thread-id ID]',
    '  trace-runtime context build --purpose TEXT --summary TEXT --source-ref JSON [--pointer JSON] [--max-tokens N] [--max-sources N] [--forbidden-scope TEXT]',
    '  trace-runtime template preview --manifest ABS [--existing-lock ABS]',
    '  trace-runtime template lock --manifest ABS --runtime-version VERSION --instance-id ID [--output ABS]',
    '  trace-runtime template install --manifest ABS --runtime-version VERSION --instance-id ID --instance-dir ABS --confirm true [--source-profile ABS]',
    '  trace-runtime template list',
    '  trace-runtime project init --project-dir ABS --user-id ID [--template ID] [--template-manifest ABS] [--source-mode local|external|team|empty] [--source-root ABS --source-id ID | --source-profile ABS] [--instance-id ID] [--runtime-version VERSION] --confirm true',
    '  trace-runtime migrate sqlite --change-state-file ABS --data-state-file ABS --sqlite-state-file ABS [--report ABS]',
    '  trace-runtime capability preview|stage|validate|publish|rollback ... [--sqlite-state-file <absolute-path>]',
    '  trace-runtime codex activate --sqlite-state-file ABS --purpose TEXT --summary TEXT --source-ref JSON [--pointer JSON] [--thread-id ID] [--correlation-id ID --causation-id ID] [--forbidden-scope TEXT]',
    '  trace-runtime codex trigger --sqlite-state-file ABS --event-file ABS',
    '  trace-runtime codex hook-stdio --sqlite-state-file ABS [--source-profile ABS]',
    '  trace-runtime zhihu search|global-search|hot --profile ABS --query TEXT|--limit N [--capture-run-id ID --sqlite-state-file ABS]',
    '  trace-runtime mywiki read|search|propose|apply --profile ABS ...',
    '  trace-runtime skill preview|install|rollback ...',
    '  trace-runtime hooks preview|install|rollback ...',
    '  trace-runtime doctor run --sqlite-state-file ABS [--correlation-id ID]',
    '  trace-runtime backup create --sqlite-state-file ABS --backup-file ABS',
    '  trace-runtime restore run --backup-file ABS --sqlite-state-file ABS [--replace true]',
  ].join('\n');

function usage(): never {
  throw new ProtocolError('INVALID_INPUT', USAGE);
}

function printUsage(): void {
  process.stdout.write(USAGE + '\n');
}

function args(argv: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith('--')) throw new ProtocolError('INVALID_INPUT', `Unexpected argument: ${key ?? ''}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new ProtocolError('INVALID_INPUT', `${key} requires a value`);
    const values = result.get(key) ?? [];
    values.push(value);
    result.set(key, values);
  }
  return result;
}

function one(parsed: Map<string, string[]>, name: string, required = true): string | undefined {
  const values = parsed.get(name) ?? [];
  if (values.length > 1) throw new ProtocolError('INVALID_INPUT', `${name} may appear only once`);
  if (required && !values[0]) throw new ProtocolError('INVALID_INPUT', `${name} is required`);
  return values[0];
}

function readJsonFile(file: string, field: string): Record<string, unknown> {
  if (!path.isAbsolute(file)) throw new ProtocolError('INVALID_INPUT', `${field} must be absolute`);
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object');
    return value as Record<string, unknown>;
  } catch { throw new ProtocolError('INVALID_INPUT', `${field} must point to a valid JSON object`); }
}

function manifestFor(parsed: Map<string, string[]>): {manifest: ReturnType<typeof validateTemplateManifest>; templateId: string} {
  const explicit = one(parsed, '--template-manifest', false);
  if (explicit !== undefined) { const manifest = validateTemplateManifest(readJsonFile(explicit, '--template-manifest')); return {manifest, templateId: manifest.bundle_id}; }
  const templateId = one(parsed, '--template', false) ?? 'trace.codex-starter';
  const entry = SELECTABLE_TEMPLATES.find(item => item.id === templateId);
  if (!entry) throw new ProtocolError('INVALID_INPUT', `unknown template: ${templateId}`);
  const roots = [
    process.env.TRACE_TEMPLATE_ROOT,
    path.resolve(process.cwd(), 'templates'),
    path.resolve(path.dirname(process.argv[1] ?? process.cwd()), '../../../../templates'),
    path.resolve(path.dirname(process.argv[1] ?? process.cwd()), '../../../../../templates'),
  ].filter((value): value is string => typeof value === 'string' && path.isAbsolute(value));
  for (const root of roots) {
    const manifestPath = path.resolve(root, entry.manifest_path.replace(/^templates[\\/]/, ''));
    if (fs.existsSync(manifestPath)) return {manifest: validateTemplateManifest(readJsonFile(manifestPath, '--template')), templateId};
  }
  throw new ProtocolError('IO_ERROR', `cannot locate manifest for ${templateId}; pass --template-manifest ABS`);
}

function runtimeVersionFor(parsed: Map<string, string[]>): string {
  const explicit = one(parsed, '--runtime-version', false);
  if (explicit !== undefined) return explicit;
  const runtimeRoot = process.env.TRACE_RUNTIME_ROOT;
  const roots = [
    runtimeRoot === undefined ? undefined : path.resolve(runtimeRoot, 'runtime.json'),
    path.resolve(process.cwd(), 'package.json'),
    path.resolve(process.cwd(), 'runtime.json'),
    path.resolve(path.dirname(process.argv[1] ?? process.cwd()), '../../../../package.json'),
    path.resolve(path.dirname(process.argv[1] ?? process.cwd()), '../../../../runtime.json'),
    path.resolve(path.dirname(process.argv[1] ?? process.cwd()), '../../../../../package.json'),
    path.resolve(path.dirname(process.argv[1] ?? process.cwd()), '../../../../../runtime.json'),
  ].filter((value): value is string => value !== undefined);
  for (const candidate of roots) {
    if (!fs.existsSync(candidate)) continue;
    try { const value = JSON.parse(fs.readFileSync(candidate, 'utf8')) as {version?: unknown; runtime_version?: unknown}; const version = value.version ?? value.runtime_version; if (typeof version === 'string' && version.length > 0) return version; } catch { /* keep looking */ }
  }
  throw new ProtocolError('INVALID_INPUT', 'cannot resolve runtime version; pass --runtime-version VERSION');
}

function defaultInstanceId(projectDir: string): string { return `trace-${path.basename(path.resolve(projectDir)).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'project'}`; }

function jsonValue(raw: string | undefined, field: string): Record<string, unknown> {
  if (!raw) throw new ProtocolError('INVALID_INPUT', `${field} is required`);
  const source = raw.startsWith('@') ? fs.readFileSync(path.resolve(raw.slice(1)), 'utf8') : raw;
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new ProtocolError('INVALID_INPUT', `${field} must be valid JSON or @FILE`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProtocolError('INVALID_INPUT', `${field} must be a JSON object`);
  return value as Record<string, unknown>;
}

function result(value: unknown): void {
  process.stdout.write(JSON.stringify({ok: true, ...value as object}) + '\n');
}

function runtimePaths(parsed: Map<string, string[]>): {changeStateFile?: string; dataStateFile?: string; continuityStateFile?: string; sqliteStateFile?: string} {
  const sqlite = one(parsed, '--sqlite-state-file', false);
  const change = one(parsed, '--change-state-file', false);
  const data = one(parsed, '--data-state-file', false);
  const continuity = one(parsed, '--continuity-state-file', false);
  if (sqlite && (change || data || continuity)) throw new ProtocolError('INVALID_INPUT', '--sqlite-state-file cannot be combined with JSONL state flags');
  if (!sqlite && (!change || !data)) throw new ProtocolError('INVALID_INPUT', 'provide --sqlite-state-file or both --change-state-file and --data-state-file');
  return sqlite ? {sqliteStateFile: sqlite} : {changeStateFile: change!, dataStateFile: data!, ...(continuity === undefined ? {} : {continuityStateFile: continuity})};
}

function traceLineageArgs(parsed: Map<string, string[]>): {correlation_id?: string; causation_id?: string} {
  const correlationId = one(parsed, '--correlation-id', false);
  const causationId = one(parsed, '--causation-id', false);
  return {
    ...(correlationId === undefined ? {} : {correlation_id: correlationId}),
    ...(causationId === undefined ? {} : {causation_id: causationId}),
  };
}

export async function run(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) { printUsage(); return; }
  const [group, action, ...rest] = argv;
  if (!['change', 'data', 'prompt-case', 'continuity', 'context', 'template', 'project', 'migrate', 'capability', 'codex', 'zhihu', 'mywiki', 'skill', 'hooks', 'doctor', 'backup', 'restore'].includes(group ?? '') || !action) usage();
  const parsed = args(rest);
  if (group === 'context' && action === 'build') {
    const sourceRefs = parsed.get('--source-ref')?.map(value => jsonValue(value, '--source-ref')) ?? [];
    const pointers = parsed.get('--pointer')?.map(value => jsonValue(value, '--pointer')) ?? [];
    const pack = buildActivationPack({purpose: one(parsed, '--purpose')!, summary: one(parsed, '--summary')!, source_refs: sourceRefs as never, read_pointers: pointers as never, budget: {max_tokens: Number(one(parsed, '--max-tokens', false) ?? 6000), max_sources: Number(one(parsed, '--max-sources', false) ?? 16)}, forbidden_scopes: parsed.get('--forbidden-scope') ?? []});
    result({status: 'built', pack});
    return;
  }
  if (group === 'project' && action === 'init') {
    const projectDir = one(parsed, '--project-dir')!;
    if (one(parsed, '--confirm') !== 'true') throw new ProtocolError('USER_CONFIRMATION_REQUIRED', 'project init requires --confirm true');
    const {manifest, templateId} = manifestFor(parsed);
    const requestedMode = one(parsed, '--source-mode', false) as ProjectSourceMode | undefined;
    const sourceMode = requestedMode ?? (manifest.cognitive_source?.mode === 'team-shared' ? 'team' : manifest.cognitive_source?.mode === 'isolated-empty' ? 'empty' : 'local');
    if (!['local', 'external', 'team', 'empty'].includes(sourceMode)) throw new ProtocolError('INVALID_INPUT', '--source-mode must be local, external, team, or empty');
    const sourceProfilePath = one(parsed, '--source-profile', false);
    const sourceProfile = sourceProfilePath === undefined ? undefined : readJsonFile(sourceProfilePath, '--source-profile') as unknown as ProjectSourceProfileInput;
    const resultValue = initializeProject({
      project_dir: projectDir,
      manifest,
      runtime_version: runtimeVersionFor(parsed),
      instance_id: one(parsed, '--instance-id', false) ?? defaultInstanceId(projectDir),
      user_id: one(parsed, '--user-id')!,
      source_mode: sourceMode,
      ...(one(parsed, '--source-root', false) === undefined ? {} : {source_root: one(parsed, '--source-root', false)!}),
      ...(one(parsed, '--source-id', false) === undefined ? {} : {source_id: one(parsed, '--source-id', false)!}),
      ...(sourceProfile === undefined ? {} : {source_profile: sourceProfile}),
    });
    result({status: 'initialized', template_id: templateId, ...resultValue});
    return;
  }
  if (group === 'template') {
    if (action === 'list') { result({status: 'listed', templates: SELECTABLE_TEMPLATES}); return; }
    const manifestPath = one(parsed, '--manifest')!;
    const manifest = validateTemplateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    if (action === 'preview') {
      const existingPath = one(parsed, '--existing-lock', false);
      const existing = existingPath ? JSON.parse(fs.readFileSync(existingPath, 'utf8')) : undefined;
      result({status: 'previewed', preview: previewTemplate(manifest, existing)});
      return;
    }
    if (action === 'lock') {
      const lock = buildTemplateLock(manifest, one(parsed, '--runtime-version')!, one(parsed, '--instance-id')!);
      const output = one(parsed, '--output', false);
      if (output) { fs.mkdirSync(path.dirname(output), {recursive: true}); fs.writeFileSync(output, JSON.stringify(lock, null, 2) + '\n', 'utf8'); }
      result({status: 'locked', lock, ...(output === undefined ? {} : {output})});
      return;
    }
    if (action === 'install') {
      const instanceDir = one(parsed, '--instance-dir')!;
      if (!path.isAbsolute(instanceDir)) throw new ProtocolError('INVALID_INPUT', '--instance-dir must be absolute');
      if (one(parsed, '--confirm') !== 'true') throw new ProtocolError('USER_CONFIRMATION_REQUIRED', 'template install requires --confirm true');
      const lockPath = path.join(instanceDir, 'trace.lock.json');
      if (fs.existsSync(lockPath)) throw new ProtocolError('INSTANCE_EXISTS', `Template instance already exists: ${instanceDir}`);
      const sourceProfilePath = one(parsed, '--source-profile', false);
      if (manifest.cognitive_source?.selection_required && sourceProfilePath === undefined) throw new ProtocolError('SOURCE_SELECTION_REQUIRED', 'this template requires an explicit --source-profile');
      let selectedSource: TemplateInstanceLock['selected_source'];
      if (sourceProfilePath !== undefined) { const profileText = fs.readFileSync(sourceProfilePath, 'utf8'); const profile = JSON.parse(profileText) as Record<string, unknown>; if (typeof profile.source_id !== 'string' || typeof profile.user_id !== 'string') throw new ProtocolError('INVALID_INPUT', 'source profile must contain source_id and user_id'); const scopeType = manifest.cognitive_source?.allowed_scope_types[0] ?? 'personal'; selectedSource = {source_id: profile.source_id, profile_hash: createHash('sha256').update(profileText, 'utf8').digest('hex'), scope_type: scopeType}; }
      const lock = buildTemplateLock(manifest, one(parsed, '--runtime-version')!, one(parsed, '--instance-id')!, new Date().toISOString(), selectedSource);
      fs.mkdirSync(instanceDir, {recursive: true});
      fs.writeFileSync(path.join(instanceDir, 'template.manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
      if (sourceProfilePath !== undefined) fs.copyFileSync(sourceProfilePath, path.join(instanceDir, 'source.profile.json'));
      result({status: 'installed', instance_dir: instanceDir, lock});
      return;
    }
    usage();
  }
  if (group === 'migrate' && action === 'sqlite') {
    const report = migrateJsonlToSqlite({changeStateFile: one(parsed, '--change-state-file')!, dataStateFile: one(parsed, '--data-state-file')!, sqliteStateFile: one(parsed, '--sqlite-state-file')!});
    const reportPath = one(parsed, '--report', false);
    if (reportPath) { fs.mkdirSync(path.dirname(reportPath), {recursive: true}); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8'); }
    result({status: 'migrated', report, ...(reportPath === undefined ? {} : {report_path: reportPath})});
    return;
  }
  if (group === 'doctor' && action === 'run') {
    const correlationId = one(parsed, '--correlation-id', false);
    result(doctorSqlite(one(parsed, '--sqlite-state-file')!, correlationId === undefined ? {} : {correlation_id: correlationId}));
    return;
  }
  if (group === 'backup' && action === 'create') {
    result(backupSqlite(one(parsed, '--sqlite-state-file')!, one(parsed, '--backup-file')!));
    return;
  }
  if (group === 'restore' && action === 'run') {
    result(restoreSqlite(one(parsed, '--backup-file')!, one(parsed, '--sqlite-state-file')!, one(parsed, '--replace', false) === 'true'));
    return;
  }
  if (group === 'capability') {
    const capabilityStateFile = one(parsed, '--sqlite-state-file', false);
    const capabilityRuntime = capabilityStateFile === undefined ? undefined : new TraceRuntime({sqliteStateFile: capabilityStateFile});
    const publisher = new CapabilityPublisher(capabilityRuntime === undefined ? {} : {resolveCapabilityCandidate: candidateRef => capabilityRuntime.data.get(candidateRef.record_id, candidateRef.revision)});
    if (action === 'preview') {
      const specPath = one(parsed, '--spec')!; const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
      result({status: 'previewed', preview: publisher.preview(spec, one(parsed, '--candidate-dir', false))});
      return;
    }
    if (action === 'stage') {
      const specPath = one(parsed, '--spec')!; const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
      result({status: 'staged', manifest: publisher.stage(spec, one(parsed, '--candidate-dir')!)});
      return;
    }
    if (action === 'validate') { result({status: 'validated', manifest: publisher.validate(one(parsed, '--candidate-dir')!)}); return; }
    if (action === 'publish') { result({status: 'published', receipt: publisher.publish(one(parsed, '--candidate-dir')!, one(parsed, '--approval')!, one(parsed, '--receipt')!)}); return; }
    if (action === 'rollback') { result(publisher.rollback(one(parsed, '--receipt')!)); return; }
  }
  if (group === 'codex' && action === 'activate') {
    const sourceRefs = parsed.get('--source-ref')?.map(value => jsonValue(value, '--source-ref')) ?? [];
    const pointers = parsed.get('--pointer')?.map(value => jsonValue(value, '--pointer')) ?? [];
    const sqliteStateFile = one(parsed, '--sqlite-state-file')!;
    const runtime = new TraceRuntime({sqliteStateFile});
    const threadId = one(parsed, '--thread-id', false);
    const event = {event_type: 'codex.turn.started' as const, ...(threadId === undefined ? {} : {thread_id: threadId}), ...traceLineageArgs(parsed), purpose: one(parsed, '--purpose')!, summary: one(parsed, '--summary')!, source_refs: sourceRefs as never, read_pointers: pointers as never, forbidden_scopes: parsed.get('--forbidden-scope') ?? [], max_tokens: Number(one(parsed, '--max-tokens', false) ?? 6000)};
    result({status: 'activated', ...activateCodexTurn(runtime, event)});
    return;
  }
  if (group === 'codex' && action === 'trigger') {
    const eventFile = one(parsed, '--event-file')!;
    if (!path.isAbsolute(eventFile)) throw new ProtocolError('INVALID_INPUT', '--event-file must be absolute');
    let event: unknown;
    try { event = JSON.parse(fs.readFileSync(eventFile, 'utf8')); } catch { throw new ProtocolError('INVALID_INPUT', '--event-file must contain valid JSON'); }
    if (!event || typeof event !== 'object' || (event as Record<string, unknown>).event_type !== 'codex.turn.started') throw new ProtocolError('INVALID_INPUT', 'event_type must be codex.turn.started');
    const runtime = new TraceRuntime({sqliteStateFile: one(parsed, '--sqlite-state-file')!});
    result({status: 'triggered', ...activateCodexTurn(runtime, event as Parameters<typeof activateCodexTurn>[1])});
    return;
  }
  if (group === 'codex' && action === 'hook-stdio') {
    let event: unknown;
    try { event = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { throw new ProtocolError('INVALID_INPUT', 'stdin must contain a valid Codex hook JSON event'); }
    if (!event || typeof event !== 'object') throw new ProtocolError('INVALID_INPUT', 'Codex hook event must be an object');
    const profilePath = one(parsed, '--source-profile', false);
    const sourceProfile = profilePath === undefined ? undefined : JSON.parse(fs.readFileSync(profilePath, 'utf8')) as MyWikiSourceProfile;
    const runtime = new TraceRuntime({sqliteStateFile: one(parsed, '--sqlite-state-file')!});
    process.stdout.write(JSON.stringify(buildCodexHookOutput(event as Parameters<typeof buildCodexHookOutput>[0], runtime, sourceProfile)) + '\n');
    return;
  }
  if (group === 'zhihu') {
    const profile = JSON.parse(fs.readFileSync(one(parsed, '--profile')!, 'utf8')) as Record<string, unknown>;
    const transport = new ZhihuHttpTransport({platform_base_url: String(profile.platform_base_url), hackathon_base_url: String(profile.hackathon_base_url), access_secret_env: String(profile.access_secret_env ?? 'ZHIHU_ACCESS_SECRET'), timeout_ms: Number(profile.timeout_ms ?? 15000), ...(profile.user_agent === undefined ? {} : {user_agent: String(profile.user_agent)})});
    let response: unknown;
    if (action === 'search') response = await transport.search(one(parsed, '--query')!, Number(one(parsed, '--count', false) ?? 10));
    else if (action === 'global-search') response = await transport.globalSearch(one(parsed, '--query')!, Number(one(parsed, '--count', false) ?? 20), one(parsed, '--filter', false), one(parsed, '--search-db', false));
    else if (action === 'hot') response = await transport.hotList(Number(one(parsed, '--limit', false) ?? 10));
    else usage();
    const captureRun = one(parsed, '--capture-run-id', false);
    if (captureRun) {
      const sqlite = one(parsed, '--sqlite-state-file')!; const runtime = new TraceRuntime({sqliteStateFile: sqlite}); const items = ((response as {Data?: {Items?: unknown[]}}).Data?.Items ?? []); const records = [];
      for (const item of items) { const record = await transport.captureSearchItem(item as never, {run_id: captureRun}); records.push(runtime.createData(record)); }
      result({status: 'captured', response, records});
    } else result({status: 'fetched', response});
    return;
  }
  if (group === 'mywiki') {
    const profile = JSON.parse(fs.readFileSync(one(parsed, '--profile')!, 'utf8')) as MyWikiSourceProfile; const provider = new MyWikiSourceProvider(profile);
    if (action === 'read') { const page = provider.readPage(one(parsed, '--page')!); result({status: 'read', page}); return; }
    if (action === 'search') { result({status: 'searched', pages: provider.search(one(parsed, '--query')!, Number(one(parsed, '--limit', false) ?? 20)).map(page => ({...page, markdown: undefined, body: undefined, absolute_path: undefined}))}); return; }
    if (action === 'propose') { const proposal = provider.proposeWrite({relative_path: one(parsed, '--page')!, expected_revision: Number(one(parsed, '--expected-revision')), expected_hash: one(parsed, '--expected-hash')!, next_markdown: fs.readFileSync(one(parsed, '--next-file')!, 'utf8'), reason: one(parsed, '--reason')!, requested_by: one(parsed, '--requested-by')!}); result({status: 'proposed', proposal}); return; }
    if (action === 'apply') { const proposal = JSON.parse(fs.readFileSync(one(parsed, '--proposal')!, 'utf8')); const receipt = provider.applyWrite(proposal, one(parsed, '--approval')!, one(parsed, '--backup-root')!); result({status: 'applied', receipt}); return; }
    usage();
  }
  if (group === 'skill') {
    const installer = new CodexSkillInstaller(one(parsed, '--skill-root', false));
    if (action === 'preview') { result({status: 'previewed', preview: installer.preview(one(parsed, '--source-dir')!, one(parsed, '--skill-name', false))}); return; }
    if (action === 'install') { const skillName = one(parsed, '--skill-name', false); result({status: 'installed', receipt: installer.install(one(parsed, '--source-dir')!, { ...(skillName === undefined ? {} : {skill_name: skillName}), backup_root: one(parsed, '--backup-root')!, approval: one(parsed, '--approval')!})}); return; }
    if (action === 'rollback') { result({status: 'rolled_back', receipt: installer.rollback(JSON.parse(fs.readFileSync(one(parsed, '--receipt')!, 'utf8')))}); return; }
    usage();
  }
  if (group === 'hooks') {
    const installer = new CodexHookInstaller(one(parsed, '--hooks-file', false));
    const eventNames = parsed.get('--event'); const options = {command: one(parsed, '--command')!, ...(eventNames === undefined ? {} : {events: eventNames}), timeout: Number(one(parsed, '--timeout', false) ?? 10), context_limit: Number(one(parsed, '--context-limit', false) ?? 2500)};
    if (action === 'preview') { result({status: 'previewed', preview: installer.preview(options)}); return; }
    if (action === 'install') { result({status: 'installed', receipt: installer.install({...options, backup_root: one(parsed, '--backup-root')!, approval: one(parsed, '--approval')!})}); return; }
    if (action === 'rollback') { result({status: 'rolled_back', receipt: installer.rollback(JSON.parse(fs.readFileSync(one(parsed, '--receipt')!, 'utf8')))}); return; }
    usage();
  }
  const runtime = new TraceRuntime(runtimePaths(parsed));
  if (group === 'prompt-case') {
    const scopeType = one(parsed, '--scope-type', false);
    const scopeId = one(parsed, '--scope-id', false);
    const producer = (name = '--producer') => jsonValue(one(parsed, name), name) as never;
    const lineage = traceLineageArgs(parsed);
    if (lineage.correlation_id === undefined || lineage.causation_id === undefined) throw new ProtocolError('INVALID_INPUT', 'prompt-case requires --correlation-id and --causation-id');
    if (action === 'propose') {
      if (!scopeType || !scopeId || !['personal', 'project', 'team', 'domain'].includes(scopeType)) throw new ProtocolError('INVALID_INPUT', 'prompt-case propose requires a supported --scope-type and --scope-id');
      const promptFile = one(parsed, '--prompt-file')!;
      if (!path.isAbsolute(promptFile)) throw new ProtocolError('INVALID_INPUT', '--prompt-file must be absolute');
      const proposal = runtime.proposePromptCase({prompt_hash: hashTransientPrompt(fs.readFileSync(promptFile, 'utf8')), capture_mode: one(parsed, '--mode')! as never, intent_summary: one(parsed, '--intent-summary')!, rationale: one(parsed, '--rationale')!, scope: {type: scopeType as ScopeType, id: scopeId}, producer: producer(), correlation_id: lineage.correlation_id, causation_id: lineage.causation_id, ...(one(parsed, '--thread-id', false) === undefined ? {} : {thread_id: one(parsed, '--thread-id', false)!}), ...(one(parsed, '--redacted-preview', false) === undefined ? {} : {redacted_preview: one(parsed, '--redacted-preview', false)!})});
      result({status: 'proposed', proposal, not_persisted: ['raw prompt'], next_action: `Choose content and run prompt-case capture with approval=approve:${proposal.proposal_ref.record_id}.`});
      return;
    }
    if (action === 'capture') {
      const contentFile = one(parsed, '--content-file')!;
      if (!path.isAbsolute(contentFile)) throw new ProtocolError('INVALID_INPUT', '--content-file must be absolute');
      const captured = runtime.capturePromptCase({proposal_ref: jsonValue(one(parsed, '--proposal-ref'), '--proposal-ref') as never, approval: one(parsed, '--approval')!, selected_content: fs.readFileSync(contentFile, 'utf8'), producer: producer(), correlation_id: lineage.correlation_id, causation_id: lineage.causation_id, ...(one(parsed, '--title', false) === undefined ? {} : {title: one(parsed, '--title', false)!}), ...(one(parsed, '--classification', false) === undefined ? {} : {classification: one(parsed, '--classification', false)! as never})});
      result({status: 'captured', ...captured});
      return;
    }
    if (action === 'precedent') {
      if (!scopeType || !scopeId || !['personal', 'project', 'team', 'domain'].includes(scopeType)) throw new ProtocolError('INVALID_INPUT', 'prompt-case precedent requires a supported --scope-type and --scope-id');
      const outcomeRefs = parsed.get('--outcome-ref')?.map(value => jsonValue(value, '--outcome-ref')) ?? [];
      const record = runtime.createPromptCasePrecedent({candidate_id: one(parsed, '--candidate-id')!, prompt_source_ref: jsonValue(one(parsed, '--prompt-source-ref'), '--prompt-source-ref') as never, outcome_refs: outcomeRefs as never, claim: one(parsed, '--claim')!, rationale: one(parsed, '--rationale')!, scope: {type: scopeType as ScopeType, id: scopeId}, origin: jsonValue(one(parsed, '--origin'), '--origin') as never, producer: producer(), classification: one(parsed, '--classification')! as never, change_id: one(parsed, '--change-id')!, correlation_id: lineage.correlation_id, causation_id: lineage.causation_id});
      result({status: 'precedent_created', record});
      return;
    }
    usage();
  }
  if (group === 'change' && action === 'create') {
    const kind = one(parsed, '--change-kind')!;
    if (!CHANGE_KINDS.includes(kind as ChangeKind)) throw new ProtocolError('INVALID_INPUT', 'Unsupported --change-kind');
    const scopeType = one(parsed, '--scope-type')!;
    if (!['personal', 'project', 'team', 'domain'].includes(scopeType)) throw new ProtocolError('INVALID_INPUT', 'Unsupported --scope-type');
    const impacts = parsed.get('--impact') ?? [];
    if (impacts.length === 0) throw new ProtocolError('INVALID_INPUT', '--impact is required at least once');
    const compatibility = jsonValue(one(parsed, '--compatibility'), '--compatibility') as unknown as Compatibility;
    const note = one(parsed, '--note', false);
    const lineage = jsonValue(one(parsed, '--lineage'), '--lineage');
    const createdInput = {
      change_kind: kind as ChangeKind,
      subject: {type: one(parsed, '--subject-type')!, id: one(parsed, '--subject-id')!},
      base: jsonValue(one(parsed, '--base'), '--base'),
      proposed: jsonValue(one(parsed, '--proposed'), '--proposed'),
      impact: impacts,
      compatibility,
      requested_by: one(parsed, '--requested-by')!,
      scope: {type: scopeType as ScopeType, id: one(parsed, '--scope-id')!},
      lineage: lineage as unknown as ChangeLineage,
      ...(note === undefined ? {} : {note}),
    };
    const created = runtime.createChange(createdInput);
    result(created);
    return;
  }
  if (group === 'change' && action === 'update') {
    const status = one(parsed, '--status')!;
    if (!CHANGE_STATUSES.includes(status as ChangeStatus)) throw new ProtocolError('INVALID_INPUT', 'Unsupported --status');
    const state = (name: string): Validation[keyof Validation] | undefined => {
      const value = one(parsed, name, false);
      if (value === undefined) return undefined;
      if (!['pending', 'passed', 'failed', 'not_applicable'].includes(value)) throw new ProtocolError('INVALID_INPUT', `${name} has an invalid state`);
      return value as Validation[keyof Validation];
    };
    const schema = state('--schema');
    const replay = state('--replay');
    const behavior = state('--behavior');
    const validation = {
      ...(schema === undefined ? {} : {schema}),
      ...(replay === undefined ? {} : {replay}),
      ...(behavior === undefined ? {} : {behavior}),
    };
    const note = one(parsed, '--note', false);
    const decidedBy = one(parsed, '--decided-by', false);
    const promotionTarget = one(parsed, '--promotion-target', false);
    const rollbackTarget = one(parsed, '--rollback-target', false);
    const rollbackReason = one(parsed, '--rollback-reason', false);
    const lineage = one(parsed, '--lineage', false);
    const update = runtime.updateChange(one(parsed, '--change-id')!, {
      expected_revision: Number(one(parsed, '--expected-revision')),
      status: status as ChangeStatus,
      ...(Object.keys(validation).length === 0 ? {} : {validation}),
      ...(note === undefined ? {} : {note}),
      ...(decidedBy === undefined ? {} : {decided_by: decidedBy}),
      ...(promotionTarget === undefined ? {} : {promotion_target: promotionTarget}),
      ...(rollbackTarget === undefined ? {} : {rollback_target: rollbackTarget}),
      ...(rollbackReason === undefined ? {} : {rollback_reason: rollbackReason}),
      ...(lineage === undefined ? {} : {lineage: jsonValue(lineage, '--lineage')}),
    });
    result({status: 'updated', record: update});
    return;
  }
  if (group === 'change' && action === 'list') {
    const status = one(parsed, '--status', false);
    if (status !== undefined && !CHANGE_STATUSES.includes(status as ChangeStatus)) throw new ProtocolError('INVALID_INPUT', 'Unsupported --status');
    result({status: 'listed', records: runtime.listChanges(status as ChangeStatus | undefined)});
    return;
  }
  if (group === 'data') {
    if (action === 'create') {
      const kind = one(parsed, '--kind')!;
      if (!DATA_KINDS.includes(kind as DataKind)) throw new ProtocolError('INVALID_INPUT', 'Unsupported --kind');
      const scopeType = one(parsed, '--scope-type')!;
      if (!['personal', 'project', 'team', 'domain'].includes(scopeType)) throw new ProtocolError('INVALID_INPUT', 'Unsupported --scope-type');
      const record = runtime.createData({
        kind: kind as DataKind,
        schema_id: one(parsed, '--schema-id')!,
        schema_version: one(parsed, '--schema-version')!,
        subject: {type: one(parsed, '--subject-type')!, id: one(parsed, '--subject-id')!},
        scope: {type: scopeType as ScopeType, id: one(parsed, '--scope-id')!},
        origin: jsonValue(one(parsed, '--origin'), '--origin') as never,
        producer: jsonValue(one(parsed, '--producer'), '--producer') as never,
        lineage: jsonValue(one(parsed, '--lineage'), '--lineage') as never,
        classification: one(parsed, '--classification')! as never,
        payload: jsonValue(one(parsed, '--payload'), '--payload'),
      });
      result({status: 'created', record});
      return;
    }
    if (action === 'list') {
      const kind = one(parsed, '--kind', false);
      if (kind !== undefined && !DATA_KINDS.includes(kind as DataKind)) throw new ProtocolError('INVALID_INPUT', 'Unsupported --kind');
      result({status: 'listed', records: runtime.listData(kind as DataKind | undefined)});
      return;
    }
    if (action === 'verify') {
      result(runtime.verifyDataChain(one(parsed, '--record-id')!));
      return;
    }
  }
  if (group === 'continuity') {
    if (action === 'thread-create') {
      const thread = runtime.createThread({title: one(parsed, '--title')!, current_summary: one(parsed, '--summary')!, open_questions: parsed.get('--question') ?? [], ...(one(parsed, '--next-action', false) === undefined ? {} : {next_action: one(parsed, '--next-action', false)!}), ...traceLineageArgs(parsed)});
      result({status: 'created', record: thread});
      return;
    }
    if (action === 'turn-create') {
      const turn = runtime.appendDiscussionTurn({thread_id: one(parsed, '--thread-id')!, user_input_summary: one(parsed, '--input-summary')!, output_summary: one(parsed, '--output-summary')!, delta_type: one(parsed, '--delta-type')! as never, context_refs: parsed.get('--context-ref') ?? [], persisted_refs: parsed.get('--persisted-ref') ?? [], open_questions: parsed.get('--question') ?? [], ...traceLineageArgs(parsed)});
      result({status: 'created', record: turn});
      return;
    }
    if (action === 'receipt-create') {
      const receipt = runtime.createReceipt({thread_id: one(parsed, '--thread-id')!, receipt_kind: one(parsed, '--receipt-kind')! as 'persistence' | 'activation', summary: one(parsed, '--summary')!, persisted_refs: parsed.get('--persisted-ref') ?? [], activated_refs: parsed.get('--activated-ref') ?? [], not_persisted: parsed.get('--not-persisted') ?? [], next_prompts: parsed.get('--next-prompt') ?? [], ...(one(parsed, '--required-action', false) === undefined ? {} : {required_user_action: one(parsed, '--required-action', false)!}), ...traceLineageArgs(parsed)});
      result({status: 'created', record: receipt});
      return;
    }
    if (action === 'list') { result({status: 'listed', records: runtime.listContinuity(one(parsed, '--thread-id', false))}); return; }
  }
  usage();
}

run(process.argv.slice(2)).catch((error) => {
  const known = error as {code?: string; message?: string};
  process.stdout.write(JSON.stringify({ok: false, code: known.code ?? (error instanceof StorageError ? error.code : 'IO_ERROR'), message: known.message ?? String(error)}) + '\n');
  process.exitCode = 1;
});

