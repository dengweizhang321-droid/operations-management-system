import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Frame, type Locator, type Page } from "playwright-core";
import * as XLSX from "xlsx";

type AutomationConfig = {
  version: string;
  timeZone: "Asia/Shanghai";
  weekdays: number[];
  baseUrl: string;
  jackyun: {
    startUrl: string;
    searchPlaceholder: string;
    salesFrameUrlContains: string;
    chromePath: string;
    profileDirectory: string;
    fixedTabs?: Array<{ label: string; match: string }>;
  };
  outputDirectory: string;
  timeouts: {
    pageMs: number;
    queryMs: number;
    downloadMs: number;
    importMs: number;
  };
};

type CliOptions = {
  asOfDate?: string;
  baseUrl?: string;
  checkLogin: boolean;
  configPath: string;
  dryRun: boolean;
  forceWeekend: boolean;
  headed: boolean;
  loginOnly: boolean;
};

type SalesPeriod = { startDate: string; endDate: string };

type DateInputInfo = {
  index: number;
  id: string;
  name: string;
  placeholder: string;
  value: string;
};

type ImportResponse = {
  ok?: boolean;
  status?: string;
  message?: string;
  batch?: { id: string; status: string; rowCount: number; warningCount?: number };
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultConfigPath = path.join(projectRoot, "config", "erp-sales-automation.json");
const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function assertIsoDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} 必须是 YYYY-MM-DD。`);
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label} 不是有效日期。`);
}

export function previousIsoDate(value: string) {
  assertIsoDate(value, "日期");
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function salesPeriodForShanghaiDay(today: string): SalesPeriod {
  const endDate = previousIsoDate(today);
  return { startDate: `${endDate.slice(0, 8)}01`, endDate };
}

export function isConfiguredWorkday(today: string, weekdays: readonly number[]) {
  assertIsoDate(today, "运行日期");
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return weekdays.includes(weekday);
}

export function shanghaiToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export function selectDateInputIndexes(inputs: readonly DateInputInfo[]) {
  const dateLike = inputs.filter((input) => {
    const attributes = `${input.id} ${input.name} ${input.placeholder}`.toLowerCase();
    return /^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?$/.test(input.value)
      || /date|time|日期|时间/.test(attributes);
  });
  if (dateLike.length < 2) throw new Error("销售单明细账未找到两个可用日期输入框。");
  const score = (input: DateInputInfo, kind: "start" | "end") => {
    const attributes = `${input.id} ${input.name} ${input.placeholder}`.toLowerCase();
    const wanted = kind === "start" ? /start|begin|from|开始|起始/ : /end|to|结束|截止/;
    const unwanted = kind === "start" ? /end|to|结束|截止/ : /start|begin|from|开始|起始/;
    return (wanted.test(attributes) ? 100 : 0) - (unwanted.test(attributes) ? 100 : 0) - input.index / 1000;
  };
  const start = [...dateLike].sort((a, b) => score(b, "start") - score(a, "start"))[0];
  const end = [...dateLike].filter((input) => input.index !== start.index)
    .sort((a, b) => score(b, "end") - score(a, "end"))[0];
  if (!end) throw new Error("销售单明细账未找到结束日期输入框。");
  return { startIndex: start.index, endIndex: end.index };
}

function parseCli(argv = process.argv.slice(2)): CliOptions {
  const values = new Map<string, string>();
  let dryRun = false;
  let forceWeekend = false;
  // 吉客云在当前环境的无头 Chrome 中无法完成首页加载，正式任务默认
  // 使用可见窗口；需要排查时才显式传入 --headless。
  let headed = true;
  let checkLogin = false;
  let loginOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") { dryRun = true; continue; }
    if (argument === "--force-weekend") { forceWeekend = true; continue; }
    if (argument === "--headed") { headed = true; continue; }
    if (argument === "--headless") { headed = false; continue; }
    if (argument === "--check-login") { checkLogin = true; continue; }
    if (argument === "--login") { loginOnly = true; headed = true; continue; }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`参数 ${argument} 缺少取值。`);
    values.set(argument, next);
    index += 1;
  }
  const asOfDate = values.get("--as-of");
  if (asOfDate) assertIsoDate(asOfDate, "--as-of");
  return {
    asOfDate,
    baseUrl: values.get("--base-url"),
    checkLogin,
    configPath: path.resolve(values.get("--config") ?? defaultConfigPath),
    dryRun,
    forceWeekend,
    headed,
    loginOnly,
  };
}

