import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = path.resolve(process.cwd());
const exporter = path.join(root, 'scripts', 'export-source.mjs');

function run(args) {
  const result = spawnSync(process.execPath, [exporter, ...args], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('source export preserves local state and rotates only managed source backups', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-source-export-'));
  const target = path.join(directory, 'runtime');
  try {
    run(['--out', target, '--keep-backups', '2']);
    fs.mkdirSync(path.join(target, '.workbuddy-ai'), {recursive: true});
    fs.writeFileSync(path.join(target, '.workbuddy-ai', 'local-state.txt'), 'preserve', 'utf8');
    fs.mkdirSync(path.join(target, 'node_modules', 'generated'), {recursive: true});
    fs.writeFileSync(path.join(target, 'node_modules', 'generated', 'cache.txt'), 'discard', 'utf8');
    const legacy = `${target}.previous-legacy`;
    fs.mkdirSync(legacy, {recursive: true});
    fs.writeFileSync(path.join(legacy, 'keep.txt'), 'do not auto-prune', 'utf8');

    let final;
    for (let index = 0; index < 4; index += 1) final = run(['--out', target, '--replace', '--keep-backups', '2']);

    const backups = fs.readdirSync(directory, {withFileTypes: true})
      .filter(entry => entry.isDirectory() && entry.name.startsWith('runtime.previous-'))
      .map(entry => path.join(directory, entry.name));
    const managed = backups.filter(backup => {
      const manifest = path.join(backup, 'SOURCE_EXPORT_MANIFEST.json');
      return fs.existsSync(manifest) && /^0\.[2-9]\./.test(JSON.parse(fs.readFileSync(manifest, 'utf8')).manifest_version);
    });
    assert.equal(managed.length, 2);
    assert.equal(fs.existsSync(path.join(legacy, 'keep.txt')), true);
    assert.equal(fs.existsSync(path.join(target, '.workbuddy-ai', 'local-state.txt')), true);
    assert.equal(fs.existsSync(path.join(target, 'node_modules')), false);
    assert.equal(final.keep_backups, 2);
    assert.equal(final.pruned_backups.length >= 1, true);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
