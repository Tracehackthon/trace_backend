import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const EVAL_MANIFEST_ID = 'trace.effect-evaluation';
export const EVAL_MANIFEST_VERSION = '0.1.0';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function evalPaths(root = process.cwd()) {
  const directory = path.join(root, 'tests', 'evals');
  return {
    directory,
    fixtureFile: path.join(directory, 'fixtures', 'source-pages.json'),
    casesDirectory: path.join(directory, 'cases'),
  };
}

export function loadFixturePages(root = process.cwd()) {
  const pages = readJson(evalPaths(root).fixtureFile);
  if (!Array.isArray(pages)) throw new Error('Eval source-pages fixture must be an array');
  return pages.map(page => ({...page}));
}

export function loadEvalCases(root = process.cwd()) {
  const {casesDirectory} = evalPaths(root);
  return fs.readdirSync(casesDirectory)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => readJson(path.join(casesDirectory, name)));
}

export function materializeFixtureSource(sourceRoot, pages = loadFixturePages()) {
  for (const page of pages) {
    if (!page || typeof page.path !== 'string' || typeof page.title !== 'string' || typeof page.body !== 'string') throw new Error('Invalid source page fixture');
    const relative = page.path.replaceAll('\\', '/');
    if (relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`Unsafe fixture page path: ${page.path}`);
    const target = path.resolve(sourceRoot, relative);
    const resolvedRoot = path.resolve(sourceRoot);
    if (!target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`Fixture page escapes source root: ${page.path}`);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, `---\ntitle: ${page.title}\nstatus: evergreen\n---\n\n${page.body}\n`, 'utf8');
  }
  return sourceRoot;
}

export function fixtureHashes(root = process.cwd()) {
  const pages = loadFixturePages(root);
  const cases = loadEvalCases(root);
  return {
    source_pages: sha256(canonicalJson(pages)),
    case_set: sha256(canonicalJson(cases)),
    fixture_set: sha256(canonicalJson({pages, cases})),
  };
}

export function evaluateCase(caseDefinition, returnedPages) {
  const expected = [...new Set(caseDefinition.expected_pages ?? [])].sort();
  const forbidden = [...new Set(caseDefinition.forbidden_pages ?? [])].sort();
  const returned = [...new Set(returnedPages ?? [])].sort();
  const expectedSet = new Set(expected);
  const forbiddenSet = new Set(forbidden);
  const relevantReturned = returned.filter(page => expectedSet.has(page));
  const unexpected = returned.filter(page => !expectedSet.has(page));
  const forbiddenHits = returned.filter(page => forbiddenSet.has(page));
  const missing = expected.filter(page => !returned.includes(page));
  const exceedsBudget = returned.length > caseDefinition.max_pointers;
  return {
    case_id: caseDefinition.case_id,
    expected_pages: expected,
    returned_pages: returned,
    forbidden_pages: forbidden,
    relevant_returned_pages: relevantReturned,
    unexpected_pages: unexpected,
    missing_pages: missing,
    forbidden_hits: forbiddenHits,
    exceeds_pointer_budget: exceedsBudget,
    passed: missing.length === 0 && forbiddenHits.length === 0 && !exceedsBudget && (expected.length > 0 || returned.length === 0),
  };
}

export function aggregateEvaluation(results) {
  const all = [...results];
  const relevant = all.filter(result => result.expected_pages.length > 0);
  const irrelevant = all.filter(result => result.expected_pages.length === 0);
  const totalExpected = relevant.reduce((total, result) => total + result.expected_pages.length, 0);
  const totalRelevantReturned = relevant.reduce((total, result) => total + result.relevant_returned_pages.length, 0);
  const totalReturnedForRelevant = relevant.reduce((total, result) => total + result.returned_pages.length, 0);
  const irrelevantActivated = irrelevant.filter(result => result.returned_pages.length > 0).length;
  const forbiddenReads = all.reduce((total, result) => total + result.forbidden_hits.length, 0);
  return {
    cases: all.length,
    passed_cases: all.filter(result => result.passed).length,
    failed_cases: all.filter(result => !result.passed).length,
    precision_at_k: totalReturnedForRelevant === 0 ? 0 : totalRelevantReturned / totalReturnedForRelevant,
    recall_at_k: totalExpected === 0 ? 1 : totalRelevantReturned / totalExpected,
    irrelevant_activation_rate: irrelevant.length === 0 ? 0 : irrelevantActivated / irrelevant.length,
    forbidden_read_rate: all.length === 0 ? 0 : forbiddenReads / all.length,
    pointer_budget_violations: all.filter(result => result.exceeds_pointer_budget).length,
  };
}

export function fixtureSourceProfile(sourceRoot, overrides = {}) {
  return {
    source_id: 'eval-mywiki',
    root: sourceRoot,
    formal_prefix: 'wiki',
    user_id: 'eval-user',
    read_enabled: true,
    write_enabled: false,
    activation_excluded_paths: ['wiki/private-finance.md'],
    ...overrides,
  };
}
