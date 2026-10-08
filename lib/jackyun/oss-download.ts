import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { JackyunModule } from "./post-download";
import { downloadFailureCode, isTransientDownloadCode, JackyunDownloadFailure } from "./download-failure";
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
  policyVersion?: string;
  exportIntentAt: string;
  allowedHosts?: readonly string[];
  timeoutMs?: number;
};

function safeBaseName(value: string) {
  const decoded = decodeURIComponent(value);
  const clean = path.basename(decoded).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return clean.toLowerCase().endsWith(".xlsx") ? clean : `${clean || "export"}.xlsx`;
}

async function fetchAllowed(url: URL, allowedHosts: readonly string[], signal: AbortSignal, request: typeof fetch) {
  let current = url;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    // OSS 签名 URL 可能是 HTTP，白名单域名自动升级为 HTTPS（OSS 支持 HTTPS）
    if (current.protocol === "http:" && allowedHosts.includes(current.hostname)) {
      current = new URL(current.toString().replace(/^http:/, "https:"));
    }
    if (current.protocol !== "https:" || current.username || current.password || current.port || !allowedHosts.includes(current.hostname)) {
      throw Object.assign(new Error("拒绝非白名单 OSS 地址。"), { code: "SOURCE_REJECTED" });
    }
    signal.throwIfAborted();
    const response = await request(current, { redirect: "manual", signal });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("OSS 重定向缺少 Location。");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      throw Object.assign(new Error("OSS HTTP failure"), { code: `HTTP_${response.status}` });
    }
    return { response, finalUrl: current };
  }
  throw new Error("OSS 下载重定向次数过多。");
}

export async function downloadSignedOssExport(options: DownloadOptions, deps: {
  request?: typeof fetch; sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
} = {}) {
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
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300000) throw new Error("OSS 下载期限无效。");
  const signal = AbortSignal.timeout(timeoutMs);
  const sleep = deps.sleep ?? (async (ms: number, abort: AbortSignal) => {
    const { setTimeout } = await import("node:timers/promises");
    await setTimeout(ms, undefined, { signal: abort });
  });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      const { response, finalUrl } = await fetchAllowed(requestedUrl, allowedHosts, signal, deps.request ?? fetch);
      const hashStream = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          bytes += chunk.byteLength;
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body as never), hashStream, createWriteStream(partialPath, { flags: "wx" }), { signal });
      if (!bytes) throw Object.assign(new Error("OSS 下载文件为空。"), { code: "EMPTY_FILE" });
      const handle = await open(partialPath, "r");
      try {
        const signature = Buffer.alloc(4);
        await handle.read(signature, 0, 4, 0);
        if (!signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw Object.assign(new Error("OSS 返回内容不是有效 XLSX/ZIP 文件。"), { code: "INVALID_XLSX" });
      } finally {
        await handle.close();
      }
      await rename(partialPath, finalPath);
      const provenance: JackyunDownloadProvenance = {
        runId: options.runId,
        module: options.module,
        policyVersion: options.policyVersion ?? "standalone-export-v1",
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
      // A failed cleanup cannot prove an empty download slot: do not retry it.
      try { await rm(partialPath, { force: true }); }
      catch { throw new JackyunDownloadFailure("CLEANUP_FAILED", attempt, false); }
      const classified = downloadFailureCode(error);
      const abortedRead = error instanceof Error && error.name === "AbortError";
      const code = signal.aborted && (abortedRead || isTransientDownloadCode(classified)) ? "ETIMEDOUT" : classified;
      const retryable = isTransientDownloadCode(code);
      if (!retryable || attempt === 3 || signal.aborted) throw new JackyunDownloadFailure(code, attempt, retryable);
      try { await sleep(attempt * 2000, signal); signal.throwIfAborted(); }
      catch { throw new JackyunDownloadFailure("ETIMEDOUT", attempt, true); }
    }
  }
  throw new Error("OSS download attempts exhausted");
}
