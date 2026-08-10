import puppeteer from 'puppeteer-core';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startMockSite, FAKE_JPG_B64 } from './mock-site.mjs';

const EXT_PATH = resolve('.output/chrome-mv3');
const DL_DIR = mkdtempSync(join(tmpdir(), 'skybox-e2e-dl-'));
const USER_DIR = mkdtempSync(join(tmpdir(), 'skybox-e2e-profile-'));

/** 探测可用浏览器：Chrome 137+ branded 版已移除 --load-extension，优先用 Chrome for Testing / Chromium */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pwDir = `${process.env.HOME}/.cache/ms-playwright`;
  try {
    const candidates = readdirSync(pwDir)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
      .map((d) => join(pwDir, d, 'chrome-linux64', 'chrome'))
      .filter(existsSync);
    if (candidates.length) return candidates[0];
  } catch {
    /* playwright 缓存不存在 */
  }
  console.warn('WARN: fallback to branded /usr/bin/google-chrome, Chrome 137+ ignores --load-extension');
  return '/usr/bin/google-chrome';
}
const CHROME = findChrome();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitDownloadedFile(dir, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const files = readdirSync(dir).filter((f) => !f.endsWith('.crdownload'));
    if (files.length) return join(dir, files[0]);
    await sleep(300);
  }
  return null;
}

let server;
let browser;
try {
  server = await startMockSite();
  // branded Chrome 的 headless 模式会忽略 --load-extension，需 headed + xvfb（由 xvfb-run 包裹执行）
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    args: [
      `--load-extension=${EXT_PATH}`,
      `--disable-extensions-except=${EXT_PATH}`,
      `--user-data-dir=${USER_DIR}`,
      '--no-sandbox',
      '--disable-gpu',
      '--window-size=1280,800',
    ],
  });

  // 1. 软等待 service worker（MV3 SW 事件驱动，可能惰性；fab 检测才是真信号）
  const sw = await Promise.race([
    browser
      .waitForTarget(
        (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
        { timeout: 8000 },
      )
      .catch(() => null),
    sleep(8000).then(() => null),
  ]);
  console.log('extension service worker:', sw ? sw.url() : '(not active yet, lazily started)');

  // 2. 打开 mock 站点
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR });
  await page.goto('http://127.0.0.1:18777/', { waitUntil: 'networkidle0' });

  // 3. 等 content script 检测并注入浮动按钮（轮询周期 2s，给足余量）
  await page.waitForSelector('#skybox-exporter-fab', { timeout: 15000 });
  console.log('fab injected');

  // 4. 点击导出 → 等待文件落盘
  await page.click('#skybox-exporter-fab');
  const file = await waitDownloadedFile(DL_DIR);
  if (!file) throw new Error('download timeout: no file landed');

  // 5. 断言落盘内容与 mock 原图字节一致（端到端无损闭环）
  const got = readFileSync(file);
  const want = Buffer.from(FAKE_JPG_B64, 'base64');
  if (got.length !== want.length || !got.equals(want)) {
    throw new Error(`downloaded content mismatch: got ${got.length} bytes, want ${want.length}`);
  }
  console.log(`PASS: exported ${file} (${statSync(file).size} bytes, byte-identical)`);
  process.exitCode = 0;
} catch (err) {
  console.error('FAIL:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.close();
  rmSync(DL_DIR, { recursive: true, force: true });
  rmSync(USER_DIR, { recursive: true, force: true });
}
