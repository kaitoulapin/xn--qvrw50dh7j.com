import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { queryStatus, publishStatus } from '../cloudflare/live-publisher/worker.mjs'
const { createAdapter } = createRequire(import.meta.url)('./load.js')
const { instance } = await WebAssembly.instantiate(fs.readFileSync('pages/aha.wasm'))
const now = 1800000000000
const live = { schemaVersion: 1, roomId: 42062, liveStatus: 1, checkedAt: now, expiresAt: now + 600000 }
const state = JSON.stringify({ version: 2, totalPulls: 3, pity5: 3, pity4: 3 })
const call = request => createAdapter(instance.exports).call({ event: 'init', search: '?seed=42', state, now, ...request })
for (const search of ['', '?force=ur', '?reset=1', '?pull=10']) {
  assert.deepEqual(call({ search, liveStatus: live }).commands, [{ op: 'redirect', url: 'https://live.bilibili.com/42062' }])
}
for (const status of [null, {}, ...[0, 2, null, '1'].map(liveStatus => ({ ...live, liveStatus })),
  { ...live, roomId: 1 }, { ...live, schemaVersion: 2 }, { ...live, checkedAt: now + 1 },
  { ...live, expiresAt: now }, { ...live, expiresAt: now + 600001 }, { ...live, checkedAt: '0' }]) {
  const result = call({ liveStatus: status })
  assert.equal(result.state.totalPulls, 4)
  assert.equal(result.commands.filter(c => c.op === 'save').length, 1)
}
for (const search of ['?probe=1', '?probe=1&sim=100']) {
  const result = call({ search, liveStatus: live })
  assert.equal(result.commands.some(c => c.op === 'redirect'), false)
}
for (const liveStatus of [0, 1, 2, 3, '1', null]) {
  const status = await queryStatus(async () => Response.json({ code: 0, data: { room_id: 42062, live_status: liveStatus } }), () => now)
  assert.equal(status.liveStatus, [0, 1, 2].includes(liveStatus) ? liveStatus : null)
  assert.equal(status.expiresAt, now + 600000)
}
assert.equal((await queryStatus(async () => { throw new Error('network') })).liveStatus, null)
assert.equal((await queryStatus(async () => Response.json({ code: -1 }))).liveStatus, null)
let attempts = 0
const recovered = await queryStatus(async (url, options) => {
  assert.equal(options.headers.Referer, 'https://live.bilibili.com/42062')
  assert.ok(options.headers['User-Agent'])
  assert.equal(options.headers.Cookie, undefined)
  attempts++
  if (attempts === 1) return new Response('<html>blocked</html>', { status: 412 })
  assert.match(url, /get_info\?room_id=42062$/)
  return Response.json({ code: 0, data: { room_id: 42062, live_status: 1 } })
}, () => now, () => {})
assert.equal(attempts, 2)
assert.equal(recovered.liveStatus, 1)
const rejected = await queryStatus(async () => new Response('blocked', { status: 412 }), () => now, () => {})
assert.equal(rejected.liveStatus, null)
const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'private-token' }
for (const failAt of [0, 1, 2, -1]) {
  let step = 0, manifest
  const fetcher = async (url, options) => {
    assert.ok(!url.includes('/mihoyo/'))
    const index = step++
    if (index === failAt) return Response.json({ success: false }, { status: 500 })
    if (index === 0) {
      manifest = JSON.parse(options.body).manifest
      assert.deepEqual(Object.keys(manifest), ['/live-status.json'])
      return Response.json({ success: true, result: { jwt: 'upload', buckets: [Object.values(manifest).map(v => v.hash)] } })
    }
    if (index === 1) {
      assert.equal(options.headers.Authorization, 'Bearer upload')
      const file = options.body.get(Object.values(manifest)[0].hash)
      assert.deepEqual(JSON.parse(Buffer.from(await file.text(), 'base64')), live)
      return Response.json({ success: true, result: { jwt: 'completion' } })
    }
    assert.equal(options.method, 'PUT')
    const metadata = JSON.parse(await options.body.get('metadata').text())
    assert.equal(metadata.assets.jwt, 'completion')
    assert.match(metadata.assets.config._headers, /Cache-Control: no-store/)
    assert.equal(metadata.assets.config.run_worker_first, undefined)
    return Response.json({ success: true, result: {} })
  }
  if (failAt < 0) await publishStatus(env, live, fetcher)
  else { await assert.rejects(publishStatus(env, live, fetcher), /publish step failed/); assert.equal(step, failAt + 1) }
}
console.log('Passed: live priority, untouched pity/reset, stale/invalid fallback, diagnostics, Bili parsing, isolated atomic uploads and failure handling.')
