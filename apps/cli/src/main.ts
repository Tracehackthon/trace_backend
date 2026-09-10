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
import {initializeProject, loadProjectActivationConfiguration, migrateProjectActivationConfiguration, updateProjectActivationConfiguration, validateProjectInstanceDescriptor, type ProjectSourceMode, type ProjectSourceProfileInput, type ProjectInstanceDescriptor, type ProjectActivationConfigurationInput} from '../../../packages/core/instance/src/index.js';
import {hashTransientPrompt} from '../../../packages/core/case-capture/src/index.js';
import {startTraceMcpServer} from '../../mcp/src/main.js';

const PRODUCT_USAGE = [
    'Trace — 管理当前项目中的 Agent 协作、认知源与可审核沉淀',
    '',
    '开始：',
    '  trace init [--project-dir ABS] [--source local|empty|external|team] [--source-profile ABS]',
    '  trace codex enable [--hooks-file ABS] [--dry-run]',
    '  trace status [--project-dir ABS] [--json]',
    '  trace upgrade [--project-dir ABS] [--json]  # inspect an update; never overwrites project state',
    '',
    '日常：',
    '  trace inbox [--project-dir ABS] [--json]',
    '  trace review ID [--project-dir ABS] [--save ABS_CONTENT_FILE] [--json]',
    '  trace sources [--project-dir ABS] [--json]',
    '  trace profile [--project-dir ABS] [--json]',
    '  trace profile migrate --confirm true [--project-dir ABS]  # lock an older project without changing its source/data',
    '  trace abilities [--project-dir ABS] [--json]',
    '',
    '维护：',
    '  trace doctor [--project-dir ABS] [--json]',
    '  trace backup create [--project-dir ABS] [--file ABS] [--json]',
    '  trace backup restore --file ABS [--project-dir ABS] [--replace] [--json]',
    '',
    '产品命令会从当前目录向上寻找 .trace/。--project-dir 只在需要切换项目时使用。',
    '需要给连接器、自动化或协议开发使用的接口：trace --help --advanced',
  ].join('\n');

const ADVANCED_USAGE = [
    'Advanced / automation interface:',
    '  Internal host calls: trace internal <group> <action> ...',
    '  Legacy direct commands remain compatible during migration.',
    '',
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
    '  trace profile update --file ABS --confirm true [--project-dir ABS]  # explicit local collaboration-model/source-activation update',
    '  trace-runtime migrate sqlite --change-state-file ABS --data-state-file ABS --sqlite-state-file ABS [--report ABS]',
    '  trace-runtime capability preview|stage|validate|publish|rollback ... [--sqlite-state-file <absolute-path>]',
    '  trace-runtime codex activate --sqlite-state-file ABS --purpose TEXT --summary TEXT --source-ref JSON [--pointer JSON] [--thread-id ID] [--correlation-id ID --causation-id ID] [--forbidden-scope TEXT]',
    '  trace-runtime codex trigger --sqlite-state-file ABS --event-file ABS',
    '  trace-runtime codex hook-stdio --route-from-event-cwd',
    '  trace internal mcp stdio  # local MCP server used by the Trace Codex plugin',
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
  throw new ProtocolError('INVALID_INPUT', `Use \"trace --help\" for product commands or \"trace --help --advanced\" for automation commands.\n${PRODUCT_USAGE}`);
}

function printUsage(advanced = false): void {
  process.stdout.write((advanced ? ADVANCED_USAGE : PRODUCT_USAGE) + '\n');
}

const VALUELESS_FLAGS = new Set(['--json', '--dry-run', '--replace', '--route-from-event-cwd']);

