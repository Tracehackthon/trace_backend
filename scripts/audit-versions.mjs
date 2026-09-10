import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const policy = JSON.parse(fs.readFileSync(path.join(root, 'governance', 'version-policy.json'), 'utf8'));
const rootManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const changesetConfig = JSON.parse(fs.readFileSync(path.join(root, '.changeset', 'config.json'), 'utf8'));
const semver = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const failures = [];

function fail(message) { failures.push(message); }
function packageManifests(directory, found = []) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (['node_modules', 'dist', '.git', '.changeset', 'release', 'tmp'].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) packageManifests(target, found);
    else if (entry.name === 'package.json') found.push(target);
  }
  return found;
}

if (changesetConfig.baseBranch !== policy.release_branch) fail(`changeset baseBranch must be ${policy.release_branch}, found ${String(changesetConfig.baseBranch)}`);
if (rootManifest.name !== policy.runtime_distribution.package) fail(`root package must be ${policy.runtime_distribution.package}, found ${String(rootManifest.name)}`);
if (typeof rootManifest.version !== 'string' || !semver.test(rootManifest.version)) fail('root runtime version is not valid semver');
const manifests = packageManifests(path.join(root, 'apps')).concat(packageManifests(path.join(root, 'packages')));
const packageNames = new Set([rootManifest.name]);
for (const manifestFile of manifests) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') fail(`workspace manifest missing name/version: ${path.relative(root, manifestFile)}`);
  else { packageNames.add(manifest.name); if (!semver.test(manifest.version)) fail(`workspace version is not valid semver: ${manifest.name}@${manifest.version}`); }
}
for (const [protocolId, version] of Object.entries(policy.protocol_tracks)) {
  if (typeof version !== 'string' || !semver.test(version)) fail(`policy protocol version is not valid semver: ${protocolId}`);
}
for (const entry of fs.readdirSync(path.join(root, '.changeset'))) {
  if (!entry.endsWith('.md')) continue;
  const source = fs.readFileSync(path.join(root, '.changeset', entry), 'utf8');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? '';
  for (const match of frontmatter.matchAll(/^"([^"]+)":\s+(major|minor|patch)$/gm)) {
    if (!packageNames.has(match[1])) fail(`changeset ${entry} references unknown workspace package: ${match[1]}`);
  }
}
const output = {status: failures.length === 0 ? 'healthy' : 'error', release_branch: policy.release_branch, runtime_version: rootManifest.version, workspace_packages: manifests.length, protocol_tracks: policy.protocol_tracks, failures};
process.stdout.write(JSON.stringify(output) + '\n');
if (failures.length > 0) process.exitCode = 1;
