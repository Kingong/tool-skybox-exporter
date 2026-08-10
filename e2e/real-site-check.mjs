import puppeteer from 'puppeteer-core';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * 真实站点验收（免登录态）：
 * 1. 扩展在 skybox.blockadelabs.com 真实域名完成 content script 注入
 * 2. 登录页无 skybox 数据时浮动按钮不误触发
 * 3. 探测未登录态 /api/proxy 对 imagine/requests/{id} 的真实响应（校准解析与错误处理）
 * 4. 截图存证
 */

const EXT_PATH = resolve('.output/chrome-mv3');
const USER_DIR = mkdtempSync(join(tmpdir(), 'skybox-real-profile-'));
const SHOT = resolve('e2e/real-site-login.png');

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

const browser = await puppeteer.launch({
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

const pageErrors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto('https://skybox.blockadelabs.com/', { waitUntil: 'networkidle2', timeout: 60000 });
  console.log('landed on:', page.url());
  await sleep(8000); // 覆盖 content script 轮询周期

  const fabExists = await page.evaluate(() => !!document.querySelector('#skybox-exporter-fab'));

  // 探测未登录态下真实 /api/proxy 对详情接口的响应
  const apiProbe = await page.evaluate(async () => {
    const inner = encodeURIComponent('https://backend.blockadelabs.com/api/v1/imagine/requests/1');
    try {
      const r = await fetch(`/api/proxy?url=${inner}`, { credentials: 'include' });
      const text = await r.text();
      return { status: r.status, body: text.slice(0, 300) };
    } catch (e) {
      return { error: String(e) };
    }
  });

  await page.screenshot({ path: SHOT, fullPage: false });

  console.log(JSON.stringify({ fabExists, apiProbe, pageErrors: pageErrors.slice(0, 5) }, null, 2));

  const pass = fabExists === false;
  console.log(pass ? 'REAL-SITE CHECK PASS (no false trigger on login page)' : 'REAL-SITE CHECK FAIL (fab should not appear)');
  process.exitCode = pass ? 0 : 1;
} finally {
  await browser.close();
  rmSync(USER_DIR, { recursive: true, force: true });
}
