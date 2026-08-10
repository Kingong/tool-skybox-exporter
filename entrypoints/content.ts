import { browser } from 'wxt/browser';
import { detectSkybox, extractFromResourceEntries } from '@/utils/skybox-detect';
import type { GetDetectedResponse, SkyboxInfo } from '@/utils/types';

const FAB_ID = 'skybox-exporter-fab';

export default defineContentScript({
  // 生产匹配 Skybox 官网（含 /e/<hash> 分享页）；127.0.0.1 为 e2e mock 站点
  matches: ['*://skybox.blockadelabs.com/*', 'http://127.0.0.1/*'],
  main(ctx) {
    let current: SkyboxInfo | null = null;
    let detecting = false;
    let exporting = false; // 导出反馈展示期间，轮询不打断文案
    let fab: HTMLButtonElement | null = null;

    /** 四通道检测（RSC initialData / embed URL 构造 / 主动 API / 被动图床） */
    async function detect(): Promise<SkyboxInfo | null> {
      return detectSkybox({
        pathname: location.pathname,
        scripts: [...document.scripts],
        entries: performance.getEntriesByType('resource'),
      });
    }

    function ensureFab(): HTMLButtonElement {
      if (fab) return fab;
      fab = document.createElement('button');
      fab.id = FAB_ID;
      fab.type = 'button';
      fab.style.cssText = [
        'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
        'padding:10px 16px', 'border:none', 'border-radius:8px', 'cursor:pointer',
        'background:#6c5ce7', 'color:#fff', 'font:600 14px/1.2 sans-serif',
        'box-shadow:0 2px 12px rgba(0,0,0,.35)',
      ].join(';');
      fab.addEventListener('click', onExport);
      document.body.appendChild(fab);
      return fab;
    }

    function syncFab() {
      if (exporting) return; // 反馈期间保留「导出中…/已开始下载 ✓」文案
      if (current?.fileUrl && current.status === 'complete') {
        const btn = ensureFab();
        btn.disabled = false;
        btn.textContent = '导出原图 (8K)';
        btn.title = current.title;
      } else {
        fab?.remove();
        fab = null;
      }
    }

    async function onExport() {
      if (!current?.fileUrl || !fab || exporting) return;
      exporting = true;
      fab.disabled = true;
      fab.textContent = '导出中…';
      try {
        // file_url 可能带时效签名，点击瞬间重新检测确保拿到新鲜 URL
        const fresh = await detect().catch(() => null);
        if (fresh?.fileUrl) current = fresh;
        const resp = await browser.runtime.sendMessage({
          type: 'EXPORT_SKYBOX',
          payload: { url: current.fileUrl, title: current.title },
        });
        fab.textContent = resp?.ok ? '已开始下载 ✓' : `导出失败: ${resp?.error ?? '未知错误'}`;
      } catch (err) {
        fab.textContent = `导出失败: ${String(err)}`;
      }
      setTimeout(() => {
        exporting = false;
        syncFab();
      }, 3000);
    }

    async function refresh() {
      if (detecting) return;
      detecting = true;
      try {
        current = await detect();
        syncFab();
      } finally {
        detecting = false;
      }
    }

    // popup 查询当前检测结果
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type !== 'GET_DETECTED') return undefined;
      const assets = extractFromResourceEntries(performance.getEntriesByType('resource'));
      sendResponse({ ...assets, current } satisfies GetDetectedResponse);
      return undefined;
    });

    // SPA 导航（WXT 内置 locationchange）+ 周期轮询（生成完成后 entries 增长）
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      current = null;
      void refresh();
    });
    ctx.setInterval(() => void refresh(), 2000);
    void refresh();
  },
});
