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
    dryRun: false,
    replace: false,
    confirmed: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--runtime-root') options.runtimeRoot = absolute(argv[++index], '--runtime-root');
    else if (arg === '--marketplace-root') options.marketplaceRoot = absolute(argv[++index], '--marketplace-root');
    else if (arg === '--codex-command') options.codexCommand = absolute(argv[++index], '--codex-command');
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--replace') options.replace = true;
    else if (arg === '--confirm') options.confirmed = argv[++index] === 'true';
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('Usage: node native/install-codex-plugin.mjs --confirm true [--runtime-root ABS] [--marketplace-root ABS] [--replace] [--dry-run]\n');
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
function managedMarketplace(runtimeRoot) {
  return {
    name: 'trace-runtime-local', interface: {displayName: 'Trace Runtime'}, plugins: [{
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
function runCodex(command, args) {
  const result = spawnSync(command, args, {encoding: 'utf8', shell: false});
  if (result.error) throw new Error(`Could not launch Codex CLI: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Codex command failed (${args.join(' ')}): ${(result.stderr || result.stdout || '').trim().slice(0, 1200)}`);
  return (result.stdout || '').trim();
}
function marketplaceIsRegistered(command) {
  const result = spawnSync(command, ['plugin', 'marketplace', 'list', '--json'], {encoding: 'utf8', shell: false});
  if (result.error || result.status !== 0) return false;
  try {
    const value = JSON.parse(result.stdout);
    return Array.isArray(value.marketplaces) && value.marketplaces.some(item => item?.name === 'trace-runtime-local');
  } catch { return false; }
}
function removeManagedPluginIfPresent(command) {
  // `--replace` is an explicit request to refresh this exact managed plugin.
  // A missing prior plugin is harmless; any other unexpected command failure
  // is retained in the receipt rather than being treated as success.
  const result = spawnSync(command, ['plugin', 'remove', 'trace-codex@trace-runtime-local', '--json'], {encoding: 'utf8', shell: false});
  if (result.error) throw new Error(`Could not launch Codex CLI: ${result.error.message}`);
  return {removed: result.status === 0, output: (result.stdout || result.stderr || '').trim()};
}
function install(options) {
  const runtimeRoot = absolute(options.runtimeRoot, '--runtime-root');
  const marketplaceRoot = absolute(options.marketplaceRoot, '--marketplace-root');
  noSymlink(runtimeRoot); noSymlink(path.dirname(marketplaceRoot));
  const {plugin} = pluginFiles(runtimeRoot);
  const plan = {
    status: 'planned', runtime_root: runtimeRoot, marketplace_root: marketplaceRoot, plugin: 'trace-codex', marketplace: 'trace-runtime-local',
    automatic_upgrade: false,
    will_do: ['copy the versioned Trace plugin to a managed local marketplace', 'register that marketplace with Codex', 'install trace-codex from it'],
    will_not_do: ['rewrite any Trace project', 'migrate project profiles', 'enable Trace hooks', 'update an existing plugin without --replace'],
  };
  if (options.dryRun) return {...plan, dry_run: true};
  if (!options.confirmed) throw new Error('USER_CONFIRMATION_REQUIRED: pass --confirm true after reviewing --dry-run');
  if (fs.existsSync(marketplaceRoot) && !options.replace) throw new Error(`Managed Trace marketplace already exists: ${marketplaceRoot}. Inspect it first; use --replace only to stage a new plugin copy.`);
  const staging = `${marketplaceRoot}.staging-${process.pid}`;
  const backup = fs.existsSync(marketplaceRoot) ? `${marketplaceRoot}.previous-${Date.now()}` : null;
  if (fs.existsSync(staging) || (backup && fs.existsSync(backup))) throw new Error('Marketplace staging/backup path already exists');
  try {
    fs.mkdirSync(staging, {recursive: true});
    writeManagedPlugin(plugin, staging, runtimeRoot);
    fs.writeFileSync(path.join(staging, 'marketplace.json'), JSON.stringify(managedMarketplace(runtimeRoot), null, 2) + '\n', {encoding: 'utf8', flag: 'wx'});
    if (backup) fs.renameSync(marketplaceRoot, backup);
    fs.renameSync(staging, marketplaceRoot);
    const registered = marketplaceIsRegistered(options.codexCommand);
    const marketplaceOutput = registered ? 'already registered' : runCodex(options.codexCommand, ['plugin', 'marketplace', 'add', marketplaceRoot]);
    const removed = backup ? removeManagedPluginIfPresent(options.codexCommand) : {removed: false, output: 'not requested'};
    const pluginOutput = runCodex(options.codexCommand, ['plugin', 'add', 'trace-codex@trace-runtime-local', '--json']);
    return {...plan, status: 'installed', backup_marketplace: backup, codex: {marketplace: marketplaceOutput, removed, plugin: pluginOutput}};
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, {recursive: true, force: true});
    if (backup && fs.existsSync(backup) && !fs.existsSync(marketplaceRoot)) fs.renameSync(backup, marketplaceRoot);
    throw error;
  }
}

try { process.stdout.write(JSON.stringify(install(parse(process.argv.slice(2)))) + '\n'); }
catch (error) { process.stderr.write(JSON.stringify({status: 'failed', error: error instanceof Error ? error.message : String(error)}) + '\n'); process.exitCode = 1; }
