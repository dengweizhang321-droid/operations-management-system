import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Page } from "playwright-core";
import { launchDedicatedChrome, waitForChrome } from "../lib/jackyun/cdp-client";
import { connectPlaywrightBrowser, connectPlaywrightJackyunTarget } from "../lib/jackyun/playwright-client";
import {
  acquireJdProductDetailDownload,
  finalizeJdProductDetailDownload,
  findRecentJdProductDetailDownload,
  JD_PRODUCT_DETAIL_REUSE_WINDOW_MS,
} from "../lib/jd/product-detail-download";
import { jdDateRangeEchoMatches } from "../lib/jd/product-detail-selection";
import {
  assertJdProductDetailTaskManifest,
  jdProductDetailTaskFingerprint,
  selectManifestTaskRow,
  type JdProductDetailTaskManifest,
} from "../lib/jd/product-detail-task-manifest";
import { readJsonFileOr, writeJsonAtomic } from "../lib/jackyun/json-file";
import { getJdStore } from "../lib/jd/store-registry";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(projectRoot, "outputs", "jdsz-product-detail-export");
const targetUrl = "https://jdsz.jd.com/szweb/view/product/productDetail.html";
const downloadCenterUrl = "https://jdsz.jd.com/szweb/view/reports-center/download-center.html";

async function withJdProductDetailRunLock<T>(task: () => Promise<T>) {
  await mkdir(artifactDir, { recursive: true });
  const lockPath = path.join(artifactDir, "jdsz-product-detail-export.lock");
  const handle = await open(lockPath, "wx").catch(() => null);
  if (!handle) throw new Error("Another JD product-detail export is already running; shared Chrome/profile access is locked.");
  await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  await handle.close();
  try { return await task(); } finally { await rm(lockPath, { force: true }); }
}

type CliOptions = {
  chromePath: string;
  profileDirectory: string;
  port: number;
  downloadDirectory: string;
  shopId: string;
  shopName: string;
  startDate: string;
  endDate: string;
  dimension: "SKU" | "SPU";
  debug: boolean;
  autoImport: boolean;
  baseUrl: string;
};

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function parseArgs(argv: string[]): Promise<CliOptions> {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith("--")) continue;
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      values.set(key, next);
      index += 1;
    } else {
      flags.add(key);
    }
  }

  const yesterday = addDays(shanghaiToday(), -1);
  const startDate = values.get("--start-date") ?? `${yesterday.slice(0, 8)}01`;
  const endDate = values.get("--end-date") ?? yesterday;
  for (const [name, value] of [["--start-date", startDate], ["--end-date", endDate]] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
      throw new Error(`${name} 必须是 YYYY-MM-DD 日期。`);
    }
  }
  if (startDate > endDate) throw new Error("--start-date 不能晚于 --end-date。");
  const dimension = (values.get("--dimension") ?? "SKU").toUpperCase();
  if (dimension !== "SKU" && dimension !== "SPU") {
    throw new Error("--dimension 必须是 SKU 或 SPU。");
  }

  const store = await getJdStore(values.get("--store-key") ?? "jd-yiyong-director");
  const shopId = values.get("--shop-id") ?? store.shopId;
  if (!/^\d+$/.test(shopId)) throw new Error("--shop-id 必须是纯数字。");
  return {
    chromePath: values.get("--chrome-path") ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    profileDirectory: path.resolve(values.get("--profile-dir") ?? store.browser.profileDir),
    port: Number(values.get("--port") ?? store.browser.debugPort),
    downloadDirectory: path.resolve(values.get("--download-dir") ?? store.browser.downloadDir),
    shopId,
    shopName: store.shopName,
    startDate,
    endDate,
    dimension,
    debug: flags.has("--debug"),
    autoImport: !flags.has("--no-auto-import"),
    baseUrl: (values.get("--base-url") ?? process.env.OPERATIONS_SYSTEM_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  };
}

export function jdProductDetailDownloadPrefix(options: Pick<CliOptions, "shopId" | "startDate" | "endDate">) {
  return `${options.shopId}_商品明细_离线_不包括对比时间_分天下载_${options.startDate}_${options.endDate}`;
}

