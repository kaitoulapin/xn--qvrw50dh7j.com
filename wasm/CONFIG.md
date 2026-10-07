# 配置说明（schemaVersion 1）

唯一手填配置为 `config.json`。修改后重新编译部署；不支持旧结构，未知字段会在构建时报告具体路径。链接和列表顺序保留，title 是链接说明，不参与抽样。

## 规则映射

以下旧参数原来位于 `config` 对象：

| 旧字段 | 新路径 |
|---|---|
| BASE_RATE_5 | gacha.fiveStar.baseRate |
| SOFT_PITY_5 | gacha.fiveStar.softPityStart |
| SOFT_PITY_STEP_5 | gacha.fiveStar.softPityStep |
| HARD_PITY_5 | gacha.fiveStar.hardPity |
| UP_RATE | gacha.fiveStar.limitedRate |
| RADIANCE_LOSSES | gacha.fiveStar.radiance.lossThreshold |
| RADIANCE_UP_RATE | gacha.fiveStar.radiance.limitedRate |
| BASE_RATE_4 | gacha.fourStar.baseRate |
| HARD_PITY_4 | gacha.fourStar.hardPity |
| MAX_PULLS | gacha.maxPulls |
| WEIGHT_CURVE | gacha.weightCurve |
| FILLER_FALLBACK_UPGRADE | gacha.emptyRPoolUpgradeRate |
| STANDARD_REPEAT_DAMPING | pools.SSR.repeatDamping |
| UP_SHARE | pools.UR/SR/R.featuredRate，分别独立设置 |
| PULL_MARK | redirect.appendPullMark |
| STORAGE_KEY | storage.key |

概率使用 0～1；保底抽数、捕获明光阈值、最大连抽数使用正整数。软保底起始抽首次增加一个 softPityStep，不能超过硬保底。捕获明光概率不能小于普通限定概率。weightCurve ≥ 0，按列表位置乘以 `1 / (index + 1)^weightCurve`；0 时位置不影响概率。常驻重复抑制仅针对上一次常驻 URL。

## 卡池与卡片

`limited/standard/preferred/filler` 分别迁移为 `pools.UR/SSR/SR/R`。`cards` 保留，原 `up` 列表改为 `featuredCards`；SSR 不支持精选列表。UR、SR、R 的 featuredRate 目前均为 0.5。普通列表为空时直接从非空精选列表抽取，不消耗精选概率随机数；精选列表为空时直接抽普通列表。

每张卡必须有 url 和 title，可选 weight（有限正数，缺省 1）。原 share 改为 weight；权重只在选中的列表内归一化，并不是百分比。不要填写 rarity 或 up，运行时从所在池和列表补齐；URL、标签与顺序保持原样。R 两个列表可以同时为空，此时按 emptyRPoolUpgradeRate 决定提升四星或跳兜底，其余池必须非空。

## 视频、存储、跳转

| 旧字段 | 新路径 |
|---|---|
| startup.DEFAULT_VIDEO | media.defaultVideo（可为 null） |
| startup.TIMEOUT | media.timeoutSeconds（秒，0 表示不启用播放时长超时，仍有加载兜底） |
| startup.MUTED | media.muted |
| startup.SKIP_HINT | media.skipHint（空字符串隐藏提示） |
| progress.SHOW | media.showProgress |
| progress.BYTES | 删除，构建自动产生每个素材的大小 |
| fallback | redirect.fallbackUrl |

仅 UR 可配置 video。卡片缺省 video 时使用 defaultVideo，明确设置 null 时不播放。所有素材使用 pages 内的相对路径，不能带 `..`、反斜杠、查询或片段。Rust 构建读取真实大小，嵌入只读 media.videoBytes；该字段不应手填。每次 UR 播放使用选中素材的大小；现有浏览器指令仍保留 SHOW/BYTES 字段以维持兼容。

storage.key 保持 `buwanyuanshen.gacha.v2`，保存进度仍为 version 2。schemaVersion 是配置版本，与存储版本不同；本次无需清理浏览器保底。

## 验证

运行 `node scripts/build.js`，然后运行 Rust 单测、`scripts/test-wasm.js`、`scripts/test-wasm-host.js`、`scripts/test-live.mjs` 和 `scripts/test-gacha-audit.js`。

迁移验收额外执行 `node scripts/test-config-migration.js <旧版WASM路径>`：默认读取本次保留在 ignored target 中的 before.wasm。跨新旧版本对比允许 share→weight 字段改名，其余卡片、随机数状态、保底、目标和视频指令完全一致。此测试用于迁移验证；新 checkout 没有旧产物时需要提供路径，不加入日常构建必跑项。
