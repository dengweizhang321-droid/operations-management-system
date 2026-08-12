import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Locator, Page } from "playwright-core";

import { launchDedicatedChrome, waitForChrome } from "../lib/jackyun/cdp-client";
import { connectPlaywrightBrowser, connectPlaywrightJackyunTarget } from "../lib/jackyun/playwright-client";
import { readJsonFile, writeJsonAtomic } from "../lib/jackyun/json-file";
import { getJdStore } from "../lib/jd/store-registry";
import { assertJdProductDetailStoreIdentity, parseJdProductDetailStoreIdentity } from "../lib/jd/product-detail-store-identity";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetUrl = "https://jdsz.jd.com/szweb/view/industry/industry-product-rank-temp.html?sz=%2Fszweb%2Fsz%2Fview%2FindustryMarket%2FproductRanks.html";
const outputRoot = path.join(projectRoot, "outputs", "jd-market-ranking-daily");
const configPath = path.join(projectRoot, "config", "jd-market-ranking-daily.json");
const lockPath = path.join(outputRoot, "run.lock");
const capturedRankRequests = new WeakMap<Page, { headers: Record<string, string>; url: string; capturedAt: number }>();

export type JdMarketDailyConfig = {
  version: 1;
  enabled: boolean;
  storeKey: string;
  dimension: "SKU";
  categoryPath: [string, string];
  systemCategory: string;
  scope: string;
  priceBandFilter: string;
  earliestDate: string;
  requestDelayMs: number;
  maxDaysPerFile: number;
};

export type JdMarketDailyPlan = {
  version: 1;
  runId: string;
  ownerExecutionId: string;
  createdAt: string;
  updatedAt: string;
  baseUrl: string;
  stage: "planned" | "running" | "executed" | "completed" | "failed";
  storeKey: string;
  shopId: string;
  shopName: string;
  startDate: string;
  endDate: string;
  identity: { category: string; scope: string; rankingDimension: "SKU"; priceBandFilter: string };
  missingDates: string[];
  chunks: Array<{ startDate: string; endDate: string; dates: string[]; filePath?: string; fileHash?: string; fileSizeBytes?: number; batchId?: string; rowCount?: number }>;
  screenshots?: { filters?: string; exportPanel?: string; imported?: string };
  failure?: { stage: string; message: string; at: string };
};

type Coverage = { ok: boolean; presentDates: string[]; missingDates: string[]; cutoffDate: string | null; rowCounts: Record<string, number> };

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function shanghaiYesterday(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function inside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("市场榜单工作流只允许访问本机运营系统根地址");
  }
  return url.toString().replace(/\/$/, "");
}

export async function loadJdMarketDailyConfig() {
  const value = await readJsonFile<JdMarketDailyConfig>(configPath);
  if (value.version !== 1 || !value.enabled || value.dimension !== "SKU" || value.categoryPath.length !== 2
    || !value.categoryPath.every(Boolean) || !value.systemCategory || !value.scope || !validDate(value.earliestDate)
    || !Number.isInteger(value.requestDelayMs) || value.requestDelayMs < 300 || value.requestDelayMs > 10_000
    || !Number.isInteger(value.maxDaysPerFile) || value.maxDaysPerFile < 1 || value.maxDaysPerFile > 20) {
    throw new Error("京东市场商品榜单日补齐配置无效");
  }
  const store = await getJdStore(value.storeKey);
  if (!store.enabled) throw new Error("京东市场商品榜单受控店铺未启用");
  return value;
}

function coverageUrl(baseUrl: string, config: JdMarketDailyConfig, startDate: string, endDate: string) {
  const url = new URL("/api/market/daily-coverage", baseUrl);
  url.searchParams.set("category", config.systemCategory);
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("rankingDimension", config.dimension);
  url.searchParams.set("priceBandFilter", config.priceBandFilter);
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  return url;
}

