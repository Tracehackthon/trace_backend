import test from 'node:test'
import assert from 'node:assert/strict'

import {mountAttentionCanvas} from '../src/attention/attention-canvas.mjs'
import {mountAttentionReader} from '../src/attention/attention-reader.mjs'

// The desktop runtime uses a browser DOM, but the live-update invariants are
// small enough to exercise in Node without adding a test-only DOM dependency.
// This deliberately models only the DOM surface used by the two adapters.
class FakeElement {
  constructor(document, tag = 'div') {
    this.ownerDocument = document
    this.tagName = tag.toUpperCase()
    this.nodeName = this.tagName
    this.nodeType = 1
    this.children = []
    this.parentNode = null
    this.parentElement = null
    this.attributes = new Map()
    this.listeners = new Map()
    this.style = {
      setProperty: (key, value) => { this.style[key] = value },
      removeProperty: key => { delete this.style[key] },
    }
    this.dataset = {}
    this.className = ''
    this.classList = {
      add: (...names) => { this.className = [...new Set(`${this.className} ${names.join(' ')}`.trim().split(/\s+/).filter(Boolean))].join(' ') },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => name && !names.includes(name)).join(' ') },
      toggle: (name, force) => { if (force === undefined ? !this.classList.contains(name) : force) this.classList.add(name); else this.classList.remove(name) },
      contains: name => this.className.split(/\s+/).includes(name),
    }
    this.textContent = ''
    this.value = ''
    this.hidden = false
    this.tabIndex = -1
    this.clientWidth = 1000
    this.clientHeight = 600
    this.innerHTML = ''
  }
  append(...children) { for (const child of children) { if (!child) continue; this.children.push(child); child.parentNode = this; child.parentElement = this } }
  appendChild(child) { this.append(child); return child }
  replaceChildren(...children) { for (const child of this.children) { child.parentNode = null; child.parentElement = null }; this.children = []; this.append(...children) }
  remove() { const index = this.parentNode?.children.indexOf(this) ?? -1; if (index >= 0) this.parentNode.children.splice(index, 1); this.parentNode = null; this.parentElement = null }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'class') this.className = String(value); if (name === 'id') this.id = String(value); if (name === 'tabindex') this.tabIndex = Number(value) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  hasAttribute(name) { return this.attributes.has(name) }
  removeAttribute(name) { this.attributes.delete(name) }
  toggleAttribute(name, force) { const enabled = force === undefined ? !this.attributes.has(name) : force; if (enabled) this.attributes.set(name, ''); else this.attributes.delete(name); return enabled }
  addEventListener(type, listener, options) { const list = this.listeners.get(type) || []; list.push({listener, options}); this.listeners.set(type, list) }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.listener !== listener)) }
  dispatchEvent(event) { if (!event.target) event.target = this; for (const item of this.listeners.get(event.type) || []) item.listener.call(this, event); return true }
  focus() { this.ownerDocument.activeElement = this }
  contains(element) { let current = element; while (current) { if (current === this) return true; current = current.parentNode }; return false }
  closest(selector) { let current = this; while (current) { if (current.matches(selector)) return current; current = current.parentElement }; return null }
  matches(selector) {
    if (selector === '[data-canvas-node]') return this.hasAttribute('data-canvas-node')
    if (selector === '[role="button"]') return this.getAttribute('role') === 'button'
    if (selector === '[data-attention-reader]') return this.hasAttribute('data-attention-reader')
    if (selector === '[data-reader-user-draft]') return this.hasAttribute('data-reader-user-draft')
    const classMatch = selector.match(/^\.([\w-]+)$/)
    return classMatch ? this.classList.contains(classMatch[1]) : false
  }
  querySelectorAll(selector) { const result = []; const walk = parent => { for (const child of parent.children) { if (matchesSelector(child, selector)) result.push(child); walk(child) } }; walk(this); return result }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
  getBoundingClientRect() { return {left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600} }
  setPointerCapture() {}
  releasePointerCapture() {}
  requestSubmit() {}
  set innerHTML(value) { this._innerHTML = String(value ?? ''); this.children = [] }
  get innerHTML() { return this._innerHTML }
}

function matchesSelector(element, selector) {
  const data = selector.match(/^\[([^=\]]+)(?:="?([^\]"]+)"?)?\]$/)
  if (data) return element.hasAttribute(data[1]) && (!data[2] || element.getAttribute(data[1]) === data[2])
  const tag = selector.match(/^[a-z]+$/i)
  if (tag) return element.tagName.toLowerCase() === tag[0].toLowerCase()
  return element.matches(selector)
}

