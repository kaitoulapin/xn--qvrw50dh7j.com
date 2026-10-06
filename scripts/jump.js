// 都让你看干净了，阿哈真没面子。
//
// 跳转逻辑 = 二游抽卡。每次打开网站就是「抽一发」，抽到哪张卡就跳到哪张卡指向的网页。
//
// 卡池分层（改链接只需要动 GROUPS / FILLER_GROUPS，其它数值都在 CONFIG 里）：
//   LIMITED_CARDS    5★ 限定 UP 池 —— 抽中 5★ 时按 UP_RATE 直接出货；歪了才进常驻池
//   STANDARD_KEYS    5★ 常驻池     —— 池内自带小保底：上次抽到的那条本轮概率减半
//   PREFERRED_KEYS   4★ 池
//   PREFERRED_UP_KEYS 4★ 的 UP 子池（留空 = 本池没有当期 UP）
//   FILLER_GROUPS    3★ 狗粮池（分组写在下方，不引用 GROUPS）
//   FILLER_UP_KEYS   3★ 的 UP 子池（按分组名挑）
//
// 抽卡机制：
//   软保底    第 SOFT_PITY_5 抽起，每抽概率 +SOFT_PITY_STEP_5
//   硬保底    第 HARD_PITY_5 抽必定出货
//   小保底    5★ 首次有 UP_RATE 的概率是限定 UP
//   大保底    歪过一次之后，下一个 5★ 必定是限定 UP（跨访问继承）
//   捕获明光  连续歪 RADIANCE_LOSSES 次后，本期 5★ 的 UP 占比提升到 RADIANCE_UP_RATE
//   4★ 保底   10 抽内必出 4★ 及以上（兜底，防止连续多次都是 3★）
//   3★/4★ UP 有 UP 子池时，UP 占该稀有度的 UP_SHARE（只提概率，没有大小保底）
//   伪随机    mulberry32 自播种 PRNG，比 Math.random 手感更稳，?seed= 可复现
//
// 池内概率默认等概率（WEIGHT_CURVE: 0），与原版随机行为一致。
//
// 调试参数（URL）：
//   ?seed=123          固定种子，结果可复现
//   ?reset=1           清空保底进度
//   ?pull=N            强制抽 N 张（上限 10）
//   ?force=ur          强制本次抽中限定 5★，用来直接看启动动画
//   ?probe=1           只打印本次抽卡明细到控制台，不跳转
//   ?probe=1&sim=20000 连抽 N 次并打印分布表，用来验证概率，不跳转

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

const CONFIG = {
  // 5★：基础概率、软保底起点（第几抽开始递增）、每抽增量、硬保底
  BASE_RATE_5: 0.04,
  SOFT_PITY_5: 12,
  SOFT_PITY_STEP_5: 0.08,
  HARD_PITY_5: 20,

  // 4★ 及其它
  BASE_RATE_4: 0.3,
  HARD_PITY_4: 10,

  // 大小保底与捕获明光
  UP_RATE: 0.5,
  RADIANCE_LOSSES: 3,
  RADIANCE_UP_RATE: 0.8,

  // 单次访问最多抽几张（多抽时取最高稀有度那张决定跳转）
  MAX_PULLS: 10,

  // 池内权重平滑曲线：0 = 池内等概率（与原版行为一致），越大越偏向排在前面的链接
  WEIGHT_CURVE: 0,

  // 有 UP 子池时，UP 占该稀有度的比例（UP 内部等分，参考 5★ 的 UP_RATE）
  UP_SHARE: 0.5,

  // 常驻池「上次抽到的那条」的权重折扣（小保底）
  STANDARD_REPEAT_DAMPING: 0.5,

  // 3★ 池为空（还没填链接）时，把 3★ 结果按此概率提升为 4★
  FILLER_FALLBACK_UPGRADE: 0.6,

  // 跳转时在目标地址末尾带一个不影响页面的标记，方便回地址栏确认抽到了什么
  PULL_MARK: true,

  // 状态存储 key（带版本号，结构变更时自动丢弃旧进度）
  STORAGE_KEY: 'buwanyuanshen.gacha.v2',
}

// ---------------------------------------------------------------------------
// 启动动画（限定 5★ 出货后先播视频，播完再跳转）
// ---------------------------------------------------------------------------

const STARTUP = {
  // 全局默认素材：所有没单独配 video 的限定 5★ 都用它。null = 不播，直接跳转
  DEFAULT_VIDEO: null,

  // 兜底：素材最长播放多久就强制跳转（秒），避免加载失败/被拦截时卡住
  TIMEOUT: 25,

  // 静音播放。false = 带声音，若被浏览器自动播放策略拦下会自动降级为静音重试
  MUTED: false,

  // 跳过提示文案（点这个提示条 = 跳过）。设成 '' 则页面上没有提示条
  SKIP_HINT: '点击此处跳过',
}

// 素材尺寸，仅用于「加载中」的反馈；设为 0 则完全不显示进度条
const VIDEO_PROGRESS = {
  BYTES: 607977, // 与 pages/video/startup-01.mp4 一致
  SHOW: true,
}

// ---------------------------------------------------------------------------
// 链接配置
// ---------------------------------------------------------------------------