async function readCoverage(baseUrl: string, config: JdMarketDailyConfig, startDate: string, endDate: string, request: typeof fetch = fetch) {
  const response = await request(coverageUrl(baseUrl, config, startDate, endDate), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => null) as Coverage | { error?: string } | null;
  if (!response.ok || !body || !("missingDates" in body)) throw new Error(`读取市场日覆盖失败：${body && "error" in body ? body.error : `HTTP ${response.status}`}`);
  return body as Coverage;
}

function chunksOfMissingDates(dates: string[], maxDays: number, cutoffDate: string) {
  const chunks: JdMarketDailyPlan["chunks"] = [];
  const readyDates = dates.at(-1) === cutoffDate ? dates.slice(0, -1) : dates;
  for (let index = 0; index < readyDates.length; index += maxDays) {
    const chunk = readyDates.slice(index, index + maxDays);
    chunks.push({ startDate: chunk[0]!, endDate: chunk.at(-1)!, dates: chunk });
  }
  if (dates.at(-1) === cutoffDate) chunks.push({ startDate: cutoffDate, endDate: cutoffDate, dates: [cutoffDate] });
  return chunks;
}

function planFile(plan: Pick<JdMarketDailyPlan, "runId">) {
  const file = path.join(outputRoot, `plan-${plan.runId}.json`);
  if (!inside(outputRoot, file) || !/^plan-[A-Za-z0-9._-]+\.json$/.test(path.basename(file))) throw new Error("市场榜单计划路径无效");
  return file;
}

async function persistPlan(plan: JdMarketDailyPlan) {
  plan.updatedAt = new Date().toISOString();
  await mkdir(outputRoot, { recursive: true });
  await writeJsonAtomic(planFile(plan), plan);
}

async function saveEvidenceScreenshot(page: Page, plan: JdMarketDailyPlan, name: "filters" | "exportPanel" | "imported") {
  const evidenceDirectory = path.join(outputRoot, plan.runId, "evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  const filePath = path.join(evidenceDirectory, `${name}.png`);
  if (!inside(evidenceDirectory, filePath)) throw new Error("市场榜单截图证据路径无效");
  await page.screenshot({ path: filePath, fullPage: false });
  (plan.screenshots ??= {})[name] = filePath;
  await persistPlan(plan);
  return filePath;
}

export async function planJdMarketDailyRun(options: { executionId: string; baseUrl?: string; now?: Date; request?: typeof fetch; runId?: string }) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(options.executionId)) throw new Error("n8n execution ID 无效");
  const config = await loadJdMarketDailyConfig();
  const store = await getJdStore(config.storeKey);
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.OPERATIONS_SYSTEM_URL ?? "http://localhost:3000");
  const endDate = shanghaiYesterday(options.now);
  const coverage = await readCoverage(baseUrl, config, config.earliestDate, endDate, options.request);
  const runId = options.runId ?? `jd-market-${randomUUID()}`;
  const plan: JdMarketDailyPlan = {
    version: 1, runId, ownerExecutionId: options.executionId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    baseUrl, stage: "planned", storeKey: store.storeKey, shopId: store.shopId, shopName: store.shopName,
    startDate: config.earliestDate, endDate,
    identity: { category: config.systemCategory, scope: config.scope, rankingDimension: "SKU", priceBandFilter: config.priceBandFilter },
    missingDates: coverage.missingDates,
    chunks: chunksOfMissingDates(coverage.missingDates, config.maxDaysPerFile, endDate),
  };
  await persistPlan(plan);
  return plan;
}

export function publicJdMarketPlan(plan: JdMarketDailyPlan) {
  return { ok: true, stage: "plan", runId: plan.runId, startDate: plan.startDate, endDate: plan.endDate, missingDateCount: plan.missingDates.length, chunkCount: plan.chunks.length };
}

