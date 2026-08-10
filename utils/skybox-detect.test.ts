import { describe, it, expect, vi } from 'vitest';
import {
  parseSkyboxIdFromUrl,
  isOriginalImageUrl,
  extractFromResourceEntries,
  fetchSkyboxById,
  sanitizeFilename,
} from './skybox-detect';

describe('parseSkyboxIdFromUrl', () => {
  it('解析 /api/proxy 包裹的 imagine/requests URL', () => {
    const inner = encodeURIComponent('https://backend.blockadelabs.com/api/v1/imagine/requests/123456');
    expect(parseSkyboxIdFromUrl(`https://skybox.blockadelabs.com/api/proxy?url=${inner}`)).toBe(123456);
  });
  it('解析裸 backend URL', () => {
    expect(parseSkyboxIdFromUrl('https://backend.blockadelabs.com/api/v1/imagine/requests/789')).toBe(789);
  });
  it('不匹配 myRequests 列表接口', () => {
    expect(parseSkyboxIdFromUrl('https://backend.blockadelabs.com/api/v1/imagine/myRequests?limit=18')).toBeNull();
  });
  it('非法输入返回 null', () => {
    expect(parseSkyboxIdFromUrl('not a url')).toBeNull();
  });
});

describe('isOriginalImageUrl', () => {
  const host = 'https://blockade-platform-production.s3.amazonaws.com';
  it('命中 images/ 前缀', () => {
    expect(isOriginalImageUrl(`${host}/images/imagine/abc_123_6.jpg?ver=1`)).toBe(true);
  });
  it('排除 thumbs/ 与 depths/', () => {
    expect(isOriginalImageUrl(`${host}/thumbs/imagine/abc.jpg`)).toBe(false);
    expect(isOriginalImageUrl(`${host}/depths/imagine/abc.jpg`)).toBe(false);
  });
  it('排除其他域名', () => {
    expect(isOriginalImageUrl('https://example.com/images/a.jpg')).toBe(false);
  });
});

describe('extractFromResourceEntries', () => {
  it('混合条目中提取原图与 id 并去重', () => {
    const inner = encodeURIComponent('https://backend.blockadelabs.com/api/v1/imagine/requests/42');
    const entries = [
      { name: 'https://blockade-platform-production.s3.amazonaws.com/images/imagine/a_1.jpg?ver=1' },
      { name: 'https://blockade-platform-production.s3.amazonaws.com/images/imagine/a_1.jpg?ver=1' },
      { name: 'https://blockade-platform-production.s3.amazonaws.com/thumbs/imagine/t_1.jpg' },
      { name: `https://skybox.blockadelabs.com/api/proxy?url=${inner}` },
      { name: 'https://www.googletagmanager.com/gtm.js?id=GTM-1' },
    ];
    const out = extractFromResourceEntries(entries);
    expect(out.fileUrls).toEqual(['https://blockade-platform-production.s3.amazonaws.com/images/imagine/a_1.jpg?ver=1']);
    expect(out.skyboxIds).toEqual([42]);
  });
});

describe('fetchSkyboxById', () => {
  const payload = { request: { id: 42, obfuscated_id: 'ob', title: 'My World', status: 'complete', file_url: 'https://s3/x.jpg', thumb_url: 'https://s3/t.jpg' } };

  it('解析 request 包裹结构', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    const info = await fetchSkyboxById(42, fetcher as unknown as typeof fetch);
    expect(info).toMatchObject({ id: 42, title: 'My World', fileUrl: 'https://s3/x.jpg', status: 'complete' });
  });
  it('兼容平铺结构', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload.request), { status: 200 }));
    const info = await fetchSkyboxById(42, fetcher as unknown as typeof fetch);
    expect(info.fileUrl).toBe('https://s3/x.jpg');
  });
  it('请求 URL 正确编码 inner', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    await fetchSkyboxById(42, fetcher as unknown as typeof fetch);
    const calledUrl = (fetcher.mock.calls[0] as unknown[])[0] as string;
    expect(calledUrl).toBe('/api/proxy?url=' + encodeURIComponent('https://backend.blockadelabs.com/api/v1/imagine/requests/42'));
  });
  it('HTTP 非 200 抛错', async () => {
    const fetcher = vi.fn(async () => new Response('x', { status: 403 }));
    await expect(fetchSkyboxById(42, fetcher as unknown as typeof fetch)).rejects.toThrow('403');
  });
  it('file_url 缺失抛错', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ request: { id: 1 } }), { status: 200 }));
    await expect(fetchSkyboxById(1, fetcher as unknown as typeof fetch)).rejects.toThrow('file_url');
  });
});

describe('sanitizeFilename', () => {
  it('替换非法字符', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });
  it('空白名兜底 skybox', () => {
    expect(sanitizeFilename('   ')).toBe('skybox');
  });
});
