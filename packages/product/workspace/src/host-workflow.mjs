import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

/**
 * Second-stage host workflow state.  This module deliberately has no model or
 * Agent SDK dependency: Product Workspace owns the user-visible facts and
 * receipts, while apps/agent only owns a bounded execution run.
 */
export const HOST_WORKFLOW_TABLES = Object.freeze([
  'sensemaking_jobs',
  'routing_proposals',
  'route_decisions',
  'host_workflow_commands',
  'sensemaking_privacy_receipts',
  'activation_receipts',
  'activation_events',
  'repository_preflights',
  'repository_guard_receipts',
  'repository_guard_journal',
  'publication_policies',
  'capability_orchestrations',
  'capability_trials',
  'publication_events',
]);

export const ROUTING_TARGET_KINDS = Object.freeze([
  'current-task', 'project-policy', 'personal-policy', 'runtime-guard',
  'hook', 'capability-candidate', 'product-issue', 'unresolved',
]);
export const ROUTING_SCOPES = Object.freeze(['task', 'project', 'personal', 'cross-project', 'unknown']);
export const ROUTING_DECISIONS = Object.freeze(['adopt', 'trial', 'reject']);
export const ACTIVATION_STATUSES = Object.freeze(['offered', 'used', 'affected', 'dismissed', 'snoozed', 'released']);

const MAX_ID = 512;
const MAX_TEXT = 1_000_000;
// A HostTurn prompt/final is bounded at 1 MiB each by host-ingest.  Keep the
// job payload bounded as well, but large enough that a valid attached turn is
// not rolled back merely because the asynchronous job repeats its private
// source boundary.
const MAX_JSON = 3_000_000;
const MAX_ITEMS = 64;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const JOB_STATUSES = new Set(['queued', 'running', 'succeeded', 'noop', 'failed']);
const PROPOSAL_STATUSES = new Set(['proposed', 'trial', 'adopted', 'rejected']);
const TARGETS = new Set(ROUTING_TARGET_KINDS);
const SCOPES = new Set(ROUTING_SCOPES);
const DECISIONS = new Set(ROUTING_DECISIONS);
const ACTIVATIONS = new Set(ACTIVATION_STATUSES);
const JOURNAL_STATES = new Set(['prepared', 'git_applied', 'receipt_committed', 'recovery_required', 'reconciled', 'failed']);
const PUBLICATION_POLICY_STATUSES = new Set(['active', 'revoked', 'expired']);
const CAPABILITY_ORCHESTRATION_STATUSES = new Set(['candidate', 'trial_queued', 'staged', 'validated', 'published', 'rolled_back', 'producer_required', 'failed']);
const TRIAL_OUTCOMES = new Set(['support', 'limit', 'challenge', 'inconclusive']);

export class HostWorkflowError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HostWorkflowError';
    this.status = status;
    this.code = code;
  }
}

