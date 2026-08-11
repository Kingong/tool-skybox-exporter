/**
 * 水印横幅裁剪（2026-08-10 实测：8192×4096 带水印图顶部横幅 16.5%、底部 15.6%，含白色 ribbon 装饰带）。
 * 取 17% 余量防止边缘残留；全景天顶/地面边缘为变形区，多裁 0.5% 对内容几乎无损。
 */
export const WATERMARK_TOP_PCT = 0.17;
export const WATERMARK_BOTTOM_PCT = 0.17;

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** 计算裁剪矩形（裁掉上下横幅，保留中间内容区） */
export function computeCropRect(
  width: number,
  height: number,
  topPct: number = WATERMARK_TOP_PCT,
  bottomPct: number = WATERMARK_BOTTOM_PCT,
): CropRect {
  if (topPct + bottomPct >= 0.9) throw new Error('crop percentages too large');
  const sy = Math.round(height * topPct);
  const sh = Math.round(height * (1 - topPct - bottomPct));
  return { sx: 0, sy, sw: width, sh };
}

/**
 * canvas 裁剪图片 Blob，输出 JPEG（q0.95 降低二次压缩损失）。
 * 仅在浏览器/content script/popup 上下文可用（依赖 createImageBitmap + canvas）。
 */
export async function cropImageBlob(
  blob: Blob,
  topPct: number = WATERMARK_TOP_PCT,
  bottomPct: number = WATERMARK_BOTTOM_PCT,
  quality = 0.95,
): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const { sx, sy, sw, sh } = computeCropRect(bmp.width, bmp.height, topPct, bottomPct);
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  bmp.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas toBlob failed'))), 'image/jpeg', quality),
  );
}
