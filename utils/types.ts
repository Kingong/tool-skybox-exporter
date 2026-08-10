/** skybox 核心信息（对应前端 zod schema 的最小字段集） */
export interface SkyboxInfo {
  id: number;
  obfuscatedId?: string;
  title: string;
  fileUrl: string;
  thumbUrl?: string;
  status: string;
}

/** 从页面资源条目中提取的检测资产 */
export interface DetectedAssets {
  /** 被动通道：S3 原图 URL 列表 */
  fileUrls: string[];
  /** 主动通道原料：从 /api/proxy 请求里解析出的 skybox id */
  skyboxIds: number[];
}

export type ExportRequest = {
  type: 'EXPORT_SKYBOX';
  payload: { url: string; title: string };
};

export type ExportResponse =
  | { ok: true; downloadId: number }
  | { ok: false; error: string };

export type GetDetectedRequest = { type: 'GET_DETECTED' };

export type GetDetectedResponse = DetectedAssets & { current: SkyboxInfo | null };

export type ExtMessage = ExportRequest | GetDetectedRequest;
