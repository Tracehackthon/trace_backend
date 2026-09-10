import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const runner = path.join(root, 'scripts', 'run-evals.mjs');

function usage() {
  process.stderr.write('Usage: node scripts/run-evals-pair.mjs [--out ABS_DIRECTORY] [--pair-id SAFE_ID]\n');
  process.exitCode = 2;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name.startsWith('--') || values.has(name) || index + 1 >= argv.length) return undefined;
    const value = argv[index + 1];
    if (value.startsWith('--')) return undefined;
    values.set(name, value);
    index += 1;
  }
  if ([...values.keys()].some(name => !['--out', '--pair-id'].includes(name))) return undefined;
  return {out: values.get('--out'), pairId: values.get('--pair-id')};
}

function safePairId(value) {
  const candidate = value ?? `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(16).slice(2, 10)}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(candidate)) throw new Error('--pair-id must contain only letters, numbers, dot, underscore, or hyphen');
  return candidate;
}

function runVariant(variant, out, runId) {
  const result = spawnSync(process.execPath, [runner, '--variant', variant, '--out', out, '--run-id', runId], {cwd: root, encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`Could not run ${variant} evaluation: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options === undefined) return usage();
  const pairId = safePairId(options.pairId);
  const outputDirectory = path.resolve(options.out ?? path.join(root, 'snapshots', 'evals', pairId));
  const pairManifest = path.join(outputDirectory, 'pair-manifest.json');
  if (fs.existsSync(pairManifest)) throw new Error(`Evaluation pair manifest already exists: ${pairManifest}`);
  const baselineDir = path.join(outputDirectory, 'baseline');
  const traceDir = path.join(outputDirectory, 'trace');
  const baseline = runVariant('baseline', baselineDir, `${pairId}-baseline`);
  const trace = runVariant('trace', traceDir, `${pairId}-trace`);
  const summary = {
    manifest_id: 'trace.effect-evaluation-pair',
    manifest_version: '0.1.0',
    pair_id: pairId,
    created_at: new Date().toISOString(),
    baseline: {manifest: 'baseline/eval-manifest.json', metrics: baseline.metrics},
    trace: {manifest: 'trace/eval-manifest.json', metrics: trace.metrics},
    delta: {
      evidence_coverage: trace.metrics.evidence_coverage - baseline.metrics.evidence_coverage,
      observed_read_evidence: trace.metrics.observed_read_evidence - baseline.metrics.observed_read_evidence,
      forbidden_read_rate: trace.metrics.forbidden_read_rate - baseline.metrics.forbidden_read_rate,
    },
  };
  fs.writeFileSync(pairManifest, `${JSON.stringify(summary, null, 2)}\n`, {encoding: 'utf8', flag: 'wx'});
  process.stdout.write(`${JSON.stringify({status: 'completed', pair_id: pairId, manifest: pairManifest, baseline: baseline.metrics, trace: trace.metrics, delta: summary.delta})}\n`);
}

try { main(); } catch (error) {
  process.stdout.write(`${JSON.stringify({status: 'error', message: error instanceof Error ? error.message : String(error)})}\n`);
  process.exitCode = 1;
}