export function taskManifestPath(options: Pick<CliOptions, "dimension" | "shopId" | "startDate" | "endDate">) {
  if (!/^\d+$/.test(options.shopId) || !/^\d{4}-\d{2}-\d{2}$/.test(options.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(options.endDate)) throw new Error("JD task manifest path input is invalid.");
  const file = path.resolve(artifactDir, `${options.dimension.toLowerCase()}-task-${options.shopId}-${options.startDate}-${options.endDate}.json`);
  if (path.relative(artifactDir, file).startsWith("..") || path.dirname(file) !== artifactDir) throw new Error("JD task manifest path escapes artifact directory.");
  return file;
}

async function saveFailureScreenshot(page: Page, name: string) {
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, `${name}-${Date.now()}.png`), fullPage: true }).catch(() => undefined);
}

async function currentDateEcho(page: Page) {
  const echo = page.locator(".jmt-combo-date-picker-echo-wrap").filter({ visible: true });
  if (await echo.count() !== 1) throw new Error("无法唯一识别京东商智当前日期显示区域。");
  return echo.innerText();
}

export function jdDateRangeSelectionPlan(startDate: string, endDate: string) {
  // JD's range picker requires two endpoint clicks even when both endpoints
  // are the same day.  Returning both entries intentionally preserves that
  // second click instead of collapsing the range to one interaction.
  return [startDate, endDate] as const;
}

export function isStaticCurrentTimestamp(echoText: string) {
  return /^\s*当前[：:]\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*$/.test(echoText);
}

export function isVerifiedJdDateRangeEcho(echoText: string, startDate: string, endDate: string) {
  return !isStaticCurrentTimestamp(echoText) && jdDateRangeEchoMatches(echoText, startDate, endDate);
}

async function waitForSelectedDateRange(page: Page, startDate: string, endDate: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let echoText = "";
  while (Date.now() < deadline) {
    echoText = await currentDateEcho(page);
    if (isVerifiedJdDateRangeEcho(echoText, startDate, endDate)) return echoText;
    await page.waitForTimeout(100);
  }
  throw new Error(`日期选择未生效：目标 ${startDate} ~ ${endDate}，页面显示 ${echoText.replace(/\s+/g, " ")}`);
}

async function assertDimensionAndDateSelection(page: Page, dimension: CliOptions["dimension"], startDate: string, endDate: string) {
  const dimensionTab = page.getByRole("tab", { name: dimension, exact: true });
  if (await dimensionTab.count() !== 1 || await dimensionTab.getAttribute("aria-selected") !== "true") {
    throw new Error(`${dimension} 维度未处于选中状态，已禁止创建下载任务。`);
  }
  return waitForSelectedDateRange(page, startDate, endDate, 1_000);
}

