import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { JackyunModule } from "./post-download";
import {
  assertDownloadProvenance,
  defaultJackyunDownloadHosts,
  type JackyunDownloadProvenance,
} from "./download-provenance";

type DownloadOptions = {
  url: string;
  downloadDirectory: string;
  runId: string;
  module: JackyunModule;
  exportIntentAt: string;
  allowedHosts?: readonly string[];
  timeoutMs?: number;
};

function safeBaseName(value: string) {
  const decoded = decodeURIComponent(value);
  const clean = path.basename(decoded).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return clean.toLowerCase().endsWith(".xlsx") ? clean : `${clean || "export"}.xlsx`;
}

async function fetchAllowed(url: URL, allowedHosts: readonly string[], timeoutMs: number) {
  let current = url;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    // OSS 签名 URL 可能是 HTTP，白名单域名自动升级为 HTTPS（OSS 支持 HTTPS）
    if (current.protocol === "http:" && allowedHosts.includes(current.hostname)) {
      current = new URL(current.toString().replace(/^http:/, "https:"));
    }
    if (current.protocol !== "https:" || !allowedHosts.includes(current.hostname)) {
      throw new Error(`拒绝非白名单 OSS 地址：${current.hostname}。`);
    }
    const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("OSS 重定向缺少 Location。");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`OSS 下载失败：HTTP ${response.status}。`);
    return { response, finalUrl: current };
  }
  throw new Error("OSS 下载重定向次数过多。");
}

export async function downloadSignedOssExport(options: DownloadOptions) {
  if (!Number.isFinite(Date.parse(options.exportIntentAt))) throw new Error("OSS 下载缺少有效 exportIntentAt。");
  const allowedHosts = options.allowedHosts ?? defaultJackyunDownloadHosts;
  const requestedUrl = new URL(options.url);
  const sourceUrlHash = createHash("sha256").update(requestedUrl.toString(), "utf8").digest("hex");
  const downloadId = randomUUID();
  const moduleDirectory = path.join(options.downloadDirectory, "jackyun", options.runId, options.module);
  await mkdir(moduleDirectory, { recursive: true });
  const originalFileName = safeBaseName(requestedUrl.pathname);
  const finalPath = path.join(moduleDirectory, `${path.parse(originalFileName).name}-${downloadId}.xlsx`);
  const partialPath = `${finalPath}.part`;
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    const { response, finalUrl } = await fetchAllowed(requestedUrl, allowedHosts, options.timeoutMs ?? 60_000);
    const hashStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        bytes += chunk.byteLength;
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body as never), hashStream, createWriteStream(partialPath, { flags: "wx" }));
    if (!bytes) throw new Error("OSS 下载文件为空。");
    const handle = await open(partialPath, "r");
    try {
      const signature = Buffer.alloc(4);
      await handle.read(signature, 0, 4, 0);
      if (!signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error("OSS 返回内容不是有效 XLSX/ZIP 文件。");
    } finally {
      await handle.close();
    }
    await rename(partialPath, finalPath);
    const provenance: JackyunDownloadProvenance = {
      downloadId,
      method: "oss_fallback",
      completedAt: new Date().toISOString(),
      originalFileName,
      sourceHost: finalUrl.hostname,
      sourceUrlHash,
      sha256: hash.digest("hex"),
      bytes,
    };
    assertDownloadProvenance(provenance, allowedHosts);
    return { filePath: finalPath, provenance };
  } catch (error) {
    await rm(partialPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
