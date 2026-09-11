/**
 * Explicit one-time bridge from a packaged Trace runtime to Codex's plugin
 * marketplace. It is deliberately separate from runtime installation: an
 * upgrade never edits a user's Codex configuration without this command.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const nativeRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultRuntimeRoot = path.resolve(nativeRoot, '..');
const codexHome = process.env.CODEX_HOME ?? (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.codex') : undefined);
const MARKETPLACE = 'trace-runtime-local';
const PLUGIN = 'trace-codex@trace-runtime-local';

class PluginInstallError extends Error {
  constructor(code, message, journal) { super(message); this.code = code; this.journal = journal; }
}
function absolute(value, field) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${field} must be an absolute path`);
  return path.resolve(value);
}
function noSymlink(value) {
  let cursor = path.resolve(value);
  while (true) {
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink is not allowed: ${value}`); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}
function copyTree(source, destination) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Plugin source contains a symlink: ${source}`);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, {recursive: true});
    for (const entry of fs.readdirSync(source)) copyTree(path.join(source, entry), path.join(destination, entry));
    return;
  }
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}
function parse(argv) {
  const options = {
    runtimeRoot: defaultRuntimeRoot,
    marketplaceRoot: codexHome ? path.join(codexHome, 'trace-marketplace') : undefined,
    codexCommand: process.env.TRACE_CODEX_COMMAND ?? 'codex',
    codexArgs: [],
    dryRun: false,
    replace: false,
    confirmed: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--runtime-root') options.runtimeRoot = absolute(argv[++index], '--runtime-root');
    else if (arg === '--marketplace-root') options.marketplaceRoot = absolute(argv[++index], '--marketplace-root');
    else if (arg === '--codex-command') options.codexCommand = absolute(argv[++index], '--codex-command');
    else if (arg === '--codex-arg') { const value = argv[++index]; if (!value || value.includes('\0')) throw new Error('--codex-arg requires a non-empty safe argument'); options.codexArgs.push(value); }
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--replace') options.replace = true;
    else if (arg === '--confirm') options.confirmed = argv[++index] === 'true';
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('Usage: node native/install-codex-plugin.mjs --confirm true [--runtime-root ABS] [--marketplace-root ABS] [--replace] [--dry-run] [--codex-command ABS --codex-arg ARG]\n');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.marketplaceRoot) throw new Error('CODEX_HOME or USERPROFILE is required, or pass --marketplace-root ABS');
  return options;
}
function pluginFiles(runtimeRoot) {
  const plugin = path.join(runtimeRoot, 'plugins', 'trace-codex');
  const entry = path.join(runtimeRoot, 'dist', 'apps', 'mcp', 'src', 'main.js');
  if (!fs.existsSync(path.join(plugin, '.codex-plugin', 'plugin.json'))) throw new Error(`Missing Trace Codex plugin: ${plugin}`);
  if (!fs.existsSync(entry)) throw new Error(`Missing built Trace MCP entry: ${entry}`);
  return {plugin};
}
function managedMarketplace() {
  return {
    name: MARKETPLACE, interface: {displayName: 'Trace Runtime'}, plugins: [{
      name: 'trace-codex', source: {source: 'local', path: './plugins/trace-codex'},
      policy: {installation: 'AVAILABLE', authentication: 'ON_INSTALL'}, category: 'Productivity',
    }],
  };
}
function writeManagedPlugin(source, staging, runtimeRoot) {
  const destination = path.join(staging, 'plugins', 'trace-codex');
  copyTree(source, destination);
  const mcpFile = path.join(destination, '.mcp.json');
  const mcp = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
  const trace = mcp?.mcpServers?.trace;
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) throw new Error('Trace plugin MCP configuration is invalid');
  trace.env = {...(trace.env && typeof trace.env === 'object' && !Array.isArray(trace.env) ? trace.env : {}), TRACE_RUNTIME_ROOT: runtimeRoot};
  fs.writeFileSync(mcpFile, JSON.stringify(mcp, null, 2) + '\n', {encoding: 'utf8', flag: 'w'});
}
function codexResult(command, args, prefix = []) {
  const result = spawnSync(command, [...prefix, ...args], {encoding: 'utf8', shell: false});
  if (result.error) return {ok: false, output: `Could not launch Codex CLI: ${result.error.message}`};
  return {ok: result.status === 0, output: (result.stdout || result.stderr || '').trim().slice(0, 1200)};
}
function runCodex(command, args, prefix = []) {
  const result = codexResult(command, args, prefix);
  if (!result.ok) throw new PluginInstallError('CODEX_COMMAND_FAILED', `Codex command failed (${args.join(' ')}): ${result.output}`);
  return result.output;
}
function marketplaceIsRegistered(command, prefix = []) {
  const result = codexResult(command, ['plugin', 'marketplace', 'list', '--json'], prefix);
  if (!result.ok) return false;
  try {
    const value = JSON.parse(result.output);
    return Array.isArray(value.marketplaces) && value.marketplaces.some(item => item?.name === MARKETPLACE);
  } catch { return false; }
}
function removeManagedPluginIfPresent(command, prefix = []) {
  const result = codexResult(command, ['plugin', 'remove', PLUGIN, '--json'], prefix);
  return {removed: result.ok, output: result.output};
}
function rollbackJournal(file, value) {
  try { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {encoding: 'utf8', flag: 'wx'}); return file; }
  catch { return undefined; }
}
function rollbackTransaction({options, marketplaceRoot, staging, backup, priorRegistered, registeredByThisRun, priorPluginRemoved, cause}) {
  const steps = [];
  const attempt = (name, operation) => {
    try { operation(); steps.push({name, status: 'ok'}); }
    catch (error) { steps.push({name, status: 'failed', error: error instanceof Error ? error.message : String(error)}); }
  };
  if (fs.existsSync(staging)) attempt('remove_staging', () => fs.rmSync(staging, {recursive: true, force: true}));
  // Registration belongs to a directory path. Remove a registration created by
  // this run before discarding the newly staged directory.
  let newRegistrationReleased = !registeredByThisRun || priorRegistered;
  if (registeredByThisRun && !priorRegistered) {
    const result = codexResult(options.codexCommand, ['plugin', 'marketplace', 'remove', MARKETPLACE, '--json'], options.codexArgs);
    if (result.ok) { newRegistrationReleased = true; steps.push({name: 'unregister_new_marketplace', status: 'ok'}); }
    else steps.push({name: 'unregister_new_marketplace', status: 'failed', error: result.output || 'Codex did not remove the Trace marketplace'});
  }
  if (backup && fs.existsSync(backup)) {
    // Never delete a directory while Codex still has a registration pointing at
    // it; preserving a usable staged directory is safer than a broken path.
    if (newRegistrationReleased && fs.existsSync(marketplaceRoot)) attempt('remove_new_marketplace_directory', () => fs.rmSync(marketplaceRoot, {recursive: true, force: true}));
    if (newRegistrationReleased && !fs.existsSync(marketplaceRoot)) attempt('restore_previous_marketplace_directory', () => fs.renameSync(backup, marketplaceRoot));
    // A successful refresh removes the old plugin before adding the new one.
    // If adding failed, restore the exact managed plugin only when it had been
    // registered before this transaction; otherwise preserve the prior absence.
    if (priorPluginRemoved && priorRegistered && fs.existsSync(marketplaceRoot)) attempt('restore_previous_managed_plugin', () => runCodex(options.codexCommand, ['plugin', 'add', PLUGIN, '--json'], options.codexArgs));
  } else {
    if (newRegistrationReleased && fs.existsSync(marketplaceRoot)) attempt('remove_new_marketplace_directory', () => fs.rmSync(marketplaceRoot, {recursive: true, force: true}));
  }
  const clean = newRegistrationReleased && steps.every(step => step.status === 'ok')
    && (!backup || fs.existsSync(marketplaceRoot))
    && (backup || !fs.existsSync(marketplaceRoot));
  const journal = `${marketplaceRoot}.install-failure-${Date.now()}.json`;
  const journalFile = rollbackJournal(journal, {
    journal_id: 'trace.codex-plugin-install-failure',
    created_at: new Date().toISOString(),
    cause: cause instanceof Error ? cause.message : String(cause),
    marketplace: MARKETPLACE,
    plugin: PLUGIN,
    rollback_clean: clean,
    steps,
  });
  return {clean, steps, journal: journalFile};
}
function install(options) {
  const runtimeRoot = absolute(options.runtimeRoot, '--runtime-root');
  const marketplaceRoot = absolute(options.marketplaceRoot, '--marketplace-root');
  noSymlink(runtimeRoot); noSymlink(path.dirname(marketplaceRoot));
  const {plugin} = pluginFiles(runtimeRoot);
  const plan = {
    status: 'planned', runtime_root: runtimeRoot, marketplace_root: marketplaceRoot, plugin: 'trace-codex', marketplace: MARKETPLACE,
    automatic_upgrade: false,
    will_do: ['copy the versioned Trace plugin to a managed local marketplace', 'register that marketplace with Codex', 'install trace-codex from it'],
    will_not_do: ['rewrite any Trace project', 'migrate project profiles', 'enable Trace hooks', 'update an existing plugin without --replace'],
  };
  if (options.dryRun) return {...plan, dry_run: true};
  if (!options.confirmed) throw new PluginInstallError('USER_CONFIRMATION_REQUIRED', 'pass --confirm true after reviewing --dry-run');
  if (fs.existsSync(marketplaceRoot) && !options.replace) throw new PluginInstallError('MARKETPLACE_EXISTS', `Managed Trace marketplace already exists: ${marketplaceRoot}. Inspect it first; use --replace only to stage a new plugin copy.`);
  const staging = `${marketplaceRoot}.staging-${process.pid}`;
  const backup = fs.existsSync(marketplaceRoot) ? `${marketplaceRoot}.previous-${Date.now()}` : null;
  if (fs.existsSync(staging) || (backup && fs.existsSync(backup))) throw new PluginInstallError('STAGING_EXISTS', 'Marketplace staging/backup path already exists');
  const priorRegistered = marketplaceIsRegistered(options.codexCommand, options.codexArgs);
  let registeredByThisRun = false;
  let priorPluginRemoved = false;
  try {
    fs.mkdirSync(staging, {recursive: true});
    writeManagedPlugin(plugin, staging, runtimeRoot);
    fs.writeFileSync(path.join(staging, 'marketplace.json'), JSON.stringify(managedMarketplace(), null, 2) + '\n', {encoding: 'utf8', flag: 'wx'});
    if (backup) fs.renameSync(marketplaceRoot, backup);
    fs.renameSync(staging, marketplaceRoot);
    const marketplaceOutput = priorRegistered ? 'already registered' : runCodex(options.codexCommand, ['plugin', 'marketplace', 'add', marketplaceRoot], options.codexArgs);
    registeredByThisRun = !priorRegistered;
    const removed = backup ? removeManagedPluginIfPresent(options.codexCommand, options.codexArgs) : {removed: false, output: 'not requested'};
    priorPluginRemoved = Boolean(backup && removed.removed);
    const pluginOutput = runCodex(options.codexCommand, ['plugin', 'add', PLUGIN, '--json'], options.codexArgs);
    return {...plan, status: 'installed', backup_marketplace: backup, codex: {marketplace: marketplaceOutput, removed, plugin: pluginOutput}};
  } catch (cause) {
    const rollback = rollbackTransaction({options, marketplaceRoot, staging, backup, priorRegistered, registeredByThisRun, priorPluginRemoved, cause});
    if (!rollback.clean) throw new PluginInstallError('PARTIAL_ROLLBACK_REQUIRED', 'Trace could not fully restore the prior Codex marketplace state. Inspect the rollback journal before retrying.', rollback.journal);
    throw new PluginInstallError(cause instanceof PluginInstallError ? cause.code : 'INSTALL_FAILED', cause instanceof Error ? cause.message : String(cause), rollback.journal);
  }
}

try { process.stdout.write(JSON.stringify(install(parse(process.argv.slice(2)))) + '\n'); }
catch (error) {
  const typed = error instanceof PluginInstallError ? error : undefined;
  process.stderr.write(JSON.stringify({status: 'failed', code: typed?.code ?? 'INSTALL_FAILED', error: error instanceof Error ? error.message : String(error), ...(typed?.journal === undefined ? {} : {journal: typed.journal})}) + '\n');
  process.exitCode = 1;
}
