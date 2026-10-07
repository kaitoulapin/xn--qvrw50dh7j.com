function validateConfig(config) {
  function fail(path, message) { throw new Error(path + ': ' + message) }
  function object(value, path, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object')
    for (const key of Object.keys(value)) if (!keys.includes(key)) fail(path + '.' + key, 'unknown field')
  }
  function probability(value, path) { if (!Number.isFinite(value) || value < 0 || value > 1) fail(path, 'must be between 0 and 1') }
  function positive(value, path) { if (!Number.isSafeInteger(value) || value < 1) fail(path, 'must be a positive safe integer') }
  function text(value, path) { if (typeof value !== 'string' || !value.trim()) fail(path, 'must be a nonempty string') }
  function boolean(value, path) { if (typeof value !== 'boolean') fail(path, 'must be boolean') }
  function url(value, path) {
    text(value, path)
    if (!/^(https?:\/\/|\.{0,2}\/|\?)/.test(value) || value.startsWith('//') || /[\s\\]/.test(value)) fail(path, 'unsupported URL')
    if (/^https?:/.test(value)) { try { new URL(value) } catch { fail(path, 'invalid URL') } }
  }
  function video(value, path) {
    if (value === null) return
    text(value, path)
    if (value.startsWith('/') || value.includes('\\') || value.split('/').some(p => !p || p === '.' || p === '..') || /[?:#]/.test(value)) fail(path, 'must be a path beneath pages without traversal')
  }
  object(config, 'config', ['schemaVersion', 'gacha', 'pools', 'media', 'storage', 'redirect'])
  if (config.schemaVersion !== 1) fail('schemaVersion', 'unsupported version')
  const g = config.gacha
  object(g, 'gacha', ['maxPulls', 'weightCurve', 'emptyRPoolUpgradeRate', 'fiveStar', 'fourStar'])
  positive(g.maxPulls, 'gacha.maxPulls')
  if (!Number.isFinite(g.weightCurve) || g.weightCurve < 0) fail('gacha.weightCurve', 'must be finite and nonnegative')
  probability(g.emptyRPoolUpgradeRate, 'gacha.emptyRPoolUpgradeRate')
  object(g.fiveStar, 'gacha.fiveStar', ['baseRate', 'softPityStart', 'softPityStep', 'hardPity', 'limitedRate', 'radiance'])
  for (const key of ['baseRate', 'softPityStep', 'limitedRate']) probability(g.fiveStar[key], 'gacha.fiveStar.' + key)
  for (const key of ['softPityStart', 'hardPity']) positive(g.fiveStar[key], 'gacha.fiveStar.' + key)
  if (g.fiveStar.softPityStart > g.fiveStar.hardPity) fail('gacha.fiveStar.softPityStart', 'exceeds hard pity')
  object(g.fiveStar.radiance, 'gacha.fiveStar.radiance', ['lossThreshold', 'limitedRate'])
  positive(g.fiveStar.radiance.lossThreshold, 'gacha.fiveStar.radiance.lossThreshold')
  probability(g.fiveStar.radiance.limitedRate, 'gacha.fiveStar.radiance.limitedRate')
  if (g.fiveStar.radiance.limitedRate < g.fiveStar.limitedRate) fail('gacha.fiveStar.radiance.limitedRate', 'must not reduce limited rate')
  object(g.fourStar, 'gacha.fourStar', ['baseRate', 'hardPity'])
  probability(g.fourStar.baseRate, 'gacha.fourStar.baseRate'); positive(g.fourStar.hardPity, 'gacha.fourStar.hardPity')
  object(config.storage, 'storage', ['key']); text(config.storage.key, 'storage.key')
  object(config.redirect, 'redirect', ['appendPullMark', 'fallbackUrl'])
  boolean(config.redirect.appendPullMark, 'redirect.appendPullMark'); url(config.redirect.fallbackUrl, 'redirect.fallbackUrl')
  object(config.media, 'media', ['defaultVideo', 'timeoutSeconds', 'muted', 'skipHint', 'showProgress'])
  video(config.media.defaultVideo, 'media.defaultVideo')
  if (!Number.isFinite(config.media.timeoutSeconds) || config.media.timeoutSeconds < 0) fail('media.timeoutSeconds', 'must be finite and nonnegative')
  boolean(config.media.muted, 'media.muted'); boolean(config.media.showProgress, 'media.showProgress')
  if (typeof config.media.skipHint !== 'string') fail('media.skipHint', 'must be a string')
  object(config.pools, 'pools', ['UR', 'SSR', 'SR', 'R'])
  for (const rarity of ['UR', 'SSR', 'SR', 'R']) {
    const pool = config.pools[rarity], path = 'pools.' + rarity
    object(pool, path, rarity === 'SSR' ? ['cards', 'repeatDamping'] : ['cards', 'featuredCards', 'featuredRate'])
    if (!Array.isArray(pool.cards)) fail(path + '.cards', 'must be an array')
    if (rarity === 'SSR') probability(pool.repeatDamping, path + '.repeatDamping')
    else {
      if (!Array.isArray(pool.featuredCards)) fail(path + '.featuredCards', 'must be an array')
      probability(pool.featuredRate, path + '.featuredRate')
    }
    const featured = pool.featuredCards || []
    if (rarity !== 'R' && !pool.cards.length && !featured.length) fail(path, 'must not be empty')
    for (const list of ['cards', ...(rarity === 'SSR' ? [] : ['featuredCards'])]) pool[list].forEach((card, i) => {
      const cp = path + '.' + list + '[' + i + ']'
      object(card, cp, ['url', 'title', 'weight', 'video'])
      url(card.url, cp + '.url'); text(card.title, cp + '.title')
      if (card.weight !== undefined && (!Number.isFinite(card.weight) || card.weight <= 0)) fail(cp + '.weight', 'must be finite and positive')
      if (card.video !== undefined) {
        if (rarity !== 'UR') fail(cp + '.video', 'only UR can play video')
        video(card.video, cp + '.video')
      }
    })
  }
  return config
}
module.exports = { validateConfig }
