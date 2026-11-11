import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { inspectManagedRuntimes, inspectProjectTrace } from '../src/artifacts/artifact-lifecycle.mjs'

const fixtures = []
test.after(() => {
  for (const directory of fixtures) fs.rmSync(directory, {recursive: true, force: true})
})

function fixtureRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  fixtures.push(root)
  return root
}

function write(root, relative, content = 'fixture') {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), {recursive: true})
  fs.writeFileSync(target, content, 'utf8')
  return target
}

test('project inventory is read-only and defaults unknown/evaluation files to review', () => {
  const project = fixtureRoot('trace-artifacts-project-')
  const db = write(project, '.trace/state/agent.sqlite', 'not a database; must remain opaque')
  const wal = write(project, '.trace/state/agent.sqlite-wal', 'wal fixture')
  write(project, '.trace/state/agent.sqlite.owner', 'owner fixture')
  write(project, '.trace/project-adoptions/receipt.json', '{"receipt":true}')
  write(project, '.trace/trace-project-workflow-fidelity-20261020-preview.json', '{"evidence":true}')
  write(project, '.trace/trace-project-workflow-fidelity-20261020-candidate-eval-project/AGENTS.md', 'fixture')
  write(project, '.trace/unclassified.json', '{"keep":true}')

  const before = [fs.readFileSync(db), fs.readFileSync(wal)]
  const result = inspectProjectTrace(project)
  const byPath = new Map(result.entries.map(entry => [entry.path, entry]))

  assert.equal(result.projectState, 'legacy-or-uninitialized')
  assert.equal(result.complete, true)
  assert.equal(byPath.get('state').category, 'database-state-container')
  assert.equal(byPath.get('state/agent.sqlite').category, 'database-state')
  assert.equal(byPath.get('state/agent.sqlite-wal').groupId, byPath.get('state/agent.sqlite').groupId)
  assert.equal(byPath.get('state/agent.sqlite.owner').groupId, byPath.get('state/agent.sqlite').groupId)
  assert.equal(byPath.get('project-adoptions/receipt.json').lifecycle, 'retained')
  assert.equal(byPath.get('trace-project-workflow-fidelity-20261020-preview.json').category, 'evaluation-evidence')
  assert.equal(byPath.get('trace-project-workflow-fidelity-20261020-candidate-eval-project/AGENTS.md').category, 'evaluation-fixture')
  assert.equal(byPath.get('unclassified.json').lifecycle, 'review')
  assert.ok(result.entries.every(entry => entry.allowedActions.length === 1 && entry.allowedActions[0] === 'inspect'))
  assert.ok(result.entries.every(entry => entry.lifecycle !== 'purgeable'))
  assert.deepEqual(fs.readFileSync(db), before[0])
  assert.deepEqual(fs.readFileSync(wal), before[1])
})

test('project inventory reports a missing .trace root without creating it', () => {
  const project = fixtureRoot('trace-artifacts-empty-project-')
  const result = inspectProjectTrace(project)
  assert.deepEqual(result, {scope: 'project-trace', projectState: 'missing', complete: true, entries: [], warnings: []})
  assert.equal(fs.existsSync(path.join(project, '.trace')), false)
})

test('project inventory stops at the configured bound and marks the result incomplete', () => {
  const project = fixtureRoot('trace-artifacts-bounded-project-')
  write(project, '.trace/a.json')
  write(project, '.trace/b.json')
  const result = inspectProjectTrace(project, {maxEntries: 1})
  assert.equal(result.entries.length, 1)
  assert.equal(result.complete, false)
  assert.match(result.warnings.join(' '), /条目上限/)
})

test('managed Runtime inventory trusts explicit active config and never infers purgeability', () => {
  const runtimeRoot = fixtureRoot('trace-artifacts-runtime-')
  fs.mkdirSync(path.join(runtimeRoot, '0.8.0'))
  fs.mkdirSync(path.join(runtimeRoot, '0.7.1'))
  fs.mkdirSync(path.join(runtimeRoot, '0.7.1.previous-123'))
  fs.mkdirSync(path.join(runtimeRoot, 'node-v24.20.0-win-x64'))

  const result = inspectManagedRuntimes(runtimeRoot, {activeRuntimeName: '0.8.0'})
  const byPath = new Map(result.entries.map(entry => [entry.path, entry]))
  assert.equal(result.complete, true)
  assert.equal(byPath.get('0.8.0').category, 'active-runtime')
  assert.equal(byPath.get('0.7.1').category, 'inactive-runtime-version')
  assert.equal(byPath.get('0.7.1.previous-123').category, 'runtime-backup')
  assert.equal(byPath.get('node-v24.20.0-win-x64').category, 'unclassified-runtime-entry')
  assert.ok(result.entries.every(entry => entry.allowedActions.length === 1 && entry.allowedActions[0] === 'inspect'))
  assert.ok(result.entries.every(entry => entry.lifecycle !== 'purgeable'))

  const withoutActiveConfig = inspectManagedRuntimes(runtimeRoot)
  assert.ok(withoutActiveConfig.entries.every(entry => entry.lifecycle !== 'active'))
})

test('inventory rejects relative roots and runtime names that escape the managed root', () => {
  assert.throws(() => inspectProjectTrace('.'), /absolute path/)
  const runtimeRoot = fixtureRoot('trace-artifacts-runtime-validation-')
  assert.throws(() => inspectManagedRuntimes(runtimeRoot, {activeRuntimeName: '..'}), /single directory name/)
})