async function assertStoreIdentity(page: Page, expected: { shopId: string; shopName: string }) {
  const links = page.locator('a[href*="mall.jd.com/index-"]').filter({ visible: true });
  await links.first().waitFor({ state: "visible", timeout: 30_000 });
  const candidates: Array<{ href: string | null; text: string }> = [];
  for (let index = 0; index < await links.count(); index += 1) {
    const link = links.nth(index);
    candidates.push({ href: await link.getAttribute("href"), text: await link.innerText() });
  }
  return assertJdProductDetailStoreIdentity(parseJdProductDetailStoreIdentity(candidates), expected);
}

async function installRequestCapture(page: Page) {
  page.on("request", (request) => {
    if (!/\/sz\/api\/industryMarket\/getProductBillBoardDealData\.ajax/.test(request.url())) return;
    capturedRankRequests.set(page, { url: request.url(), headers: request.headers(), capturedAt: Date.now() });
  });
  await page.addInitScript(() => {
    const target = window as typeof window & { __teruisiJdRank?: { headers: Record<string, string>; url: string; capturedAt: number } };
    const rawOpen = XMLHttpRequest.prototype.open;
    const rawHeader = XMLHttpRequest.prototype.setRequestHeader;
    const rawSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (...args: Parameters<XMLHttpRequest["open"]>) {
      const [, url] = args;
      (this as XMLHttpRequest & { __teruisiUrl?: string }).__teruisiUrl = String(url);
      return rawOpen.apply(this, args as never);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (...args: Parameters<XMLHttpRequest["setRequestHeader"]>) {
      const [key, value] = args;
      const request = this as XMLHttpRequest & { __teruisiHeaders?: Record<string, string> };
      (request.__teruisiHeaders ??= {})[key] = value;
      return rawHeader.apply(this, args as never);
    };
    XMLHttpRequest.prototype.send = function (...args: Parameters<XMLHttpRequest["send"]>) {
      const request = this as XMLHttpRequest & { __teruisiUrl?: string; __teruisiHeaders?: Record<string, string> };
      if (/\/sz\/api\/industryMarket\/getProductBillBoardDealData\.ajax/.test(request.__teruisiUrl ?? "") && request.__teruisiHeaders) {
        target.__teruisiJdRank = { headers: { ...request.__teruisiHeaders }, url: request.__teruisiUrl!, capturedAt: Date.now() };
      }
      return rawSend.apply(this, args as never);
    };
  });
}

async function triggerUniqueDropdownOption(surface: Locator, frame: Frame, label: string, action: "click" | "hover", control?: Locator) {
  const exactLabel = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidates = surface.locator(".jmtd-dropdown-option").filter({ visible: true }).filter({ hasText: exactLabel });
    if (await candidates.count() === 1) {
      const applied = action === "hover"
        ? await candidates.first().hover({ timeout: 3_000, force: true }).then(() => true).catch(() => false)
        : await candidates.first().click({ timeout: 3_000, force: true }).then(() => true).catch(() => false);
      if (applied) return;
    }
    if (await candidates.count() === 0 && control) await control.click().catch(() => undefined);
    await frame.waitForTimeout(100);
  }
  throw new Error(`京东商品榜单下拉选项无法唯一定位：${label}`);
}

async function clickUniqueDropdownOption(surface: Locator, frame: Frame, label: string, control?: Locator) {
  await triggerUniqueDropdownOption(surface, frame, label, "click", control);
}

async function hoverUniqueDropdownOption(surface: Locator, frame: Frame, label: string, control?: Locator) {
  await triggerUniqueDropdownOption(surface, frame, label, "hover", control);
}

async function waitForSelectorText(surface: Locator, frame: Frame, index: number, expected: string, exact: boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const controls = surface.locator(".jmtd-base-input-top").filter({ visible: true });
    const actual = (await controls.nth(index).innerText().catch(() => "")).trim();
    if (exact ? actual === expected : actual.includes(expected)) return;
    await frame.waitForTimeout(100);
  }
  throw new Error(`京东商品榜单筛选未生效：${expected}`);
}

function activeExportPanel(frame: Frame) {
  return frame.locator("xpath=//*[@id='jdsz-export-panel' and not(ancestor::*[@id='sz-old-version'])]");
}

