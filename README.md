# 随机跳转网站

纯静态网站，部署目录为 `pages`。修改链接和分组概率时编辑 `scripts/jump.js`。

## Cloudflare Workers 自动部署

在 Cloudflare Workers & Pages 创建 Worker 并连接 GitHub 仓库
`kaitoulapin/xn--qvrw50dh7j.com`，使用以下配置：

| 设置 | 值 |
| --- | --- |
| Worker 名称 | `mihoyo` |
| 生产分支 | `main` |
| 根目录 | 仓库根目录（留空或 `/`） |
| 构建命令 | `node scripts/convert.js scripts/jump.js pages/aha.js` |
| 部署命令 | `npx wrangler deploy` |

Worker 名称必须与 `wrangler.jsonc` 中的 `name` 一致。
仅发布 `pages` 目录；不需要 Worker 入口脚本，也不需要 GitHub Actions。
每次推送到 `main` 后，Cloudflare 自动生成混淆脚本 `pages/aha.js` 并部署。

## 本地生成混淆脚本

```sh
node scripts/convert.js scripts/jump.js pages/aha.js
```

混淆可增加分析成本，但无法保密。若不希望他人从 GitHub 读取原始链接配置，
请将仓库设为私有，并授权 Cloudflare 访问该仓库。
