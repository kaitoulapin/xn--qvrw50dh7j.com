const fs = require('node:fs')
const assert = require('node:assert/strict')
const { createAdapter } = require('./load.js')
const { validateConfig } = require('./validate-config.js')
const config = JSON.parse(fs.readFileSync('wasm/config.json', 'utf8'))
const settings = config.gacha
const rank = { R: 1, SR: 2, SSR: 3, UR: 4 }

async function main() {
  const { instance } = await WebAssembly.instantiate(fs.readFileSync('pages/aha.wasm'))
  const api = createAdapter(instance.exports)
  let audited = 0, radiance = 0
  for (const seed of [0, 1, 42, 123, 999]) {
    const result = api.call({ event: 'compare', search: '?seed=' + seed, count: 20000 })
    let pity5 = 0, pity4 = 0, losses = 0, guaranteed = false, upHits = 0
    let best = result.cards[0]
    for (const card of result.cards) {
      const rate = pity5 >= config.gacha.fiveStar.hardPity - 1 ? 1
        : pity5 < config.gacha.fiveStar.softPityStart - 1 ? config.gacha.fiveStar.baseRate
          : Math.min(1, config.gacha.fiveStar.baseRate + (pity5 - config.gacha.fiveStar.softPityStart + 2) * config.gacha.fiveStar.softPityStep)
      assert.ok(Math.abs(card.rate5 - rate) < 1e-10)
      assert.equal(card.pity, pity5)
      if (rank[card.rarity] >= 3) {
        if (guaranteed) assert.equal(card.rarity, 'UR')
        assert.equal(card.guaranteed, guaranteed)
        if (card.rarity === 'UR') {
          upHits++
          const expectedRadiance = !guaranteed && losses >= config.gacha.fiveStar.radiance.lossThreshold && config.gacha.fiveStar.radiance.limitedRate > config.gacha.fiveStar.limitedRate
          assert.equal(card.radiance, expectedRadiance)
          if (card.radiance) radiance++
          if (!guaranteed) losses = 0
          guaranteed = false
        } else {
          assert.equal(card.lost, true); losses++; guaranteed = true
        }
        pity5 = 0; pity4 = 0
      } else {
        assert.ok(pity5 < config.gacha.fiveStar.hardPity - 1)
        if (card.rarity === 'R') assert.ok(pity4 < config.gacha.fourStar.hardPity - 1)
        pity5++; pity4 = card.rarity === 'SR' ? 0 : pity4 + 1
      }
      if (rank[card.rarity] > rank[best.rarity]) best = card
      audited++
    }
    assert.deepEqual(result.best, best)
    assert.equal(result.state.totalPulls, 20000)
    assert.equal(result.state.pity5, pity5); assert.equal(result.state.pity4, pity4)
    assert.equal(result.state.guaranteeUp, guaranteed); assert.equal(result.state.lossStreak, losses)
    assert.equal(Object.values(result.state.limitedHits).reduce((a, b) => a + b, 0), upHits)
  }
  assert.ok(radiance > 0, 'Radiance must occur naturally')

  for (const count of [1, 2, 10, 100, 20000]) {
    const search = '?seed=42'
    const cards = api.call({ event: 'compare', search, count }).cards
    let gap5 = 0, max5 = 0, gapR = 0, maxR = 0
    const totals = { UR: 0, SSR: 0, SR: 0, R: 0 }
    for (const card of cards) {
      totals[card.rarity]++
      gap5 = rank[card.rarity] >= 3 ? 0 : gap5 + 1; max5 = Math.max(max5, gap5)
      gapR = card.rarity === 'R' ? gapR + 1 : 0; maxR = Math.max(maxR, gapR)
    }
    const sim = api.call({ event: 'init', search: search + '&probe=1&sim=' + count })
    const stats = sim.commands.find(c => c.op === 'log' && c.message.includes('模拟结果')).data
    assert.equal(stats['五星数'], totals.UR + totals.SSR)
    assert.equal(stats['四星数'], totals.SR); assert.equal(stats['三星数'], totals.R)
    assert.equal(stats['最长连续三星'], maxR); assert.equal(stats['最长连续未出五星'], max5)
    assert.equal(sim.state.totalPulls, 0)
    assert.ok(!sim.commands.some(c => ['save', 'guide', 'redirect'].includes(c.op)))
  }
  for (const pull of ['-1', '0', 'NaN', 'Infinity', '1.9', '2.9', '1000000']) {
    const result = api.call({ event: 'init', search: '?seed=42&pull=' + pull })
    const n = Number(pull), expected = Number.isFinite(n) && n > 1 ? Math.min(Math.floor(n), config.gacha.maxPulls) : 1
    assert.equal(result.state.totalPulls, expected)
    assert.equal(result.commands.filter(c => c.op === 'save').length, 1)
    assert.equal(result.commands.filter(c => ['guide', 'redirect'].includes(c.op)).length, 1)
  }
  const small = api.call({ event: 'init', search: '?seed=42&probe=1&sim=0.5' })
  assert.match(small.commands[0].message, /1 抽/)
  validateConfig(config)
  for (const [path, value] of [['gacha.fourStar.hardPity', 0], ['gacha.maxPulls', 0.5], ['gacha.fiveStar.limitedRate', 2], ['gacha.weightCurve', -1], ['gacha.fiveStar.radiance.lossThreshold', 1.2]]) {
    const invalid = structuredClone(config); const keys = path.split('.'); const key = keys.pop(); keys.reduce((v, k) => v[k], invalid)[key] = value
    assert.throws(() => validateConfig(invalid))
  }
  for (const [path, value] of [
    ['schemaVersion', 2], ['media.showProgress', 'yes'], ['media.timeoutSeconds', -1],
    ['media.defaultVideo', '../private.mp4'], ['redirect.fallbackUrl', 'javascript:alert(1)'],
    ['pools.SSR.featuredCards', []], ['pools.UR.cards.0.share', 1], ['pools.R.featuredRate', 2],
  ]) {
    const invalid = structuredClone(config), keys = path.split('.'), key = keys.pop()
    keys.reduce((v, k) => v[k], invalid)[key] = value
    assert.throws(() => validateConfig(invalid))
  }
  const invalid = structuredClone(config); invalid.pools.SSR.cards[0].rarity = 'UR'
  assert.throws(() => validateConfig(invalid))
  console.log(`Passed: ${audited} independently audited draws; ${radiance} natural radiance wins; simulation gaps, multi-pull limits, persistence and invalid configuration checks.`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
