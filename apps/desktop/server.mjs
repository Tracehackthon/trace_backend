import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProductWorkspace } from '../../packages/product/workspace/src/workspace.mjs'
import { createAgentBackend } from '../agent/backend.mjs'
import { createZhihuBackend } from '../agent/zhihu.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(root, '../..')
const defaultStateRoot = path.resolve(root, '../../..')
const productModuleRoot = path.join(repositoryRoot, 'packages/product/workspace/src')
const productBrowserAssets = new Set(['index.mjs', 'bridge.mjs', 'commands.mjs', 'demo-workspace.mjs', 'chain-model.mjs', 'comparison-model.mjs', 'worksite-model.mjs'])
const productWorkspace = createProductWorkspace({ file: path.resolve(process.env.TRACE_WEB_STATE_FILE || path.join(defaultStateRoot, '.trace/state/web.sqlite')) })
// Four explicit Web API domains: product state, public source search, Zhihu
// account connection, and Agent runs. The Zhihu middleware owns `/api/search/*`
// and `/api/zhihu/*`; the Agent receives its provider in-process only.
const zhihu = createZhihuBackend()
const agent = createAgentBackend({ productWorkspace, retrievalProvider: zhihu.provider })
const requestedPort = Number(process.env.TRACE_DESKTOP_PORT ?? '4173')
const port = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 4173
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

server.listen(port, '127.0.0.1', () => {
  console.log(`Trace Web: http://127.0.0.1:${port}/`)
  console.log(`Local Web data: ${productWorkspace.file}`)
  console.log('Product writes: command protocol v1; legacy snapshot/reset writes disabled')
})

let closing = false
async function close() {
  if (closing) return
  closing = true
  const stopped = new Promise(resolve => server.close(resolve))
  try { await agent.close() } finally { zhihu.close() }
  await stopped
  productWorkspace.close()
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, close)
