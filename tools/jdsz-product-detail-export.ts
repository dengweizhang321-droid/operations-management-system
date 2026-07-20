import { mkdir, open, rm } from "node:fs/promises";
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
  startDate: string;
  endDate: string;
  dimension: "SKU" | "SPU";
  debug: boolean;
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

function parseArgs(argv: string[]): CliOptions {
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

  return {
    chromePath: values.get("--chrome-path") ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    profileDirectory: path.resolve(values.get("--profile-dir") ?? path.join(projectRoot, ".runtime", "jdsz-chrome-profile")),
    port: Number(values.get("--port") ?? 9224),
    downloadDirectory: path.resolve(values.get("--download-dir") ?? "D:\\谷歌浏览器"),
    shopId: values.get("--shop-id") ?? "701455",
    startDate,
    endDate,
    dimension,
    debug: flags.has("--debug"),
  };
}

export function jdProductDetailDownloadPrefix(options: Pick<CliOptions, "shopId" | "startDate" | "endDate">) {
  return `${options.shopId}_商品明细_离线_不包括对比时间_分天下载_${options.startDate}_${options.endDate}`;
}

function taskManifestPath(options: Pick<CliOptions, "dimension" | "shopId" | "startDate" | "endDate">) {
  return path.join(artifactDir, `${options.dimension.toLowerCase()}-task-${options.shopId}-${options.startDate}-${options.endDate}.json`);
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

async function waitForSelectedDateRange(page: Page, startDate: string, endDate: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let echoText = "";
  while (Date.now() < deadline) {
    echoText = await currentDateEcho(page);
    if (jdDateRangeEchoMatches(echoText, startDate, endDate)) return echoText;
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
  // The JD date popover is visible before its opening transition can reliably
  // receive day-cell clicks. A short stabilization delay prevents swallowed
  // clicks; the selected-state gates below still provide the success signal.
  await page.waitForTimeout(300);
  const cellSelector = (date: string) =>
    `td[data-event-content="当前时间自定义_${date}"]:not(.jmt-date-picker-calendar-cell-diff-month)`;
  const selectDay = async (date: string) => {
    const cell = page.locator(cellSelector(date)).filter({ visible: true });
    await cell.waitFor({ state: "visible", timeout: 10_000 });
    if (await cell.count() !== 1) throw new Error(`日期 ${date} 的可选单元格不是唯一元素。`);
    await cell.click();
  };
  const waitForCellState = async (date: string, stateClass: string, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    const cell = page.locator(cellSelector(date)).filter({ visible: true });
    while (Date.now() < deadline) {
      if ((await cell.getAttribute("class"))?.includes(stateClass)) return true;
      await page.waitForTimeout(50);
    }
    return false;
  };
  await selectDay(startDate);
  if (!await waitForCellState(startDate, "jmt-date-picker-calendar-cell-start", 1_000)) {
    await selectDay(startDate);
  }
  if (!await waitForCellState(startDate, "jmt-date-picker-calendar-cell-start", 5_000)) {
    throw new Error(`起始日期 ${startDate} 点击后未进入区间起点状态。`);
  }
  if (endDate !== startDate) {
    await selectDay(endDate);
    if (!await waitForCellState(endDate, "jmt-date-picker-calendar-cell-end", 1_000)) {
      await selectDay(endDate);
    }
    if (!await waitForCellState(endDate, "jmt-date-picker-calendar-cell-end", 5_000)) {
      throw new Error(`结束日期 ${endDate} 点击后未进入区间终点状态。`);
    }
  }
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

async function configureDownloadDialog(page: Page, beforeConfirm?: () => Promise<void>) {
  const downloadLabel = page.getByText("下载数据", { exact: true }).filter({ visible: true });
  if (await downloadLabel.count() !== 1) throw new Error("无法唯一识别商品明细区域的下载数据按钮。");
  const downloadButton = downloadLabel.locator("xpath=ancestor::button[1]");
  if (await downloadButton.count() !== 1) throw new Error("下载数据文本不属于唯一按钮。");
  await downloadButton.click();

  const dialog = page.getByRole("dialog").filter({ hasText: "下载类型", visible: true });
  await dialog.waitFor({ state: "visible", timeout: 15_000 });
  if (await dialog.count() !== 1) throw new Error("未出现唯一的商品明细下载弹窗。");
  const dialogText = await dialog.innerText();
  if (!dialogText.includes("分天下载") || !dialogText.includes("不包含对比时间")) {
    throw new Error("当前弹窗不是商品明细分天下载弹窗，已禁止继续。");
  }
  await selectDialogRadio(dialog, "分天下载");
  await selectDialogRadio(dialog, "不包含对比时间");
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
  const options = parseArgs(process.argv.slice(2));
  const expectedPrefix = jdProductDetailDownloadPrefix(options);
  const manifestPath = taskManifestPath(options);
  await mkdir(options.downloadDirectory, { recursive: true });

  const recent = await findRecentJdProductDetailDownload({
    downloadDirectory: options.downloadDirectory,
    expectedPrefix,
    maxAgeMs: JD_PRODUCT_DETAIL_REUSE_WINDOW_MS,
    dimension: options.dimension,
  });
  if (recent) {
    const savedPath = await finalizeJdProductDetailDownload(recent, options.dimension);
    await rm(manifestPath, { force: true });
    console.log(JSON.stringify({ status: "reused", dimension: options.dimension, savedPath, downloadClicks: 0 }, null, 2));
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
      const matched = selectManifestTaskRow(manifest, await taskRows(page, expectedPrefix));
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
      await page.goto(downloadCenterUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const submitting: JdProductDetailTaskManifest = { version: 1, status: "submitting", dimension: options.dimension, shopId: options.shopId, startDate: options.startDate, endDate: options.endDate, baseline: (await taskRows(page, expectedPrefix)).map((row) => row.fingerprint), createdAt: new Date().toISOString() };
      // Persist only after every selection/dialog gate has passed and directly
      // before the irreversible remote confirmation click.
      await prepareExport(page, options, () => writeJsonAtomic(manifestPath, submitting));
      downloadPage = await openDownloadCenter(page);
      const created = selectManifestTaskRow(submitting, await taskRows(downloadPage, expectedPrefix));
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
      triggerDownload: () => clickTaskDownload(downloadPage, expectedPrefix, taskFingerprint),
    });
    await rm(manifestPath, { force: true });
    console.log(JSON.stringify({
      status: result.reused ? "reused" : "downloaded",
      taskReused,
      dimension: options.dimension,
      savedPath: result.filePath,
      downloadClicks: result.downloadClicks,
    }, null, 2));
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
