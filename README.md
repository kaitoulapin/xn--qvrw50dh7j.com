# 随机跳转网站 · Rust / WebAssembly

纯静态网站，抽卡、保底、调试参数及视频状态逻辑在 Rust 中执行。
普通结果在 WASM 初始化并完成抽卡后立即跳转；仅 UR 配有启动视频时显示点击播放引导。
HTML 保持最小入口，黑白引导页面内容嵌入 WASM。

## 文件结构

```text
wasm/
  Cargo.toml / Cargo.lock       Rust 项目和依赖锁定
  config.json                   概率、卡池、链接及视频配置（编译进 WASM）
  src/engine.rs                 mulberry32、抽卡、保底、存档解析、目标地址
  src/runtime.rs                调试自检、模拟统计、视频播放状态与跳转流程
  src/guide.html                UR 黑白引导页样式和内容（编译进 WASM）
  src/lib.rs                    WASM 内存及 JSON 调用接口
  build.rs / src/data.rs        构建时随机分块编码、运行时解码与缓存
scripts/
  build.js                      编译 Rust、生成 WASM 和混淆加载器
  cloudflare-build.sh            Cloudflare 安装固定 Rust 工具链并构建
  load.js                       浏览器适配层：DOM、媒体、存储和加载
  jump.js                       迁移前 JS，仅用于等价对照测试，不再部署
  convert.js                    旧 Cloudflare 构建命令的兼容入口
  test-wasm.js                  固定种子 JS / WASM 等价测试
  test-wasm-host.js             实际 WASM 与浏览器适配层的联动测试
pages/
  index.html / search.html      静态页面
  aha.js / aha.wasm            混淆加载器 / WASM 发布产物（gitignore，构建时生成）
  video/startup-01.mp4          已裁剪的启动视频
```

## 修改与本地构建

需要 Node.js、Rust（支持 edition 2024 的版本）和 WASM 编译目标。

```sh
rustup target add wasm32-unknown-unknown
node scripts/build.js
```

修改链接 / 概率时编辑 `wasm/config.json`；修改引导页编辑 `wasm/src/guide.html`。
只需提交源文件和 Cargo.lock；WASM 与混淆后的 JS 均在构建时生成，无需提交二进制。
不要再通过修改 `scripts/jump.js` 调整线上行为。

浏览器仍需要少量 JS 来加载 WASM、调用媒体和 DOM 接口，适配层不负责抽卡规则。
配置和引导页不再通过 include_str 以明文嵌入发布模块。
构建脚本每次生成随机参数；Rust build.rs 对数据分块、倒序、打乱块顺序，
使用各块独立的伪随机字节流和前一密文字节混合编码，并分拆存储种子。
运行时解码通过 black_box 防止 LTO 折叠回明文，配置首次使用时解码并缓存，引导页仅在需要时解码。
构建会扫描发布 WASM，若发现完整目标 URL 或完整原始配置 / HTML，则中止发布。
这是增加静态分析成本的混淆方案，不是保密加密：运行时内存、调用结果和实际跳转仍可观察。
公开仓库中的 config.json 和旧 jump.js 仍可直接读取原始链接。

## Cloudflare Workers 自动部署

连接 GitHub 仓库 `kaitoulapin/xn--qvrw50dh7j.com`：

| 设置 | 值 |
| --- | --- |
| Worker 名称 | `mihoyo` |
| 生产分支 | `main` |
| 根目录 | 仓库根目录（留空或 /） |
| 构建命令 | 留空（由 Wrangler 的 build.command 执行编译） |
| 部署命令 | `npx wrangler deploy` |

Worker 名称与 `wrangler.jsonc` 保持一致，只发布 `pages`。
Wrangler 部署前执行 `node scripts/build.js --cloudflare`。
Linux 构建环境会运行 `scripts/cloudflare-build.sh`，通过官方 rustup 安装 Rust 1.98.1
及 `wasm32-unknown-unknown`，随后编译 Rust，并通过 convert.js 混淆 load.js。
构建失败会阻止部署。Cloudflare 构建环境需要能访问 Rust 下载服务及 crates.io。

如果控制台仍配置了旧构建命令，请改为留空，避免部署前重复编译。
旧命令 `node scripts/convert.js scripts/jump.js pages/aha.js` 保留入口兼容，但现在会编译 Rust。
推送后的流程：拉取源码 → 安装 Rust → 编译 aha.wasm → 混淆 aha.js → 发布 pages。
浏览器通过 HTTPS 加载 aha.wasm，抽卡逻辑仍在客户端执行。

## 卡池与存档兼容

`config.json` 中 `config` 保留原来的概率配置：基础五星 4%、四星 30%、
第 12 抽起软保底、第 20 抽五星硬保底、四星 10 抽保底、50% UP、大保底、捕获明光、
常驻重复权重减半以及单次最多 10 抽。`WEIGHT_CURVE` 默认为 0（池内等概率）。

| 卡池 | 字段 | 稀有度 |
| --- | --- | --- |
| 限定 | `limited.cards` | UR |
| 常驻 | `standard.cards` | SSR |
| 投稿 / 四星 | `preferred.cards`，可选 `preferred.up` | SR |
| 狗粮 | `filler.cards`，可选 `filler.up` | R |

卡片使用 `url`、`group`、`rarity`，限定卡可带 `video`；可用 `weight` 指定池内权重。
四星 / 三星有 UP 子池时按 `config.UP_SHARE` 分配，其余卡按池内权重抽取。
视频配置位于 `startup`，加载进度配置位于 `progress`。
更换视频后更新 `progress.BYTES`，构建时会核对素材存在且大小一致。

继续使用 `buwanyuanshen.gacha.v2` 存档和 version 2 结构，已有保底记录无需清空。
抽卡后先存档再显示 UR 引导；开启视频不会重新抽卡。
引导按钮支持点击及键盘激活。视频支持有声播放、静音降级、点击开声、跳过、播完跳转和超时兜底。

## 调试与验证

| 参数 | 用途 |
| --- | --- |
| `?seed=123` | 固定 mulberry32 种子，可复现 |
| `?reset=1` | 重置保底 |
| `?pull=10` | 多抽，最高稀有度卡决定跳转，同级取第一张 |
| `?force=ur` | 与旧版相同：强制进入五星分支，仍按大小保底决定限定或常驻 |
| `?seed=42&force=ur` | 固定种子的限定视频引导测试 |
| `?probe=1` | 仅控制台自检，不跳转、不写入本次抽卡 |
| `?probe=1&sim=20000` | 模拟分布，恢复原存档，不跳转 |

```sh
cargo test --manifest-path wasm/Cargo.toml --locked
node scripts/test-wasm.js
node scripts/test-wasm-host.js
```

使用 HTTP 静态服务器预览 `pages`；浏览器通过 fetch 加载模块，不能直接用 file:// 打开。
