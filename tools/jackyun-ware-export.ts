import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Locator, Page } from "playwright-core";
import {
  parseJdWareExportTaskRows,
  selectExistingJdWareExportTask,
  selectRecoverableJdWareExportTask,
  unseenJdWareExportTasks,
  type JdWareExportRecovery,
  type JdWareExportTask,
} from "../lib/jd/ware-export";
import { launchDedicatedChrome, waitForChrome } from "../lib/jackyun/cdp-client";
import { connectPlaywrightBrowser, connectPlaywrightJackyunTarget } from "../lib/jackyun/playwright-client";
import { readJsonFileOr, writeJsonAtomic } from "../lib/jackyun/json-file";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetUrl = "https://wares-jdm.jd.com/ware/wareList?activeTab=OnsaleWare&businessModel=0";
const artifactDir = path.join(projectRoot, "outputs", "jd-ware-export");
const activeTaskPath = path.join(artifactDir, "active-task.json");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profileDirectory = path.resolve(path.join(projectRoot, ".runtime", "jackyun-chrome-profile"));
const port = 9223;
const pollIntervalMs = 700;
const refreshIntervalMs = 3_000;

async function withJdWareExportRunLock<T>(task: () => Promise<T>) {
  await ensureDir(artifactDir);
  const lockPath = path.join(artifactDir, "jd-ware-export.lock");
  const handle = await open(lockPath, "wx").catch(() => null);
  if (!handle) throw new Error("另一个京东店铺 SKU 导出正在运行；共享 Chrome 与活动任务清单已锁定。");
  await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  await handle.close();
  try {
    return await task();
  } finally {
    await rm(lockPath, { force: true });
  }
}

export type CliOptions = {
  reuseLatest: boolean;
  taskTimeoutMs: number;
  debug: boolean;
  autoImport: boolean;
  baseUrl: string;
};

export type ScriptResult = {
  status: "completed" | "download_triggered_unverified";
  targetUrl: string;
  reusedLatest: boolean;
  task: JdWareExportTask;
  downloadSavedPath?: string;
  importResult?: { status: string; message: string; batchId?: string; rowCount?: number };
  notes: string[];
  elapsedMs: number;
};

export type WareExportAudit = {
  status: "running" | "completed" | "failed";
  stage: string;
  startedAt: string;
  updatedAt: string;
  targetUrl: string;
  baseUrl: string;
  intent: "create" | "reuse_latest";
  baselineTaskIds?: string[];
  taskId?: string;
  taskStatus?: JdWareExportTask["status"];
  savedPath?: string;
  result?: ScriptResult;
  error?: string;
};

export function createWareExportAudit(options: Pick<CliOptions, "baseUrl" | "reuseLatest">): WareExportAudit {
  const now = new Date().toISOString();
  return {
    status: "running",
    stage: "starting",
    startedAt: now,
    updatedAt: now,
    targetUrl,
    baseUrl: options.baseUrl,
    intent: options.reuseLatest ? "reuse_latest" : "create",
  };
}

export function advanceWareExportAudit(audit: WareExportAudit, patch: Partial<WareExportAudit>): WareExportAudit {
  return { ...audit, ...patch, updatedAt: new Date().toISOString() };
}

function parseCliOptions(): CliOptions {
  const args = process.argv.slice(2);
  let reuseLatest = false;
  let debug = false;
  let autoImport = true;
  let baseUrl = (process.env.OPERATIONS_SYSTEM_URL ?? "http://localhost:3000").replace(/\/$/, "");
  // 京东导出任务通常需要数分钟，默认给足等待时间，避免任务已完成但脚本提前超时。
  let taskTimeoutMs = 300_000;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--reuse-latest") {
      reuseLatest = true;
      continue;
    }
    if (argument === "--debug") {
      debug = true;
      continue;
    }
    if (argument === "--no-auto-import") {
      autoImport = false;
      continue;
    }
    if (argument === "--base-url") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--base-url 必须提供运营管理系统地址");
      baseUrl = value.replace(/\/$/, "");
      index += 1;
      continue;
    }
    if (argument === "--task-timeout-seconds") {
      const value = Number(args[index + 1]);
      if (!Number.isFinite(value) || value <= 0) throw new Error("--task-timeout-seconds 必须是正数。");
      taskTimeoutMs = Math.round(value * 1_000);
      index += 1;
      continue;
    }
    throw new Error(`不支持的参数：${argument}`);
  }

  return { reuseLatest, taskTimeoutMs, debug, autoImport, baseUrl };
}

