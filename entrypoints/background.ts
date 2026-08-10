import { browser } from 'wxt/browser';
import type { ExportResponse, ExtMessage } from '@/utils/types';
import { sanitizeFilename } from '@/utils/skybox-detect';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: ExtMessage, _sender, sendResponse) => {
    if (msg?.type !== 'EXPORT_SKYBOX') return undefined;
    browser.downloads
      .download({
        url: msg.payload.url,
        filename: `${sanitizeFilename(msg.payload.title)}.jpg`,
        saveAs: false,
      })
      .then((downloadId) => sendResponse({ ok: true, downloadId } satisfies ExportResponse))
      .catch((err) => sendResponse({ ok: false, error: String(err) } satisfies ExportResponse));
    return true; // 异步 sendResponse
  });
});
