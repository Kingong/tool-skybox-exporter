import { browser } from 'wxt/browser';
import { detectSkybox, extractFromResourceEntries, sanitizeFilename } from '@/utils/skybox-detect';
import { cropImageBlob } from '@/utils/crop';
import type { GetDetectedResponse, SkyboxInfo } from '@/utils/types';

const FAB_ID = 'skybox-exporter-fab';

export default defineContentScript({
  // 生产匹配 Skybox 官网（含 /e/<hash> 分享页）；127.0.0.1 为 e2e mock 站点
  matches: ['*://skybox.blockadelabs.com/*', 'http://127.0.0.1/*'],
  main(ctx) {
    let current: SkyboxInfo | null = null;
    let detecting = false;
    let exporting = false; // 导出反馈展示期间，轮询不打断文案
    let fab: HTMLDivElement | null = null;
    let btnOriginal: HTMLButtonElement | null = null;
    let btnCropped: HTMLButtonElement | null = null;

    /** 四通道检测（RSC initialData / embed URL 构造 / 主动 API / 被动图床） */
    async function detect(): Promise<SkyboxInfo | null> {
      return detectSkybox({
        pathname: location.pathname,
        scripts: [...document.scripts],
        entries: performance.getEntriesByType('resource'),
      });
    }

    function ensureFab(): HTMLDivElement {
      if (fab) return fab;
      fab = document.createElement('div');
      fab.id = FAB_ID;
      fab.style.cssText = [
        'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
        'display:flex', 'gap:8px', 'font:600 14px/1.2 sans-serif',
      ].join(';');
      const btnStyle = [
        'padding:10px 14px', 'border:none', 'border-radius:8px', 'cursor:pointer',
        'background:#6c5ce7', 'color:#fff', 'font:600 14px/1.2 sans-serif',
        'box-shadow:0 2px 12px rgba(0,0,0,.35)',
      ].join(';');
      btnCropped = document.createElement('button');
      btnCropped.type = 'button';
      btnCropped.dataset.action = 'cropped';
      btnCropped.style.cssText = btnStyle;
      btnCropped.addEventListener('click', onExportCropped);
      btnOriginal = document.createElement('button');
      btnOriginal.type = 'button';
      btnOriginal.dataset.action = 'original';
      btnOriginal.style.cssText = btnStyle + ';background:#2d3436';
      btnOriginal.addEventListener('click', onExportOriginal);
      fab.append(btnCropped, btnOriginal);
      document.body.appendChild(fab);
      return fab;
    }

    function syncFab() {
      if (exporting) return; // 反馈期间保留「导出中…/已开始下载 ✓」文案
      if (current?.fileUrl && current.status === 'complete') {
        const box = ensureFab();
        box.title = current.title;
        if (btnCropped) { btnCropped.disabled = false; btnCropped.textContent = '导出无横幅版 (8K)'; }
        if (btnOriginal) { btnOriginal.disabled = false; btnOriginal.textContent = '原图（带水印）'; }
      } else {
        fab?.remove();
        fab = null;
        btnOriginal = null;
        btnCropped = null;
      }
    }

    function setBusy(text: string) {
      if (btnCropped) { btnCropped.disabled = true; btnCropped.textContent = text; }
      if (btnOriginal) btnOriginal.disabled = true;
    }

    function setResult(text: string) {
      if (btnCropped) { btnCropped.disabled = false; btnCropped.textContent = text; }
      if (btnOriginal) btnOriginal.disabled = false;
    }

    /** 原图导出：走 background chrome.downloads（官方带水印原样图） */
    async function onExportOriginal() {
      if (!current?.fileUrl || !fab || exporting) return;
      exporting = true;
      setBusy('导出中…');
      try {
        // file_url 可能带时效签名，点击瞬间重新检测确保拿到新鲜 URL
        const fresh = await detect().catch(() => null);
        if (fresh?.fileUrl) current = fresh;
        const resp = await browser.runtime.sendMessage({
          type: 'EXPORT_SKYBOX',
          payload: { url: current.fileUrl, title: current.title },
        });
        setResult(resp?.ok ? '已开始下载 ✓' : `导出失败: ${resp?.error ?? '未知错误'}`);
      } catch (err) {
        setResult(`导出失败: ${String(err)}`);
      }
      setTimeout(() => {
        exporting = false;
        syncFab();
      }, 3000);
    }

    /** 裁剪导出：页面内 fetch + canvas 去横幅 + a[download] 触发 */
    async function onExportCropped() {
      if (!current?.fileUrl || !fab || exporting) return;
      exporting = true;
      setBusy('裁剪导出中…');
      try {
        const fresh = await detect().catch(() => null);
        if (fresh?.fileUrl) current = fresh;
        const resp = await fetch(current.fileUrl, { credentials: 'omit' });
        if (!resp.ok) throw new Error(`http ${resp.status}`);
        const cropped = await cropImageBlob(await resp.blob());
        const a = document.createElement('a');
        a.href = URL.createObjectURL(cropped);
        a.download = `${sanitizeFilename(current.title)}-no-banner.jpg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        setResult('已开始下载 ✓');
      } catch (err) {
        setResult(`导出失败: ${String(err)}`);
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

    // popup 查询当前检测结果 / 触发裁剪导出
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'GET_DETECTED') {
        const assets = extractFromResourceEntries(performance.getEntriesByType('resource'));
        sendResponse({ ...assets, current } satisfies GetDetectedResponse);
        return undefined;
      }
      if (msg?.type === 'EXPORT_CROPPED_LOCAL') {
        void onExportCropped();
        sendResponse({ ok: true });
        return undefined;
      }
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