// 限定 5★ 卡池。group 指向 GROUPS 里的分组名，可选字段：
//   video  该链接专属的启动动画（相对 pages/ 的路径）；不写就用 STARTUP.DEFAULT_VIDEO
//   share  出货权重，默认 1；想让某条更常出就调大
const LIMITED_CARDS = [{ group: '原神官网', video: 'video/startup-01.mp4' }]

// 常驻池（非 UP 五星）：UP 没中的时候从这里随机
const STANDARD_KEYS = ['FGO国服官网', '站内搜索页']

// 4★ 池：UP 子池（PREFERRED_UP_KEYS）留空 = 本池没有当期 UP，池内等概率
const PREFERRED_KEYS = ['网友投稿']
const PREFERRED_UP_KEYS = []

// 3★ 狗粮池：UP 子池吃 CONFIG.UP_SHARE，其余按 FILLER_GROUPS 等概率
const FILLER_UP_KEYS = ['3星狗粮UP']
const FILLER_GROUPS = [
  {
    name: '3星狗粮UP',
    urls: [
      'https://space.bilibili.com/730732', // 瓶子君152
      'https://www.bilibili.com/video/BV1GJ411x7h7/', // Never Gonna Give You Up - Rick Astley
    ],
  },
  {
    name: '3星狗粮',
    urls: [
      'https://www.qq.com/', // 腾讯网
      // ↓ ↓ ↓ 从 5★ 常驻池挪过来的两组：二游官网 / B站主页 各大官方 ↓ ↓ ↓
      // 'https://www.mihoyo.com/', // 米哈游官网
      'https://mc.kurogames.com/download/', // 鸣潮官方下载网页
      'https://endfield.hypergryph.com/', // 明日方舟终末地
      'https://career.hypergryph.com/', // 鹰角网络招聘
      'https://yh.wanmei.com/index.html', // 异环官网
      'https://gf2.sunborngame.com/', // 少前二追放
      'https://klbq.idreamsky.com/', // 卡拉彼丘官网
      'https://bdon.biligames.com/', // our notes官网
      'https://se.feimogames.com/home', // 吉星派对官网
      'https://space.bilibili.com/75806856/', // 中国反邪教B站主页
      'https://space.bilibili.com/3546861952567358/', // 米哈游法务部
      'https://space.bilibili.com/3546379781671377/', // 库洛游戏法务部
      'https://space.bilibili.com/3546893747489397/', // 鹰角网络法务部（高仿）
    ],
  },
]

const GROUPS = [
  {
    name: '原神官网',
    urls: [
      'https://ys.mihoyo.com/', // 原神国服官网（限定5★，出货播启动动画）
    ],
  },
  // 原「二游官网」与「B站主页 各大官方」两组已挪进 3★ 狗粮池，见上方 FILLER_GROUPS
  {
    name: 'FGO国服官网',
    urls: [
      'https://game.bilibili.com/fgo/', // FGO 国服官网（常驻5★）
    ],
  },
  {
    // 备选 UP 主池：当前没有任何池子引用它，链接留在注释里备查。
    // 想启用就把名字加进 PREFERRED_KEYS，再取消下面某几行的注释。
    name: 'B站主页 个人UP主（备选）',
    urls: [
      // 'https://space.bilibili.com/730732', // 瓶子君152（已挪到 3★ 狗粮池）
      // 'https://space.bilibili.com/2074304720/', // 无尽夏可拉的个人空间
      // 'https://space.bilibili.com/3546724249373318/', // 满足你
      // 'https://space.bilibili.com/402574397/', // 孙笑川258
      // 'https://space.bilibili.com/1437582453/', // 東雪蓮Official
      // 'https://space.bilibili.com/1265680561/', // 永雏塔菲
    ],
  },
  {
    name: '站内搜索页',
    urls: [
      './search.html', // 纯静态搜索页（常驻池）
    ],
  },
  {
    name: '网友投稿',
    urls: [
      'https://www.bilibili.com/video/BV1fy4y1L7Rq/', // 《明日方舟》夏日嘉年华限时活动宣传PV
      'https://www.bilibili.com/video/BV18E4m1d7b7/', // 《原神》纳塔交响音乐现场
      'https://www.bilibili.com/video/BV1HfKiz3Ezf/', // 《崩坏：星穹铁道》白厄角色PV——「日冕」
      'https://www.bilibili.com/video/BV1EBcFznE2H/', // 《明日方舟》EP - 铁花飞
      'https://www.bilibili.com/video/BV1L4421S7Kr/', // 千恋＊万花OP动画
      'https://www.bilibili.com/video/BV1x5411o7Kn/', // 烂苹果
    ],
  },
]

// 3★ 池为空时的兜底去向
const FALLBACK_URL = './search.html'

// ---------------------------------------------------------------------------
// 池子组装与校验
// ---------------------------------------------------------------------------

const groupMap = new Map(GROUPS.map(group => [group.name, group]))

function cardsOf(group, label, allowEmpty) {
  if (!group) throw new Error(`跳转配置错误：${label} 不存在。`)
  if (!Array.isArray(group.urls))
    throw new Error(`跳转配置错误：分组「${group.name || label}」缺少 urls 数组。`)
  if (group.urls.length === 0 && !allowEmpty) {
    throw new Error(`跳转配置错误：分组「${group.name || label}」没有链接。`)
  }
  return group.urls.map(url => {
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error(`跳转配置错误：分组「${group.name || label}」里有空链接。`)
    }
    return { url: url.trim(), group: group.name || label }
  })
}

