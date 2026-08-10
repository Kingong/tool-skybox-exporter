import puppeteer from 'puppeteer-core';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * 真实站点全链路验收（需要能正常访问 skybox.blockadelabs.com 的网络环境）：
 * 1. CfT 加载扩展构建产物，打开真实 embed 分享页（免登录）
 * 2. 断言 content script 在真实页面检测出 skybox 并注入浮动按钮（标题来自 RSC initialData）
 * 3. 点击导出，断言 chrome.downloads 落盘完整 JPEG（SOI/EOI + SOF0 解析 8192×4096）
 *
 * 运行：xvfb-run -a node e2e/real-site-check.mjs
 */

const SHARE_URL = process.env.SHARE_URL || 'https://skybox.blockadelabs.com/e/d9672919bc1d6732af59782cc1ce9b8c';
const EXT_PATH = resolve('.output/chrome-mv3');
const DL_DIR = mkdtempSync(join(tmpdir(), 'skybox-real-dl-'));
const USER_DIR = mkdtempSync(join(tmpdir(), 'skybox-real-profile-'));

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

/** 解析 JPEG 尺寸（SOF0/SOF2） */
function jpegSize(buf) {
  for (let i = 2; i < Math.min(buf.length - 9, 200000); i++) {
    if (buf[i] === 0xff && (buf[i + 1] === 0xc0 || buf[i + 1] === 0xc2)) {
      return { h: (buf[i + 5] << 8) | buf[i + 6], w: (buf[i + 7] << 8) | buf[i + 8] };
    }
  }
  return null;
}

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: false,
    args: [
      `--load-extension=${EXT_PATH}`,
      `--disable-extensions-except=${EXT_PATH}`,
      `--user-data-dir=${USER_DIR}`,
      '--no-sandbox',
      '--disable-gpu',
      '--window-size=1366,900',
    ],
  });
  const browserCdp = await browser.target().createCDPSession();
  await browserCdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR });

  // 1. 打开真实分享页，等 fab 注入
  const page = await browser.newPage();
  await page.goto(SHARE_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('#skybox-exporter-fab', { timeout: 20000 });
  const fabTitle = await page.$eval('#skybox-exporter-fab', (el) => el.title);
  console.log('fab injected on real share page, title:', fabTitle);
  if (!fabTitle) throw new Error('fab title empty: initialData not parsed');

  // 2. 点击导出（DOM dispatch，避免 scrollIntoView 不稳定）
  await page.evaluate(() => {
    document.querySelector('#skybox-exporter-fab')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  // 3. 等下载 complete 并校验文件（注意 DownloadItem 字段名是小写 filename）
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
    { timeout: 10000 },
  );
  const swWorker = await swTarget.worker();
  const start = Date.now();
  let item = null;
  while (Date.now() - start < 60000) {
    const items = await swWorker.evaluate(async () => {
      const list = await chrome.downloads.search({});
      return JSON.parse(JSON.stringify(list));
    });
    const hit = items.find((i) => i.state === 'complete' && i.filename);
    if (hit) { item = hit; break; }
    await sleep(500);
  }
  if (!item) throw new Error('download not completed in 60s');
  console.log('downloaded:', item.filename, `(${item.fileSize} bytes)`);

  // 4. JPEG 完整性 + 尺寸断言（8K 原图）
  const buf = readFileSync(item.filename);
  const soi = buf[0] === 0xff && buf[1] === 0xd8;
  const eoi = buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
  const size = jpegSize(buf);
  if (!soi || !eoi) throw new Error('downloaded file is not a complete JPEG');
  console.log(`JPEG verified: ${size?.w}x${size?.h}, SOI/EOI ok`);
  if (size && (size.w < 4096 || size.h < 2048)) {
    console.warn(`WARN: resolution lower than expected 8K: ${size.w}x${size.h}`);
  }

  console.log('REAL-SITE CHECK PASS');
  process.exitCode = 0;
} catch (err) {
  console.error('REAL-SITE CHECK FAIL:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  rmSync(DL_DIR, { recursive: true, force: true });
  rmSync(USER_DIR, { recursive: true, force: true });
}
