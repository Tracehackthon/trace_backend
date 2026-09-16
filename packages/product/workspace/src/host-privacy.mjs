import crypto from 'node:crypto';

/**
 * Privacy boundary for Host Session sensemaking.  This module is deliberately
 * independent from the worker and from any model provider: Product owns the
 * policy and the receipt, while an executor only receives the redacted view.
 */
export const HOST_PRIVACY_POLICY_ID = 'trace.host-privacy';
export const HOST_PRIVACY_POLICY_VERSION = 1;

export const DEFAULT_HOST_PRIVACY_POLICY = Object.freeze({
  policy_id: HOST_PRIVACY_POLICY_ID,
  policy_version: HOST_PRIVACY_POLICY_VERSION,
  allowed_input_fields: Object.freeze([
    'host', 'session_id', 'turn_id', 'user_prompt', 'final_assistant_message',
    'safe_evidence', 'related_findings', 'input_hash',
  ]),
  max_prompt_chars: 256_000,
  max_final_chars: 256_000,
  max_evidence_items: 32,
  max_related_findings: 8,
  max_output_bytes: 64 * 1024,
  overlap_min_chars: 32,
  overlap_min_ratio: 0.35,
});

export class HostPrivacyError extends Error {
  constructor(code, message, status = 422, details = undefined) {
    super(message); this.name = 'HostPrivacyError'; this.code = code; this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, status = 422, details = undefined) { throw new HostPrivacyError(code, message, status, details); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function sha(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function safeJson(value) {
  try { return JSON.stringify(value); } catch { return ''; }
}
function bounded(value, max, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > max || /[\x00\x7f]/.test(value)) fail('PRIVACY_INPUT_INVALID', `${field} 超出隐私策略边界`);
  return value;
}

// These patterns intentionally replace only high-confidence credential/PII
// forms.  A replacement receipt records category and hash, never the match.
const PATTERNS = Object.freeze([
  {category: 'credential', pattern: /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g},
  {category: 'credential', pattern: /\b(?:api[_ -]?key|access[_ -]?token|secret|password|passwd)\s*[:=]\s*[^\s,;]+/gi},
  {category: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi},
  {category: 'cookie', pattern: /\b(?:Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi},
  {category: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi},
  // ASCII-alphanumeric boundaries avoid interpreting a run of digits inside
  // a SHA-256/UUID as a phone number while still catching standalone phones.
  // Treat hyphenated hex/UUID fragments as identifiers, not phone numbers.
  // The wider boundary prevents a match from starting or ending inside a
  // UUID after a preceding/following hyphen while retaining standalone phone
  // formats such as "+86 138 0013 8000".
  {category: 'phone', pattern: /(?<![A-Za-z0-9-])(?:\+?\d[\d .()\-]{8,}\d)(?![A-Za-z0-9-])/g},
  {category: 'path', pattern: /(?:[A-Za-z]:[\\/]|\\\\)[^\s"'`<>]{2,}|(?<![\w])\/(?:Users|home|root|mnt|private|var|tmp)\/[^\s"'`<>]+/gi},
]);

/** Redact high-confidence secret/PII/path patterns while preserving a
 * deterministic hash and category count for audit. */
export function redactHostText(value, field, policy = DEFAULT_HOST_PRIVACY_POLICY) {
  const max = field === 'user_prompt' ? policy.max_prompt_chars : policy.max_final_chars;
  const original = bounded(value ?? '', max, field) ?? '';
  let text = original;
  const counts = {};
  for (const item of PATTERNS) {
    // RegExp instances with global state must be reset for deterministic reuse.
    item.pattern.lastIndex = 0;
    text = text.replace(item.pattern, match => {
      counts[item.category] = (counts[item.category] ?? 0) + 1;
      return `[REDACTED:${item.category}:${sha(match).slice(0, 12)}]`;
    });
  }
  return {text, original_sha256: sha(original), redacted_sha256: sha(text), omitted: counts};
}

function safeEvidence(value, policy) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, policy.max_evidence_items).flatMap(item => {
    if (!plain(item)) return [];
    return [{
      event_kind: typeof item.event_kind === 'string' ? item.event_kind.slice(0, 64) : null,
      tool_use_id: typeof item.tool_use_id === 'string' ? item.tool_use_id.slice(0, 512) : null,
      content_sha256: typeof item.content_sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.content_sha256) ? item.content_sha256 : null,
      created_at: typeof item.created_at === 'string' ? item.created_at.slice(0, 64) : null,
    }];
  });
}

function relatedFindings(value, policy) {
  if (!Array.isArray(value)) return {items: [], redactions: []};
  const redactions = [];
  const items = value.slice(0, policy.max_related_findings).flatMap(item => {
    if (!plain(item)) return [];
    const rawObservation = typeof item.observation === 'string' ? item.observation.slice(0, 512) : null;
    const rawDesired = typeof item.desired_behavior === 'string' ? item.desired_behavior.slice(0, 512) : null;
    const observation = rawObservation === null ? null : redactHostText(rawObservation, 'related_finding', policy);
    const desired = rawDesired === null ? null : redactHostText(rawDesired, 'related_finding', policy);
    const findingId = typeof item.finding_id === 'string' ? item.finding_id.slice(0, 512) : null;
    redactions.push({finding_id: findingId,
      observation: observation === null ? null : {original_sha256: observation.original_sha256, redacted_sha256: observation.redacted_sha256, omitted: observation.omitted},
      desired_behavior: desired === null ? null : {original_sha256: desired.original_sha256, redacted_sha256: desired.redacted_sha256, omitted: desired.omitted}});
    return [{finding_id: findingId,
      observation: observation?.text ?? null, desired_behavior: desired?.text ?? null,
      status: typeof item.status === 'string' ? item.status.slice(0, 64) : null,
      scope: typeof item.scope === 'string' ? item.scope.slice(0, 64) : null,
      target_kind: typeof item.target_kind === 'string' ? item.target_kind.slice(0, 64) : null}];
  });
  return {items, redactions};
}

/** Build the only HostTurn view an executor may receive.  The raw input stays
 * in Product web.sqlite; the returned object is safe to pass to Agent. */
export function redactSensemakingInput(input, policy = DEFAULT_HOST_PRIVACY_POLICY) {
  if (!plain(input)) fail('PRIVACY_INPUT_INVALID', 'sensemaking 输入必须是对象');
  const allowed = new Set(policy.allowed_input_fields);
  const unknown = Object.keys(input).filter(key => !allowed.has(key));
  if (unknown.length > 0) fail('PRIVACY_INPUT_FIELDS', 'sensemaking 输入包含未授权字段', 422, {fields: unknown});
  const prompt = redactHostText(input.user_prompt ?? '', 'user_prompt', policy);
  const final = input.final_assistant_message === null || input.final_assistant_message === undefined
    ? {text: '', original_sha256: sha(''), redacted_sha256: sha(''), omitted: {}}
    : redactHostText(input.final_assistant_message, 'final_assistant_message', policy);
  const related = relatedFindings(input.related_findings, policy);
  const modelInput = {
    host: typeof input.host === 'string' ? input.host : null,
    session_id: typeof input.session_id === 'string' ? input.session_id : null,
    turn_id: typeof input.turn_id === 'string' ? input.turn_id : null,
    user_prompt: prompt.text,
    final_assistant_message: final.text,
    safe_evidence: safeEvidence(input.safe_evidence, policy),
    related_findings: related.items,
    input_hash: typeof input.input_hash === 'string' ? input.input_hash : null,
  };
  const receipt = {
    policy_id: policy.policy_id, policy_version: policy.policy_version,
    input_hash: input.input_hash ?? null,
    fields: {user_prompt: {original_sha256: prompt.original_sha256, redacted_sha256: prompt.redacted_sha256, omitted: prompt.omitted},
      final_assistant_message: {original_sha256: final.original_sha256, redacted_sha256: final.redacted_sha256, omitted: final.omitted},
      related_findings: related.redactions},
    omitted_fields: unknown,
    evidence_items: modelInput.safe_evidence.length,
    related_finding_items: modelInput.related_findings.length,
  };
  return {modelInput, receipt};
}

function normalized(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
}
function chunks(textValue, min) {
  const text = normalized(textValue);
  if (text.length < min) return [];
  // Use bounded, non-overlapping windows as well as sentence-like pieces.
  // This catches a result assembled from several returned fragments without
  // retaining or reporting any fragment content.
  const result = [];
  const limit = Math.min(text.length, 32_768);
  const windowSize = Math.max(min, 24);
  for (let offset = 0; offset + min <= limit && result.length < 2_048; offset += windowSize) {
    const value = text.slice(offset, Math.min(offset + windowSize, limit));
    if (value.length >= min) result.push(value);
  }
  for (const value of text.slice(0, limit).split(/(?<=[.!?。！？；;])\s+/u)) if (value.length >= min && result.length < 2_048) result.push(value);
  return [...new Set(result)];
}

/** Detect long exact/normalized fragments and multi-fragment reconstruction.
 * It returns metadata only; callers must not include the matched text in an
 * error or receipt. */
export function detectSensemakingOverlap(result, input, policy = DEFAULT_HOST_PRIVACY_POLICY) {
  const encoded = safeJson(result);
  if (!encoded) fail('PRIVACY_RESULT_INVALID', 'sensemaking 结果不可序列化', 502);
  if (Buffer.byteLength(encoded, 'utf8') > policy.max_output_bytes) fail('PRIVACY_RESULT_LIMIT', 'sensemaking 结果超过输出预算', 502);
  const candidates = [input?.user_prompt, input?.final_assistant_message].filter(value => typeof value === 'string' && value.trim().length >= policy.overlap_min_chars);
  const output = normalized(encoded);
  const outputCompact = output.replace(/\s+/gu, '');
  for (const source of candidates) {
    const compact = normalized(source).replace(/\s+/gu, '');
    // Exact normalized containment catches whitespace/Unicode variants.
    if (compact.length >= policy.overlap_min_chars && outputCompact.includes(compact)) {
      return {matched: true, kind: 'long-fragment', source_hash: sha(source), fragment_sha256: sha(compact), fragment_chars: compact.length, ratio: 1, policy_version: policy.policy_version};
    }
    // Probe a bounded head/tail window with exponential growth + binary
    // search.  The previous character-by-character/length loop was quadratic
    // for a large HostTurn and could make a Stop job exceed its lease.
    const scan = compact.length <= 16_384 ? compact : `${compact.slice(0, 8_192)}${compact.slice(-8_192)}`;
    let best = 0;
    const step = 4;
    for (let i = 0; i + policy.overlap_min_chars <= scan.length; i += step) {
      const minimum = scan.slice(i, i + policy.overlap_min_chars);
      if (!outputCompact.includes(minimum)) continue;
      let low = policy.overlap_min_chars, high = Math.min(scan.length - i, 4_096);
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (outputCompact.includes(scan.slice(i, i + middle))) low = middle; else high = middle - 1;
      }
      if (low > best) best = low;
      if (best >= 4_096) break;
    }
    if (best >= policy.overlap_min_chars && best / compact.length >= policy.overlap_min_ratio) {
      return {matched: true, kind: 'high-overlap', source_hash: sha(source), fragment_sha256: sha(`${compact.slice(0, best)}:${best}`), fragment_chars: best, source_chars: compact.length, ratio: best / compact.length, policy_version: policy.policy_version};
    }
    // Multiple separately returned chunks can reconstruct a high proportion
    // even when no single chunk is long enough to trip the previous rule. We
    // mark source intervals (not their content) and merge adjacent matches;
    // bounded scanning avoids quadratic work on a large HostTurn.
    const sourceScan = compact.length <= 32_768 ? compact : `${compact.slice(0, 16_384)}${compact.slice(-16_384)}`;
    const minimum = 16;
    const intervals = [];
    for (let i = 0; i + minimum <= sourceScan.length && intervals.length < 8_192; i += 4) {
      if (outputCompact.includes(sourceScan.slice(i, i + minimum))) intervals.push([i, i + minimum]);
    }
    const merged = [];
    for (const interval of intervals) {
      const previous = merged.at(-1);
      // Starts separated by a missing run indicate distinct returned
      // fragments, even when their nominal minimum windows touch at a
      // boundary. Keep last_start only as in-memory detector state.
      if (previous && interval[0] - previous[2] <= 8) { previous[1] = Math.max(previous[1], interval[1]); previous[2] = interval[0]; }
      else merged.push([interval[0], interval[1], interval[0]]);
    }
    const covered = merged.reduce((sum, interval) => sum + interval[1] - interval[0], 0);
    if (merged.length >= 2 && covered / sourceScan.length >= policy.overlap_min_ratio) {
      return {matched: true, kind: 'fragment-reconstruction', source_hash: sha(source), fragment_count: merged.length, ratio: covered / sourceScan.length, policy_version: policy.policy_version};
    }
  }
  return {matched: false, policy_version: policy.policy_version};
}

export function privacySafeError(error, input) {
  const raw = String(error instanceof Error ? error.message : error ?? 'privacy boundary rejected');
  const privateValues = [input?.user_prompt, input?.final_assistant_message].filter(value => typeof value === 'string' && value.length >= 16);
  const normalizedRaw = normalized(raw);
  if (privateValues.some(value => raw.includes(value) || normalizedRaw.includes(normalized(value)))) return 'privacy boundary rejected private HostTurn text';
  // Do not return provider diagnostics containing a long contiguous or
  // reconstructed private fragment.  The detector returns hashes/metadata
  // only and never includes a matched substring in the durable error.
  // Error handling itself must never throw: a provider may return an
  // oversized diagnostic, and leaving the Product lease running would make
  // the failure look like a stuck job.  Bound the diagnostic before entering
  // the overlap/redaction helpers and retain only a generic reason.
  if (Buffer.byteLength(raw, 'utf8') > DEFAULT_HOST_PRIVACY_POLICY.max_output_bytes) return 'privacy boundary rejected oversized provider diagnostics';
  try {
    if (detectSensemakingOverlap({message: raw}, input, {...DEFAULT_HOST_PRIVACY_POLICY, overlap_min_chars: 32, overlap_min_ratio: 0.2}).matched) return 'privacy boundary rejected private HostTurn text';
  } catch { return 'privacy boundary rejected provider diagnostics'; }
  let redacted;
  try { redacted = redactHostText(raw, 'final_assistant_message'); }
  catch { return 'privacy boundary rejected provider diagnostics'; }
  if (Object.keys(redacted.omitted).length > 0) return 'privacy boundary rejected sensitive provider diagnostics';
  return redacted.text.slice(0, 512);
}
