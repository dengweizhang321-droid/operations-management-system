import { jackyunModuleOrder, type JackyunModule } from "./post-download";

export type JackyunDownloadMethod = "browser_event" | "oss_fallback";

export type JackyunDownloadProvenance = {
  runId: string;
  module: JackyunModule;
  policyVersion: string;
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

export type ExpectedJackyunDownloadIdentity = {
  runId: string;
  module: JackyunModule;
  policyVersion: string;
};

export function assertDownloadProvenance(
  provenance: JackyunDownloadProvenance,
  allowedHosts: readonly string[] = defaultJackyunDownloadHosts,
) {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(provenance.runId)) throw new Error("下载事件缺少有效 runId。");
  if (!(jackyunModuleOrder as readonly string[]).includes(provenance.module)) throw new Error("下载事件缺少有效 module。");
  if (typeof provenance.policyVersion !== "string" || !provenance.policyVersion.trim()) {
    throw new Error("下载事件缺少有效 policyVersion。");
  }
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

/**
 * Formal imports must bind the browser/OSS event to the exact bytes handed to
 * the runner.  A matching file name and modification time in a shared download
 * directory are not ownership evidence.
 */
export function assertBoundDownloadProvenance(
  provenance: JackyunDownloadProvenance | undefined,
  allowedHosts: readonly string[] = defaultJackyunDownloadHosts,
  expected?: ExpectedJackyunDownloadIdentity,
): asserts provenance is JackyunDownloadProvenance & { sha256: string; bytes: number } {
  if (!provenance) {
    throw Object.assign(new Error("FILE_BINDING_FAILED: 缺少本轮浏览器或 OSS 下载事件证据。"), { code: "FILE_BINDING_FAILED" });
  }
  try {
    assertDownloadProvenance(provenance, allowedHosts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(`FILE_BINDING_FAILED: ${message}`), { code: "FILE_BINDING_FAILED" });
  }
  if (!provenance.sha256 || provenance.bytes === undefined) {
    throw Object.assign(
      new Error("FILE_BINDING_FAILED: 下载事件必须记录本轮文件的 SHA-256 与字节数。"),
      { code: "FILE_BINDING_FAILED" },
    );
  }
  if (expected && (provenance.runId !== expected.runId
      || provenance.module !== expected.module
      || provenance.policyVersion !== expected.policyVersion)) {
    throw Object.assign(
      new Error("FILE_BINDING_FAILED: 下载事件的 runId、module 或 policyVersion 与本轮任务不一致。"),
      { code: "FILE_BINDING_FAILED" },
    );
  }
}
