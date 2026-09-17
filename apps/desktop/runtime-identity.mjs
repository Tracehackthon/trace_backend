import fs from 'node:fs';
import path from 'node:path';

const API_SURFACE = Object.freeze({
  protocol: 'trace.desktop.runtime-api@0.2.0',
  runtime: ['/api/runtime/identity'],
  product: ['/api/product/workspace', '/api/product/commands', '/api/product/codex/receive', '/api/product/codex/return'],
  agent: ['/api/agent/capabilities', '/api/agent/check', '/api/agent/runs', '/api/agent/runs/:id', '/api/agent/runs/:id/events', '/api/agent/runs/:id/cancel', '/api/agent/runs/:id/adoption', '/api/agent/sensemaking/health', '/api/agent/sensemaking/drain'],
  zhihu: ['/api/search/capabilities', '/api/search', '/api/zhihu/status', '/api/zhihu/oauth/start', '/api/zhihu/oauth/check', '/api/zhihu/oauth/disconnect', '/api/zhihu/user'],
  host: ['/api/product/host/sessions', '/api/product/host/turns', '/api/product/host/findings', '/api/product/host/session/attach', '/api/product/host/session/pause', '/api/product/host/session/detach', '/api/product/host/event', '/api/product/host/finding', '/api/product/host/sensemaking/jobs', '/api/product/host/sensemaking/results', '/api/product/host/sensemaking/privacy', '/api/product/host/routing/proposals', '/api/product/host/routing/propose', '/api/product/host/routing/decide', '/api/product/host/activation/history', '/api/product/host/activation/mark', '/api/product/host/repository/preflight', '/api/product/host/repository/apply', '/api/product/host/repository/recovery/preview', '/api/product/host/repository/recovery/reconcile', '/api/product/host/repository/recovery/status', '/api/product/host/publication-policies', '/api/product/host/publication-policy/preview', '/api/product/host/publication-policy/adopt', '/api/product/host/publication-policy/revoke', '/api/product/host/capability/orchestrations', '/api/product/host/capability/trials', '/api/product/host/capability/trial/create', '/api/product/host/capability/trial/complete', '/api/product/host/capability/stage', '/api/product/host/capability/validate', '/api/product/host/capability/publish', '/api/product/host/capability/rollback'],
});

export function runtimeApiSurface() {
  return JSON.parse(JSON.stringify(API_SURFACE));
}

export function loadRuntimeIdentity(desktopRoot) {
  const packageRoot = path.resolve(desktopRoot, '../..');
  const runtimeFile = path.join(packageRoot, 'runtime.json');
  const packageFile = path.join(packageRoot, 'package.json');
  let packaged = null;
  try { packaged = JSON.parse(fs.readFileSync(runtimeFile, 'utf8')); } catch {}
  let packageInfo = null;
  try { packageInfo = JSON.parse(fs.readFileSync(packageFile, 'utf8')); } catch {}
  const source = packaged?.source_identity ?? null;
  return {
    protocol_version: 1,
    runtime_version: packaged?.runtime_version ?? packageInfo?.version ?? 'unpackaged',
    distribution_eligibility: packaged?.distribution_eligibility ?? 'unpackaged-source-checkout',
    source_identity: source ? {
      git_commit: source.git_commit,
      git_tree: source.git_tree,
      worktree_state: source.worktree_state,
      clean: source.clean === true,
      content_sha256: source.content_sha256,
      source_file_count: source.source_file_count,
      dirty_path_count: source.dirty_path_count,
    } : null,
    api_surface: runtimeApiSurface(),
  };
}