function resolveProjectPath(value: string) {
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

async function readConfig(configPath: string) {
  const config = JSON.parse(await readFile(configPath, "utf8")) as AutomationConfig;
  if (!config.version || config.timeZone !== "Asia/Shanghai") throw new Error("ERP 销售自动化配置无效。");
  if (!config.weekdays.length || !config.jackyun.startUrl || !config.jackyun.salesFrameUrlContains) {
    throw new Error("ERP 销售自动化配置缺少必要字段。");
  }
  return config;
}

function normalizeText(value: string) {
  return value.replace(/[（）]/g, (character) => character === "（" ? "(" : ")").replace(/\s+/g, "").trim();
}

async function uniqueVisible(locator: Locator, label: string) {
  const count = await locator.count();
  if (count !== 1) throw new Error(`${label} 应唯一可见，实际找到 ${count} 个。`);
  return locator;
}

async function openFixedTab(page: Page, label: string) {
  const tab = page.locator(".jk-fav-toolbar .mini-menuitem, .mini-menu-horizontal .mini-menuitem, .mini-menuitem").filter({ hasText: label });
  if (await tab.count() < 1) return false;
  const count = Math.min(await tab.count(), 3);
  for (let index = 0; index < count; index += 1) {
    const item = tab.nth(index);
    try {
      await item.scrollIntoViewIfNeeded();
      await item.click({ timeout: 2000 });
      await page.waitForTimeout(600);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function openSalesLedger(page: Page, config: AutomationConfig) {
  await page.goto(config.jackyun.startUrl, { waitUntil: "domcontentloaded", timeout: config.timeouts.pageMs });
  const search = page.getByPlaceholder(config.jackyun.searchPlaceholder, { exact: true });
  const searchReady = await search.waitFor({ state: "visible", timeout: config.timeouts.pageMs })
    .then(() => true)
    .catch(() => false);
  if (!searchReady || await search.count() !== 1) {
    const title = await page.title().catch(() => "未知标题");
    throw new Error(`吉客云首页未就绪（标题：${title}，地址：${page.url()}）。请先运行 npm run erp:sales:login 完成登录。`);
  }

  const fixedTabs = config.jackyun.fixedTabs ?? [{ label: config.jackyun.pageName, match: config.jackyun.salesFrameUrlContains }];
  const salesFrameSelector = `iframe[src*="${config.jackyun.salesFrameUrlContains}"]:visible`;
  for (const tab of fixedTabs) {
    if (await page.locator(salesFrameSelector).count() === 1) break;
    await openFixedTab(page, tab.label);
  }
  if (await page.locator(salesFrameSelector).count() !== 1) {
    throw new Error(`未能通过状态栏打开 ${config.jackyun.pageName}。`);
  }

  await page.waitForFunction(
    (hint) => Array.from(document.querySelectorAll("iframe")).some((frame) => frame.src.includes(hint) && frame.getBoundingClientRect().width > 0),
    config.jackyun.salesFrameUrlContains,
    { timeout: config.timeouts.pageMs },
  );
  const deadline = Date.now() + config.timeouts.pageMs;
  while (Date.now() < deadline) {
    const frame = page.frames().find((candidate) => candidate.url().includes(config.jackyun.salesFrameUrlContains));
    if (frame) return frame;
    await page.waitForTimeout(250);
  }
  throw new Error("销售单明细账 iframe 未加载。");
}

async function visibleDateInputs(frame: Frame) {
  const inputs = frame.locator("input, textarea").evaluateAll((elements) => elements
    .filter((element) => {
      const html = element as HTMLInputElement;
      const text = `${html.id ?? ""} ${html.name ?? ""} ${html.placeholder ?? ""} ${html.className ?? ""}`.toLowerCase();
      return /date|time|日期|时间/.test(text) || /^\d{4}-\d{2}-\d{2}/.test(html.value ?? "");
    })
    .map((element, index) => {
      const input = element as HTMLInputElement;
      return {
        index,
        id: input.id ?? "",
        name: input.name ?? "",
        placeholder: input.placeholder ?? "",
        value: input.value ?? "",
      };
    })) as Promise<DateInputInfo[]>;
  return inputs;
}

async function setDateInput(frame: Frame, index: number, value: string) {
  const input = frame.locator("input, textarea").filter({ hasNot: frame.locator("[style*='display: none']") }).nth(index);
  await input.evaluate((element, nextValue) => {
    const target = element as HTMLInputElement;
    const mini = (window as unknown as { mini?: { get?: (id: string) => { setValue?: (value: string) => void } } }).mini;
    const component = target.id ? mini?.get?.(target.id) : undefined;
    if (component?.setValue) component.setValue(nextValue);
    else {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(target, nextValue);
    }
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    target.dispatchEvent(new Event("blur", { bubbles: true }));
  }, value);
  const readBack = await input.inputValue();
  if (readBack !== value) throw new Error(`日期输入框读回不一致：期望 ${value}，实际 ${readBack}。`);
}

async function setSalesPeriod(frame: Frame, period: SalesPeriod) {
  const inputs = await visibleDateInputs(frame);
  const { startIndex, endIndex } = selectDateInputIndexes(inputs);
  const startValue = `${period.startDate} 00:00:00`;
  const endValue = `${period.endDate} 23:59:59`;
  await setDateInput(frame, startIndex, startValue);
  await setDateInput(frame, endIndex, endValue);
  return { startValue, endValue };
}

async function exactVisibleText(root: Page | Frame, texts: readonly string[], label: string) {
  for (const text of texts) {
    const candidates = root.locator("a:visible, button:visible, .mini-button:visible, .mini-menuitem:visible, [role='menuitem']:visible")
      .filter({ hasText: text });
    const contents = await candidates.allTextContents();
    const exactIndexes = contents.flatMap((content, index) => normalizeText(content) === normalizeText(text) ? [index] : []);
    if (exactIndexes.length === 1) return candidates.nth(exactIndexes[0]);
  }
  throw new Error(`${label} 未找到唯一可见控件。`);
}

async function queryOnce(frame: Frame, timeoutMs: number) {
  const dataRows = frame.locator(".mini-grid-rows-view tr:visible, tr.mini-grid-row:visible, .mini-grid-row:visible")
    .filter({ has: frame.locator("td") });
  const beforeCount = await dataRows.count();
  const candidates = [
    frame.locator(".mini-panel .mini-button:visible").filter({ hasText: "筛选" }),
    frame.locator(".mini-panel .mini-button:visible").filter({ hasText: "查询" }),
    frame.locator("button:visible, a:visible, div:visible, span:visible").filter({ hasText: "筛选" }),
    frame.locator("button:visible, a:visible, div:visible, span:visible").filter({ hasText: "查询" }),
  ];
  for (const candidate of candidates) {
    if (await candidate.count() !== 1) continue;
    await candidate.first().click();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const afterCount = await dataRows.count();
      const bodyText = await frame.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
      if (afterCount > beforeCount || /请选择条件进行筛选/.test(bodyText) === false) return;
      await frame.waitForTimeout(300);
    }
  }
  throw new Error("点击筛选后未等到订单明细刷新。");
}

async function stableSourceRows(frame: Frame, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let previous: number | null = null;
  let stable = 0;
  while (Date.now() < deadline) {
    const count = await frame.locator(".mini-grid-rows-view tr:visible, tr.mini-grid-row:visible").count();
    const text = await frame.locator("body").innerText({ timeout: 10_000 });
    const total = Number(text.match(/共\s*([\d,]+)\s*条/)?.[1]?.replace(/,/g, "") ?? count);
    if (Number.isSafeInteger(total) && total > 0) {
      stable = total === previous ? stable + 1 : 1;
      previous = total;
      if (stable >= 2) return total;
    }
    await frame.waitForTimeout(500);
  }
  throw new Error("销售明细查询结果未在规定时间内稳定。");
}

async function rightClickFirstDataRow(frame: Frame) {
  const rows = frame.locator(".mini-grid-rows-view tr:visible, tr.mini-grid-row:visible").filter({ has: frame.locator("td") });
  const count = await rows.count();
  if (count < 1) throw new Error("销售明细没有可右键的数据行。");
  const row = rows.first();
  await row.scrollIntoViewIfNeeded();
  await row.click({ button: "right" });
}

async function clickExportAll(page: Page, frame: Frame) {
  await rightClickFirstDataRow(frame);
  const exportMenu = await exactVisibleText(frame, ["导出"], "导出菜单").catch(() => exactVisibleText(page, ["导出"], "导出菜单"));
  await exportMenu.click();
  const exportAllTexts = ["导出所有页", "导出所有页(限500000行)", "导出所有页（限500000行）"];
  const exportAll = await exactVisibleText(frame, exportAllTexts, "导出所有页").catch(() => exactVisibleText(page, exportAllTexts, "导出所有页"));
  await exportAll.click();
}

async function waitForDownloadedXlsx(directory: string, notBeforeMs: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let previous: { path: string; size: number; mtimeMs: number } | null = null;
  while (Date.now() < deadline) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const candidates: Array<{ path: string; size: number; mtimeMs: number }> = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".xlsx")) continue;
      const filePath = path.join(directory, entry.name);
      const info = await stat(filePath).catch(() => null);
      if (info && info.mtimeMs >= notBeforeMs && info.size > 0) candidates.push({ path: filePath, size: info.size, mtimeMs: info.mtimeMs });
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const current = candidates[0] ?? null;
    if (current && previous?.path === current.path && previous.size === current.size && previous.mtimeMs === current.mtimeMs) return current.path;
    previous = current;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("等待销售单明细账下载超时。");
}

async function exportSalesWorkbook(page: Page, frame: Frame, runDirectory: string, period: SalesPeriod, timeoutMs: number) {
  const targetPath = path.join(runDirectory, `销售单明细账_${period.startDate}_${period.endDate}.xlsx`);
  const exportStartedAt = Date.now();
  const downloadEvent = page.waitForEvent("download", { timeout: timeoutMs }).then(async (download) => {
    const suggested = download.suggestedFilename();
    const finalPath = path.join(runDirectory, suggested || path.basename(targetPath));
    await download.saveAs(finalPath);
    return finalPath;
  });
  await clickExportAll(page, frame);
  const file = await Promise.any([
    downloadEvent,
    waitForDownloadedXlsx(runDirectory, exportStartedAt - 1000, timeoutMs),
  ]);
  if (path.resolve(file) !== path.resolve(targetPath)) {
    const bytes = await readFile(file);
    await writeFile(targetPath, bytes);
  }
  return targetPath;
}

export function validateSalesWorkbook(bytes: Uint8Array) {
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("下载结果不是有效的 XLSX 文件。");
  const workbook = XLSX.read(bytes, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("销售明细 Excel 没有工作表。");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "" });
  const required = ["发货仓库", "货品编号", "货品成本"];
  const headerIndex = rows.slice(0, 30).findIndex((row) => required.every((header) => row.map(String).includes(header)));
  if (headerIndex < 0) throw new Error(`销售明细 Excel 缺少必要列：${required.join("、")}。`);
  const sourceRows = rows.slice(headerIndex + 1).filter((row) => row.some((cell) => String(cell).trim())).length;
  if (sourceRows < 1) throw new Error("销售明细 Excel 没有数据行。");
  return { sheetName, headerRow: headerIndex + 1, sourceRows };
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json().catch(() => null) as ImportResponse | null;
  if (!response.ok || !body) throw new Error(body?.message ?? `接口请求失败：HTTP ${response.status}`);
  return body;
}

