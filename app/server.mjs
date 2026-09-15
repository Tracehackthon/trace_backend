import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const requestedPort = Number(process.env.TRACE_DESKTOP_PORT ?? '4173')
const port = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 4173
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.json', 'application/json; charset=utf-8'],
])

function resolveAsset(url = '/') {
  const pathname = decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname)
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const absolute = path.resolve(root, relative)
  return absolute === root || absolute.startsWith(`${root}${path.sep}`) ? absolute : null
}

const server = http.createServer((request, response) => {
  const asset = resolveAsset(request.url)
  if (!asset || !fs.existsSync(asset) || !fs.statSync(asset).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }
  response.writeHead(200, {
    'content-type': mimeTypes.get(path.extname(asset).toLowerCase()) ?? 'application/octet-stream',
    'cache-control': 'no-store',
  })
  fs.createReadStream(asset).pipe(response)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Trace Desktop Agent: http://127.0.0.1:${port}/`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
