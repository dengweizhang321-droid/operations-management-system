import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Page } from "playwright-core";

import { jdBrowserLaunchMode, isJdInteractiveBrowserFailure, revealJdBrowserForInteractiveFailure } from "../lib/jd/browser-mode";
import { withJdChromiumRunLock } from "../lib/jd/chromium-run-lock";
import {
  inspectJdPromotionCsv,
  jdPromotionReportPrefix,
  selectJdPromotionDownloadTask,
  validateJdPromotionImportProof,
  type JdPromotionDownloadTask,
} from "../lib/jd/promotion-report";
import { getJdStore, type JdStore } from "../lib/jd/store-registry";
import { closeChromeBrowser, launchDedicatedChrome, waitForChrome } from "../lib/jackyun/cdp-client";
import { writeJsonAtomic } from "../lib/jackyun/json-file";
import { connectPlaywrightBrowser, connectPlaywrightJackyunTarget } from "../lib/jackyun/playwright-client";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = path.join(projectRoot, "outputs", "jd-promotion-export");
export const jdPromotionReportListUrl = "https://jzt.jd.com/custom-report/#/list";
export const jdPromotionReportName = "AI推广数据自动下载";
const downloadCenterUrl = "https://jzt.jd.com/custom-report/#/download";
const defaultBaseUrl = (process.env.OPERATIONS_SYSTEM_URL ?? "http://localhost:3000").replace(/\/$/, "");
const maximumCsvBytes = 25 * 1024 * 1024;

export type JdPromotionExportOptions = {
  storeKey: string;
  startDate: string;
  endDate: string;
  baseUrl: string;
  runId: string;
  visibleRecovery: boolean;
  interactiveLogin: boolean;
};

export type JdPromotionExportResult = {
  ok: true;
  runId: string;
  storeKey: string;
  shopName: string;
  startDate: string;
  endDate: string;
  reportName: string;
  taskCreatedAt: string;
  savedPath: string;
  fileSizeBytes: number;
  sha256: string;
  rowCount: number;
  accountNicknames: string[];
  productLines: string[];
  impressions: number;
  clicks: number;
  spendYuan: number;
  totalOrders: number;
  totalOrderAmountYuan: number;
  importResult: ReturnType<typeof validateJdPromotionImportProof>;
};

type PromotionManifest = {
  version: 1;
  runId: string;
  storeKey: string;
  shopId: string;
  shopName: string;
  accountLabel: string;
  startDate: string;
  endDate: string;
  reportPrefix: string;
  status: "submitting" | "submitted" | "downloaded" | "completed";
  baselineFingerprints: string[];
  task?: JdPromotionDownloadTask;
  savedPath?: string;
  fileSizeBytes?: number;
  sha256?: string;
  rowCount?: number;
  batchId?: string;
  createdAt: string;
  updatedAt: string;
};

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function validRunId(value: string) {
  return /^[A-Za-z0-9._-]{1,96}$/.test(value);
}

export function shanghaiYesterday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function parseJdPromotionArgs(argv: string[], now = new Date()): JdPromotionExportOptions {
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const yesterday = shanghaiYesterday(now);
  const startDate = value("--start-date") ?? yesterday;
  const endDate = value("--end-date") ?? startDate;
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate || startDate.slice(0, 7) !== endDate.slice(0, 7)) {
    throw new Error("京准通推广导出要求同一自然月内的有效起止日期");
  }
  if (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime() > 30 * 86_400_000) {
    throw new Error("京准通推广导出单次范围不能超过 31 天");
  }
  const baseUrl = normalizeLocalBaseUrl(value("--base-url") ?? defaultBaseUrl);
  const runId = value("--run-id") ?? `jd-promotion-${randomUUID()}`;
  if (!validRunId(runId)) throw new Error("京准通推广导出运行编号无效");
  return {
    storeKey: value("--store-key") ?? "jd-yiyong-director",
    startDate,
    endDate,
    baseUrl,
    runId,
    visibleRecovery: !argv.includes("--no-visible-recovery"),
    interactiveLogin: argv.includes("--interactive-login"),
  };
}

export function normalizeLocalBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)
    || (url.pathname !== "/" && url.pathname !== "") || url.username || url.password) {
    throw new Error("京准通推广导出只允许连接本机运营系统根地址");
  }
  return url.toString().replace(/\/$/, "");
}

function manifestPath(runId: string) {
  if (!validRunId(runId)) throw new Error("京准通推广导出运行编号无效");
  return path.join(artifactDirectory, `manifest-${runId}.json`);
}

