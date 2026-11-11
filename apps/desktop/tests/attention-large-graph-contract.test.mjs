import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {renderEdgePaths} from '../src/attention/geometry.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const canvasSource = fs.readFileSync(path.join(here, '../src/attention/attention-canvas.mjs'), 'utf8')
const canvasCss = fs.readFileSync(path.join(here, '../src/attention/attention-canvas.css'), 'utf8')
const profileSource = fs.readFileSync(path.join(here, '../../../artifacts/p2/attention-large-graph-profile.mjs'), 'utf8')

class FakePath {
  constructor(group) {
    this.group = group
    this.dataset = {}
    this.attributes = new Map()
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)) }

  remove() {
    this.group.children = this.group.children.filter(item => item !== this)
  }
}

class FakeGroup {
  constructor() {
    this.children = []
    this.queryCount = 0
    this.ownerDocument = {createElementNS: () => new FakePath(this)}
  }

  append(path) { this.children.push(path) }

  querySelectorAll(selector) {
    assert.equal(selector, '[data-edge-id]')
    this.queryCount += 1
    return this.children.filter(path => path.dataset.edgeId)
  }
}

test('edge DOM diff uses one indexed lookup per frame and preserves path identity', () => {
  const group = new FakeGroup()
  renderEdgePaths(group, [
    {id: 'edge-a', d: 'M0,0L1,1', frameId: 1},
    {id: 'edge-b', d: 'M1,1L2,2', frameId: 1},
  ])
  assert.equal(group.queryCount, 1)
  const edgeA = group.children.find(path => path.dataset.edgeId === 'edge-a')
  const edgeB = group.children.find(path => path.dataset.edgeId === 'edge-b')
  assert.ok(edgeA)
  assert.ok(edgeB)

  renderEdgePaths(group, [{id: 'edge-b', d: 'M3,3L4,4', frameId: 2}])
  assert.equal(group.queryCount, 2)
  assert.equal(group.children.length, 1)
  assert.equal(group.children[0], edgeB)
  assert.equal(group.children[0].attributes.get('d'), 'M3,3L4,4')
  assert.equal(edgeA.group, group)
})

test('large-graph contract keeps accessible DOM and avoids idle graph snapshots', () => {
  assert.match(canvasSource, /CAMERA_ONLY_RENDER_EVENTS/)
  assert.match(canvasSource, /worldDirty: !cameraOnly/)
  assert.match(canvasSource, /if \(!listeners\.size && typeof options\.onStateChange !== 'function'\) return/)
  assert.match(canvasCss, /content-visibility:\s*auto/)
  assert.match(canvasCss, /contain-intrinsic-size:\s*112px 220px/)
})

test('profiling harness covers dynamic Chromium and all required graph sizes', () => {
  assert.match(profileSource, /TRACE_DESKTOP_PORT: '0'/)
  assert.match(profileSource, /remote-debugging-port=/)
  assert.match(profileSource, /for \(const count of \[100, 500, 1000\]\)/)
  for (const metric of ['projection', 'firstRenderMs', 'panMs', 'zoomMs', 'dragMs', 'updateMs']) assert.match(profileSource, new RegExp(metric))
})