async function selectDateRange(page: Page, startDate: string, endDate: string) {
  const custom = page.locator('[data-event-content="当前时间_自定义"]').filter({ visible: true });
  if (await custom.count() !== 1) throw new Error("无法唯一识别自定义时间入口。");
  await custom.click();
  await page.waitForTimeout(300);

  const monthKey = (date: string) => date.slice(0, 7);
  const cellSelector = (date: string) =>
    `td[data-event-content="当前时间自定义_${date}"]`;
  const popup = page.locator(".jmt-date-picker, .jmt-date-picker-panel, [class*='date-picker']").filter({ visible: true }).first();

  const getHeaderText = async () => {
    const candidates = [
      page.locator(".jmt-date-picker-header").filter({ visible: true }).first(),
      page.locator(".jmt-date-picker-calendar-header").filter({ visible: true }).first(),
      popup.getByText(/\d{4}年\d{1,2}月/).first(),
    ];
    for (const candidate of candidates) {
      if (await candidate.count().catch(() => 0)) return candidate.innerText().catch(() => "");
    }
    return "";
  };

  const clickCalendarNav = async (direction: "prev" | "next") => {
    const selectors = direction === "prev"
      ? ["button[aria-label*='上一月']", "button[title*='上一月']", ".jmt-date-picker-prev-btn", ".jmt-date-picker-calendar-prev-btn"]
      : ["button[aria-label*='下一月']", "button[title*='下一月']", ".jmt-date-picker-next-btn", ".jmt-date-picker-calendar-next-btn"];
    for (const selector of selectors) {
      const button = popup.locator(selector).filter({ visible: true }).first();
      if (await button.count().catch(() => 0)) {
        await button.click().catch(() => undefined);
        return true;
      }
    }
    return false;
  };

  const ensureMonthVisible = async (targetMonth: string) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const headerText = await getHeaderText();
      if (headerText.includes(targetMonth.replace("-", "年").replace(/-(\d{2})$/, (_, m) => `${Number(m)}月`))) return;
      if (headerText && /\d{4}年\d{1,2}月/.test(headerText)) {
        const current = headerText.match(/(\d{4})年\s*(\d{1,2})月/);
        if (current) {
          const currentMonth = `${current[1]}-${String(Number(current[2])).padStart(2, "0")}`;
          const direction = currentMonth < targetMonth ? "next" : "prev";
          if (!(await clickCalendarNav(direction))) break;
          await page.waitForTimeout(200);
          continue;
        }
      }
      if (await clickCalendarNav("prev") || await clickCalendarNav("next")) {
        await page.waitForTimeout(200);
        continue;
      }
      break;
    }
  };

  const selectDay = async (date: string) => {
    await ensureMonthVisible(monthKey(date));
    const cell = page.locator(cellSelector(date)).filter({ visible: true });
    await cell.waitFor({ state: "visible", timeout: 10_000 });
    if (await cell.count() !== 1) throw new Error(`日期 ${date} 的可选单元格不是唯一元素。`);
    // A browser translation extension may inject a zero-size overlay over the
    // calendar without changing the validated target cell. Force the click on
    // the unique visible date cell so the export workflow remains deterministic.
    await cell.click({ force: true });
  };
  const waitForCellState = async (date: string, stateClass: string, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    const cell = page.locator(cellSelector(date)).filter({ visible: true });
    while (Date.now() < deadline) {
      try {
        if ((await cell.getAttribute("class"))?.includes(stateClass)) return true;
      } catch {
        // JD may replace the calendar cell during the date-picker re-render.
        // Treat that frame as an unconfirmed state and let the caller retry.
      }
      await page.waitForTimeout(50);
    }
    return false;
  };
  const [startSelectionDate, endSelectionDate] = jdDateRangeSelectionPlan(startDate, endDate);
  await selectDay(startSelectionDate);
  if (!await waitForCellState(startDate, "jmt-date-picker-calendar-cell-start", 1_000)) await selectDay(startDate);
  if (!await waitForCellState(startDate, "jmt-date-picker-calendar-cell-start", 5_000)) {
    throw new Error(`起始日期 ${startDate} 点击后未进入区间起点状态。`);
  }
  // A single-day range still needs a second click: the first establishes the
  // start, while the second closes the range as its end.
  await selectDay(endSelectionDate);
  if (!await waitForCellState(endDate, "jmt-date-picker-calendar-cell-end", 1_000)) await selectDay(endSelectionDate);
  if (!await waitForCellState(endDate, "jmt-date-picker-calendar-cell-end", 5_000)) {
    throw new Error(`结束日期 ${endDate} 点击后未进入区间终点状态。`);
  }
  // The picker itself applies the custom range.  Clicking the page-level
  // Query action switches this JD page back to a realtime-summary flow, so it
  // must not be used to validate an offline daily export.
  await waitForSelectedDateRange(page, startDate, endDate);
}

async function waitForDataRefresh(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  const deadline = Date.now() + 30_000;
  const loading = page.locator(".jd-spin-spinning, .jmt-spin-spinning, [aria-busy='true']").filter({ visible: true });
  while (Date.now() < deadline && await loading.count() > 0) await page.waitForTimeout(200);
  if (await loading.count() > 0) throw new Error("日期切换后的数据仍在加载，已禁止创建下载任务。");
}

