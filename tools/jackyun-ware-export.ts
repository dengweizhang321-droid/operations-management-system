import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "playwright-core";
import { newestCompletedJdWareExportTask, parseJdWareExportTaskRows, unseenJdWareExportTasks, type JdWareExportTask } from "../lib/jd/ware-export";
import { launchDedicatedChrome, waitForChrome } from "../lib/jackyun/cdp-client";
import { connectPlaywrightBrowser, connectPlaywrightJackyunTarget } from "../lib/jackyun/playwright-client";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetUrl = "https://wares-jdm.jd.com/ware/wareList?activeTab=OnsaleWare&businessModel=0";
const artifactDir = path.join(projectRoot, "outputs", "jd-ware-export");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profileDirectory = path.resolve(path.join(projectRoot, ".runtime", "jackyun-chrome-profile"));
const port = 9223;
const pollIntervalMs = 700;
const refreshIntervalMs = 3_000;

type CliOptions = {
  reuseLatest: boolean;
  taskTimeoutMs: number;
  debug: boolean;
};

type ScriptResult = {
  status: "completed" | "download_triggered_unverified";
  targetUrl: string;
  reusedLatest: boolean;
  task: JdWareExportTask;
  downloadSavedPath?: string;
  notes: string[];
  elapsedMs: number;
};

function parseCliOptions(): CliOptions {
  const args = process.argv.slice(2);
  let reuseLatest = false;
  let debug = false;
  let taskTimeoutMs = 90_000;

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
    if (argument === "--task-timeout-seconds") {
      const value = Number(args[index + 1]);
      if (!Number.isFinite(value) || value <= 0) throw new Error("--task-timeout-seconds 必须是正数。");
      taskTimeoutMs = Math.round(value * 1_000);
      index += 1;
      continue;
    }
    throw new Error(`不支持的参数：${argument}`);
  }

  return { reuseLatest, taskTimeoutMs, debug };
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

async function maybeCaptureDebug(page: Page, label: string, enabled: boolean) {
  if (!enabled) return;
  await ensureDir(artifactDir);
  await page.screenshot({ path: path.join(artifactDir, `${label}.png`), fullPage: false }).catch(() => undefined);
}

async function runShopSkuExport(page: Page, options: CliOptions): Promise<ScriptResult> {
  const startedAt = Date.now();
  const notes: string[] = [];
  await maybeCaptureDebug(page, "before-export", options.debug);

  const confirm = await openSkuExportDialog(page);
  const existingTasks = await readExportTasks(page);

  let task: JdWareExportTask;
  let reusedLatest = false;
  if (options.reuseLatest) {
    const latest = newestCompletedJdWareExportTask(existingTasks);
    if (!latest) throw new Error("没有可复用的已完成 SKU 导出记录，请不带 --reuse-latest 重新运行。");
    task = latest;
    reusedLatest = true;
    notes.push(`复用已完成导出任务 ${task.taskId}，跳过创建新任务。`);
  } else {
    const previousTaskIds = new Set(existingTasks.map((item) => item.taskId));
    await confirm.click();
    notes.push("已创建新的 SKU 导出任务。");
    task = await waitForTask(page, previousTaskIds, options.taskTimeoutMs);
  }

  await maybeCaptureDebug(page, "task-completed", options.debug);
  const download = await saveTaskDownload(page, task);
  if (download.verified) notes.push(`已保存下载文件：${download.savedPath}`);
  else notes.push(`已触发下载，但未收到浏览器下载事件：${download.error}`);

  return {
    status: download.verified ? "completed" : "download_triggered_unverified",
    targetUrl,
    reusedLatest,
    task,
    downloadSavedPath: download.savedPath,
    notes,
    elapsedMs: Date.now() - startedAt,
  };
}

async function main() {
  const options = parseCliOptions();
  await ensureDir(artifactDir);

  await launchDedicatedChrome({ executablePath: chromePath, profileDirectory, port, startUrl: targetUrl, headless: false });
  await waitForChrome(port);
  const browser = await connectPlaywrightBrowser(port);

  try {
    const { page, client } = await connectPlaywrightJackyunTarget(browser, {
      startUrl: targetUrl,
      workerName: "codex-jd-ware-export",
      targetUrlPattern: /wares-jdm\.jd\.com/i,
    });
    try {
      await openTargetPage(page);
      const result = await runShopSkuExport(page, options);
      const auditPath = path.join(artifactDir, `run-${Date.now()}.json`);
      await writeFile(auditPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      console.log(JSON.stringify({ ...result, auditPath }, null, 2));
    } finally {
      client.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
