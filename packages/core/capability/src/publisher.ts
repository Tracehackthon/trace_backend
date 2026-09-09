import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ProtocolError, type RecordRef} from '../../protocol/src/index.js';
import {assertCapabilityCandidateRef} from '../../capability-candidate/src/index.js';
import {CapabilityManifest, CapabilityPreview, CapabilityReceipt, CapabilitySpec, validateCapabilityManifest, validateCapabilitySpec} from './contract.js';
import {validateSkillEntrypoint} from './content.js';

function hash(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function absolute(value: string, field: string): string { if (!path.isAbsolute(value)) throw new ProtocolError('INVALID_PATH', `${field} must be absolute`); return path.resolve(value); }
function read(file: string): Buffer | null { try { return fs.readFileSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
function inside(root: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new ProtocolError('INVALID_PATH', `Unsafe relative path: ${relative}`);
  const base = path.resolve(root); const target = path.resolve(base, relative);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new ProtocolError('INVALID_PATH', `Path escapes root: ${relative}`);
  return target;
}
function noSymlink(file: string): void {
  let cursor = file;
  while (true) {
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new ProtocolError('INVALID_PATH', `Symlinks are not allowed: ${file}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = path.dirname(cursor); if (parent === cursor) return; cursor = parent;
  }
}
function listFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const output: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, entry.name); noSymlink(file);
      if (entry.isDirectory()) visit(file); else if (entry.isFile()) output.push(path.relative(root, file).split(path.sep).join('/')); else throw new ProtocolError('INVALID_PATH', `Unsupported entry: ${file}`);
    }
  };
  visit(root); return output.sort();
}

export interface CapabilityPublisherOptions {
  /** Resolve the exact candidate revision recorded in provenance. */
  resolveCapabilityCandidate?: (ref: RecordRef) => unknown;
}

function assertAdoptedCapabilityCandidate(value: unknown, expected: RecordRef): void {
  try {
    assertCapabilityCandidateRef(value, expected);
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError('CAPABILITY_CANDIDATE_REQUIRED', 'Skill publication requires a valid resolved capability_candidate record');
  }
}

function requireCandidateGate(spec: CapabilitySpec, resolver: CapabilityPublisherOptions['resolveCapabilityCandidate']): void {
  if (spec.artifact_kind !== 'skill') return;
  const reference = spec.provenance.capability_candidate_ref;
  if (reference === undefined) throw new ProtocolError('CAPABILITY_CANDIDATE_REQUIRED', 'Skill publication requires provenance.capability_candidate_ref');
  if (resolver === undefined) throw new ProtocolError('CAPABILITY_CANDIDATE_REQUIRED', 'Skill publication requires a capability candidate resolver');
  assertAdoptedCapabilityCandidate(resolver(reference), reference);
}
function sourceFiles(spec: CapabilitySpec): {sources: Record<string, string>; files: Record<string, Buffer>} {
  const sources: Record<string, string> = {}; const files: Record<string, Buffer> = {};
  for (const item of spec.files) {
    const source = inside(spec.source_root, item.source); noSymlink(source);
    const content = read(source); if (!content) throw new ProtocolError('NOT_FOUND', `Missing source file: ${source}`);
    const target = item.target ?? item.source; sources[item.source] = hash(content); files[target] = content;
  }
  if (spec.artifact_kind === 'skill') {
    const entry = spec.files.find(item => item.source === 'SKILL.md' || item.target === 'SKILL.md');
    if (!entry) throw new ProtocolError('MISSING_REQUIRED_DATA', 'skill capabilities must publish SKILL.md');
    const content = read(inside(spec.source_root, entry.source));
    if (!content) throw new ProtocolError('NOT_FOUND', `Missing skill entrypoint: ${entry.source}`);
    validateSkillEntrypoint(content.toString('utf8'), spec.content_contract!);
  }
  return {sources, files};
}

export class CapabilityPublisher {
  constructor(readonly options: CapabilityPublisherOptions = {}) {}

  preview(raw: CapabilitySpec, candidateDir?: string): CapabilityPreview {
    const spec = validateCapabilitySpec(raw); requireCandidateGate(spec, this.options.resolveCapabilityCandidate); const {files} = sourceFiles(spec); const existing = new Set(listFiles(spec.target_root)); const desired = Object.keys(files);
    const additions = desired.filter(file => !existing.has(file)).sort();
    const updates = desired.filter(file => existing.has(file) && hash(read(inside(spec.target_root, file))!) !== hash(files[file]!)).sort();
    const unchanged = desired.filter(file => existing.has(file) && !updates.includes(file)).sort();
    const removals = [...existing].filter(file => !desired.includes(file)).sort();
    return {capability_id: spec.capability_id, version: spec.version, ...(candidateDir === undefined ? {} : {candidate_dir: absolute(candidateDir, 'candidate_dir')}), target_root: spec.target_root, additions, updates, unchanged, removals, warnings: removals.length ? ['目标目录存在未声明文件；发布不会自动删除，需补入 files 或人工清理'] : [], requires_confirmation: true};
  }

  stage(raw: CapabilitySpec, candidateDir: string): CapabilityManifest {
    const spec = validateCapabilitySpec(raw); requireCandidateGate(spec, this.options.resolveCapabilityCandidate); const candidate = absolute(candidateDir, 'candidate_dir');
    if (fs.existsSync(candidate)) throw new ProtocolError('TARGET_EXISTS', `Candidate already exists: ${candidate}`);
    const {sources, files} = sourceFiles(spec); const priorFiles = listFiles(spec.target_root); const installedBefore: Record<string, string | null> = {};
    for (const file of priorFiles) installedBefore[file] = hash(read(inside(spec.target_root, file))!);
    for (const file of Object.keys(files)) if (!(file in installedBefore)) installedBefore[file] = null;
    const manifest: CapabilityManifest = {protocol_id: 'trace.capability-publish', protocol_version: '0.2.0', capability_id: spec.capability_id, version: spec.version, display_name: spec.display_name, description: spec.description, artifact_kind: spec.artifact_kind, source_root: spec.source_root, target_root: spec.target_root, host_compatibility: spec.host_compatibility, runtime_compatibility: spec.runtime_compatibility, dependencies: spec.dependencies ?? [], provenance: spec.provenance, ...(spec.content_contract === undefined ? {} : {content_contract: spec.content_contract}), ...(spec.protocol_registry_ref === undefined ? {} : {protocol_registry_ref: spec.protocol_registry_ref}), sources, files: Object.fromEntries(Object.entries(files).map(([file, value]) => [file, hash(value)])), installed_before: installedBefore, staged_at: new Date().toISOString()};
    fs.mkdirSync(path.join(candidate, 'package'), {recursive: true});
    for (const [relative, content] of Object.entries(files)) { const file = inside(path.join(candidate, 'package'), relative); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, content, {flag: 'wx'}); }
    fs.writeFileSync(path.join(candidate, 'candidate.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
    return manifest;
  }

  validate(candidateDir: string): CapabilityManifest {
    const candidate = absolute(candidateDir, 'candidate_dir'); const manifestFile = path.join(candidate, 'candidate.json'); const manifest = validateCapabilityManifest(JSON.parse(fs.readFileSync(manifestFile, 'utf8'))); const specLike = manifest as unknown as CapabilitySpec; requireCandidateGate(specLike, this.options.resolveCapabilityCandidate);
    for (const [relative, expected] of Object.entries(manifest.sources)) { const file = inside(manifest.source_root, relative); const content = read(file); if (!content || hash(content) !== expected) throw new ProtocolError('SOURCE_CHANGED', `Source changed: ${relative}`); }
    const actual = listFiles(path.join(candidate, 'package')); const expected = Object.keys(manifest.files).sort(); if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new ProtocolError('CANDIDATE_CHANGED', 'Candidate file set changed');
    for (const relative of expected) { const content = read(inside(path.join(candidate, 'package'), relative)); if (!content || hash(content) !== manifest.files[relative]) throw new ProtocolError('CANDIDATE_CHANGED', `Candidate file changed: ${relative}`); }
    return manifest;
  }

  publish(candidateDir: string, approval: string, receiptPath: string): CapabilityReceipt {
    const candidate = absolute(candidateDir, 'candidate_dir'); const manifest = this.validate(candidate); if (!approval.trim()) throw new ProtocolError('USER_CONFIRMATION_REQUIRED', 'Capability publication requires explicit approval');
    const receiptFile = absolute(receiptPath, 'receipt_path'); if (receiptFile.startsWith(`${candidate}${path.sep}`)) throw new ProtocolError('INVALID_PATH', 'Receipt must be outside candidate directory');
    const target = absolute(manifest.target_root, 'target_root'); if (receiptFile === target || receiptFile.startsWith(`${target}${path.sep}`)) throw new ProtocolError('INVALID_PATH', 'Receipt must be outside target directory'); if (fs.existsSync(receiptFile)) throw new ProtocolError('RECEIPT_EXISTS', `Receipt already exists: ${receiptFile}`);
    const existing = listFiles(target); const desired = Object.keys(manifest.files).sort(); if (existing.some(file => !desired.includes(file))) throw new ProtocolError('TARGET_SHAPE_CHANGED', 'Target contains undeclared files; refusing implicit removal');
    for (const relative of desired) { const current = read(inside(target, relative)); const currentHash = current ? hash(current) : null; const before = manifest.installed_before[relative] ?? null; if (currentHash !== before && currentHash !== manifest.files[relative]) throw new ProtocolError('TARGET_CHANGED', `Target changed since stage: ${relative}`); }
    const entries: CapabilityReceipt['files'] = desired.map(relative => { const current = read(inside(target, relative)); return {path: inside(target, relative), before_sha256: current ? hash(current) : null, after_sha256: manifest.files[relative]!, before_base64: current ? current.toString('base64') : null}; });
    const now = new Date().toISOString(); const result: CapabilityReceipt = {protocol_id: 'trace.capability-publish', protocol_version: '0.2.0', status: 'prepared', approval: approval.trim(), candidate_manifest: path.join(candidate, 'candidate.json'), candidate_sha256: hash(fs.readFileSync(path.join(candidate, 'candidate.json'))), target_root: target, files: entries, created_at: now, updated_at: now};
    fs.mkdirSync(path.dirname(receiptFile), {recursive: true}); fs.writeFileSync(receiptFile, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
    try {
      for (const entry of entries) { const relative = path.relative(target, entry.path).split(path.sep).join('/'); const content = read(inside(path.join(candidate, 'package'), relative)); if (!content) throw new ProtocolError('NOT_FOUND', `Candidate file missing: ${relative}`); fs.mkdirSync(path.dirname(entry.path), {recursive: true}); fs.writeFileSync(entry.path, content); }
      for (const relative of desired) { const content = read(inside(target, relative)); if (!content || hash(content) !== manifest.files[relative]) throw new ProtocolError('PUBLISH_VERIFY_FAILED', `Published hash mismatch: ${relative}`); }
      result.status = 'published'; result.updated_at = new Date().toISOString(); fs.writeFileSync(receiptFile, JSON.stringify(result, null, 2) + '\n'); return result;
    } catch (error) { throw error; }
  }

  rollback(receiptPath: string): {restored_files: number; status: 'rolled_back'} {
    const file = absolute(receiptPath, 'receipt_path'); const receipt = JSON.parse(fs.readFileSync(file, 'utf8')) as CapabilityReceipt; if (receipt.protocol_id !== 'trace.capability-publish' || receipt.status !== 'published') throw new ProtocolError('INVALID_RECEIPT', 'Receipt is not a published capability receipt');
    for (const entry of receipt.files) { const current = read(entry.path); const currentHash = current ? hash(current) : null; if (currentHash !== entry.after_sha256 && currentHash !== entry.before_sha256) throw new ProtocolError('ROLLBACK_CONFLICT', `Target changed after publication: ${entry.path}`); }
    for (const entry of receipt.files) { if (entry.before_base64 === null) fs.rmSync(entry.path, {force: true}); else fs.writeFileSync(entry.path, Buffer.from(entry.before_base64, 'base64')); }
    const updated: CapabilityReceipt = {...receipt, status: 'rolled_back', updated_at: new Date().toISOString()}; fs.writeFileSync(file, JSON.stringify(updated, null, 2) + '\n'); return {restored_files: receipt.files.length, status: 'rolled_back'};
  }
}
