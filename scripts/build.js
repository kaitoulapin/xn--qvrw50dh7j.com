// Local: node scripts/build.js; Cloudflare: node scripts/build.js --cloudflare
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const crate = path.join(root, 'wasm')
if ((process.argv.includes('--cloudflare') || process.env.WORKERS_CI) && process.platform === 'linux') {
  const result = spawnSync('bash', [path.join(__dirname, 'cloudflare-build.sh')], { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exit(result.status || (result.signal ? 1 : 0))
}
const config = JSON.parse(fs.readFileSync(path.join(crate, 'config.json'), 'utf8'))
const settings = config.config
if (!(settings.SOFT_PITY_5 >= 1 && settings.SOFT_PITY_5 <= settings.HARD_PITY_5)) throw new Error('Invalid five-star pity settings')
if (!Number.isFinite(settings.UP_SHARE) || settings.UP_SHARE < 0 || settings.UP_SHARE > 1) throw new Error('UP_SHARE must be between 0 and 1')
if (!Number.isFinite(settings.MAX_PULLS) || settings.MAX_PULLS < 1) throw new Error('MAX_PULLS must be positive')
for (const pool of ['limited', 'standard', 'preferred', 'filler']) {
  const plan = config[pool]
  if (!Array.isArray(plan.cards) || !Array.isArray(plan.up)) throw new Error('Invalid pool: ' + pool)
  if (pool !== 'filler' && !plan.cards.length) throw new Error('Empty pool: ' + pool)
  for (const card of [...plan.cards, ...plan.up]) {
    if (!card.url || !card.rarity) throw new Error('Invalid card: ' + pool)
    if (card.video) {
      const file = path.resolve(root, 'pages', card.video)
      if (!file.startsWith(path.join(root, 'pages') + path.sep) || !fs.existsSync(file)) throw new Error('Video missing or outside pages: ' + card.video)
    }
  }
}
if (config.progress.SHOW && config.progress.BYTES > 0) {
  const video = config.limited.cards.find(card => card.video)
  if (video && fs.statSync(path.resolve(root, 'pages', video.video)).size !== config.progress.BYTES) {
    throw new Error('Video byte count changed; update progress.BYTES in wasm/config.json')
  }
}
const result = spawnSync('cargo', ['build', '--manifest-path', path.join(crate, 'Cargo.toml'), '--target', 'wasm32-unknown-unknown', '--release', '--locked'], { cwd: root, stdio: 'inherit', env: { ...process.env, AHA_BUILD_NONCE: crypto.randomBytes(32).toString('hex') } })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)
const binary = fs.readFileSync(path.join(crate, 'target/wasm32-unknown-unknown/release/aha_wasm.wasm'))
new WebAssembly.Module(binary)
// Fail closed if release optimization ever reintroduces complete target URLs.
const targets = ['limited', 'standard', 'preferred', 'filler'].flatMap(pool => [...config[pool].cards, ...config[pool].up])
for (const target of targets) {
  if (/^https?:/.test(target.url) && binary.includes(Buffer.from(target.url))) {
    throw new Error('Plaintext target URL found in WASM; deployment stopped')
  }
}
for (const source of ['config.json', 'src/guide.html']) {
  if (binary.includes(fs.readFileSync(path.join(crate, source)))) throw new Error('Plaintext embedded source found: ' + source)
}
fs.writeFileSync(path.join(root, 'pages/aha.wasm'), binary)
const host = fs.readFileSync(path.join(__dirname, 'load.js'), 'utf8')
const output = process.env.JUMP_OUTPUT || path.join(root, 'pages/aha.js')
fs.writeFileSync(output, require('./convert.js').obfuscate(host))
console.log(`WASM build ready: ${binary.length} bytes; browser entry: ${path.relative(root, output)}`)