// 按 GROUPS 里的分组名取卡（可指定多个分组拼成一个池）
function collect(keys, label, options) {
  const allowEmpty = options && options.allowEmpty
  return keys.flatMap(key => cardsOf(groupMap.get(key), `${label} 里的「${key}」`, allowEmpty))
}

// 直接用写死分组取卡（3★ 狗粮池用）
function collectGroups(groups, label, options) {
  const allowEmpty = options && options.allowEmpty
  return groups.flatMap((group, index) => cardsOf(group, `${label}[${index}]`, allowEmpty))
}

// 限定 5★ 卡池：每个条目指向一个分组，可以单独带 video / share
function collectLimited(entries, label) {
  return entries.flatMap((entry, index) => {
    if (!entry || typeof entry.group !== 'string') {
      throw new Error(`跳转配置错误：${label}[${index}] 缺少 group 字段。`)
    }
    const cards = cardsOf(
      groupMap.get(entry.group),
      `${label}[${index}] 里的「${entry.group}」`,
      false,
    )
    const video = entry.video === undefined ? null : entry.video
    if (video !== null && (typeof video !== 'string' || video.trim() === '')) {
      throw new Error(`跳转配置错误：${label}[${index}] 的 video 必须是非空字符串或省略。`)
    }
    const share = entry.share === undefined ? 1 : entry.share
    if (!Number.isFinite(share) || share <= 0) {
      throw new Error(`跳转配置错误：${label}[${index}] 的 share 必须是正数。`)
    }
    return cards.map(card => ({ ...card, video: video === null ? null : video.trim(), share }))
  })
}

// 一个稀有度池 = 可选的 UP 子池 + 其余卡。
// up 为空时 upShare 归零，整个池等概率（就是原版行为）。
function poolPlan(cards, upCards, upShare) {
  return {
    cards,
    up: upCards,
    upShare: upCards.length ? upShare : 0,
    all: upCards.concat(cards),
  }
}

// 先按 UP_SHARE 决定走 UP 子池还是其余池，再在子池内等概率抽
function pickFromPlan(plan) {
  if (plan.up.length && random() < plan.upShare) return pickFrom(plan.up)
  return pickFrom(plan.cards)
}

const LIMITED_POOL = collectLimited(LIMITED_CARDS, 'LIMITED_CARDS').map(card => ({
  ...card,
  rarity: 'UR',
}))
const LIMITED_PLAN = poolPlan(LIMITED_POOL, [], 0)

const STANDARD_POOL = collect(STANDARD_KEYS, 'STANDARD_KEYS').map(card => ({
  ...card,
  rarity: 'SSR',
}))
const STANDARD_PLAN = poolPlan(STANDARD_POOL, [], 0)

const PREFERRED_POOL = collect(PREFERRED_KEYS, 'PREFERRED_KEYS').map(card => ({
  ...card,
  rarity: 'SR',
}))
const PREFERRED_UP = collect(PREFERRED_UP_KEYS, 'PREFERRED_UP_KEYS', { allowEmpty: true }).map(
  card => ({
    ...card,
    rarity: 'SR',
    up: true,
  }),
)
const PREFERRED_PLAN = poolPlan(PREFERRED_POOL, PREFERRED_UP, CONFIG.UP_SHARE)

// 3★ 的两个子池都从 FILLER_GROUPS 里按分组名取，所以 UP 组和其余组是同一个写法
const FILLER_POOL = collectGroups(
  FILLER_GROUPS.filter(group => !FILLER_UP_KEYS.includes(group.name)),
  'FILLER_GROUPS',
  { allowEmpty: true },
).map(card => ({ ...card, rarity: 'R' }))
const FILLER_UP = collectGroups(
  FILLER_GROUPS.filter(group => FILLER_UP_KEYS.includes(group.name)),
  'FILLER_GROUPS(UP)',
  { allowEmpty: true },
).map(card => ({ ...card, rarity: 'R', up: true }))
const FILLER_PLAN = poolPlan(FILLER_POOL, FILLER_UP, CONFIG.UP_SHARE)

// 配置里写了 UP 组名但 FILLER_GROUPS 里没有对应分组时直接报错，避免静默失效
for (const key of FILLER_UP_KEYS) {
  if (!FILLER_GROUPS.some(group => group.name === key)) {
    throw new Error(`跳转配置错误：FILLER_UP_KEYS 里的「${key}」在 FILLER_GROUPS 中不存在。`)
  }
}

