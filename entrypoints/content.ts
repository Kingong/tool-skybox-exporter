import { browser } from 'wxt/browser';
import { extractFromResourceEntries, fetchSkyboxById } from '@/utils/skybox-detect';
import type { GetDetectedResponse, SkyboxInfo } from '@/utils/types';

const FAB_ID = 'skybox-exporter-fab';

export default defineContentScript({
  // 生产匹配 Skybox 官网；18777 为 e2e mock 站点端口
  matches: ['*://skybox.blockadelabs.com/*', 'http://127.0.0.1:18777/*'],
  main(ctx) {
    let current: SkyboxInfo | null = null;
    let detecting = false;
    let fab: HTMLButtonElement | null = null;

    /** 双通道检测：主动（/api/proxy id → 详情）优先，被动（S3 原图 entry）兜底 */
    async function detect(): Promise<SkyboxInfo | null> {
      const assets = extractFromResourceEntries(performance.getEntriesByType('resource'));
      for (const id of [...assets.skyboxIds].reverse()) {
        try {
          return await fetchSkyboxById(id);
        } catch {
          /* 尝试下一个 id */
        }
      }
      const url = assets.fileUrls[assets.fileUrls.length - 1];
      if (url) return { id: 0, title: 'skybox', fileUrl: url, status: 'complete' };
      return null;
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
      if (!current?.fileUrl || !fab) return;
      fab.disabled = true;
      fab.textContent = '导出中…';
      try {
        const resp = await browser.runtime.sendMessage({
          type: 'EXPORT_SKYBOX',
          payload: { url: current.fileUrl, title: current.title },
        });
        fab.textContent = resp?.ok ? '已开始下载 ✓' : `导出失败: ${resp?.error ?? '未知错误'}`;
      } catch (err) {
        fab.textContent = `导出失败: ${String(err)}`;
      }
      setTimeout(syncFab, 3000);
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