async function selectDimensionAndWait(page: Page, dimension: CliOptions["dimension"]) {
  const dimensionTab = page.getByRole("tab", { name: dimension, exact: true });
  await dimensionTab.waitFor({ state: "visible", timeout: 10_000 });
  if (await dimensionTab.count() !== 1) throw new Error(`无法唯一识别 ${dimension} 维度标签。`);
  if (await dimensionTab.getAttribute("aria-selected") !== "true") await dimensionTab.click();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && await dimensionTab.getAttribute("aria-selected") !== "true") {
    await page.waitForTimeout(100);
  }
  if (await dimensionTab.getAttribute("aria-selected") !== "true") throw new Error(`${dimension} 维度切换未生效。`);
  await waitForDataRefresh(page);
}

async function clickAnyVisibleOption(dialog: ReturnType<Page["locator"]>, texts: string[]) {
  for (const text of texts) {
    const exact = dialog.getByText(text, { exact: true }).filter({ visible: true });
    if (await exact.count() === 1) {
      const label = exact.locator("xpath=ancestor::label[1]");
      if (await label.count() === 1) {
        await label.click();
        return text;
      }
      await exact.click();
      return text;
    }
    const partial = dialog.getByText(text).filter({ visible: true });
    if (await partial.count() === 1) {
      const label = partial.locator("xpath=ancestor::label[1]");
      if (await label.count() === 1) {
        await label.click();
        return text;
      }
      await partial.click();
      return text;
    }
  }
  return null;
}

async function selectDialogRadio(dialog: ReturnType<Page["locator"]>, text: string) {
  const labelText = dialog.getByText(text, { exact: true }).filter({ visible: true });
  await labelText.waitFor({ state: "visible", timeout: 10_000 });
  if (await labelText.count() !== 1) throw new Error(`下载弹窗选项不是唯一元素：${text}`);
  const label = labelText.locator("xpath=ancestor::label[1]");
  const radio = label.locator('input[type="radio"]');
  if (await label.count() !== 1 || await radio.count() !== 1) throw new Error(`无法识别下载弹窗单选项：${text}`);
  if (!await radio.isChecked()) await label.click();
  if (!await radio.isChecked()) throw new Error(`下载弹窗选项未成功选中：${text}`);
}

export function isRealtimeSummaryDownloadDialog(dialogText: string) {
  return dialogText.includes("下载设置")
    && !dialogText.includes("分天下载")
    && !dialogText.includes("不包含对比时间");
}

async function configureDownloadDialog(page: Page, beforeConfirm?: () => Promise<void>) {
  const downloadButton = page.getByText("下载数据", { exact: true }).filter({ visible: true });
  if (await downloadButton.count() !== 1) throw new Error("无法唯一识别商品明细区域的下载数据按钮。");
  await downloadButton.click();

  const dialog = page.getByRole("dialog").filter({ visible: true });
  await dialog.waitFor({ state: "visible", timeout: 15_000 });
  if (await dialog.count() !== 1) throw new Error("未出现唯一的商品明细下载弹窗。");
  const dialogText = await dialog.innerText();
  // This compact settings dialog creates a realtime-summary workbook.  It is
  // not an offline daily task, so reject it before touching the confirmation
  // callback (which is what persists a submitting manifest).
  if (isRealtimeSummaryDownloadDialog(dialogText)) {
    throw new Error("当前“下载设置”弹窗会创建实时汇总文件，不是离线分天下载；已禁止确认和写入任务清单。");
  }
  if (!dialogText.includes("分天下载") || !dialogText.includes("不包含对比时间")) {
    throw new Error("当前弹窗不是商品明细分天下载弹窗，已禁止继续。");
  }
  try {
    await selectDialogRadio(dialog, "分天下载");
  } catch {
    const selected = await clickAnyVisibleOption(dialog, ["分天下载", "按天下载", "按日下载"]);
    if (!selected) throw new Error("无法在下载弹窗中找到分天下载选项。");
  }
  try {
    await selectDialogRadio(dialog, "不包含对比时间");
  } catch {
    const selected = await clickAnyVisibleOption(dialog, ["不包含对比时间", "不含对比时间"]);
    if (!selected) throw new Error("无法在下载弹窗中找到不包含对比时间选项。");
  }
  const confirm = dialog.getByRole("button", { name: "确定", exact: true }).filter({ visible: true });
  if (await confirm.count() !== 1) throw new Error("无法唯一识别商品明细下载弹窗的确定按钮。");
  await beforeConfirm?.();
  await confirm.click();
}