async function waitForRankingSurface(frame: Frame) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const surfaces = frame.locator("#sz-old-version").filter({ visible: true });
    if (await surfaces.count() === 1 && await surfaces.first().locator(".jmtd-base-input-top").filter({ visible: true }).count() >= 3) return surfaces.first();
    await frame.waitForTimeout(100);
  }
  throw new Error("京东商品榜单受控业务容器未就绪或不唯一");
}

async function selectRankingIdentity(page: Page, config: JdMarketDailyConfig) {
  const frame = page.frames().find((candidate) => /productRanks\.html/.test(candidate.url()));
  if (!frame) throw new Error("未找到京东商品榜单业务框架");
  const surface = await waitForRankingSurface(frame);
  const selectors = surface.locator(".jmtd-base-input-top").filter({ visible: true });
  await selectors.first().waitFor({ state: "visible", timeout: 30_000 });
  if (await selectors.count() < 3) throw new Error("京东商品榜单筛选控件不完整");
  const currentDimension = (await selectors.nth(0).innerText()).trim();
  if (currentDimension !== "SKU") {
    await clickUniqueDropdownOption(surface, frame, "SKU", selectors.nth(0));
    await waitForSelectorText(surface, frame, 0, "SKU", true);
  }
  const categoryLabel = config.categoryPath.join(" > ");
  if (!(await selectors.nth(1).innerText()).includes(categoryLabel)) {
    await hoverUniqueDropdownOption(surface, frame, config.categoryPath[0], selectors.nth(1));
    await clickUniqueDropdownOption(surface, frame, config.categoryPath[1]);
    await waitForSelectorText(surface, frame, 1, categoryLabel, false);
  }
  await frame.waitForTimeout(1_000);
  const labels = await selectors.allTextContents();
  if (labels[0]?.trim() !== "SKU" || !labels[1]?.includes(categoryLabel)) throw new Error("京东商品榜单 SKU 或类目选择未精确生效");
  const exportPanel = activeExportPanel(frame);
  if (await exportPanel.count() !== 1) throw new Error("京东商品榜单当前版本导出增强面板不唯一");
  await exportPanel.waitFor({ state: "visible", timeout: 10_000 });
  const dayGranularity = exportPanel.locator('input[name="jdsz-gran"][value="day"]');
  await dayGranularity.check();
  if (!(await dayGranularity.isChecked())) throw new Error("京东商品榜单导出增强未切换到按日");
  let value: { url: string; headers: Record<string, string>; capturedAt: number } | undefined;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const candidate = capturedRankRequests.get(page);
    if (candidate?.url.includes("unitType=1")) { value = candidate; break; }
    await frame.waitForTimeout(100);
  }
  if (!value) throw new Error("未捕获到京东商品榜单 SKU 原生请求");
  const params = new URL(value.url, targetUrl).searchParams;
  if (params.get("unitType") !== "1") throw new Error("捕获到的榜单请求不是 SKU 维度");
  await frame.evaluate((captured) => {
    (window as typeof window & { __teruisiJdRank?: typeof captured }).__teruisiJdRank = captured;
  }, value);
  return frame;
}

type RankBlock = { metaIndex: Record<string, number>; data: unknown[][] };

async function fetchRankDay(frame: Page | import("playwright-core").Frame, date: string): Promise<RankBlock> {
  return await frame.evaluate(async (targetDate) => {
    const target = window as typeof window & { __teruisiJdRank?: { headers: Record<string, string>; url: string; capturedAt: number } };
    const state = target.__teruisiJdRank;
    if (!state || Date.now() - state.capturedAt > 60 * 60_000) throw new Error("榜单请求头缺失或已过期");
    const url = new URL(state.url, location.origin);
    url.searchParams.set("date", targetDate.replaceAll("-", ""));
    url.searchParams.set("startDate", targetDate);
    url.searchParams.set("endDate", targetDate);
    const response = await fetch(url, { credentials: "include", headers: state.headers });
    const body = await response.json();
    const block = body?.content?.trade;
    if (!response.ok || !block?.metaIndex || !Array.isArray(block.data)) throw new Error("京东榜单接口未返回可验证的交易榜单数据");
    return block as RankBlock;
  }, date);
}