function newManifest(options: JdPromotionExportOptions, store: JdStore, baselineFingerprints: string[]): PromotionManifest {
  const now = new Date().toISOString();
  return {
    version: 1,
    runId: options.runId,
    storeKey: store.storeKey,
    shopId: store.shopId,
    shopName: store.shopName,
    accountLabel: store.accountLabel,
    startDate: options.startDate,
    endDate: options.endDate,
    reportPrefix: jdPromotionReportPrefix(store.accountLabel, options.startDate, options.endDate),
    status: "submitting",
    baselineFingerprints,
    createdAt: now,
    updatedAt: now,
  };
}

function assertManifest(manifest: PromotionManifest, options: JdPromotionExportOptions, store: JdStore) {
  const expectedPrefix = jdPromotionReportPrefix(store.accountLabel, options.startDate, options.endDate);
  if (manifest.version !== 1 || manifest.runId !== options.runId || manifest.storeKey !== store.storeKey
    || manifest.shopId !== store.shopId || manifest.shopName !== store.shopName || manifest.accountLabel !== store.accountLabel
    || manifest.startDate !== options.startDate || manifest.endDate !== options.endDate || manifest.reportPrefix !== expectedPrefix
    || !["submitting", "submitted", "downloaded", "completed"].includes(manifest.status)
    || !Array.isArray(manifest.baselineFingerprints)) {
    throw new Error("京准通推广恢复清单与当前运行、店铺或日期范围不一致");
  }
}

async function readManifest(options: JdPromotionExportOptions, store: JdStore) {
  const file = manifestPath(options.runId);
  const raw = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error));
  if (!raw) return null;
  const manifest = JSON.parse(raw) as PromotionManifest;
  assertManifest(manifest, options, store);
  return manifest;
}

async function persistManifest(manifest: PromotionManifest) {
  manifest.updatedAt = new Date().toISOString();
  await writeJsonAtomic(manifestPath(manifest.runId), manifest);
}

export async function readJdPromotionDownloadTasks(page: Page): Promise<JdPromotionDownloadTask[]> {
  const tasks: JdPromotionDownloadTask[] = [];
  const rows = await page.getByRole("row").all();
  for (const row of rows) {
    const cells = await row.getByRole("cell").all();
    if (cells.length < 6) continue;
    const reportName = (await cells[1]!.innerText()).trim();
    const status = (await cells[2]!.innerText()).trim();
    const range = (await cells[3]!.innerText()).replace(/\s+/g, " ");
    const createdAt = (await cells[4]!.innerText()).trim();
    const startDate = /起[：:]\s*(\d{4}-\d{2}-\d{2})/.exec(range)?.[1] ?? "";
    const endDate = /止[：:]\s*(\d{4}-\d{2}-\d{2})/.exec(range)?.[1] ?? "";
    if (!reportName || !startDate || !endDate || !createdAt) continue;
    tasks.push({ fingerprint: `${reportName}\u001f${startDate}\u001f${endDate}\u001f${createdAt}`, reportName, status, startDate, endDate, createdAt });
  }
  return tasks;
}

