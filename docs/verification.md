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
PASS: e2e closed-loop complete (fab export + popup)
```

覆盖：扩展加载 → content script 检测（主动通道）→ 按钮注入 → 点击导出 → background 下载 → 字节级一致；popup Vue 应用渲染与引导态。

## 3. 真实站点探测（2026-08-10，免登录态，skybox.blockadelabs.com/login）

通过浏览器在真实登录页内联执行扩展同款检测逻辑：

| 探测项 | 结果 | 结论 |
|---|---|---|
| 250 个资源条目跑 `extractFromResourceEntries` | `fileUrls: []`、`skyboxIds: []` | 零误匹配，未登录页不会误显示导出按钮 |
| `GET /api/proxy?url=.../imagine/requests/1`（未登录） | **404** `{"error":"Request not found"}` | 后端对不存在/无权限资源统一 404；`fetchSkyboxById` 的 `!res.ok` 抛错路径兼容 |
| 官方文档示例 S3 原图 URL 直接访问 | **403 Forbidden** | 示例对象已失效或真实 URL 带时效签名；扩展已在点击导出时重新查询详情以确保 URL 新鲜 |

## 4. 真实登录态验收（待用户主浏览器执行）

剩余唯一未实证项：免费账号 `file_url` 是否为无水印 8K 原图。
步骤：主浏览器加载 `.output/chrome-mv3` → 打开任一已生成 skybox → 点击「导出原图 (8K)」→ 检查下载文件。
