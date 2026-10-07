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
require('./validate-config.js').validateConfig(config)
const targets = Object.values(config.pools).flatMap(pool => [...pool.cards, ...(pool.featuredCards || [])])
const videos = [config.media.defaultVideo, ...targets.map(card => card.video)].filter(Boolean)
for (const video of videos) {
  const base = fs.realpathSync(path.join(root, 'pages'))
  const file = fs.realpathSync(path.join(base, video))
  if (!file.startsWith(base + path.sep) || !fs.statSync(file).isFile()) throw new Error('Invalid media video path: ' + video)
}
const result = spawnSync('cargo', ['+nightly-2026-10-01', 'build', '-Zbuild-std=std,panic_abort', '-Zbuild-std-features=', '--manifest-path', path.join(crate, 'Cargo.toml'), '--target', 'wasm32-unknown-unknown', '--release', '--locked'], { cwd: root, stdio: 'inherit', env: { ...process.env, AHA_BUILD_NONCE: crypto.randomBytes(32).toString('hex'), RUSTFLAGS: '-Zunstable-options -Cpanic=immediate-abort'  } })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)
const binary = fs.readFileSync(path.join(crate, 'target/wasm32-unknown-unknown/release/aha_wasm.wasm'))
new WebAssembly.Module(binary)
// Fail closed if release optimization ever reintroduces complete target URLs.
for (const target of targets) {
  if (binary.includes(Buffer.from(target.title))) throw new Error('Plaintext card title found in WASM')
  if (/^https?:/.test(target.url) && binary.includes(Buffer.from(target.url))) {
    throw new Error('Plaintext target URL found in WASM; deployment stopped')
  }
}
for (const source of ['config.json', 'src/guide.html']) {
  if (binary.includes(fs.readFileSync(path.join(crate, source)))) throw new Error('Plaintext embedded source found: ' + source)
}
const fragments = ['index out of bounds: the len is ', '点击任意处开声音', '3★池未配置（兜底）', '3★池未配置（提升为4★）', '启动动画', '限定', '歪了', '下个5★必是限定UP', '大保底', '本次必为限定UP', '捕获明光', '已触发', '[卡池] 跳转目标', 'storageBroken', '[卡池] localStorage 不可用', 'fallback', 'group', 'title']
for (const source of ['src/engine.rs', 'src/runtime.rs']) {
  const text = fs.readFileSync(path.join(crate, source), 'utf8')
  for (const match of text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)) {
    if (/[\u3400-\u9fff]/.test(match[1]) || Buffer.byteLength(match[1]) >= 8) fragments.push(match[1])
  }
}
for (const text of new Set(fragments)) {
  if (binary.includes(Buffer.from(text))) throw new Error('Plaintext runtime fragment found: ' + text)
}
fs.writeFileSync(path.join(root, 'pages/aha.wasm'), binary)
const host = fs.readFileSync(path.join(__dirname, 'load.js'), 'utf8')
const output = process.env.JUMP_OUTPUT || path.join(root, 'pages/aha.js')
fs.writeFileSync(output, require('./convert.js').obfuscate(host))
console.log(`WASM build ready: ${binary.length} bytes; browser entry: ${path.relative(root, output)}`)