export async function assertJdPromotionAccount(page: Page, store: JdStore, requireReportHeading = false) {
  if (requireReportHeading) await page.getByRole("heading", { name: jdPromotionReportName, exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction((accountLabel) => {
    const text = document.body?.innerText ?? "";
    return text.includes(accountLabel) || /验证码|人机验证|安全验证|滑块验证|访问验证/.test(text);
  }, store.accountLabel, { timeout: 30_000 }).catch(() => undefined);
  const bodyText = await page.locator("body").innerText();
  if (/验证码|人机验证|安全验证|滑块验证|访问验证/.test(bodyText)) throw new Error("京准通页面出现安全验证，已停止自动操作");
  if (!bodyText.includes(store.accountLabel)) throw new Error(`京准通登录身份不一致：页面未显示受控账号 ${store.accountLabel}`);
}

async function openJdPromotionReport(page: Page, store: JdStore) {
  await assertJdPromotionAccount(page, store);
  const reportName = page.getByText(jdPromotionReportName, { exact: true }).filter({ visible: true });
  await reportName.first().waitFor({ state: "visible", timeout: 30_000 });
  if (await reportName.count() !== 1) throw new Error(`京准通自定义报表列表无法唯一定位“${jdPromotionReportName}”`);
  await reportName.click();
  await assertJdPromotionAccount(page, store, true);
}

async function setJdPromotionDateRange(page: Page, startDate: string, endDate: string) {
  if (startDate.slice(0, 7) !== endDate.slice(0, 7)) throw new Error("京准通自动日期选择仅接受同一自然月范围");
  const input = page.getByRole("textbox", { name: "双日历选择日期" });
  const expected = `${startDate}至${endDate}`;
  if (await input.inputValue() === expected) return;
  await input.click();
  const monthTitle = `${Number(startDate.slice(0, 4))}年 ${Number(startDate.slice(5, 7))}月`;
  const visibleMonthTitle = page.getByText(monthTitle, { exact: true }).filter({ visible: true });
  await visibleMonthTitle.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  if (await visibleMonthTitle.count() < 1) {
    throw new Error(`京准通日期面板未显示目标月份 ${monthTitle}，拒绝猜测翻页`);
  }
  const calendar = page.locator(".jad-date-picker-dateRange").first();
  const day = (date: string) => calendar.locator(".jad-date-picker-cell:not(.jad-date-picker-cell-disabled):not(.jad-date-picker-cell-prev-month):not(.jad-date-picker-cell-next-month) em")
    .filter({ hasText: new RegExp(`^${Number(date.slice(8, 10))}$`) });
  const start = day(startDate);
  if (await start.count() !== 1) throw new Error("京准通日期面板无法唯一定位起始日");
  await start.click();
  const end = day(endDate);
  if (await end.count() !== 1) throw new Error("京准通日期面板无法唯一定位结束日");
  await end.click();
  await page.waitForFunction(([selector, value]) => (document.querySelector(selector) as HTMLInputElement | null)?.value === value,
    ['input[placeholder="双日历选择日期"]', expected], { timeout: 10_000 });
  await page.getByText(/汇总共\d+条/).first().waitFor({ state: "visible", timeout: 60_000 });
}

async function createOrResumeDownloadTask(reportPage: Page, downloadPage: Page, manifest: PromotionManifest | null, options: JdPromotionExportOptions, store: JdStore) {
  await downloadPage.goto(downloadCenterUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await assertJdPromotionAccount(downloadPage, store);
  let tasks = await readJdPromotionDownloadTasks(downloadPage);
  const existing = selectJdPromotionDownloadTask(tasks, jdPromotionReportPrefix(store.accountLabel, options.startDate, options.endDate), options.startDate, options.endDate);
  if (!manifest && existing) {
    manifest = newManifest(options, store, tasks.map((task) => task.fingerprint));
    manifest.status = "submitted";
    manifest.task = existing;
    await persistManifest(manifest);
    return { manifest, task: existing };
  }
  if (manifest?.task) return { manifest, task: manifest.task };
  if (manifest?.status === "submitting") {
    const recovered = selectJdPromotionDownloadTask(tasks, manifest.reportPrefix, options.startDate, options.endDate, new Set(manifest.baselineFingerprints));
    if (!recovered) throw new Error("京准通生成点击结果未决且下载中心未出现唯一新任务；清单保留，禁止重复创建");
    manifest.status = "submitted";
    manifest.task = recovered;
    await persistManifest(manifest);
    return { manifest, task: recovered };
  }
  const baseline = tasks.map((task) => task.fingerprint);
  manifest = newManifest(options, store, baseline);
  await persistManifest(manifest);
  await reportPage.bringToFront();
  const downloadButton = reportPage.locator("button.download-report-icon");
  if (await downloadButton.count() !== 1) throw new Error("京准通报表页下载操作无法唯一定位");
  await downloadButton.click();
  const inputs = await reportPage.locator("input").all();
  const matchingInputs: typeof inputs = [];
  for (const input of inputs) if (await input.isVisible() && await input.inputValue() === manifest.reportPrefix) matchingInputs.push(input);
  if (matchingInputs.length !== 1) throw new Error("京准通生成任务名称与受控日期范围不一致");
  const startButton = reportPage.getByRole("button", { name: "开始生成", exact: true });
  if (await startButton.count() !== 1 || !await startButton.isEnabled()) throw new Error("京准通开始生成按钮不可用或不唯一");
  await startButton.click();
  await reportPage.getByText("正在生成", { exact: false }).waitFor({ state: "visible", timeout: 10_000 });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await downloadPage.waitForTimeout(3_000);
    await downloadPage.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await assertJdPromotionAccount(downloadPage, store);
    tasks = await readJdPromotionDownloadTasks(downloadPage);
    const created = selectJdPromotionDownloadTask(tasks, manifest.reportPrefix, options.startDate, options.endDate, new Set(baseline));
    if (created) {
      manifest.status = "submitted";
      manifest.task = created;
      await persistManifest(manifest);
      return { manifest, task: created };
    }
  }
  throw new Error("京准通下载中心在 120 秒内未出现本轮唯一任务；清单保留，禁止重建");
}

async function waitAndDownload(page: Page, manifest: PromotionManifest, store: JdStore) {
  const task = manifest.task;
  if (!task) throw new Error("京准通恢复清单缺少下载任务身份");
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await page.goto(downloadCenterUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await assertJdPromotionAccount(page, store);
    const tasks = await readJdPromotionDownloadTasks(page);
    const current = tasks.find((candidate) => candidate.fingerprint === task.fingerprint);
    if (!current) throw new Error("京准通下载中心已无法找到恢复清单绑定的任务");
    if (/失败/.test(current.status)) throw new Error("京准通下载任务生成失败");
    if (/已生成/.test(current.status)) {
      const row = page.getByRole("row").filter({ hasText: current.reportName }).filter({ hasText: current.createdAt });
      if (await row.count() !== 1) throw new Error("京准通已生成任务行无法唯一定位");
      const stagingDirectory = await mkdtemp(path.join(store.browser.downloadDir, ".jd-promotion-"));
      const stagingPath = path.join(stagingDirectory, `${current.reportName}.csv`);
      try {
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 30_000 }),
          row.getByText("下载", { exact: true }).click(),
        ]);
        await download.saveAs(stagingPath);
        const canonicalDirectory = path.join(store.browser.downloadDir, "jd-promotion", manifest.runId);
        await mkdir(canonicalDirectory, { recursive: true });
        const finalPath = path.join(canonicalDirectory, `${current.reportName}.csv`);
        await rename(stagingPath, finalPath);
        return finalPath;
      } finally {
        await rm(stagingDirectory, { recursive: true, force: true });
      }
    }
    await page.waitForTimeout(3_000);
  }
  throw new Error("京准通下载任务在 5 分钟内未生成完成");
}

