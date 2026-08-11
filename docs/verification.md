# 验收证据记录

## 1. 单元测试（15/15 PASS）

`utils/skybox-detect.test.ts`：URL 解析、S3 原图识别、entries 提取去重、API 响应解析（包裹/平铺兼容）、HTTP 错误抛错、文件名清洗。

## 2. 自动化 e2e 闭环（PASS，2026-08-10）

`pnpm e2e`（mock 站点 + Chrome for Testing 加载真实构建产物）：

```
extension service worker: chrome-extension://<id>/background.js
fab injected
download verified: fake-image.jpg (518 bytes, byte-identical)
popup rendered (guidance state as expected in isolated tab)
embed fab injected with RSC title: Mock Embed Pano
embed scenario verified: ... (byte-identical)
PASS: e2e closed-loop complete (main site + popup + embed share page)
```

覆盖：扩展加载 → content script 检测（主动 API 通道 + RSC initialData 通道）→ 按钮注入
→ 点击导出 → background 下载 → 字节级一致；popup Vue 应用渲染与引导态。

### 真实分享页实证（2026-08-10，`/e/d9672919bc1d6732af59782cc1ce9b8c`）

| 探测项 | 结果 |
|---|---|
| embed 页数据来源 | SSR 注入的 RSC payload `initialData`（id/obfuscatedId/title/file_url/status 完整），无客户端 API 请求 |
| `file_url` 形式 | `https://backend.blockadelabs.com/api/v1/skybox/download/<obfuscatedId>.jpg`（非 S3 直链） |
| download 端点鉴权 | **无需鉴权**：流式读取实证 body 首字节为 `FF D8 FF E0`（JFIF），content-type 标头误标 text/html 但内容为 JPEG |
| 原图分辨率 | **8192×4096（8K）**：SOF0 段实证；EOI（`FF D9`）存在，文件完整 |
| 水印 | viewer 的 image prop 即 download 端点 URL——分享页所见即所得，待用户复验时目视确认 |
| `/api/proxy` 代理 download 端点 | 500（代理不转发该路径）→ 下载必须直连 backend 域名 |
| content script isolated world | 访问不到 `window.__next_f`，但可从 DOM `<script>` 文本解析（`extractInitialDataFromScripts`） |
| **检测逻辑真实 DOM 验证** | **PASS**：将 `extractInitialDataFromScripts` 精确副本注入真实分享页执行，成功解析 initialData（id=15603635，title="World #15603635"，status=complete，file_url 正确），另确认含 thumb_url / depth_map_url 等 41 个字段 |
| **全量原图下载实证** | **PASS**：真实分享页上下文 fetch download 端点全量 5,065,440 字节，SOI/EOI 完整，SOF0 解析 8192×4096；并通过页面级 `a[download]` 在用户本机浏览器触发真实下载（"World #15603635.jpg"） |
| **水印终局实证（用户复验触发）** | 免费账号全部免鉴权通道均为**带水印版**：`file_url` 下载件含水印横幅；`original_file_url`（/true 后缀）返回 500；`/original` 变体与带水印版逐字节相同。无水印版为 premium 权益，服务端强制 |
| **横幅边界 8K 原图复测** | 三列采样 + 连续行判定：顶部横幅 **16.41%**、底部 **16.02%**（过渡均在 2 行内陡变）。裁剪参数 17%/17% 余量充足且不侵内容 |
| **裁剪链路 e2e** | **PASS**：带横幅测试图 800×400 → 输出 800×264（66%），上下边缘亮度 167/220（深灰带 45-52 已消除） |

## 3. 真实站点探测（2026-08-10，免登录态，skybox.blockadelabs.com/login）

通过浏览器在真实登录页内联执行扩展同款检测逻辑：

| 探测项 | 结果 | 结论 |
|---|---|---|
| 250 个资源条目跑 `extractFromResourceEntries` | `fileUrls: []`、`skyboxIds: []` | 零误匹配，未登录页不会误显示导出按钮 |
| `GET /api/proxy?url=.../imagine/requests/1`（未登录） | **404** `{"error":"Request not found"}` | 后端对不存在/无权限资源统一 404；`fetchSkyboxById` 的 `!res.ok` 抛错路径兼容 |
| 官方文档示例 S3 原图 URL 直接访问 | **403 Forbidden** | 示例对象已失效或真实 URL 带时效签名；扩展已在点击导出时重新查询详情以确保 URL 新鲜 |

## 4. 真实登录态验收（待用户主浏览器执行）

剩余未实证项：
1. 免费账号生成器页面的检测与导出（登录态 `imagine/requests/{id}` 通道）
2. 分享页场景真实验收：打开任一分享链接 → 右下角应出现「导出原图 (8K)」→ 下载为无水印原图

步骤：主浏览器加载 `.output/chrome-mv3` → 分别打开生成器页面与 `/e/<hash>` 分享页 → 点击导出验证。