if (!LIMITED_PLAN.all.length) throw new Error('跳转配置错误：限定 5★ 池不能为空。')
if (!STANDARD_PLAN.all.length) throw new Error('跳转配置错误：常驻池不能为空。')
if (!PREFERRED_PLAN.all.length) throw new Error('跳转配置错误：4★ 池不能为空。')
if (CONFIG.HARD_PITY_5 < 1 || CONFIG.SOFT_PITY_5 < 1 || CONFIG.SOFT_PITY_5 > CONFIG.HARD_PITY_5) {
  throw new Error('跳转配置错误：保底参数不合法（需要 1 <= SOFT_PITY_5 <= HARD_PITY_5）。')
}
if (!Number.isFinite(CONFIG.UP_SHARE) || CONFIG.UP_SHARE < 0 || CONFIG.UP_SHARE > 1) {
  throw new Error('跳转配置错误：UP_SHARE 必须在 0~1 之间。')
}
if (!FILLER_PLAN.all.length) {
  // 用 debug 级别，避免每次打开网站都在控制台刷一条警告
  const warn = console.debug || console.log
  warn(
    '[卡池] 3★ 池为空，相关结果会降级为 4★ 或 ' +
      FALLBACK_URL +
      '。往 FILLER_GROUPS 里填链接即可启用。',
  )
}