function args(argv: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (let i = 0; i < argv.length;) {
    const key = argv[i];
    if (!key?.startsWith('--')) throw new ProtocolError('INVALID_INPUT', `Unexpected argument: ${key ?? ''}`);
    if (VALUELESS_FLAGS.has(key)) {
      const values = result.get(key) ?? [];
      values.push('true');
      result.set(key, values);
      i += 1;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new ProtocolError('INVALID_INPUT', `${key} requires a value`);
    const values = result.get(key) ?? [];
    values.push(value);
    result.set(key, values);
    i += 2;
  }
  return result;
}

function one(parsed: Map<string, string[]>, name: string, required = true): string | undefined {
  const values = parsed.get(name) ?? [];
  if (values.length > 1) throw new ProtocolError('INVALID_INPUT', `${name} may appear only once`);
  if (required && !values[0]) throw new ProtocolError('INVALID_INPUT', `${name} is required`);
  return values[0];
}

function has(parsed: Map<string, string[]>, name: string): boolean {
  return (parsed.get(name)?.length ?? 0) > 0;
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

interface ProductProjectContext {
  project_dir: string;
  trace_dir: string;
  state_file: string;
  descriptor: ProjectInstanceDescriptor;
}

function productResult(parsed: Map<string, string[]>, text: string, value: Record<string, unknown>): void {
  if (has(parsed, '--json')) result(value);
  else process.stdout.write(`${text.trimEnd()}\n`);
}

function userIdForProduct(parsed: Map<string, string[]>): string {
  const explicit = one(parsed, '--user-id', false);
  if (explicit !== undefined) return explicit;
  const raw = process.env.TRACE_USER_ID ?? process.env.USERNAME ?? process.env.USER ?? 'local-user';
  const normalized = raw.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return `local-${normalized || 'user'}`;
}

function findProjectContext(directory: string): ProductProjectContext | undefined {
  let cursor = path.resolve(directory);
  if (!fs.existsSync(cursor) || !fs.statSync(cursor).isDirectory()) return undefined;
  while (true) {
    const traceDir = path.join(cursor, '.trace');
    const descriptorFile = path.join(traceDir, 'project.json');
    if (fs.existsSync(descriptorFile)) {
      let descriptor: ProjectInstanceDescriptor;
      try { descriptor = validateProjectInstanceDescriptor(JSON.parse(fs.readFileSync(descriptorFile, 'utf8'))); }
      catch (error) { throw new ProtocolError('PROJECT_INVALID', `Trace project descriptor is invalid: ${error instanceof Error ? error.message : String(error)}`); }
      return {project_dir: cursor, trace_dir: traceDir, state_file: path.join(cursor, descriptor.state_file), descriptor};
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return undefined;
    cursor = parent;
  }
}

function projectContext(parsed: Map<string, string[]>): ProductProjectContext {
  const explicitProject = one(parsed, '--project-dir', false) ?? one(parsed, '--project', false);
  const requested = path.resolve(explicitProject ?? process.cwd());
  if (!fs.existsSync(requested) || !fs.statSync(requested).isDirectory()) throw new ProtocolError('INVALID_INPUT', `project directory does not exist: ${requested}`);
  const context = findProjectContext(requested);
  if (context === undefined) throw new ProtocolError('PROJECT_NOT_INITIALIZED', 'No .trace/project.json was found. Run "trace init" in the project directory first.');
  return context;
}

function eventProjectContext(event: Record<string, unknown>): ProductProjectContext | undefined {
  const cwd = event.cwd;
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return undefined;
  return findProjectContext(cwd);
}

function sourceProfileForContext(context: ProductProjectContext): MyWikiSourceProfile {
  return readJsonFile(path.join(context.trace_dir, 'profiles', 'source.profile.json'), 'source profile') as unknown as MyWikiSourceProfile;
}

function activationConfigurationForContext(context: ProductProjectContext) {
  const profile = sourceProfileForContext(context) as unknown as ProjectSourceProfileInput;
  return {
    source_profile: profile as unknown as MyWikiSourceProfile,
    ...loadProjectActivationConfiguration({trace_dir: context.trace_dir, template_id: context.descriptor.template_id, source_profile: profile}),
  };
}

/**
 * A runtime update is not a project migration. This view deliberately reads
 * the installation-time lock only to make the difference visible; it never
 * rewrites the lock, template, profile, ledger, capability, or host config.
 */
function projectRuntimeUpdateView(context: ProductProjectContext, currentRuntimeVersion: string): {
  state: 'matching' | 'runtime_changed' | 'installation_lock_unavailable';
  current_runtime_version: string;
  initialized_runtime_version: string | null;
  template: {id: string; project_version: string; locked_version: string | null};
} {
  const lockPath = path.join(context.trace_dir, 'instance', 'trace.lock.json');
  let lock: Record<string, unknown> | undefined;
  try { lock = readJsonFile(lockPath, 'instance lock'); } catch { /* status remains useful for a pre-lock project */ }
  const initializedRuntimeVersion = lock === undefined ? null : textField(lock, 'runtime_version', '');
  const lockedTemplate = lock !== undefined && lock.template !== null && typeof lock.template === 'object' && !Array.isArray(lock.template)
    ? textField(lock.template as Record<string, unknown>, 'version', '')
    : '';
  return {
    state: initializedRuntimeVersion === null || initializedRuntimeVersion.length === 0
      ? 'installation_lock_unavailable'
      : initializedRuntimeVersion === currentRuntimeVersion ? 'matching' : 'runtime_changed',
    current_runtime_version: currentRuntimeVersion,
    initialized_runtime_version: initializedRuntimeVersion === null || initializedRuntimeVersion.length === 0 ? null : initializedRuntimeVersion,
    template: {
      id: context.descriptor.template_id,
      project_version: context.descriptor.template_version,
      locked_version: lockedTemplate.length === 0 ? null : lockedTemplate,
    },
  };
}

function productRuntime(context: ProductProjectContext): TraceRuntime | undefined {
  return fs.existsSync(context.state_file) ? new TraceRuntime({sqliteStateFile: context.state_file}) : undefined;
}

function textField(value: Record<string, unknown>, name: string, fallback = '未提供'): string {
  return typeof value[name] === 'string' && value[name].trim().length > 0 ? value[name] : fallback;
}

function productState(context: ProductProjectContext): {
  data: ReturnType<TraceRuntime['listData']>;
  changes: ReturnType<TraceRuntime['listChanges']>;
  continuity: ReturnType<TraceRuntime['listContinuity']>;
} {
  const runtime = productRuntime(context);
  if (runtime === undefined) return {data: [], changes: [], continuity: []};
  try {
    return {data: runtime.listData(), changes: runtime.listChanges(), continuity: runtime.listContinuity()};
  } finally { runtime.close(); }
}

function productInbox(context: ProductProjectContext) {
  const state = productState(context);
  return state.data
    .filter(record => record.status === 'candidate' && ['prompt_capture_proposal', 'candidate_precedent', 'capability_candidate'].includes(record.kind))
    .map(record => {
      if (record.kind === 'prompt_capture_proposal') {
        return {
          id: record.record_id, type: 'prompt_case', title: textField(record.payload, 'intent_summary'), status: '等待你的保存选择',
          suggested_mode: textField(record.payload, 'capture_mode'), next_action: `trace review ${record.record_id}`,
        };
      }
      if (record.kind === 'candidate_precedent') {
        return {
          id: record.record_id, type: 'precedent', title: textField(record.payload, 'claim'), status: '候选前例，尚未成为能力',
          next_action: `trace review ${record.record_id}`,
        };
      }
      return {
        id: record.record_id, type: 'capability', title: textField(record.payload, 'title', record.subject.id), status: '候选能力，等待验证或采纳',
        next_action: `trace review ${record.record_id}`,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** A user-visible, body-free account of what the host actually did with a source. */
function hostSourceUsage(records: ReturnType<TraceRuntime['listData']>) {
  const evidence = records.filter(record => record.kind === 'host_retrieval_evidence')
    .map(record => {
      const payload = record.payload;
      return {
        evidence_id: textField(payload, 'evidence_id', record.record_id),
        event_kind: textField(payload, 'event_kind'),
        source_id: textField(payload, 'source_id'),
        host: textField(payload, 'host'),
        session_id: textField(payload, 'host_session_id'),
        turn_id: textField(payload, 'host_turn_id', '未提供'),
        tool_name: textField(payload, 'host_tool_name', '无（访问授权）'),
        locators: Array.isArray(payload.locators) ? payload.locators.filter((value): value is string => typeof value === 'string') : [],
        page_versions: Array.isArray(payload.page_versions) ? payload.page_versions : [],
        observed_at: textField(payload, 'observed_at', record.created_at),
      };
    })
    .sort((left, right) => right.observed_at.localeCompare(left.observed_at));
  const count = (kind: string) => evidence.filter(item => item.event_kind === kind).length;
  return {
    offered: count('source_access_offered'), searched: count('source_search'), read: count('source_read'),
    unclassified: count('source_access_unclassified'), recent: evidence.slice(0, 20),
  };
}

function productReview(context: ProductProjectContext, identifier: string): {record: ReturnType<TraceRuntime['listData']>[number]; view: Record<string, unknown>} {
  const runtime = productRuntime(context);
  if (runtime === undefined) throw new ProtocolError('NOT_FOUND', 'This project has no persisted Trace records yet.');
  try {
    const record = runtime.listData().find(item => item.record_id === identifier || item.subject.id === identifier || item.payload.proposal_id === identifier || item.payload.candidate_id === identifier);
    if (record === undefined) throw new ProtocolError('NOT_FOUND', `No reviewable Trace item matches: ${identifier}`);
    const common = {id: record.record_id, kind: record.kind, status: record.status, classification: record.classification, created_at: record.created_at};
    if (record.kind === 'prompt_capture_proposal') {
      return {record, view: {
        ...common, title: textField(record.payload, 'intent_summary'), rationale: textField(record.payload, 'rationale'), capture_mode: textField(record.payload, 'capture_mode'),
        persisted_now: '仅 hash、意图摘要和理由；没有 raw prompt 正文。',
        next_action: record.status === 'candidate' ? `准备好所选内容后执行：trace review ${record.record_id} --save <绝对内容文件路径>` : '该案例已完成保存选择。',
      }};
    }
    if (record.kind === 'candidate_precedent') {
      const evidence = Array.isArray(record.payload.evidence_record_ids) ? record.payload.evidence_record_ids.length : 0;
      return {record, view: {...common, title: textField(record.payload, 'claim'), rationale: textField(record.payload, 'rationale'), evidence_count: evidence, adoption_status: textField(record.payload, 'adoption_status', 'pending'), next_action: '在 Codex 中补充验证或讨论后，再决定是否制作能力候选。'}};
    }
    if (record.kind === 'source_snapshot') {
      return {record, view: {...common, title: textField(record.payload, 'title'), provider: textField(record.payload, 'provider'), content_mode: textField(record.payload, 'content_mode', '来源快照'), persisted_now: '为保护来源内容，review 默认不显示正文。'}};
    }
    return {record, view: {...common, title: textField(record.payload, 'title', record.subject.id), summary: textField(record.payload, 'summary', textField(record.payload, 'claim', '可在 Codex 中继续查看与讨论。'))}};
  } finally { runtime.close(); }
}

function renderInbox(items: Array<Record<string, unknown>>): string {
  if (items.length === 0) return '待确认沉淀：0\n\n当前没有需要你决定的候选。继续在 Codex 中协作；值得保留的内容会出现在这里。';
  return ['待确认沉淀：' + items.length, '', ...items.flatMap((item, index) => [
    `${index + 1}. ${String(item.title)}`,
    `   类型：${String(item.type)}；状态：${String(item.status)}`,
    ...(item.suggested_mode === undefined ? [] : [`   建议保存方式：${String(item.suggested_mode)}`]),
    `   下一步：${String(item.next_action)}`,
  ])].join('\n');
}

function commandPart(value: string): string { return `"${value.replaceAll('"', '\\"')}"`; }

function productHookCommand(): string {
  const entry = path.resolve(process.argv[1] ?? '');
  if (!entry || !fs.existsSync(entry)) throw new ProtocolError('IO_ERROR', 'Cannot resolve the installed Trace CLI entrypoint for the Codex hook.');
  // hooks.json is user-level. Route each event by its own cwd so enabling
  // Trace for project B cannot bind every future turn to project B.
  return `${commandPart(process.execPath)} ${commandPart(entry)} internal codex hook-stdio --route-from-event-cwd`;
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
  if (argv[0] === 'internal') {
    if (argv.length === 1 || argv.slice(1).includes('--help') || argv.slice(1).includes('-h')) { printUsage(true); return; }
    await run(argv.slice(1));
    return;
  }
  if (argv[0] === 'mcp' && argv[1] === 'stdio' && argv.length === 2) {
    await startTraceMcpServer();
    return;
  }
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) { printUsage(argv.includes('--advanced')); return; }
  const [group, action, ...rest] = argv;
  // Product commands discover the nearest project boundary rather than asking
  // users to repeatedly pass state-file, lineage and producer internals.
  if (['init', 'status', 'upgrade', 'inbox', 'sources', 'profile', 'abilities'].includes(group ?? '')) {
    const parsed = args(action?.startsWith('--') ? [action, ...rest] : rest);
    if (group === 'init') {
      const projectDir = path.resolve(one(parsed, '--project-dir', false) ?? process.cwd());
      const requestedMode = one(parsed, '--source', false) ?? one(parsed, '--source-mode', false) ?? 'local';
      if (!['local', 'external', 'team', 'empty'].includes(requestedMode)) throw new ProtocolError('INVALID_INPUT', '--source must be local, external, team, or empty');
      const sourceProfilePath = one(parsed, '--source-profile', false);
      const sourceProfile = sourceProfilePath === undefined ? undefined : readJsonFile(sourceProfilePath, '--source-profile') as unknown as ProjectSourceProfileInput;
      const {manifest, templateId} = manifestFor(parsed);
      const initialized = initializeProject({
        project_dir: projectDir,
        manifest,
        runtime_version: runtimeVersionFor(parsed),
        instance_id: one(parsed, '--instance-id', false) ?? defaultInstanceId(projectDir),
        user_id: userIdForProduct(parsed),
        source_mode: requestedMode as ProjectSourceMode,
        ...(sourceProfile === undefined ? {} : {source_profile: sourceProfile}),
      });
      // Initialize an empty, schema-complete project state now. A newly
      // initialized project must be immediately doctor/backup-ready rather
      // than requiring a first hook event to create its database.
      const initialRuntime = new TraceRuntime({sqliteStateFile: path.join(initialized.project_dir, initialized.descriptor.state_file)});
      initialRuntime.close();
      productResult(parsed, [
        'Trace 已初始化。', '',
        `项目：${initialized.project_dir}`,
        `认知源：${initialized.descriptor.source_mode}`,
        `模板：${templateId}`,
        `协作方式：${initialized.collaboration_model.display_name}`,
        `认知源地图：${initialized.source_activation.display_name}（${initialized.source_activation.entry_points.length} 个预设入口）`,
        'Codex：尚未启用', '',
        '下一步：',
        '  trace codex enable',
        '  trace profile',
        '  trace status',
      ].join('\n'), {status: 'initialized', template_id: templateId, project: initialized.project_dir, trace_dir: initialized.trace_dir, source_mode: initialized.descriptor.source_mode, collaboration_model: {model_id: initialized.collaboration_model.model_id, version: initialized.collaboration_model.version}, source_activation: {manifest_id: initialized.source_activation.manifest_id, version: initialized.source_activation.version, entry_points: initialized.source_activation.entry_points.length}, next_actions: ['trace codex enable', 'trace profile', 'trace status']});
      return;
    }
    const context = projectContext(parsed);
    if (group === 'profile' && action === 'migrate') {
      if (one(parsed, '--confirm', false) !== 'true') throw new ProtocolError('USER_CONFIRMATION_REQUIRED', 'profile migrate requires --confirm true');
      const sourceProfile = sourceProfileForContext(context) as unknown as ProjectSourceProfileInput;
      const migrated = migrateProjectActivationConfiguration({trace_dir: context.trace_dir, template_id: context.descriptor.template_id, source_profile: sourceProfile});
      productResult(parsed, migrated.migrated ? [
        '旧项目已完成协作配置迁移。',
        `协作模型：${migrated.collaboration_model.display_name}（${migrated.collaboration_model.model_id}@${migrated.collaboration_model.version}）`,
        `认知源地图：${migrated.source_activation.display_name}（${migrated.source_activation.entry_points.length} 个入口）`,
        `原配置备份：${migrated.backup_dir ?? '无（旧项目没有配置文件）'}`,
        '没有改动 SQLite 数据、已选认知源、模板、能力或 Codex hooks。',
      ].join('\n') : [
        '当前项目已经有有效的协作配置 lock；未改动任何文件。',
        `协作模型：${migrated.collaboration_model.display_name}（${migrated.collaboration_model.model_id}@${migrated.collaboration_model.version}）`,
      ].join('\n'), {status: migrated.migrated ? 'migrated' : 'already_locked', project: context.project_dir, previous_state: migrated.previous_state, collaboration_model: {model_id: migrated.collaboration_model.model_id, version: migrated.collaboration_model.version}, source_activation: {manifest_id: migrated.source_activation.manifest_id, version: migrated.source_activation.version}, ...(migrated.activation_lock === undefined ? {} : {activation_lock: migrated.activation_lock}), ...(migrated.backup_dir === undefined ? {} : {backup_dir: migrated.backup_dir})});
      return;
    }
    if (group === 'profile' && action === 'update') {
      if (one(parsed, '--confirm', false) !== 'true') throw new ProtocolError('USER_CONFIRMATION_REQUIRED', 'profile update requires --confirm true');
      const file = one(parsed, '--file')!;
      if (!path.isAbsolute(file)) throw new ProtocolError('INVALID_INPUT', '--file must be an absolute activation configuration file');
      const selected = readJsonFile(file, '--file') as unknown as ProjectActivationConfigurationInput;
      const sourceProfile = sourceProfileForContext(context) as unknown as ProjectSourceProfileInput;
      const updated = updateProjectActivationConfiguration({
        trace_dir: context.trace_dir,
        template_id: context.descriptor.template_id,
        source_profile: sourceProfile,
        configuration: selected,
      });
      productResult(parsed, [
        '协作模型与认知源地图已显式更新。',
        `协作模型：${updated.collaboration_model.display_name}（${updated.collaboration_model.model_id}@${updated.collaboration_model.version}）`,
        `认知源地图：${updated.source_activation.display_name}（${updated.source_activation.entry_points.length} 个入口）`,
        `原配置备份：${updated.backup_dir}`,
        '查看当前生效内容：trace profile',
      ].join('\n'), {status: 'updated', project: context.project_dir, collaboration_model: {model_id: updated.collaboration_model.model_id, version: updated.collaboration_model.version}, source_activation: {manifest_id: updated.source_activation.manifest_id, version: updated.source_activation.version, entry_points: updated.source_activation.entry_points.length}, activation_lock: updated.activation_lock, backup_dir: updated.backup_dir});
      return;
    }
    if (group === 'profile' && action !== undefined && !action.startsWith('--')) throw new ProtocolError('INVALID_INPUT', 'trace profile supports inspection, migrate, or: trace profile update --file ABS --confirm true');
    if (group === 'profile') {
      const activation = activationConfigurationForContext(context);
      const model = activation.collaboration_model;
      const sourceMap = activation.source_activation;
      const lock = activation.activation_lock;
      const profileView = {
        status: 'active',
        project: context.project_dir,
        collaboration_model: {model_id: model.model_id, version: model.version, display_name: model.display_name, scope: model.scope, principles: model.principles, open_discussion: model.open_discussion, explicit_execution: model.explicit_execution, epistemic_practice: model.epistemic_practice, boundaries: model.boundaries, ...(model.current_focus === undefined ? {} : {current_focus: model.current_focus})},
        source_activation: {manifest_id: sourceMap.manifest_id, version: sourceMap.version, source_id: sourceMap.source_id, display_name: sourceMap.display_name, summary: sourceMap.summary, entry_points: sourceMap.entry_points, activation_profiles: sourceMap.activation_profiles},
        configuration_state: activation.configuration_state,
        activation_lock: lock ?? null,
      };
      productResult(parsed, [
        `协作模型：${model.display_name}（${model.model_id}@${model.version}）`,
        `作用域：${model.scope}`,
        `开放讨论：${model.open_discussion.join('；')}`,
        `明确执行：${model.explicit_execution.join('；')}`,
        `认识论：${model.epistemic_practice.join('；')}`,
        `边界：${model.boundaries.join('；')}`,
        `认知源地图：${sourceMap.display_name}（${sourceMap.manifest_id}@${sourceMap.version}）`,
        `来源说明：${sourceMap.summary}`,
        `入口：${sourceMap.entry_points.length === 0 ? '尚未由用户配置；Codex 仅在相关时原生搜索已授权来源。' : sourceMap.entry_points.map(entry => `${entry.label}${entry.locator === undefined ? '' : ` (${entry.locator})`}`).join('；')}`,
        `锁定：${lock === undefined ? '旧项目兼容模式；当前使用兼容协作模型，但尚未锁定。执行 trace profile migrate --confirm true 固化它，不会改动来源或数据。' : `${lock.lock_id}；模型/来源地图以 hash 锁定。`}`,
      ].join('\n'), profileView);
      return;
    }
    if (group === 'upgrade') {
      if (action !== undefined && !action.startsWith('--')) throw new ProtocolError('INVALID_INPUT', 'trace upgrade only inspects the current project; it does not apply changes');
      const runtime = projectRuntimeUpdateView(context, runtimeVersionFor(parsed));
      const activation = activationConfigurationForContext(context);
      const next_actions = [
        ...(runtime.state === 'runtime_changed' ? ['trace doctor', 'trace profile', 'trace codex status'] : []),
        ...(runtime.state === 'installation_lock_unavailable' ? ['trace doctor'] : []),
        ...(activation.configuration_state === 'legacy_unlocked' ? ['trace profile migrate --confirm true'] : []),
      ];
      const summary = runtime.state === 'matching'
        ? '当前 runtime 与项目初始化记录一致；无需迁移。'
        : runtime.state === 'runtime_changed'
          ? '检测到 runtime 已变化。Trace 不会自动改写此项目；先检查，再只执行你明确选择的迁移。'
          : '无法读取项目初始化 lock。Trace 不会猜测或重建它；请先运行 doctor。';
      productResult(parsed, [
        'Trace 更新检查（只读）。',
        `运行中的 runtime：${runtime.current_runtime_version}`,
        `项目初始化 runtime：${runtime.initialized_runtime_version ?? '不可用'}`,
        `项目模板：${runtime.template.id}@${runtime.template.project_version}${runtime.template.locked_version === null ? '' : `（lock ${runtime.template.locked_version}）`}`,
        `协作配置：${activation.configuration_state === 'locked' ? '已 lock；更新不会自动替换个人/项目协作配置。' : '旧项目兼容模式；可显式执行 trace profile migrate --confirm true。'}`,
        '不会自动改动：SQLite 数据、认知源、模板内容、能力、Skill 或 Codex hooks。',
        next_actions.length === 0 ? '下一步：继续正常使用；未来需要调整协作方式时执行 trace profile update。' : `建议：${next_actions.join(' → ')}`,
      ].join('\n'), {
        status: 'inspected',
        project: context.project_dir,
        runtime,
        collaboration_configuration: {state: activation.configuration_state, locked: activation.activation_lock !== undefined},
        automatic_changes: [],
        next_actions,
        summary,
      });
      return;
    }
    if (group === 'status') {
      const state = productState(context);
      const inbox = productInbox(context);
      const threads = state.continuity.filter(item => item.kind === 'thread');
      const sources = (() => {
        try { return readJsonFile(path.join(context.trace_dir, 'profiles', 'source.profile.json'), 'source profile'); }
        catch { return {}; }
      })();
      const latestActivationRecord = state.continuity
        .filter(item => item.kind === 'activation_receipt')
        .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
      const latestActivation = latestActivationRecord === undefined ? null : {
        receipt_id: latestActivationRecord.record_id,
        summary: textField(latestActivationRecord.payload, 'summary'),
        activated_refs: Array.isArray(latestActivationRecord.payload.activated_refs) ? latestActivationRecord.payload.activated_refs : [],
        activated_pointers: Array.isArray(latestActivationRecord.payload.activated_pointers) ? latestActivationRecord.payload.activated_pointers : [],
        not_persisted: Array.isArray(latestActivationRecord.payload.not_persisted) ? latestActivationRecord.payload.not_persisted : [],
        created_at: latestActivationRecord.created_at,
      };
      const sourceUsage = hostSourceUsage(state.data);
      const activation = activationConfigurationForContext(context);
      const runtime = projectRuntimeUpdateView(context, runtimeVersionFor(parsed));
      const snapshot = {
        status: 'ready', project: context.project_dir, template: context.descriptor.template_id, source_mode: context.descriptor.source_mode,
        source_id: typeof sources.source_id === 'string' ? sources.source_id : '未配置', codex: '运行 trace codex status 查看',
        open_threads: threads.filter(item => item.payload.status === 'open' || item.payload.status === 'watching').length,
        pending_reviews: inbox.length,
        candidate_precedents: state.data.filter(item => item.kind === 'candidate_precedent').length,
        candidate_capabilities: state.data.filter(item => item.kind === 'capability_candidate').length,
        latest_activation: latestActivation,
        host_source_usage: sourceUsage,
        runtime,
        collaboration: {model_id: activation.collaboration_model.model_id, model_version: activation.collaboration_model.version, source_manifest_id: activation.source_activation.manifest_id, source_manifest_version: activation.source_activation.version, source_entry_points: activation.source_activation.entry_points.length, state: activation.configuration_state, locked: activation.activation_lock !== undefined},
        next_action: inbox.length > 0 ? 'trace inbox' : '继续在 Codex 中协作；值得沉淀的内容会进入 inbox。',
      };
      productResult(parsed, [
        `当前项目：${snapshot.project}`,
        `模板：${snapshot.template}`,
        `认知源：${snapshot.source_mode} / ${snapshot.source_id}`,
        `Trace runtime：当前 ${runtime.current_runtime_version}；项目初始化 ${runtime.initialized_runtime_version ?? '不可用'}；${runtime.state === 'matching' ? '一致。' : runtime.state === 'runtime_changed' ? '已变化（执行 trace upgrade 查看只读迁移建议）。' : '初始化 lock 不可用（执行 trace doctor）。'}`,
        `协作模型：${activation.collaboration_model.display_name} @ ${activation.collaboration_model.version}；认知源地图入口：${activation.source_activation.entry_points.length}`,
        ...(activation.configuration_state === 'legacy_unlocked' ? ['协作配置：旧项目兼容模式，尚未 lock；建议执行 trace profile migrate --confirm true。'] : ['协作配置：已由 hash lock 固定。']),
        `开放协作主题：${snapshot.open_threads}`,
        `待确认沉淀：${snapshot.pending_reviews}`,
        `候选前例：${snapshot.candidate_precedents}`,
        `候选能力：${snapshot.candidate_capabilities}`,
        `宿主认知源实际使用：已提供 ${sourceUsage.offered} 次；检索 ${sourceUsage.searched} 次；读取 ${sourceUsage.read} 页；未分类访问 ${sourceUsage.unclassified} 次`,
        `最近一次接续：${latestActivation === null ? '尚无（在 Codex 中开始协作后出现）' : latestActivation.summary}`,
        ...(latestActivation === null ? [] : [`Activation Pack 显式指针：${latestActivation.activated_pointers.length}；持久化来源/能力引用：${latestActivation.activated_refs.length}`, `未自动保存：${latestActivation.not_persisted.join('、') || '无'}`]),
        '', `下一步：${snapshot.next_action}`,
      ].join('\n'), snapshot);
      return;
    }
    if (group === 'inbox') {
      const items = productInbox(context);
      productResult(parsed, renderInbox(items), {status: 'listed', project: context.project_dir, items});
      return;
    }
    if (group === 'sources') {
      const profile = readJsonFile(path.join(context.trace_dir, 'profiles', 'source.profile.json'), 'source profile');
      const activation = activationConfigurationForContext(context);
      const state = productState(context);
      const usage = hostSourceUsage(state.data);
      const policy = profile.host_retrieval && typeof profile.host_retrieval === 'object' && !Array.isArray(profile.host_retrieval)
        ? profile.host_retrieval as Record<string, unknown>
        : {};
      const source = {
        source_id: textField(profile, 'source_id'), mode: context.descriptor.source_mode, scope: context.descriptor.source_scope,
        read_enabled: profile.read_enabled === true, write_enabled: profile.write_enabled === true,
        host_retrieval: {
          mode: textField(policy, 'mode', 'native_observed'),
          allowed_prefixes: Array.isArray(policy.allowed_prefixes) ? policy.allowed_prefixes.filter((item): item is string => typeof item === 'string') : ['wiki'],
          max_reads_per_turn: typeof policy.max_reads_per_turn === 'number' ? policy.max_reads_per_turn : 8,
          boundary: 'observed-and-budgeted-not-filesystem-sandbox',
        },
        activation_map: {
          manifest_id: activation.source_activation.manifest_id,
          version: activation.source_activation.version,
          display_name: activation.source_activation.display_name,
          summary: activation.source_activation.summary,
          entry_points: activation.source_activation.entry_points.map(entry => ({id: entry.id, label: entry.label, kind: entry.kind, purpose: entry.purpose, triggers: entry.triggers, ...(entry.locator === undefined ? {} : {locator: entry.locator})})),
        },
      };
      productResult(parsed, [
        `认知源：${source.source_id}`,
        `模式：${source.mode}；作用域：${source.scope}`,
        `读取：${source.read_enabled ? '已授权' : '未授权'}；写入：${source.write_enabled ? '已授权' : '未授权'}`,
        `宿主检索：${source.host_retrieval.mode}；单轮读取预算：${source.host_retrieval.max_reads_per_turn}；正式前缀：${source.host_retrieval.allowed_prefixes.join(', ')}`,
        `认知源地图：${source.activation_map.display_name} @ ${source.activation_map.version}；预设入口：${source.activation_map.entry_points.length === 0 ? '无（按当前问题原生检索）' : source.activation_map.entry_points.map(entry => entry.label).join('、')}`,
        `实际证据：提供 ${usage.offered} 次；检索 ${usage.searched} 次；读取 ${usage.read} 页；未分类 ${usage.unclassified} 次`,
        usage.recent.length === 0 ? '尚无宿主访问证据。Codex 开始一次相关协作后，Trace 会显示它实际检索/读取的安全定位符。' : '最近活动（仅 locator/revision/hash，不含 prompt、正文、工具参数或绝对路径）：',
        ...usage.recent.slice(0, 5).map(item => `  ${item.observed_at}｜${item.event_kind}｜${item.locators.length === 0 ? '无页面定位符' : item.locators.join(', ')}`),
        'Trace 不会自动复制外部个人或团队认知源；native_observed 会复用 Codex 自己的检索/读取能力，但不是文件系统隔离边界。需要硬隔离的来源不能暴露给该模式。',
      ].join('\n'), {status: 'listed', project: context.project_dir, sources: [source], host_source_usage: usage});
      return;
    }
    const abilities = productState(context).data.filter(item => item.kind === 'capability_candidate').map(item => ({id: item.record_id, title: textField(item.payload, 'title', item.subject.id), status: item.status, created_at: item.created_at}));
    productResult(parsed, abilities.length === 0 ? '能力候选：0\n\n当前没有待审核的能力。候选前例经过验证和采用后才会出现在这里。' : ['能力候选：' + abilities.length, '', ...abilities.map((item, index) => `${index + 1}. ${item.title}\n   状态：${item.status}\n   查看：trace review ${item.id}`)].join('\n'), {status: 'listed', project: context.project_dir, abilities});
    return;
  }
  if (group === 'review') {
    if (!action || action.startsWith('--')) throw new ProtocolError('INVALID_INPUT', 'trace review requires an inbox item ID');
    const parsed = args(rest);
    const context = projectContext(parsed);
    const reviewed = productReview(context, action);
    const saveFile = one(parsed, '--save', false);
    if (saveFile !== undefined) {
      if (!path.isAbsolute(saveFile)) throw new ProtocolError('INVALID_INPUT', '--save must be an absolute content-file path');
      if (reviewed.record.kind !== 'prompt_capture_proposal' || reviewed.record.status !== 'candidate') throw new ProtocolError('INVALID_INPUT', '--save is available only for a candidate prompt-case proposal');
      const runtime = new TraceRuntime({sqliteStateFile: context.state_file});
      try {
        const captured = runtime.capturePromptCase({
          proposal_ref: {record_id: reviewed.record.record_id, revision: reviewed.record.revision, kind: reviewed.record.kind, schema_id: reviewed.record.schema_id, schema_version: reviewed.record.schema_version},
          approval: `approve:${reviewed.record.record_id}`,
          selected_content: fs.readFileSync(saveFile, 'utf8'),
          producer: {component: 'trace.product-cli', version: runtimeVersionFor(parsed), run_id: `review-${reviewed.record.record_id}`},
          correlation_id: reviewed.record.lineage.correlation_id,
          causation_id: `trace-review:${reviewed.record.record_id}`,
        });
        productResult(parsed, [
          '已按你的明确选择保存案例。',
          `保存方式：${captured.capture_mode}`,
          `可见范围：${captured.classification}`,
          `来源快照：${captured.source_snapshot_ref.record_id}@${captured.source_snapshot_ref.revision}`,
          '下一步：在 Codex 中附加结果证据；只有验证后才可以形成候选前例。',
        ].join('\n'), {status: 'captured', ...captured});
      } finally { runtime.close(); }
      return;
    }
    const lines = Object.entries(reviewed.view).map(([key, value]) => `${key}：${Array.isArray(value) ? value.join(', ') : String(value)}`);
    productResult(parsed, lines.join('\n'), {status: 'reviewed', project: context.project_dir, item: reviewed.view});
    return;
  }
  if (group === 'codex' && (action === 'enable' || action === 'status')) {
    const parsed = args(rest);
    const context = projectContext(parsed);
    const installer = new CodexHookInstaller(one(parsed, '--hooks-file', false));
    if (action === 'status') {
      const raw = fs.existsSync(installer.hooksFile) ? fs.readFileSync(installer.hooksFile, 'utf8') : '{}';
      const hasTraceHook = /codex\s+hook-stdio|trace\.codex-managed\.v1/i.test(raw);
      const routedByEventCwd = /--route-from-event-cwd(?:\s|"|$)/i.test(raw);
      const hasNativeEvidenceEvents = /"PreToolUse"\s*:/i.test(raw) && /"PostToolUse"\s*:/i.test(raw);
      const status = routedByEventCwd && hasNativeEvidenceEvents ? 'enabled' : hasTraceHook ? 'needs_reenable' : 'disabled';
      const message = status === 'enabled'
        ? 'Trace 会按每次 Codex 事件的 cwd 找到当前项目；将版本化协作方式与认知源地图交给 Codex，Codex 自己检索/读取来源，Trace 只记录实际访问证据。完整 prompt 不会自动入库。'
        : status === 'needs_reenable'
          ? '发现旧版或不完整 hook。运行 trace codex enable，启用按事件 cwd 路由和宿主检索证据。'
          : '下一步：trace codex enable';
      productResult(parsed, [`Codex：${status === 'enabled' ? '已启用' : status === 'needs_reenable' ? '需要升级' : '未启用'}`, `hooks 配置：${installer.hooksFile}`, `路由：${routedByEventCwd ? '事件 cwd → 当前项目 .trace/' : hasTraceHook ? '旧版固定项目（不安全）' : '未配置'}`, `宿主检索证据：${hasNativeEvidenceEvents ? 'PreToolUse + PostToolUse 已配置' : '缺失，需升级'}`, message].join('\n'), {status, hooks_file: installer.hooksFile, project: context.project_dir, routing: routedByEventCwd ? 'event_cwd' : hasTraceHook ? 'legacy_project_binding' : 'none', host_retrieval_evidence: hasNativeEvidenceEvents});
      return;
    }
    const command = productHookCommand();
    const preview = installer.preview({command});
    if (has(parsed, '--dry-run')) {
      productResult(parsed, [`Codex 启用预览`, `配置文件：${preview.hooks_file}`, `将管理事件：${preview.managed_events.join(', ')}`, `其他 hooks：${preview.unrelated_hooks_preserved ? '保留' : '需要检查'}`, '', '确认启用：trace codex enable'].join('\n'), {status: 'previewed', project: context.project_dir, preview});
      return;
    }
    const receipt = installer.install({command, backup_root: path.join(context.trace_dir, 'backups', 'codex-hooks'), approval: 'approve:codex-hooks'});
    const receiptFile = path.join(context.trace_dir, 'receipts', `codex-hooks-${Date.now()}.json`);
    fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
    productResult(parsed, [`Codex 已启用 Trace 路由。`, `管理事件：${receipt.managed_events.join(', ')}`, '路由方式：每次事件按 cwd 找到对应项目的 .trace/，不会把项目 A 的认知源带到项目 B。', `原配置备份：${receipt.backup_file ?? '无'}`, `可见回执：${receiptFile}`, '', '下一步：trace status'].join('\n'), {status: 'enabled', project: context.project_dir, routing: 'event_cwd', receipt, receipt_file: receiptFile});
    return;
  }
  if (group === 'doctor' && (action === undefined || action.startsWith('--'))) {
    const parsed = args(action === undefined ? rest : [action, ...rest]);
    const context = projectContext(parsed);
    const report = doctorSqlite(context.state_file);
    const errors = report.checks.filter(check => check.status === 'error').length;
    const warnings = report.checks.filter(check => check.status === 'warn').length;
    productResult(parsed, [`Trace 健康状态：${report.status}`, `SQLite driver：${report.sqlite_driver?.kind ?? '未打开'}`, `错误：${errors}；提醒：${warnings}`, '', report.status === 'healthy' ? '数据链路检查通过。' : '请使用 trace --help --advanced 查看诊断接口，或根据检查项处理。'].join('\n'), {status: report.status, project: context.project_dir, report});
    return;
  }
  if (group === 'backup' && (action === 'create' || action === 'restore') && ![...rest].includes('--sqlite-state-file')) {
    const parsed = args(rest);
    const context = projectContext(parsed);
    if (action === 'create') {
      const fallback = path.join(context.trace_dir, 'backups', `trace-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
      const backup = backupSqlite(context.state_file, one(parsed, '--file', false) ?? fallback);
      productResult(parsed, [`备份已创建。`, `文件：${backup.manifest.backup_file}`, `校验：SHA-256 ${backup.manifest.sha256}`, `包含表：${backup.manifest.tables.join(', ')}`].join('\n'), {status: 'created', project: context.project_dir, backup});
      return;
    }
    const file = one(parsed, '--file')!;
    const restored = restoreSqlite(file, context.state_file, has(parsed, '--replace'));
    productResult(parsed, [`备份已恢复。`, `状态库：${restored.database}`, `已验证：${restored.verified ? '是' : '否'}`, ...(restored.previous_database === undefined ? [] : [`旧状态库：${restored.previous_database}`])].join('\n'), {status: 'restored', project: context.project_dir, restore: restored});
    return;
  }
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
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new ProtocolError('INVALID_INPUT', 'Codex hook event must be an object');
    const hookEvent = event as Record<string, unknown>;
    const routeFromEventCwd = has(parsed, '--route-from-event-cwd');
    const profilePath = one(parsed, '--source-profile', false);
    const explicitSqlite = one(parsed, '--sqlite-state-file', false);
    if (routeFromEventCwd && (profilePath !== undefined || explicitSqlite !== undefined)) throw new ProtocolError('INVALID_INPUT', '--route-from-event-cwd cannot be combined with static source or state paths');
    const context = routeFromEventCwd ? eventProjectContext(hookEvent) : explicitSqlite === undefined ? projectContext(parsed) : undefined;
    // A user-level Codex hook also sees non-Trace projects. In that case it
    // must be a successful no-op: no state file, profile, or data can leak in.
    if (routeFromEventCwd && context === undefined) { process.stdout.write('{}\n'); return; }
    const configuration = profilePath === undefined
      ? context === undefined ? {} : activationConfigurationForContext(context)
      : {source_profile: readJsonFile(profilePath, '--source-profile') as unknown as MyWikiSourceProfile};
    const sqliteStateFile = explicitSqlite ?? context!.state_file;
    const runtime = new TraceRuntime({sqliteStateFile});
    try {
      process.stdout.write(JSON.stringify(buildCodexHookOutput(hookEvent as Parameters<typeof buildCodexHookOutput>[0], runtime, configuration)) + '\n');
    } finally { runtime.close(); }
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