export async function importJdPromotionFile(options: JdPromotionExportOptions, store: JdStore, filePath: string) {
  const bytes = new Uint8Array(await readFile(filePath));
  const inspection = inspectJdPromotionCsv(bytes, options.startDate, options.endDate);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const file = new File([body], path.basename(filePath), { type: "text/csv" });
  const form = new FormData();
  form.set("file", file);
  form.set("source", "jd_promotion");
  form.set("platform", "京东");
  form.set("shop_name", store.shopName);
  form.set("expected_start_date", options.startDate);
  form.set("expected_end_date", options.endDate);
  form.set("note", `n8n 京准通 AI 推广报表：${store.shopName}，${options.startDate} 至 ${options.endDate}`);
  const response = await fetch(`${options.baseUrl}/api/netshop/import`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) throw new Error(`京准通推广导入失败 (HTTP ${response.status})`);
  const proof = validateJdPromotionImportProof({ payload, shopName: store.shopName, startDate: options.startDate, endDate: options.endDate, rowCount: inspection.rowCount, rawFileHash: inspection.sha256 });
  return { inspection, proof };
}

export async function verifyJdPromotionPublishedBatch(options: JdPromotionExportOptions, store: JdStore, proof: ReturnType<typeof validateJdPromotionImportProof>, request: typeof fetch = fetch) {
  const params = new URLSearchParams({ limit: "1", batchId: proof.batchId, source: "jd_promotion", platform: "京东", shop: store.shopName });
  const response = await request(`${options.baseUrl}/api/netshop/import?${params}`, { signal: AbortSignal.timeout(30_000) });
  const payload = await response.json().catch(() => null) as { items?: unknown } | null;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const batch = items[0] as Record<string, unknown> | undefined;
  const totals = batch?.totals as Record<string, unknown> | undefined;
  if (!response.ok || items.length !== 1 || !batch || batch.id !== proof.batchId || batch.status !== "completed"
    || batch.source !== "jd_promotion" || batch.dataset !== "ad" || batch.platform !== "京东" || batch.shopName !== store.shopName
    || batch.warningCount !== 0 || batch.rowCount !== proof.rowCount || batch.dateMin !== options.startDate || batch.dateMax !== options.endDate
    || totals?.rawFileHash !== proof.rawFileHash) {
    throw new Error("京准通推广已发布批次与下载、日期或导入证明不一致");
  }
  return batch;
}