async function ensureDir(directory: string) {
  await mkdir(directory, { recursive: true });
}

async function exactlyOne(locator: Locator, description: string) {
  const count = await locator.count();
  if (count !== 1) throw new Error(`${description} 应匹配 1 个元素，实际匹配 ${count} 个。`);
  return locator;
}

async function waitForExportEntry(page: Page) {
  const entry = page.getByRole("button", { name: "导出查询商品", exact: true });
  await entry.waitFor({ state: "visible", timeout: 30_000 });
  return exactlyOne(entry, "导出查询商品按钮");
}

async function openTargetPage(page: Page) {
  if (page.url() !== targetUrl) await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForExportEntry(page);

  const pageText = await page.locator("body").innerText({ timeout: 10_000 });
  if (/登录|账号|密码|验证码/.test(pageText)) {
    throw new Error("京东商家后台尚未登录。请在专用浏览器中完成登录后重新运行。");
  }
}

async function readExportTasks(page: Page) {
  const rows = await page.locator("tr").evaluateAll((elements) => elements.map((element) => (element.textContent ?? "").trim()));
  return parseJdWareExportTaskRows(rows);
}

async function refreshExportRecords(page: Page) {
  const refresh = page.getByText("刷新列表", { exact: true });
  if (await refresh.count() === 1) await refresh.click();
}

async function openSkuExportDialog(page: Page) {
  const exportEntry = await waitForExportEntry(page);
  await exportEntry.click();

  const skuTab = page.getByRole("tab", { name: "SKU导出", exact: true });
  await skuTab.waitFor({ state: "visible", timeout: 15_000 });
  await exactlyOne(skuTab, "SKU导出页签");

  // JD normally opens this tab by default.  Clicking only when needed saves a
  // UI round trip while still making the intended export dimension explicit.
  if (await skuTab.getAttribute("aria-selected") !== "true") await skuTab.click();

  const confirm = page.getByRole("button", { name: "确定导出", exact: true });
  await confirm.waitFor({ state: "visible", timeout: 15_000 });
  return exactlyOne(confirm, "确定导出按钮");
}

async function waitForTask(
  page: Page,
  previousTaskIds: ReadonlySet<string>,
  timeoutMs: number,
  onTaskObserved?: (task: JdWareExportTask) => Promise<void>,
) {
  const deadline = Date.now() + timeoutMs;
  let lastRefreshAt = 0;

  while (Date.now() < deadline) {
    const tasks = await readExportTasks(page);
    const unseenTasks = unseenJdWareExportTasks(tasks, previousTaskIds);
    if (unseenTasks.length > 1) {
      throw new Error(`检测到多个新导出任务（${unseenTasks.map((task) => task.taskId).join("、")}），无法安全关联本次导出，已停止自动下载。`);
    }
    const task = unseenTasks[0];
    if (task) await onTaskObserved?.(task);
    if (task?.status === "completed") return task;
    if (task?.status === "failed") throw new Error(`京东导出任务 ${task.taskId} 失败：${task.resultText ?? task.rowText}`);

    if (Date.now() - lastRefreshAt >= refreshIntervalMs) {
      await refreshExportRecords(page);
      lastRefreshAt = Date.now();
    }
    await page.waitForTimeout(pollIntervalMs);
  }

  throw new Error(`等待新的京东导出任务完成超时（${Math.round(timeoutMs / 1_000)} 秒）。`);
}

