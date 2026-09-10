import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {CreateDataRecord} from '../../../core/data/src/index.js';
import {requireText as text} from '../../../core/protocol/src/index.js';

export const MYWIKI_SOURCE_ID = 'trace.mywiki-formal-source' as const;
export const MYWIKI_SOURCE_VERSION = '0.1.0' as const;

export interface MyWikiSourceProfile {
  source_id: string;
  root: string;
  formal_prefix?: string;
  read_enabled?: boolean;
  write_enabled?: boolean;
  user_id: string;
  scope_type?: 'personal' | 'project' | 'team' | 'domain';
  source_mode?: 'local' | 'external' | 'team' | 'empty';
  /** Formal pages that may exist in a source but must never enter automatic activation. */
  activation_excluded_paths?: string[];
}

export interface MyWikiPage {
  source_id: string;
  relative_path: string;
  absolute_path: string;
  title: string;
  frontmatter: Record<string, string | string[]>;
  body: string;
  markdown: string;
  revision: number;
  content_hash: string;
  updated_at: string;
}

export interface MyWikiWriteProposal {
  proposal_id: string;
  source_id: string;
  relative_path: string;
  expected_revision: number;
  expected_hash: string;
  next_markdown: string;
  reason: string;
  requested_by: string;
  created_at: string;
}

export interface MyWikiWriteReceipt {
  proposal_id: string;
  status: 'applied';
  source_id: string;
  relative_path: string;
  previous_revision: number;
  next_revision: number;
  previous_hash: string;
  next_hash: string;
  backup_path: string;
  applied_at: string;
}

function sha(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
/** A content-derived CAS revision: independent of filesystem timestamp granularity. */
function contentRevision(contentHash: string): number {
  const value = Number.parseInt(contentHash.slice(0, 12), 16);
  return value === 0 ? 1 : value;
}
function inside(root: string, target: string): boolean { return target === root || target.startsWith(`${root}${path.sep}`); }
function safeRelative(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(part => part === '' || part === '.' || part === '..')) throw new Error(`Unsafe MyWiKi relative path: ${value}`);
  if (!normalized.toLowerCase().endsWith('.md')) throw new Error('MyWiKi formal page must be a Markdown file');
  return normalized;
}
function noSymlink(file: string): void {
  let cursor = file;
  while (true) {
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink is not allowed: ${file}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = path.dirname(cursor); if (parent === cursor) return; cursor = parent;
  }
}
function parseFrontmatter(markdown: string): {frontmatter: Record<string, string | string[]>; body: string} {
  const opening = /^---\r?\n/.exec(markdown); if (!opening) return {frontmatter: {}, body: markdown};
  const start = opening[0].length; const closing = /\r?\n---(?:\r?\n|$)/.exec(markdown.slice(start)); if (!closing || closing.index === undefined) return {frontmatter: {}, body: markdown};
  const end = start + closing.index;
  const frontmatter: Record<string, string | string[]> = {};
  let currentList: string[] | undefined;
  for (const line of markdown.slice(4, end).split(/\r?\n/)) {
    const list = /^\s*-\s+(.*)$/.exec(line);
    if (list && currentList) { currentList.push(list[1]!.trim()); continue; }
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) { currentList = undefined; continue; }
    const key = match[1]!.trim(); const value = match[2]!.trim();
    if (value === '') { currentList = []; frontmatter[key] = currentList; } else { currentList = undefined; frontmatter[key] = value.replace(/^['"]|['"]$/g, ''); }
  }
  return {frontmatter, body: markdown.slice(end + closing[0].length).replace(/^\r?\n/, '')};
}
function titleOf(frontmatter: Record<string, string | string[]>, relative: string): string { const value = frontmatter.title; return typeof value === 'string' && value.length > 0 ? value : path.basename(relative, '.md'); }
function searchTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const token of query.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []) {
    for (const part of token.split(/[_-]+/)) if (part.length >= 2) terms.add(part);
  }
  for (const run of query.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    const chars = [...run];
    for (let index = 0; index < chars.length - 1; index += 1) terms.add(chars.slice(index, index + 2).join(''));
  }
  return [...terms].slice(0, 32);
}
function relevance(query: string, text: string): number {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  if (haystack.includes(needle)) return 100_000 + needle.length;
  return searchTerms(query).reduce((score, term) => score + (haystack.includes(term) ? term.length : 0), 0);
}

