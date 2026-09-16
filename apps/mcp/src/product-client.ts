import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';

export interface TraceProductArtifact {
  title: string;
  kind: 'file' | 'test' | 'link' | 'note';
  path?: string;
  url?: string;
  digest?: string;
}

export interface TraceProductReturnInput {
  projectDir: string;
  workId: string;
  deliveryId: string;
  contextHash: string;
  matterId: string;
  fact: string;
  summary?: string;
  interpretation?: string;
  unconfirmed?: string;
  proposedUnderstanding?: string;
  artifacts?: TraceProductArtifact[];
}

export interface TraceHostFindingInput {
  turnId?: string;
  observation: string;
  desiredBehavior?: string;
}

export interface TraceRoutingDecisionInput {
  proposalId: string;
  action: 'adopt' | 'trial' | 'reject';
  expectedRevision: number;
  note?: string;
}

export interface TraceRoutingProposalInput {
  findingId: string;
}

export interface TracePublicationPolicyInput {
  scope: 'personal' | 'project' | 'cross-project';
  targetRoot: string;
  allowedCapabilityKinds?: string[];
  validationRequirements?: Record<string, string>;
  expiresAt?: string | null;
}

export interface TraceCapabilityTrialInput {
  orchestrationId: string;
  expectedRevision: number;
  capabilityVersion: string;
  capabilityHash: string;
  scenario: string;
  task: string;
  expected: string;
  host?: string;
  model?: string;
  toolConfig?: Record<string, unknown>;
  evidenceRefs?: string[];
}

interface ProductClientOptions {
  baseUrl?: string;
  sessionId?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface ProductErrorBody { error?: {code?: unknown; message?: unknown}; }

export class TraceProductClientError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

export function resolveBaseUrl(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new TraceProductClientError('INVALID_PRODUCT_URL', 'TRACE_PRODUCT_URL must be a valid loopback URL'); }
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if (parsed.protocol !== 'http:' || !loopback || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) {
    throw new TraceProductClientError('INVALID_PRODUCT_URL', 'TRACE_PRODUCT_URL must be an HTTP loopback origin without credentials or a path');
  }
  return parsed.origin;
}

export function currentCodexSessionId(environment: NodeJS.ProcessEnv = process.env): string {
  const value = environment.CODEX_THREAD_ID ?? environment.CODEX_SESSION_ID;
  if (!value || value.trim().length === 0 || value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new TraceProductClientError('CODEX_SESSION_UNAVAILABLE', 'Codex did not provide a usable task/session identity to the Trace MCP process');
  }
  return value;
}

function returnCommandId(sessionId: string, input: TraceProductReturnInput): string {
  const digest = createHash('sha256').update(JSON.stringify({sessionId, ...input})).digest('hex');
  return `codex-return:${digest}`;
}

function hostCommandId(operation: string, sessionId: string, input: Record<string, unknown> = {}): string {
  const digest = createHash('sha256').update(JSON.stringify({operation, sessionId, ...input})).digest('hex');
  return `codex-host-${operation}:${sessionId}:${digest.slice(0, 32)}`;
}

