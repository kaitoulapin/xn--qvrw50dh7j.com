# 直播状态部署

三个部署独立：主站 `mihoyo` 保持现有 Git 自动编译；状态站只包含 JSON；发布器仅运行 Cron。不要将主站 Git 构建关联到状态站，否则会覆盖运行中的状态。

## 首次配置

使用 Workers Free，登录 Wrangler 后依次操作：

1. `npx wrangler deploy --config cloudflare/live-status/wrangler.jsonc`
2. 在 Cloudflare 控制台为 `mihoyo-live-status` 添加 Worker **Route**：`你的现有网站域名/live-status.json`（无通配符），选择该域名所在 Zone。域名必须由 Cloudflare 代理。同一精确路由只绑定状态站；保留主站原有域名配置。不要给状态站增加额外公开域名。
3. 创建 API Token：指定本账号、Account → Workers Scripts → Edit。该权限可能覆盖账号内其他 Worker，代码固定只能发布 `mihoyo-live-status`；Cloudflare 无法用此权限进一步限制到一个脚本时，不要声称 Token 只有单脚本权限。
4. 依次执行以下命令，按提示输入凭据（避免放进命令历史）：

```sh
npx wrangler secret put CLOUDFLARE_API_TOKEN --config cloudflare/live-publisher/wrangler.jsonc
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID --config cloudflare/live-publisher/wrangler.jsonc
npx wrangler deploy --config cloudflare/live-publisher/wrangler.jsonc
```

5. 等待 Cron 生效并执行；检查现有域名的 `/live-status.json`，确认返回 JSON、`Cache-Control: no-store`、房间 42062 和最近的时间。Cron 配置传播可能需要约 15 分钟。
6. 最后按现有 Git 流程部署主站。只有这一步重新编译 Rust。

不要将 Token、账号 ID 写进配置或提交。发布器没有公开 URL、预览地址或网站路由；状态站没有业务脚本。公开访问只读静态 JSON，JSON 不包含部署身份信息。

## 工作方式与验收

Cron 每 5 分钟无登录查询 B 站，3 秒超时；结果有效 10 分钟。无效响应发布未知状态；发布失败保留上一版本，下次重试。发布器通过资源清单、上传、原子 PUT 部署，只触及状态站；`_headers` 通过 API 资源配置传入，不当作公开资源上传。

浏览器并行获取 WASM 和同源状态，状态最多等待 1 秒。Rust 只接受未过期且检查时间不在未来的直播结果。直播优先于 force/reset/pull，不修改保底；probe/compare 诊断保持原行为。服务器或本地浏览器时钟不准会保守回退抽卡。

本地 `node scripts/test-live.mjs`、`node scripts/test-wasm-host.js` 验证核心流程。用 `npx wrangler dev --test-scheduled --config cloudflare/live-publisher/wrangler.jsonc` 可触发本地 scheduled，但提供真实凭据后会**真实发布状态站**，仅在准备好上线时使用。

上线后检查：JSON 响应头；浏览器无 B 站请求；直播访问保底不变；主站推送与状态发布不会互相回退；访问量增加时发布器的执行量仍约每天 288 次。账户凭据未配置时本地模拟测试无法代替这些线上验收。

## 停用与费用

先在发布器配置中将 crons 改为空数组并重新部署，再重新部署默认未知状态站；或等待最后一份状态 10 分钟后过期。不要只改文件而不部署 Cron 配置。

静态资源访问免费，发布器使用账号共享 Workers Free 额度；不引入 R2/KV/GitHub Actions。不要主动升级 Paid。免费计划、API 限速和 Cron 调度仍受 Cloudflare 规则约束，不保证永久价格或严格 5 分钟 SLA。

参考：[资源上传](https://developers.cloudflare.com/workers/static-assets/direct-upload/)、[API 上传参数](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/)、[静态计费](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)。