async function prepareExport(page: Page, options: CliOptions, beforeConfirm?: () => Promise<void>) {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (/登录|账号|密码|验证码/.test(bodyText) && !/商品明细/.test(bodyText)) {
    throw new Error("京东商智登录状态无效；请先在弹出的专用 Chrome 中登录，再重新运行。");
  }

  try {
    await selectDimensionAndWait(page, options.dimension);
    await selectDateRange(page, options.startDate, options.endDate);
    await waitForDataRefresh(page);
    await assertDimensionAndDateSelection(page, options.dimension, options.startDate, options.endDate);
    if (options.debug) await page.screenshot({ path: path.join(artifactDir, "01-selected-range.png"), fullPage: true });
    await configureDownloadDialog(page, beforeConfirm);
  } catch (error) {
    await saveFailureScreenshot(page, "selection-gate-failed");
    throw error;
  }
}

async function openDownloadCenter(page: Page) {
  const go = page.getByText("前往查看", { exact: true }).filter({ visible: true });
  await go.waitFor({ state: "visible", timeout: 120_000 });
  if (await go.count() !== 1) throw new Error(`Expected exactly one download-center link; found ${await go.count()}.`);
  const href = await go.getAttribute("href");
  if (href) {
    await page.goto(new URL(href, page.url()).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    return page;
  }

  const popupPromise = page.context().waitForEvent("page", { timeout: 8_000 }).catch(() => null);
  await go.click();
  const popup = await popupPromise;
  const result = popup ?? page;
  await result.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
  return result;
}

async function taskRow(page: Page, expectedPrefix: string) {
  const rows = page.locator("tr, [role='row']").filter({ hasText: expectedPrefix }).filter({ visible: true });
  const count = await rows.count();
  if (count !== 1) throw new Error(`Expected exactly one download-center task row for ${expectedPrefix}; found ${count}.`);
  return rows;
}

async function taskRows(page: Page, expectedPrefix: string) {
  const rows = page.locator("tr, [role='row']").filter({ hasText: expectedPrefix }).filter({ visible: true });
  const result: Array<{ fingerprint: string; taskId?: string; createdAt?: string }> = [];
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    const text = await row.innerText();
    const taskId = await row.getAttribute("data-task-id") ?? undefined;
    const fingerprint = jdProductDetailTaskFingerprint(text, expectedPrefix, taskId);
    if (!fingerprint) continue;
    result.push({ fingerprint, taskId, createdAt: text.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/)?.[0] });
  }
  return result;
}

export type TaskBaselineSnapshot<T extends { fingerprint: string }> = {
  rows: T[];
  emptyConfirmed: boolean;
  // The download center may be populated exclusively by other date ranges.
  // That still proves its table has loaded even when this request has no
  // same-range historical rows.
  tableReady?: boolean;
};
export async function waitForStableTaskBaseline<T extends { fingerprint: string }>(
  readSnapshot: () => Promise<TaskBaselineSnapshot<T>>,
  sleep: (ms: number) => Promise<void>,
  // JD's download-center table can remain in a non-confirmed empty/loading
  // state for several seconds after navigation or refresh.  Keep the fast
  // path (two identical snapshots) but give that transient state enough
  // time to settle before refusing a safe submission.
  attempts = 40,
) {
  let previous: TaskBaselineSnapshot<T> | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = await readSnapshot();
    const currentKey = current.rows.map((row) => row.fingerprint).sort().join("\u0000");
    const previousKey = previous?.rows.map((row) => row.fingerprint).sort().join("\u0000");
    // Empty target-range rows are valid only when the table itself has loaded.
    // A true empty table still requires the UI's explicit empty-state signal.
    const ready = current.rows.length > 0
      || (current.emptyConfirmed && previous?.emptyConfirmed)
      || (current.tableReady && previous?.tableReady);
    if (previous && previousKey === currentKey && ready) return current.rows;
    previous = current;
    if (attempt + 1 < attempts) await sleep(500);
  }
  throw new Error("JD download-center task table did not reach a stable baseline; refusing to submit a new task.");
}

