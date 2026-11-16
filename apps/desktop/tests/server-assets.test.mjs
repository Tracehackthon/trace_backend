import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawn} from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(here, '..')
const serverPath = path.join(appRoot, 'server.mjs')

function waitForReady(child, timeout = 15000) {
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`desktop server did not become ready: ${output}`))
    }, timeout)
    const onData = chunk => {
      output += String(chunk)
      const match = output.match(/Trace Web: http:\/\/127\.0\.0\.1:(\d+)\//)
      if (!match) return
      cleanup()
      resolve({port: Number(match[1]), output})
    }
    const onExit = (code, signal) => {
      cleanup()
      reject(new Error(`desktop server exited before ready (${code ?? signal}): ${output}`))
    }
    const cleanup = () => {
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onData)
      child.off('exit', onExit)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('exit', onExit)
  })
}

test('desktop server exposes the browser scope contract without widening static access', {timeout: 30000}, async t => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'trace-desktop-assets-'))
  const stateFile = path.join(tempRoot, 'web.sqlite')
  const child = spawn(process.execPath, [serverPath], {
    cwd: appRoot,
    env: {...process.env, TRACE_DESKTOP_PORT: '0', TRACE_WEB_STATE_FILE: stateFile},
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(async () => {
    if (!child.killed) child.kill('SIGTERM')
    await new Promise(resolve => child.once('exit', resolve))
    await rm(tempRoot, {recursive: true, force: true})
  })

  const {port} = await waitForReady(child)
  const base = `http://127.0.0.1:${port}`
  const scope = await fetch(`${base}/runtime/product-workspace/scope-contract.mjs`)
  assert.equal(scope.status, 200)
  assert.match(scope.headers.get('content-type') || '', /^text\/javascript/)
  assert.match(await scope.text(), /trace\.scope-contract/)

  // An adjacent Node-only module and encoded traversal remain unavailable:
  // the product browser surface is an explicit asset allowlist, not a folder.
  for (const url of [
    '/runtime/product-workspace/host-workflow.mjs',
    '/runtime/product-workspace/%2e%2e/host-workflow.mjs',
    '/runtime/product-workspace/../../../../package.json',
  ]) {
    const response = await fetch(`${base}${url}`)
    assert.equal(response.status, 404, url)
  }
})