async function assertImportApiReady(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/imports/sales/verify?policyOnly=1`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response?.ok) {
    throw new Error(`运营管理系统销售导入接口不可用：${baseUrl}。请先启动系统。`);
  }
}

async function importSalesWorkbook(baseUrl: string, filePath: string, bytes: Uint8Array, timeoutMs: number) {
  const hash = createHash("sha256").update(bytes).digest("hex");
  const chunkSize = 2 * 1024 * 1024;
  const chunkCount = Math.ceil(bytes.byteLength / chunkSize);
  const init = await fetchJson(`${baseUrl}/api/imports/sales/chunks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "init", fileName: path.basename(filePath), fileSizeBytes: bytes.byteLength, chunkCount, fingerprint: hash }),
  }, timeoutMs) as ImportResponse & { upload?: { id: string; receivedChunkIndexes: number[] } };
  if (!init.ok || !init.upload?.id) throw new Error(init.message ?? "销售明细接口未创建上传会话。");
  const received = new Set(init.upload.receivedChunkIndexes ?? []);
  for (let index = 0; index < chunkCount; index += 1) {
    if (received.has(index)) continue;
    const response = await fetch(`${baseUrl}/api/imports/sales/chunks`, {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        "x-upload-id": init.upload.id,
        "x-chunk-index": String(index),
      },
      body: bytes.slice(index * chunkSize, Math.min((index + 1) * chunkSize, bytes.byteLength)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.json().catch(() => null) as ImportResponse | null;
    if (!response.ok || !body?.ok) throw new Error(body?.message ?? `销售明细第 ${index + 1} 个分片上传失败。`);
  }
  const completed = await fetchJson(`${baseUrl}/api/imports/sales/chunks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "complete", uploadId: init.upload.id }),
  }, timeoutMs);
  if (!completed.ok || !completed.batch) throw new Error(completed.message ?? "销售明细接口未返回导入批次。");
  return { hash, response: completed };
}

async function withRunLock<T>(outputRoot: string, task: () => Promise<T>) {
  await mkdir(outputRoot, { recursive: true });
  const lockPath = path.join(outputRoot, "erp-sales.lock");
  const handle = await open(lockPath, "wx").catch(() => null);
  if (!handle) throw new Error("已有 ERP 销售自动导入任务正在运行。");
  await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  await handle.close();
  try { return await task(); } finally { await rm(lockPath, { force: true }); }
}

async function login(config: AutomationConfig) {
  const context = await chromium.launchPersistentContext(resolveProjectPath(config.jackyun.profileDirectory), {
    executablePath: config.jackyun.chromePath,
    headless: false,
    acceptDownloads: true,
  });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(config.jackyun.startUrl, { waitUntil: "domcontentloaded", timeout: config.timeouts.pageMs });
    console.log("请在打开的 Chrome 中完成吉客云登录；检测到首页后窗口会自动关闭并保存登录状态。");
    await page.getByPlaceholder(config.jackyun.searchPlaceholder, { exact: true })
      .waitFor({ state: "visible", timeout: 24 * 60 * 60 * 1000 });
    console.log("吉客云登录状态已验证并保存。");
  } finally {
    await context.close();
  }
}

async function checkLogin(config: AutomationConfig) {
  const context = await chromium.launchPersistentContext(resolveProjectPath(config.jackyun.profileDirectory), {
    executablePath: config.jackyun.chromePath,
    headless: false,
    acceptDownloads: false,
  });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(config.jackyun.startUrl, { waitUntil: "domcontentloaded", timeout: config.timeouts.pageMs });
    const loggedIn = await page.getByPlaceholder(config.jackyun.searchPlaceholder, { exact: true })
      .waitFor({ state: "visible", timeout: config.timeouts.pageMs })
      .then(() => true)
      .catch(() => false);
    return { status: loggedIn ? "logged_in" : "not_logged_in" };
  } finally {
    await context.close();
  }
}

export async function runErpSalesAutomation(options: CliOptions) {
  const config = await readConfig(options.configPath);
  const today = shanghaiToday();
  if (options.checkLogin) return checkLogin(config);
  if (options.loginOnly) {
    await login(config);
    return { status: "login_completed" };
  }
  if (!options.forceWeekend && !isConfiguredWorkday(today, config.weekdays)) {
    return { status: "skipped", reason: "not_configured_workday", today };
  }
  const period = options.asOfDate
    ? { startDate: `${options.asOfDate.slice(0, 8)}01`, endDate: options.asOfDate }
    : salesPeriodForShanghaiDay(today);
  if (period.startDate > period.endDate) throw new Error("销售导出日期区间无效。");
  const outputRoot = resolveProjectPath(config.outputDirectory);
  const baseUrl = (options.baseUrl ?? config.baseUrl).replace(/\/$/, "");
  const runId = `${today.replace(/-/g, "")}-${Date.now()}`;
  const runDirectory = path.join(outputRoot, runId);
  await mkdir(runDirectory, { recursive: true });

  return withRunLock(outputRoot, async () => {
    const startedAt = new Date().toISOString();
    if (!options.dryRun) await assertImportApiReady(baseUrl);
    const context = await chromium.launchPersistentContext(resolveProjectPath(config.jackyun.profileDirectory), {
      executablePath: config.jackyun.chromePath,
      headless: !options.headed,
      acceptDownloads: true,
      downloadsPath: runDirectory,
    });
    try {
      const page = context.pages()[0] ?? await context.newPage();
      page.setDefaultTimeout(config.timeouts.pageMs);
      const frame = await openSalesLedger(page, config);
      const fieldChecks = await setSalesPeriod(frame, period);
      await queryOnce(frame, config.timeouts.queryMs);
      const pageSourceRows = await stableSourceRows(frame, config.timeouts.queryMs);
      const filePath = await exportSalesWorkbook(page, frame, runDirectory, period, config.timeouts.downloadMs);
      const bytes = new Uint8Array(await readFile(filePath));
      const workbook = validateSalesWorkbook(bytes);
      if (workbook.sourceRows !== pageSourceRows) {
        throw new Error(`页面与下载文件行数不一致：页面 ${pageSourceRows}，文件 ${workbook.sourceRows}。`);
      }
      const imported = options.dryRun ? null : await importSalesWorkbook(baseUrl, filePath, bytes, config.timeouts.importMs);
      const audit = {
        status: options.dryRun ? "downloaded" : "completed",
        runId,
        configVersion: config.version,
        startedAt,
        completedAt: new Date().toISOString(),
        period,
        fieldChecks,
        file: {
          path: filePath,
          bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          ...workbook,
        },
        import: imported?.response ?? null,
      };
      const auditPath = path.join(runDirectory, "audit.json");
      await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
      return { ...audit, auditPath };
    } finally {
      await context.close();
    }
  });
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  runErpSalesAutomation(parseCli())
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

export { xlsxMime };