export class MyWikiSourceProvider {
  readonly profile: Required<Pick<MyWikiSourceProfile, 'source_id' | 'root' | 'user_id' | 'read_enabled' | 'write_enabled' | 'activation_excluded_paths'>> & {formal_prefix: string};
  constructor(profile: MyWikiSourceProfile) {
    const root = path.resolve(text(profile.root, 'root', 2000));
    if (!path.isAbsolute(root)) throw new Error('root must be absolute');
    const excluded = profile.activation_excluded_paths ?? [];
    if (!Array.isArray(excluded) || excluded.length > 128) throw new Error('activation_excluded_paths must contain at most 128 formal page paths');
    const activationExcludedPaths = [...new Set(excluded.map(item => safeRelative(text(item, 'activation_excluded_paths item', 2000))))];
    this.profile = {source_id: text(profile.source_id, 'source_id', 240), root, user_id: text(profile.user_id, 'user_id', 240), formal_prefix: profile.formal_prefix ?? 'wiki', read_enabled: profile.read_enabled ?? true, write_enabled: profile.write_enabled ?? false, activation_excluded_paths: activationExcludedPaths};
  }
  private target(relative: string): {relative: string; absolute: string} {
    const safe = safeRelative(relative); const absolute = path.resolve(this.profile.root, safe);
    if (!inside(this.profile.root, absolute)) throw new Error('MyWiKi path escapes source root');
    noSymlink(absolute); return {relative: safe, absolute};
  }
  private assertFormal(relative: string): void { const prefix = `${this.profile.formal_prefix.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')}/`; if (!relative.startsWith(prefix)) throw new Error(`Only formal pages under ${prefix} may be changed`); }
  readPage(relative: string): MyWikiPage {
    if (!this.profile.read_enabled) throw new Error('MyWiKi source read is disabled');
    const target = this.target(relative); if (!fs.existsSync(target.absolute)) throw new Error(`MyWiKi page not found: ${target.relative}`); if (!fs.statSync(target.absolute).isFile()) throw new Error('MyWiKi target is not a file');
    const markdown = fs.readFileSync(target.absolute, 'utf8'); const parsed = parseFrontmatter(markdown); const stat = fs.statSync(target.absolute); const contentHash = sha(markdown);
    return {source_id: this.profile.source_id, relative_path: target.relative, absolute_path: target.absolute, title: titleOf(parsed.frontmatter, target.relative), frontmatter: parsed.frontmatter, body: parsed.body, markdown, revision: contentRevision(contentHash), content_hash: contentHash, updated_at: new Date(stat.mtimeMs).toISOString()};
  }
  search(query: string, limit = 20): MyWikiPage[] {
    const needle = text(query, 'query', 500); const max = Math.max(1, Math.min(100, Math.floor(limit))); const results: Array<{page: MyWikiPage; score: number}> = [];
    const prefix = this.profile.formal_prefix.replaceAll('\\', '/').replace(/^\/+|\/+$/g, ''); const base = path.join(this.profile.root, prefix); if (!fs.existsSync(base)) return [];
    const walk = (dir: string): void => { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) { const absolute = path.join(dir, entry.name); if (entry.isDirectory()) walk(absolute); else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) { const relative = path.relative(this.profile.root, absolute).replaceAll(path.sep, '/'); if (this.profile.activation_excluded_paths.includes(relative)) continue; const page = this.readPage(relative); const score = relevance(needle, `${page.title}\n${page.body}`); if (score > 0) results.push({page, score}); } } };
    walk(base);
    results.sort((left, right) => right.score - left.score || left.page.relative_path.localeCompare(right.page.relative_path));
    // A weak one-term overlap is not enough to silently activate a page. Keep
    // only results reasonably close to the strongest page; an exact query
    // match is an even stronger boundary. Interactive callers can refine a
    // query, while automatic activation must prefer precision over breadth.
    const strongest = results[0]?.score;
    if (strongest === undefined) return [];
    const threshold = strongest >= 100_000 ? 100_000 : Math.max(1, Math.ceil(strongest * 0.8));
    return results.filter(result => result.score >= threshold).slice(0, max).map(result => result.page);
  }
  buildSourceSnapshot(page: MyWikiPage, options: {run_id: string; classification?: CreateDataRecord['classification']; scope?: CreateDataRecord['scope']}): CreateDataRecord {
    const runId = text(options.run_id, 'run_id', 200); return {kind: 'source_snapshot', status: 'captured', schema_id: 'trace.source.snapshot', schema_version: '0.1.0', subject: {type: 'formal_page', id: `${this.profile.source_id}:${page.relative_path}`}, scope: options.scope ?? {type: 'personal', id: this.profile.user_id}, origin: {provider: 'mywiki', source_id: `${this.profile.source_id}:${page.relative_path}`, captured_at: new Date().toISOString(), content_hash: page.content_hash, locator: page.relative_path}, producer: {component: MYWIKI_SOURCE_ID, version: MYWIKI_SOURCE_VERSION, run_id: runId}, lineage: {parent_refs: [], source_refs: [], causation_id: `read:${page.relative_path}`, correlation_id: runId}, classification: options.classification ?? 'private', payload: {source_id: `${this.profile.source_id}:${page.relative_path}`, provider: 'mywiki', external_id: page.relative_path, title: page.title, content: page.body.slice(0, 100_000), captured_at: new Date().toISOString(), content_hash: page.content_hash, locator: page.relative_path, page_revision: page.revision, source_user_id: this.profile.user_id} };
  }
  proposeWrite(input: {relative_path: string; expected_revision: number; expected_hash: string; next_markdown: string; reason: string; requested_by: string}): MyWikiWriteProposal {
    if (!this.profile.write_enabled) throw new Error('MyWiKi source write is disabled'); const target = this.target(input.relative_path); this.assertFormal(target.relative); const reason = text(input.reason, 'reason', 2000); const requestedBy = text(input.requested_by, 'requested_by', 240); if (typeof input.next_markdown !== 'string' || input.next_markdown.length > 2_000_000) throw new Error('next_markdown must be text of at most 2MB');
    const page = this.readPage(target.relative); if (page.revision !== input.expected_revision || page.content_hash !== input.expected_hash) throw new Error('STALE_SOURCE: expected revision/hash does not match the current formal page');
    const proposalId = `proposal-${sha(`${this.profile.source_id}:${target.relative}:${input.expected_hash}:${sha(input.next_markdown)}`).slice(0, 24)}`;
    return {proposal_id: proposalId, source_id: this.profile.source_id, relative_path: target.relative, expected_revision: input.expected_revision, expected_hash: input.expected_hash, next_markdown: input.next_markdown, reason, requested_by: requestedBy, created_at: new Date().toISOString()};
  }
  applyWrite(proposal: MyWikiWriteProposal, approval: string, backupRoot: string): MyWikiWriteReceipt {
    if (!this.profile.write_enabled) throw new Error('MyWiKi source write is disabled'); if (text(approval, 'approval', 200) !== `approve:${proposal.proposal_id}`) throw new Error('USER_CONFIRMATION_REQUIRED: approval must equal approve:<proposal_id>');
    const target = this.target(proposal.relative_path); this.assertFormal(target.relative); const current = this.readPage(target.relative); if (current.revision !== proposal.expected_revision || current.content_hash !== proposal.expected_hash) throw new Error('STALE_SOURCE: formal page changed after proposal');
    const backupDir = path.resolve(text(backupRoot, 'backup_root', 2000)); const formalRoot = path.resolve(this.profile.root, this.profile.formal_prefix); if (inside(formalRoot, backupDir)) throw new Error('backup_root must be outside the formal wiki directory'); noSymlink(backupDir); fs.mkdirSync(backupDir, {recursive: true}); const backup = path.join(backupDir, `${proposal.proposal_id}.md`); fs.writeFileSync(backup, current.markdown, {flag: 'wx'});
    const staging = `${target.absolute}.trace-staging-${process.pid}`; fs.writeFileSync(staging, proposal.next_markdown, {flag: 'wx'}); try { fs.renameSync(staging, target.absolute); } catch (error) { fs.rmSync(staging, {force: true}); throw error; }
    const next = this.readPage(target.relative); return {proposal_id: proposal.proposal_id, status: 'applied', source_id: this.profile.source_id, relative_path: target.relative, previous_revision: current.revision, next_revision: next.revision, previous_hash: current.content_hash, next_hash: next.content_hash, backup_path: backup, applied_at: new Date().toISOString()};
  }
}