export class TraceProductClient {
  readonly baseUrl: string;
  readonly sessionId: string;
  readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ProductClientOptions = {}) {
    this.baseUrl = resolveBaseUrl(options.baseUrl ?? process.env.TRACE_PRODUCT_URL ?? 'http://127.0.0.1:4173');
    this.sessionId = options.sessionId ?? currentCodexSessionId();
    this.timeoutMs = Math.max(250, Math.min(30_000, Math.floor(options.timeoutMs ?? 5_000)));
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request(route: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${route}`, {
        method: 'POST',
        headers: {'content-type': 'application/json', origin: this.baseUrl, 'x-trace-host': 'codex-mcp'},
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      throw new TraceProductClientError(timedOut ? 'PRODUCT_TIMEOUT' : 'PRODUCT_UNAVAILABLE', timedOut
        ? 'Trace product service did not respond before the local timeout'
        : 'Trace product service is not reachable; start or restart the local Trace desktop service');
    } finally { clearTimeout(timer); }
    let value: unknown;
    try { value = JSON.parse(await response.text()); } catch { throw new TraceProductClientError('INVALID_PRODUCT_RESPONSE', 'Trace product service returned invalid JSON', response.status); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TraceProductClientError('INVALID_PRODUCT_RESPONSE', 'Trace product service returned an invalid response shape', response.status);
    if (!response.ok) {
      const error = (value as ProductErrorBody).error;
      throw new TraceProductClientError(typeof error?.code === 'string' ? error.code : 'PRODUCT_REQUEST_FAILED', typeof error?.message === 'string' ? error.message : `Trace product request failed (${response.status})`, response.status);
    }
    return value as Record<string, unknown>;
  }

  receive(input: {projectDir: string; workId?: string}): Promise<Record<string, unknown>> {
    if (!path.isAbsolute(input.projectDir)) throw new TraceProductClientError('INVALID_PROJECT_DIR', 'project_dir must be absolute');
    const commandId = `codex-receive:${this.sessionId}:${randomUUID()}`;
    return this.request('/api/product/codex/receive', {
      protocolVersion: 1,
      commandId,
      sessionId: this.sessionId,
      projectDir: path.resolve(input.projectDir),
      ...(input.workId === undefined ? {} : {workId: input.workId}),
    });
  }

  returnResult(input: TraceProductReturnInput): Promise<Record<string, unknown>> {
    if (!path.isAbsolute(input.projectDir)) throw new TraceProductClientError('INVALID_PROJECT_DIR', 'project_dir must be absolute');
    const result = {
      matterId: input.matterId,
      fact: input.fact,
      ...(input.summary === undefined ? {} : {summary: input.summary}),
      ...(input.interpretation === undefined ? {} : {interpretation: input.interpretation}),
      ...(input.unconfirmed === undefined ? {} : {unconfirmed: input.unconfirmed}),
      ...(input.proposedUnderstanding === undefined ? {} : {proposedUnderstanding: input.proposedUnderstanding}),
      ...(input.artifacts === undefined ? {} : {artifacts: input.artifacts}),
    };
    return this.request('/api/product/codex/return', {
      protocolVersion: 1,
      commandId: returnCommandId(this.sessionId, input),
      workId: input.workId,
      sessionId: this.sessionId,
      projectDir: path.resolve(input.projectDir),
      deliveryId: input.deliveryId,
      contextHash: input.contextHash,
      result,
    });
  }

  private async read(route: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}${route}`);
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs); timer.unref?.();
    let response: Response;
    try {
      response = await this.fetchImpl(url, {method: 'GET', headers: {'accept': 'application/json', origin: this.baseUrl, 'x-trace-host': 'codex-mcp'}, signal: controller.signal});
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      throw new TraceProductClientError(timedOut ? 'PRODUCT_TIMEOUT' : 'PRODUCT_UNAVAILABLE', timedOut ? 'Trace product service did not respond before the local timeout' : 'Trace product service is not reachable; start or restart the local Trace desktop service');
    } finally { clearTimeout(timer); }
    let value: unknown; try { value = JSON.parse(await response.text()); } catch { throw new TraceProductClientError('INVALID_PRODUCT_RESPONSE', 'Trace product service returned invalid JSON', response.status); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TraceProductClientError('INVALID_PRODUCT_RESPONSE', 'Trace product service returned an invalid response shape', response.status);
    if (!response.ok) { const error = (value as ProductErrorBody).error; throw new TraceProductClientError(typeof error?.code === 'string' ? error.code : 'PRODUCT_REQUEST_FAILED', typeof error?.message === 'string' ? error.message : `Trace product request failed (${response.status})`, response.status); }
    return value as Record<string, unknown>;
  }

  attachHostSession(input: {projectDir?: string} = {}): Promise<Record<string, unknown>> {
    if (input.projectDir !== undefined && !path.isAbsolute(input.projectDir)) throw new TraceProductClientError('INVALID_PROJECT_DIR', 'project_dir must be absolute');
    const projectRef = input.projectDir === undefined ? undefined : path.resolve(input.projectDir);
    return this.request('/api/product/host/session/attach', {
      protocolVersion: 1,
      commandId: hostCommandId('attach', this.sessionId, {projectRef: projectRef ?? null}),
      host: 'codex', sessionId: this.sessionId,
      ...(projectRef === undefined ? {} : {projectRef}),
    });
  }

  pauseHostSession(): Promise<Record<string, unknown>> {
    return this.request('/api/product/host/session/pause', {
      protocolVersion: 1,
      commandId: hostCommandId('pause', this.sessionId),
      host: 'codex', sessionId: this.sessionId,
    });
  }

  detachHostSession(): Promise<Record<string, unknown>> {
    return this.request('/api/product/host/session/detach', {
      protocolVersion: 1,
      commandId: hostCommandId('detach', this.sessionId),
      host: 'codex', sessionId: this.sessionId,
    });
  }

  captureWorkflowFinding(input: TraceHostFindingInput): Promise<Record<string, unknown>> {
    const turnId = input.turnId;
    if (turnId !== undefined && (!turnId || turnId.length > 512 || /[\x00-\x1f\x7f]/.test(turnId))) throw new TraceProductClientError('INVALID_TURN_ID', 'turn_id must be a usable Codex turn identity');
    if (!input.observation || input.observation.length > 1_000_000) throw new TraceProductClientError('INVALID_FINDING', 'observation must be a non-empty bounded text value');
    return this.request('/api/product/host/finding', {
      protocolVersion: 1,
      commandId: hostCommandId('finding', this.sessionId, {turnId: turnId ?? null, observation: input.observation, desiredBehavior: input.desiredBehavior ?? null}),
      host: 'codex', sessionId: this.sessionId, ...(turnId === undefined ? {} : {turnId}),
      observation: input.observation,
      ...(input.desiredBehavior === undefined ? {} : {desiredBehavior: input.desiredBehavior}),
    }).then(value => {
      // The explicit finding is durably stored in Product Workspace and can
      // be read from the UI/list tool when needed.  Keep the immediate MCP
      // receipt short and avoid echoing a possibly private observation into
      // the model transcript that requested the capture.
      const finding = value.finding;
      if (!finding || typeof finding !== 'object' || Array.isArray(finding)) return value;
      const {observation: _observation, desired_behavior: _desiredBehavior, desiredBehavior: _desiredBehaviorCamel, ...safeFinding} = finding as Record<string, unknown>;
      return {...value, finding: safeFinding, private_fields_omitted: ['observation', 'desired_behavior']};
    });
  }

  listWorkflowFindings(): Promise<Record<string, unknown>> { return this.read('/api/product/host/findings', {host: 'codex', session_id: this.sessionId}); }
  listRoutingProposals(): Promise<Record<string, unknown>> { return this.read('/api/product/host/routing/proposals', {host: 'codex', session_id: this.sessionId}); }
  proposeRouting(input: TraceRoutingProposalInput): Promise<Record<string, unknown>> {
    if (!input.findingId || input.findingId.length > 512) throw new TraceProductClientError('INVALID_FINDING_ID', 'finding_id must be a usable finding identity');
    return this.request('/api/product/host/routing/propose', {protocolVersion: 1, commandId: hostCommandId('routing-propose', this.sessionId, input as unknown as Record<string, unknown>), host: 'codex', sessionId: this.sessionId, findingId: input.findingId});
  }
  decideRouting(input: TraceRoutingDecisionInput): Promise<Record<string, unknown>> {
    if (!input.proposalId || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new TraceProductClientError('INVALID_ROUTE_DECISION', 'proposal_id and expected_revision are required');
    return this.request('/api/product/host/routing/decide', {protocolVersion: 1, commandId: hostCommandId(`routing-${input.action}`, this.sessionId, input as unknown as Record<string, unknown>), host: 'codex', sessionId: this.sessionId, proposalId: input.proposalId, action: input.action, expectedRevision: input.expectedRevision, ...(input.note === undefined ? {} : {note: input.note})});
  }
  queryActivation(input: {taskIntent?: string; projectRef?: string; includeTrial?: boolean; maxItems?: number; maxTokens?: number} = {}): Promise<Record<string, unknown>> {
    if (input.projectRef !== undefined && !path.isAbsolute(input.projectRef)) throw new TraceProductClientError('INVALID_PROJECT_DIR', 'project_ref must be absolute');
    const query = {host: 'codex', session_id: this.sessionId, ...(input.projectRef === undefined ? {} : {project_ref: path.resolve(input.projectRef)}), ...(input.taskIntent === undefined ? {} : {task_intent: input.taskIntent}), ...(input.includeTrial === undefined ? {} : {include_trial: input.includeTrial}), ...(input.maxItems === undefined ? {} : {max_items: input.maxItems}), ...(input.maxTokens === undefined ? {} : {max_tokens: input.maxTokens})};
    return this.read('/api/product/host/activation/query', query);
  }
  markActivation(input: {receiptId: string; status: 'used' | 'affected' | 'dismissed' | 'snoozed' | 'released'; expectedRevision: number}): Promise<Record<string, unknown>> {
    return this.request('/api/product/host/activation/mark', {protocolVersion: 1, commandId: hostCommandId(`activation-${input.status}`, this.sessionId, input as unknown as Record<string, unknown>), host: 'codex', sessionId: this.sessionId, receiptId: input.receiptId, status: input.status, expectedRevision: input.expectedRevision});
  }
  listActivationHistory(): Promise<Record<string, unknown>> { return this.read('/api/product/host/activation/history', {host: 'codex', session_id: this.sessionId}); }
  sensemakingWorkerStatus(): Promise<Record<string, unknown>> { return this.read('/api/agent/sensemaking/health'); }
  sensemakingWorkerDrain(limit = 16): Promise<Record<string, unknown>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new TraceProductClientError('INVALID_WORKER_LIMIT', 'limit must be an integer from 1 to 1000');
    return this.request('/api/agent/sensemaking/drain', {protocolVersion: 1, limit});
  }
  repositoryPreflight(input: {repoRoot: string; taskIntent?: string; executionMode?: 'local' | 'managed-worktree' | 'cloud' | 'unknown'; proposalId?: string; userRequestedCurrentBranch?: boolean}): Promise<Record<string, unknown>> {
    if (!path.isAbsolute(input.repoRoot)) throw new TraceProductClientError('INVALID_REPOSITORY_ROOT', 'repo_root must be absolute');
    return this.request('/api/product/host/repository/preflight', {protocolVersion: 1, commandId: hostCommandId('repository-preflight', this.sessionId, input as unknown as Record<string, unknown>), host: 'codex', sessionId: this.sessionId, repoRoot: path.resolve(input.repoRoot), executionMode: input.executionMode ?? 'unknown', taskIntent: input.taskIntent ?? '', ...(input.proposalId === undefined ? {} : {proposalId: input.proposalId}), ...(input.userRequestedCurrentBranch === undefined ? {} : {userRequestedCurrentBranch: input.userRequestedCurrentBranch})});
  }
  repositoryGuardApply(input: {preflightId: string; proposalId: string; expectedStateHash: string; approval: string}): Promise<Record<string, unknown>> {
    return this.request('/api/product/host/repository/apply', {protocolVersion: 1, commandId: hostCommandId('repository-apply', this.sessionId, input as unknown as Record<string, unknown>), host: 'codex', sessionId: this.sessionId, preflightId: input.preflightId, proposalId: input.proposalId, expectedStateHash: input.expectedStateHash, approval: input.approval});
  }
  repositoryRecoveryPreview(input: {journalId?: string; commandId?: string}): Promise<Record<string, unknown>> {
    if (input.journalId === undefined && input.commandId === undefined) throw new TraceProductClientError('INVALID_GUARD_RECOVERY', 'journal_id or command_id is required');
    return this.request('/api/product/host/repository/recovery/preview', {protocolVersion: 1, commandId: hostCommandId('repository-recovery-preview', this.sessionId, input as Record<string, unknown>), host: 'codex', sessionId: this.sessionId, ...(input.journalId === undefined ? {} : {journalId: input.journalId}), ...(input.commandId === undefined ? {} : {targetCommandId: input.commandId})});
  }
  repositoryRecoveryReconcile(journalId: string): Promise<Record<string, unknown>> {
    if (!journalId) throw new TraceProductClientError('INVALID_GUARD_RECOVERY', 'journal_id is required');
    return this.request('/api/product/host/repository/recovery/reconcile', {protocolVersion: 1, commandId: hostCommandId('repository-recovery-reconcile', this.sessionId, {journalId}), host: 'codex', sessionId: this.sessionId, journalId});
  }
  repositoryRecoveryStatus(state?: string): Promise<Record<string, unknown>> { return this.read('/api/product/host/repository/recovery/status', {state}); }

  listPublicationPolicies(status?: string): Promise<Record<string, unknown>> { return this.read('/api/product/host/publication-policies', {status}); }
  previewPublicationPolicy(input: TracePublicationPolicyInput): Promise<Record<string, unknown>> {
    if (!path.isAbsolute(input.targetRoot)) throw new TraceProductClientError('INVALID_PUBLICATION_POLICY', 'target_root must be absolute');
    return this.request('/api/product/host/publication-policy/preview', {protocolVersion: 1, commandId: hostCommandId('publication-policy-preview', this.sessionId, input as unknown as Record<string, unknown>), host: 'codex', sessionId: this.sessionId, scope: input.scope, targetRoot: path.resolve(input.targetRoot), ...(input.allowedCapabilityKinds === undefined ? {} : {allowedCapabilityKinds: input.allowedCapabilityKinds}), ...(input.validationRequirements === undefined ? {} : {validationRequirements: input.validationRequirements}), ...(input.expiresAt === undefined ? {} : {expiresAt: input.expiresAt})});
  }
  adoptPublicationPolicy(input: TracePublicationPolicyInput & {approval: string}): Promise<Record<string, unknown>> {
    if (!path.isAbsolute(input.targetRoot)) throw new TraceProductClientError('INVALID_PUBLICATION_POLICY', 'target_root must be absolute');
    return this.request('/api/product/host/publication-policy/adopt', {protocolVersion: 1, commandId: hostCommandId('publication-policy-adopt', this.sessionId, input as unknown as Record<string, unknown>), host: 'codex', sessionId: this.sessionId, scope: input.scope, targetRoot: path.resolve(input.targetRoot), allowedCapabilityKinds: input.allowedCapabilityKinds, validationRequirements: input.validationRequirements, expiresAt: input.expiresAt, approval: input.approval});
  }
  revokePublicationPolicy(policyId: string, expectedRevision: number, reason?: string): Promise<Record<string, unknown>> {
    return this.request('/api/product/host/publication-policy/revoke', {protocolVersion: 1, commandId: hostCommandId('publication-policy-revoke', this.sessionId, {policyId, expectedRevision, reason: reason ?? null}), host: 'codex', sessionId: this.sessionId, policyId, expectedRevision, ...(reason === undefined ? {} : {reason})});
  }
  listCapabilityOrchestrations(status?: string): Promise<Record<string, unknown>> { return this.read('/api/product/host/capability/orchestrations', {host: 'codex', session_id: this.sessionId, status}); }
  listCapabilityTrials(orchestrationId?: string): Promise<Record<string, unknown>> { return this.read('/api/product/host/capability/trials', {orchestration_id: orchestrationId}); }
  createCapabilityTrial(input: TraceCapabilityTrialInput): Promise<Record<string, unknown>> {
    return this.request('/api/product/host/capability/trial/create', {protocolVersion: 1, commandId: hostCommandId('capability-trial-create', this.sessionId, input as unknown as Record<string, unknown>), host: 'codex', sessionId: this.sessionId, orchestrationId: input.orchestrationId, expectedRevision: input.expectedRevision, capabilityVersion: input.capabilityVersion, capabilityHash: input.capabilityHash, scenario: input.scenario, task: input.task, expected: input.expected, ...(input.host === undefined ? {} : {host: input.host}), ...(input.model === undefined ? {} : {model: input.model}), ...(input.toolConfig === undefined ? {} : {toolConfig: input.toolConfig}), ...(input.evidenceRefs === undefined ? {} : {evidenceRefs: input.evidenceRefs})});
  }
  completeCapabilityTrial(input: {trialId: string; expectedRevision: number; outcome: 'support' | 'limit' | 'challenge' | 'inconclusive'; observed: string; evidenceRefs?: string[]}): Promise<Record<string, unknown>> {
    return this.request('/api/product/host/capability/trial/complete', {protocolVersion: 1, commandId: hostCommandId('capability-trial-complete', this.sessionId, input as unknown as Record<string, unknown>), host: 'codex', sessionId: this.sessionId, trialId: input.trialId, expectedRevision: input.expectedRevision, outcome: input.outcome, observed: input.observed, ...(input.evidenceRefs === undefined ? {} : {evidenceRefs: input.evidenceRefs})});
  }
  stageCapability(input: {orchestrationId: string; expectedRevision: number; candidateDir?: string; manifestSha256?: string; producerStatus?: 'required' | 'staged'}): Promise<Record<string, unknown>> {
    if (input.candidateDir !== undefined && !path.isAbsolute(input.candidateDir)) throw new TraceProductClientError('INVALID_CAPABILITY_PRODUCER', 'candidate_dir must be absolute');
    return this.request('/api/product/host/capability/stage', {protocolVersion: 1, commandId: hostCommandId('capability-stage', this.sessionId, input as unknown as Record<string, unknown>), host: 'codex', sessionId: this.sessionId, orchestrationId: input.orchestrationId, expectedRevision: input.expectedRevision, ...(input.candidateDir === undefined ? {} : {candidateDir: path.resolve(input.candidateDir)}), ...(input.manifestSha256 === undefined ? {} : {manifestSha256: input.manifestSha256}), ...(input.producerStatus === undefined ? {} : {producerStatus: input.producerStatus})});
  }
  validateCapability(input: {orchestrationId: string; expectedRevision: number; validation: Record<string, string>}): Promise<Record<string, unknown>> {
    return this.request('/api/product/host/capability/validate', {protocolVersion: 1, commandId: hostCommandId('capability-validate', this.sessionId, input as unknown as Record<string, unknown>), host: 'codex', sessionId: this.sessionId, orchestrationId: input.orchestrationId, expectedRevision: input.expectedRevision, validation: input.validation});
  }
  publishCapability(input: {orchestrationId: string; expectedRevision: number; approval?: string; policyId?: string; publicationReceipt: Record<string, unknown>; rollbackReceipt: string; producerStatus?: 'published'}): Promise<Record<string, unknown>> {
    return this.request('/api/product/host/capability/publish', {protocolVersion: 1, commandId: hostCommandId('capability-publish', this.sessionId, input as unknown as Record<string, unknown>), host: 'codex', sessionId: this.sessionId, orchestrationId: input.orchestrationId, expectedRevision: input.expectedRevision, ...(input.approval === undefined ? {} : {approval: input.approval}), ...(input.policyId === undefined ? {} : {policyId: input.policyId}), publicationReceipt: input.publicationReceipt, rollbackReceipt: input.rollbackReceipt, ...(input.producerStatus === undefined ? {} : {producerStatus: input.producerStatus})});
  }
  rollbackCapability(input: {orchestrationId: string; expectedRevision: number; rollbackReceipt: string; producerStatus: 'rolled_back'}): Promise<Record<string, unknown>> {
    return this.request('/api/product/host/capability/rollback', {protocolVersion: 1, commandId: hostCommandId('capability-rollback', this.sessionId, input as unknown as Record<string, unknown>), host: 'codex', sessionId: this.sessionId, orchestrationId: input.orchestrationId, expectedRevision: input.expectedRevision, rollbackReceipt: input.rollbackReceipt, producerStatus: input.producerStatus});
  }
}