function fail(code, message, status = 422) { throw new HostWorkflowError(status, code, message); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value, field, max = MAX_TEXT, {empty = false} = {}) {
  if (typeof value !== 'string' || value.length > max || /[\x00\x7f]/.test(value) || (!empty && value.trim().length === 0)) {
    fail('INVALID_HOST_WORKFLOW', `${field} must be bounded text`);
  }
  return value;
}
function optionalText(value, field, max = MAX_TEXT) { return value === undefined || value === null ? null : text(value, field, max, {empty: true}); }
function identity(value, field, max = MAX_ID) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\x00-\x1f\x7f]/.test(value) || FORBIDDEN_KEYS.has(value)) {
    fail('INVALID_HOST_WORKFLOW', `${field} must be a usable identity`);
  }
  return value;
}
function optionalIdentity(value, field, max = MAX_ID) { return value === undefined || value === null || value === '' ? null : identity(value, field, max); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function stableWorkflowJson(value) { return JSON.stringify(canonical(value)); }
export function workflowHash(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableWorkflowJson(value), 'utf8').digest('hex'); }
function now() { return new Date().toISOString(); }
function parseJson(value, field, fallback = null) {
  if (value === undefined || value === null) return fallback;
  try { return JSON.parse(value); } catch { fail('STORAGE_CORRUPT', `${field} is not valid JSON`, 503); }
}
function jsonColumn(value, field, max = MAX_JSON) {
  let encoded;
  try { encoded = stableWorkflowJson(value); } catch { fail('INVALID_HOST_WORKFLOW', `${field} must be JSON serializable`); }
  if (encoded.length > max) fail('INVALID_HOST_WORKFLOW', `${field} exceeds the bounded JSON size`);
  return encoded;
}
function tableColumns(db, table) { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name)); }
function addColumn(db, table, column, declaration) {
  if (!tableColumns(db, table).has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}

/** Create the append-only workflow extension and safely migrate stage-one DBs. */
export function ensureHostWorkflowSchema(db, {allowSchemaMigration = true} = {}) {
  // Legacy Product databases remain inspectable without silently acquiring
  // new workflow tables/indexes.  Explicit identity adoption (or the
  // library-only legacy write opt-in) passes true and performs the additive
  // migration in the owner's transaction.
  if (!allowSchemaMigration) return false;
  // Stage one created workflow_findings with only the capture columns.  Additive
  // columns keep those databases readable without recreating or copying the
  // authoritative table.
  addColumn(db, 'workflow_findings', 'finding_kind', "TEXT NOT NULL DEFAULT 'captured'");
  addColumn(db, 'workflow_findings', 'origin', "TEXT NOT NULL DEFAULT 'explicit'");
  addColumn(db, 'workflow_findings', 'source_refs', "TEXT NOT NULL DEFAULT '[]'");
  addColumn(db, 'workflow_findings', 'run_id', 'TEXT');
  addColumn(db, 'workflow_findings', 'input_hash', 'TEXT');
  addColumn(db, 'workflow_findings', 'result_hash', 'TEXT');
  addColumn(db, 'workflow_findings', 'target_hint', 'TEXT');
  db.exec(`
    CREATE INDEX IF NOT EXISTS workflow_findings_origin_idx ON workflow_findings(origin, created_at);
    CREATE TABLE IF NOT EXISTS sensemaking_jobs(
      job_id TEXT PRIMARY KEY,
      host TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','noop','failed')),
      attempt INTEGER NOT NULL CHECK(attempt>=0),
      max_attempts INTEGER NOT NULL CHECK(max_attempts>=1),
      lease_token TEXT,
      lease_owner TEXT,
      lease_expires_at TEXT,
      input_hash TEXT NOT NULL,
      input_json TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      profile_version TEXT NOT NULL,
      model_version TEXT NOT NULL,
      execution_mode TEXT NOT NULL DEFAULT 'normal' CHECK(execution_mode IN ('normal','shadow')),
      privacy_policy_id TEXT,
      privacy_policy_version INTEGER,
      redaction_json TEXT,
      overlap_json TEXT,
      result_hash TEXT,
      result_json TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      UNIQUE(host,session_id,turn_id),
      FOREIGN KEY(host,session_id,turn_id) REFERENCES host_turns(host,session_id,turn_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS sensemaking_jobs_queue_idx ON sensemaking_jobs(status, lease_expires_at, created_at);
    CREATE TABLE IF NOT EXISTS routing_proposals(
      proposal_id TEXT PRIMARY KEY,
      finding_id TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      target_kind TEXT NOT NULL CHECK(target_kind IN ('current-task','project-policy','personal-policy','runtime-guard','hook','capability-candidate','product-issue','unresolved')),
      scope TEXT NOT NULL CHECK(scope IN ('task','project','personal','cross-project','unknown')),
      status TEXT NOT NULL CHECK(status IN ('proposed','trial','adopted','rejected')),
      rationale TEXT NOT NULL,
      applicability_json TEXT NOT NULL,
      non_applicability_json TEXT NOT NULL,
      required_evidence_json TEXT NOT NULL,
      risks_json TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision>=0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(finding_id) REFERENCES workflow_findings(finding_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS routing_proposals_status_idx ON routing_proposals(status, updated_at);
    CREATE TABLE IF NOT EXISTS route_decisions(
      decision_id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL UNIQUE,
      proposal_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('adopt','trial','reject')),
      expected_revision INTEGER NOT NULL,
      new_revision INTEGER NOT NULL,
      request_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(proposal_id) REFERENCES routing_proposals(proposal_id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS host_workflow_commands(
      command_id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activation_receipts(
      receipt_id TEXT PRIMARY KEY,
      host TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_id TEXT,
      project_ref TEXT,
      task_intent_hash TEXT,
      status TEXT NOT NULL CHECK(status IN ('offered','used','affected','dismissed','snoozed','released')),
      items_json TEXT NOT NULL,
      item_count INTEGER NOT NULL CHECK(item_count>=0),
      max_tokens INTEGER NOT NULL CHECK(max_tokens>=0),
      used_tokens INTEGER NOT NULL CHECK(used_tokens>=0),
      revision INTEGER NOT NULL CHECK(revision>=0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(host,session_id) REFERENCES host_sessions(host,session_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS activation_receipts_session_idx ON activation_receipts(host,session_id,created_at);
    CREATE TABLE IF NOT EXISTS activation_events(
      event_id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('offered','used','affected','dismissed','snoozed','released')),
      expected_revision INTEGER,
      new_revision INTEGER NOT NULL,
      command_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(receipt_id) REFERENCES activation_receipts(receipt_id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS repository_preflights(
      preflight_id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL UNIQUE,
      proposal_id TEXT,
      repo_root TEXT NOT NULL,
      execution_mode TEXT NOT NULL CHECK(execution_mode IN ('local','managed-worktree','cloud','unknown')),
      state_hash TEXT NOT NULL,
      input_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS repository_guard_receipts(
      receipt_id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL UNIQUE,
      preflight_id TEXT NOT NULL,
      proposal_id TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('applied','rejected','blocked','conflict')),
      before_state_hash TEXT NOT NULL,
      after_state_hash TEXT,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(preflight_id) REFERENCES repository_preflights(preflight_id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS sensemaking_privacy_receipts(
      receipt_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL UNIQUE,
      policy_id TEXT NOT NULL,
      policy_version INTEGER NOT NULL CHECK(policy_version>0),
      input_hash TEXT NOT NULL,
      redaction_json TEXT NOT NULL,
      overlap_json TEXT,
      status TEXT NOT NULL CHECK(status IN ('accepted','rejected')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES sensemaking_jobs(job_id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS repository_guard_journal(
      journal_id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL UNIQUE,
      preflight_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      repo_root TEXT NOT NULL,
      expected_branch TEXT NOT NULL,
      expected_head TEXT,
      before_state_hash TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('prepared','git_applied','receipt_committed','recovery_required','reconciled','failed')),
      intent_json TEXT NOT NULL,
      after_state_hash TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(preflight_id) REFERENCES repository_preflights(preflight_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS repository_guard_journal_state_idx ON repository_guard_journal(state, updated_at);
    CREATE TABLE IF NOT EXISTS publication_policies(
      policy_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN ('personal','project','cross-project')),
      target_root TEXT NOT NULL,
      allowed_kinds_json TEXT NOT NULL,
      validation_requirements_json TEXT NOT NULL,
      expires_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('active','revoked','expired')),
      revision INTEGER NOT NULL CHECK(revision>=0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revoked_at TEXT,
      revoke_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS capability_orchestrations(
      orchestration_id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL UNIQUE,
      finding_id TEXT NOT NULL,
      host TEXT NOT NULL,
      session_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      scope TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('candidate','trial_queued','staged','validated','published','rolled_back','producer_required','failed')),
      candidate_json TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      policy_id TEXT,
      candidate_dir TEXT,
      manifest_sha256 TEXT,
      validation_json TEXT,
      publication_json TEXT,
      revision INTEGER NOT NULL CHECK(revision>=0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(proposal_id) REFERENCES routing_proposals(proposal_id) ON DELETE RESTRICT,
      FOREIGN KEY(finding_id) REFERENCES workflow_findings(finding_id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS capability_trials(
      trial_id TEXT PRIMARY KEY,
      orchestration_id TEXT NOT NULL,
      capability_version TEXT NOT NULL,
      capability_hash TEXT NOT NULL,
      scenario TEXT NOT NULL,
      host TEXT,
      model TEXT,
      tool_config_json TEXT NOT NULL,
      task TEXT NOT NULL,
      expected TEXT NOT NULL,
      observed TEXT,
      evidence_refs_json TEXT NOT NULL,
      outcome TEXT CHECK(outcome IN ('support','limit','challenge','inconclusive')),
      status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed')),
      revision INTEGER NOT NULL CHECK(revision>=0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(orchestration_id) REFERENCES capability_orchestrations(orchestration_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS capability_trials_orchestration_idx ON capability_trials(orchestration_id, updated_at);
    CREATE TABLE IF NOT EXISTS publication_events(
      event_id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL UNIQUE,
      orchestration_id TEXT,
      operation TEXT NOT NULL,
      status TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(orchestration_id) REFERENCES capability_orchestrations(orchestration_id) ON DELETE RESTRICT
    );
  `);
  // The job table may have been created by the previous stage.  Migrate it
  // after CREATE TABLE IF NOT EXISTS so fresh databases do not attempt an
  // ALTER before the table exists.
  addColumn(db, 'sensemaking_jobs', 'lease_owner', 'TEXT');
  addColumn(db, 'sensemaking_jobs', 'execution_mode', "TEXT NOT NULL DEFAULT 'normal'");
  addColumn(db, 'sensemaking_jobs', 'privacy_policy_id', 'TEXT');
  addColumn(db, 'sensemaking_jobs', 'privacy_policy_version', 'INTEGER');
  addColumn(db, 'sensemaking_jobs', 'redaction_json', 'TEXT');
  addColumn(db, 'sensemaking_jobs', 'overlap_json', 'TEXT');
  addColumn(db, 'repository_guard_journal', 'request_hash', "TEXT NOT NULL DEFAULT ''");
  return true;
}

function decodeRow(row, jsonFields = []) {
  if (!row) return null;
  const result = {...row};
  for (const field of jsonFields) result[field] = parseJson(row[field], field, []);
  return result;
}
function jobView(row) {
  if (!row) return null;
  return {...row, input: parseJson(row.input_json, 'input_json'), result: parseJson(row.result_json, 'result_json'),
    redaction: parseJson(row.redaction_json, 'redaction_json', null), overlap: parseJson(row.overlap_json, 'overlap_json', null),
    input_json: undefined, result_json: undefined, redaction_json: undefined, overlap_json: undefined};
}
function findingView(row) {
  if (!row) return null;
  return {
    finding_id: row.finding_id, host: row.host, session_id: row.session_id, turn_id: row.turn_id,
    observation: row.observation, desired_behavior: row.desired_behavior ?? null, desiredBehavior: row.desired_behavior ?? null,
    scope: row.scope, target_kind: row.target_kind, targetKind: row.target_kind, status: row.status,
    finding_kind: row.finding_kind ?? 'captured', origin: row.origin ?? 'explicit',
    source_refs: parseJson(row.source_refs, 'source_refs', []), run_id: row.run_id ?? null,
    input_hash: row.input_hash ?? null, result_hash: row.result_hash ?? null, target_hint: row.target_hint ?? null,
    source_event_key: row.source_event_key ?? null, created_at: row.created_at,
  };
}
function proposalView(row) {
  if (!row) return null;
  return {
    proposal_id: row.proposal_id, finding_id: row.finding_id, host: row.host, session_id: row.session_id, turn_id: row.turn_id,
    target_kind: row.target_kind, scope: row.scope, status: row.status, rationale: row.rationale,
    applicability: parseJson(row.applicability_json, 'applicability_json', []),
    non_applicability: parseJson(row.non_applicability_json, 'non_applicability_json', []),
    required_evidence: parseJson(row.required_evidence_json, 'required_evidence_json', []),
    risks: parseJson(row.risks_json, 'risks_json', []), source_refs: parseJson(row.source_refs_json, 'source_refs_json', []),
    revision: row.revision, created_at: row.created_at, updated_at: row.updated_at,
  };
}
function activationView(row) {
  if (!row) return null;
  return {...row, items: parseJson(row.items_json, 'items_json', []), items_json: undefined};
}
function journalView(row) {
  if (!row) return null;
  return {...row, intent: parseJson(row.intent_json, 'intent_json', {}), intent_json: undefined};
}
function policyView(row) {
  if (!row) return null;
  return {...row, allowed_capability_kinds: parseJson(row.allowed_kinds_json, 'allowed_kinds_json', []), validation_requirements: parseJson(row.validation_requirements_json, 'validation_requirements_json', []), allowed_kinds_json: undefined, validation_requirements_json: undefined};
}
function orchestrationView(row) {
  if (!row) return null;
  return {...row, candidate: parseJson(row.candidate_json, 'candidate_json', {}), source_refs: parseJson(row.source_refs_json, 'source_refs_json', []), validation: parseJson(row.validation_json, 'validation_json', null), publication: parseJson(row.publication_json, 'publication_json', null), candidate_json: undefined, source_refs_json: undefined, validation_json: undefined, publication_json: undefined};
}
function trialView(row) {
  if (!row) return null;
  return {...row, tool_config: parseJson(row.tool_config_json, 'tool_config_json', {}), evidence_refs: parseJson(row.evidence_refs_json, 'evidence_refs_json', []), tool_config_json: undefined, evidence_refs_json: undefined};
}
function capabilitySlug(value) {
  const slug = String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return slug || 'trace-workflow';
}
function capabilityDraft(finding, proposal) {
  const candidateId = `host-${capabilitySlug(finding.finding_id)}`;
  const capabilityId = `trace-${capabilitySlug(proposal.target_kind)}-${capabilitySlug(finding.finding_id).slice(0, 48)}`;
  return {
    protocol_id: 'trace.capability-candidate', protocol_version: '0.2.0', candidate_id: candidateId, capability_id: capabilityId,
    claim: String(finding.observation ?? '').slice(0, 4_000) || '该 Host Session 发现可能对应一个可验证的工作流能力。',
    rationale: '该对象只是 adopted route 产生的候选草稿；仍需要内容 producer、Change Set、结构校验和行为 trial。',
    semantic_delta: {before: '当前没有可执行能力候选。', after: String(finding.desired_behavior ?? '').slice(0, 4_000) || '先验证适用范围，再决定是否生成能力候选。'},
    judgment_change: {claim: '采用 route 不等于发布 Skill。', reason: '能力候选必须保留来源、范围、验证和回滚边界。', confidence: 'medium'},
    mechanism: {problem: String(finding.observation ?? '').slice(0, 2_000) || '流程改进信号', cause: '来源于明确附着的 Host Session finding。', failure_modes: ['范围不清', '行为 trial 未通过', '内容 producer 或来源哈希缺失']},
    scope: {applies_to: [proposal.scope], does_not_apply_to: ['未满足用户采用、验证或回滚条件的其他任务']},
    counterexamples: ['一次讨论或一次成功运行不能单独证明普适能力。'],
    activation_contract: {triggers: ['用户明确请求带回已采用能力'], required_context: ['source_refs', 'adoption_receipt', 'validated_trial'], forbidden_context: ['raw-chat-transcript', 'unadopted-candidate']},
    input_contract: {required: ['task_intent', 'source_refs', 'validation_receipt'], optional: ['project_binding']},
    output_contract: {artifacts: ['capability_candidate', 'Change Set', 'trial receipt', 'publication receipt'], user_visible: ['范围', '验证结果', '回滚入口']},
    acceptance_contract: {structural: ['producer manifest hash matches', 'source refs remain resolvable'], behavioral: ['at least one explicit trial has an outcome'], user_visible: ['candidate remains reviewable before publication']},
    evidence_record_ids: [finding.finding_id], precedent_record_ids: [], adoption_status: 'pending', producer_status: 'required',
  };
}

const SENSE_RESULT_KEYS = new Set([
  'schema_id', 'schema_version', 'kind', 'confidence', 'observation',
  'desired_behavior', 'scope', 'target_kind', 'target_hint',
  'understanding_delta', 'open_questions', 'source',
]);

/** Validate the only result shape that Product Workspace will accept. */
export function validateSensemakingResult(result, job, suppliedRunId) {
  if (!plain(result) || Object.keys(result).some(key => !SENSE_RESULT_KEYS.has(key))
    || result.schema_id !== 'trace.sensemaking-result' || result.schema_version !== 1
    || !['candidate', 'noop'].includes(result.kind)
    || typeof result.confidence !== 'number' || !Number.isFinite(result.confidence)
    || result.confidence < 0 || result.confidence > 1
    || result.scope !== 'unknown' || result.target_kind !== 'unresolved'
    || !Array.isArray(result.open_questions) || result.open_questions.length > 16
    || !plain(result.source)) {
    fail('INVALID_SENSEMAKING_RESULT', 'sensemaking 结果必须符合 trace.sensemaking-result@1', 422);
  }
  const sourceKeys = new Set(['host', 'session_id', 'turn_id', 'run_id', 'input_hash']);
  if (Object.keys(result.source).some(key => !sourceKeys.has(key))
    || result.source.host !== job.host || result.source.session_id !== job.session_id
    || result.source.turn_id !== job.turn_id || result.source.input_hash !== job.input_hash
    || (suppliedRunId !== undefined && suppliedRunId !== null && result.source.run_id !== suppliedRunId)) {
    fail('INVALID_SENSEMAKING_RESULT', 'sensemaking source 必须精确引用当前 HostTurn 与 input hash', 422);
  }
  if (result.source.run_id !== null && (typeof result.source.run_id !== 'string' || result.source.run_id.length === 0 || result.source.run_id.length > MAX_ID)) {
    fail('INVALID_SENSEMAKING_RESULT', 'sensemaking source.run_id 无效', 422);
  }
  if (result.kind === 'candidate') {
    text(result.observation, 'result.observation', 16_000);
    text(result.desired_behavior, 'result.desired_behavior', 16_000);
  } else if (result.observation !== null || result.desired_behavior !== null) {
    fail('INVALID_SENSEMAKING_RESULT', 'noop 结果不能携带候选正文', 422);
  }
  if (result.target_hint !== null && result.target_hint !== undefined) text(result.target_hint, 'result.target_hint', 128);
  for (const question of result.open_questions) text(question, 'result.open_questions[]', 2_000);
  if (result.understanding_delta !== null && result.understanding_delta !== undefined) {
    if (!plain(result.understanding_delta)) fail('INVALID_SENSEMAKING_RESULT', 'understanding_delta 必须是对象或 null', 422);
    jsonColumn(result.understanding_delta, 'understanding_delta', 32_000);
  }
  return result.source.run_id ?? (suppliedRunId ?? null);
}

/** Enqueue exactly one job per completed HostTurn in the same Product transaction. */
export function enqueueSensemakingJob(db, input, options = {}) {
  const host = identity(input.host ?? 'codex', 'host');
  const sessionId = identity(input.session_id ?? input.sessionId, 'session_id');
  const turnId = identity(input.turn_id ?? input.turnId, 'turn_id');
  const prompt = text(input.prompt, 'prompt', MAX_TEXT, {empty: true});
  const final = optionalText(input.last_assistant_message ?? input.lastAssistantMessage, 'last_assistant_message');
  if (options.maxAttempts !== undefined && (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 10)) {
    fail('INVALID_SENSEMAKING_JOB', 'maxAttempts must be an integer from 1 to 10', 400);
  }
  const profileId = identity(options.profileId ?? 'fixture-sensemaking', 'profile_id', 256);
  const profileVersion = identity(String(options.profileVersion ?? '1'), 'profile_version', 128);
  const modelVersion = identity(String(options.modelVersion ?? 'fixture-1'), 'model_version', 256);
  const executionMode = options.executionMode ?? options.execution_mode ?? 'normal';
  if (!['normal', 'shadow'].includes(executionMode)) fail('INVALID_SENSEMAKING_JOB', 'execution_mode 必须是 normal 或 shadow', 400);
  // Stop receives only hashes and safe identifiers from Host Session.  Keep
  // related findings as bounded summaries instead of allowing a large
  // explicit finding to make the reliable Stop transaction exceed its job
  // payload bound.
  const safeEvidence = (Array.isArray(input.safe_evidence) ? input.safe_evidence : []).slice(0, 64).map(item => {
    if (!plain(item)) return null;
    return {
      event_kind: optionalText(item.event_kind, 'safe_evidence.event_kind', 64),
      tool_use_id: optionalIdentity(item.tool_use_id, 'safe_evidence.tool_use_id'),
      content_sha256: typeof item.content_sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.content_sha256) ? item.content_sha256 : null,
      created_at: optionalText(item.created_at, 'safe_evidence.created_at', 64),
    };
  }).filter(Boolean);
  const relatedFindings = (Array.isArray(input.related_findings) ? input.related_findings : []).slice(0, 16).map(item => {
    if (!plain(item)) return null;
    return {
      finding_id: optionalIdentity(item.finding_id, 'related_findings.finding_id'),
      observation: optionalText(item.observation, 'related_findings.observation', 2_000),
      desired_behavior: optionalText(item.desired_behavior ?? item.desiredBehavior, 'related_findings.desired_behavior', 2_000),
      status: optionalText(item.status, 'related_findings.status', 64),
      scope: optionalText(item.scope, 'related_findings.scope', 64),
      target_kind: optionalText(item.target_kind ?? item.targetKind, 'related_findings.target_kind', 64),
    };
  }).filter(Boolean);
  const payload = {host, session_id: sessionId, turn_id: turnId, user_prompt: prompt, final_assistant_message: final, safe_evidence: safeEvidence, related_findings: relatedFindings};
  const inputHash = workflowHash(payload);
  const jobId = `sensemaking:${workflowHash({host, session_id: sessionId, turn_id: turnId}).slice(0, 48)}`;
  const existing = db.prepare('SELECT * FROM sensemaking_jobs WHERE host=? AND session_id=? AND turn_id=?').get(host, sessionId, turnId);
  if (existing) {
    if (existing.input_hash !== inputHash) fail('HOST_SENSEMAKING_INPUT_CONFLICT', '同一 HostTurn 的 sensemaking 输入不能被替换', 409);
    return jobView(existing);
  }
  const timestamp = now();
  db.prepare(`INSERT INTO sensemaking_jobs(job_id,host,session_id,turn_id,status,attempt,max_attempts,lease_token,lease_owner,lease_expires_at,input_hash,input_json,profile_id,profile_version,model_version,execution_mode,privacy_policy_id,privacy_policy_version,redaction_json,overlap_json,result_hash,result_json,error_code,error_message,created_at,updated_at,started_at,finished_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    jobId, host, sessionId, turnId, 'queued', 0, options.maxAttempts ?? 3, null, null, null, inputHash, jsonColumn(payload, 'sensemaking input'),
    profileId, profileVersion, modelVersion, executionMode, null, null, null, null, null, null, null, null, timestamp, timestamp, null, null,
  );
  return jobView(db.prepare('SELECT * FROM sensemaking_jobs WHERE job_id=?').get(jobId));
}

function commandReplay(db, commandId, requestHash) {
  const row = db.prepare('SELECT request_hash,result_json FROM host_workflow_commands WHERE command_id=?').get(commandId);
  if (!row) return null;
  if (row.request_hash !== requestHash) fail('HOST_WORKFLOW_COMMAND_CONFLICT', '同一工作流命令 ID 不能对应不同内容', 409);
  return parseJson(row.result_json, 'result_json');
}
function saveCommand(db, commandId, operation, requestHash, result, timestamp = now()) {
  const canonicalResult = JSON.parse(stableWorkflowJson(result));
  db.prepare('INSERT INTO host_workflow_commands(command_id,operation,request_hash,result_json,created_at) VALUES(?,?,?,?,?)').run(commandId, operation, requestHash, stableWorkflowJson(canonicalResult), timestamp);
  return canonicalResult;
}
function commandInput(input, operation, fields = {}) {
  if (!plain(input)) fail('INVALID_HOST_WORKFLOW', '工作流命令必须是 JSON 对象', 400);
  const commandId = identity(input.command_id ?? input.commandId, 'command_id', 200);
  const normalized = {operation, command_id: commandId, ...fields};
  return {commandId, normalized, requestHash: workflowHash(normalized)};
}
function readFinding(db, findingId) { return db.prepare('SELECT * FROM workflow_findings WHERE finding_id=?').get(findingId); }
function readProposal(db, proposalId) { return db.prepare('SELECT * FROM routing_proposals WHERE proposal_id=?').get(proposalId); }

function heuristicRoute(finding) {
  const haystack = `${finding.observation}\n${finding.desired_behavior ?? ''}\n${finding.target_hint ?? ''}`.toLowerCase();
  let targetKind = 'unresolved';
  if (/runtime-guard|branch|git|仓库|分支|脏工作区|发布|worktree/.test(haystack)) targetKind = 'runtime-guard';
  else if (/hook|sessionstart|sessionend|prompt submit|宿主|捕获|附着|跟随/.test(haystack)) targetKind = 'hook';
  else if (/skill|capability|能力|技能/.test(haystack)) targetKind = 'capability-candidate';
  else if (/bug|issue|故障|错误|产品问题/.test(haystack)) targetKind = 'product-issue';
  else if (/project|项目|仓库约定|团队规范/.test(haystack)) targetKind = 'project-policy';
  else if (/personal|个人|偏好|总是|以后都/.test(haystack)) targetKind = 'personal-policy';
  else if (/task|任务|承接|本轮|当前/.test(haystack)) targetKind = 'current-task';
  const scope = targetKind === 'runtime-guard' || targetKind === 'project-policy' || targetKind === 'hook' ? 'project'
    : targetKind === 'personal-policy' ? 'personal' : targetKind === 'current-task' ? 'task' : targetKind === 'capability-candidate' ? 'cross-project' : 'unknown';
  return {
    targetKind, scope,
    rationale: targetKind === 'unresolved' ? '现有证据不足以安全判断落点，先保留为待澄清提案。' : `确定性关键词规则将该发现建议到 ${targetKind}。`,
    applicability: targetKind === 'runtime-guard' ? ['仅在本地仓库、用户明确采用且工作区干净时可执行。'] : ['仅在提案所记录的范围与条件满足时适用。'],
    nonApplicability: ['不适用于未绑定的项目、不同宿主会话或未满足证据条件的任务。'],
    requiredEvidence: targetKind === 'runtime-guard' ? ['最新 git 状态、当前/默认分支、执行模式、用户采用回执。'] : ['用户明确的采用或试用决定。'],
    risks: targetKind === 'runtime-guard' ? ['错误分支建议可能扰乱后续发布；默认只建议不变更。'] : ['提案不等于规则、Skill 或 canonical understanding。'],
  };
}

export function createHostWorkflowService({db, transaction, faultInjector = null, allowSchemaMigration = true}) {
  if (!db || typeof db.prepare !== 'function' || typeof transaction !== 'function') throw new TypeError('createHostWorkflowService requires db and transaction');
  ensureHostWorkflowSchema(db, {allowSchemaMigration});

  function listSensemakingJobs({host, sessionId, session_id: snakeSessionId, status} = {}) {
    const resolvedSessionId = sessionId ?? snakeSessionId;
    const clauses = [], values = [];
    if (host !== undefined) { identity(host, 'host'); clauses.push('host=?'); values.push(host); }
    if (resolvedSessionId !== undefined) { identity(resolvedSessionId, 'session_id'); clauses.push('session_id=?'); values.push(resolvedSessionId); }
    if (status !== undefined) { if (!JOB_STATUSES.has(status)) fail('INVALID_JOB_STATUS', '不支持的 sensemaking job 状态'); clauses.push('status=?'); values.push(status); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM sensemaking_jobs${where} ORDER BY created_at DESC`).all(...values).map(jobView);
  }
  function listSensemakingResults({host, sessionId, session_id: snakeSessionId} = {}) {
    const resolvedSessionId = sessionId ?? snakeSessionId;
    return listSensemakingJobs({host, sessionId: resolvedSessionId}).filter(job => ['succeeded', 'noop'].includes(job.status)).map(job => ({
      job_id: job.job_id, host: job.host, session_id: job.session_id, turn_id: job.turn_id, status: job.status,
      result_hash: job.result_hash, result: job.result, profile_id: job.profile_id, profile_version: job.profile_version,
      model_version: job.model_version, attempt: job.attempt, finished_at: job.finished_at,
    }));
  }

  function claimSensemakingJob({leaseMs = 30_000, maxAttempts = 3, ownerId = null, profileId = null, profileVersion = null, modelVersion = null, executionMode = null} = {}) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) fail('INVALID_JOB_LEASE', 'leaseMs 超出范围');
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) fail('INVALID_JOB_ATTEMPTS', 'maxAttempts 必须在 1..10 范围内', 400);
    const owner = ownerId === null || ownerId === undefined ? null : identity(ownerId, 'lease_owner', 200);
    const selectedProfile = profileId === null || profileId === undefined ? null : identity(profileId, 'profile_id', 256);
    const selectedProfileVersion = profileVersion === null || profileVersion === undefined ? null : identity(String(profileVersion), 'profile_version', 128);
    const selectedModelVersion = modelVersion === null || modelVersion === undefined ? null : identity(String(modelVersion), 'model_version', 256);
    if (executionMode !== null && executionMode !== undefined && !['normal', 'shadow'].includes(executionMode)) fail('INVALID_SENSEMAKING_JOB', 'execution_mode 必须是 normal 或 shadow', 400);
    return transaction(() => {
      const timestamp = now();
      const row = db.prepare(`SELECT * FROM sensemaking_jobs WHERE
        ((status='queued' AND attempt < max_attempts) OR (status='failed' AND attempt < max_attempts) OR
        (status='running' AND attempt < max_attempts AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?))
        AND attempt < ? ORDER BY created_at LIMIT 1`).get(timestamp, maxAttempts);
      if (!row) return null;
      const leaseToken = crypto.randomUUID();
      const expires = new Date(Date.now() + leaseMs).toISOString();
      // A queued job may carry the fixture defaults from Stop.  The actual
      // server-selected profile is bound at claim time; an explicit non-fixture
      // profile on the job is never silently replaced.
      if (selectedProfile !== null && row.profile_id !== 'fixture-sensemaking' && row.profile_id !== selectedProfile) fail('SENSEMAKING_PROFILE_CONFLICT', 'sensemaking job 已绑定另一个 profile', 409);
      db.prepare(`UPDATE sensemaking_jobs SET status='running', attempt=attempt+1, lease_token=?, lease_owner=?, lease_expires_at=?, profile_id=COALESCE(?,profile_id), profile_version=COALESCE(?,profile_version), model_version=COALESCE(?,model_version), execution_mode=COALESCE(?,execution_mode), updated_at=?, started_at=COALESCE(started_at,?), error_code=NULL, error_message=NULL WHERE job_id=?`).run(leaseToken, owner, expires, selectedProfile, selectedProfileVersion, selectedModelVersion, executionMode, timestamp, timestamp, row.job_id);
      return jobView(db.prepare('SELECT * FROM sensemaking_jobs WHERE job_id=?').get(row.job_id));
    });
  }

  function renewSensemakingJob(input) {
    const jobId = identity(input.jobId ?? input.job_id, 'job_id');
    const leaseToken = identity(input.leaseToken ?? input.lease_token, 'lease_token');
    const owner = input.ownerId ?? input.owner_id;
    if (owner !== undefined && owner !== null) identity(owner, 'lease_owner', 200);
    const leaseMs = input.leaseMs ?? input.lease_ms ?? 30_000;
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) fail('INVALID_JOB_LEASE', 'leaseMs 超出范围');
    return transaction(() => {
      const row = db.prepare('SELECT * FROM sensemaking_jobs WHERE job_id=?').get(jobId);
      if (!row) fail('SENSEMAKING_JOB_NOT_FOUND', '没有这个 sensemaking job', 404);
      if (row.status !== 'running' || row.lease_token !== leaseToken || owner !== undefined && owner !== null && row.lease_owner !== owner) fail('SENSEMAKING_LEASE_LOST', 'sensemaking job lease 已失效', 409);
      const expires = new Date(Date.now() + leaseMs).toISOString();
      db.prepare('UPDATE sensemaking_jobs SET lease_expires_at=?,updated_at=? WHERE job_id=? AND lease_token=?').run(expires, now(), jobId, leaseToken);
      return jobView(db.prepare('SELECT * FROM sensemaking_jobs WHERE job_id=?').get(jobId));
    });
  }

  function finishSensemakingJob(input) {
    const jobId = identity(input.jobId ?? input.job_id, 'job_id');
    const leaseToken = identity(input.leaseToken ?? input.lease_token, 'lease_token');
    const leaseOwner = input.ownerId ?? input.owner_id;
    if (leaseOwner !== undefined && leaseOwner !== null) identity(leaseOwner, 'lease_owner', 200);
    const result = input.result;
    return transaction(() => {
      const row = db.prepare('SELECT * FROM sensemaking_jobs WHERE job_id=?').get(jobId);
      if (!row) fail('SENSEMAKING_JOB_NOT_FOUND', '没有这个 sensemaking job', 404);
      if (['succeeded', 'noop'].includes(row.status)) {
        if (result !== undefined && workflowHash(result) !== row.result_hash) fail('SENSEMAKING_RESULT_CONFLICT', '已完成的 sensemaking job 不能接受不同结果', 409);
        return {job: jobView(row), finding: null, proposal: null, replay: true};
      }
      if (row.lease_token !== leaseToken || row.status !== 'running' || leaseOwner !== undefined && leaseOwner !== null && row.lease_owner !== leaseOwner) fail('SENSEMAKING_LEASE_LOST', 'sensemaking job lease 已失效，请重新领取', 409);
      const runId = validateSensemakingResult(result, row, input.runId ?? input.run_id);
      const resultHash = workflowHash(result);
      const timestamp = now();
      let finding = null; let proposal = null;
      if (result.kind === 'candidate') {
        const findingId = `workflow-finding:sensemaking:${jobId}:${resultHash.slice(0, 24)}`;
        const sourceRefs = [{type: 'host-turn', host: row.host, session_id: row.session_id, turn_id: row.turn_id}, {type: 'sensemaking-run', run_id: runId}];
        db.prepare(`INSERT OR IGNORE INTO workflow_findings(finding_id,host,session_id,turn_id,observation,desired_behavior,scope,target_kind,status,source_event_key,created_at,finding_kind,origin,source_refs,run_id,input_hash,result_hash,target_hint)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(findingId, row.host, row.session_id, row.turn_id, result.observation, result.desired_behavior, 'unknown', 'unresolved', 'captured', null, timestamp, 'candidate', 'sensemaking', jsonColumn(sourceRefs, 'source_refs'), runId, row.input_hash, resultHash, result.target_hint ?? null);
        finding = findingView(readFinding(db, findingId));
        if (input.route !== false && row.execution_mode !== 'shadow') proposal = ensureRoutingProposal(db, finding, timestamp);
      }
      const status = result.kind === 'noop' ? 'noop' : 'succeeded';
      db.prepare(`UPDATE sensemaking_jobs SET status=?,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,result_hash=?,result_json=?,updated_at=?,finished_at=? WHERE job_id=?`).run(status, resultHash, jsonColumn(result, 'result'), timestamp, timestamp, jobId);
      return {job: jobView(db.prepare('SELECT * FROM sensemaking_jobs WHERE job_id=?').get(jobId)), finding, proposal, replay: false};
    });
  }

  function failSensemakingJob(input) {
    const jobId = identity(input.jobId ?? input.job_id, 'job_id');
    const leaseToken = identity(input.leaseToken ?? input.lease_token, 'lease_token');
    const leaseOwner = input.ownerId ?? input.owner_id;
    if (leaseOwner !== undefined && leaseOwner !== null) identity(leaseOwner, 'lease_owner', 200);
    const code = identity(input.errorCode ?? input.error_code ?? 'SENSEMAKING_FAILED', 'error_code', 128);
    const message = text(input.errorMessage ?? input.error_message ?? 'sensemaking failed', 'error_message', 2_000, {empty: false});
    return transaction(() => {
      const row = db.prepare('SELECT * FROM sensemaking_jobs WHERE job_id=?').get(jobId);
      if (!row) fail('SENSEMAKING_JOB_NOT_FOUND', '没有这个 sensemaking job', 404);
      if (['succeeded', 'noop'].includes(row.status)) return jobView(row);
      if (row.lease_token !== leaseToken || row.status !== 'running' || leaseOwner !== undefined && leaseOwner !== null && row.lease_owner !== leaseOwner) fail('SENSEMAKING_LEASE_LOST', 'sensemaking job lease 已失效', 409);
      const terminal = row.attempt >= row.max_attempts;
      const timestamp = now();
      db.prepare(`UPDATE sensemaking_jobs SET status='failed',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,error_code=?,error_message=?,updated_at=?,finished_at=? WHERE job_id=?`).run(code, message, timestamp, terminal ? timestamp : null, jobId);
      return jobView(db.prepare('SELECT * FROM sensemaking_jobs WHERE job_id=?').get(jobId));
    });
  }

  function recordSensemakingPrivacy(input) {
    const jobId = identity(input.jobId ?? input.job_id, 'job_id');
    const leaseToken = identity(input.leaseToken ?? input.lease_token, 'lease_token');
    const leaseOwner = input.ownerId ?? input.owner_id;
    if (leaseOwner !== undefined && leaseOwner !== null) identity(leaseOwner, 'lease_owner', 200);
    const policyId = identity(input.policyId ?? input.policy_id, 'policy_id', 128);
    const policyVersion = input.policyVersion ?? input.policy_version;
    if (!Number.isSafeInteger(policyVersion) || policyVersion < 1) fail('INVALID_PRIVACY_POLICY', 'privacy policy version 无效', 400);
    const status = input.status ?? 'accepted';
    if (!['accepted', 'rejected'].includes(status)) fail('INVALID_PRIVACY_RECEIPT', 'privacy receipt status 无效', 400);
    const inputHash = identity(input.inputHash ?? input.input_hash, 'input_hash', 128);
    const redaction = input.redaction ?? {};
    const overlap = input.overlap ?? null;
    return transaction(() => {
      const row = db.prepare('SELECT * FROM sensemaking_jobs WHERE job_id=?').get(jobId);
      if (!row) fail('SENSEMAKING_JOB_NOT_FOUND', '没有这个 sensemaking job', 404);
      if (row.input_hash !== inputHash) fail('SENSEMAKING_INPUT_CONFLICT', 'privacy receipt 的输入哈希不匹配', 409);
      if (row.lease_token !== leaseToken || row.status !== 'running' || leaseOwner !== undefined && leaseOwner !== null && row.lease_owner !== leaseOwner) fail('SENSEMAKING_LEASE_LOST', 'sensemaking job lease 已失效', 409);
      const receiptId = `sensemaking-privacy:${jobId}`;
      const timestamp = now();
      const encodedRedaction = jsonColumn(redaction, 'redaction receipt', 128_000);
      const encodedOverlap = overlap === null ? null : jsonColumn(overlap, 'overlap receipt', 16_000);
      const existing = db.prepare('SELECT * FROM sensemaking_privacy_receipts WHERE receipt_id=?').get(receiptId);
      if (existing) {
        if (existing.input_hash !== inputHash || existing.policy_id !== policyId || existing.policy_version !== policyVersion) fail('PRIVACY_RECEIPT_CONFLICT', 'privacy receipt 不能替换既有策略结果', 409);
      } else db.prepare('INSERT INTO sensemaking_privacy_receipts(receipt_id,job_id,policy_id,policy_version,input_hash,redaction_json,overlap_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(receiptId, jobId, policyId, policyVersion, inputHash, encodedRedaction, encodedOverlap, status, timestamp, timestamp);
      db.prepare('UPDATE sensemaking_jobs SET privacy_policy_id=?,privacy_policy_version=?,redaction_json=?,overlap_json=?,updated_at=? WHERE job_id=? AND lease_token=?').run(policyId, policyVersion, encodedRedaction, encodedOverlap, timestamp, jobId, leaseToken);
      return {receipt_id: receiptId, job_id: jobId, policy_id: policyId, policy_version: policyVersion, input_hash: inputHash, redaction: JSON.parse(encodedRedaction), overlap: overlap === null ? null : JSON.parse(encodedOverlap), status};
    });
  }

  function listSensemakingPrivacyReceipts({jobId, job_id: snakeJobId} = {}) {
    const resolved = jobId ?? snakeJobId; const clauses = [], values = [];
    if (resolved !== undefined) { identity(resolved, 'job_id'); clauses.push('job_id=?'); values.push(resolved); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM sensemaking_privacy_receipts${where} ORDER BY created_at DESC`).all(...values).map(row => ({...row, redaction: parseJson(row.redaction_json, 'redaction_json', {}), overlap: parseJson(row.overlap_json, 'overlap_json', null), redaction_json: undefined, overlap_json: undefined}));
  }

  function listFindings({host, sessionId, status} = {}) {
    const clauses = [], values = [];
    if (host !== undefined) { identity(host, 'host'); clauses.push('host=?'); values.push(host); }
    if (sessionId !== undefined) { identity(sessionId, 'session_id'); clauses.push('session_id=?'); values.push(sessionId); }
    if (status !== undefined) { text(status, 'status', 32); clauses.push('status=?'); values.push(status); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM workflow_findings${where} ORDER BY created_at DESC`).all(...values).map(findingView);
  }

  function ensureRoutingProposal(dbHandle, finding, timestamp = now()) {
    const existing = dbHandle.prepare('SELECT * FROM routing_proposals WHERE finding_id=?').get(finding.finding_id);
    if (existing) return proposalView(existing);
    const route = heuristicRoute(finding);
    // Never infer a project-scoped rule from a floating host session. A user
    // may still review/adopt a personal runtime guard or policy, while a
    // project-scoped activation requires the stable binding recorded on the
    // attached session.
    const session = dbHandle.prepare('SELECT project_ref FROM host_sessions WHERE host=? AND session_id=?').get(finding.host, finding.session_id);
    if (route.scope === 'project' && (session?.project_ref === null || session?.project_ref === undefined)) route.scope = 'personal';
    const proposalId = `routing-proposal:${workflowHash({finding_id: finding.finding_id, target_kind: route.targetKind, scope: route.scope}).slice(0, 48)}`;
    dbHandle.prepare(`INSERT OR IGNORE INTO routing_proposals(proposal_id,finding_id,host,session_id,turn_id,target_kind,scope,status,rationale,applicability_json,non_applicability_json,required_evidence_json,risks_json,source_refs_json,revision,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(proposalId, finding.finding_id, finding.host, finding.session_id, finding.turn_id, route.targetKind, route.scope, 'proposed', route.rationale, jsonColumn(route.applicability, 'applicability'), jsonColumn(route.nonApplicability, 'non_applicability'), jsonColumn(route.requiredEvidence, 'required_evidence'), jsonColumn(route.risks, 'risks'), jsonColumn(finding.source_refs ?? [], 'source_refs'), 0, timestamp, timestamp);
    return proposalView(dbHandle.prepare('SELECT * FROM routing_proposals WHERE proposal_id=?').get(proposalId));
  }

  function createRoutingProposal(input) {
    const findingId = identity(input.findingId ?? input.finding_id, 'finding_id');
    const suppliedHost = input.host === undefined ? null : identity(input.host, 'host');
    const suppliedSessionId = input.sessionId === undefined && input.session_id === undefined ? null : identity(input.sessionId ?? input.session_id, 'session_id');
    const commandId = input.commandId ?? input.command_id
      ?? `routing-propose:${workflowHash({finding_id: findingId, host: suppliedHost, session_id: suppliedSessionId}).slice(0, 48)}`;
    const command = commandInput({...input, command_id: commandId}, 'routing.propose', {
      finding_id: findingId,
      ...(suppliedHost === null ? {} : {host: suppliedHost}),
      ...(suppliedSessionId === null ? {} : {session_id: suppliedSessionId}),
    });
    return transaction(() => {
      const replay = commandReplay(db, command.commandId, command.requestHash); if (replay) return replay;
      const finding = readFinding(db, findingId);
      if (!finding) fail('FINDING_NOT_FOUND', '没有这个 WorkflowFinding', 404);
      if ((suppliedHost !== null && finding.host !== suppliedHost) || (suppliedSessionId !== null && finding.session_id !== suppliedSessionId)) fail('FINDING_SESSION_CONFLICT', 'finding 不属于当前宿主会话', 409);
      const proposal = ensureRoutingProposal(db, findingView(finding));
      return saveCommand(db, command.commandId, command.normalized.operation, command.requestHash, proposal);
    });
  }
  function listRoutingProposals({host, sessionId, session_id: snakeSessionId, status} = {}) {
    const resolvedSessionId = sessionId ?? snakeSessionId;
    const clauses = [], values = [];
    if (host !== undefined) { identity(host, 'host'); clauses.push('host=?'); values.push(host); }
    if (resolvedSessionId !== undefined) { identity(resolvedSessionId, 'session_id'); clauses.push('session_id=?'); values.push(resolvedSessionId); }
    if (status !== undefined) { if (!PROPOSAL_STATUSES.has(status)) fail('INVALID_PROPOSAL_STATUS', '不支持的 proposal 状态'); clauses.push('status=?'); values.push(status); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM routing_proposals${where} ORDER BY updated_at DESC`).all(...values).map(proposalView);
  }
  function ensureCapabilityOrchestration(proposal, timestamp = now()) {
    if (!proposal || proposal.target_kind !== 'capability-candidate') return null;
    const existing = db.prepare('SELECT * FROM capability_orchestrations WHERE proposal_id=?').get(proposal.proposal_id);
    if (existing) return orchestrationView(existing);
    const finding = readFinding(db, proposal.finding_id); if (!finding) fail('FINDING_NOT_FOUND', '能力候选缺少来源 finding', 404);
    const draft = capabilityDraft(findingView(finding), proposal);
    const orchestrationId = `capability-orchestration:${workflowHash({proposal_id: proposal.proposal_id, candidate_id: draft.candidate_id}).slice(0, 48)}`;
    db.prepare('INSERT INTO capability_orchestrations(orchestration_id,proposal_id,finding_id,host,session_id,target_kind,scope,status,candidate_json,source_refs_json,policy_id,candidate_dir,manifest_sha256,validation_json,publication_json,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      orchestrationId, proposal.proposal_id, proposal.finding_id, proposal.host, proposal.session_id, proposal.target_kind, proposal.scope, 'candidate', jsonColumn(draft, 'capability candidate draft', 128_000), jsonColumn(findingView(finding).source_refs ?? [], 'capability source refs', 32_000), null, null, null, null, null, 0, timestamp, timestamp,
    );
    return orchestrationView(db.prepare('SELECT * FROM capability_orchestrations WHERE orchestration_id=?').get(orchestrationId));
  }
  function decideRouting(input) {
    const proposalId = identity(input.proposalId ?? input.proposal_id, 'proposal_id');
    const action = input.action;
    if (!DECISIONS.has(action)) fail('INVALID_ROUTE_DECISION', 'action 必须是 adopt、trial 或 reject');
    const expectedRevision = input.expectedRevision ?? input.expected_revision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('INVALID_ROUTE_DECISION', '需要有效的 expected_revision', 400);
    const suppliedHost = input.host === undefined ? null : identity(input.host, 'host');
    const suppliedSessionId = input.sessionId === undefined && input.session_id === undefined ? null : identity(input.sessionId ?? input.session_id, 'session_id');
    const command = commandInput(input, `routing.${action}`, {proposal_id: proposalId, action, expected_revision: expectedRevision, note: optionalText(input.note, 'note', 2_000), ...(suppliedHost === null ? {} : {host: suppliedHost}), ...(suppliedSessionId === null ? {} : {session_id: suppliedSessionId})});
    return transaction(() => {
      const replay = commandReplay(db, command.commandId, command.requestHash); if (replay) return replay;
      const proposal = readProposal(db, proposalId); if (!proposal) fail('ROUTING_PROPOSAL_NOT_FOUND', '没有这个路由提案', 404);
      if ((suppliedHost !== null && proposal.host !== suppliedHost) || (suppliedSessionId !== null && proposal.session_id !== suppliedSessionId)) fail('ROUTING_SESSION_CONFLICT', '路由提案不属于当前宿主会话', 409);
      if (proposal.revision !== expectedRevision) fail('ROUTING_REVISION_CONFLICT', '路由提案已经变化，请重新读取', 409);
      if (!PROPOSAL_STATUSES.has(proposal.status) || proposal.status === 'rejected' && action !== 'reject') fail('ROUTING_STATE_CONFLICT', '该路由提案不能执行此动作', 409);
      const timestamp = now(); const newStatus = action === 'adopt' ? 'adopted' : action === 'trial' ? 'trial' : 'rejected'; const newRevision = proposal.revision + 1;
      db.prepare('UPDATE routing_proposals SET status=?,revision=?,updated_at=? WHERE proposal_id=? AND revision=?').run(newStatus, newRevision, timestamp, proposalId, expectedRevision);
      const updatedProposal = proposalView(readProposal(db, proposalId));
      const orchestration = newStatus === 'adopted' ? ensureCapabilityOrchestration(updatedProposal, timestamp) : null;
      const result = {protocolVersion: 1, status: newStatus, proposal: updatedProposal, ...(orchestration === null ? {} : {capability_orchestration: orchestration}), receipt: {receipt_id: `route:${command.commandId}`, command_id: command.commandId, operation: command.normalized.operation, effect: newStatus === 'adopted' ? 'proposal-adopted-not-skill-published' : newStatus}};
      db.prepare('INSERT INTO route_decisions(decision_id,command_id,proposal_id,action,expected_revision,new_revision,request_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(`route-decision:${command.commandId}`, command.commandId, proposalId, action, expectedRevision, newRevision, command.requestHash, stableWorkflowJson(result), timestamp);
      return saveCommand(db, command.commandId, command.normalized.operation, command.requestHash, result, timestamp);
    });
  }

  function sessionProject(host, sessionId) { return db.prepare('SELECT project_ref FROM host_sessions WHERE host=? AND session_id=?').get(host, sessionId)?.project_ref ?? null; }
  function queryActivation(input = {}) {
    const host = identity(input.host ?? 'codex', 'host');
    const sessionId = identity(input.sessionId ?? input.session_id, 'session_id');
    const turnId = optionalIdentity(input.turnId ?? input.turn_id, 'turn_id');
    const projectRef = optionalText(input.projectRef ?? input.project_ref ?? input.repoBinding ?? input.repo_binding, 'project_ref', MAX_ID * 8);
    const taskIntent = optionalText(input.taskIntent ?? input.task_intent, 'task_intent', 8_000);
    const includeTrial = input.includeTrial === true || input.include_trial === true;
    const requestedMaxItems = input.maxItems ?? input.max_items;
    const requestedMaxTokens = input.maxTokens ?? input.max_tokens;
    const maxItems = Math.max(1, Math.min(MAX_ITEMS, Number.isSafeInteger(requestedMaxItems) ? requestedMaxItems : 8));
    const maxTokens = Math.max(128, Math.min(12_000, Number.isSafeInteger(requestedMaxTokens) ? requestedMaxTokens : 4_000));
    const session = db.prepare('SELECT host,session_id,status,project_ref FROM host_sessions WHERE host=? AND session_id=?').get(host, sessionId);
    if (!session) fail('HOST_SESSION_NOT_FOUND', 'activation requires an explicitly attached host session', 404);
    if (session.status === 'ended') fail('HOST_SESSION_ENDED', 'ended host sessions cannot receive activation', 409);
    if (projectRef !== null && session.project_ref !== null && projectRef !== session.project_ref) fail('HOST_SESSION_BINDING_CONFLICT', 'activation project binding does not match the attached session', 409);
    const boundProject = projectRef ?? session.project_ref ?? null;
    const rows = db.prepare(`SELECT p.*, f.observation, f.desired_behavior, f.source_refs, f.run_id, f.finding_kind, f.origin
      FROM routing_proposals p JOIN workflow_findings f ON f.finding_id=p.finding_id
      WHERE p.status IN ('adopted'${includeTrial ? ",'trial'" : ''}) ORDER BY CASE p.status WHEN 'adopted' THEN 0 ELSE 1 END, p.updated_at DESC`).all();
    const items = []; let budget = 0;
    const intentTokens = taskIntent === null ? [] : taskIntent.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(token => token.length > 1).slice(0, 16);
    for (const row of rows) {
      if (row.status === 'trial' && !includeTrial) continue;
      if (row.scope === 'task' && (row.host !== host || row.session_id !== sessionId)) continue;
      if (row.scope === 'project' && (boundProject === null || sessionProject(row.host, row.session_id) !== boundProject)) continue;
      if (row.scope === 'unknown') continue;
      const haystack = `${row.target_kind} ${row.rationale} ${row.observation} ${row.desired_behavior ?? ''}`.toLowerCase();
      if (intentTokens.length > 0 && row.scope === 'task' && !intentTokens.some(token => haystack.includes(token))) continue;
      const item = {
        proposal_id: row.proposal_id, finding_id: row.finding_id, target_kind: row.target_kind, scope: row.scope,
        status: row.status, trial: row.status === 'trial', observation: row.observation, desired_behavior: row.desired_behavior ?? null,
        why_shown: row.status === 'adopted' ? '用户已采用，且当前会话/稳定项目绑定满足适用范围。' : '用户已设为试用，明确标记为 trial；不会当作已采用规则。',
        provenance_refs: [{type: 'workflow-finding', finding_id: row.finding_id}, {type: 'host-turn', host: row.host, session_id: row.session_id, turn_id: row.turn_id}, ...parseJson(row.source_refs, 'source_refs', [])],
        stop_condition: '用户 dismiss/snooze/release、会话结束或本次预算耗尽后停止回带。',
      };
      const weight = Math.max(1, Math.ceil((item.observation.length + (item.desired_behavior?.length ?? 0)) / 4));
      if (items.length >= maxItems || budget + weight > maxTokens) break;
      budget += weight; items.push(item);
    }
    const intentHash = taskIntent === null ? null : workflowHash(taskIntent);
    // The host hook can be retried after a lost response.  A deterministic
    // offer identity prevents that retry from manufacturing a second receipt,
    // while a changed adopted/trial set (or query budget) intentionally gets a
    // fresh offer.
    const offerKey = workflowHash({host, session_id: sessionId, turn_id: turnId, project_ref: boundProject, task_intent_hash: intentHash, max_items: maxItems, max_tokens: maxTokens, items: items.map(item => ({proposal_id: item.proposal_id, status: item.status, target_kind: item.target_kind, scope: item.scope}))});
    const receiptId = `activation:${offerKey.slice(0, 56)}`;
    const timestamp = now();
    const inserted = transaction(() => {
      const existing = db.prepare('SELECT * FROM activation_receipts WHERE receipt_id=?').get(receiptId);
      if (existing) return activationView(existing);
      db.prepare('INSERT INTO activation_receipts(receipt_id,host,session_id,turn_id,project_ref,task_intent_hash,status,items_json,item_count,max_tokens,used_tokens,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(receiptId, host, sessionId, turnId, boundProject, intentHash, 'offered', jsonColumn(items, 'activation items'), items.length, maxTokens, budget, 0, timestamp, timestamp);
      db.prepare('INSERT INTO activation_events(event_id,receipt_id,status,expected_revision,new_revision,command_id,created_at) VALUES(?,?,?,?,?,?,?)').run(`activation-event:${receiptId}`, receiptId, 'offered', null, 0, null, timestamp);
      return activationView(db.prepare('SELECT * FROM activation_receipts WHERE receipt_id=?').get(receiptId));
    });
    return {protocolVersion: 1, receipt: inserted, items: inserted.items, budget: {max_items: maxItems, max_tokens: maxTokens, used_tokens: inserted.used_tokens}, offered_not_used: inserted.status === 'offered'};
  }
  function markActivation(input) {
    const receiptId = identity(input.receiptId ?? input.receipt_id, 'receipt_id');
    const status = input.status;
    if (!ACTIVATIONS.has(status) || status === 'offered') fail('INVALID_ACTIVATION_STATUS', 'activation mark 只能使用 used/affected/dismissed/snoozed/released');
    const expectedRevision = input.expectedRevision ?? input.expected_revision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('INVALID_ACTIVATION', '需要有效的 expected_revision', 400);
    const command = commandInput(input, `activation.${status}`, {receipt_id: receiptId, status, expected_revision: expectedRevision, ...(input.host === undefined ? {} : {host: identity(input.host, 'host')}), ...(input.sessionId === undefined && input.session_id === undefined ? {} : {session_id: identity(input.sessionId ?? input.session_id, 'session_id')})});
    return transaction(() => {
      const replay = commandReplay(db, command.commandId, command.requestHash); if (replay) return replay;
      const row = db.prepare('SELECT * FROM activation_receipts WHERE receipt_id=?').get(receiptId); if (!row) fail('ACTIVATION_NOT_FOUND', '没有这个 activation receipt', 404);
      if ((input.host !== undefined && input.host !== row.host) || (input.sessionId !== undefined && input.sessionId !== row.session_id) || (input.session_id !== undefined && input.session_id !== row.session_id)) fail('ACTIVATION_SESSION_CONFLICT', 'activation receipt 不属于当前宿主会话', 409);
      if (row.revision !== expectedRevision) fail('ACTIVATION_REVISION_CONFLICT', 'activation receipt 已变化，请重新读取', 409);
      const timestamp = now(); const next = row.revision + 1;
      db.prepare('UPDATE activation_receipts SET status=?,revision=?,updated_at=? WHERE receipt_id=? AND revision=?').run(status, next, timestamp, receiptId, expectedRevision);
      const result = {protocolVersion: 1, status, receipt: activationView(db.prepare('SELECT * FROM activation_receipts WHERE receipt_id=?').get(receiptId))};
      db.prepare('INSERT INTO activation_events(event_id,receipt_id,status,expected_revision,new_revision,command_id,created_at) VALUES(?,?,?,?,?,?,?)').run(`activation-event:${command.commandId}`, receiptId, status, expectedRevision, next, command.commandId, timestamp);
      return saveCommand(db, command.commandId, command.normalized.operation, command.requestHash, result, timestamp);
    });
  }
  function listActivationHistory({host, sessionId, session_id: snakeSessionId} = {}) {
    const resolvedSessionId = sessionId ?? snakeSessionId;
    const clauses = [], values = [];
    if (host !== undefined) { identity(host, 'host'); clauses.push('host=?'); values.push(host); }
    if (resolvedSessionId !== undefined) { identity(resolvedSessionId, 'session_id'); clauses.push('session_id=?'); values.push(resolvedSessionId); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM activation_receipts${where} ORDER BY created_at DESC`).all(...values).map(activationView);
  }

  function listPublicationPolicies({status} = {}) {
    if (status !== undefined && !PUBLICATION_POLICY_STATUSES.has(status)) fail('INVALID_PUBLICATION_POLICY', '不支持的 publication policy 状态', 400);
    const rows = status === undefined ? db.prepare('SELECT * FROM publication_policies ORDER BY updated_at DESC').all() : db.prepare('SELECT * FROM publication_policies WHERE status=? ORDER BY updated_at DESC').all(status);
    return rows.map(policyView).map(value => value.status === 'active' && value.expires_at && value.expires_at <= now() ? {...value, status: 'expired'} : value);
  }
  function publicationPolicyPreview(input = {}) {
    const scope = input.scope;
    if (!['personal', 'project', 'cross-project'].includes(scope)) fail('INVALID_PUBLICATION_POLICY', 'policy scope 必须是 personal、project 或 cross-project', 400);
    const targetRoot = input.targetRoot ?? input.target_root;
    if (typeof targetRoot !== 'string' || !path.isAbsolute(targetRoot)) fail('INVALID_PUBLICATION_POLICY', 'policy target_root 必须是绝对路径', 400);
    const kinds = input.allowedCapabilityKinds ?? input.allowed_capability_kinds ?? input.allowedKinds ?? input.allowed_kinds ?? ['skill'];
    if (!Array.isArray(kinds) || kinds.length < 1 || kinds.length > 16 || kinds.some(kind => typeof kind !== 'string' || !['skill', 'prompt', 'hook', 'runtime-guard', '*'].includes(kind))) fail('INVALID_PUBLICATION_POLICY', 'allowed_capability_kinds 无效', 400);
    const requirements = input.validationRequirements ?? input.validation_requirements ?? {schema: 'passed', replay: 'passed', behavior: 'passed', rollback: 'required'};
    if (!plain(requirements) || Object.keys(requirements).some(key => !['schema', 'replay', 'behavior', 'rollback', 'source_hashes'].includes(key))) fail('INVALID_PUBLICATION_POLICY', 'validation_requirements 无效', 400);
    const expiresAt = input.expiresAt ?? input.expires_at ?? null;
    if (expiresAt !== null && (typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) fail('INVALID_PUBLICATION_POLICY', 'policy expires_at 必须是未来时间', 400);
    const policyId = `publication-policy:${workflowHash({scope, target_root: path.resolve(targetRoot), allowed_capability_kinds: [...new Set(kinds)].sort(), validation_requirements: requirements, expires_at: expiresAt}).slice(0, 48)}`;
    return {protocolVersion: 1, policy_id: policyId, scope, target_root: path.resolve(targetRoot), allowed_capability_kinds: [...new Set(kinds)].sort(), validation_requirements: requirements, expires_at: expiresAt, status: 'preview', publication_mode: 'manual-by-default', requires_explicit_adoption: true, warning: 'policy 只在用户明确 adopt 后生效；普通 prompt、finding 或 route 不会创建或扩大 policy。'};
  }
  function publicationPolicyAdopt(input = {}) {
    const preview = publicationPolicyPreview(input);
    const command = commandInput(input, 'publication-policy.adopt', {policy_id: preview.policy_id, scope: preview.scope, target_root: preview.target_root, allowed_capability_kinds: preview.allowed_capability_kinds, validation_requirements: preview.validation_requirements, expires_at: preview.expires_at, approval: optionalText(input.approval, 'approval', 256)});
    if (input.approval !== `adopt:${preview.policy_id}`) fail('POLICY_ADOPTION_REQUIRED', 'publication policy 需要 approval=adopt:<policy_id>', 403);
    return transaction(() => {
      const replay = commandReplay(db, command.commandId, command.requestHash); if (replay) return replay;
      const existing = db.prepare('SELECT * FROM publication_policies WHERE policy_id=?').get(preview.policy_id);
      if (existing) {
        if (existing.status !== 'active') fail('PUBLICATION_POLICY_REVOKED', '该 policy 已撤回，不能重新激活', 409);
        return saveCommand(db, command.commandId, command.normalized.operation, command.requestHash, {protocolVersion: 1, status: 'active', policy: policyView(existing), receipt: {receipt_id: `publication-policy:${command.commandId}`, effect: 'policy-replay'}});
      }
      const timestamp = now();
      db.prepare('INSERT INTO publication_policies(policy_id,scope,target_root,allowed_kinds_json,validation_requirements_json,expires_at,status,revision,created_at,updated_at,revoked_at,revoke_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(preview.policy_id, preview.scope, preview.target_root, jsonColumn(preview.allowed_capability_kinds, 'allowed_capability_kinds', 8_000), jsonColumn(preview.validation_requirements, 'validation_requirements', 8_000), preview.expires_at, 'active', 0, timestamp, timestamp, null, null);
      const result = {protocolVersion: 1, status: 'active', policy: policyView(db.prepare('SELECT * FROM publication_policies WHERE policy_id=?').get(preview.policy_id)), receipt: {receipt_id: `publication-policy:${command.commandId}`, command_id: command.commandId, effect: 'standing-policy-adopted'}};
      db.prepare('INSERT INTO publication_events(event_id,command_id,orchestration_id,operation,status,request_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(`publication-event:${command.commandId}`, command.commandId, null, 'policy.adopt', 'active', command.requestHash, jsonColumn(result, 'publication policy result', 32_000), timestamp);
      return saveCommand(db, command.commandId, command.normalized.operation, command.requestHash, result, timestamp);
    });
  }
  function publicationPolicyRevoke(input = {}) {
    const policyId = identity(input.policyId ?? input.policy_id, 'policy_id');
    const expectedRevision = input.expectedRevision ?? input.expected_revision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('INVALID_PUBLICATION_POLICY', '需要有效的 expected_revision', 400);
    const command = commandInput(input, 'publication-policy.revoke', {policy_id: policyId, expected_revision: expectedRevision, reason: text(input.reason ?? '用户撤回 publication policy', 'reason', 2_000)});
    return transaction(() => {
      const replay = commandReplay(db, command.commandId, command.requestHash); if (replay) return replay;
      const row = db.prepare('SELECT * FROM publication_policies WHERE policy_id=?').get(policyId); if (!row) fail('PUBLICATION_POLICY_NOT_FOUND', '没有这个 publication policy', 404);
      if (row.revision !== expectedRevision) fail('PUBLICATION_POLICY_REVISION_CONFLICT', 'publication policy 已变化，请重新读取', 409);
      if (row.status === 'revoked') return saveCommand(db, command.commandId, command.normalized.operation, command.requestHash, {protocolVersion: 1, status: 'revoked', policy: policyView(row), receipt: {effect: 'policy-already-revoked'}});
      const timestamp = now(); db.prepare('UPDATE publication_policies SET status=\'revoked\',revision=?,updated_at=?,revoked_at=?,revoke_reason=? WHERE policy_id=? AND revision=?').run(expectedRevision + 1, timestamp, timestamp, command.normalized.reason, policyId, expectedRevision);
      const result = {protocolVersion: 1, status: 'revoked', policy: policyView(db.prepare('SELECT * FROM publication_policies WHERE policy_id=?').get(policyId)), receipt: {receipt_id: `publication-policy:${command.commandId}`, command_id: command.commandId, effect: 'policy-revoked'}};
      db.prepare('INSERT INTO publication_events(event_id,command_id,orchestration_id,operation,status,request_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(`publication-event:${command.commandId}`, command.commandId, null, 'policy.revoke', 'revoked', command.requestHash, jsonColumn(result, 'publication policy revoke result', 32_000), timestamp);
      return saveCommand(db, command.commandId, command.normalized.operation, command.requestHash, result, timestamp);
    });
  }
  function listCapabilityOrchestrations({host, sessionId, status} = {}) {
    const clauses = [], values = [];
    if (host !== undefined) { identity(host, 'host'); clauses.push('host=?'); values.push(host); }
    if (sessionId !== undefined) { identity(sessionId, 'session_id'); clauses.push('session_id=?'); values.push(sessionId); }
    if (status !== undefined) { if (!CAPABILITY_ORCHESTRATION_STATUSES.has(status)) fail('INVALID_CAPABILITY_STATUS', '不支持的 capability orchestration 状态', 400); clauses.push('status=?'); values.push(status); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM capability_orchestrations${where} ORDER BY updated_at DESC`).all(...values).map(orchestrationView);
  }
  function listCapabilityTrials({orchestrationId, orchestration_id: snakeOrchestrationId} = {}) {
    const resolved = orchestrationId ?? snakeOrchestrationId; const clauses = [], values = [];
    if (resolved !== undefined) { identity(resolved, 'orchestration_id'); clauses.push('orchestration_id=?'); values.push(resolved); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM capability_trials${where} ORDER BY created_at DESC`).all(...values).map(trialView);
  }
  function readOrchestration(orchestrationId) { const row = db.prepare('SELECT * FROM capability_orchestrations WHERE orchestration_id=?').get(orchestrationId); if (!row) fail('CAPABILITY_ORCHESTRATION_NOT_FOUND', '没有这个 capability orchestration', 404); return row; }
  function ensurePolicy(policyId, targetRoot, kind = 'skill') {
    if (policyId === null || policyId === undefined) return null;
    const row = db.prepare('SELECT * FROM publication_policies WHERE policy_id=?').get(policyId); if (!row) fail('PUBLICATION_POLICY_NOT_FOUND', '没有这个 publication policy', 404);
    if (row.status !== 'active' || row.expires_at && row.expires_at <= now()) fail('PUBLICATION_POLICY_REVOKED', 'publication policy 已撤回或过期', 403);
    if (targetRoot && path.resolve(targetRoot) !== path.resolve(row.target_root)) fail('PUBLICATION_POLICY_TARGET_CONFLICT', 'target_root 与 publication policy 不匹配', 409);
    const kinds = parseJson(row.allowed_kinds_json, 'allowed_kinds_json', []); if (!kinds.includes('*') && !kinds.includes(kind)) fail('PUBLICATION_POLICY_KIND_CONFLICT', 'publication policy 不允许该 capability kind', 403);
    return policyView(row);
  }
  function capabilityTrialCreate(input = {}) {
    const orchestrationId = identity(input.orchestrationId ?? input.orchestration_id, 'orchestration_id');
    const expectedRevision = input.expectedRevision ?? input.expected_revision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('INVALID_CAPABILITY_TRIAL', '需要有效的 expected_revision', 400);
    const capabilityVersion = identity(input.capabilityVersion ?? input.capability_version, 'capability_version', 128);
    const capabilityHash = identity(input.capabilityHash ?? input.capability_hash, 'capability_hash', 128);
    if (!/^[a-f0-9]{64}$/i.test(capabilityHash)) fail('INVALID_CAPABILITY_TRIAL', 'capability_hash 必须是 SHA-256', 400);
    const scenario = text(input.scenario, 'scenario', 4_000); const task = text(input.task, 'task', 4_000); const expected = text(input.expected, 'expected', 8_000);
    const host = optionalIdentity(input.host, 'host'); const model = optionalText(input.model, 'model', 256); const toolConfig = input.toolConfig ?? input.tool_config ?? {};
    if (!plain(toolConfig)) fail('INVALID_CAPABILITY_TRIAL', 'tool_config 必须是对象', 400);
    const evidenceRefs = input.evidenceRefs ?? input.evidence_refs ?? []; if (!Array.isArray(evidenceRefs) || evidenceRefs.length > 64 || evidenceRefs.some(ref => typeof ref !== 'string' || ref.length > 512)) fail('INVALID_CAPABILITY_TRIAL', 'evidence_refs 无效', 400);
    const command = commandInput(input, 'capability-trial.create', {orchestration_id: orchestrationId, expected_revision: expectedRevision, capability_version: capabilityVersion, capability_hash: capabilityHash, scenario, host, model, tool_config: toolConfig, task, expected, evidence_refs: evidenceRefs});
    return transaction(() => {
      const replay = commandReplay(db, command.commandId, command.requestHash); if (replay) return replay;
      const orch = readOrchestration(orchestrationId); if (!['candidate', 'producer_required', 'staged', 'validated'].includes(orch.status)) fail('CAPABILITY_TRIAL_STATE_CONFLICT', '当前 capability orchestration 不能排队 trial', 409);
      if (orch.revision !== expectedRevision) fail('CAPABILITY_REVISION_CONFLICT', 'capability orchestration 已变化，请重新读取', 409);
      const trialId = `capability-trial:${workflowHash({orchestration_id: orchestrationId, command_id: command.commandId}).slice(0, 48)}`; const timestamp = now();
      db.prepare('INSERT INTO capability_trials(trial_id,orchestration_id,capability_version,capability_hash,scenario,host,model,tool_config_json,task,expected,observed,evidence_refs_json,outcome,status,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(trialId, orchestrationId, capabilityVersion, capabilityHash, scenario, host, model, jsonColumn(toolConfig, 'tool_config', 16_000), task, expected, null, jsonColumn(evidenceRefs, 'evidence_refs', 16_000), null, 'queued', 0, timestamp, timestamp);
      db.prepare('UPDATE capability_orchestrations SET status=\'trial_queued\',revision=?,updated_at=? WHERE orchestration_id=? AND revision=?').run(expectedRevision + 1, timestamp, orchestrationId, expectedRevision);
      const result = {protocolVersion: 1, status: 'trial_queued', orchestration: orchestrationView(db.prepare('SELECT * FROM capability_orchestrations WHERE orchestration_id=?').get(orchestrationId)), trial: trialView(db.prepare('SELECT * FROM capability_trials WHERE trial_id=?').get(trialId)), receipt: {receipt_id: `capability-trial:${command.commandId}`, command_id: command.commandId}};
      db.prepare('INSERT INTO publication_events(event_id,command_id,orchestration_id,operation,status,request_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(`publication-event:${command.commandId}`, command.commandId, orchestrationId, 'capability-trial.create', 'queued', command.requestHash, jsonColumn(result, 'trial result', 64_000), timestamp);
      return saveCommand(db, command.commandId, command.normalized.operation, command.requestHash, result, timestamp);
    });
  }
  function capabilityTrialComplete(input = {}) {
    const trialId = identity(input.trialId ?? input.trial_id, 'trial_id'); const expectedRevision = input.expectedRevision ?? input.expected_revision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('INVALID_CAPABILITY_TRIAL', '需要有效的 expected_revision', 400);
    const outcome = input.outcome; if (!TRIAL_OUTCOMES.has(outcome)) fail('INVALID_CAPABILITY_TRIAL', 'outcome 必须是 support、limit、challenge 或 inconclusive', 400);
    const observed = text(input.observed, 'observed', 8_000); const evidenceRefs = input.evidenceRefs ?? input.evidence_refs ?? [];
    if (!Array.isArray(evidenceRefs) || evidenceRefs.length > 64 || evidenceRefs.some(ref => typeof ref !== 'string' || ref.length > 512)) fail('INVALID_CAPABILITY_TRIAL', 'evidence_refs 无效', 400);
    const command = commandInput(input, 'capability-trial.complete', {trial_id: trialId, expected_revision: expectedRevision, outcome, observed, evidence_refs: evidenceRefs});
    return transaction(() => {
      const replay = commandReplay(db, command.commandId, command.requestHash); if (replay) return replay;
      const trial = db.prepare('SELECT * FROM capability_trials WHERE trial_id=?').get(trialId); if (!trial) fail('CAPABILITY_TRIAL_NOT_FOUND', '没有这个 capability trial', 404);
      if (trial.revision !== expectedRevision) fail('CAPABILITY_TRIAL_REVISION_CONFLICT', 'capability trial 已变化，请重新读取', 409);
      if (trial.status === 'completed') return saveCommand(db, command.commandId, command.normalized.operation, command.requestHash, {protocolVersion: 1, status: 'completed', trial: trialView(trial), receipt: {effect: 'trial-replay'}});
      if (!['queued', 'running'].includes(trial.status)) fail('CAPABILITY_TRIAL_STATE_CONFLICT', '只有 queued/running trial 可以 complete', 409);
      const timestamp = now(); db.prepare('UPDATE capability_trials SET observed=?,evidence_refs_json=?,outcome=?,status=\'completed\',revision=?,updated_at=? WHERE trial_id=? AND revision=?').run(observed, jsonColumn(evidenceRefs, 'evidence_refs', 16_000), outcome, expectedRevision + 1, timestamp, trialId, expectedRevision);
      const result = {protocolVersion: 1, status: 'completed', trial: trialView(db.prepare('SELECT * FROM capability_trials WHERE trial_id=?').get(trialId)), receipt: {receipt_id: `capability-trial:${command.commandId}`, command_id: command.commandId}};
      db.prepare('INSERT INTO publication_events(event_id,command_id,orchestration_id,operation,status,request_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(`publication-event:${command.commandId}`, command.commandId, trial.orchestration_id, 'capability-trial.complete', 'completed', command.requestHash, jsonColumn(result, 'trial result', 64_000), timestamp);
      return saveCommand(db, command.commandId, command.normalized.operation, command.requestHash, result, timestamp);
    });
  }

  /**
   * Capability publication is intentionally an orchestration contract rather
   * than a second publisher.  The existing CapabilityPublisher remains the
   * only component allowed to write a capability tree; this Product-owned
   * record proves that the candidate was adopted, staged/validated, and that
   * a producer supplied immutable hashes and rollback evidence.
   */
  function readCapabilityManifest(candidateDir, expectedHash = null) {
    const candidate = text(candidateDir, 'candidate_dir', MAX_ID * 8);
    if (!path.isAbsolute(candidate)) fail('INVALID_CAPABILITY_PRODUCER', 'candidate_dir 必须是绝对路径', 400);
    const manifestFile = path.join(path.resolve(candidate), 'candidate.json');
    let bytes;
    try { bytes = fs.readFileSync(manifestFile); } catch { fail('CAPABILITY_PRODUCER_REQUIRED', 'candidate producer 尚未提供可读取的 candidate.json', 409); }
    const manifestHash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (expectedHash !== null && manifestHash !== expectedHash) fail('CAPABILITY_MANIFEST_CONFLICT', 'candidate manifest hash 与请求不匹配', 409);
    let manifest;
    try { manifest = JSON.parse(bytes.toString('utf8')); } catch { fail('CAPABILITY_MANIFEST_INVALID', 'candidate.json 不是有效 JSON', 422); }
    if (!plain(manifest) || typeof manifest.capability_id !== 'string' || typeof manifest.version !== 'string' || !plain(manifest.files)) {
      fail('CAPABILITY_MANIFEST_INVALID', 'candidate manifest 缺少稳定 capability identity 或 files', 422);
    }
    jsonColumn(manifest, 'candidate manifest', 256_000);
    const targetRoot = typeof manifest.target_root === 'string' && path.isAbsolute(manifest.target_root) ? path.resolve(manifest.target_root) : null;
    if (targetRoot === null) fail('CAPABILITY_MANIFEST_INVALID', 'candidate manifest 必须声明绝对 target_root', 422);
    const capabilityKind = manifest.kind ?? manifest.capability_kind ?? 'skill';
    if (typeof capabilityKind !== 'string' || !['skill', 'prompt', 'hook', 'runtime-guard'].includes(capabilityKind)) {
      fail('CAPABILITY_MANIFEST_INVALID', 'candidate manifest 的 capability kind 无效', 422);
    }
    return {candidate_dir: path.resolve(candidate), manifest_file: manifestFile, manifest_sha256: manifestHash,
      capability_id: manifest.capability_id, capability_version: manifest.version, capability_kind: capabilityKind, target_root: targetRoot};
  }
  function orchestrationCommand(input, operation, fields) {
    const orchestrationId = identity(input.orchestrationId ?? input.orchestration_id, 'orchestration_id');
    const expectedRevision = input.expectedRevision ?? input.expected_revision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('INVALID_CAPABILITY_ORCHESTRATION', '需要有效的 expected_revision', 400);
    return {orchestrationId, expectedRevision, command: commandInput(input, operation, {orchestration_id: orchestrationId, expected_revision: expectedRevision, ...fields})};
  }
  function updateOrchestration(orchestrationId, expectedRevision, values) {
    const current = readOrchestration(orchestrationId);
    if (current.revision !== expectedRevision) fail('CAPABILITY_REVISION_CONFLICT', 'capability orchestration 已变化，请重新读取', 409);
    const next = expectedRevision + 1; const timestamp = now();
    const assignments = Object.keys(values).map(key => `${key}=?`).join(',');
    const params = [...Object.values(values), next, timestamp, orchestrationId, expectedRevision];
    db.prepare(`UPDATE capability_orchestrations SET ${assignments},revision=?,updated_at=? WHERE orchestration_id=? AND revision=?`).run(...params);
    return orchestrationView(db.prepare('SELECT * FROM capability_orchestrations WHERE orchestration_id=?').get(orchestrationId));
  }
  function capabilityStage(input = {}) {
    const candidateDir = optionalText(input.candidateDir ?? input.candidate_dir, 'candidate_dir', MAX_ID * 8);
    const suppliedHash = optionalText(input.manifestSha256 ?? input.manifest_sha256, 'manifest_sha256', 128);
    if (suppliedHash !== null && !/^[a-f0-9]{64}$/i.test(suppliedHash)) fail('INVALID_CAPABILITY_PRODUCER', 'manifest_sha256 必须是 SHA-256', 400);
    const producerStatus = input.producerStatus ?? input.producer_status ?? (candidateDir === null ? 'required' : 'staged');
    if (!['required', 'staged'].includes(producerStatus)) fail('INVALID_CAPABILITY_PRODUCER', 'producer_status 只能是 required 或 staged', 400);
    const parsed = orchestrationCommand(input, 'capability.stage', {candidate_dir: candidateDir, manifest_sha256: suppliedHash, producer_status: producerStatus});
    return transaction(() => {
      const {orchestrationId, expectedRevision, command} = parsed;
      const replay = commandReplay(db, command.commandId, command.requestHash); if (replay) return replay;
      const current = readOrchestration(orchestrationId);
      if (!['candidate', 'producer_required', 'trial_queued', 'staged', 'validated'].includes(current.status)) fail('CAPABILITY_STAGE_STATE_CONFLICT', '当前 capability orchestration 不能 stage', 409);
      let manifest = null;
      if (candidateDir !== null) manifest = readCapabilityManifest(candidateDir, suppliedHash);
      if (producerStatus === 'staged' && manifest === null) fail('CAPABILITY_PRODUCER_REQUIRED', 'stage 需要 producer 提供 candidate_dir 与可验证 manifest', 409);
      const status = manifest === null ? 'producer_required' : 'staged';
      const orchestration = updateOrchestration(orchestrationId, expectedRevision, {
        status, candidate_dir: manifest?.candidate_dir ?? null, manifest_sha256: manifest?.manifest_sha256 ?? null,
      });
      const result = {protocolVersion: 1, status, orchestration, producer: manifest ?? {status: 'required', reason: '需要现有 CapabilityPublisher/producer 先生成非空 candidate tree。'}, receipt: {receipt_id: `capability-stage:${command.commandId}`, command_id: command.commandId, effect: status === 'staged' ? 'candidate-staged-not-published' : 'producer-required'}};
      db.prepare('INSERT INTO publication_events(event_id,command_id,orchestration_id,operation,status,request_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(`publication-event:${command.commandId}`, command.commandId, orchestrationId, 'capability.stage', status, command.requestHash, jsonColumn(result, 'capability stage result', 64_000), now());
      return saveCommand(db, command.commandId, command.normalized.operation, command.requestHash, result);
    });
  }
  function capabilityValidate(input = {}) {
    const validation = input.validation ?? input.validationResult ?? input.validation_result;
    if (!plain(validation)) fail('INVALID_CAPABILITY_VALIDATION', 'validation 必须是对象', 400);
    const allowed = ['schema', 'replay', 'behavior', 'rollback', 'source_hashes'];
    if (Object.keys(validation).some(key => !allowed.includes(key))) fail('INVALID_CAPABILITY_VALIDATION', 'validation 包含未知字段', 400);
    const statuses = new Set(['passed', 'failed', 'pending', 'not_run']);
    for (const key of allowed) if (typeof validation[key] !== 'string' || !statuses.has(validation[key])) fail('INVALID_CAPABILITY_VALIDATION', `validation.${key} 必须是 passed/failed/pending/not_run`, 422);
    const parsed = orchestrationCommand(input, 'capability.validate', {validation});
    return transaction(() => {
      const {orchestrationId, expectedRevision, command} = parsed;
      const replay = commandReplay(db, command.commandId, command.requestHash); if (replay) return replay;
      const current = readOrchestration(orchestrationId);
      if (!['staged', 'trial_queued'].includes(current.status)) fail('CAPABILITY_VALIDATE_STATE_CONFLICT', '只有 staged candidate 可以 validate', 409);
      const manifest = readCapabilityManifest(current.candidate_dir, current.manifest_sha256);
      if (validation.behavior === 'passed') {
        const supportingTrial = db.prepare("SELECT 1 FROM capability_trials WHERE orchestration_id=? AND status='completed' AND outcome='support' LIMIT 1").get(orchestrationId);
        if (!supportingTrial) fail('CAPABILITY_TRIAL_REQUIRED', 'behavior=passed 需要至少一个有 evidence 的 support CapabilityTrial', 409);
      }
      const validated = Object.freeze({...validation});
      const passed = allowed.every(key => validated[key] === 'passed');
      const status = passed ? 'validated' : 'failed';
      const orchestration = updateOrchestration(orchestrationId, expectedRevision, {status, validation_json: jsonColumn({...validated, manifest_sha256: manifest.manifest_sha256}, 'validation', 32_000)});
      const result = {protocolVersion: 1, status, orchestration, manifest: {manifest_sha256: manifest.manifest_sha256, capability_id: manifest.capability_id, capability_version: manifest.capability_version}, receipt: {receipt_id: `capability-validate:${command.commandId}`, command_id: command.commandId, effect: passed ? 'candidate-validated' : 'candidate-validation-failed'}};
      db.prepare('INSERT INTO publication_events(event_id,command_id,orchestration_id,operation,status,request_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(`publication-event:${command.commandId}`, command.commandId, orchestrationId, 'capability.validate', status, command.requestHash, jsonColumn(result, 'capability validation result', 64_000), now());
      return saveCommand(db, command.commandId, command.normalized.operation, command.requestHash, result);
    });
  }
  function capabilityPublish(input = {}) {
    const policyId = optionalIdentity(input.policyId ?? input.policy_id, 'policy_id');
    const producerStatus = input.producerStatus ?? input.producer_status ?? 'required';
    if (producerStatus !== 'published') fail('CAPABILITY_PRODUCER_REQUIRED', 'publish 需要现有 CapabilityPublisher 完成实际发布并回传 producer_status=published', 409);
    const publicationReceipt = input.publicationReceipt ?? input.publication_receipt;
    if (!plain(publicationReceipt)) fail('CAPABILITY_PUBLICATION_RECEIPT_REQUIRED', 'publish 需要现有 publisher 的 publication_receipt', 422);
    const rollbackReceipt = input.rollbackReceipt ?? input.rollback_receipt;
    if (typeof rollbackReceipt !== 'string' || rollbackReceipt.trim().length === 0 || rollbackReceipt.length > 4_000) fail('CAPABILITY_ROLLBACK_REQUIRED', 'publish 需要可审计的 rollback_receipt', 422);
    const parsed = orchestrationCommand(input, 'capability.publish', {policy_id: policyId, producer_status: producerStatus, publication_receipt: publicationReceipt, rollback_receipt: rollbackReceipt, approval: optionalText(input.approval, 'approval', 2_000)});
    return transaction(() => {
      const {orchestrationId, expectedRevision, command} = parsed;
      const replay = commandReplay(db, command.commandId, command.requestHash); if (replay) return replay;
      const current = readOrchestration(orchestrationId);
      if (current.status !== 'validated') fail('CAPABILITY_PUBLISH_STATE_CONFLICT', '只有通过结构/回放/行为/回滚验证的 candidate 可以 publish', 409);
      const manifest = readCapabilityManifest(current.candidate_dir, current.manifest_sha256);
      const policy = ensurePolicy(policyId, manifest.target_root, manifest.capability_kind);
      if (policy !== null && policy.scope === 'personal' && !['personal', 'task'].includes(current.scope)) fail('PUBLICATION_POLICY_SCOPE_CONFLICT', 'personal publication policy 不能覆盖 project/cross-project capability', 403);
      if (policy !== null && policy.scope === 'project' && !['project', 'task'].includes(current.scope)) fail('PUBLICATION_POLICY_SCOPE_CONFLICT', 'project publication policy 不能覆盖 cross-project capability', 403);
      if (policy === null && input.approval !== `publish:${orchestrationId}`) fail('PUBLICATION_APPROVAL_REQUIRED', '没有 standing policy；publish 需要 approval=publish:<orchestration_id>', 403);
      const validation = parseJson(current.validation_json, 'validation_json', {});
      if (['schema', 'replay', 'behavior', 'rollback', 'source_hashes'].some(key => validation[key] !== 'passed')) fail('CAPABILITY_VALIDATION_REQUIRED', 'publication 需要所有 validation 通过', 409);
      if (publicationReceipt.candidate_sha256 !== undefined && publicationReceipt.candidate_sha256 !== manifest.manifest_sha256) fail('CAPABILITY_PUBLICATION_HASH_CONFLICT', 'publisher receipt candidate hash 与 manifest 不匹配', 409);
      const publication = {policy_id: policy?.policy_id ?? null, producer_status: producerStatus, manifest_sha256: manifest.manifest_sha256, publication_receipt: publicationReceipt, rollback_receipt: rollbackReceipt, published_at: now()};
      const orchestration = updateOrchestration(orchestrationId, expectedRevision, {status: 'published', policy_id: policy?.policy_id ?? null, publication_json: jsonColumn(publication, 'publication', 128_000)});
      const result = {protocolVersion: 1, status: 'published', orchestration, manifest: {capability_id: manifest.capability_id, capability_version: manifest.capability_version, capability_kind: manifest.capability_kind, manifest_sha256: manifest.manifest_sha256}, receipt: {receipt_id: `capability-publish:${command.commandId}`, command_id: command.commandId, effect: 'published-by-existing-capability-publisher', rollback_receipt: rollbackReceipt}};
      db.prepare('INSERT INTO publication_events(event_id,command_id,orchestration_id,operation,status,request_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(`publication-event:${command.commandId}`, command.commandId, orchestrationId, 'capability.publish', 'published', command.requestHash, jsonColumn(result, 'capability publication result', 128_000), now());
      return saveCommand(db, command.commandId, command.normalized.operation, command.requestHash, result);
    });
  }
  function capabilityRollback(input = {}) {
    const rollbackReceipt = input.rollbackReceipt ?? input.rollback_receipt;
    if (typeof rollbackReceipt !== 'string' || rollbackReceipt.trim().length === 0 || rollbackReceipt.length > 4_000) fail('CAPABILITY_ROLLBACK_REQUIRED', 'rollback 需要 publisher 的 rollback_receipt', 422);
    if (input.producerStatus !== undefined && input.producerStatus !== 'rolled_back' || input.producer_status !== undefined && input.producer_status !== 'rolled_back') fail('CAPABILITY_PRODUCER_REQUIRED', 'rollback 需要 producer_status=rolled_back', 409);
    const parsed = orchestrationCommand(input, 'capability.rollback', {rollback_receipt: rollbackReceipt});
    return transaction(() => {
      const {orchestrationId, expectedRevision, command} = parsed;
      const replay = commandReplay(db, command.commandId, command.requestHash); if (replay) return replay;
      const current = readOrchestration(orchestrationId);
      if (current.status !== 'published') fail('CAPABILITY_ROLLBACK_STATE_CONFLICT', '只有 published capability 可以 rollback', 409);
      const publication = {...parseJson(current.publication_json, 'publication_json', {}), rollback_receipt: rollbackReceipt, rolled_back_at: now()};
      const orchestration = updateOrchestration(orchestrationId, expectedRevision, {status: 'rolled_back', publication_json: jsonColumn(publication, 'publication rollback', 128_000)});
      const result = {protocolVersion: 1, status: 'rolled_back', orchestration, receipt: {receipt_id: `capability-rollback:${command.commandId}`, command_id: command.commandId, effect: 'rolled-back-by-existing-capability-publisher'}};
      db.prepare('INSERT INTO publication_events(event_id,command_id,orchestration_id,operation,status,request_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(`publication-event:${command.commandId}`, command.commandId, orchestrationId, 'capability.rollback', 'rolled_back', command.requestHash, jsonColumn(result, 'capability rollback result', 64_000), now());
      return saveCommand(db, command.commandId, command.normalized.operation, command.requestHash, result);
    });
  }

  function repositoryPreflight(input = {}) {
    const result = computeRepositoryPreflight(input);
    const commandId = identity(input.commandId ?? input.command_id ?? `repository-preflight:${crypto.randomUUID()}`, 'command_id', 200);
    const proposalId = optionalIdentity(input.proposalId ?? input.proposal_id, 'proposal_id');
    const suppliedHost = optionalIdentity(input.host, 'host');
    const suppliedSessionId = optionalIdentity(input.sessionId ?? input.session_id, 'session_id');
    const request = {...result.input, proposal_id: proposalId, ...(suppliedHost === null ? {} : {host: suppliedHost}), ...(suppliedSessionId === null ? {} : {session_id: suppliedSessionId})}; const requestHash = workflowHash(request);
    return transaction(() => {
      const replay = commandReplay(db, commandId, requestHash); if (replay) return replay;
      if (proposalId !== null) {
        const proposal = readProposal(db, proposalId);
        if (!proposal) fail('ROUTING_PROPOSAL_NOT_FOUND', '没有这个路由提案', 404);
        if (proposal.target_kind !== 'runtime-guard') fail('RUNTIME_GUARD_PROPOSAL_REQUIRED', 'repository preflight 只能绑定 runtime-guard 提案', 409);
        if ((suppliedHost !== null && proposal.host !== suppliedHost) || (suppliedSessionId !== null && proposal.session_id !== suppliedSessionId)) fail('RUNTIME_GUARD_SESSION_CONFLICT', 'runtime-guard 提案不属于当前宿主会话', 409);
      }
      const timestamp = now(); const preflightId = `repository-preflight:${workflowHash({command_id: commandId, state_hash: result.state_hash}).slice(0, 48)}`;
      const value = {protocolVersion: 1, preflight_id: preflightId, ...result};
      db.prepare('INSERT INTO repository_preflights(preflight_id,command_id,proposal_id,repo_root,execution_mode,state_hash,input_json,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(preflightId, commandId, proposalId, result.input.repo_root, result.input.execution_mode, result.state_hash, jsonColumn(request, 'preflight input'), jsonColumn(value, 'preflight result'), timestamp);
      return saveCommand(db, commandId, 'repository.preflight', requestHash, value, timestamp);
    });
  }
  function repositoryGuardRecoveryPreview(input = {}) {
    const journalId = optionalIdentity(input.journalId ?? input.journal_id, 'journal_id');
    const commandId = optionalIdentity(input.targetCommandId ?? input.target_command_id ?? input.commandId ?? input.command_id, 'command_id');
    if (journalId === null && commandId === null) fail('INVALID_GUARD_RECOVERY', '需要 journal_id 或 command_id', 400);
    const row = journalId === null ? db.prepare('SELECT * FROM repository_guard_journal WHERE command_id=?').get(commandId) : db.prepare('SELECT * FROM repository_guard_journal WHERE journal_id=?').get(journalId);
    if (!row) fail('GUARD_JOURNAL_NOT_FOUND', '没有这个 repository guard journal', 404);
    const journal = journalView(row);
    if (journal.state === 'failed') {
      return {protocolVersion: 1, journal, action: 'recovery_required', reason: '该 apply 已失败；需要重新执行只读 preflight 后再决定是否重试，不能复用旧 journal。', observed: null};
    }
    if (JOURNAL_STATES.has(journal.state) && ['receipt_committed', 'reconciled', 'failed'].includes(journal.state) && journal.state !== 'failed') {
      return {protocolVersion: 1, journal, action: journal.state === 'receipt_committed' ? 'already_committed' : 'already_reconciled', reason: 'journal 已有终态，不重复执行 Git。', observed: null};
    }
    let live;
    try { live = computeRepositoryPreflight({repoRoot: journal.repo_root, executionMode: journal.intent.execution_mode ?? 'local', taskIntent: journal.intent.task_intent ?? '', ...(journal.intent.convention === null ? {} : {convention: journal.intent.convention})}); }
    catch { return {protocolVersion: 1, journal, action: 'recovery_required', reason: '无法读取当前仓库状态，未作任何恢复或 Git 变更。', observed: null}; }
    const before = journal.intent.before_state ?? {};
    const sameHead = (live.observed.head ?? null) === (journal.expected_head ?? null);
    const sameClean = live.observed.dirty === false && before.dirty === false;
    const noGit = live.observed.current_branch === before.current_branch && sameHead && sameClean;
    const applied = live.observed.current_branch === journal.expected_branch && sameHead && sameClean;
    const expectedWasNew = !(Array.isArray(before.branches) && before.branches.includes(journal.expected_branch));
    let action = 'recovery_required'; let reason = '当前分支、HEAD 或工作区状态无法与 journal 唯一对应；不自动切回、删除或 reset。';
    if (noGit && expectedWasNew) { action = 'retryable'; reason = 'Git 尚未发生，当前状态仍与 prepared intent 一致；可在明确批准后重新 apply。'; }
    else if (applied && expectedWasNew) { action = 'commit_receipt'; reason = '已切到预期新分支且 HEAD、干净状态均吻合；可补写 receipt，不再执行 Git。'; }
    return {protocolVersion: 1, journal, action, reason, observed: live.observed, state_hash: live.state_hash};
  }
  function finalizeRepositoryJournal(journalId, requestHash = null) {
    return transaction(() => {
      const row = db.prepare('SELECT * FROM repository_guard_journal WHERE journal_id=?').get(journalId);
      if (!row) fail('GUARD_JOURNAL_NOT_FOUND', '没有这个 repository guard journal', 404);
      if (row.state === 'receipt_committed') {
        const command = db.prepare('SELECT result_json FROM host_workflow_commands WHERE command_id=?').get(row.command_id);
        if (command) return parseJson(command.result_json, 'result_json');
      }
      if (row.state !== 'git_applied' && row.state !== 'receipt_committed') fail('GUARD_RECOVERY_REQUIRED', 'journal 尚未证明 Git 已应用，不能补写 receipt', 409);
      const intent = parseJson(row.intent_json, 'intent_json', {});
      const afterStateHash = row.after_state_hash ?? workflowHash({repo_root: row.repo_root, current_branch: row.expected_branch, head: row.expected_head});
      const receiptId = `repository-guard:${row.journal_id}`;
      const existing = db.prepare('SELECT result_json FROM repository_guard_receipts WHERE receipt_id=?').get(receiptId);
      const timestamp = now();
      const value = existing ? parseJson(existing.result_json, 'result_json') : {protocolVersion: 1, receipt_id: receiptId, status: 'applied', action: 'create-branch', branch: row.expected_branch, before_state_hash: row.before_state_hash, after_state_hash: afterStateHash, no_remote_mutation: true, journal_id: row.journal_id, recovery: row.state === 'git_applied'};
      if (!existing) db.prepare('INSERT INTO repository_guard_receipts(receipt_id,command_id,preflight_id,proposal_id,action,status,before_state_hash,after_state_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(receiptId, row.command_id, row.preflight_id, row.proposal_id, 'create-branch', 'applied', row.before_state_hash, afterStateHash, jsonColumn(value, 'guard result'), timestamp);
      db.prepare('UPDATE repository_guard_journal SET state=?,after_state_hash=?,updated_at=? WHERE journal_id=?').run('receipt_committed', afterStateHash, timestamp, row.journal_id);
      const existingCommand = db.prepare('SELECT result_json FROM host_workflow_commands WHERE command_id=?').get(row.command_id);
      if (existingCommand) return parseJson(existingCommand.result_json, 'result_json');
      return saveCommand(db, row.command_id, 'repository.apply', row.request_hash || requestHash || workflowHash({command_id: row.command_id, journal_id: row.journal_id}), value, timestamp);
    });
  }
  function repositoryGuardReconcile(input = {}) {
    const journalId = identity(input.journalId ?? input.journal_id, 'journal_id');
    const commandId = identity(input.commandId ?? input.command_id ?? `repository-reconcile:${journalId}`, 'command_id', 200);
    const requestHash = workflowHash({operation: 'repository.reconcile', command_id: commandId, journal_id: journalId});
    const preview = repositoryGuardRecoveryPreview({journal_id: journalId});
    if (preview.action === 'commit_receipt') {
      const value = transaction(() => {
        const replay = commandReplay(db, commandId, requestHash); if (replay) return {replay};
        const row = db.prepare('SELECT * FROM repository_guard_journal WHERE journal_id=?').get(journalId);
        if (!row) fail('GUARD_JOURNAL_NOT_FOUND', '没有这个 repository guard journal', 404);
        db.prepare('UPDATE repository_guard_journal SET state=?,after_state_hash=?,updated_at=? WHERE journal_id=? AND state IN (\'prepared\',\'git_applied\')').run('git_applied', preview.state_hash, now(), journalId);
        return {journal: journalView(db.prepare('SELECT * FROM repository_guard_journal WHERE journal_id=?').get(journalId))};
      });
      if (value.replay) return value.replay;
      const receipt = finalizeRepositoryJournal(journalId, requestHash);
      return transaction(() => saveCommand(db, commandId, 'repository.reconcile', requestHash, receipt));
    }
    return transaction(() => {
      const replay = commandReplay(db, commandId, requestHash); if (replay) return replay;
      if (preview.action === 'recovery_required') {
        db.prepare('UPDATE repository_guard_journal SET state=?,error_code=?,error_message=?,updated_at=? WHERE journal_id=? AND state NOT IN (\'receipt_committed\',\'reconciled\')').run('recovery_required', 'GUARD_STATE_AMBIGUOUS', preview.reason.slice(0, 2_000), now(), journalId);
        const value = {...preview, status: 'recovery_required'};
        return saveCommand(db, commandId, 'repository.reconcile', requestHash, value);
      }
      if (preview.action === 'retryable') {
        const value = {...preview, status: 'reconciled', next: 'reapply-after-fresh-preflight'};
        db.prepare('UPDATE repository_guard_journal SET state=?,updated_at=? WHERE journal_id=?').run('reconciled', now(), journalId);
        return saveCommand(db, commandId, 'repository.reconcile', requestHash, value);
      }
      return saveCommand(db, commandId, 'repository.reconcile', requestHash, preview);
    });
  }
  function repositoryGuardApply(input = {}) {
    const commandId = identity(input.commandId ?? input.command_id ?? `repository-guard:${crypto.randomUUID()}`, 'command_id', 200);
    const preflightId = identity(input.preflightId ?? input.preflight_id, 'preflight_id');
    const proposalId = optionalIdentity(input.proposalId ?? input.proposal_id, 'proposal_id');
    const approval = optionalText(input.approval, 'approval', 256);
    const expectedStateHash = identity(input.expectedStateHash ?? input.expected_state_hash, 'expected_state_hash', 128);
    const suppliedHost = optionalIdentity(input.host, 'host');
    const suppliedSessionId = optionalIdentity(input.sessionId ?? input.session_id, 'session_id');
    const request = {command_id: commandId, preflight_id: preflightId, proposal_id: proposalId, approval, expected_state_hash: expectedStateHash, ...(suppliedHost === null ? {} : {host: suppliedHost}), ...(suppliedSessionId === null ? {} : {session_id: suppliedSessionId})}; const requestHash = workflowHash(request);
    const prepared = transaction(() => {
      const replay = commandReplay(db, commandId, requestHash); if (replay) return {replay};
      const existingJournal = db.prepare('SELECT * FROM repository_guard_journal WHERE command_id=?').get(commandId);
      if (existingJournal) return {journal: journalView(existingJournal)};
      const preflight = db.prepare('SELECT * FROM repository_preflights WHERE preflight_id=?').get(preflightId); if (!preflight) fail('PREFLIGHT_NOT_FOUND', '没有这个 repository preflight', 404);
      if (preflight.state_hash !== expectedStateHash) fail('PREFLIGHT_STATE_CONFLICT', 'preflight 状态已变化，请重新读取', 409);
      if (proposalId !== null && proposalId !== preflight.proposal_id) fail('PREFLIGHT_PROPOSAL_CONFLICT', 'apply 的 proposal 与 preflight 不匹配', 409);
      if (proposalId !== null) {
        const proposal = readProposal(db, proposalId); if (!proposal || proposal.target_kind !== 'runtime-guard' || proposal.status !== 'adopted') fail('RUNTIME_GUARD_NOT_ADOPTED', '只有已采用的 runtime-guard 提案允许 apply', 409);
        if ((suppliedHost !== null && proposal.host !== suppliedHost) || (suppliedSessionId !== null && proposal.session_id !== suppliedSessionId)) fail('RUNTIME_GUARD_SESSION_CONFLICT', 'runtime-guard 提案不属于当前宿主会话', 409);
        if (approval !== `adopt:${proposalId}`) fail('USER_ADOPTION_REQUIRED', 'apply 必须提供 adopt:<proposal_id>', 403);
      } else fail('RUNTIME_GUARD_PROPOSAL_REQUIRED', 'apply 必须绑定一个已采用的 runtime-guard 提案', 403);
      let preflightInput;
      try { preflightInput = JSON.parse(preflight.input_json); } catch { fail('STORAGE_CORRUPT', 'repository preflight input is not valid JSON', 503); }
      const live = computeRepositoryPreflight(preflightInput);
      if (live.state_hash !== expectedStateHash) fail('PREFLIGHT_STATE_CONFLICT', 'apply 前 git 状态已变化，未执行任何变更', 409);
      if (live.action !== 'create-branch') fail('RUNTIME_GUARD_NOT_APPLICABLE', `当前 preflight 不允许创建分支：${live.action}`, 409);
      const branch = live.proposed_branch;
      if (!branch) fail('RUNTIME_GUARD_NO_BRANCH', 'preflight 没有安全的 proposed branch', 409);
      if (live.input.execution_mode !== 'local' || live.observed.dirty || live.observed.managed_worktree || live.observed.detached || live.input.user_requested_current_branch === true) fail('RUNTIME_GUARD_BLOCKED', '当前执行模式或仓库状态不允许自动切分支', 409);
      const timestamp = now();
      const journalId = `repository-guard-journal:${workflowHash({command_id: commandId, before_state_hash: expectedStateHash}).slice(0, 48)}`;
      const intent = {command_id: commandId, preflight_id: preflightId, proposal_id: proposalId, repo_root: preflight.repo_root,
        execution_mode: preflight.execution_mode, expected_branch: branch, expected_head: live.observed.head ?? null,
        task_intent: preflightInput.task_intent ?? '', convention: preflightInput.convention ?? null,
        before_state: live.observed, before_state_hash: expectedStateHash, approval};
      db.prepare('INSERT INTO repository_guard_journal(journal_id,command_id,preflight_id,proposal_id,repo_root,expected_branch,expected_head,before_state_hash,request_hash,state,intent_json,after_state_hash,error_code,error_message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(journalId, commandId, preflightId, proposalId, preflight.repo_root, branch, live.observed.head ?? null, expectedStateHash, requestHash, 'prepared', jsonColumn(intent, 'guard journal intent', 64_000), null, null, null, timestamp, timestamp);
      return {journal: journalView(db.prepare('SELECT * FROM repository_guard_journal WHERE journal_id=?').get(journalId))};
    });
    if (prepared.replay) return prepared.replay;
    const journal = prepared.journal;
    if (journal.state === 'receipt_committed') return finalizeRepositoryJournal(journal.journal_id, requestHash);
    // `reconciled` means the previous journal was safely proven to have no
    // Git effect.  It is intentionally not a receipt-finalizable state: a
    // retry must create a fresh preflight/command so the old CAS and intent
    // cannot be reused after the repository has changed.
    if (journal.state === 'reconciled') return repositoryGuardRecoveryPreview({journal_id: journal.journal_id});
    if (journal.state !== 'prepared') return repositoryGuardRecoveryPreview({journal_id: journal.journal_id});
    const existingPreview = repositoryGuardRecoveryPreview({journal_id: journal.journal_id});
    if (existingPreview.action === 'commit_receipt') return repositoryGuardReconcile({journal_id: journal.journal_id});
    if (existingPreview.action === 'recovery_required') return existingPreview;
    try {
      execFileSync('git', ['-C', journal.repo_root, 'switch', '-c', journal.expected_branch], {encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'pipe']});
    } catch (error) {
      transaction(() => { db.prepare('UPDATE repository_guard_journal SET state=?,error_code=?,error_message=?,updated_at=? WHERE journal_id=? AND state=?').run('failed', 'RUNTIME_GUARD_APPLY_FAILED', 'git switch -c 未成功，未执行 push/merge/delete', now(), journal.journal_id, 'prepared'); });
      fail('RUNTIME_GUARD_APPLY_FAILED', 'git switch -c 未成功，未执行 push/merge/delete', 409);
    }
    // Library-only fault injection models a process crash after Git succeeds
    // but before either the journal transition or receipt commit. Production
    // never receives this callback from HTTP/MCP input.
    if (typeof faultInjector?.afterGit === 'function') faultInjector.afterGit({...journal});
    const after = computeRepositoryPreflight({repoRoot: journal.repo_root, executionMode: 'local', taskIntent: journal.intent.task_intent ?? '', convention: journal.intent.convention ?? journal.intent.before_state?.branch_convention, gitState: undefined});
    transaction(() => { db.prepare('UPDATE repository_guard_journal SET state=?,after_state_hash=?,updated_at=? WHERE journal_id=? AND state=?').run('git_applied', after.state_hash, now(), journal.journal_id, 'prepared'); });
    return finalizeRepositoryJournal(journal.journal_id, requestHash);
  }
  function listRepositoryReceipts() { return db.prepare('SELECT * FROM repository_guard_receipts ORDER BY created_at DESC').all().map(row => ({...row, result: parseJson(row.result_json, 'result_json')})); }
  function listRepositoryJournals({state} = {}) {
    if (state !== undefined && !JOURNAL_STATES.has(state)) fail('INVALID_GUARD_JOURNAL_STATE', '不支持的 guard journal 状态', 400);
    const rows = state === undefined ? db.prepare('SELECT * FROM repository_guard_journal ORDER BY created_at DESC').all() : db.prepare('SELECT * FROM repository_guard_journal WHERE state=? ORDER BY created_at DESC').all(state);
    return rows.map(journalView);
  }
  /**
   * Startup is deliberately read-only with respect to Git.  Inspect a
   * bounded set of unfinished journals so a process restart cannot silently
   * forget a successful branch switch.  Only an evidence-backed ambiguous
   * state is persisted as `recovery_required`; no branch, HEAD or worktree is
   * changed here.  Explicit `repositoryGuardReconcile` remains the only
   * receipt-completion path.
   */
  function inspectRepositoryGuardJournals({limit = 64} = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) fail('INVALID_GUARD_RECOVERY', 'startup recovery limit 必须在 1..256', 400);
    const rows = db.prepare("SELECT * FROM repository_guard_journal WHERE state IN ('prepared','git_applied','recovery_required') ORDER BY updated_at LIMIT ?").all(limit);
    return rows.map(row => {
      let preview;
      try { preview = repositoryGuardRecoveryPreview({journal_id: row.journal_id}); }
      catch { preview = {protocolVersion: 1, journal: journalView(row), action: 'recovery_required', reason: '启动时无法核对仓库状态；未作任何 Git 变更。', observed: null}; }
      if (preview.action === 'recovery_required' && row.state !== 'recovery_required') {
        const timestamp = now();
        transaction(() => db.prepare("UPDATE repository_guard_journal SET state='recovery_required',error_code=?,error_message=?,updated_at=? WHERE journal_id=? AND state IN ('prepared','git_applied')").run('GUARD_STATE_AMBIGUOUS', String(preview.reason ?? '启动核对无法证明状态').slice(0, 2_000), timestamp, row.journal_id));
        preview = {...preview, journal: journalView(db.prepare('SELECT * FROM repository_guard_journal WHERE journal_id=?').get(row.journal_id)), status: 'recovery_required'};
      }
      return preview;
    });
  }

  return Object.freeze({
    listSensemakingJobs, listSensemakingResults, claimSensemakingJob, renewSensemakingJob, finishSensemakingJob, failSensemakingJob,
    recordSensemakingPrivacy, listSensemakingPrivacyReceipts,
    listFindings, createRoutingProposal, listRoutingProposals, decideRouting,
    queryActivation, markActivation, listActivationHistory,
    listPublicationPolicies, publicationPolicyPreview, publicationPolicyAdopt, publicationPolicyRevoke,
    listCapabilityOrchestrations, listCapabilityTrials, capabilityTrialCreate, capabilityTrialComplete,
    capabilityStage, capabilityValidate, capabilityPublish, capabilityRollback,
    repositoryPreflight, repositoryGuardApply, repositoryGuardRecoveryPreview, repositoryGuardReconcile, listRepositoryReceipts, listRepositoryJournals, inspectRepositoryGuardJournals,
  });
}

function safeGit(repoRoot, args) {
  try { return execFileSync('git', ['-C', repoRoot, ...args], {encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'pipe']}).trim(); }
  catch { return null; }
}
function sanitizeBranch(taskIntent, convention) {
  const raw = String(taskIntent ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);
  const slug = raw || 'trace-task';
  const inferredPrefix = /^hotfix(?:\b|[-:/ ])/i.test(String(taskIntent ?? '')) ? 'hotfix/{slug}' : /^release(?:\b|[-:/ ])/i.test(String(taskIntent ?? '')) ? 'release/{slug}' : 'feature/{slug}';
  const template = typeof convention === 'string' && convention.includes('{slug}') ? convention : inferredPrefix;
  const segments = template.replace('{slug}', slug)
    .replace(/[^a-zA-Z0-9._\-/\u4e00-\u9fff]+/g, '-')
    .split('/')
    .map(segment => segment.replace(/\.\.+/g, '-').replace(/@\{/g, '-').replace(/[~^:?*\[\]\\]/g, '-').replace(/\.lock$/i, '-lock').replace(/^\.+|\.+$/g, '').replace(/^-+|-+$/g, ''))
    .filter(Boolean);
  const branch = segments.join('/').slice(0, 120).replace(/^[/.-]+|[/.-]+$/g, '');
  return branch || `feature/${slug}`;
}
function gitState(repoRoot) {
  const status = safeGit(repoRoot, ['status', '--porcelain=v1']);
  const currentBranch = safeGit(repoRoot, ['branch', '--show-current']);
  const head = safeGit(repoRoot, ['rev-parse', 'HEAD']);
  const remote = safeGit(repoRoot, ['remote', 'get-url', 'origin']);
  const defaultBranch = safeGit(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.replace(/^origin\//, '') ?? safeGit(repoRoot, ['config', '--get', 'init.defaultBranch']);
  const branches = (safeGit(repoRoot, ['branch', '--format=%(refname:short)']) ?? '').split(/\r?\n/).filter(Boolean);
  const gitMeta = path.join(repoRoot, '.git');
  let managed = false;
  try {
    managed = fs.statSync(gitMeta).isDirectory() && fs.existsSync(path.join(gitMeta, 'commondir'));
    if (!managed && fs.statSync(gitMeta).isFile()) managed = /(?:worktrees[\\/]|commondir)/i.test(fs.readFileSync(gitMeta, 'utf8'));
  } catch { /* not a git worktree; detached/new-repo handling below remains fail-closed */ }
  const detached = currentBranch === null || currentBranch === '';
  return {status: status ?? '', dirty: status !== null && status.length > 0, current_branch: currentBranch || null, default_branch: defaultBranch || null, remote: remote || null, head: head || null, branches, detached, managed_worktree: managed};
}
export function computeRepositoryPreflight(input = {}) {
  const repoRootValue = input.repoRoot ?? input.repo_root;
  if (typeof repoRootValue !== 'string' || !path.isAbsolute(repoRootValue)) fail('INVALID_REPOSITORY_ROOT', 'repo_root 必须是绝对路径', 400);
  const repoRoot = path.resolve(repoRootValue);
  if (!fs.existsSync(repoRoot) || !fs.statSync(repoRoot).isDirectory()) fail('REPOSITORY_NOT_FOUND', 'repo_root 不存在或不是目录', 404);
  const executionMode = input.executionMode ?? input.execution_mode ?? 'suggest';
  const mode = executionMode === 'suggest' ? 'unknown' : executionMode;
  if (!['local', 'managed-worktree', 'cloud', 'unknown'].includes(mode)) fail('INVALID_EXECUTION_MODE', 'execution_mode 必须是 local、managed-worktree、cloud 或 unknown');
  const suppliedGitState = plain(input.gitState) ? input.gitState : (['git_status', 'gitStatus', 'current_branch', 'currentBranch', 'default_branch', 'defaultBranch', 'remote', 'branches', 'detached', 'managed_worktree'].some(key => Object.hasOwn(input, key)) ? input : null);
  const observed = suppliedGitState === null ? gitState(repoRoot) : {
    status: typeof suppliedGitState.status === 'string' ? suppliedGitState.status : typeof suppliedGitState.git_status === 'string' ? suppliedGitState.git_status : typeof suppliedGitState.gitStatus === 'string' ? suppliedGitState.gitStatus : '',
    dirty: suppliedGitState.dirty === true || Boolean(suppliedGitState.status ?? suppliedGitState.git_status ?? suppliedGitState.gitStatus),
    current_branch: suppliedGitState.current_branch ?? suppliedGitState.currentBranch ?? null,
    default_branch: suppliedGitState.default_branch ?? suppliedGitState.defaultBranch ?? null,
    remote: suppliedGitState.remote ?? null,
    head: suppliedGitState.head ?? suppliedGitState.commit ?? null,
    branches: Array.isArray(suppliedGitState.branches) ? suppliedGitState.branches.filter(item => typeof item === 'string') : [],
    detached: suppliedGitState.detached === true,
    managed_worktree: suppliedGitState.managed_worktree === true || suppliedGitState.managedWorktree === true,
  };
  const taskIntent = optionalText(input.taskIntent ?? input.task_intent, 'task_intent', 8_000) ?? '';
  const requestedConvention = input.convention ?? input.conventions?.branch;
  const convention = typeof requestedConvention === 'string' ? requestedConvention
    : typeof input.conventions?.prefix === 'string' ? `${input.conventions.prefix}/{slug}` : undefined;
  const current = observed.current_branch;
  const existing = new Set(observed.branches ?? []);
  let proposed = sanitizeBranch(taskIntent, convention); let suffix = 2;
  while (existing.has(proposed)) proposed = `${sanitizeBranch(taskIntent, convention)}-${suffix++}`;
  let action = 'proceed-current'; let reason = '当前任务不需要自动创建分支，保持只读建议。';
  if (observed.dirty) { action = 'block-dirty'; reason = '工作区有未提交改动；先由用户保存、提交或明确处理，Guard 不会覆盖。'; }
  else if (mode === 'managed-worktree' || observed.managed_worktree) { action = 'use-managed-worktree'; reason = '当前由 managed worktree 管理分支，Guard 不自行切分支。'; }
  else if (mode === 'cloud') { action = 'ask-user'; reason = 'cloud 执行环境的仓库身份与分支所有权未由本地 Guard 管理。'; }
  else if (observed.status === null) { action = 'ask-user'; reason = 'repo_root 不是可读取的 Git 工作区；需要用户或宿主先确认仓库身份。'; }
  // An unborn branch reports a current branch name (usually `main`) but has no
  // branch ref yet. Treat that state exactly like a new repository: the guard
  // must not create a feature branch on top of an uncommitted/uninitialized
  // baseline or manufacture the user's first commit.
  else if (observed.branches.length === 0) { action = 'ask-user'; reason = '新仓库尚无可确认的初始分支；不自动初始化提交或分支。'; }
  else if (observed.detached) { action = 'ask-user'; reason = '当前是 detached HEAD；需要用户或宿主先确定基线分支。'; }
  else if (input.userRequestedCurrentBranch === true || input.user_requested_current_branch === true) { action = 'proceed-current'; reason = '用户明确要求继续当前分支；不覆盖该选择。'; }
  else if (taskIntent.trim().length > 0) { action = 'create-branch'; reason = '任务意图包含可追踪的实现工作，建议先创建命名分支；当前仅 suggest，不执行 git mutation。'; }
  const stateHash = workflowHash({repo_root: repoRoot, execution_mode: mode, observed: {status: observed.status, current_branch: current, default_branch: observed.default_branch, remote: observed.remote, head: observed.head ?? null, branches: [...(observed.branches ?? [])].sort(), managed_worktree: observed.managed_worktree, detached: observed.detached}, proposed_branch: proposed});
  return {mode: 'suggest', input: {repo_root: repoRoot, execution_mode: mode, task_intent: taskIntent, user_requested_current_branch: input.userRequestedCurrentBranch === true || input.user_requested_current_branch === true, ...(convention === undefined ? {} : {convention})}, observed, action, reason, proposed_branch: action === 'create-branch' ? proposed : null, proposedBranch: action === 'create-branch' ? proposed : null, state_hash: stateHash, stateHash, execution_mode: mode};
}
