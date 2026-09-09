import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const catalogFile = path.join(root, 'templates', 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
const errors = [];
const audited = [];

function loadJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); return undefined; }
}

for (const entry of catalog.templates ?? []) {
  const manifestPath = path.join(root, 'templates', entry.path);
  const manifest = loadJson(manifestPath, `${entry.id} manifest`);
  if (!manifest) continue;
  const templateRoot = path.dirname(manifestPath);
  const refs = [
    ['capabilities', 'capabilities'],
    ['source_packs', 'sources'],
    ['context_templates', 'contexts'],
  ];
  const missing = [];
  for (const [field, directory] of refs) {
    for (const ref of manifest[field] ?? []) {
      const candidates = [
        path.join(templateRoot, directory, `${ref.id}.json`),
        path.join(templateRoot, directory, `${ref.id}@${ref.version}.json`),
      ];
      if (!candidates.some(file => fs.existsSync(file))) missing.push(`${directory}/${ref.id}.json`);
    }
  }
  if (missing.length > 0) errors.push(`${entry.id}: missing referenced assets: ${missing.join(', ')}`);
  audited.push({id: entry.id, manifest: path.relative(root, manifestPath).replaceAll(path.sep, '/'), missing});
}

const report = {status: errors.length === 0 ? 'healthy' : 'failed', templates: audited, errors};
process.stdout.write(JSON.stringify(report) + '\n');
if (errors.length > 0) process.exitCode = 1;