async function waitForKnownTask(
  page: Page,
  taskId: string,
  timeoutMs: number,
  onTaskObserved?: (task: JdWareExportTask) => Promise<void>,
) {
  const deadline = Date.now() + timeoutMs;
  let lastRefreshAt = 0;
  while (Date.now() < deadline) {
    const task = (await readExportTasks(page)).find((item) => item.taskId === taskId);
    if (!task) throw new Error(`京东导出任务 ${taskId} 已不在导出记录中，无法安全继续。`);
    await onTaskObserved?.(task);
    if (task.status === "completed") return task;
    if (task.status === "failed") throw new Error(`京东导出任务 ${task.taskId} 失败：${task.resultText ?? task.rowText}`);
    if (Date.now() - lastRefreshAt >= refreshIntervalMs) {
      await refreshExportRecords(page);
      lastRefreshAt = Date.now();
    }
    await page.waitForTimeout(pollIntervalMs);
  }
  throw new Error(`等待京东导出任务 ${taskId} 完成超时（${Math.round(timeoutMs / 1_000)} 秒）。`);
}

async function saveTaskDownload(page: Page, task: JdWareExportTask) {
  const taskRow = page.locator("tr").filter({ hasText: task.taskId });
  await exactlyOne(taskRow, `导出任务 ${task.taskId} 的记录行`);
  const downloadButton = taskRow.getByRole("button", { name: "下载", exact: true });
  await exactlyOne(downloadButton, `导出任务 ${task.taskId} 的下载按钮`);

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await downloadButton.click();

  try {
    const download = await downloadPromise;
    const filename = download.suggestedFilename().replace(/[<>:"/\\|?*]/g, "_");
    const downloadDir = path.join(artifactDir, "downloads");
    await ensureDir(downloadDir);
    const savedPath = path.join(downloadDir, `${task.taskId}-${filename}`);
    await download.saveAs(savedPath);
    return { savedPath, verified: true };
  } catch (error) {
    // The click has already been sent; never retry it automatically because
    // that can create duplicate local files and obscure which task was used.
    return { savedPath: undefined, verified: false, error: String(error) };
  }
}

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export async function importSkuFile(baseUrl: string, filePath: string, request: typeof fetch = fetch) {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append("source", "jd_product_master");
  form.append("platform", "京东");
  form.append("shop_name", "志高商用设备旗舰店");
  form.append("snapshot_date", shanghaiToday());
  form.append("note", "京东 SKU 自动下载后导入");
  form.append(
    "file",
    new File([bytes], path.basename(filePath), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );

  const response = await request(`${baseUrl}/api/netshop/import`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    status?: string;
    message?: string;
    batch?: { id?: string; rowCount?: number };
  } | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message ?? `运营管理系统 SKU 导入失败（HTTP ${response.status}）`);
  }
  return {
    status: payload.status ?? "imported",
    message: payload.message ?? "京东 SKU 已自动导入运营管理系统",
    batchId: payload.batch?.id,
    rowCount: payload.batch?.rowCount,
  };
}

async function maybeCaptureDebug(page: Page, label: string, enabled: boolean) {
  if (!enabled) return;
  await ensureDir(artifactDir);
  await page.screenshot({ path: path.join(artifactDir, `${label}.png`), fullPage: false }).catch(() => undefined);
}

export async function runShopSkuExport(
  page: Page,
  options: CliOptions,
  checkpoint: (patch: Partial<WareExportAudit>) => Promise<void> = async () => undefined,
  recovery: JdWareExportRecovery | null = null,
): Promise<ScriptResult> {
  const startedAt = Date.now();
  const notes: string[] = [];
  await maybeCaptureDebug(page, "before-export", options.debug);

  const confirm = await openSkuExportDialog(page);
  const existingTasks = await readExportTasks(page);
  await checkpoint({
    stage: "select_task",
    baselineTaskIds: existingTasks.map((task) => task.taskId),
  });

  let task: JdWareExportTask;
  let reusedLatest = false;
  const recovered = recovery ? selectRecoverableJdWareExportTask(existingTasks, recovery) : null;
  if (recovered?.kind === "ambiguous") {
    throw new Error(`活动任务清单匹配到多个 SKU 导出任务（${recovered.tasks.map((item) => item.taskId).join("、")}），已停止且不会创建新任务。`);
  }
  if (recovered?.kind === "missing") {
    throw new Error("活动任务清单对应的 SKU 导出任务尚未唯一出现；已保留清单且不会创建新任务。");
  }
  if (recovered?.kind === "task") {
    if (recovered.task.status === "failed") {
      await checkpoint({ stage: "recovered_task_failed", taskId: recovered.task.taskId, taskStatus: recovered.task.status });
      throw new Error(`活动任务 ${recovered.task.taskId} 已失败：${recovered.task.resultText ?? recovered.task.rowText}`);
    }
    await checkpoint({ stage: "take_over_recovered_task", taskId: recovered.task.taskId, taskStatus: recovered.task.status });
    task = recovered.task.status === "completed"
      ? recovered.task
      : await waitForKnownTask(page, recovered.task.taskId, options.taskTimeoutMs, async (observed) => {
        await checkpoint({ stage: "wait_recovered_task", taskId: observed.taskId, taskStatus: observed.status });
      });
    reusedLatest = true;
    notes.push(`按活动任务清单接管导出任务 ${task.taskId}，跳过创建新任务。`);
  } else {
    const selection = selectExistingJdWareExportTask(existingTasks, options.reuseLatest);
    if (selection.kind === "ambiguous_pending") {
      throw new Error(`检测到多个待处理 SKU 导出任务（${selection.tasks.map((item) => item.taskId).join("、")}），无法安全接管，已停止且不会创建新任务。`);
    }
    if (selection.kind === "pending") {
      await checkpoint({ stage: "take_over_pending_task", taskId: selection.task.taskId, taskStatus: selection.task.status });
      task = await waitForKnownTask(page, selection.task.taskId, options.taskTimeoutMs, async (observed) => {
        await checkpoint({ stage: "wait_existing_task", taskId: observed.taskId, taskStatus: observed.status });
      });
      reusedLatest = true;
      notes.push(`接管待处理导出任务 ${task.taskId}，跳过创建新任务。`);
    } else if (selection.kind === "completed") {
      task = selection.task;
      reusedLatest = true;
      await checkpoint({ stage: "reuse_completed_task", taskId: task.taskId, taskStatus: task.status });
      notes.push(`复用已完成导出任务 ${task.taskId}，跳过创建新任务。`);
    } else {
      if (options.reuseLatest) throw new Error("没有可复用的已完成 SKU 导出记录，也没有待处理任务，请不带 --reuse-latest 重新运行。");
      const previousTaskIds = new Set(existingTasks.map((item) => item.taskId));
      // Persist the baseline before the irreversible remote click. If the
      // process stops before learning the task id, the next run can still
      // associate exactly one post-baseline row.
      await checkpoint({ stage: "task_submitting", baselineTaskIds: [...previousTaskIds] });
      await confirm.click();
      await checkpoint({ stage: "task_submitted", baselineTaskIds: [...previousTaskIds] });
      notes.push("已创建新的 SKU 导出任务。");
      task = await waitForTask(page, previousTaskIds, options.taskTimeoutMs, async (observed) => {
        await checkpoint({ stage: "wait_new_task", taskId: observed.taskId, taskStatus: observed.status });
      });
    }
  }

  await maybeCaptureDebug(page, "task-completed", options.debug);
  const download = await saveTaskDownload(page, task);
  if (download.savedPath) await checkpoint({ stage: "downloaded", taskId: task.taskId, taskStatus: task.status, savedPath: download.savedPath });
  let importResult: ScriptResult["importResult"];
  if (download.verified && download.savedPath && options.autoImport) {
    await checkpoint({ stage: "auto_import", taskId: task.taskId, taskStatus: task.status, savedPath: download.savedPath });
    importResult = await importSkuFile(options.baseUrl, download.savedPath);
    notes.push(`auto-imported SKU file: ${importResult.message}`);
  } else if (download.verified && !options.autoImport) {
    notes.push("auto-import skipped by --no-auto-import");
  }
  if (download.verified) notes.push(`已保存下载文件：${download.savedPath}`);
  else notes.push(`已触发下载，但未收到浏览器下载事件：${download.error}`);

  return {
    status: download.verified ? "completed" : "download_triggered_unverified",
    targetUrl,
    reusedLatest,
    task,
    downloadSavedPath: download.savedPath,
    importResult,
    notes,
    elapsedMs: Date.now() - startedAt,
  };
}

async function main() {
  const options = parseCliOptions();
  await ensureDir(artifactDir);
  const auditPath = path.join(artifactDir, `run-${Date.now()}.json`);
  let audit = createWareExportAudit(options);
  let recovery: JdWareExportRecovery | null = null;
  const persistAudit = async (patch: Partial<WareExportAudit>) => {
    audit = advanceWareExportAudit(audit, patch);
    await writeJsonAtomic(auditPath, audit);
    if (patch.stage === "task_submitting" && patch.baselineTaskIds) {
      recovery = { version: 1, baselineTaskIds: patch.baselineTaskIds, createdAt: new Date().toISOString() };
      await writeJsonAtomic(activeTaskPath, recovery);
    } else if (patch.taskId) {
      recovery = {
        version: 1,
        baselineTaskIds: recovery?.baselineTaskIds ?? audit.baselineTaskIds ?? [],
        taskId: patch.taskId,
        createdAt: recovery?.createdAt ?? new Date().toISOString(),
      };
      if (patch.taskStatus === "failed") {
        await rm(activeTaskPath, { force: true });
        recovery = null;
      } else {
        await writeJsonAtomic(activeTaskPath, recovery);
      }
    }
  };
  await writeJsonAtomic(auditPath, audit);
  let browser: Awaited<ReturnType<typeof connectPlaywrightBrowser>> | undefined;
  try {
    recovery = await readJsonFileOr<JdWareExportRecovery | null>(activeTaskPath, null);
    if (recovery && (recovery.version !== 1 || !Array.isArray(recovery.baselineTaskIds))) {
      throw new Error(`SKU 活动任务清单格式无效，已停止以免重复提交：${activeTaskPath}`);
    }
    await persistAudit({ stage: "launch_browser" });
    await launchDedicatedChrome({ executablePath: chromePath, profileDirectory, port, startUrl: targetUrl, headless: false });
    await waitForChrome(port);
    browser = await connectPlaywrightBrowser(port);
    const { page, client } = await connectPlaywrightJackyunTarget(browser, {
      startUrl: targetUrl,
      workerName: "codex-jd-ware-export",
      targetUrlPattern: /wares-jdm\.jd\.com/i,
    });
    try {
      await openTargetPage(page);
      const result = await runShopSkuExport(page, options, persistAudit, recovery);
      if (result.status !== "completed") {
        const message = "京东 SKU 下载点击已发送，但未验证本地文件；活动任务清单已保留，禁止自动新建任务。";
        await persistAudit({ status: "failed", stage: "download_unverified", taskId: result.task.taskId, taskStatus: result.task.status, result, error: message });
        console.error(message);
        console.log(JSON.stringify({ ...result, auditPath }, null, 2));
        process.exitCode = 1;
        return;
      }
      await persistAudit({ status: "completed", stage: "completed", taskId: result.task.taskId, taskStatus: result.task.status, savedPath: result.downloadSavedPath, result });
      await rm(activeTaskPath, { force: true });
      recovery = null;
      console.log(JSON.stringify({ ...result, auditPath }, null, 2));
    } finally {
      client.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    await persistAudit({ status: "failed", error: message });
    console.error(message);
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void withJdWareExportRunLock(main).catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
