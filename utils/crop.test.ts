import { describe, it, expect } from 'vitest';
import { computeCropRect, WATERMARK_TOP_PCT, WATERMARK_BOTTOM_PCT } from './crop';

describe('computeCropRect', () => {
  it('8K 原图默认参数：顶 17% 底 17%，保留 66%', () => {
    const r = computeCropRect(8192, 4096);
    expect(r.sx).toBe(0);
    expect(r.sw).toBe(8192);
    expect(r.sy).toBe(Math.round(4096 * WATERMARK_TOP_PCT)); // 696
    expect(r.sh).toBe(Math.round(4096 * (1 - WATERMARK_TOP_PCT - WATERMARK_BOTTOM_PCT))); // 2703
    expect(r.sy).toBe(696);
    expect(r.sh).toBe(2703);
  });
  it('自定义比例', () => {
    const r = computeCropRect(1000, 500, 0.1, 0.2);
    expect(r.sy).toBe(50);
    expect(r.sh).toBe(350);
  });
  it('比例过大抛错', () => {
    expect(() => computeCropRect(100, 100, 0.5, 0.5)).toThrow();
  });
});
