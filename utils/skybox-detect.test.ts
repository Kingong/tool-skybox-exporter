import { describe, it, expect, vi } from 'vitest';
import {
  parseSkyboxIdFromUrl,
  parseObfuscatedIdFromPath,
  buildDownloadUrl,
  isOriginalImageUrl,
  extractFromResourceEntries,
  extractInitialDataFromScripts,
  fetchSkyboxById,
  sanitizeFilename,
  detectSkybox,
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
  it('命中 images CDN 的 _file 图', () => {
    expect(isOriginalImageUrl('https://images.blockadelabs.com/skybox-starters/92_a185f322c5adc94e85b02be3f5b427d4_file.jpg')).toBe(true);
    expect(isOriginalImageUrl('https://images.blockadelabs.com/skybox-starters/92_a185f322c5adc94e85b02be3f5b427d4_thumb.webp')).toBe(false);
  });
  it('命中 backend download 端点', () => {
    expect(isOriginalImageUrl('https://backend.blockadelabs.com/api/v1/skybox/download/d9672919bc1d6732af59782cc1ce9b8c.jpg')).toBe(true);
  });
  it('排除其他域名', () => {
    expect(isOriginalImageUrl('https://example.com/images/a.jpg')).toBe(false);
  });
});

describe('parseObfuscatedIdFromPath', () => {
  it('解析 embed 分享页路径', () => {
    expect(parseObfuscatedIdFromPath('/e/d9672919bc1d6732af59782cc1ce9b8c')).toBe('d9672919bc1d6732af59782cc1ce9b8c');
    expect(parseObfuscatedIdFromPath('/e/d9672919bc1d6732af59782cc1ce9b8c/')).toBe('d9672919bc1d6732af59782cc1ce9b8c');
  });
  it('拒绝非 embed 路径与非法 hash', () => {
    expect(parseObfuscatedIdFromPath('/login')).toBeNull();
    expect(parseObfuscatedIdFromPath('/e/xyz')).toBeNull();
    expect(parseObfuscatedIdFromPath('/generate')).toBeNull();
  });
});

describe('buildDownloadUrl', () => {
  it('构造公开 download 端点', () => {
    expect(buildDownloadUrl('d9672919bc1d6732af59782cc1ce9b8c')).toBe(
      'https://backend.blockadelabs.com/api/v1/skybox/download/d9672919bc1d6732af59782cc1ce9b8c.jpg',
    );
  });
});

describe('extractInitialDataFromScripts', () => {
  // 模拟真实 RSC payload：script 文本内 JSON 字符串转义形式
  const embedPayload = '22:["$","$L29",null,{"initialData":{"id":15603635,"obfuscatedId":"d9672919bc1d6732af59782cc1ce9b8c","title":"World #15603635","status":"complete","file_url":"https://backend.blockadelabs.com/api/v1/skybox/download/d9672919bc1d6732af59782cc1ce9b8c.jpg"}}]';
  const scriptText = `self.__next_f=self.__next_f||[];self.__next_f.push([1,${JSON.stringify(embedPayload)}]);`;

  it('从 RSC script 文本解析 initialData', () => {
    const data = extractInitialDataFromScripts([{ textContent: scriptText }]);
    expect(data).toMatchObject({
      id: 15603635,
      obfuscatedId: 'd9672919bc1d6732af59782cc1ce9b8c',
      title: 'World #15603635',
      status: 'complete',
    });
  });
  it('无 initialData 时返回 null', () => {
    expect(extractInitialDataFromScripts([{ textContent: 'self.__next_f.push([1,"{}"]);' }])).toBeNull();
    expect(extractInitialDataFromScripts([{ textContent: '' }, { textContent: null }])).toBeNull();
    expect(extractInitialDataFromScripts([])).toBeNull();
  });
  it('兼容多 push 混合与不同 chunk 类型标记（真实页面形态）', () => {
    const dataPush = '5:["$","$L29",null,{"initialData":{"id":9,"obfuscatedId":"cccccccccccccccccccccccccccccccc","title":"T","status":"complete","file_url":"https://backend.blockadelabs.com/api/v1/skybox/download/cccccccccccccccccccccccccccccccc.jpg"}}]';
    const mixed = [
      'self.__next_f=self.__next_f||[];',
      'self.__next_f.push([0,"{}"]);', // 类型 0 无关 push
      `self.__next_f.push([1,${JSON.stringify('2:HL["/_next/static/css/x.css","style"]') }]);`, // 资源预载 push
      `self.__next_f.push([3,${JSON.stringify(dataPush)}]);`, // 类型 3 的 initialData push
    ].join('');
    const data = extractInitialDataFromScripts([{ textContent: mixed }]);
    expect(data).toMatchObject({ id: 9, title: 'T' });
  });
});

describe('detectSkybox 通道优先级', () => {
  const embedPayload = 'x:{"initialData":{"id":7,"obfuscatedId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","title":"Embed World","status":"complete","file_url":"https://backend.blockadelabs.com/api/v1/skybox/download/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg"}}';
  const embedScript = `self.__next_f.push([1,${JSON.stringify(embedPayload)}]);`;

  it('通道1：RSC initialData 优先', async () => {
    const info = await detectSkybox({
      pathname: '/e/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      scripts: [{ textContent: embedScript }],
      entries: [],
    });
    expect(info).toMatchObject({ id: 7, title: 'Embed World', fileUrl: expect.stringContaining('/skybox/download/') });
  });
  it('通道2：embed URL 构造（无 RSC 数据时）', async () => {
    const info = await detectSkybox({ pathname: '/e/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', scripts: [], entries: [] });
    expect(info?.fileUrl).toBe('https://backend.blockadelabs.com/api/v1/skybox/download/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg');
  });
  it('通道3：主动 API（登录态主应用路径）', async () => {
    const inner = encodeURIComponent('https://backend.blockadelabs.com/api/v1/imagine/requests/42');
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ request: { id: 42, title: 'T', status: 'complete', file_url: 'https://x/y.jpg' } }), { status: 200 }),
    );
    const info = await detectSkybox({
      pathname: '/imagine/42',
      scripts: [],
      entries: [{ name: `https://skybox.blockadelabs.com/api/proxy?url=${inner}` }],
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(info?.fileUrl).toBe('https://x/y.jpg');
  });
  it('通道4：被动图床兜底', async () => {
    const info = await detectSkybox({
      pathname: '/whatever',
      scripts: [],
      entries: [{ name: 'https://images.blockadelabs.com/skybox-starters/92_a185f322c5adc94e85b02be3f5b427d4_file.jpg' }],
    });
    expect(info?.fileUrl).toContain('_file.jpg');
  });
  it('全部无命中返回 null（登录页场景）', async () => {
    const info = await detectSkybox({ pathname: '/login', scripts: [], entries: [{ name: 'https://www.googletagmanager.com/gtm.js?id=1' }] });
    expect(info).toBeNull();
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
