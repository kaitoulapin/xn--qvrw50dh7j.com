const TARGET = 'mihoyo-live-status'
const API = 'https://api.cloudflare.com/client/v4'
const HEADERS = '/live-status.json\n  Cache-Control: no-store\n  X-Robots-Tag: noindex\n'

async function boundedFetch(fetcher, url, options, timeout) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetcher(url, { ...options, signal: controller.signal })
    let body
    try { body = await response.json() }
    catch {
      const error = new Error('Invalid upstream JSON')
      error.httpStatus = response.status
      throw error
    }
    return { response, body }
  } finally { clearTimeout(timer) }
}

export async function queryStatus(fetcher = fetch, now = Date.now, report = message => console.warn(message)) {
  let liveStatus = null
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Referer': 'https://live.bilibili.com/42062',
    'Accept': 'application/json, text/plain, */*',
  }
  const deadline = Date.now() + 3000
  for (const endpoint of ['room_init?id=42062', 'get_info?room_id=42062']) {
  const remaining = deadline - Date.now()
  if (remaining <= 0) break
  try {
    const { response, body } = await boundedFetch(fetcher,
      `https://api.live.bilibili.com/room/v1/Room/${endpoint}`, { headers, redirect: 'manual' }, remaining)
    if (response.ok && body.code === 0 && body.data?.room_id === 42062
        && [0, 1, 2].includes(body.data.live_status)) { liveStatus = body.data.live_status; break }
    else {
      const code = Number.isInteger(body?.code) ? body.code : 'invalid'
      report(`Live query rejected (${endpoint}): HTTP ${response.status}; API code ${code}; room match ${body?.data?.room_id === 42062}; valid status ${[0, 1, 2].includes(body?.data?.live_status)}`)
    }
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'timeout' : Number.isInteger(error.httpStatus) ? `invalid JSON; HTTP ${error.httpStatus}` : 'network failure'
    const detail = String(error?.message || '').replace(/https?:\/\/[^\s]+/g, '[URL]').replace(/[\r\n]/g, ' ').slice(0, 240)
    report(`Live query failed (${endpoint}): ${reason}; ${detail}`)
  }
  }
  const checkedAt = now()
  return { schemaVersion: 1, roomId: 42062, liveStatus, checkedAt, expiresAt: checkedAt + 600000 }
}

export async function publishStatus(env, status, fetcher = fetch) {
  if (!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID || '') || !env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Missing publisher credentials')
  }
  const script = `${API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${TARGET}`
  async function api(url, options = {}, token = env.CLOUDFLARE_API_TOKEN) {
    const { response, body } = await boundedFetch(fetcher, url,
      { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } }, 15000)
    // Never include API responses, URLs or credentials in thrown errors/logs.
    if (!response.ok || body.success !== true) throw new Error('Cloudflare publish step failed')
    return body.result
  }
  const files = new Map()
  const manifest = {}
  for (const [path, content, type] of [
    ['/live-status.json', JSON.stringify(status), 'application/json'],
  ]) {
    const bytes = new TextEncoder().encode(content)
    const base64 = btoa(String.fromCharCode(...bytes))
    const extension = path.split('.').pop() === 'json' ? 'json' : ''
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base64 + extension))
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
    manifest[path] = { hash, size: bytes.length }
    files.set(hash, { base64, type })
  }
  const session = await api(`${script}/assets-upload-session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manifest }),
  })
  if (!session?.jwt || !Array.isArray(session.buckets)) throw new Error('Invalid asset session')
  let completion = session.buckets.length === 0 ? session.jwt : null
  for (const bucket of session.buckets) {
    const form = new FormData()
    for (const hash of bucket) {
      const file = files.get(hash)
      if (!file) throw new Error('Unexpected asset hash')
      form.append(hash, new Blob([file.base64], { type: file.type }), hash)
    }
    const result = await api(`${API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/assets/upload?base64=true`,
      { method: 'POST', body: form }, session.jwt)
    if (result?.jwt) completion = result.jwt
  }
  if (!completion) throw new Error('Missing asset completion token')
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify({
    compatibility_date: '2026-10-06',
    assets: { jwt: completion, config: { _headers: HEADERS, html_handling: 'none', not_found_handling: 'none' } },
  })], { type: 'application/json' }))
  // Atomic script upload activates only the status site's new asset deployment.
  await api(script, { method: 'PUT', body: form })
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        await publishStatus(env, await queryStatus())
        console.log('Live status published')
      } catch { console.error('Live status publication failed; previous assets retained'); throw new Error('Live status publication failed') }
    })())
  },
}
