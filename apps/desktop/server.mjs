import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProductWorkspace } from '../../packages/product/workspace/src/workspace.mjs'
import { createAgentBackend } from '../agent/backend.mjs'
import { createZhihuBackend } from '../agent/zhihu.mjs'
import { normalizeDesktopPort } from './runtime-port.mjs'
import { buildDesktopServiceIdentity, loadRuntimeIdentity } from './runtime-identity.mjs'
import { resolveRuntimeRoot } from '../../runtime-identity.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(root, '../..')
const configuredRuntimeRoot = process.env.TRACE_RUNTIME_ROOT
if (configuredRuntimeRoot !== undefined && !path.isAbsolute(configuredRuntimeRoot)) throw new Error('TRACE_RUNTIME_ROOT must be an absolute runtime root')
const validatedRuntimeRoot = resolveRuntimeRoot(configuredRuntimeRoot ?? repositoryRoot, {explicit: configuredRuntimeRoot !== undefined}).root
// The desktop entrypoint is statically bound to the runtime beside this file.
// Refuse an explicit alternate checkout instead of reporting its identity while
// executing this process\'s modules and state adapters.
if (path.resolve(validatedRuntimeRoot).toLowerCase() !== path.resolve(repositoryRoot).toLowerCase()) throw new Error('TRACE_RUNTIME_ROOT does not match the desktop entrypoint runtime')
const defaultStateRoot = path.resolve(root, '../../..')
const productModuleRoot = path.join(repositoryRoot, 'packages/product/workspace/src')
const productBrowserAssets = new Set(['index.mjs', 'bridge.mjs', 'commands.mjs', 'demo-workspace.mjs', 'chain-model.mjs', 'comparison-model.mjs', 'worksite-model.mjs'])
const runtimeIdentity = loadRuntimeIdentity(root)
const identityEnv = {
  ...(process.env.TRACE_WORKSPACE_ID === undefined ? {} : {workspaceId: process.env.TRACE_WORKSPACE_ID}),
  ...(process.env.TRACE_INSTALLATION_ID === undefined ? {} : {installationId: process.env.TRACE_INSTALLATION_ID}),
  runtimeVersion: runtimeIdentity.runtime_version,
  allowLegacyIdentity: process.env.TRACE_ALLOW_LEGACY_IDENTITY === '1',
  upgradeLegacyIdentity: process.env.TRACE_UPGRADE_LEGACY_IDENTITY === '1',
}
const productWorkspace = createProductWorkspace({
  file: path.resolve(process.env.TRACE_WEB_STATE_FILE || path.join(defaultStateRoot, '.trace/state/web.sqlite')),
  ...identityEnv,
  // Set only by the packaged Electron host. It is never exposed to a renderer,
  // URL or command line and only unlocks the existing bounded snapshot parser.
  ...(process.env.TRACE_DESKTOP_SNAPSHOT_TOKEN ? { desktopSnapshotToken: process.env.TRACE_DESKTOP_SNAPSHOT_TOKEN } : {}),
})
// Four explicit Web API domains: product state, public source search, Zhihu
// account connection, and Agent runs. The Zhihu middleware owns `/api/search/*`
// and `/api/zhihu/*`; the Agent receives its provider in-process only.
const zhihu = createZhihuBackend()
const agent = createAgentBackend({ productWorkspace, retrievalProvider: zhihu.provider })
const desktopServiceIdentity = buildDesktopServiceIdentity({runtime: runtimeIdentity, productIdentity: productWorkspace.identity, agentEnabled: process.env.TRACE_AGENT_ENABLED === '1'})
// Port 0 asks the OS for an available ephemeral loopback port. The packaged
// desktop host uses this path and reads the selected port from `ready`.
const port = normalizeDesktopPort(process.env.TRACE_DESKTOP_PORT)
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf'],
  ['.json', 'application/json; charset=utf-8'],
])

