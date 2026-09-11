import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const docs = ['README.md', 'native/README.md', 'plugins/trace-codex/README.md', 'docs/codex-plugin.md'];

test('first-use documentation points Windows users to the simple Trace launcher and keeps fallback Node commands executable', () => {
  for (const relative of docs) {
    const text = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.doesNotMatch(text, /^ative\\/m, `${relative} contains a broken wrapped native path`);
    assert.doesNotMatch(text, /node <[^\n>]+>\r?\n(?:ative|native)\\/m, `${relative} splits a Node command across lines`);
  }
  assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /Connect-Trace-to-Codex\.cmd/);
  assert.match(fs.readFileSync(path.join(root, 'plugins', 'trace-codex', 'README.md'), 'utf8'), /Connect-Trace-to-Codex\.cmd/);
  const launcher = fs.readFileSync(path.join(root, 'Connect-Trace-to-Codex.cmd'), 'utf8');
  assert.match(launcher, /node "%TRACE_ROOT%native\\install-codex-plugin\.mjs" --dry-run/);
  assert.match(launcher, /node "%TRACE_ROOT%native\\install-codex-plugin\.mjs" --confirm true/);
});
