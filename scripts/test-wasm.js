const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const { createAdapter } = require('./load.js')

async function main() {
  const { instance } = await WebAssembly.instantiate(fs.readFileSync('pages/aha.wasm'), {})
  const api = createAdapter(instance.exports)
  const legacy = fs.readFileSync('scripts/jump.js', 'utf8').split('const resetParam =')[0]
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
    const search = '?seed=' + seed + '&force=ur'
    assert.deepEqual(api.call({ event: 'compare', search, count: 1000 }), reference(search, null, 1000))
    comparisons++; draws += 1000
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
  assert.equal(sim.commands.at(-1).state.totalPulls, 0)
  assert.ok(!sim.commands.some(c => ['redirect', 'guide'].includes(c.op)))
  for (const count of [0, 1, 100, 20000]) {
    let expected
    vm.runInNewContext(legacy + '\n;probeSimulate(' + count + ')', {
      console: { log: (message, data) => { if (message.includes('模拟结果')) expected = data }, debug() {} },
      window: { location: { search: '?seed=42' }, localStorage: { getItem: () => null, setItem() {} } },
    })
    const result = init('?seed=42&probe=1&sim=' + (count || 0.5))
    const actual = result.commands.find(c => c.op === 'log' && c.message.includes('模拟结果')).data
    assert.deepEqual(actual, JSON.parse(JSON.stringify(expected)))
  }
  const reset = init('?seed=42&reset=1&pull=10')
  assert.equal(reset.commands[0].op, 'remove_storage')
  assert.equal(reset.state.totalPulls, 10)
  console.log(`Passed: ${comparisons} exact JS/WASM comparisons (${draws} draws), persistent state, video transitions, probe/simulation/reset/multi-pull.`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
