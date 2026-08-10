import puppeteer from 'puppeteer-core';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startMockSite, FAKE_JPG_B64, EMBED_HASH } from './mock-site.mjs';

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

async function waitDownloadedFile(dir, timeoutMs = 20000, exclude = new Set()) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const files = readdirSync(dir).filter((f) => !f.endsWith('.crdownload') && !exclude.has(f));
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

  // 2. 打开 mock 站点（下载行为用 browser 级 CDP 设置，对所有 page 生效）
  const browserCdp = await browser.target().createCDPSession();
  await browserCdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR, eventsEnabled: true });
  // 监听 browser 级下载事件（诊断）
  browserCdp.on('Browser.downloadProgress', (e) => console.log('[dl progress]', e.state, e.guid));
  browserCdp.on('Browser.downloadWillBegin', (e) => console.log('[dl begin]', e.url, e.suggestedFilename));
  const page = await browser.newPage();
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
  console.log(`download verified: ${file} (${statSync(file).size} bytes, byte-identical)`);

  // 6. popup 渲染检查（同一浏览器会话；popup 作为独立 tab 打开时应为引导态）
  const extTarget = browser.targets().find((t) => t.url().startsWith('chrome-extension://'));
  if (!extTarget) throw new Error('extension target not found for popup check');
  // 注意：chrome-extension 不是 WHATWG 特殊 scheme，new URL().origin 会返回 'null'，需手工截取
  const extOrigin = extTarget.url().match(/^chrome-extension:\/\/[^/]+/)?.[0];
  if (!extOrigin) throw new Error(`cannot derive extension origin from ${extTarget.url()}`);
  const popupPage = await browser.newPage();
  await popupPage.goto(`${extOrigin}/popup.html`, { waitUntil: 'networkidle0' });
  await popupPage.waitForFunction(
    () => document.body.innerText.includes('Skybox Exporter'),
    { timeout: 8000 },
  );
  const popupText = await popupPage.evaluate(() => document.body.innerText);
  if (!popupText.includes('请在 Skybox AI 页面') && !popupText.includes('未检测到')) {
    throw new Error('popup did not render expected guidance state');
  }
  console.log('popup rendered (guidance state as expected in isolated tab)');

  // 7. embed 分享页场景（通道1：RSC initialData 检测）——同一 tab 导航（贴合真实使用）
  await page.goto(`http://127.0.0.1:18777/e/${EMBED_HASH}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#skybox-exporter-fab', { timeout: 15000 });
  const fabTitle = await page.$eval('#skybox-exporter-fab', (el) => el.title);
  if (fabTitle !== 'Mock Embed Pano') throw new Error(`fab title mismatch: ${fabTitle}`);
  console.log('embed fab injected with RSC title:', fabTitle);
  // attach SW 拿下载状态（chrome.downloads.search 的 DownloadItem 字段名是小写 filename）
  const swTarget = browser.targets().find((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
  if (!swTarget) throw new Error('no SW target');
  const swWorker = await swTarget.worker();
  swWorker.on('console', (m) => console.log('[sw]', m.text()));
  // DOM click 派发（puppeteer click 的 scrollIntoView 在此环境对 fixed 元素不稳定）
  await page.evaluate(() => {
    document.querySelector('#skybox-exporter-fab')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  // 轮询等第二个下载 complete，拿实际落盘路径做字节断言
  const start = Date.now();
  let item2 = null;
  while (Date.now() - start < 20000) {
    const items = await swWorker.evaluate(async () => {
      const list = await chrome.downloads.search({});
      return JSON.parse(JSON.stringify(list));
    });
    const hit = items.find((i) => i.id > 1 && i.state === 'complete' && i.filename);
    if (hit) { item2 = hit; break; }
    await sleep(300);
  }
  if (!item2) throw new Error('embed scenario download not completed');
  const got2 = readFileSync(item2.filename);
  if (!got2.equals(Buffer.from(FAKE_JPG_B64, 'base64'))) {
    throw new Error('embed scenario downloaded content mismatch');
  }
  console.log(`embed scenario verified: ${item2.filename} (byte-identical)`);

  console.log('PASS: e2e closed-loop complete (main site + popup + embed share page)');
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