async function runUnlocked(options: JdPromotionExportOptions): Promise<JdPromotionExportResult> {
  const store = await getJdStore(options.storeKey);
  if (!store.enabled) throw new Error(`京东店铺未启用：${options.storeKey}`);
  await mkdir(store.browser.downloadDir, { recursive: true });
  await mkdir(artifactDirectory, { recursive: true });
  let manifest = await readManifest(options, store);
  if (manifest?.status === "completed" && manifest.savedPath && manifest.batchId) {
    const { inspection, proof } = await importJdPromotionFile(options, store, manifest.savedPath);
    await verifyJdPromotionPublishedBatch(options, store, proof);
    manifest.fileSizeBytes = (await stat(manifest.savedPath)).size;
    return resultFrom(manifest, store, inspection, proof);
  }
  let browser: Awaited<ReturnType<typeof connectPlaywrightBrowser>> | null = null;
  let ownsBrowser = false;
  let revealInteractive = false;
  try {
    const launched = await launchDedicatedChrome({
      executablePath: store.browser.executablePath,
      profileDirectory: store.browser.userDataDir,
      profileName: store.browser.profileName,
      port: store.browser.debugPort,
      startUrl: "about:blank",
      ...jdBrowserLaunchMode(options.interactiveLogin),
    });
    ownsBrowser = Boolean(launched);
    if (!options.interactiveLogin && !ownsBrowser) throw new Error("京准通自动流程拒绝复用不受本轮执行所有权控制的 Chromium 实例");
    await waitForChrome(store.browser.debugPort);
    browser = await connectPlaywrightBrowser(store.browser.debugPort);
    const { page: reportPage, client } = await connectPlaywrightJackyunTarget(browser, { startUrl: jdPromotionReportListUrl, workerName: "codex-jd-promotion-worker", targetUrlPattern: /jzt\.jd\.com/i, requireMini: false });
    const context = reportPage.context();
    const downloadPage = await context.newPage();
    await openJdPromotionReport(reportPage, store);
    await setJdPromotionDateRange(reportPage, options.startDate, options.endDate);
    const resumed = await createOrResumeDownloadTask(reportPage, downloadPage, manifest, options, store);
    manifest = resumed.manifest;
    const savedPath = manifest.savedPath ?? await waitAndDownload(downloadPage, manifest, store);
    const fileStat = await stat(savedPath);
    if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > maximumCsvBytes) throw new Error("京准通下载文件大小无效或超过 25MB");
    const inspection = inspectJdPromotionCsv(new Uint8Array(await readFile(savedPath)), options.startDate, options.endDate);
    manifest.status = "downloaded";
    manifest.savedPath = savedPath;
    manifest.fileSizeBytes = fileStat.size;
    manifest.sha256 = inspection.sha256;
    manifest.rowCount = inspection.rowCount;
    await persistManifest(manifest);
    const imported = await importJdPromotionFile(options, store, savedPath);
    await verifyJdPromotionPublishedBatch(options, store, imported.proof);
    manifest.status = "completed";
    manifest.batchId = imported.proof.batchId;
    await persistManifest(manifest);
    client.close();
    return resultFrom(manifest, store, imported.inspection, imported.proof);
  } catch (error) {
    revealInteractive = options.visibleRecovery && !options.interactiveLogin && isJdInteractiveBrowserFailure(error);
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
    if (ownsBrowser && !options.interactiveLogin) await closeChromeBrowser(store.browser.debugPort);
    if (revealInteractive) {
      await revealJdBrowserForInteractiveFailure({ executablePath: store.browser.executablePath, profileDirectory: store.browser.userDataDir, profileName: store.browser.profileName, port: store.browser.debugPort, startUrl: jdPromotionReportListUrl }).catch(() => undefined);
    }
  }
}

function resultFrom(manifest: PromotionManifest, store: JdStore, inspection: ReturnType<typeof inspectJdPromotionCsv>, proof: ReturnType<typeof validateJdPromotionImportProof>): JdPromotionExportResult {
  if (!manifest.task || !manifest.savedPath) throw new Error("京准通完成清单缺少任务或文件路径");
  return {
    ok: true,
    runId: manifest.runId,
    storeKey: store.storeKey,
    shopName: store.shopName,
    startDate: manifest.startDate,
    endDate: manifest.endDate,
    reportName: manifest.task.reportName,
    taskCreatedAt: manifest.task.createdAt,
    savedPath: manifest.savedPath,
    fileSizeBytes: manifest.fileSizeBytes ?? 0,
    sha256: inspection.sha256,
    rowCount: inspection.rowCount,
    accountNicknames: inspection.accountNicknames,
    productLines: inspection.productLines,
    impressions: inspection.impressions,
    clicks: inspection.clicks,
    spendYuan: inspection.spendYuan,
    totalOrders: inspection.totalOrders,
    totalOrderAmountYuan: inspection.totalOrderAmountYuan,
    importResult: proof,
  };
}

export async function runJdPromotionExport(options: JdPromotionExportOptions) {
  return withJdChromiumRunLock("jd-promotion", () => runUnlocked(options));
}

async function main() {
  const result = await runJdPromotionExport(parseJdPromotionArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
