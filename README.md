# Skybox Exporter

一键导出你在 [Skybox AI](https://skybox.blockadelabs.com) 生成的 360° 全景原图（免费账号无官方导出按钮）。

## 原理

Skybox 前端 viewer 渲染全景时必须从后端加载原图。本扩展在页面内检测该原图 URL
（`performance` 资源条目被动观察 + 复用页面自身 `/api/proxy` 接口主动查询），
通过 `chrome.downloads` 直接下载原始文件——不做 canvas 截图，画质无损（最高 8192×4096）。

## 功能

- 页面右下角注入「导出原图 (8K)」浮动按钮（检测到已完成 skybox 时出现）
- 工具栏 popup 展示当前 skybox 卡片（缩略图 / 标题 / 状态）并提供导出入口
- 下载文件名自动使用 skybox 标题（非法字符自动清洗）

## 开发

```bash
pnpm install
pnpm dev      # 开发模式（自动打开浏览器，HMR）
pnpm build    # 构建到 .output/chrome-mv3
pnpm test     # 单元测试（vitest）
pnpm e2e      # 端到端闭环验收（mock 站点 + Chrome for Testing 加载扩展，需 xvfb）
```

> e2e 说明：Chrome 137+ branded 版已移除 `--load-extension`，脚本自动探测
> playwright 缓存中的 Chrome for Testing / Chromium；也可用 `CHROME_PATH=<path>` 指定。

## 安装（开发者模式）

1. `pnpm build`
2. Chrome 打开 `chrome://extensions`，开启「开发者模式」
3. 「加载已解压的扩展程序」选择 `.output/chrome-mv3`

## 合规声明

- 仅供导出**本人账号生成**的内容；生成内容的许可条款以 Blockade Labs 官方为准（免费内容为 CC-BY）。
- 本项目与 Blockade Labs 无关，为非官方工具；不提供官方 premium 导出格式（HDRI / cube-map / 3D 等）的任何能力。
- e2e 使用的 `http://127.0.0.1/*` content script 匹配仅用于本地自动化验收。

## License

MIT