async function fetchImages(frame: Page | import("playwright-core").Frame, skuIds: string[]) {
  const result: Record<string, { imageUrl: string; productUrl: string }> = {};
  for (let index = 0; index < skuIds.length; index += 50) {
    const chunk = skuIds.slice(index, index + 50);
    const rows = await frame.evaluate(async (ids) => {
      const target = window as typeof window & { __teruisiJdRank?: { headers: Record<string, string> } };
      const response = await fetch(`/sz/api/industry/getImageURL.ajax?ids=${ids.join(",")}`, { credentials: "include", headers: target.__teruisiJdRank?.headers ?? {} });
      const body = await response.json();
      if (!response.ok) throw new Error("京东商品图片接口请求失败");
      return Array.isArray(body?.content?.data) ? body.content.data as Array<{ skuId: string | number; imgSrc?: string; proUrl?: string }> : [];
    }, chunk);
    for (const row of rows) {
      const imageUrl = String(row.imgSrc ?? "").replace(/^\/\//, "https://").replace(/\/n\d+\//, "/imgzone/");
      const productUrl = String(row.proUrl ?? "").split("?")[0]!.replace(/^\/\//, "https://");
      result[String(row.skuId)] = { imageUrl, productUrl };
    }
  }
  return result;
}

function displayMetric(value: unknown) {
  if (!value || typeof value !== "object") return value == null ? "" : String(value);
  const item = value as Record<string, unknown>;
  return `${item.leftPrefix ?? ""}${item.left ?? ""}${item.leftUnit ?? ""}${item.separator ?? ""}${item.rightPrefix ?? ""}${item.right ?? ""}${item.rightUnit ?? ""}`;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(config: JdMarketDailyConfig, results: Array<{ date: string; block: RankBlock }>, images: Record<string, { imageUrl: string; productUrl: string }>) {
  const header = ["period_start", "period_end", "category", "scope", "dimension", "rank", "sku_code", "product_name", "gmv", "quantity", "visitors", "search_clicks", "image_url", "product_url"];
  const rows: unknown[][] = [header];
  for (const { date, block } of results) {
    const meta = block.metaIndex;
    for (const row of block.data) {
      const get = (key: string) => meta[key] === undefined ? "" : row[meta[key]!];
      const sku = String(get("skuId"));
      rows.push([
        date, date, config.systemCategory, config.scope, "SKU", displayMetric(get("OrdAmtIndexRank")), sku,
        displayMetric(get("ProName")), displayMetric(get("OrdAmtIndex")), displayMetric(get("OrdNumIndex")),
        displayMetric(get("UVIndex")), displayMetric(get("SearchClickIndex")), images[sku]?.imageUrl ?? "",
        images[sku]?.productUrl || `https://item.jd.com/${sku}.html`,
      ]);
    }
  }
  return new TextEncoder().encode(`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`);
}

async function importCsv(plan: JdMarketDailyPlan, config: JdMarketDailyConfig, chunk: JdMarketDailyPlan["chunks"][number], filePath: string) {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "text/csv;charset=utf-8" }), path.basename(filePath));
  form.set("sourceType", "market_ranking");
  form.set("periodStart", chunk.startDate);
  form.set("periodEnd", chunk.endDate);
  form.set("category", config.systemCategory);
  form.set("scope", config.scope);
  form.set("priceBandFilter", config.priceBandFilter);
  const response = await fetch(`${plan.baseUrl}/api/market/import`, { method: "POST", body: form, signal: AbortSignal.timeout(300_000) });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !body || !["imported", "duplicate"].includes(String(body.status))) throw new Error(`市场榜单导入失败：${String(body?.error ?? `HTTP ${response.status}`)}`);
  const batch = body.batch as Record<string, unknown> | undefined;
  if (batch?.status !== "completed" || Number(batch.rowCount ?? 0) <= 0) throw new Error("市场榜单导入未返回已完成的非空批次");
  return { batchId: String(batch.id), rowCount: Number(batch.rowCount) };
}

