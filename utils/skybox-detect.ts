import type { DetectedAssets, SkyboxInfo } from './types';

export const S3_IMAGE_HOST = 'blockade-platform-production.s3.amazonaws.com';
export const BACKEND_BASE = 'https://backend.blockadelabs.com/api/v1';

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

/** 判断是否 S3 原图 URL（images/ 前缀，排除 thumbs/、depths/） */
export function isOriginalImageUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return u.host === S3_IMAGE_HOST && u.pathname.startsWith('/images/');
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
