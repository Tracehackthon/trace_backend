import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const semver = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const priority = {patch: 1, minor: 2, major: 3};

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}

function packageManifests(directory, found = []) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (['node_modules', 'dist', '.git', '.changeset', 'release', 'tmp'].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) packageManifests(target, found);
    else if (entry.name === 'package.json') found.push(target);
  }
  return found;
}

function declaredChangesets(packageNames) {
  const bumps = new Map();
  const failures = [];
  for (const entry of fs.readdirSync(path.join(root, '.changeset')).sort()) {
    if (!entry.endsWith('.md')) continue;
    const source = fs.readFileSync(path.join(root, '.changeset', entry), 'utf8');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? '';
    for (const match of frontmatter.matchAll(/^"([^"]+)":\s+(major|minor|patch)$/gm)) {
      const [ , packageName, bump] = match;
      if (!packageNames.has(packageName)) { failures.push(`changeset ${entry} references unknown package ${packageName}`); continue; }
      const current = bumps.get(packageName);
      if (current === undefined || priority[bump] > priority[current]) bumps.set(packageName, bump);
    }
  }
  const plan = {major: [], minor: [], patch: []};
  for (const [packageName, bump] of bumps) plan[bump].push(packageName);
  for (const values of Object.values(plan)) values.sort();
  return {plan, failures};
}

/**
 * Changesets expands internal dependents, so the source declarations alone
 * are not the final release plan. Prefer its own status command when the
 * installed CLI is available; retain a declaration-only fallback so a source
 * audit still works before dependency installation.
 */
function resolvedChangesetPlan(declaredPlan) {
  const command = path.join(root, 'node_modules', '@changesets', 'cli', 'bin.js');
  if (!fs.existsSync(command)) return {available: false, plan: declaredPlan, message: 'Changesets CLI is not installed; using declared changesets only.'};
  const result = spawnSync(process.execPath, [command, 'status'], {cwd: root, encoding: 'utf8'});
  if (result.status !== 0) return {available: false, plan: declaredPlan, message: `Changesets status failed; using declared changesets only: ${(result.stderr || result.stdout).trim().slice(0, 300)}`};
  const plan = {major: [], minor: [], patch: []};
  let current;
  for (const rawLine of result.stdout.split(/\r?\n/)) {
    const line = rawLine.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
    const heading = /Packages to be bumped at (major|minor|patch):/.exec(line);
    if (heading) { current = heading[1]; continue; }
    const item = /(?:^|\s)-\s+(@[^\s]+)/.exec(line);
    if (item && current) plan[current].push(item[1]);
  }
  for (const values of Object.values(plan)) values.sort();
  return {available: true, plan, message: 'Resolved through Changesets status, including dependent package bumps.'};
}

const failures = [];
const warnings = [];
const policy = readJson('governance/version-policy.json');
const rootManifest = readJson('package.json');
const changesetConfig = readJson('.changeset/config.json');
const profile = readJson(policy.codex_distribution.profile);
const bundle = readJson(policy.codex_distribution.bundle);
const manifests = packageManifests(path.join(root, 'apps')).concat(packageManifests(path.join(root, 'packages')));
const packageNames = new Set(manifests.map(file => readJson(path.relative(root, file)).name));
const changesets = declaredChangesets(packageNames);
failures.push(...changesets.failures);
const resolved = resolvedChangesetPlan(changesets.plan);

function verify(condition, message) { if (!condition) failures.push(message); }
function sameStringArray(left, right) { return Array.isArray(left) && Array.isArray(right) && left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]); }

verify(changesetConfig.baseBranch === policy.release_branch, `changeset baseBranch must be ${policy.release_branch}`);
verify(rootManifest.name === policy.runtime_distribution.package, `root package must be ${policy.runtime_distribution.package}`);
verify(typeof rootManifest.version === 'string' && semver.test(rootManifest.version), 'root runtime version must be valid semver');
verify(profile.runtime_package === rootManifest.name, 'Codex profile runtime_package must match package.json');
verify(profile.runtime_version === rootManifest.version, 'Codex profile runtime_version must match package.json');
verify(bundle.runtime === `${rootManifest.name}@${rootManifest.version}`, 'Codex bundle runtime must match package.json');
verify(profile.bundle === `${bundle.bundle_id}@${bundle.bundle_version}`, 'Codex profile bundle must match bundle identity');
verify(profile.trigger?.command === policy.codex_distribution.expected_hook_command, 'Codex profile hook command differs from release policy');
verify(bundle.trigger?.command === policy.codex_distribution.expected_hook_command, 'Codex bundle hook command differs from release policy');
verify(profile.trigger?.routing === 'event-cwd-to-nearest-trace-project', 'Codex profile must route hooks from the event cwd');
verify(bundle.trigger?.routing === 'event-cwd-to-nearest-trace-project', 'Codex bundle must route hooks from the event cwd');
verify(sameStringArray(profile.protocols, bundle.protocols), 'Codex profile and bundle protocol tracks differ');
verify(Array.isArray(profile.trigger?.hook_event_types) && sameStringArray(profile.trigger.hook_event_types, bundle.trigger?.hook_event_types), 'Codex profile and bundle hook event types differ');

const pendingCount = Object.values(resolved.plan).reduce((total, values) => total + values.length, 0);
if (pendingCount > 0) warnings.push('Workspace Changesets are pending. Review and explicitly decide whether to release the private product runtime, Codex profile, and bundle together before packaging.');
const output = {
  status: failures.length === 0 ? 'ready_for_review' : 'error',
  product: {
    runtime: {name: rootManifest.name, version: rootManifest.version, changeset_managed: false},
    codex_profile: {path: policy.codex_distribution.profile, bundle: profile.bundle, hook_command: profile.trigger?.command},
    codex_bundle: {path: policy.codex_distribution.bundle, id: bundle.bundle_id, version: bundle.bundle_version, runtime: bundle.runtime},
  },
  pending_workspace_plan: resolved.plan,
  declared_workspace_plan: changesets.plan,
  workspace_plan_resolution: {available: resolved.available, message: resolved.message},
  requires_explicit_product_release_decision: pendingCount > 0,
  warnings,
  failures,
};
process.stdout.write(`${JSON.stringify(output)}\n`);
if (failures.length > 0) process.exitCode = 1;
