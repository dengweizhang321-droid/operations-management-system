import { readFile, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { parseXlsxFirstSheet } from "../imports/xlsx";

export const JD_PRODUCT_DETAIL_REUSE_WINDOW_MS = 60 * 60 * 1000;
export type JdProductDetailDimension = "SKU" | "SPU";
export type JdProductDetailDownloadResult = { filePath: string; reused: boolean; downloadClicks: number };
type FileEvidence = { filePath: string; mtimeMs: number; size: number };
type WaitOptions = { downloadDirectory: string; expectedPrefix: string; minMtimeMs: number; timeoutMs: number; pollIntervalMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void>; dimension?: JdProductDetailDimension };
type GuardOptions = { downloadDirectory: string; expectedPrefix: string; triggerDownload: () => Promise<void>; reuseWindowMs?: number; initialWaitMs?: number; partialGraceMs?: number; pollIntervalMs?: number; maxRetries?: number; now?: () => number; sleep?: (ms: number) => Promise<void>; dimension?: JdProductDetailDimension };
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function matchesCompletedFile(name: string, prefix: string) { return name.startsWith(prefix) && name.toLowerCase().endsWith(".xlsx"); }
function matchesPartialFile(name: string, prefix: string) { return name.startsWith(prefix) && name.toLowerCase().endsWith(".crdownload"); }
function hasDimensionFileName(name: string, dimension: JdProductDetailDimension) { return dimension === "SPU" ? /(?:^|[_-])SPU(?:[_-]|\.|$)/i.test(name) : !/(?:^|[_-])SPU(?:[_-]|\.|$)/i.test(name); }

export async function assertJdProductDetailWorkbookDimension(filePath: string, dimension: JdProductDetailDimension) {
  const sheet = parseXlsxFirstSheet(await readFile(filePath));
  const header = String(sheet.rows[0]?.cells[1] ?? "").trim().toUpperCase();
  if (header !== dimension) throw new Error(`JD workbook dimension mismatch: expected ${dimension}, second column is ${header || "empty"}.`);
}
async function fileMatchesDimension(filePath: string, dimension: JdProductDetailDimension) { try { await assertJdProductDetailWorkbookDimension(filePath, dimension); return true; } catch { return false; } }

async function completedFiles(directory: string, prefix: string, minMtimeMs: number): Promise<FileEvidence[]> {
  const names = await readdir(directory).catch(() => [] as string[]);
  const candidates: FileEvidence[] = [];
  for (const name of names) {
    if (!matchesCompletedFile(name, prefix)) continue;
    const filePath = path.join(directory, name);
    const info = await stat(filePath).catch(() => null);
    const partial = await stat(`${filePath}.crdownload`).catch(() => null);
    if (info?.isFile() && info.size > 0 && info.mtimeMs >= minMtimeMs && !partial) candidates.push({ filePath, mtimeMs: info.mtimeMs, size: info.size });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates;
}

async function newestCompletedFile(directory: string, prefix: string, minMtimeMs: number, dimension?: JdProductDetailDimension): Promise<FileEvidence | null> {
  for (const candidate of await completedFiles(directory, prefix, minMtimeMs)) {
    if (!dimension || await fileMatchesDimension(candidate.filePath, dimension)) return candidate;
  }
  return null;
}

export async function findRecentJdProductDetailDownload(options: { downloadDirectory: string; expectedPrefix: string; maxAgeMs?: number; nowMs?: number; dimension?: JdProductDetailDimension }) {
  const candidates = await completedFiles(options.downloadDirectory, options.expectedPrefix, (options.nowMs ?? Date.now()) - (options.maxAgeMs ?? JD_PRODUCT_DETAIL_REUSE_WINDOW_MS));
  for (const candidate of candidates) {
    if (!options.dimension || await fileMatchesDimension(candidate.filePath, options.dimension)) {
      return candidate.filePath;
    }
  }
  return null;
}

export async function hasActiveJdProductDetailPartial(directory: string, prefix: string, minMtimeMs: number) {
  for (const name of await readdir(directory).catch(() => [] as string[])) {
    if (!matchesPartialFile(name, prefix)) continue;
    const info = await stat(path.join(directory, name)).catch(() => null);
    if (info?.isFile() && info.mtimeMs >= minMtimeMs) return true;
  }
  return false;
}

export async function waitForStableJdProductDetailDownload(options: WaitOptions) {
  const now = options.now ?? Date.now, sleep = options.sleep ?? defaultSleep, interval = options.pollIntervalMs ?? 1_000, deadline = now() + options.timeoutMs;
  let previous: FileEvidence | null = null;
  for (;;) {
    const current = await newestCompletedFile(options.downloadDirectory, options.expectedPrefix, options.minMtimeMs, options.dimension);
    if (current && previous?.filePath === current.filePath && previous.size === current.size && previous.mtimeMs === current.mtimeMs) return current.filePath;
    previous = current;
    if (now() >= deadline) return null;
    await sleep(Math.min(interval, Math.max(0, deadline - now())));
  }
}

export async function finalizeJdProductDetailDownload(filePath: string, dimension: JdProductDetailDimension | undefined) {
  if (!dimension) return filePath;
  await assertJdProductDetailWorkbookDimension(filePath, dimension);
  if (dimension !== "SPU" || hasDimensionFileName(path.basename(filePath), "SPU")) return filePath;
  const parsed = path.parse(filePath), target = path.join(parsed.dir, `${parsed.name}_SPU${parsed.ext}`);
  await rename(filePath, target); // same-directory rename is atomic
  return target;
}

export async function acquireJdProductDetailDownload(options: GuardOptions): Promise<JdProductDetailDownloadResult> {
  const now = options.now ?? Date.now, sleep = options.sleep ?? defaultSleep, interval = options.pollIntervalMs ?? 1_000;
  const recent = await findRecentJdProductDetailDownload({ downloadDirectory: options.downloadDirectory, expectedPrefix: options.expectedPrefix, maxAgeMs: options.reuseWindowMs ?? JD_PRODUCT_DETAIL_REUSE_WINDOW_MS, nowMs: now(), dimension: options.dimension });
  if (recent) return { filePath: await finalizeJdProductDetailDownload(recent, options.dimension), reused: true, downloadClicks: 0 };
  // This must precede the first trigger: a restarted process must not duplicate
  // a Chrome download whose generic filename has not been renamed yet.
  const partialLookbackStart = now() - (options.reuseWindowMs ?? JD_PRODUCT_DETAIL_REUSE_WINDOW_MS);
  if (await hasActiveJdProductDetailPartial(options.downloadDirectory, options.expectedPrefix, partialLookbackStart)) {
    const completed = await waitForStableJdProductDetailDownload({ downloadDirectory: options.downloadDirectory, expectedPrefix: options.expectedPrefix, minMtimeMs: partialLookbackStart, timeoutMs: options.partialGraceMs ?? 300_000, pollIntervalMs: interval, now, sleep, dimension: options.dimension });
    if (completed) return { filePath: await finalizeJdProductDetailDownload(completed, options.dimension), reused: false, downloadClicks: 0 };
    throw new Error("Existing JD product-detail .crdownload did not finish; refusing to trigger another download.");
  }
  const startedAt = now() - 2_000, attempts = 1 + (options.maxRetries ?? 1);
  let triggerError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { await options.triggerDownload(); triggerError = undefined; } catch (error) { triggerError = error; }
    const completed = await waitForStableJdProductDetailDownload({ downloadDirectory: options.downloadDirectory, expectedPrefix: options.expectedPrefix, minMtimeMs: startedAt, timeoutMs: options.initialWaitMs ?? 120_000, pollIntervalMs: interval, now, sleep, dimension: options.dimension });
    if (completed) return { filePath: await finalizeJdProductDetailDownload(completed, options.dimension), reused: false, downloadClicks: attempt + 1 };
    if (await hasActiveJdProductDetailPartial(options.downloadDirectory, options.expectedPrefix, startedAt)) {
      const afterPartial = await waitForStableJdProductDetailDownload({ downloadDirectory: options.downloadDirectory, expectedPrefix: options.expectedPrefix, minMtimeMs: startedAt, timeoutMs: options.partialGraceMs ?? 300_000, pollIntervalMs: interval, now, sleep, dimension: options.dimension });
      if (afterPartial) return { filePath: await finalizeJdProductDetailDownload(afterPartial, options.dimension), reused: false, downloadClicks: attempt + 1 };
      throw new Error("JD product-detail .crdownload remains active; refusing retry.");
    }
  }
  const reason = triggerError instanceof Error ? ` Last click error: ${triggerError.message}` : "";
  throw new Error(`JD product-detail workbook did not arrive within the allowed wait; retry limit reached.${reason}`);
}
