import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'templates', 'catalog.json'), 'utf8'));

test('every selectable template contains the assets named by its manifest', () => {
  for (const entry of catalog.templates) {
    const manifestPath = path.join(root, 'templates', entry.path);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const templateRoot = path.dirname(manifestPath);
    for (const [field, directory] of [['capabilities', 'capabilities'], ['source_packs', 'sources'], ['context_templates', 'contexts']]) {
      for (const ref of manifest[field] ?? []) {
        const file = path.join(templateRoot, directory, `${ref.id}.json`);
        assert.equal(fs.existsSync(file), true, `${entry.id} references missing ${file}`);
      }
    }
  }
});
