const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const { createAdapter } = require('./load.js')

async function main() {
  const { instance } = await WebAssembly.instantiate(fs.readFileSync('pages/aha.wasm'), {})
  const api = createAdapter(instance.exports)
  // Keep the historical reference, with only the three intentional rule corrections.
  const legacy = fs.readFileSync('scripts/jump.js', 'utf8').split('const resetParam =')[0]
    .replace('state.pity5 - CONFIG.SOFT_PITY_5 + 1', 'state.pity5 - CONFIG.SOFT_PITY_5 + 2')
    .replace('state.lossStreak = 0', 'if (!wasGuaranteed) state.lossStreak = 0')
    .replace('{ UR: 3, SSR: 3', '{ UR: 4, SSR: 3')
  function reference(search, state, count) {
    const result = vm.runInNewContext(legacy + '\n;(()=>{const {cards,best}=drawMany(' + count + ');return {cards,best,state,rng:rngState,target:targetUrl(best),video:startupVideoOf(best)};})()', {
      console: { log() {}, debug() {} },
      window: { location: { search }, localStorage: { getItem: () => state } },
    })
    return JSON.parse(JSON.stringify(result))
  }
  const states = [null, 'broken JSON', JSON.stringify({ version: 1 }), JSON.stringify({ version: 2, totalPulls: 300, pity5: 19, pity4: 9, guaranteeUp: true, lossStreak: 3, lastStandardUrl: './search.html', limitedHits: { 'https://ys.mihoyo.com/': 7 } }), JSON.stringify({ version: 2, totalPulls: 2.9, pity5: -1, pity4: '3', guaranteeUp: 1, lossStreak: 2.8, lastStandardUrl: 7, limitedHits: { bad: -1, ok: 1.9 } })]
  let comparisons = 0, draws = 0
  for (const seed of [0, 1, 42, 123, 4294967295, -1, 1.9, '0x10']) {
    for (const state of states) {
      const search = '?seed=' + seed
      const count = 500
      assert.deepEqual(api.call({ event: 'compare', search, state, count }), reference(search, state, count))
      comparisons++; draws += count
    }
  }
  for (const seed of [0, 42, 999]) {
    const search = '?seed=' + seed + '&force=5'
    assert.deepEqual(api.call({ event: 'compare', search, count: 1000 }), reference(search.replace('force=5', 'force=ur'), null, 1000))
    comparisons++; draws += 1000
  }

  // Forced UR must survive repeated visits, stale guarantees, and fixed seeds.
  for (const seed of [0, 1, 42, 123, 999, 4294967295]) {
    for (const initial of states) {
      let state = initial
      for (let visit = 0; visit < 5; visit++) {
        const result = api.call({ event: 'compare', search: '?seed=' + seed + '&force=ur', state, count: 1 })
        assert.equal(result.best.rarity, 'UR')
        assert.equal(result.state.guaranteeUp, false)
        assert.equal(result.state.lossStreak, 0)
        assert.equal(result.best.radiance, false)
        state = JSON.stringify(result.state)
      }
    }
  }

  const init = search => api.call({ event: 'init', search })
  const commands = (event, data) => api.call({ event, ...data }).commands
  assert.equal(init('?seed=42').commands.at(-1).op, 'redirect')
  assert.equal(init('?seed=42&force=ur').commands.at(-1).op, 'guide')
  assert.ok(commands('start').some(c => c.op === 'play'))
  assert.deepEqual(commands('start'), [])
  assert.ok(commands('play_error', { kind: 'initial', name: 'NotAllowedError' }).some(c => c.op === 'sound' && c.muted))
  assert.ok(commands('interact').some(c => c.op === 'sound' && c.restart && !c.muted))
  assert.ok(commands('playing').some(c => c.op === 'timer'))
  assert.ok(!commands('playing').some(c => c.op === 'timer'))
  assert.equal(commands('ended').at(-1).op, 'redirect')
  assert.deepEqual(commands('ended'), [])
  for (const event of ['skip', 'timeout', 'error']) {
    init('?seed=42&force=ur'); commands('start')
    assert.equal(commands(event).at(-1).op, 'redirect')
  }
  const probe = init('?seed=42&probe=1')
  assert.ok(!probe.commands.some(c => ['save', 'redirect', 'guide'].includes(c.op)))
  const sim = init('?seed=42&probe=1&sim=20000')
  assert.equal(sim.state.totalPulls, 0)
  assert.ok(!sim.commands.some(c => ['redirect', 'guide'].includes(c.op)))
  const reset = init('?seed=42&reset=1&pull=10')
  assert.equal(reset.commands[0].op, 'remove_storage')
  assert.equal(reset.state.totalPulls, 10)
  console.log(`Passed: ${comparisons} corrected-reference JS/WASM comparisons (${draws} draws), persistent state, video transitions, probe/simulation/reset/multi-pull.`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