class FakeDocument {
  constructor() {
    this.activeElement = null
    this.listeners = new Map()
    this.defaultView = {
      getComputedStyle: () => ({display: 'block', visibility: 'visible'}),
      requestAnimationFrame: callback => setTimeout(() => callback(globalThis.performance.now()), 0),
    }
    this.documentElement = new FakeElement(this, 'html')
    this.body = new FakeElement(this, 'body')
  }
  createElement(tag) { return new FakeElement(this, tag) }
  createElementNS(_namespace, tag) { return new FakeElement(this, tag) }
  addEventListener(type, listener, options) { const list = this.listeners.get(type) || []; list.push({listener, options}); this.listeners.set(type, list) }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.listener !== listener)) }
  querySelector(selector) { return this.body.querySelector(selector) }
  getSelection() { return null }
  createRange() { return null }
}

function mountRoot(document) {
  const parent = document.createElement('div')
  const root = document.createElement('div')
  parent.append(root)
  document.body.append(parent)
  return {parent, root}
}

test('same-root canvas update refreshes DOM while preserving layout/camera/focus', () => {
  const document = new FakeDocument()
  const {root} = mountRoot(document)
  const canvas = mountAttentionCanvas({
    root,
    reducedMotion: true,
    nodes: [{id: 'matter:one', objectId: 'matter:one', title: '旧标题', summary: '旧摘要', x: 10, y: 20}],
    edges: [],
  })
  canvas.focusNode('matter:one', 'test')
  const beforeCamera = canvas.getCamera()
  canvas.update({
    nodes: [{id: 'matter:one', objectId: 'matter:one', title: '新标题', summary: '新摘要', x: 900, y: 800}],
    edges: [],
  })

  const node = root.querySelector('[data-canvas-node]')
  assert.equal(node.querySelector('[data-canvas-node-title]').textContent, '新标题')
  assert.equal(node.querySelector('[data-canvas-node-summary]').textContent, '新摘要')
  assert.equal(canvas.getState().focus.nodeId, 'matter:one')
  assert.equal(canvas.getState().nodes[0].x, 10)
  assert.equal(canvas.getState().nodes[0].y, 20)
  assert.deepEqual(canvas.getCamera(), beforeCamera)
})

test('same-root canvas update clears removed focus and drag state instead of leaving stale DOM state', () => {
  const document = new FakeDocument()
  const {root} = mountRoot(document)
  const canvas = mountAttentionCanvas({
    root,
    reducedMotion: true,
    nodes: [{id: 'matter:one', title: '事项', x: 10, y: 20}],
    edges: [],
  })
  canvas.focusNode('matter:one', 'test')
  canvas.update({nodes: [], edges: []})

  assert.equal(canvas.getState().focus, null)
  assert.equal(canvas.getState().sidebar.open, false)
  assert.equal(root.dataset.canvasFocusId, '')
  assert.equal(root.querySelector('[data-canvas-node]'), null)
})

test('same-root canvas update keeps an active drag alive and commits its latest point', () => {
  const document = new FakeDocument()
  const {root} = mountRoot(document)
  const commits = []
  const canvas = mountAttentionCanvas({
    root,
    reducedMotion: true,
    nodes: [{id: 'matter:one', title: '旧事项', x: 10, y: 20}],
    edges: [],
    onLayoutCommit: info => commits.push(info),
  })
  const node = root.querySelector('[data-canvas-node]')
  node.dispatchEvent({type: 'pointerdown', button: 0, pointerId: 7, pointerType: 'mouse', clientX: 100, clientY: 100, stopPropagation() {}})
  node.dispatchEvent({type: 'pointermove', button: 0, pointerId: 7, pointerType: 'mouse', clientX: 160, clientY: 140, stopPropagation() {}})
  canvas.update({nodes: [{id: 'matter:one', title: '更新事项', x: 900, y: 800}], edges: []})
  assert.equal(canvas.getState().drag.nodeId, 'matter:one')
  node.dispatchEvent({type: 'pointerup', button: 0, pointerId: 7, pointerType: 'mouse', clientX: 160, clientY: 140, stopPropagation() {}})
  assert.equal(commits.length, 1)
  assert.notDeepEqual(commits[0].next, commits[0].previous)
  assert.equal(canvas.getState().drag, null)
})

test('same-root reader update keeps local draft/tab/candidate expansion but replaces stale content', () => {
  const document = new FakeDocument()
  const {root} = mountRoot(document)
  const reader = mountAttentionReader({
    root,
    document,
    state: {
      open: true,
      source: {id: 'source:one', fullText: '旧原文'},
      user: {text: '旧理解'},
      userDraft: '正在编辑的草稿',
      activeTab: 'agent',
      agent: {status: 'ready', output: '旧候选', expanded: true},
    },
  })

  reader.update({
    open: true,
    source: {id: 'source:one', fullText: '更新后的原文'},
    user: {text: '更新后的理解', draft: ''},
    agent: {status: 'ready', output: '更新后的候选', expanded: false},
  })
  const state = reader.getState()
  assert.equal(state.source.fullText, '更新后的原文')
  assert.equal(state.user.savedText, '更新后的理解')
  assert.equal(state.userDraft, '正在编辑的草稿')
  assert.equal(state.activeTab, 'agent')
  assert.equal(state.agentExpanded, true)
  reader.destroy()
})