// 这张卡要播哪个启动动画（没有就返回 null = 直接跳转）
function startupVideoOf(card) {
  if (!card || card.rarity !== 'UR') return null
  const video = card.video === undefined ? STARTUP.DEFAULT_VIDEO : card.video
  if (typeof video !== 'string' || video.trim() === '') return null
  // 支持 video/xxx.mp4 和 /video/xxx.mp4 两种写法
  const clean = video.trim().replace(/^\.?\//, '')
  return './' + clean
}

// ---------------------------------------------------------------------------
// 伪随机数发生器（mulberry32）
// ---------------------------------------------------------------------------

function readParam(name) {
  const match = new RegExp('[?&]' + name + '=([^&#]*)').exec(window.location.search)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

const seedText = readParam('seed')
const seedNumber = seedText === null ? NaN : Number(seedText)
const forcedSeed = Number.isFinite(seedNumber) ? seedNumber >>> 0 : null
let rngState =
  (forcedSeed === null ? Date.now() ^ Math.floor(Math.random() * 0xffffffff) : forcedSeed) >>> 0

// ?force=ur 强制本次抽中限定 5★（只为调试启动动画，正常访客不会用到）
const forceRarity = (readParam('force') || '').toLowerCase()

function random() {
  rngState = (rngState + 0x6d2b79f5) >>> 0
  let t = rngState
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// ---------------------------------------------------------------------------
// 抽卡状态（跨访问持久化，保底才有意义）
// ---------------------------------------------------------------------------

const defaultState = () => ({
  version: 2,
  totalPulls: 0,
  pity5: 0, // 距上次 5★ 已经抽了多少次
  pity4: 0, // 距上次 4★ 及以上已经抽了多少次
  guaranteeUp: false, // 大保底：下个 5★ 必为限定 UP
  lossStreak: 0, // 连续歪了几次（捕获明光用）
  lastStandardUrl: null, // 常驻池小保底用
  limitedHits: {}, // 每个限定链接出货次数（自检用）
})

let storageBroken = false

function loadState() {
  const state = defaultState()
  let raw = null
  try {
    raw = window.localStorage.getItem(CONFIG.STORAGE_KEY)
  } catch {
    storageBroken = true
    return state
  }
  if (!raw) return state

  let saved
  try {
    saved = JSON.parse(raw)
  } catch {
    return state
  }
  if (!saved || saved.version !== 2) return state

  const number = (value, fallback) =>
    Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
  state.totalPulls = number(saved.totalPulls, 0)
  state.pity5 = number(saved.pity5, 0)
  state.pity4 = number(saved.pity4, 0)
  state.guaranteeUp = saved.guaranteeUp === true
  state.lossStreak = number(saved.lossStreak, 0)
  state.lastStandardUrl = typeof saved.lastStandardUrl === 'string' ? saved.lastStandardUrl : null
  if (saved.limitedHits && typeof saved.limitedHits === 'object') {
    for (const key of Object.keys(saved.limitedHits)) {
      const value = saved.limitedHits[key]
      if (Number.isFinite(value) && value >= 0) state.limitedHits[key] = Math.floor(value)
    }
  }
  return state
}

function saveState(state) {
  try {
    window.localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state))
  } catch {
    storageBroken = true
  }
}

const state = loadState()

// ---------------------------------------------------------------------------
// 抽卡
// ---------------------------------------------------------------------------

// 池内按顺序平滑衰减加权，排在前面的链接略常见（可用 weight 字段覆盖）
function weightsOf(pool, dampingFor) {
  const weights = pool.map((card, index) => {
    const decay = 1 / Math.pow(index + 1, CONFIG.WEIGHT_CURVE)
    const own = Number.isFinite(card.weight) && card.weight > 0 ? card.weight : 1
    return decay * own * (dampingFor ? dampingFor(card) : 1)
  })
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  return total > 0 ? weights : pool.map(() => 1)
}

function weightedIndex(weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let roll = random() * total
  for (let index = 0; index < weights.length; index++) {
    roll -= weights[index]
    if (roll < 0) return index
  }
  return weights.length - 1
}

const pickFrom = (pool, dampingFor) => pool[weightedIndex(weightsOf(pool, dampingFor))]

// 按 UP 机制从池计划里抽一张：先决定走 UP 子池还是其余卡，再在子池内等概率
function pickFromPlan(plan) {
  if (plan.up.length && random() < plan.upShare) return pickFrom(plan.up)
  return pickFrom(plan.cards)
}

// 本次 5★ 的出货率（软保底曲线）
function fiveStarRate(state) {
  if (state.pity5 >= CONFIG.HARD_PITY_5 - 1) return 1
  if (state.pity5 < CONFIG.SOFT_PITY_5 - 1) return CONFIG.BASE_RATE_5
  const rate = CONFIG.BASE_RATE_5 + (state.pity5 - CONFIG.SOFT_PITY_5 + 1) * CONFIG.SOFT_PITY_STEP_5
  return Math.min(1, Math.max(0, rate))
}

// 抽中 5★：走大小保底 + 捕获明光
function roll5Star() {
  const pity = state.pity5
  const wasGuaranteed = state.guaranteeUp
  const upRate =
    state.lossStreak >= CONFIG.RADIANCE_LOSSES ? CONFIG.RADIANCE_UP_RATE : CONFIG.UP_RATE
  const radiance = !wasGuaranteed && upRate > CONFIG.UP_RATE

  if (wasGuaranteed || random() < upRate) {
    const card = pickFromPlan(LIMITED_PLAN)
    state.guaranteeUp = false
    state.lossStreak = 0
    state.limitedHits[card.url] = (state.limitedHits[card.url] || 0) + 1
    return { ...card, pity, guaranteed: wasGuaranteed, radiance }
  }

  const card = pickFrom(STANDARD_PLAN.cards, entry =>
    entry.url === state.lastStandardUrl ? CONFIG.STANDARD_REPEAT_DAMPING : 1,
  )
  state.guaranteeUp = true
  state.lossStreak += 1
  state.lastStandardUrl = card.url
  return { ...card, pity, guaranteed: false, radiance: false, lost: true }
}

// 抽一张
function drawOne(state) {
  const rate5 = fiveStarRate(state)
  const rate4 = Math.min(1 - rate5, CONFIG.BASE_RATE_4)
  const roll = random()

  let card

  if (roll < rate5 || forceRarity === 'ur') {
    card = roll5Star()
    state.pity5 = 0
    state.pity4 = 0
  } else if (roll < rate5 + rate4 || state.pity4 >= CONFIG.HARD_PITY_4 - 1) {
    card = { ...pickFromPlan(PREFERRED_PLAN), pity: state.pity5 }
    state.pity5 += 1
    state.pity4 = 0
  } else if (FILLER_POOL.length) {
    card = { ...pickFromPlan(FILLER_PLAN), pity: state.pity5 }
    state.pity5 += 1
    state.pity4 += 1
  } else if (random() < CONFIG.FILLER_FALLBACK_UPGRADE) {
    // 3★ 池还没填链接：提升成 4★
    card = { ...pickFromPlan(PREFERRED_PLAN), pity: state.pity5, group: '3★池未配置（提升为4★）' }
    state.pity5 += 1
    state.pity4 = 0
  } else {
    // 兜底：走站内搜索页
    card = { url: FALLBACK_URL, group: '3★池未配置（兜底）', rarity: 'R', pity: state.pity5 }
    state.pity5 += 1
    state.pity4 += 1
  }

  state.totalPulls += 1
  return { ...card, rate5 }
}

// 多抽（10 连）：逐张判定，取最高稀有度那张决定跳转
const RARITY_ORDER = { UR: 3, SSR: 3, SR: 2, R: 1 }

function drawMany(count) {
  const cards = []
  for (let index = 0; index < count; index++) cards.push(drawOne(state))
  let best = cards[0]
  for (const card of cards) {
    if (RARITY_ORDER[card.rarity] > RARITY_ORDER[best.rarity]) best = card
  }
  return { cards, best }
}

// ---------------------------------------------------------------------------
// 跳转地址（末尾带一个不影响页面的抽卡标记，方便回地址栏确认）
// ---------------------------------------------------------------------------

function targetUrl(card) {
  if (!CONFIG.PULL_MARK) return card.url
  const mark = card.rarity.toLowerCase() + '-' + card.pity
  if (/^\.{0,2}\//.test(card.url) || card.url.startsWith('?')) {
    // 站内页面用 query 标记，避免顶掉它自己的 hash
    return card.url + (card.url.indexOf('?') === -1 ? '?' : '&') + 'gacha=' + mark
  }
  return card.url.split('#')[0] + '#gacha-' + mark
}

// ---------------------------------------------------------------------------
// 启动动画：全屏播一段视频，播完（或点击跳过 / 超时）再跳转
// ---------------------------------------------------------------------------

// 只执行一次，防止重复跳转
function once(fn) {
  let done = false
  return () => {
    if (done) return
    done = true
    fn()
  }
}

// 浏览器会不会直接禁止带声音自动播放？
// Chromium 的规则是：非安全来源（不是 https / localhost / 127.0.0.1）一律禁止。
function autoplaySoundRisky() {
  try {
    const location = window.location
    const protocol = location.protocol
    if (protocol === 'https:' || protocol === 'file:') return false
    const hostname = location.hostname
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return false
    return true
  } catch {
    return false
  }
}

// 统一的控制台诊断（始终输出，方便线上排查「为什么没声音」）
function logStartup(message, extra) {
  try {
    const sink = console.info || console.log
    if (extra === undefined) sink('[启动动画] ' + message)
    else sink('[启动动画] ' + message, extra)
  } catch {
    /* 忽略 */
  }
}

// 返回 true 表示「动画已接管跳转」，主流程不要再立刻 replace
function playStartupVideo(videoPath, next) {
  const doc = typeof document === 'undefined' ? null : document
  const host = doc && (doc.body || doc.documentElement)
  if (!doc || !host || !doc.createElement) return false

  // 跳转时顺手清掉挂在 document 上的声音监听，避免残留
  const onTeardown = []
  const go = once(() => {
    for (const remove of onTeardown) {
      try {
        remove()
      } catch {
        /* 忽略 */
      }
    }
    next()
  })

  let root = null
  let video = null
  let loader = null

  try {
    root = doc.createElement('div')
    root.style.cssText =
      'position:fixed;left:0;top:0;right:0;bottom:0;background:#000;' +
      'z-index:2147483646;overflow:hidden;cursor:pointer'

    video = doc.createElement('video')
    video.setAttribute('playsinline', '')
    video.setAttribute('webkit-playsinline', '')
    video.setAttribute('disablepictureinpicture', '')
    video.preload = 'auto'
    video.muted = STARTUP.MUTED === true
    video.style.cssText =
      'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;background:#000'

    const source = doc.createElement('source')
    source.src = videoPath
    if (/\.webm($|\?)/i.test(videoPath)) source.type = 'video/webm'
    else if (/\.mp4($|\?)/i.test(videoPath)) source.type = 'video/mp4'
    video.appendChild(source)
    root.appendChild(video)

    // 右上角的提示条：显示跳过入口；声音被拦下时这里也提示「点击任意处开启声音」
    let hint = null
    if (typeof STARTUP.SKIP_HINT === 'string' && STARTUP.SKIP_HINT.trim() !== '') {
      hint = doc.createElement('div')
      hint.textContent = STARTUP.SKIP_HINT
      hint.style.cssText =
        'position:absolute;right:18px;top:16px;z-index:3;cursor:pointer;' +
        'padding:9px 16px;border:1px solid rgba(255,255,255,.35);border-radius:999px;' +
        'background:rgba(0,0,0,.45);color:rgba(255,255,255,.9);' +
        "font:14px/1.4 system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;" +
        'user-select:none;-webkit-user-select:none'
      // 点提示 = 跳过；注意别让这次点击冒泡出去当成「开启声音」
      const onSkip = event => {
        if (event) {
          if (typeof event.stopPropagation === 'function') event.stopPropagation()
          if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
          if (typeof event.preventDefault === 'function') event.preventDefault()
        }
        logStartup('用户点击跳过')
        go()
      }
      hint.addEventListener('click', onSkip)
      hint.addEventListener('touchend', onSkip)
      root.appendChild(hint)
    }

    // ---- 声音 ----
    // 页面一打开就按 MUTED:false 请求带声音播放。被自动播放策略拦下（HTTPS 但没有用户手势、
    // 或非 HTTPS 来源）时先静音把画面放出来，然后等用户第一次点击：立刻解除静音并从头重播，
    // 这样不会因为前几秒静音而错过开场。
    let soundBlocked = false
    let soundResolved = false

    const syncHint = () => {
      if (!hint) return
      hint.textContent = soundBlocked
        ? '🔇 点击任意处开声音　·　' + STARTUP.SKIP_HINT
        : STARTUP.SKIP_HINT
    }

    const markSoundBlocked = reason => {
      if (soundResolved || STARTUP.MUTED === true) return
      soundResolved = true
      soundBlocked = true
      logStartup('带声音自动播放被拦下，先静音播放画面；点击任意处即可开启声音', reason)
      if (autoplaySoundRisky()) {
        logStartup(
          '当前页面不是 HTTPS（或 localhost），Chromium 对非安全来源一律禁止带声音自动播放；' +
            '部署到 https 域名即可正常出声',
        )
      }
      syncHint()
    }

    // 用户第一次点击/按键：解除静音 + 从头重播
    const unlockSound = event => {
      if (soundResolved && !soundBlocked) return
      if (STARTUP.MUTED === true) return
      if (event && typeof event.preventDefault === 'function') event.preventDefault()
      soundResolved = true
      soundBlocked = false
      video.muted = false
      video.volume = 1
      try {
        video.currentTime = 0
      } catch {
        /* 忽略：元数据还没就绪时部分浏览器会抛错 */
      }
      const attempt = video.play()
      if (attempt && typeof attempt.catch === 'function') {
        attempt.catch(error => logStartup('点击后仍无法带声音播放', String(error && error.name)))
      }
      logStartup('用户交互，已开启声音并从头重播')
      syncHint()
    }
    ;['click', 'touchend', 'keydown'].forEach(type => {
      doc.addEventListener(type, unlockSound, true)
      onTeardown.push(() => doc.removeEventListener(type, unlockSound, true))
    })

    // 点任意处（提示条除外）＝开启声音，不再直接跳过
    root.addEventListener('click', unlockSound)
    root.addEventListener('touchend', unlockSound)

    // 加载中的进度条（只有真正开始播之前才显示）
    if (VIDEO_PROGRESS.SHOW && VIDEO_PROGRESS.BYTES > 0) {
      const track = doc.createElement('div')
      track.style.cssText =
        'position:fixed;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.18);z-index:2147483647'
      const bar = doc.createElement('div')
      bar.style.cssText = 'width:0;height:100%;background:#fff;transition:width .25s linear'
      track.appendChild(bar)
      root.appendChild(track)
      loader = {
        set(percent) {
          bar.style.width = Math.max(0, Math.min(100, percent)) + '%'
        },
        remove() {
          if (track.parentNode) track.parentNode.removeChild(track)
        },
      }
      video.addEventListener('progress', () => {
        if (!video.buffered || !video.buffered.length) return
        try {
          loader.set((video.buffered.end(video.buffered.length - 1) / (video.duration || 1)) * 100)
        } catch {
          /* 忽略：元数据就绪前部分浏览器访问 buffered 会抛错 */
        }
      })
    }
    const dropLoader = once(() => {
      if (loader) {
        loader.remove()
        loader = null
      }
    })
    video.addEventListener('playing', dropLoader)

    // 播放确实开始后再计时，避免把「加载慢」当成「播放时长」
    let timer = null
    video.addEventListener('playing', () => {
      if (timer === null && STARTUP.TIMEOUT > 0) timer = setTimeout(go, STARTUP.TIMEOUT * 1000)
    })
    // 静音是「被策略接管」而不是我们主动降级时，同步提示
    video.addEventListener('volumechange', () => {
      if (video.muted && !soundResolved && STARTUP.MUTED !== true) markSoundBlocked('volumechange')
    })
    video.addEventListener('ended', go)
    video.addEventListener('error', () => {
      logStartup(
        '素材加载或解码失败',
        video.error ? 'MediaError code ' + video.error.code : videoPath,
      )
      go()
    })
    // 兜底：连 playing 都没等到（网络挂起 / 自动播放被拒）也要能跳走
    setTimeout(
      () => {
        dropLoader()
        go()
      },
      (STARTUP.TIMEOUT > 0 ? STARTUP.TIMEOUT + 5 : 30) * 1000,
    )

    host.appendChild(root)

    logStartup('开始播放 ' + videoPath + '（请求带声音：' + (STARTUP.MUTED !== true) + '）')
    const attempt = video.play()
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(error => {
        const name = String((error && error.name) || error)
        if (name === 'NotAllowedError') {
          // 带声音被自动播放策略拦下：先静音把画面放起来，用户一点击就出声
          markSoundBlocked(name)
          video.muted = true
          const retry = video.play()
          if (retry && typeof retry.catch === 'function') {
            retry.catch(secondError => {
              logStartup(
                '静音重试仍然失败，等待兜底跳转',
                String((secondError && secondError.name) || secondError),
              )
            })
          }
          return
        }
        // 素材本身的问题（NotSupportedError 等）：交给 error 事件与兜底计时
        logStartup('播放失败', name)
      })
    }
  } catch {
    if (root && root.parentNode) root.parentNode.removeChild(root)
    return false
  }

  return true
}

