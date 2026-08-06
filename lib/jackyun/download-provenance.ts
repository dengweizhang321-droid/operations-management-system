export type JackyunDownloadMethod = "browser_event" | "oss_fallback";

export type JackyunDownloadProvenance = {
  downloadId: string;
  method: JackyunDownloadMethod;
  completedAt: string;
  originalFileName: string;
  sourceHost?: string;
  sourceUrlHash?: string;
  sha256?: string;
  bytes?: number;
};

export const defaultJackyunDownloadHosts = [
  "jackyun-shortterm.oss-cn-zhangjiakou.aliyuncs.com",
] as const;

export function assertDownloadProvenance(
  provenance: JackyunDownloadProvenance,
  allowedHosts: readonly string[] = defaultJackyunDownloadHosts,
) {
  if (provenance.method !== "browser_event" && provenance.method !== "oss_fallback") {
    throw new Error(`下载事件 method 无效：${String(provenance.method)}。`);
  }
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(provenance.downloadId)) throw new Error("下载事件缺少有效 downloadId。");
  if (!Number.isFinite(Date.parse(provenance.completedAt))) throw new Error("下载事件缺少有效 completedAt。");
  if (!provenance.originalFileName.trim()) throw new Error("下载事件缺少原始文件名。");
  if (provenance.method === "oss_fallback") {
    if (!provenance.sourceHost || !allowedHosts.includes(provenance.sourceHost)) {
      throw new Error(`OSS 下载来源不在允许列表：${provenance.sourceHost ?? "未知"}。`);
    }
    if (!/^[a-f0-9]{64}$/i.test(provenance.sourceUrlHash ?? "")) throw new Error("OSS 下载缺少有效 URL 哈希。");
  }
  if (provenance.sha256 && !/^[a-f0-9]{64}$/i.test(provenance.sha256)) throw new Error("下载事件 SHA-256 格式无效。");
  if (provenance.bytes !== undefined && (!Number.isSafeInteger(provenance.bytes) || provenance.bytes <= 0)) {
    throw new Error("下载事件字节数无效。");
  }
}
