import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {requireText as text} from '../../../core/protocol/src/index.js';

export const CODEX_HOOK_INSTALLER_ID = 'trace.codex-hooks-installer' as const;
export const CODEX_HOOK_INSTALLER_VERSION = '0.2.0' as const;
export const TRACE_HOOK_MARKER = 'trace.codex-managed.v1' as const;
export const DEFAULT_TRACE_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse'] as const;

export interface CodexHooksConfig {hooks?: Record<string, unknown[]>; [key: string]: unknown;}
export interface CodexHookPreview {hooks_file: string; before_hash: string; after_hash: string; managed_events: string[]; legacy_commands: string[]; unrelated_hooks_preserved: boolean;}
/**
 * v0.1 receipts predate native source-access observation. They remain
 * rollback-compatible because a receipt is evidence for restoring the old
 * hooks.json, rather than a declaration that the old hook set has new events.
 */
export type CodexHookReceiptVersion = '0.1.0' | '0.2.0';
export interface CodexHookReceipt {protocol_id: 'trace.codex-hook-install'; protocol_version: CodexHookReceiptVersion; status: 'installed' | 'rolled_back'; hooks_file: string; before_hash: string; after_hash: string; backup_file: string | null; managed_events: string[]; installed_at: string;}

function absolute(value: string, field: string): string { const result = path.resolve(text(value, field)); if (!path.isAbsolute(result)) throw new Error(`${field} must be absolute`); return result; }
function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function noSymlink(target: string): void { let cursor = target; while (true) { try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink is not allowed: ${target}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } const parent = path.dirname(cursor); if (parent === cursor) return; cursor = parent; } }
function load(file: string): {raw: string; value: CodexHooksConfig} { if (!fs.existsSync(file)) return {raw: '{}\n', value: {}}; noSymlink(file); const raw = fs.readFileSync(file, 'utf8'); let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error(`Codex hooks file is not valid JSON: ${file}`); } if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Codex hooks root must be an object'); return {raw, value: value as CodexHooksConfig}; }
function commandEntry(command: string, timeout: number, contextLimit: number, toolEvent = false): Record<string, unknown> {
  return {type: 'command', command, timeout, ...(toolEvent ? {} : {additionalContextLimit: contextLimit})};
}
function sessionManaged(command: string, timeout: number, contextLimit: number): Record<string, unknown> { return {hooks: [commandEntry(command, timeout, contextLimit)], matcher: 'startup|resume|clear|compact'}; }
function promptManaged(command: string, timeout: number, contextLimit: number): Record<string, unknown> { return {hooks: [commandEntry(command, timeout, contextLimit)]}; }
/** Match every local tool hook path; the Trace handler still no-ops unless its explicit source root is touched. */
function toolManaged(command: string, timeout: number, contextLimit: number): Record<string, unknown> { return {hooks: [commandEntry(command, timeout, contextLimit, true)], matcher: '*'}; }
function managedEntry(event: string, command: string, timeout: number, contextLimit: number): Record<string, unknown> {
  if (event === 'SessionStart') return sessionManaged(command, timeout, contextLimit);
  if (event === 'PreToolUse' || event === 'PostToolUse') return toolManaged(command, timeout, contextLimit);
  return promptManaged(command, timeout, contextLimit);
}
function isManaged(item: unknown): boolean { return Boolean(item && typeof item === 'object' && /codex\s+hook-stdio|trace\.codex-managed\.v1/i.test(JSON.stringify(item))); }
function containsLegacy(item: unknown): string | null { const raw = JSON.stringify(item); return /trace_hook\.py|trace-activation/i.test(raw) ? raw.slice(0, 500) : null; }
function configuredEvents(events: string[] | undefined): string[] { return events ?? [...DEFAULT_TRACE_HOOK_EVENTS]; }
function validateEvents(events: string[]): void { if (events.length === 0 || events.some(event => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(event))) throw new Error('events must contain valid hook event names'); }
function nextConfig(current: CodexHooksConfig, events: string[], command: string, timeout: number, contextLimit: number, legacy: string[]): CodexHooksConfig {
  const next: CodexHooksConfig = {...current, hooks: {...(current.hooks ?? {})}};
  for (const event of events) {
    const previous = Array.isArray(next.hooks![event]) ? next.hooks![event]! : [];
    for (const item of previous) { const found = containsLegacy(item); if (found !== null) legacy.push(found); }
    const retained = previous.filter(item => !isManaged(item) && !containsLegacy(item));
    next.hooks![event] = [...retained, managedEntry(event, command, timeout, contextLimit)];
  }
  return next;
}

