import puppeteer from 'puppeteer-core';
import { existsSync, mkdtempSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startMockSite, EMBED_HASH } from './mock-site.mjs';

/**
 * 截图资产生成：CfT 加载真实扩展构建，截取
 *  1. docs/screenshots/share-page-fab.png —— embed 页 + 浮动双按钮
 *  2. docs/screenshots/popup-ready.png —— popup 检测到 skybox 的卡片态
 * 运行：xvfb-run -a node e2e/capture-screenshots.mjs
 */

const EXT_PATH = resolve('.output/chrome-mv3');
const OUT_DIR = resolve('docs/screenshots');
const USER_DIR = mkdtempSync(join(tmpdir(), 'skybox-shot-profile-'));

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pwDir = `${process.env.HOME}/.cache/ms-playwright`;
  const candidates = readdirSync(pwDir)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .map((d) => join(pwDir, d, 'chrome-linux64', 'chrome'))
    .filter(existsSync);
  if (candidates.length) return candidates[0];
  return '/usr/bin/google-chrome';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT_DIR, { recursive: true });
let server;
let browser;
try {
  server = await startMockSite();
  browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: false,
    args: [
      `--load-extension=${EXT_PATH}`,
      `--disable-extensions-except=${EXT_PATH}`,
      `--user-data-dir=${USER_DIR}`,
      '--no-sandbox',
      '--disable-gpu',
      '--window-size=1280,800',
      '--hide-crash-restore-bubble',
    ],
  });

  // 1. embed 页 + fab 截图
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`http://127.0.0.1:18777/e/${EMBED_HASH}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#skybox-exporter-fab button[data-action="cropped"]', { timeout: 15000 });
  await sleep(1200); // 等图片渲染稳定
  await page.screenshot({ path: join(OUT_DIR, 'share-page-fab.png') });
  console.log('captured: share-page-fab.png');

  // 2. popup ready 态截图：先让 mock 页成为 active tab，再重载 popup 页触发重新检测
  const extTarget = browser.targets().find((t) => t.url().startsWith('chrome-extension://'));
  if (!extTarget) throw new Error('no extension target');
  const extOrigin = extTarget.url().match(/^chrome-extension:\/\/[^/]+/)?.[0];
  const popupPage = await browser.newPage();
  await popupPage.setViewport({ width: 340, height: 480 });
  await popupPage.goto(`${extOrigin}/popup.html`, { waitUntil: 'networkidle0' });
  // 激活 mock 页使其成为窗口 active tab，再重载 popup 触发 onMounted 重查
  await page.bringToFront();
  await popupPage.reload({ waitUntil: 'networkidle0' });
  await sleep(1500);
  // 按内容实际尺寸调整视口，避免滚动条入镜
  const contentSize = await popupPage.evaluate(() => ({
    w: Math.ceil(document.documentElement.scrollWidth) + 60,
    h: Math.ceil(document.documentElement.scrollHeight) + 60,
  }));
  await popupPage.setViewport({ width: Math.min(contentSize.w, 500), height: Math.min(contentSize.h, 600) });
  await sleep(400);
  await popupPage.screenshot({ path: join(OUT_DIR, 'popup-ready.png') });
  const popupText = await popupPage.evaluate(() => document.body.innerText.slice(0, 120));
  console.log('captured: popup-ready.png |', JSON.stringify(popupText));

  process.exitCode = 0;
} catch (err) {
  console.error('CAPTURE FAIL:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.close();
  rmSync(USER_DIR, { recursive: true, force: true });
}
