import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const MAX_ENTRIES = 10_000
const EVALUATION_PREFIX = /^trace-project-workflow-fidelity-\d{8}(?:-|\.json$)/

function requireDirectoryRoot(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute path`)
  }
  const resolved = path.resolve(value)
  const stat = fs.lstatSync(resolved)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new TypeError(`${label} must be a real directory, not a symlink`)
  }
  return resolved
}

function idFor(scope, relativePath) {
  return createHash('sha256').update(`${scope}\0${relativePath}`).digest('hex').slice(0, 20)
}

function slash(value) {
  return value.split(path.sep).join('/')
}

function databaseFamily(relativePath) {
  const normalized = slash(relativePath)
  const name = path.posix.basename(normalized)
  const base = name
    .replace(/\.owner$/i, '')
    .replace(/-(?:shm|wal)$/i, '')
  if (/\.(?:sqlite|db)$/i.test(base)) return `database:${path.posix.dirname(normalized)}/${base}`
  return undefined
}

function classifyProjectEntry(relativePath, type) {
  const normalized = slash(relativePath)
  const name = path.posix.basename(normalized)

  if (type === 'symlink') {
    return {lifecycle: 'review', category: 'symlink', reason: '符号链接不跟随；先核验目标与所有者。'}
  }
  if (normalized === 'project.json') {
    return {lifecycle: 'active', category: 'project-descriptor', reason: 'Trace 项目实例身份文件；保护。'}
  }
  if (normalized === 'state' && type === 'directory') {
    return {lifecycle: 'retained', category: 'database-state-container', reason: '项目本地状态容器；其中数据库及伴随文件不可作为普通文件清理。'}
  }

  const groupId = databaseFamily(normalized)
  if (groupId && (type === 'file' || type === 'other')) {
    return {lifecycle: 'retained', category: 'database-state', reason: '数据库及其 WAL/SHM/owner 属于同一受保护状态家族。', groupId}
  }
  if (normalized === 'project-adoptions' || normalized.startsWith('project-adoptions/')) {
    return {lifecycle: 'retained', category: 'adoption-history', reason: '项目能力采用历史；保留以支持来源核验与回滚。'}
  }
  if (normalized.includes('trace-project-workflow-fidelity-') && normalized.includes('candidate-eval-project')) {
    return {lifecycle: 'review', category: 'evaluation-fixture', reason: '评估项目夹具；需要保留其内部引用关系。'}
  }
  if (EVALUATION_PREFIX.test(name)) {
    return {lifecycle: 'review', category: 'evaluation-evidence', reason: '已识别为工作流评估证据；需核验任务引用后再讨论处置。'}
  }
  return {lifecycle: 'review', category: 'unknown', reason: '用途或引用未被受管清单证明；默认保留。'}
}

function makeEntry(scope, relativePath, type, bytes, classification) {
  const normalized = slash(relativePath)
  return {
    id: idFor(scope, normalized),
    scope,
    path: normalized,
    type,
    bytes,
    lifecycle: classification.lifecycle,
    category: classification.category,
    reason: classification.reason,
    ...(classification.groupId ? {groupId: classification.groupId} : {}),
    allowedActions: ['inspect'],
  }
}

/**
 * Read-only inventory of one explicitly selected project's `.trace` tree.
 * It lists paths and metadata only; it never reads file contents or writes.
 */
export function inspectProjectTrace(projectRoot, {maxEntries = MAX_ENTRIES} = {}) {
  const root = requireDirectoryRoot(projectRoot, 'projectRoot')
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_ENTRIES) {
    throw new TypeError(`maxEntries must be an integer from 1 to ${MAX_ENTRIES}`)
  }
  const traceRoot = path.join(root, '.trace')
  let traceStat
  try {
    traceStat = fs.lstatSync(traceRoot)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {scope: 'project-trace', projectState: 'missing', complete: true, entries: [], warnings: []}
    }
    throw error
  }
  if (traceStat.isSymbolicLink() || !traceStat.isDirectory()) {
    return {scope: 'project-trace', projectState: 'blocked', complete: false, entries: [], warnings: ['.trace 不是普通目录；未跟随或扫描。']}
  }

  let projectState = 'legacy-or-uninitialized'
  const descriptor = path.join(traceRoot, 'project.json')
  try {
    const descriptorStat = fs.lstatSync(descriptor)
    projectState = descriptorStat.isFile() && !descriptorStat.isSymbolicLink() ? 'initialized' : 'blocked'
  } catch (error) {
    if (error?.code !== 'ENOENT') projectState = 'blocked'
  }

  const entries = []
  const warnings = []
  let complete = projectState !== 'blocked'
  const pending = [{absolute: traceRoot, relative: ''}]
  while (pending.length > 0) {
    const current = pending.pop()
    let children
    try {
      children = fs.readdirSync(current.absolute, {withFileTypes: true})
    } catch (error) {
      complete = false
      warnings.push(`无法读取目录 ${slash(current.relative || '.trace')}: ${error.message}`)
      continue
    }
    children.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const child of children) {
      if (entries.length >= maxEntries) {
        complete = false
        warnings.push(`超过条目上限 ${maxEntries}；未扫描剩余路径。`)
        pending.length = 0
        break
      }
      const relative = current.relative ? path.join(current.relative, child.name) : child.name
      const absolute = path.join(current.absolute, child.name)
      let stat
      try {
        stat = fs.lstatSync(absolute)
      } catch (error) {
        complete = false
        warnings.push(`无法读取条目 ${slash(relative)}: ${error.message}`)
        continue
      }
      const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other'
      const classification = classifyProjectEntry(relative, type)
      entries.push(makeEntry('project-trace', relative, type, stat.isFile() ? stat.size : null, classification))
      if (type === 'directory') pending.push({absolute, relative})
    }
  }
  entries.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  return {scope: 'project-trace', projectState, complete, entries, warnings}
}

function safeActiveRuntimeName(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length === 0 || path.basename(value) !== value || value === '.' || value === '..') {
    throw new TypeError('activeRuntimeName must be a single directory name')
  }
  return value
}

/**
 * Read-only inventory of direct children in an explicitly selected managed
 * Runtime versions root. The active name must come from authoritative config;
 * semver ordering is never used to infer which installation is active.
 */
export function inspectManagedRuntimes(runtimeRoot, {activeRuntimeName} = {}) {
  const root = requireDirectoryRoot(runtimeRoot, 'runtimeRoot')
  const activeName = safeActiveRuntimeName(activeRuntimeName)
  const entries = []
  const warnings = []
  let children
  try {
    children = fs.readdirSync(root, {withFileTypes: true})
  } catch (error) {
    return {scope: 'managed-runtime', activeRuntimeName: activeName, complete: false, entries: [], warnings: [error.message]}
  }
  children.sort((left, right) => left.name.localeCompare(right.name, 'en'))
  for (const child of children) {
    const absolute = path.join(root, child.name)
    let stat
    try {
      stat = fs.lstatSync(absolute)
    } catch (error) {
      warnings.push(`无法读取条目 ${child.name}: ${error.message}`)
      continue
    }
    const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other'
    let classification
    if (type === 'symlink') {
      classification = {lifecycle: 'review', category: 'symlink', reason: '符号链接不跟随；先核验指向与占用。'}
    } else if (child.name === activeName) {
      classification = {lifecycle: 'active', category: 'active-runtime', reason: '由权威配置标记为当前 Runtime；保护。'}
    } else if (/\.previous-[^/\\]+$/i.test(child.name)) {
      classification = {lifecycle: 'review', category: 'runtime-backup', reason: 'Runtime 备份；须核验恢复链与任务引用。'}
    } else if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(child.name)) {
      classification = {lifecycle: 'review', category: 'inactive-runtime-version', reason: '非当前版本；尚未证明不被其他宿主/任务使用或可安全回滚。'}
    } else {
      classification = {lifecycle: 'review', category: 'unclassified-runtime-entry', reason: '受管根下的非版本条目；用途未核实。'}
    }
    entries.push(makeEntry('managed-runtime', child.name, type, stat.isFile() ? stat.size : null, classification))
  }
  return {scope: 'managed-runtime', activeRuntimeName: activeName, complete: warnings.length === 0, entries, warnings}
}