async function readReadyTaskBaseline(page: Page, expectedPrefix: string) {
  await page.goto(downloadCenterUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForDataRefresh(page);
  const refresh = page.getByText("刷新", { exact: true }).filter({ visible: true }).first();
  if (await refresh.count().catch(() => 0) === 1) {
    await refresh.click().catch(() => undefined);
    await waitForDataRefresh(page);
  }
  return waitForStableTaskBaseline(async () => {
    const rows = await taskRows(page, expectedPrefix);
    const body = await page.locator("body").innerText().catch(() => "");
    const allVisibleTaskRows = page.locator("tr, [role='row']")
      .filter({ hasText: /\d{4}-\d{2}-\d{2}/ })
      .filter({ visible: true });
    return {
      rows,
      emptyConfirmed: /暂无数据|暂无记录|暂无下载记录/.test(body),
      tableReady: await allVisibleTaskRows.count() > 0,
    };
  }, (ms) => page.waitForTimeout(ms));
}

type DailyImportResult = { status: "imported" | "duplicate"; batchId: string; rowCount: number; warningCount: number; dateMin: string; dateMax: string; source: "jd_sku_daily"; dataset: "sku_daily" | "spu_daily"; platform: "京东"; shopName: string; batchStatus: "completed" };

export async function importJdProductDetailFile(options: Pick<CliOptions, "baseUrl" | "shopName" | "dimension" | "startDate" | "endDate">, savedPath: string, request: typeof fetch = fetch): Promise<DailyImportResult> {
  const form = new FormData();
  form.set("source", "jd_sku_daily");
  form.set("platform", "京东");
  form.set("shopName", options.shopName);
  form.set("expectedDataset", options.dimension === "SKU" ? "sku_daily" : "spu_daily");
  form.set("expectedStartDate", options.startDate);
  form.set("expectedEndDate", options.endDate);
  form.set("file", new File([await readFile(savedPath)], path.basename(savedPath), { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const response = await request(`${options.baseUrl}/api/netshop/import`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  const payload = await response.json().catch(() => null) as {
    ok?: boolean; status?: "imported" | "duplicate"; message?: string;
    batch?: { id?: string; source?: string; dataset?: string; platform?: string; shopName?: string; status?: string; warningCount?: number; rowCount?: number; dateMin?: string; dateMax?: string };
  } | null;
  const expectedDataset = options.dimension === "SKU" ? "sku_daily" : "spu_daily";
  const batch = payload?.batch;
  const expectedHttpStatus = payload?.status === "imported" ? 201 : payload?.status === "duplicate" ? 200 : 0;
  if (response.status !== expectedHttpStatus || !payload?.ok || (payload.status !== "imported" && payload.status !== "duplicate")
    || batch?.dataset !== expectedDataset || batch.status !== "completed" || batch.warningCount !== 0
    || batch.source !== "jd_sku_daily" || batch.platform !== "京东" || batch.shopName !== options.shopName
    || batch.dateMin !== options.startDate || batch.dateMax !== options.endDate || !batch.id || !Number.isFinite(batch.rowCount)) {
    throw new Error(payload?.message ?? `JD ${options.dimension} daily import failed validation (HTTP ${response.status}).`);
  }
  return { status: payload.status, batchId: batch.id, rowCount: batch.rowCount!, warningCount: batch.warningCount, dateMin: batch.dateMin, dateMax: batch.dateMax, source: "jd_sku_daily", dataset: expectedDataset, platform: "京东", shopName: options.shopName, batchStatus: "completed" };
}

function emitPipelineResult(result: Record<string, unknown>) {
  console.log(`@@JD_PIPELINE_RESULT@@${JSON.stringify(result)}`);
  console.log(JSON.stringify(result, null, 2));
}

export function createSubmittingTaskManifest(
  options: Pick<CliOptions, "dimension" | "shopId" | "startDate" | "endDate">,
  baseline: Array<{ fingerprint: string }>,
  now = new Date(),
): JdProductDetailTaskManifest {
  return { version: 1, status: "submitting", dimension: options.dimension, shopId: options.shopId, startDate: options.startDate, endDate: options.endDate, baseline: baseline.map((row) => row.fingerprint), createdAt: now.toISOString() };
}

async function waitForManifestTaskRow(
  page: Page,
  expectedPrefix: string,
  manifest: JdProductDetailTaskManifest,
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const matched = selectManifestTaskRow(manifest, await taskRows(page, expectedPrefix));
    if (matched || Date.now() >= deadline) return matched;
    await page.waitForTimeout(500);
  }
}

async function taskRowByFingerprint(page: Page, expectedPrefix: string, fingerprint: string) {
  const candidates = await taskRows(page, expectedPrefix);
  const matching = candidates.filter((item) => item.fingerprint === fingerprint);
  if (matching.length !== 1) throw new Error(`Expected exactly one persisted JD SPU task row; found ${matching.length}.`);
  const rows = page.locator("tr, [role='row']").filter({ hasText: expectedPrefix }).filter({ visible: true });
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    const text = await row.innerText();
    const taskId = await row.getAttribute("data-task-id") ?? undefined;
    if (jdProductDetailTaskFingerprint(text, expectedPrefix, taskId) === fingerprint) return row;
  }
  throw new Error("Persisted JD SPU task row disappeared while resolving it.");
}

async function waitForTaskDownload(page: Page, expectedPrefix: string, fingerprint?: string) {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    let row: Awaited<ReturnType<typeof taskRow>> | null = null;
    try {
      row = fingerprint ? await taskRowByFingerprint(page, expectedPrefix, fingerprint) : await taskRow(page, expectedPrefix);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A row may not have appeared yet, but ambiguity must stop immediately.
      if (!/found 0\./.test(message)) throw error;
    }
    if (row) {
      const rowText = await row.innerText().catch(() => "");
      const download = row.getByText("下载", { exact: true });
      if (
        rowText.includes("已生成")
        && await download.count().catch(() => 0) === 1
        && await download.isEnabled().catch(() => false)
      ) return;
    }
    const refresh = page.getByText("刷新", { exact: true }).filter({ visible: true }).first();
    if (await refresh.count().catch(() => 0)) await refresh.click().catch(() => undefined);
    await page.waitForTimeout(3_000);
  }
  throw new Error("京东下载中心任务在 10 分钟内未生成完成。");
}

async function clickTaskDownload(page: Page, expectedPrefix: string, fingerprint?: string) {
  const row = fingerprint ? await taskRowByFingerprint(page, expectedPrefix, fingerprint) : await taskRow(page, expectedPrefix);
  if (!(await row.innerText()).includes("已生成")) {
    throw new Error("最新同区间京东下载任务尚未生成完成，已禁止点击下载。");
  }
  const download = row.getByText("下载", { exact: true }).filter({ visible: true });
  await download.waitFor({ state: "visible", timeout: 10_000 });
  if (await download.count() !== 1) throw new Error(`Expected exactly one download button in the selected task row; found ${await download.count()}.`);
  if (!await download.isEnabled()) throw new Error("最新同区间京东下载任务的下载按钮尚不可用。");
  await download.click();
}

async function run() {
  const options = await parseArgs(process.argv.slice(2));
  const expectedPrefix = jdProductDetailDownloadPrefix(options);
  const manifestPath = taskManifestPath(options);
  await mkdir(options.downloadDirectory, { recursive: true });

  const recent = await findRecentJdProductDetailDownload({
    downloadDirectory: options.downloadDirectory,
    expectedPrefix,
    maxAgeMs: JD_PRODUCT_DETAIL_REUSE_WINDOW_MS,
    dimension: options.dimension,
    startDate: options.startDate,
    endDate: options.endDate,
  });
  if (recent) {
    const savedPath = await finalizeJdProductDetailDownload(recent, options.dimension, options);
    const importResult = options.autoImport ? await importJdProductDetailFile(options, savedPath) : undefined;
    await rm(manifestPath, { force: true });
    emitPipelineResult({ status: "reused", dimension: options.dimension, savedPath, importResult, batchId: importResult?.batchId, rowCount: importResult?.rowCount, downloadClicks: 0 });
    return;
  }

  if (options.debug) await mkdir(artifactDir, { recursive: true });
  await launchDedicatedChrome({
    executablePath: options.chromePath,
    profileDirectory: options.profileDirectory,
    port: options.port,
    startUrl: targetUrl,
    headless: false,
  });
  await waitForChrome(options.port);
  const browser = await connectPlaywrightBrowser(options.port);
  try {
    const { page, client } = await connectPlaywrightJackyunTarget(browser, {
      startUrl: targetUrl,
      workerName: "codex-jdsz-product-detail-worker",
      targetUrlPattern: /jdsz\.jd\.com/i,
    });
    await client.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: options.downloadDirectory,
      eventsEnabled: true,
    }).catch(async () => client.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: options.downloadDirectory,
    }));

    // 京东任务名不包含维度，SPU 与 SKU 同区间会重名。两种维度都只
    // 能接管本程序持久化了精确指纹的任务，不能按“最近同名行”猜测。
    let taskFingerprint: string | undefined;
    let taskReused = false;
    const manifest = await readJsonFileOr<JdProductDetailTaskManifest | null>(manifestPath, null);
    if (manifest) {
      assertJdProductDetailTaskManifest(manifest, { dimension: options.dimension, shopId: options.shopId, startDate: options.startDate, endDate: options.endDate });
      await page.goto(downloadCenterUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const matched = await waitForManifestTaskRow(page, expectedPrefix, manifest);
      if (matched) {
        const rowText = await (await taskRowByFingerprint(page, expectedPrefix, matched.fingerprint)).innerText();
        if (rowText.includes("失败")) {
          await rm(manifestPath, { force: true });
        } else {
          taskFingerprint = matched.fingerprint;
          taskReused = true;
          if (!manifest.rowFingerprint) await writeJsonAtomic(manifestPath, { ...manifest, status: "pending", rowFingerprint: matched.fingerprint, taskId: matched.taskId });
        }
      } else {
        throw new Error("Persisted JD product-detail task is not uniquely visible yet; manifest retained and no replacement task was created.");
      }
    }
    let downloadPage = page;
    if (!taskReused) {
      const baseline = await readReadyTaskBaseline(page, expectedPrefix);
      let submitting: JdProductDetailTaskManifest | undefined;
      // Persist only after every selection/dialog gate has passed and directly
      // before the irreversible remote confirmation click.
      await prepareExport(page, options, async () => {
        submitting = createSubmittingTaskManifest(options, baseline);
        await writeJsonAtomic(manifestPath, submitting);
      });
      if (!submitting) throw new Error("JD submitting manifest was not persisted before confirmation click.");
      downloadPage = await openDownloadCenter(page);
      const created = await waitForManifestTaskRow(downloadPage, expectedPrefix, submitting);
      if (!created) throw new Error("Submitted JD product-detail task is not uniquely visible in download center; manifest retained and no replacement task will be created.");
      taskFingerprint = created.fingerprint;
      await writeJsonAtomic(manifestPath, { ...submitting, status: "pending", rowFingerprint: created.fingerprint, taskId: created.taskId });
    }
    await waitForTaskDownload(downloadPage, expectedPrefix, taskFingerprint);
    const result = await acquireJdProductDetailDownload({
      downloadDirectory: options.downloadDirectory,
      expectedPrefix,
      reuseWindowMs: JD_PRODUCT_DETAIL_REUSE_WINDOW_MS,
      initialWaitMs: 120_000,
      partialGraceMs: 300_000,
      maxRetries: 1,
      dimension: options.dimension,
      startDate: options.startDate,
      endDate: options.endDate,
      triggerDownload: () => clickTaskDownload(downloadPage, expectedPrefix, taskFingerprint),
    });
    const importResult = options.autoImport ? await importJdProductDetailFile(options, result.filePath) : undefined;
    await rm(manifestPath, { force: true });
    emitPipelineResult({
      status: result.reused ? "reused" : "downloaded",
      taskReused,
      dimension: options.dimension,
      savedPath: result.filePath,
      importResult,
      batchId: importResult?.batchId,
      rowCount: importResult?.rowCount,
      downloadClicks: result.downloadClicks,
    });
    client.close();
  } finally {
    await browser.close();
  }
}

async function main() { return withJdProductDetailRunLock(run); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