export class CodexHookInstaller {
  readonly hooksFile: string;
  constructor(hooksFile?: string) { const home = process.env.CODEX_HOME ?? (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.codex') : undefined); this.hooksFile = absolute(hooksFile ?? (home ? path.join(home, 'hooks.json') : ''), 'hooks_file'); }
  preview(options: {command: string; events?: string[]; timeout?: number; context_limit?: number}): CodexHookPreview {
    const file = this.hooksFile;
    const current = load(file);
    const events = configuredEvents(options.events); validateEvents(events);
    const command = text(options.command, 'command', 4000);
    const timeout = Math.max(1, Math.min(120, Math.floor(options.timeout ?? 10)));
    const contextLimit = Math.max(100, Math.min(20_000, Math.floor(options.context_limit ?? 2500)));
    const legacy: string[] = [];
    const next = nextConfig(current.value, events, command, timeout, contextLimit, legacy);
    const after = JSON.stringify(next, null, 2) + '\n';
    return {hooks_file: file, before_hash: hash(current.raw), after_hash: hash(after), managed_events: events, legacy_commands: legacy, unrelated_hooks_preserved: true};
  }
  install(options: {command: string; backup_root: string; approval: string; events?: string[]; timeout?: number; context_limit?: number}): CodexHookReceipt {
    const preview = this.preview(options);
    if (text(options.approval, 'approval', 300) !== 'approve:codex-hooks') throw new Error('USER_CONFIRMATION_REQUIRED: approval must equal approve:codex-hooks');
    const current = load(this.hooksFile);
    if (hash(current.raw) !== preview.before_hash) throw new Error('STALE_HOOKS: hooks.json changed after preview');
    const home = path.dirname(this.hooksFile); noSymlink(home); fs.mkdirSync(home, {recursive: true});
    const backupRoot = absolute(options.backup_root, 'backup_root'); noSymlink(backupRoot); fs.mkdirSync(backupRoot, {recursive: true});
    const backup = path.join(backupRoot, `hooks-${Date.now()}.json`); fs.writeFileSync(backup, current.raw, {flag: 'wx'});
    const events = configuredEvents(options.events); validateEvents(events);
    const timeout = Math.max(1, Math.min(120, Math.floor(options.timeout ?? 10)));
    const contextLimit = Math.max(100, Math.min(20_000, Math.floor(options.context_limit ?? 2500)));
    const command = text(options.command, 'command', 4000);
    const next = nextConfig(current.value, events, command, timeout, contextLimit, []);
    const after = JSON.stringify(next, null, 2) + '\n';
    const staging = `${this.hooksFile}.trace-staging-${process.pid}`; fs.writeFileSync(staging, after, {flag: 'wx'});
    try { fs.renameSync(staging, this.hooksFile); } catch (error) { fs.rmSync(staging, {force: true}); throw error; }
    return {protocol_id: 'trace.codex-hook-install', protocol_version: '0.2.0', status: 'installed', hooks_file: this.hooksFile, before_hash: preview.before_hash, after_hash: hash(after), backup_file: backup, managed_events: events, installed_at: new Date().toISOString()};
  }
  rollback(receipt: CodexHookReceipt): CodexHookReceipt {
    if (receipt.protocol_id !== 'trace.codex-hook-install' || !['0.1.0', '0.2.0'].includes(receipt.protocol_version) || receipt.status !== 'installed' || !receipt.backup_file) throw new Error('Unsupported hook receipt');
    const backup = absolute(receipt.backup_file, 'backup_file'); noSymlink(backup); if (!fs.existsSync(backup)) throw new Error('Hook backup does not exist');
    const current = load(this.hooksFile); const restored = fs.readFileSync(backup, 'utf8'); const staging = `${this.hooksFile}.trace-rollback-${process.pid}`; fs.writeFileSync(staging, restored, {flag: 'wx'});
    try { fs.renameSync(staging, this.hooksFile); } catch (error) { fs.rmSync(staging, {force: true}); throw error; }
    return {...receipt, status: 'rolled_back', before_hash: hash(current.raw), after_hash: hash(restored), installed_at: new Date().toISOString()};
  }
}