function rejectIdentityRequest(request, response) {
  const address = request.socket.remoteAddress
  const host = request.headers.host
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
  if (!loopback || typeof host !== 'string' || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) {
    response.writeHead(403, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'})
    response.end(JSON.stringify({error: {code: 'LOCAL_ONLY', message: 'Trace identity handshake only accepts loopback hosts.'}}))
    return true
  }
  const expected = `${request.socket.encrypted ? 'https' : 'http'}://${host}`
  if (request.headers.origin !== undefined && request.headers.origin !== expected) {
    response.writeHead(403, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'})
    response.end(JSON.stringify({error: {code: 'ORIGIN_REQUIRED', message: 'Trace identity handshake must use the local same-origin endpoint.'}}))
    return true
  }
  const site = request.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    response.writeHead(403, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'})
    response.end(JSON.stringify({error: {code: 'CROSS_SITE_REQUEST', message: 'Trace identity handshake rejects cross-site requests.'}}))
    return true
  }
  return false
}

function resolveAsset(url = '/') {
  const pathname = decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname)
  if (pathname.startsWith('/runtime/product-workspace/')) {
    const moduleName = pathname.slice('/runtime/product-workspace/'.length)
    return productBrowserAssets.has(moduleName) ? path.join(productModuleRoot, moduleName) : null
  }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const absolute = path.resolve(root, relative)
  return absolute === root || absolute.startsWith(`${root}${path.sep}`) ? absolute : null
}

const server = http.createServer(async (request, response) => {
  try {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
  if (requestUrl.pathname === '/api/runtime/identity') {
    if (rejectIdentityRequest(request, response)) return
    if (request.method !== 'GET') {
      response.writeHead(405, {'content-type': 'application/json; charset=utf-8', allow: 'GET'})
      response.end(JSON.stringify({error: {code: 'METHOD_NOT_ALLOWED', message: '只支持 GET 身份握手。'}}))
      return
    }
    response.writeHead(200, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-trace-runtime-protocol': '1'})
    response.end(JSON.stringify(desktopServiceIdentity))
    return
  }
  if (await productWorkspace.handle(request, response)) return
  if (await zhihu.handle(request, response)) return
  if (await agent.handle(request, response)) return
  const asset = resolveAsset(request.url)
  const rootFile = asset && ['index.html','legacy.html','sw.js'].includes(path.basename(asset)) && path.dirname(asset) === root
  const allowedAsset = rootFile || (asset && (asset.startsWith(path.join(root,'src') + path.sep) || asset.startsWith(path.join(root,'public') + path.sep)
    || asset.startsWith(productModuleRoot + path.sep)))
  if (!allowedAsset || !fs.existsSync(asset) || !fs.statSync(asset).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }
  const stat = fs.statSync(asset)
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
  const headers = {
    'content-type': mimeTypes.get(path.extname(asset).toLowerCase()) ?? 'application/octet-stream',
    'etag': etag,
    // Entry documents and the worker must never be cached. Static assets are
    // stored but always revalidated: edits show up immediately, yet unchanged
    // files still cost only a 304 instead of a full re-download.
    'cache-control': rootFile ? 'no-store' : 'no-cache',
  }
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, { etag, 'cache-control': headers['cache-control'] })
    response.end()
    return
  }
  response.writeHead(200, headers)
  fs.createReadStream(asset).pipe(response)
  } catch (error) {
    console.error(error)
    if (!response.headersSent) response.writeHead(500, {'content-type':'text/plain; charset=utf-8'})
    response.end('Unable to serve this request')
  }
})

export const ready = new Promise((resolve, reject) => {
  const fail = error => reject(error)
  server.once('error', fail)
  server.listen(port, '127.0.0.1', () => {
    server.off('error', fail)
    const address = server.address()
    const listeningPort = address && typeof address === 'object' ? address.port : port
    console.log(`Trace Web: http://127.0.0.1:${listeningPort}/`)
    console.log(`Local Web data: ${productWorkspace.file}`)
    console.log('Product writes: command protocol v1; legacy snapshot/reset writes disabled')
    resolve({ port: listeningPort, file: productWorkspace.file })
  })
})

let closing = false
export async function close() {
  if (closing) return
  closing = true
  const stopped = new Promise(resolve => server.close(resolve))
  try { await agent.close() } finally { zhihu.close() }
  await stopped
  productWorkspace.close()
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, close)
