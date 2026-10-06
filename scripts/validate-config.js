function validateConfig(config) {
  const settings = config.config
  for (const key of ['BASE_RATE_5', 'SOFT_PITY_STEP_5', 'BASE_RATE_4', 'UP_RATE', 'RADIANCE_UP_RATE', 'UP_SHARE', 'STANDARD_REPEAT_DAMPING', 'FILLER_FALLBACK_UPGRADE']) {
    if (!Number.isFinite(settings[key]) || settings[key] < 0 || settings[key] > 1) throw new Error(key + ' must be between 0 and 1')
  }
  for (const key of ['SOFT_PITY_5', 'HARD_PITY_5', 'HARD_PITY_4', 'RADIANCE_LOSSES', 'MAX_PULLS']) {
    if (!Number.isSafeInteger(settings[key]) || settings[key] < 1) throw new Error(key + ' must be a positive integer')
  }
  if (settings.SOFT_PITY_5 > settings.HARD_PITY_5) throw new Error('Soft pity must not exceed hard pity')
  if (settings.RADIANCE_UP_RATE < settings.UP_RATE) throw new Error('Radiance rate must not reduce UP rate')
  if (!Number.isFinite(settings.WEIGHT_CURVE) || settings.WEIGHT_CURVE < 0) throw new Error('Invalid weight curve')
  if (typeof settings.PULL_MARK !== 'boolean' || typeof settings.STORAGE_KEY !== 'string' || !settings.STORAGE_KEY.trim()) throw new Error('Invalid storage or marker settings')
  for (const [pool, rarity] of [['limited', 'UR'], ['standard', 'SSR'], ['preferred', 'SR'], ['filler', 'R']]) {
    const plan = config[pool]
    if (!plan || !Array.isArray(plan.cards) || !Array.isArray(plan.up)) throw new Error('Invalid pool: ' + pool)
    if (pool !== 'filler' && !plan.cards.length && !plan.up.length) throw new Error('Empty pool: ' + pool)
    // The standard pool has no UP sub-pool or guarantee of its own.
    if (pool === 'standard' && (!plan.cards.length || plan.up.length)) throw new Error('Standard pool requires cards and an empty up list')
    for (const card of [...plan.cards, ...plan.up]) {
      if (typeof card.url !== 'string' || !card.url.trim() || card.rarity !== rarity) throw new Error('Invalid card: ' + pool)
      if (!/^(https?:\/\/|\.{0,2}\/|\?)/.test(card.url) || card.url.startsWith('//')) throw new Error('Unsupported card URL: ' + card.url)
      for (const key of ['weight', 'share']) {
        if (card[key] !== undefined && (!Number.isFinite(card[key]) || card[key] <= 0)) throw new Error('Card ' + key + ' must be positive')
      }
    }
  }
  return config
}
module.exports = { validateConfig }
