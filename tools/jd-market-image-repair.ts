import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeChromeBrowser, launchDedicatedChrome, waitForChrome } from "../lib/jackyun/cdp-client";
import { connectPlaywrightBrowser, connectPlaywrightJackyunTarget } from "../lib/jackyun/playwright-client";
import { withJdChromiumRunLock } from "../lib/jd/chromium-run-lock";
import { getJdStore } from "../lib/jd/store-registry";
import {
  boundedInteger,
  fillMissingImagesOnOpenPage,
  jsonRequest,
  normalizeBaseUrl,
  readFillCandidates,
  recordValue,
  type MarketImageCacheRequest,
} from "../lib/market/jd-image-fill";

export {
  fetchJdImages,
  fillMissingImagesOnOpenPage,
  JD_MARKET_IMAGE_FILL_MAX_SKUS,
  parseJdMarketRepairImageResponse,
  summarizeJdMarketRepairImageResponse,
  type JdMarketImageFillResult,
} from "../lib/market/jd-image-fill";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(projectRoot, "config", "jd-market-ranking-daily.json");

type MarketImageCacheTotals = {
  pending: number;
  cached: number;
  failed: number;
  processed: number;
};

type MarketImageCacheJobSnapshot = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  total: number;
  pending: number;
  propagationPending: number;
  cached: number;
  failed: number;
  processedCount: number;
  errorCode: string;
  errorMessage: string;
};

type MarketImageCachePollOptions = {
  signal?: AbortSignal;
  pollIntervalMs?: number;
  maxPolls?: number;
  request?: MarketImageCacheRequest;
};

const DEFAULT_IMAGE_CACHE_POLL_INTERVAL_MS = 2_000;
const DEFAULT_IMAGE_CACHE_MAX_POLLS = 7_200;

function numericField(record: Record<string, unknown>, key: string, fallback?: number) {
  if (!Object.hasOwn(record, key) && fallback !== undefined) return fallback;
  const value = Number(record[key]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`图片缓存响应字段 ${key} 无效`);
  return value;
}

function parseMarketImageCacheJob(value: unknown): MarketImageCacheJobSnapshot | null {
  const job = recordValue(value);
  if (!job) return null;
  const id = typeof job.id === "string" ? job.id.trim() : "";
  const status = typeof job.status === "string" ? job.status : "";
  if (!id || !["queued", "running", "completed", "failed"].includes(status)) {
    throw new Error("图片缓存任务响应缺少有效的 job id 或 status");
  }
  return {
    id,
    status: status as MarketImageCacheJobSnapshot["status"],
    total: numericField(job, "total"),
    pending: numericField(job, "pending"),
    propagationPending: numericField(job, "propagationPending", 0),
    cached: numericField(job, "cached"),
    failed: numericField(job, "failed"),
    processedCount: numericField(job, "processedCount", 0),
    errorCode: typeof job.errorCode === "string" ? job.errorCode.slice(0, 120) : "",
    errorMessage: typeof job.errorMessage === "string" ? job.errorMessage.slice(0, 500) : "",
  };
}

function parseLegacyMarketImageCacheResult(value: unknown): MarketImageCacheTotals | null {
  const result = recordValue(value);
  if (!result) return null;
  return {
    pending: numericField(result, "pending"),
    cached: numericField(result, "cached"),
    failed: numericField(result, "failed"),
    processed: numericField(result, "processed", 0),
  };
}

function interruptedImageCacheError(signal?: AbortSignal) {
  const suffix = typeof signal?.reason === "string"
    ? signal.reason
    : signal?.reason instanceof Error && signal.reason.message !== "This operation was aborted"
      ? signal.reason.message
      : "";
  const error = new Error(`市场图片缓存任务轮询已中断${suffix ? `：${suffix}` : ""}`);
  error.name = "AbortError";
  return error;
}

function assertImageCachePollingActive(signal?: AbortSignal) {
  if (signal?.aborted) throw interruptedImageCacheError(signal);
}