async function withRunLock<T>(task: () => Promise<T>) {
  await mkdir(outputRoot, { recursive: true });
  const handle = await open(lockPath, "wx").catch(() => null);
  if (!handle) throw new Error("已有京东市场商品榜单补齐任务运行中");
  await handle.close();
  try { return await task(); } finally { await rm(lockPath, { force: true }); }
}

export async function runJdMarketDailyPlan(plan: JdMarketDailyPlan) {
  return withRunLock(async () => {
    const config = await loadJdMarketDailyConfig();
    const store = await getJdStore(plan.storeKey);
    if (plan.stage === "executed" || plan.stage === "completed") return { ok: true, stage: "run", verificationOnly: true, runId: plan.runId };
    if (plan.stage !== "planned" || store.shopId !== plan.shopId || store.shopName !== plan.shopName) throw new Error("市场榜单计划状态或店铺身份无效");
    if (!plan.chunks.length) { plan.stage = "executed"; await persistPlan(plan); return { ok: true, stage: "run", runId: plan.runId, importedFiles: 0 }; }
    plan.stage = "running"; await persistPlan(plan);
    let browser: Awaited<ReturnType<typeof connectPlaywrightBrowser>> | null = null;
    try {
      await launchDedicatedChrome({
        executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        profileDirectory: store.browser.profileDir, port: store.browser.debugPort, startUrl: "about:blank",
        headless: false, visible: false, startMinimized: true,
      });
      await waitForChrome(store.browser.debugPort);
      browser = await connectPlaywrightBrowser(store.browser.debugPort);
      const { page } = await connectPlaywrightJackyunTarget(browser, { workerName: "teruisi-jd-market-ranking", targetUrlPattern: /jdsz\.jd\.com/i, requireMini: false });
      await installRequestCapture(page);
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await assertStoreIdentity(page, plan);
      const frame = await selectRankingIdentity(page, config);
      await saveEvidenceScreenshot(page, plan, "filters");
      const runDirectory = path.join(outputRoot, plan.runId);
      await mkdir(runDirectory, { recursive: true });
      if (plan.chunks.length) {
        const exportPanel = activeExportPanel(frame);
        if (await exportPanel.count() !== 1) throw new Error("京东商品榜单当前版本导出增强面板不唯一");
        const fromInput = exportPanel.locator("#jdsz-from");
        const toInput = exportPanel.locator("#jdsz-to");
        const startDate = plan.chunks[0]!.startDate;
        const endDate = plan.chunks.at(-1)!.endDate;
        await fromInput.fill(startDate);
        await toInput.fill(endDate);
        if (await fromInput.inputValue() !== startDate || await toInput.inputValue() !== endDate) {
          throw new Error("京东商品榜单导出增强日期未精确生效");
        }
        await saveEvidenceScreenshot(page, plan, "exportPanel");
      }
      for (const chunk of plan.chunks) {
        if (chunk.batchId) continue;
        const results: Array<{ date: string; block: RankBlock }> = [];
        for (const date of chunk.dates) {
          results.push({ date, block: await fetchRankDay(frame, date) });
          await frame.waitForTimeout(config.requestDelayMs);
        }
        const first = results[0]?.block;
        const emptyDate = results.find((result) => result.block.data.length === 0)?.date;
        if (emptyDate === plan.endDate) {
          throw new Error(`京东商智昨日数据尚未开放：${emptyDate}；已按安全规则停止，未缩短日期范围或导入空集合`);
        }
        if (!first || emptyDate || !results.every((result) => result.block.data.length <= 200)) throw new Error("京东商品榜单返回空日或超过 SKU 榜单行数上限");
        const skuIds = [...new Set(results.flatMap(({ block }) => block.data.map((row) => String(row[block.metaIndex.skuId!]))))];
        const images = await fetchImages(frame, skuIds);
        const bytes = buildCsv(config, results, images);
        const fileName = `京东商智_交易榜单_SKU_${config.systemCategory}_${chunk.startDate}至${chunk.endDate}.csv`;
        const filePath = path.join(runDirectory, fileName);
        if (!inside(runDirectory, filePath)) throw new Error("市场榜单下载文件路径越界");
        await writeFile(filePath, bytes);
        chunk.filePath = filePath;
        chunk.fileHash = createHash("sha256").update(bytes).digest("hex");
        chunk.fileSizeBytes = bytes.byteLength;
        await persistPlan(plan);
        const imported = await importCsv(plan, config, chunk, filePath);
        chunk.batchId = imported.batchId;
        chunk.rowCount = imported.rowCount;
        await persistPlan(plan);
      }
      await saveEvidenceScreenshot(page, plan, "imported");
      plan.stage = "executed"; delete plan.failure; await persistPlan(plan);
      return { ok: true, stage: "run", runId: plan.runId, importedFiles: plan.chunks.length, rowCount: plan.chunks.reduce((sum, chunk) => sum + Number(chunk.rowCount ?? 0), 0) };
    } catch (error) {
      plan.stage = "failed";
      plan.failure = { stage: "run", message: (error instanceof Error ? error.message : String(error)).slice(0, 1000), at: new Date().toISOString() };
      await persistPlan(plan);
      throw error;
    } finally {
      await browser?.close().catch(() => undefined);
    }
  });
}

