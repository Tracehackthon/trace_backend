import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const consumers = [
  'packages/core/data/src/contracts.ts',
  'packages/core/context/src/index.ts',
  'packages/core/capability-candidate/src/index.ts',
  'packages/core/continuity/src/index.ts',
  'packages/core/precedent/src/index.ts',
  'packages/core/protocol/src/change-set.ts',
  'packages/core/capability/src/content.ts',
  'packages/core/capability/src/contract.ts',
  'packages/template/contract/src/index.ts',
  'packages/plugin/contract/src/index.ts',
  'packages/core/instance/src/index.ts',
  'packages/core/observability/src/index.ts',
  'packages/host/codex-hooks/src/index.ts',
  'packages/host/codex-skill/src/index.ts',
  'packages/integration/zhihu-transport/src/index.ts',
  'packages/integration/zhihu-precedent/src/index.ts',
  'packages/integration/mywiki-source/src/index.ts',
];

test('all public contract boundaries consume shared validation primitives', () => {
  for (const relative of consumers) {
    const contents = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.match(contents, /require(Text|Object|StringList)|rejectUnknown/, `${relative} must use @trace/protocol validation primitives`);
    assert.doesNotMatch(contents, /function\s+(text|object|rejectUnknown)\b/, `${relative} must not reimplement generic protocol validators`);
  }
});
