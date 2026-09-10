import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = path.resolve(process.cwd());

test('release-plan audit separates a pending workspace plan from the private product runtime decision', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'audit-release-plan.mjs')], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'ready_for_review');
  assert.equal(report.product.runtime.changeset_managed, false);
  assert.equal(report.product.codex_profile.hook_command, 'trace internal codex hook-stdio --route-from-event-cwd');
  const runtime = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(report.product.codex_bundle.runtime, `${runtime.name}@${runtime.version}`);
  assert.equal(report.requires_explicit_product_release_decision, true);
  if (report.workspace_plan_resolution.available) {
    assert.equal(report.pending_workspace_plan.patch.length, 9, 'resolved plan includes internal dependent patch releases');
    assert.equal(report.pending_workspace_plan.minor.length, 17, 'the MCP/product-application changeset adds two independently versioned minor packages');
  } else {
    assert.match(report.workspace_plan_resolution.message, /declared changesets only/);
    assert.equal(report.pending_workspace_plan.patch.length, 2, 'the dependency-free source checkout retains the declared plan');
  }
  assert.equal(report.pending_workspace_plan.minor.length > 0, true);
  assert.equal(report.failures.length, 0);
});
