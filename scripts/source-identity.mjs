import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

/**
 * Return a release-safe identity for the checkout used to build a runtime.
 *
 * A commit hash alone is not a build identity: a dirty worktree can contain
 * code that is not represented by HEAD.  The package manifest therefore
 * records both the git state and a content digest.  The digest is deliberately
 * based on tracked source files plus the working-tree patch; generated output
 * is not treated as source and is excluded from the inventory.
 */

const GENERATED_ROOTS = new Set([
  'artifacts',
  'dist',
  'node_modules',
]);

function git(root, args, encoding = 'utf8') {
  const result = spawnSync('git', args, {cwd: root, encoding});
  if (result.status !== 0) return null;
  return typeof result.stdout === 'string' ? result.stdout.trim() : result.stdout;
}

function isGenerated(relative) {
  const normalized = relative.replaceAll('\\', '/');
  const first = normalized.split('/')[0];
  return GENERATED_ROOTS.has(first) || first.startsWith('trace-runtime-desktop-package-');
}

function sourceFiles(root) {
  const output = git(root, ['ls-files', '-z', '-c', '-o', '--exclude-standard']);
  if (output === null) return [];
  return output.split('\0').filter(Boolean).filter(relative => !isGenerated(relative));
}

function statusPaths(root) {
  const output = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (output === null || output === '') return [];
  return output.split(/\r?\n/).filter(Boolean).map(line => {
    // Porcelain v1 uses a two-column status followed by a space.  Renames
    // contain an old and a new path; keeping the raw relative payload is less
    // lossy than pretending the status is clean.
    const payload = line.slice(3).trim();
    return payload || line.trim();
  }).filter(relative => !isGenerated(relative));
}

function contentDigest(root, files) {
  const hash = createHash('sha256');
  for (const relative of [...files].sort()) {
    const absolute = path.join(root, relative);
    let stat;
    try { stat = fs.lstatSync(absolute); } catch { continue; }
    if (!stat.isFile()) continue;
    hash.update(relative.replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(absolute));
    hash.update('\0');
  }
  // Include the actual tracked-file patch, not only its path list.  This keeps
  // two dirty builds with the same set of modified files distinguishable.
  const patch = spawnSync('git', ['diff', '--binary', 'HEAD'], {cwd: root, encoding: 'buffer'});
  if (patch.status === 0 && patch.stdout?.length) hash.update(patch.stdout);
  return hash.digest('hex');
}

export function inspectSourceIdentity(root) {
  const files = sourceFiles(root);
  const dirtyPaths = statusPaths(root);
  const gitCommit = git(root, ['rev-parse', '--verify', 'HEAD']) ?? 'unavailable';
  const gitTree = git(root, ['rev-parse', '--verify', 'HEAD^{tree}']) ?? 'unavailable';
  const worktreeState = dirtyPaths.length === 0 ? 'clean' : 'dirty';
  return {
    git_commit: gitCommit,
    git_tree: gitTree,
    worktree_state: worktreeState,
    clean: worktreeState === 'clean',
    content_sha256: contentDigest(root, files),
    source_file_count: files.length,
    dirty_path_count: dirtyPaths.length,
    // Relative paths only; the value is useful to a release gate and cannot
    // disclose the builder's absolute checkout path.
    ...(dirtyPaths.length ? {dirty_paths: dirtyPaths.slice(0, 256)} : {}),
  };
}

export function assertCleanSourceIdentity(identity, context = 'runtime package') {
  if (!identity || identity.worktree_state !== 'clean' || identity.clean !== true) {
    const count = Number(identity?.dirty_path_count ?? 0);
    throw new Error(`${context} requires a clean source checkout; found ${count || 'an'} dirty path(s)`);
  }
  return identity;
}