// ---------------------------------------------------------------------------
// 控制台自检（?probe=1）
// ---------------------------------------------------------------------------

function describe(card) {
  const info = {
    稀有度: card.rarity,
    分组: card.group,
    地址: card.url,
    距上次5星: card.pity,
  }
  const video = startupVideoOf(card)
  if (video) info.启动动画 = video
  if (card.rarity === 'UR') info.限定 = true
  if (card.lost) info.歪了 = '下个5★必是限定UP'
  if (card.guaranteed) info.大保底 = '本次必为限定UP'
  if (card.radiance) info.捕获明光 = '已触发'
  return info
}

function probeOnce() {
  const card = drawOne(state)
  console.log('[卡池] 本次抽卡', describe(card), '5★出率=' + (card.rate5 * 100).toFixed(1) + '%')
  console.log('[卡池] 抽卡进度', {
    总抽数: state.totalPulls,
    距上次5星: state.pity5,
    距上次4星: state.pity4,
    大保底: state.guaranteeUp,
    连续歪: state.lossStreak,
  })
  console.log('[卡池] 跳转目标', targetUrl(card))
  if (storageBroken) console.log('[卡池] localStorage 不可用，当前为无状态模式（保底不跨访问）')
}

function probeSimulate(times) {
  const snapshot = JSON.stringify(state)
  const stats = {
    五星: 0,
    四星: 0,
    三星: 0,
    限定UP: 0,
    常驻歪: 0,
    最长连续三星: 0,
    最长未出五星: 0,
  }
  let sinceFive = 0
  let sinceFour = 0
  let firstFive = null
  for (let index = 0; index < times; index++) {
    const card = drawOne(state)
    sinceFive += 1
    if (card.rarity === 'UR' || card.rarity === 'SSR') {
      stats.五星 += 1
      if (firstFive === null) firstFive = index + 1
      if (card.rarity === 'UR') stats.限定UP += 1
      else stats.常驻歪 += 1
      if (sinceFive > stats.最长未出五星) stats.最长未出五星 = sinceFive
      sinceFive = 0
    }
    if (card.rarity === 'SR') {
      stats.四星 += 1
      sinceFour = 0
    } else {
      sinceFour += 1
      if (sinceFour > stats.最长连续三星) stats.最长连续三星 = sinceFour
    }
    if (card.rarity === 'R') stats.三星 += 1
  }
  console.log('[卡池] 模拟结果（' + times + ' 抽，不写入真实进度）', {
    五星数: stats.五星,
    四星数: stats.四星,
    三星数: stats.三星,
    五星占比: ((stats.五星 / times) * 100).toFixed(2) + '%',
    四星占比: ((stats.四星 / times) * 100).toFixed(2) + '%',
    三星占比: ((stats.三星 / times) * 100).toFixed(2) + '%',
    限定UP占比: ((stats.限定UP / times) * 100).toFixed(2) + '%',
    常驻歪占比: ((stats.常驻歪 / times) * 100).toFixed(2) + '%',
    平均几抽一个五星: (times / stats.五星).toFixed(2),
    首次五星出现在第几抽: firstFive,
    最长连续未出五星: stats.最长未出五星,
    最长连续三星: stats.最长连续三星,
    限定链接出货: state.limitedHits,
  })
  try {
    window.localStorage.setItem(CONFIG.STORAGE_KEY, snapshot)
  } catch {
    /* 忽略 */
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

// 引导页完全由 JS 生成；仅 UR 配有视频时调用。
function createStartupGuide() {
  if (!document.body) return null
  const root = document.createElement('div')
  root.id = 'startup-guide'
  root.innerHTML = `<style>
      :root { color-scheme: light; color: #000; background: #fff; font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; min-height: 100svh; display: grid; place-items: center; padding: 48px 24px; }
      main { width: min(640px, 100%); }
      .ticket { width: 104px; height: 128px; border: 2px solid #000; border-radius: 14px; display: grid; place-items: center; transform: rotate(-8deg); margin: 0 0 44px 8px; box-shadow: 8px 8px 0 #000; }
      .ticket span { font: 700 64px/1 monospace; }
      h1 { margin: 0; font-size: clamp(36px, 7vw, 56px); line-height: 1.25; letter-spacing: -.05em; font-weight: 800; }
      h1 span { display: block; }
      p { margin: 24px 0 36px; font-size: 16px; line-height: 1.9; }
      button { width: 100%; min-height: 64px; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 18px 24px; border: 2px solid #000; border-radius: 14px; background: #000; color: #fff; font: inherit; font-weight: 700; text-align: left; cursor: pointer; }
      button:not(:disabled):hover { background: #fff; color: #000; }
      button:focus-visible { outline: 2px solid #000; outline-offset: 6px; }
      button:disabled { cursor: wait; }
      .arrow { font-size: 24px; }
      .note { margin: 16px 0 0; font-size: 12px; }
      @media (max-width: 480px) { .ticket { width: 80px; height: 100px; margin-bottom: 36px; } .ticket span { font-size: 48px; } }
    </style><main>
      <div class="ticket" aria-hidden="true"><span>?</span></div>
      <h1><span>金光已经亮了。</span><span>该你启动了。</span></h1>
      <button id="open-surprise" type="button" disabled><span id="open-label">点击，启动！</span><span class="arrow" aria-hidden="true">↗</span></button>
    </main>`
  document.body.appendChild(root)
  return root
}

const resetParam = readParam('reset')
if (resetParam === '1' || resetParam === 'true') {
  try {
    window.localStorage.removeItem(CONFIG.STORAGE_KEY)
  } catch {
    /* 忽略 */
  }
  Object.assign(state, defaultState())
  if (readParam('probe') !== null) console.log('[卡池] 保底进度已重置')
}

const probeParam = readParam('probe')
if (probeParam !== null && probeParam !== '0' && probeParam !== 'false') {
  const simCount = Number(readParam('sim'))
  if (Number.isFinite(simCount) && simCount > 0)
    probeSimulate(Math.min(200000, Math.floor(simCount)))
  else probeOnce()
} else {
  const pullParam = Number(readParam('pull'))
  const pullCount =
    Number.isFinite(pullParam) && pullParam > 1
      ? Math.min(CONFIG.MAX_PULLS, Math.floor(pullParam))
      : 1
  const { cards, best } = drawMany(pullCount)
  // 立即抽卡存档；引导页只等待播放，不会重新抽卡。
  saveState(state)
  if (pullCount > 1) console.log('[卡池] ' + pullCount + ' 连', cards.map(describe))
  const destination = targetUrl(best)
  const video = startupVideoOf(best)
  const redirect = () => window.location.replace(destination)
  if (best.rarity !== 'UR' || !video || typeof document === 'undefined') {
    redirect()
  } else {
    const showGuide = () => {
      const guide = createStartupGuide()
      if (!guide) {
        redirect()
        return
      }
      const button = guide.querySelector('#open-surprise')
      button.disabled = false
      const begin = once(() => {
        button.disabled = true
        const label = guide.querySelector('#open-label')
        const note = guide.querySelector('#entry-note')
        if (label) label.textContent = '正在启动…'
        if (note) note.textContent = '动画加载中，请稍候。'
        // 点击事件内同步调用 play，保留用户激活状态。
        if (!playStartupVideo(video, redirect)) redirect()
      })
      document.addEventListener('click', begin, { once: true })
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showGuide, { once: true })
    } else {
      showGuide()
    }
  }
}