export async function verifyJdMarketDailyPlan(plan: JdMarketDailyPlan, request: typeof fetch = fetch) {
  const config = await loadJdMarketDailyConfig();
  if (plan.stage === "completed") return { ok: true, stage: "verify", runId: plan.runId, missingAfterImport: [] };
  if (plan.stage !== "executed") throw new Error("市场榜单计划尚未进入可核验阶段");
  for (const chunk of plan.chunks) {
    if (!chunk.batchId || !chunk.fileHash || !chunk.filePath || !chunk.fileSizeBytes || !chunk.rowCount) throw new Error("市场榜单计划缺少完整文件或导入批次证据");
    const bytes = await readFile(chunk.filePath);
    const fileInfo = await stat(chunk.filePath);
    if (!fileInfo.isFile() || fileInfo.size !== chunk.fileSizeBytes || createHash("sha256").update(bytes).digest("hex") !== chunk.fileHash) {
      throw new Error("市场榜单签收文件缺失、大小变化或 SHA-256 不匹配");
    }
  }
  const coverage = await readCoverage(plan.baseUrl, config, plan.startDate, plan.endDate, request);
  const missingAfterImport = plan.missingDates.filter((date) => coverage.missingDates.includes(date));
  if (missingAfterImport.length) throw new Error(`市场榜单导入后仍缺少 ${missingAfterImport.length} 个目标日`);
  plan.stage = "completed"; delete plan.failure; await persistPlan(plan);
  return { ok: true, stage: "verify", runId: plan.runId, importedDateCount: plan.missingDates.length, missingAfterImport };
}

export function jdMarketHelperRequestError(stage: string, busy: boolean, route: string, requestExecutionId: string | null, claimedExecutionId: string | null) {
  if (!requestExecutionId) return { error: "missing_or_invalid_execution_id" as const };
  if (claimedExecutionId && requestExecutionId !== claimedExecutionId) return { error: "execution_mismatch" as const };
  if (!claimedExecutionId && route !== "/jd-market/plan") return { error: "execution_not_claimed" as const, expected: "/jd-market/plan" as const };
  if (busy) return { error: "pipeline_busy" as const };
  const expected = route === "/jd-market/plan" ? "ready" : route === "/jd-market/run" ? "planned" : "executed";
  return stage === expected ? null : { error: "invalid_stage" as const, expected, actual: stage };
}
