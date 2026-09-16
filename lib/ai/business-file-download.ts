import { fetchBoundedJson } from "./bounded-fetch";

export type BusinessFileRun = {
  id: string; reportId: string; draft: boolean; status: string; version: number; attempt: number;
  bindingDigest: string; storedBytes: number; errorCode: string;
  progress: { stage?: string; sourcePage?: number; table?: number; rows?: number; chunks?: number; bytes?: number };
  manifest: { schemaVersion: string; attempt: number; bindingDigest: string; draft: boolean; files: Record<"html" | "xlsx", BusinessFile> } | null;
};
type BusinessFile = { bytes: number; chunkCount: number; chunkBytes: number; sha256: string; fileName: string; mimeType: string };
const digestPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[A-Za-z0-9_-]{1,160}$/;
const fail = () => new Error("报告文件未通过完整性校验，请刷新任务后重试。");

export async function businessFileJson<T>(url: string, init: RequestInit = {}, options: { fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<T> {
  options.signal?.throwIfAborted();
  const { response, data } = await fetchBoundedJson({ url, init: { cache: "no-store", ...init }, timeoutMs: 30_000, maxBytes: 1024*1024, ...options });
  if (!response.ok) throw new Error(data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "报告文件请求失败");
  if (!data || typeof data !== "object" || Array.isArray(data)) throw fail();
  return data as T;
}

async function sha256(bytes: Uint8Array) {
  const result = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, "0")).join("");
}

export async function downloadBusinessFile(runId: string, format: "html" | "xlsx", options: { fetcher?: typeof fetch; signal?: AbortSignal; onProgress?: (received: number, total: number) => void } = {}) {
  if (!idPattern.test(runId) || !["html", "xlsx"].includes(format)) throw fail();
  const base = "/api/ai/business-files/"+runId;
  const { item } = await businessFileJson<{ item: BusinessFileRun }>(base, {}, options);
  const manifest = item?.manifest, file = manifest?.files?.[format];
  const mime = format === "html" ? "text/html; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (item?.id !== runId || item.status !== "ready" || manifest?.schemaVersion !== "business-file-delivery-v1" || manifest.attempt !== item.attempt || manifest.bindingDigest !== item.bindingDigest || !digestPattern.test(item.bindingDigest) || !Number.isInteger(item.attempt) || item.attempt < 1 || item.attempt > 5 || !file || !Number.isInteger(file.bytes) || file.bytes < 1 || file.bytes > 256*1024*1024 || file.chunkBytes !== 512*1024 || file.chunkCount !== Math.ceil(file.bytes/file.chunkBytes) || !digestPattern.test(file.sha256) || file.mimeType !== mime || typeof file.fileName !== "string" || !file.fileName.endsWith("."+format) || file.fileName.length > 240 || /[\\/\x00-\x1f]/.test(file.fileName)) throw fail();
  const bytes = new Uint8Array(file.bytes);
  let received = 0;
  options.onProgress?.(0, file.bytes);
  for (let sequence=1; sequence<=file.chunkCount; sequence++) {
    options.signal?.throwIfAborted();
    const part = await businessFileJson<{ schemaVersion: string; runId: string; attempt: number; sequence: number; format: string; bytes: number; sha256: string; fileSha256: string; base64: string }>(`${base}/chunks/${format}?sequence=${sequence}`, {}, options);
    if (part.schemaVersion !== "business-file-chunk-v1" || part.runId !== runId || part.attempt !== item.attempt || part.sequence !== sequence || part.format !== format || part.fileSha256 !== file.sha256 || !digestPattern.test(part.sha256) || typeof part.base64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(part.base64)) throw fail();
    let chunk: Uint8Array;
    try { chunk = Uint8Array.from(atob(part.base64), character => character.charCodeAt(0)); } catch { throw fail(); }
    if (chunk.length !== Math.min(file.chunkBytes, file.bytes-received) || part.bytes !== chunk.length || await sha256(chunk) !== part.sha256) throw fail();
    bytes.set(chunk, received);
    received += chunk.length;
    options.onProgress?.(received, file.bytes);
  }
  if (received !== file.bytes || await sha256(bytes) !== file.sha256) throw fail();
  // Recheck live permission and immutable delivery identity before exposing a Blob.
  const fresh = await businessFileJson<{ item: BusinessFileRun }>(base, {}, options);
  if (fresh.item?.id !== runId || fresh.item.status !== "ready" || fresh.item.attempt !== item.attempt || fresh.item.bindingDigest !== item.bindingDigest || fresh.item.manifest?.files?.[format]?.sha256 !== file.sha256) throw fail();
  options.signal?.throwIfAborted();
  return { blob: new Blob([bytes.buffer], { type: mime }), fileName: file.fileName, sha256: file.sha256 };
}
