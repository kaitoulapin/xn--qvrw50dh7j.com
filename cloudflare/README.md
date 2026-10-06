# 直播状态部署

三个部署独立：主站 `mihoyo` 保持现有 Git 自动编译；状态站只包含 JSON；发布器仅运行 Cron。不要将主站 Git 构建关联到状态站，否则会覆盖运行中的状态。

## 网页控制台部署（推荐）

如果已完成状态站的 Route 配置，从第 3 步继续，无需删除或重建 Route。以下步骤不需要终端；`wrangler.jsonc` 不会因粘贴 JS 到编辑器而自动生效，Secret、Cron 和公开地址必须在控制台分别配置。

1. 创建名为 `mihoyo-live-status` 的静态资源 Worker，上传 `cloudflare/live-status/assets` 文件夹内容（根目录直接包含 `live-status.json` 和 `_headers`）。主站 Git 构建不要关联到此 Worker。
2. 为状态站添加 Worker Route：`你的现有网站域名/live-status.json`（无通配符），选择域名所在 Zone，确认 DNS 已代理。保留主站原有域名配置。状态站关闭 workers.dev 和预览 URL。直接访问状态路径应显示默认未知 JSON；如果仍显示 Hello World，说明只有 Route，尚未部署静态资源，首次 Cron 发布成功后也会将它替换为静态状态站。
3. 在账号头像菜单 → My Profile → API Tokens → Create Token → Create Custom Token，添加 Account → Workers Scripts → Edit，Account Resources 仅选择当前账号。复制 Token，仅用于第 5 步。此权限可能覆盖账号内其他 Worker，代码固定只发布 `mihoyo-live-status`，不能声称 Token 被限制到单个脚本。
4. 在 Workers & Pages 创建另一个 Worker，命名 **`mihoyo-live-publisher`**。可从 Hello World 模板创建，然后点 **Edit code**，用 `cloudflare/live-publisher/worker.mjs` 的完整内容替换默认代码，点击 **Deploy**。文件是独立 ES module，没有额外依赖；替换代码后再关闭公开地址。
5. 打开发布器 **Settings → Variables and Secrets → Add**，分别添加下面两个值，类型均选择 **Secret**，保存并部署配置：

   | 名称 | 值 |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | 第 3 步创建的 Token |
   | `CLOUDFLARE_ACCOUNT_ID` | 状态站所属 Cloudflare 账号 ID（32 位十六进制，不是 Zone ID） |

   账号 ID 可从控制台账号信息获取。不要把这两个值粘进代码或公开 JSON。
6. 在发布器 **Settings → Domains & Routes** 关闭 workers.dev 和 Preview URLs，不添加网站路由或自定义域名；在 **Settings → Trigger Events → Cron Triggers → Add** 选择自定义表达式，填写 `*/5 * * * *` 并保存。若入口名称稍有调整，寻找 Cron Triggers；不要使用 HTTP 请求触发检查。
7. 等待 Cron 配置传播及下一次执行（传播可能需要约 15 分钟）。访问现有网站的 `/live-status.json`，确认 JSON 的 `checkedAt` 更新、`expiresAt` 相差 600000 毫秒、房间为 42062，且响应头含 `Cache-Control: no-store`。`liveStatus: null` 表示查询不可用，也属于安全回退结果。排错时启用发布器日志，查看 `Live status published` 或失败消息；不要分享凭据。
8. 最后按现有 Git 流程部署主站 `mihoyo`。代码目前仅本地提交，未推送时线上不会获得新的直播判断功能。

## Wrangler 部署（可选）

如果改用终端，登录 Wrangler 后执行：

```sh
npx wrangler deploy --config cloudflare/live-status/wrangler.jsonc
npx wrangler secret put CLOUDFLARE_API_TOKEN --config cloudflare/live-publisher/wrangler.jsonc
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID --config cloudflare/live-publisher/wrangler.jsonc
npx wrangler deploy --config cloudflare/live-publisher/wrangler.jsonc
```

Route 仍需按网页步骤配置。后续使用 Wrangler 时先同步控制台修改，避免覆盖控制台的触发器配置。

## 工作方式与验收

Cron 每 5 分钟无登录查询 B 站，3 秒超时；结果有效 10 分钟。无效响应发布未知状态；发布失败保留上一版本，下次重试。发布器通过资源清单、上传、原子 PUT 部署，只触及状态站；`_headers` 通过 API 资源配置传入，不当作公开资源上传。

浏览器并行获取 WASM 和同源状态，状态最多等待 1 秒。Rust 只接受未过期且检查时间不在未来的直播结果。直播优先于 force/reset/pull，不修改保底；probe/compare 诊断保持原行为。服务器或本地浏览器时钟不准会保守回退抽卡。

本地 `node scripts/test-live.mjs`、`node scripts/test-wasm-host.js` 验证核心流程。用 `npx wrangler dev --test-scheduled --config cloudflare/live-publisher/wrangler.jsonc` 可触发本地 scheduled，但提供真实凭据后会**真实发布状态站**，仅在准备好上线时使用。

上线后检查：JSON 响应头；浏览器无 B 站请求；直播访问保底不变；主站推送与状态发布不会互相回退；访问量增加时发布器的执行量仍约每天 288 次。账户凭据未配置时本地模拟测试无法代替这些线上验收。

## 停用与费用

网页操作：先在发布器 Settings → Trigger Events 删除 Cron Trigger，再上传默认未知状态文件；或等待最后一份状态 10 分钟后过期。Wrangler 操作：将 crons 改为空数组并重新部署。不要只改本地文件而不更新线上配置。

静态资源访问免费，发布器使用账号共享 Workers Free 额度；不引入 R2/KV/GitHub Actions。不要主动升级 Paid。免费计划、API 限速和 Cron 调度仍受 Cloudflare 规则约束，不保证永久价格或严格 5 分钟 SLA。

参考：[资源上传](https://developers.cloudflare.com/workers/static-assets/direct-upload/)、[API 上传参数](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/)、[静态计费](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)。
