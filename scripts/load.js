// 都让你看干净了，阿哈真没面子。
;(function () {
  'use strict'
  const base = typeof document === 'undefined' ? null : new URL('.', document.currentScript.src)
  async function readLiveStatus() {
    const controller = new AbortController()
    let timer
    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(new URL('/live-status.json', base), { cache: 'no-store', signal: controller.signal })
          return response.ok ? await response.json() : null
        })(),
        new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null) }, 1000) }),
      ])
    } catch { return null }
    finally { clearTimeout(timer) }
  }
  function createAdapter(wasm, env = globalThis) {
    const encoder = new TextEncoder(), decoder = new TextDecoder()
    const doc = env.document
    let guide, root, video, hint, track, bar, finished = false
    const timers = new Set(), listeners = []
    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options)
      listeners.push(() => target.removeEventListener(type, handler, options))
    }
    function call(request) {
      const input = encoder.encode(JSON.stringify(request))
      const pointer = wasm.alloc(input.length)
      try {
        new Uint8Array(wasm.memory.buffer, pointer, input.length).set(input)
        const output = wasm.dispatch(pointer, input.length)
        return JSON.parse(decoder.decode(new Uint8Array(wasm.memory.buffer, output, wasm.output_len())))
      } finally { wasm.dealloc(pointer, input.length) }
    }
    function send(event, data = {}) {
      if (finished) return
      const response = call({ event, ...data })
      for (const command of response.commands || []) execute(command)
      return response
    }
    function createVideo(command) {
      root = doc.createElement('div')
      root.style.cssText = 'position:fixed;inset:0;background:#000;z-index:2147483646;overflow:hidden;cursor:pointer'
      video = doc.createElement('video')
      for (const name of ['playsinline', 'webkit-playsinline', 'disablepictureinpicture']) video.setAttribute(name, '')
      video.preload = 'auto'; video.muted = command.muted
      video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000'
      const source = doc.createElement('source'); source.src = command.url
      if (/\.webm($|\?)/i.test(command.url)) source.type = 'video/webm'
      else if (/\.mp4($|\?)/i.test(command.url)) source.type = 'video/mp4'
      video.appendChild(source); root.appendChild(video)
      if (command.hint && command.hint.trim()) {
        hint = doc.createElement('div'); hint.textContent = command.hint
        hint.style.cssText = "position:absolute;right:18px;top:16px;z-index:3;padding:9px 16px;border:1px solid #fff;border-radius:999px;background:#000;color:#fff;font:14px/1.4 system-ui;user-select:none"
        const skip = event => { event.preventDefault(); event.stopImmediatePropagation(); send('skip') }
        listen(hint, 'click', skip); listen(hint, 'touchend', skip)
        root.appendChild(hint)
      }
      const interact = event => {
        if (hint && (event.target === hint || hint.contains(event.target))) return
        if (event.cancelable) event.preventDefault()
        send('interact')
      }
      for (const type of ['click', 'touchend', 'keydown']) listen(doc, type, interact, true)
      if (command.progress.SHOW && command.progress.BYTES > 0) {
        track = doc.createElement('div'); bar = doc.createElement('div')
        track.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:3px;background:#000;z-index:2147483647'
        bar.style.cssText = 'width:0;height:100%;background:#fff;transition:width .25s linear'
        track.appendChild(bar); root.appendChild(track)
      }
      for (const event of ['playing', 'ended', 'error']) listen(video, event, () => send(event))
      listen(source, 'error', () => send('error'))
      listen(video, 'volumechange', () => send('volumechange', { muted: video.muted }))
      listen(video, 'progress', () => {
        if (video.buffered.length) send('progress', { percent: video.buffered.end(video.buffered.length - 1) / (video.duration || 1) * 100 })
      })
      doc.body.appendChild(root)
    }
    function execute(c) {
      switch (c.op) {
        case 'save': try { env.localStorage.setItem(c.key, JSON.stringify(c.state)) } catch {} break
        case 'remove_storage': try { env.localStorage.removeItem(c.key) } catch {} break
        case 'redirect': finished = true; env.location.replace(c.url); break
        case 'log': c.data === null ? env.console.log(c.message) : env.console.log(c.message, c.data); break
        case 'guide': {
          const show = () => {
            guide = doc.createElement('div'); guide.id = 'startup-guide'; guide.innerHTML = c.html
            doc.body.appendChild(guide)
            const button = guide.querySelector('#open-surprise'); if (button) button.disabled = false
            listen(doc, 'click', () => send('start'), { once: true })
          }
          doc.readyState === 'loading' ? listen(doc, 'DOMContentLoaded', show, { once: true }) : show()
          break
        }
        case 'guide_status':
          if (guide) {
            const button = guide.querySelector('#open-surprise'), label = guide.querySelector('#open-label'), note = guide.querySelector('#entry-note')
            if (button) button.disabled = true
            if (label) label.textContent = '正在启动…'
            if (note) note.textContent = '动画加载中，请稍候。'
          }
          break
        case 'video': try { createVideo(c) } catch (error) { env.console.error(error); send('error') } break
        case 'play':
          if (finished || !video) break
          try {
            const attempt = video.play()
            if (attempt && attempt.catch) attempt.catch(error => send('play_error', { kind: c.kind, name: error.name || String(error) }))
          } catch (error) { send('play_error', { kind: c.kind, name: error.name || String(error) }) }
          break
        case 'sound':
          video.muted = c.muted
          if (c.restart) { video.volume = 1; try { video.currentTime = 0 } catch {} }
          break
        case 'hint': if (hint) hint.textContent = c.text; break
        case 'timer': if (!finished) timers.add(env.setTimeout(() => send('timeout'), c.ms)); break
        case 'progress': if (bar) bar.style.width = c.percent + '%'; break
        case 'drop_loader': if (track) { track.remove(); track = null; bar = null } break
        case 'cleanup':
          for (const timer of timers) env.clearTimeout(timer)
          timers.clear(); for (const remove of listeners.splice(0)) remove()
          if (video) video.pause()
          break
        default: throw new Error('Unknown WASM browser operation: ' + c.op)
      }
    }
    return { call, send }
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { createAdapter }; return }
  const bootKey = Symbol.for('aha.loader.started')
  if (document[bootKey]) return
  document[bootKey] = true
  async function start() {
    if (document.prerendering) {
      await new Promise(resolve => document.addEventListener('prerenderingchange', resolve, { once: true }))
    }
    const statusPromise = readLiveStatus()
    const response = await fetch(new URL('aha.wasm', base))
    if (!response.ok) throw new Error('WASM download failed: ' + response.status)
    const backup = response.clone()
    let result
    try { result = await WebAssembly.instantiateStreaming(response, {}) }
    catch { result = await WebAssembly.instantiate(await backup.arrayBuffer(), {}) }
    const adapter = createAdapter(result.instance.exports)
    const metadata = adapter.call({ event: 'metadata' })
    let state = null, storageBroken = false
    try { state = localStorage.getItem(metadata.storageKey) } catch { storageBroken = true }
    adapter.send('init', {
      liveStatus: await statusPromise, now: Date.now(),
      state, storageBroken, search: location.search,
      entropy: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
    })
  }
  start().catch(error => {
    console.error('[WASM] 启动失败', error)
    const show = () => {
      const message = document.createElement('p')
      message.textContent = '启动失败，请刷新重试。'
      message.style.cssText = 'font:16px system-ui;color:#000;background:#fff;padding:24px'
      document.body.appendChild(message)
    }
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', show, { once: true }) : show()
  })
})()
// 诶嘿，骗你的，还是不给你看~
