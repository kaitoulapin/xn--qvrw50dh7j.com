const fs = require('node:fs')
const assert = require('node:assert/strict')
const { createAdapter } = require('./load.js')

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize)
  if (!value || typeof value !== 'object') return value
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))
  delete result.group; delete result.title; delete result['分组']; delete result['标题']
  if (result.share !== undefined) { result.weight = result.share; delete result.share }
  return result
}
async function main() {
  const oldPath = process.argv[2] || 'wasm/target/config-migration/before.wasm'
  const old = createAdapter((await WebAssembly.instantiate(fs.readFileSync(oldPath))).instance.exports)
  const current = createAdapter((await WebAssembly.instantiate(fs.readFileSync('pages/aha.wasm'))).instance.exports)
  let checks = 0
  for (const seed of [0, 1, 42, 123, 999, 4294967295]) {
    for (const state of [null, 'broken', JSON.stringify({ version: 2, totalPulls: 31, pity5: 19, pity4: 9, guaranteeUp: true, lossStreak: 3, lastStandardUrl: './search.html', limitedHits: {} })]) {
      for (const suffix of ['', '&force=ur', '&force=5']) {
        const request = { event: 'compare', search: `?seed=${seed}${suffix}`, state, count: 1000 }
        assert.deepEqual(normalize(current.call(request)), normalize(old.call(request)))
        checks++
      }
      for (const suffix of ['', '&pull=10', '&force=ur', '&force=5', '&probe=1', '&probe=1&sim=1000', '&reset=1&pull=10']) {
        const request = { event: 'init', search: `?seed=${seed}${suffix}`, state }
        assert.deepEqual(normalize(current.call(request)), normalize(old.call(request)))
        for (const event of ['start', 'playing', 'play_error', 'interact', 'ended']) {
          const request = { event, kind: 'initial', name: 'NotAllowedError' }
          assert.deepEqual(current.call(request), old.call(request))
        }
        checks++
      }
    }
  }
  console.log(`Passed: ${checks} pre/post migration comparisons; cards, RNG, state, targets and video commands identical after share→weight rename and display-title changes.`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