function waitForImageCachePoll(signal: AbortSignal | undefined, delayMs: number) {
  assertImageCachePollingActive(signal);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const abort = () => {
      cleanup();
      reject(interruptedImageCacheError(signal));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function completedCacheTotals(job: MarketImageCacheJobSnapshot): MarketImageCacheTotals {
  return { pending: job.pending + job.propagationPending, cached: job.cached, failed: job.failed, processed: job.processedCount };
}

function assertImageCacheJobSucceeded(job: MarketImageCacheJobSnapshot) {
  if (job.status !== "failed") return;
  const details = job.errorMessage || job.errorCode || "后台任务未提供失败原因";
  throw new Error(`市场图片缓存任务失败（${job.id}）：${details}`);
}

async function pollMarketImageCacheJob(
  baseUrl: string,
  initialJob: MarketImageCacheJobSnapshot,
  options: Required<Pick<MarketImageCachePollOptions, "pollIntervalMs" | "maxPolls" | "request">> & Pick<MarketImageCachePollOptions, "signal">,
) {
  let job = initialJob;
  assertImageCacheJobSucceeded(job);
  if (job.status === "completed") return completedCacheTotals(job);
  for (let poll = 0; poll < options.maxPolls; poll += 1) {
    await waitForImageCachePoll(options.signal, options.pollIntervalMs);
    assertImageCachePollingActive(options.signal);
    let body: { job?: unknown };
    try {
      body = await jsonRequest<{ job?: unknown }>(
        `${baseUrl}/api/market/images/cache?jobId=${encodeURIComponent(job.id)}`,
        { cache: "no-store", signal: options.signal },
        options.request,
      );
    } catch (error) {
      if (options.signal?.aborted) throw interruptedImageCacheError(options.signal);
      throw error;
    }
    const nextJob = parseMarketImageCacheJob(body.job);
    if (!nextJob) throw new Error("图片缓存任务状态响应缺少 job");
    if (nextJob.id !== job.id) throw new Error(`图片缓存任务身份不一致：期望 ${job.id}，实际 ${nextJob.id}`);
    job = nextJob;
    assertImageCacheJobSucceeded(job);
    if (job.status === "completed") return completedCacheTotals(job);
  }
  throw new Error(
    `市场图片缓存任务轮询超时（${job.id}）：状态 ${job.status}，待缓存 ${job.pending}，待传播 ${job.propagationPending}；后台任务仍会继续运行`,
  );
}

/** Submit the background cache job and wait for its bounded terminal state. */
export async function cacheRepairedImages(baseUrl: string, options: MarketImageCachePollOptions = {}) {
  const pollOptions = {
    signal: options.signal,
    pollIntervalMs: boundedInteger(options.pollIntervalMs, DEFAULT_IMAGE_CACHE_POLL_INTERVAL_MS, 0, 60_000, "轮询间隔"),
    maxPolls: boundedInteger(options.maxPolls, DEFAULT_IMAGE_CACHE_MAX_POLLS, 1, 10_000, "最大轮询次数"),
    request: options.request ?? fetch,
  };
  let noProgressRounds = 0;
  let latest: MarketImageCacheTotals = { pending: 0, cached: 0, failed: 0, processed: 0 };
  for (let round = 0; round < 250; round += 1) {
    assertImageCachePollingActive(pollOptions.signal);
    let body: { job?: unknown; result?: unknown };
    try {
      body = await jsonRequest<{ job?: unknown; result?: unknown }>(
        `${baseUrl}/api/market/images/cache`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 24 }), signal: pollOptions.signal },
        pollOptions.request,
      );
    } catch (error) {
      if (pollOptions.signal?.aborted) throw interruptedImageCacheError(pollOptions.signal);
      throw error;
    }
    const job = parseMarketImageCacheJob(body.job);
    if (job) return pollMarketImageCacheJob(baseUrl, job, pollOptions);
    const legacyResult = parseLegacyMarketImageCacheResult(body.result);
    if (!legacyResult) throw new Error("图片缓存响应既不包含异步 job，也不包含兼容 result");
    latest = legacyResult;
    if (latest.pending <= 0) break;
    noProgressRounds = latest.processed === 0 ? noProgressRounds + 1 : 0;
    if (noProgressRounds >= 3) break;
  }
  return latest;
}

export async function runJdMarketImageRepair(options: { baseUrl?: string; signal?: AbortSignal; maxSkus?: number } = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.OPERATIONS_SYSTEM_URL ?? "http://127.0.0.1:3000");
  const maxSkus = options.maxSkus ?? 20_000;
  const preview = await readFillCandidates(baseUrl, boundedInteger(maxSkus, 20_000, 1, 100_000, "图片补全 SKU 上限"));
  if (!preview.items.length) return { ok: true, candidateCount: 0, repairedCount: 0, unresolvedCount: 0 };
  const config = JSON.parse(await readFile(configPath, "utf8")) as { storeKey?: string };
  if (!config.storeKey) throw new Error("京东市场榜单配置缺少受控店铺");
  const store = await getJdStore(config.storeKey);
  const fill = await withJdChromiumRunLock("market-image-repair", async () => {
    const launched = await launchDedicatedChrome({
      executablePath: store.browser.executablePath,
      profileDirectory: store.browser.userDataDir,
      profileName: store.browser.profileName,
      port: store.browser.debugPort,
      startUrl: "about:blank",
      headless: false,
      visible: false,
      startMinimized: true,
      keepWindowHidden: true,
    });
    if (!launched) throw new Error("京东图片修复拒绝复用不受本次窗口守护控制的 Chromium 实例");
    let browser: Awaited<ReturnType<typeof connectPlaywrightBrowser>> | null = null;
    try {
      await waitForChrome(store.browser.debugPort);
      browser = await connectPlaywrightBrowser(store.browser.debugPort);
      const { page } = await connectPlaywrightJackyunTarget(browser, {
        workerName: "teruisi-jd-market-image-repair",
        targetUrlPattern: /jdsz\.jd\.com/i,
        requireMini: false,
      });
      return await fillMissingImagesOnOpenPage(page, store, { baseUrl, maxSkus, deadlineMs: 60 * 60_000 });
    } finally {
      await browser?.close().catch(() => undefined);
      await closeChromeBrowser(store.browser.debugPort);
    }
  });
  const cache = fill.entriesFilled + fill.snapshotsFilled > 0 ? await cacheRepairedImages(baseUrl, { signal: options.signal }) : null;
  return {
    ok: true,
    candidateCount: fill.candidateIdentityCount,
    jdResolvedCount: fill.resolvedSkuCount,
    repairedCount: fill.resolvedSkuCount,
    unresolvedCount: fill.unresolvedSkuCount,
    rankingRowsUpdated: fill.entriesFilled,
    snapshotsUpdated: fill.snapshotsFilled,
    skippedIdentityCount: fill.skippedIdentityCount,
    truncated: fill.truncated,
    cache,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  let interruptedExitCode = 0;
  const interrupt = (signal: "SIGINT" | "SIGTERM") => {
    interruptedExitCode ||= signal === "SIGINT" ? 130 : 143;
    if (!controller.signal.aborted) controller.abort(`收到 ${signal}`);
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  runJdMarketImageRepair({ signal: controller.signal }).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.unresolvedCount > 0) process.exitCode = 2;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = interruptedExitCode || 1;
  }).finally(() => {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  });
}
