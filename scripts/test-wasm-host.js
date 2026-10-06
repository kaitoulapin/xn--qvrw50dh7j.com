const fs = require('node:fs')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { createAdapter } = require('./load.js')

// Minimal DOM with actual Rust commands, including missing optional guide text.
class Element {
  constructor(tag) { this.tag = tag; this.style = {}; this.events = {}; this.children = []; this.buffered = { length: 0 }; this.calls = 0 }
  addEventListener(type, fn, options) { (this.events[type] ||= []).push({ fn, options }) }
  removeEventListener(type, fn) { this.events[type] = (this.events[type] || []).filter(item => item.fn !== fn) }
  emit(type, data = {}) {
    for (const item of [...(this.events[type] || [])]) {
      if (item.options && item.options.once) this.removeEventListener(type, item.fn)
      item.fn({ target: this, cancelable: true, preventDefault() {}, stopImmediatePropagation() {}, ...data })
    }
  }
  setAttribute() {}
  appendChild(child) { child.parentNode = this; this.children.push(child) }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this) }
  contains(other) { return this === other || this.children.some(c => c.contains(other)) }
  querySelector(selector) {
    if (!this.innerHTML) return null
    if (selector === '#entry-note') return null
    return (this.fields ||= {})[selector] ||= new Element(selector)
  }
  play() { this.calls++; return Promise.resolve() }
  pause() { this.paused = true }
}
async function main() {
  const { instance } = await WebAssembly.instantiate(fs.readFileSync('pages/aha.wasm'), {})
  for (const seed of ['?seed=42', '?seed=42&force=ur']) {
    const doc = new Element('document'); doc.readyState = 'complete'; doc.body = new Element('body')
    const videos = [], timers = new Map(), saved = []; let target
    doc.createElement = tag => { const node = new Element(tag); if (tag === 'video') videos.push(node); return node }
    const env = { document: doc, console: { log() {}, error() {} }, localStorage: { setItem: (...args) => saved.push(args), removeItem() {} }, location: { replace: url => target = url }, setTimeout: fn => { const id = timers.size + 1; timers.set(id, fn); return id }, clearTimeout: id => timers.delete(id) }
    const adapter = createAdapter(instance.exports, env)
    adapter.send('init', { search: seed })
    assert.equal(saved.length, 1)
    if (seed.includes('force')) {
      assert.equal(target, undefined); assert.equal(videos.length, 0); assert.equal(doc.body.children.length, 1)
      doc.emit('click')
      assert.equal(videos.length, 1); assert.equal(videos[0].calls, 1); assert.equal(videos[0].muted, false)
      videos[0].emit('playing'); assert.equal(timers.size, 2)
      videos[0].emit('ended'); assert.match(target, /^https:\/\/ys.mihoyo.com\/#gacha-ur-/)
      assert.equal(timers.size, 0); assert.equal(videos[0].paused, true); assert.equal(doc.events.click.length, 0)
      assert.equal(saved.length, 1)
    } else {
      assert.equal(typeof target, 'string'); assert.equal(doc.body.children.length, 0); assert.equal(videos.length, 0)
    }
  }
  const state = { version: 2, totalPulls: 3, pity5: 3, pity4: 3 }
  const writes = [], redirects = []
  const counted = createAdapter(instance.exports, {
    localStorage: { setItem: (key, value) => writes.push(JSON.parse(value)) },
    location: { replace: url => redirects.push(url) },
  })
  counted.send('init', { search: '?seed=42', state: JSON.stringify(state) })
  counted.send('init', { search: '?seed=42', state: JSON.stringify(state) })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].totalPulls, 4)
  assert.equal(writes[0].pity5, 4)
  assert.equal(redirects.length, 1)
  assert.match(redirects[0], /#gacha-r-3$/)

  // Exercise published code with both normal navigation and Chrome prerender.
  for (const [prerendering, mode] of [[false, 'offline'], [true, 'offline'], [false, 'live'], [false, 'timeout'], [false, 'invalid']]) {
    let saved, downloads = 0, replacements = 0, writes = 0, activate
    let resolveRedirect
    const redirected = new Promise(resolve => { resolveRedirect = resolve })
    const document = {
      currentScript: { src: 'https://example.com/aha.js' }, prerendering,
      addEventListener(type, callback, options) {
        assert.equal(type, 'prerenderingchange'); assert.equal(options.once, true)
        activate = callback
      },
    }
    const context = vm.createContext({
      TextEncoder, TextDecoder, Uint8Array, URL, atob, console, document, AbortController, setTimeout: (fn, ms) => setTimeout(fn, mode === 'timeout' ? 10 : ms), clearTimeout,
      location: { search: '?seed=42', replace(url) { replacements++; resolveRedirect(url) } },
      localStorage: { getItem: () => JSON.stringify(state), setItem: (key, value) => { writes++; saved = JSON.parse(value) } },
      fetch: async url => {
        if (url.pathname === '/live-status.json') {
          if (mode === 'timeout') return new Promise(() => {})
          return { ok: true, json: async () => {
            if (mode === 'invalid') throw new SyntaxError('JSON')
            return mode === 'live' ? { schemaVersion: 1, roomId: 42062, liveStatus: 1, checkedAt: Date.now() - 1000, expiresAt: Date.now() + 599000 } : null
          } }
        }
        downloads++; assert.equal(url.pathname, '/aha.wasm')
        return { ok: true, clone() { return this }, arrayBuffer: async () => fs.readFileSync('pages/aha.wasm') }
      },
      WebAssembly: {
        instantiateStreaming: async () => { throw new Error('Unsupported MIME') },
        instantiate: (...args) => WebAssembly.instantiate(...args),
      },
    })
    const published = fs.readFileSync('pages/aha.js', 'utf8')
    vm.runInContext(published, context)
    vm.runInContext(published, context)
    if (prerendering) {
      assert.equal(downloads, 0); assert.equal(writes, 0); assert.equal(replacements, 0)
      document.prerendering = false; activate()
    }
    const target = await redirected
    assert.equal(downloads, 1); assert.equal(replacements, 1)
    if (mode === 'live') { assert.equal(target, 'https://live.bilibili.com/42062'); assert.equal(writes, 0) }
    else { assert.match(target, /#gacha-r-3$/); assert.equal(writes, 1); assert.equal(saved.totalPulls, 4); assert.equal(saved.pity5, 4) }
  }
  console.log('Passed: actual WASM + browser adapter; ordinary redirect, UR click-to-play without entry-note, storage, timers, completion, prerender activation and duplicate-loader protection.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
