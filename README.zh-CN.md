# Skybox Exporter

一键导出你在 [Skybox AI](https://skybox.blockadelabs.com) 生成的 360° 全景原图（8K equirectangular JPG）——免费账号没有官方下载按钮，本扩展补上这个缺口。

[English README](./README.md)

![分享页导出按钮](docs/screenshots/share-page-fab.png)

## 功能

- 在 Skybox 页面注入导出按钮（生成器页面与 `/e/<hash>` 公开分享页均可）：
  - **导出无横幅版 (8K)**：本地 canvas 裁掉官方上下水印横幅（实测各 17%），JPEG q0.95
  - **原图（带水印）**：官方原样图直下，字节无损
- 工具栏 popup 展示当前 skybox 卡片（缩略图 / 标题 / 状态），提供同样的导出选项
- 下载文件名自动使用 skybox 标题

| 原图（带水印横幅） | 无横幅裁剪版 |
|---|---|
| ![带水印](docs/images/sample-watermarked.jpg) | ![无横幅](docs/images/sample-no-banner.jpg) |

## 原理

Skybox 前端 viewer 渲染全景时必须从后端加载原图。本扩展在页面内检测该原图 URL：分享页解析 SSR 注入的 RSC `initialData`；生成器页面复用前端自身 `/api/proxy` 接口主动查询 + `performance` 资源条目被动观察兜底。随后直接下载原始文件——不做 canvas 截图，画质无损（最高 8192×4096）。裁剪在本地浏览器完成。

## 安装（开发者模式）

1. 下载 Releases 的 `skybox-exporter-<版本>-chrome.zip` 并解压，或源码构建（`pnpm build`）
2. Chrome 打开 `chrome://extensions`，开启「开发者模式」
3. 「加载已解压的扩展程序」选择 `chrome-mv3` 目录
4. 打开你的任一 skybox（或分享链接），使用右下角按钮导出

## 开发

```bash
pnpm install
pnpm dev      # 开发模式（HMR）
pnpm build    # 构建到 .output/chrome-mv3
pnpm test     # 单元测试（vitest）
pnpm e2e      # 端到端闭环（mock 站点 + 真实 Chrome 加载扩展，需 xvfb）
```

技术栈：WXT 0.21 · Vue 3 · TypeScript · Manifest V3。完整的逆向与验证记录见 [docs/verification.md](docs/verification.md)。

## 免责声明

**本项目仅供学习与个人研究用途。**

- 本项目为独立的非官方工具，**与 Blockade Labs 无任何隶属、背书或赞助关系**。"Skybox AI"、"Blockade Labs" 商标归其所有者所有。
- 本项目**未破解、绕过或规避任何付费功能**。它仅保存你自己的浏览器在查看你自己账号内容时已经加载过的图像数据，且使用的是平台自身公开提供的服务端点。
- 「原图」导出**完整保留**官方水印横幅；「无横幅版」是对你已合法获得的内容在你自己设备上进行的纯本地裁剪操作，全程不访问任何 premium 专属资源。
- 你有责任确保对下载内容的使用符合 Blockade Labs 的服务条款与内容许可（免费内容为 CC-BY——使用时须署名）。
- 本软件按"原样"提供，不承担任何担保；作者不对任何误用及其后果负责。
- 如果你是权利方并对本项目有疑虑，请开 issue 联系，我们会及时处理乃至下架。

## License

[MIT](./LICENSE)
