import { createReadStream, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join, normalize } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.mp4': 'video/mp4' }

createServer((request, response) => {
  const pathname = request.url === '/' ? 'index.html' : decodeURIComponent(request.url ?? '').replace(/^\//, '')
  const file = normalize(join(root, pathname))
  if (!file.startsWith(normalize(root)) || !existsSync(file)) {
    response.writeHead(404).end('Not found')
    return
  }
  response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(response)
}).listen(4174, '127.0.0.1', () => console.log('TRACE demo site: http://127.0.0.1:4174'))
