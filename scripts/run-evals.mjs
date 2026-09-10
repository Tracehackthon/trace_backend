import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MyWikiSourceProvider} from '../dist/packages/integration/mywiki-source/src/index.js';
import {EVAL_MANIFEST_ID, EVAL_MANIFEST_VERSION, aggregateEvaluation, evaluateCase, fixtureHashes, fixtureSourceProfile, loadEvalCases, materializeFixtureSource} from '../tests/evals/lib.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function usage() {
  process.stderr.write('Usage: node scripts/run-evals.mjs --variant baseline|trace [--out ABS_DIRECTORY] [--run-id SAFE_ID]\n');
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
  if ([...values.keys()].some(name => !['--variant', '--out', '--run-id'].includes(name))) return undefined;
  const variant = values.get('--variant');
  if (variant !== 'baseline' && variant !== 'trace') return undefined;
  return {variant, out: values.get('--out'), runId: values.get('--run-id')};
}

function safeRunId(value) {
  if (value === undefined) return `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(16).slice(2, 10)}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value)) throw new Error('--run-id must contain only letters, numbers, dot, underscore, or hyphen');
  return value;
}

function gitCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'});
  return result.status === 0 ? result.stdout.trim() : 'unavailable';
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options === undefined) return usage();
  const runId = safeRunId(options.runId);
  const outputDirectory = path.resolve(options.out ?? path.join(root, 'snapshots', 'evals', runId));
  if (!path.isAbsolute(outputDirectory)) throw new Error('--out must resolve to an absolute directory');
  const manifestFile = path.join(outputDirectory, 'eval-manifest.json');
  if (fs.existsSync(manifestFile)) throw new Error(`Evaluation manifest already exists: ${manifestFile}`);

  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-eval-run-'));
  try {
    materializeFixtureSource(sourceRoot);
    const cases = loadEvalCases(root);
    const provider = options.variant === 'trace' ? new MyWikiSourceProvider(fixtureSourceProfile(sourceRoot)) : undefined;
    const caseResults = cases.map(caseDefinition => evaluateCase(
      caseDefinition,
      provider === undefined ? [] : provider.search(caseDefinition.prompt, caseDefinition.max_pointers).map(page => page.relative_path),
    ));
    const rootManifest = readJson('package.json');
    const codexProfile = readJson('profiles/codex.json');
    const bundle = readJson('packages/bundle/codex/bundle.json');
    const hashes = fixtureHashes(root);
    const metrics = aggregateEvaluation(caseResults);
    const manifest = {
      manifest_id: EVAL_MANIFEST_ID,
      manifest_version: EVAL_MANIFEST_VERSION,
      run_id: runId,
      created_at: new Date().toISOString(),
      git_commit: gitCommit(),
      runtime: {package: rootManifest.name, version: rootManifest.version},
      bundle: {id: bundle.bundle_id, version: bundle.bundle_version},
      protocol_versions: codexProfile.protocols,
      model: null,
      host: 'synthetic-mywiki-activation',
      evaluation_scope: 'deterministic source activation and pointer-routing only; this is not a model-quality evaluation',
      variant: options.variant,
      fixture_hashes: hashes,
      metrics,
      cases: caseResults,
    };
    fs.mkdirSync(outputDirectory, {recursive: true});
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, {encoding: 'utf8', flag: 'wx'});
    process.stdout.write(`${JSON.stringify({status: 'completed', variant: options.variant, manifest: manifestFile, metrics})}\n`);
  } finally {
    fs.rmSync(sourceRoot, {recursive: true, force: true});
  }
}

try { main(); } catch (error) {
  process.stdout.write(`${JSON.stringify({status: 'error', message: error instanceof Error ? error.message : String(error)})}\n`);
  process.exitCode = 1;
}
