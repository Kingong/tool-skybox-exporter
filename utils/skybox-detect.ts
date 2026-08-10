import type { DetectedAssets, SkyboxInfo } from './types';

export const S3_IMAGE_HOST = 'blockade-platform-production.s3.amazonaws.com';
export const IMAGES_CDN_HOST = 'images.blockadelabs.com';
export const BACKEND_HOST = 'backend.blockadelabs.com';
export const BACKEND_BASE = `https://${BACKEND_HOST}/api/v1`;

/** 从 /api/proxy?url=<inner> 或裸 backend URL 中解析 skybox id（imagine/requests/{id}，排除 myRequests） */
export function parseSkyboxIdFromUrl(rawUrl: string): number | null {
  let target = rawUrl;
  try {
    target = new URL(rawUrl).searchParams.get('url') ?? rawUrl;
  } catch {
    /* 非 URL 输入按原文匹配 */
  }
  const m = /imagine\/requests\/(\d+)/.exec(target);
  return m ? Number(m[1]) : null;
}

/** 从路径解析 embed 分享页的 obfuscatedId：/e/<32位hex> */
export function parseObfuscatedIdFromPath(pathname: string): string | null {
  const m = /^\/e\/([a-f0-9]{32})\/?$/.exec(pathname);
  return m ? m[1] : null;
}

/** 由 obfuscatedId 构造公开 download 端点 URL（实证：无需鉴权，body 为 JPEG） */
export function buildDownloadUrl(obfuscatedId: string): string {
  return `${BACKEND_BASE}/skybox/download/${obfuscatedId}.jpg`;
}

/** 判断是否原图 URL：S3 images/ 前缀、images CDN 的 *_file 图、backend download 端点 */
export function isOriginalImageUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.host === S3_IMAGE_HOST && u.pathname.startsWith('/images/')) return true;
    if (u.host === IMAGES_CDN_HOST && /_file\.(jpg|jpeg|png|webp)$/i.test(u.pathname)) return true;
    if (u.host === BACKEND_HOST && /\/api\/v1\/skybox\/download\/[a-f0-9]{32}\.jpg/i.test(u.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

/** 从 performance resource entries（或任意 {name} 列表）提取检测资产，去重 */
export function extractFromResourceEntries(entries: ReadonlyArray<{ name: string }>): DetectedAssets {
  const fileUrls = new Set<string>();
  const skyboxIds = new Set<number>();
  for (const e of entries) {
    if (isOriginalImageUrl(e.name)) fileUrls.add(e.name);
    const id = parseSkyboxIdFromUrl(e.name);
    if (id !== null) skyboxIds.add(id);
  }
  return { fileUrls: [...fileUrls], skyboxIds: [...skyboxIds] };
}

/**
 * 从页面 <script> 标签中解析 Next.js RSC payload（self.__next_f.push）里的 initialData。
 * content script 处于 isolated world 访问不到页面 window.__next_f，但 DOM 中文本可读。
 * push 的第一个元素为 chunk 类型标记（实测为 1），放宽匹配任意数字以兼容 Next.js 变体。
 * 返回解析出的对象（含 id/obfuscatedId/title/file_url/status 等），未找到返回 null。
 */
export function extractInitialDataFromScripts(
  scripts: Array<{ textContent: string | null }>,
): Record<string, unknown> | null {
  for (const s of scripts) {
    const t = s.textContent;
    if (!t || !t.includes('__next_f') || !t.includes('initialData')) continue;
    for (const m of t.matchAll(/self\.__next_f\.push\(\[\d+,("(?:[^"\\]|\\.)*")\]\)/gs)) {
      let chunk: string;
      try {
        chunk = JSON.parse(m[1]);
      } catch {
        continue;
      }
      const idx = chunk.indexOf('"initialData":');
      if (idx < 0) continue;
      const start = chunk.indexOf('{', idx);
      if (start < 0) continue;
      // bracket matching（跳过字符串内部）
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < chunk.length; i++) {
        const c = chunk[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === '\\') esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(chunk.slice(start, i + 1)) as Record<string, unknown>;
            } catch {
              return null;
            }
          }
        }
      }
    }
  }
  return null;
}

/** 主动通道：经页面前端自己的 /api/proxy 同源查询 skybox 详情（凭据自动携带） */
export async function fetchSkyboxById(id: number, fetcher: typeof fetch = fetch): Promise<SkyboxInfo> {
  const inner = `${BACKEND_BASE}/imagine/requests/${id}`;
  const res = await fetcher(`/api/proxy?url=${encodeURIComponent(inner)}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`skybox api http ${res.status}`);
  const json = await res.json();
  const r = json.request ?? json;
  if (typeof r?.file_url !== 'string' || !r.file_url) throw new Error('file_url missing');
  return {
    id: Number(r.id ?? id),
    obfuscatedId: r.obfuscated_id,
    title: r.title ?? `skybox-${id}`,
    fileUrl: r.file_url,
    thumbUrl: r.thumb_url,
    status: String(r.status ?? 'unknown'),
  };
}

/** 归一化下载文件名（Windows 非法字符替换，空名兜底） */
export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned || 'skybox';
}

/** detectSkybox 的可注入环境（便于测试） */
export interface DetectEnv {
  pathname: string;
  scripts: Array<{ textContent: string | null }>;
  entries: ReadonlyArray<{ name: string }>;
  fetcher?: typeof fetch;
}

function infoFromInitialData(d: Record<string, unknown>): SkyboxInfo | null {
  if (typeof d.file_url !== 'string' || !d.file_url) return null;
  return {
    id: Number(d.id ?? 0),
    obfuscatedId: typeof d.obfuscatedId === 'string' ? d.obfuscatedId : undefined,
    title: typeof d.title === 'string' ? d.title : 'skybox',
    fileUrl: d.file_url,
    thumbUrl: typeof d.thumb_url === 'string' ? d.thumb_url : undefined,
    status: String(d.status ?? 'complete'),
  };
}

/**
 * 四通道检测（按实证可靠性排序）：
 * 1. RSC initialData（embed 分享页 SSR 注入，含完整元数据）
 * 2. embed URL 构造（/e/<hash> → 公开 download 端点，无需任何页面数据）
 * 3. 主动 API（登录态主应用：entries 里的 /api/proxy imagine/requests/{id} → 详情）
 * 4. 被动图床（entries 里的原图 URL 兜底）
 */
export async function detectSkybox(env: DetectEnv): Promise<SkyboxInfo | null> {
  const init = extractInitialDataFromScripts(env.scripts);
  if (init) {
    const info = infoFromInitialData(init);
    if (info) return info;
  }

  const obf = parseObfuscatedIdFromPath(env.pathname);
  if (obf) {
    return {
      id: 0,
      obfuscatedId: obf,
      title: `skybox-${obf.slice(0, 8)}`,
      fileUrl: buildDownloadUrl(obf),
      status: 'complete',
    };
  }

  const assets = extractFromResourceEntries(env.entries);
  for (const id of [...assets.skyboxIds].reverse()) {
    try {
      return await fetchSkyboxById(id, env.fetcher);
    } catch {
      /* 尝试下一个 id */
    }
  }
  const url = assets.fileUrls[assets.fileUrls.length - 1];
  if (url) return { id: 0, title: 'skybox', fileUrl: url, status: 'complete' };
  return null;
}
