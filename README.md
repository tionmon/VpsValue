# VPS Value

一个明亮、响应式的 VPS 剩余价值计算器。它按真实日历周期计算大小月和闰年，支持服务端每日参考汇率、账单文字解析、可配置 AI 精确分析和 SVG 图片直链分享。

## 本地运行

```bash
npm run dev
```

打开 `http://127.0.0.1:4173`。

请通过上述地址使用完整功能。直接双击 `index.html` 仍可计算，但 AI 后台设置和图片直链需要服务器运行。

## 验证与构建

```bash
npm test
npm run build
```

构建结果位于 `dist/`，可部署计算器的纯前端部分；AI 后台与图片直链需要运行本项目的 Node 服务。

## 计算方式

- 当前账单周期由“下次付款日期”向前按月历推算，并保留月末语义。
- 剩余价值 = 周期价格 × 剩余自然日 ÷ 周期自然日。
- 外币价格只使用服务器 `/api/rates` 返回的参考汇率换算为 CNY，页面不提供手动倍率。
- 汇率来自 [Frankfurter](https://frankfurter.dev/)，由服务器按自然日缓存到 `data/rates-cache.json`；上游不可用时只回退到服务器最近缓存，不使用浏览器或内置汇率。
- 默认文本解析完全在浏览器内执行；只有主动配置并启用 AI 接口后，文字才会发送到该接口。

## AI 精确分析

页面的“AI 接口设置”兼容 OpenAI Chat Completions 格式，配置保存在服务器的 `data/ai-config.json`（已被 Git 忽略）。也可以使用环境变量：

```bash
AI_BASE_URL=https://api.example.com/v1
AI_MODEL=your-model
AI_API_KEY=your-secret
```

内置提示词位于 `scripts/ai-prompt.mjs`，会把账单内容视为不可信数据、限制固定 JSON 字段、统一日期/币种/周期，并禁止缺失信息的编造。远程修改接口设置默认关闭；生产环境推荐使用环境变量。如确需远程设置，可显式设置 `ALLOW_REMOTE_AI_CONFIG=true`。

设置窗口中的“测试接口”会用当前填写内容发送一条最小连接测试，不会保存设置，并返回模型名称与响应耗时。

## 图片直链

点击结果卡片的“图片直链”，服务器会生成带流动时间线的 1200×630 SVG 并保存到 `storage/shares/`。时间线节点会随账单周期进度改变，并返回图片 URL 与 Markdown。反向代理部署时可设置 `PUBLIC_BASE_URL=https://your-domain.example`，确保生成正确的公开地址。

生成图片默认不进入 Git；请将 `storage/shares/` 挂载到持久化磁盘并按需配置清理策略。
