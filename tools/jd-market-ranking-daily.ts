import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Locator, Page } from "playwright-core";

import { closeChromeBrowser, launchDedicatedChrome, waitForChrome } from "../lib/jackyun/cdp-client";
import { connectPlaywrightBrowser, connectPlaywrightJackyunTarget } from "../lib/jackyun/playwright-client";
import { readJsonFile, writeJsonAtomic } from "../lib/jackyun/json-file";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { getJdStore } from "../lib/jd/store-registry";
import { withJdChromiumRunLock } from "../lib/jd/chromium-run-lock";
import { assertJdProductDetailStoreIdentity, parseJdProductDetailStoreIdentity } from "../lib/jd/product-detail-store-identity";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetUrl = "https://jdsz.jd.com/szweb/view/industry/industry-product-rank-temp.html?sz=%2Fszweb%2Fsz%2Fview%2FindustryMarket%2FproductRanks.html";
const outputRoot = path.join(projectRoot, "outputs", "jd-market-ranking-daily");
const configPath = path.join(projectRoot, "config", "jd-market-ranking-daily.json");
const lockPath = path.join(outputRoot, "run.lock");
const coverageRequestTimeoutMs = 120_000;
const importRequestTimeoutMs = 900_000;
const capturedRankRequests = new WeakMap<Page, { headers: Record<string, string>; url: string; capturedAt: number }>();
const capturedImageRequests = new WeakMap<Page, { headers: Record<string, string>; capturedAt: number }>();
const replayableHeaderNames = new Set(["accept", "p-pin", "user-mnp", "user-mup", "uuid", "x-requested-with"]);

export type JdMarketDailyCategoryConfig = {
  key: string;
  categoryPath: [string, string];
  systemCategory: string;
};

export type JdMarketDailyConfig = {
  version: 3;
  enabled: boolean;
  storeKey: string;
  silentNoWindow: true;
  dimension: "SKU";
  categories: JdMarketDailyCategoryConfig[];
  scope: string;
  priceBandFilter: string;
  earliestDate: string;
  requestDelayMs: number;
  maxDaysPerFile: number;
};

type JdMarketDailyChunk = { startDate: string; endDate: string; dates: string[]; filePath?: string; fileHash?: string; fileSizeBytes?: number; batchId?: string; rowCount?: number };

export type JdMarketDailyTargetPlan = {
  key: string;
  categoryPath: [string, string];
  identity: { category: string; scope: string; rankingDimension: "SKU"; priceBandFilter: string };
  missingDates: string[];
  chunks: JdMarketDailyChunk[];
  screenshots?: { filters?: string; exportPanel?: string; imported?: string };
  evidenceWarnings?: string[];
};

export type JdMarketDailyPlan = {
  version: 3;
  runId: string;
  ownerExecutionId: string;
  createdAt: string;
  updatedAt: string;
  baseUrl: string;
  silentNoWindow: boolean;
  stage: "planned" | "running" | "executed" | "completed" | "failed";
  storeKey: string;
  shopId: string;
  shopName: string;
  browserProfileName: string;
  browserDebugPort: number;
  startDate: string;
  endDate: string;
  targets: JdMarketDailyTargetPlan[];
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

export function validateJdMarketDailyConfig(value: unknown): JdMarketDailyConfig {
  const config = value as Partial<JdMarketDailyConfig>;
  const categories = Array.isArray(config.categories) ? config.categories : [];
  const categoryKeys = categories.map((target) => target?.key);
  const systemCategories = categories.map((target) => target?.systemCategory);
  const categoryPaths = categories.map((target) => JSON.stringify(target?.categoryPath));
  if (config.version !== 3 || !config.enabled || config.silentNoWindow !== true || config.dimension !== "SKU" || categories.length !== 5
    || categories.some((target) => !target || !/^[a-z0-9-]{1,80}$/.test(target.key)
      || !Array.isArray(target.categoryPath) || target.categoryPath.length !== 2 || !target.categoryPath.every(Boolean) || !target.systemCategory)
    || new Set(categoryKeys).size !== categories.length || new Set(systemCategories).size !== categories.length || new Set(categoryPaths).size !== categories.length
    || !config.storeKey || config.scope !== "pop" || config.priceBandFilter !== "全部" || !validDate(String(config.earliestDate ?? ""))
    || !Number.isInteger(config.requestDelayMs) || Number(config.requestDelayMs) < 300 || Number(config.requestDelayMs) > 10_000
    || !Number.isInteger(config.maxDaysPerFile) || Number(config.maxDaysPerFile) < 1 || Number(config.maxDaysPerFile) > 20) {
    throw new Error("京东市场商品榜单日补齐配置无效");
  }
  return config as JdMarketDailyConfig;
}

export async function loadJdMarketDailyConfig() {
  const value = validateJdMarketDailyConfig(await readJsonFile<unknown>(configPath));
  const store = await getJdStore(value.storeKey);
  if (!store.enabled) throw new Error("京东市场商品榜单受控店铺未启用");
  return value;
}

function coverageUrl(baseUrl: string, config: JdMarketDailyConfig, target: JdMarketDailyCategoryConfig, startDate: string, endDate: string) {
  const url = new URL("/api/market/daily-coverage", baseUrl);
  url.searchParams.set("category", target.systemCategory);
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("rankingDimension", config.dimension);
  url.searchParams.set("priceBandFilter", config.priceBandFilter);
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  return url;
}

async function readCoverage(baseUrl: string, config: JdMarketDailyConfig, target: JdMarketDailyCategoryConfig, startDate: string, endDate: string, request: typeof fetch = fetch) {
  const response = await request(coverageUrl(baseUrl, config, target, startDate, endDate), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(coverageRequestTimeoutMs) });
  const body = await response.json().catch(() => null) as Coverage | { error?: string } | null;
  if (!response.ok || !body || !("missingDates" in body)) throw new Error(`读取市场日覆盖失败：${body && "error" in body ? body.error : `HTTP ${response.status}`}`);
  return body as Coverage;
}

function chunksOfMissingDates(dates: string[], maxDays: number, cutoffDate: string) {
  const chunks: JdMarketDailyChunk[] = [];
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

async function saveEvidenceScreenshot(page: Page, plan: JdMarketDailyPlan, target: JdMarketDailyTargetPlan, name: "filters" | "exportPanel" | "imported") {
  const evidenceDirectory = path.join(outputRoot, plan.runId, "evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  const filePath = path.join(evidenceDirectory, `${target.key}-${name}.png`);
  if (!inside(evidenceDirectory, filePath)) throw new Error("市场榜单截图证据路径无效");
  try {
    await page.screenshot({ path: filePath, fullPage: false, timeout: 30_000, animations: "disabled" });
    (target.screenshots ??= {})[name] = filePath;
  } catch (error) {
    await rm(filePath, { force: true });
    const message = error instanceof Error ? error.message.split("\n", 1)[0] : String(error);
    (target.evidenceWarnings ??= []).push(`${name}:${message.slice(0, 300)}`);
  }
  await persistPlan(plan);
  return target.screenshots?.[name] ?? null;
}

export async function planJdMarketDailyRun(options: { executionId: string; baseUrl?: string; now?: Date; request?: typeof fetch; runId?: string; silentNoWindow?: boolean }) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(options.executionId)) throw new Error("n8n execution ID 无效");
  const config = await loadJdMarketDailyConfig();
  const store = await getJdStore(config.storeKey);
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.OPERATIONS_SYSTEM_URL ?? "http://localhost:3000");
  const endDate = shanghaiYesterday(options.now);
  const runId = options.runId ?? `jd-market-${randomUUID()}`;
  const targets: JdMarketDailyTargetPlan[] = [];
  for (const target of config.categories) {
    const coverage = await readCoverage(baseUrl, config, target, config.earliestDate, endDate, options.request);
    targets.push({
      key: target.key,
      categoryPath: target.categoryPath,
      identity: { category: target.systemCategory, scope: config.scope, rankingDimension: "SKU", priceBandFilter: config.priceBandFilter },
      missingDates: coverage.missingDates,
      chunks: chunksOfMissingDates(coverage.missingDates, config.maxDaysPerFile, endDate),
    });
  }
  const plan: JdMarketDailyPlan = {
    version: 3, runId, ownerExecutionId: options.executionId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    baseUrl, silentNoWindow: config.silentNoWindow || options.silentNoWindow === true, stage: "planned",
    storeKey: store.storeKey, shopId: store.shopId, shopName: store.shopName,
    browserProfileName: store.browser.profileName, browserDebugPort: store.browser.debugPort,
    startDate: config.earliestDate, endDate,
    targets,
  };
  await persistPlan(plan);
  return plan;
}

export function publicJdMarketPlan(plan: JdMarketDailyPlan) {
  return {
    ok: true, stage: "plan", runId: plan.runId, silentNoWindow: plan.silentNoWindow, startDate: plan.startDate, endDate: plan.endDate,
    targetCount: plan.targets.length,
    pendingTargetCount: plan.targets.filter((target) => target.chunks.length > 0).length,
    missingDateCount: plan.targets.reduce((sum, target) => sum + target.missingDates.length, 0),
    chunkCount: plan.targets.reduce((sum, target) => sum + target.chunks.length, 0),
    categories: plan.targets.map((target) => ({ key: target.key, category: target.identity.category, missingDateCount: target.missingDates.length, chunkCount: target.chunks.length })),
  };
}

async function assertStoreIdentity(page: Page, expected: { shopId: string; shopName: string }) {
  const links = page.locator('.user-info .shop-name a[href*="mall.jd.com/index-"]').filter({ visible: true });
  await links.first().waitFor({ state: "visible", timeout: 30_000 });
  const candidates: Array<{ href: string | null; text: string }> = [];
  for (let index = 0; index < await links.count(); index += 1) {
    const link = links.nth(index);
    candidates.push({ href: await link.getAttribute("href"), text: await link.innerText() });
  }
  return assertJdProductDetailStoreIdentity(parseJdProductDetailStoreIdentity(candidates), expected);
}

export function jdMarketReplayableHeaders(headers: Record<string, string>) {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => replayableHeaderNames.has(name.toLowerCase())));
}

async function installRequestCapture(page: Page) {
  page.on("request", (request) => {
    const headers = jdMarketReplayableHeaders(request.headers());
    if (/\/sz\/api\/industry\/getImageURL\.ajax/.test(request.url())) {
      capturedImageRequests.set(page, { headers, capturedAt: Date.now() });
      return;
    }
    if (!/\/sz\/api\/industryMarket\/getProductBillBoardDealData\.ajax/.test(request.url())) return;
    capturedRankRequests.set(page, { url: request.url(), headers, capturedAt: Date.now() });
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
  let lastCandidateCount = 0;
  let lastVisibleLabels: string[] = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidates = surface.locator(".jmtd-dropdown-option").filter({ visible: true }).filter({ hasText: exactLabel });
    lastCandidateCount = await candidates.count();
    if (lastCandidateCount === 1) {
      const applied = action === "hover"
        ? await candidates.first().hover({ timeout: 3_000, force: true }).then(() => true).catch(() => false)
        : await candidates.first().click({ timeout: 3_000, force: true }).then(() => true).catch(() => false);
      if (applied) return;
    }
    if (lastCandidateCount === 0 && control) await control.click().catch(() => undefined);
    if (attempt === 99) {
      lastVisibleLabels = (await surface.locator(".jmtd-dropdown-option").filter({ visible: true }).allTextContents())
        .map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40);
    }
    await frame.waitForTimeout(100);
  }
  throw new Error(`京东商品榜单下拉选项无法唯一定位：${label}；候选=${lastCandidateCount}；可见选项=${lastVisibleLabels.join("|").slice(0, 600)}`);
}

async function clickUniqueDropdownOption(surface: Locator, frame: Frame, label: string, control?: Locator) {
  await triggerUniqueDropdownOption(surface, frame, label, "click", control);
}

async function selectUniqueCategoryPath(surface: Locator, frame: Frame, control: Locator, categoryPath: [string, string]) {
  const exact = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  let parentCount = 0;
  let childCount = 0;
  let revealedChildCount = 0;
  let submenuScrolls = 0;
  let controlClicks = 0;
  let lastControlError = "";
  let controlEvidence = "";
  let lastMenuEvidence = "";
  let lastVisibleLabels: string[] = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    let parents = surface.locator(".jmtd-dropdown-option").filter({ visible: true }).filter({ hasText: exact(categoryPath[0]) });
    parentCount = await parents.count();
    if (parentCount === 0) {
      const clicked = await control.click({ timeout: 3_000, force: true })
        .then(() => true)
        .catch((error) => {
          lastControlError = (error instanceof Error ? error.message : String(error)).split("\n", 1)[0]!.slice(0, 240);
          return false;
        });
      if (clicked) controlClicks += 1;
      for (let waitAttempt = 0; waitAttempt < 10; waitAttempt += 1) {
        await frame.waitForTimeout(100);
        parents = surface.locator(".jmtd-dropdown-option").filter({ visible: true }).filter({ hasText: exact(categoryPath[0]) });
        parentCount = await parents.count();
        if (parentCount > 0) break;
      }
    }
    if (parentCount === 1) {
      const hovered = await parents.first().hover({ timeout: 3_000, force: true }).then(() => true).catch(() => false);
      if (hovered) {
        for (let scrollAttempt = 0; scrollAttempt < 20; scrollAttempt += 1) {
          await frame.waitForTimeout(150);
          const children = surface.locator(".jmtd-dropdown-option").filter({ hasText: exact(categoryPath[1]) });
          childCount = await children.count();
          const revealedChildren: Locator[] = [];
          for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
            const child = children.nth(childIndex);
            const revealed = await child.scrollIntoViewIfNeeded({ timeout: 1_000 })
              .then(() => child.isVisible()).catch(() => false);
            if (revealed) revealedChildren.push(child);
          }
          revealedChildCount = revealedChildren.length;
          if (revealedChildCount === 1) {
            const clicked = await revealedChildren[0]!.click({ timeout: 3_000, force: true }).then(() => true).catch(() => false);
            if (clicked) return;
          }
          const visibleOptions = surface.locator(".jmtd-dropdown-option").filter({ visible: true });
          const visibleOptionCount = await visibleOptions.count();
          if (visibleOptionCount > 1) {
            const menu = await visibleOptions.last().evaluate((element) => {
              const ancestors: Array<Record<string, unknown>> = [];
              let current: HTMLElement | null = element as HTMLElement;
              for (let depth = 0; current && current !== document.body && depth < 6; depth += 1) {
                const box = current.getBoundingClientRect();
                ancestors.push({
                  tag: current.tagName,
                  className: String(current.className).slice(0, 100),
                  client: [current.clientWidth, current.clientHeight],
                  scroll: [current.scrollWidth, current.scrollHeight],
                  box: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
                });
                current = current.parentElement;
              }
              return ancestors;
            }).catch(() => []);
            if (menu.length) lastMenuEvidence = JSON.stringify(menu).slice(0, 650);
          }
          const submenuBox = visibleOptionCount > 1 ? await visibleOptions.last().boundingBox().catch(() => null) : null;
          if (!submenuBox) break;
          await frame.page().mouse.move(
            submenuBox.x + submenuBox.width / 2,
            submenuBox.y + submenuBox.height / 2,
            { steps: 10 },
          );
          await frame.page().mouse.wheel(0, 60);
          await frame.waitForTimeout(50);
          await frame.page().mouse.wheel(0, -10_000);
          submenuScrolls += 1;
        }
      }
    }
    if (attempt === 29) {
      lastVisibleLabels = (await surface.locator(".jmtd-dropdown-option").filter({ visible: true }).allTextContents())
        .map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40);
      const evidence = await control.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return {
          control: `${element.tagName}.${element.className}`.slice(0, 180),
          hit: hit ? `${hit.tagName}.${hit.className}`.slice(0, 180) : "",
          box: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
        };
      }).catch(() => null);
      const totalOptions = await surface.locator(".jmtd-dropdown-option").count().catch(() => -1);
      const lastVisibleOption = surface.locator(".jmtd-dropdown-option").filter({ visible: true }).last();
      const menu = await lastVisibleOption.evaluate((element) => {
        const ancestors: Array<Record<string, unknown>> = [];
        let current: HTMLElement | null = element as HTMLElement;
        for (let depth = 0; current && current !== document.body && depth < 6; depth += 1) {
          const box = current.getBoundingClientRect();
          ancestors.push({
            tag: current.tagName,
            className: String(current.className).slice(0, 100),
            client: [current.clientWidth, current.clientHeight],
            scroll: [current.scrollWidth, current.scrollHeight],
            box: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
          });
          current = current.parentElement;
        }
        return ancestors;
      }).catch(() => []);
      controlEvidence = JSON.stringify({ totalOptions, evidence, menu }).slice(0, 850);
    }
    await frame.waitForTimeout(100);
  }
  throw new Error(`京东商品榜单二级类目无法原子选择：${categoryPath.join(" > ")}；父候选=${parentCount}；子候选=${childCount}；可滚动可见子项=${revealedChildCount}；子菜单滚动=${submenuScrolls}；控件点击=${controlClicks}；点击错误=${lastControlError || "无"}；菜单证据=${lastMenuEvidence || "无"}；控件证据=${controlEvidence}；可见选项=${lastVisibleLabels.join("|").slice(0, 400)}`);
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

async function selectRankingIdentity(page: Page, config: JdMarketDailyConfig, target: JdMarketDailyCategoryConfig) {
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
  const categoryLabel = target.categoryPath.join(" > ");
  const currentCategory = (await selectors.nth(1).innerText()).trim();
  if (currentCategory.includes(categoryLabel)) {
    const alternate = config.categories.find((candidate) => candidate.key !== target.key);
    if (!alternate) throw new Error("京东商品榜单缺少用于刷新同类目请求的受控备用类目");
    await selectUniqueCategoryPath(surface, frame, selectors.nth(1), alternate.categoryPath);
    await waitForSelectorText(surface, frame, 1, alternate.categoryPath.join(" > "), false);
  }
  const categorySelectionStartedAt = Date.now();
  capturedRankRequests.delete(page);
  capturedImageRequests.delete(page);
  await selectUniqueCategoryPath(surface, frame, selectors.nth(1), target.categoryPath);
  await waitForSelectorText(surface, frame, 1, categoryLabel, false);
  await frame.waitForTimeout(1_000);
  const labels = await selectors.allTextContents();
  if (labels[0]?.trim() !== "SKU" || !labels[1]?.includes(categoryLabel)) throw new Error("京东商品榜单 SKU 或类目选择未精确生效");
  const exportPanel = activeExportPanel(frame);
  const exportPanelCount = await exportPanel.count();
  if (exportPanelCount > 1) throw new Error("京东商品榜单当前版本导出增强面板不唯一");
  if (exportPanelCount === 1) {
    await exportPanel.waitFor({ state: "visible", timeout: 10_000 });
    const dayGranularity = exportPanel.locator('input[name="jdsz-gran"][value="day"]');
    await dayGranularity.check();
    if (!(await dayGranularity.isChecked())) throw new Error("京东商品榜单导出增强未切换到按日");
  }
  let value: { url: string; headers: Record<string, string>; capturedAt: number } | undefined;
  let imageHeaders: Record<string, string> | undefined;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const candidate = capturedRankRequests.get(page);
    if (candidate?.url.includes("unitType=1") && candidate.capturedAt >= categorySelectionStartedAt) { value = candidate; break; }
    await frame.waitForTimeout(100);
  }
  if (!value) throw new Error("未捕获到京东商品榜单 SKU 原生请求");
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const candidate = capturedImageRequests.get(page);
    if (candidate && candidate.capturedAt >= categorySelectionStartedAt) { imageHeaders = candidate.headers; break; }
    await frame.waitForTimeout(100);
  }
  if (!imageHeaders) throw new Error("未捕获到京东商品图片接口原生请求头");
  const params = new URL(value.url, targetUrl).searchParams;
  if (params.get("unitType") !== "1") throw new Error("捕获到的榜单请求不是 SKU 维度");
  await frame.evaluate((captured) => {
    (window as typeof window & { __teruisiJdRank?: typeof captured }).__teruisiJdRank = captured;
  }, value);
  return { frame, imageHeaders };
}

type RankBlock = { metaIndex: Record<string, number>; data: unknown[][] };
type JdMarketImage = { imageUrl: string; productUrl: string };

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeJdMarketImageUrl(value: unknown) {
  const raw = String(value ?? "").trim().replace(/^\/\//, "https://").replace(/^http:\/\//i, "https://");
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !/^img\d+\.360buyimg\.com$/i.test(url.hostname)) return "";
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/n\d+\//, "/n5/");
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeJdMarketProductUrl(value: unknown) {
  const raw = String(value ?? "").trim().replace(/^\/\//, "https://").replace(/^http:\/\//i, "https://");
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !/(^|\.)jd\.com$/i.test(url.hostname)) return "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

/** Normalizes the array and SKU-keyed response shapes returned by JD's image endpoint. */
export function parseJdMarketImageRows(body: unknown): Record<string, JdMarketImage> {
  const root = recordValue(body);
  const content = recordValue(root?.content);
  const candidate = content?.data ?? root?.data ?? root?.content;
  const rows: Array<Record<string, unknown>> = [];
  if (Array.isArray(candidate)) {
    for (const value of candidate) {
      const row = recordValue(value);
      if (row) rows.push(row);
    }
  } else {
    const keyed = recordValue(candidate);
    if (keyed) {
      for (const [skuId, value] of Object.entries(keyed)) {
        const row = recordValue(value);
        rows.push(row ? { skuId, ...row } : { skuId, imgSrc: value });
      }
    }
  }
  const result: Record<string, JdMarketImage> = {};
  for (const row of rows) {
    const skuId = String(row.skuId ?? row.skuID ?? row.sku ?? row.id ?? "").trim();
    if (!skuId) continue;
    result[skuId] = {
      imageUrl: normalizeJdMarketImageUrl(row.imgSrc ?? row.imageUrl ?? row.imgUrl),
      productUrl: normalizeJdMarketProductUrl(row.proUrl ?? row.productUrl),
    };
  }
  return result;
}

export function assertJdMarketImageCoverage(skuIds: string[], images: Record<string, JdMarketImage>) {
  const missing = [...new Set(skuIds)].filter((skuId) => !images[skuId]?.imageUrl);
  if (missing.length) {
    throw new Error(`京东商品榜单图片接口缺少 ${missing.length} 个 SKU 主图：${missing.slice(0, 5).join(",")}；已停止生成和导入空图片榜单`);
  }
}

async function fetchRankDay(frame: Page | import("playwright-core").Frame, date: string): Promise<RankBlock> {
  let lastError = "未知错误";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await frame.evaluate(async (targetDate) => {
        const target = window as typeof window & { __teruisiJdRank?: { headers: Record<string, string>; url: string; capturedAt: number } };
        const state = target.__teruisiJdRank;
        if (!state || Date.now() - state.capturedAt > 60 * 60_000) throw new Error("榜单请求头缺失或已过期");
        const url = new URL(state.url, location.origin);
        url.searchParams.set("date", targetDate.replaceAll("-", ""));
        url.searchParams.set("startDate", targetDate);
        url.searchParams.set("endDate", targetDate);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
          const response = await fetch(url, { credentials: "include", headers: state.headers, signal: controller.signal });
          const body = await response.json();
          const block = body?.content?.trade;
          if (!response.ok || !block?.metaIndex || !Array.isArray(block.data)) throw new Error("京东榜单接口未返回可验证的交易榜单数据");
          return block as RankBlock;
        } finally {
          clearTimeout(timeout);
        }
      }, date);
    } catch (error) {
      lastError = (error instanceof Error ? error.message : String(error)).split("\n", 1)[0]!.slice(0, 300);
      if (attempt < 2) await frame.waitForTimeout(1_000);
    }
  }
  throw new Error(`京东商品榜单单日请求连续 3 次失败：${date}；${lastError}`);
}

async function fetchImages(frame: Page | import("playwright-core").Frame, skuIds: string[], imageHeaders: Record<string, string>) {
  const result: Record<string, JdMarketImage> = {};
  for (let index = 0; index < skuIds.length; index += 50) {
    const chunk = skuIds.slice(index, index + 50);
    const body = await frame.evaluate(async ({ ids, headers }) => {
      const response = await fetch(`/sz/api/industry/getImageURL.ajax?ids=${ids.join(",")}`, { credentials: "include", headers });
      const body = await response.json();
      if (!response.ok) throw new Error("京东商品图片接口请求失败");
      return body as unknown;
    }, { ids: chunk, headers: imageHeaders });
    Object.assign(result, parseJdMarketImageRows(body));
  }
  assertJdMarketImageCoverage(skuIds, result);
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

function buildCsv(config: JdMarketDailyConfig, target: JdMarketDailyCategoryConfig, results: Array<{ date: string; block: RankBlock }>, images: Record<string, { imageUrl: string; productUrl: string }>) {
  const header = ["period_start", "period_end", "category", "scope", "dimension", "rank", "sku_code", "product_name", "gmv", "quantity", "visitors", "search_clicks", "image_url", "product_url"];
  const rows: unknown[][] = [header];
  for (const { date, block } of results) {
    const meta = block.metaIndex;
    for (const row of block.data) {
      const get = (key: string) => meta[key] === undefined ? "" : row[meta[key]!];
      const sku = String(get("skuId"));
      rows.push([
        date, date, target.systemCategory, config.scope, "SKU", displayMetric(get("OrdAmtIndexRank")), sku,
        displayMetric(get("ProName")), displayMetric(get("OrdAmtIndex")), displayMetric(get("OrdNumIndex")),
        displayMetric(get("UVIndex")), displayMetric(get("SearchClickIndex")), images[sku]?.imageUrl ?? "",
        images[sku]?.productUrl || `https://item.jd.com/${sku}.html`,
      ]);
    }
  }
  return new TextEncoder().encode(`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`);
}

async function importCsv(plan: JdMarketDailyPlan, config: JdMarketDailyConfig, target: JdMarketDailyCategoryConfig, chunk: JdMarketDailyChunk, filePath: string) {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "text/csv;charset=utf-8" }), path.basename(filePath));
  form.set("sourceType", "market_ranking");
  form.set("periodStart", chunk.startDate);
  form.set("periodEnd", chunk.endDate);
  form.set("category", target.systemCategory);
  form.set("scope", config.scope);
  form.set("priceBandFilter", config.priceBandFilter);
  const response = await fetch(`${plan.baseUrl}/api/market/import`, { method: "POST", body: form, signal: AbortSignal.timeout(importRequestTimeoutMs) });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !body || !["imported", "duplicate"].includes(String(body.status))) throw new Error(`市场榜单导入失败：${String(body?.error ?? `HTTP ${response.status}`)}`);
  const batch = body.batch as Record<string, unknown> | undefined;
  if (batch?.status !== "completed" || Number(batch.rowCount ?? 0) <= 0) throw new Error("市场榜单导入未返回已完成的非空批次");
  return { batchId: String(batch.id), rowCount: Number(batch.rowCount) };
}

async function withRunLock<T>(runId: string, task: () => Promise<T>) {
  await mkdir(outputRoot, { recursive: true });
  return withJackyunRunLock({
    runId,
    purpose: "jd-market-ranking-daily",
    lockDirectory: lockPath,
  }, task);
}

export async function runJdMarketDailyPlan(plan: JdMarketDailyPlan) {
  return withJdChromiumRunLock("market-ranking", () => withRunLock(plan.runId, async () => {
    const config = await loadJdMarketDailyConfig();
    const store = await getJdStore(plan.storeKey);
    if (plan.stage === "executed" || plan.stage === "completed") return { ok: true, stage: "run", verificationOnly: true, runId: plan.runId };
    if (plan.stage !== "planned" || store.shopId !== plan.shopId || store.shopName !== plan.shopName
      || store.browser.profileName !== plan.browserProfileName || store.browser.debugPort !== plan.browserDebugPort) {
      throw new Error("市场榜单计划状态、店铺身份或 Chromium profile 无效");
    }
    const configuredTargets = config.categories.map((target) => ({
      key: target.key, categoryPath: target.categoryPath, systemCategory: target.systemCategory,
      scope: config.scope, rankingDimension: config.dimension, priceBandFilter: config.priceBandFilter,
    }));
    const plannedTargets = plan.targets.map((target) => ({
      key: target.key, categoryPath: target.categoryPath, systemCategory: target.identity.category,
      scope: target.identity.scope, rankingDimension: target.identity.rankingDimension, priceBandFilter: target.identity.priceBandFilter,
    }));
    if (plan.version !== 3 || !plan.silentNoWindow || JSON.stringify(configuredTargets) !== JSON.stringify(plannedTargets)) {
      throw new Error("市场榜单计划类目清单或隐藏 Chromium 约束与当前受控配置不一致");
    }
    const totalChunks = plan.targets.reduce((sum, target) => sum + target.chunks.length, 0);
    if (!totalChunks) { plan.stage = "executed"; await persistPlan(plan); return { ok: true, stage: "run", runId: plan.runId, importedFiles: 0 }; }
    plan.stage = "running"; await persistPlan(plan);
    let browser: Awaited<ReturnType<typeof connectPlaywrightBrowser>> | null = null;
    let ownsBrowser = false;
    let activeTargetPlan: JdMarketDailyTargetPlan | null = null;
    let activePage: Page | null = null;
    try {
      const launched = await launchDedicatedChrome({
        executablePath: store.browser.executablePath,
        profileDirectory: store.browser.userDataDir,
        profileName: store.browser.profileName,
        port: store.browser.debugPort, startUrl: "about:blank",
        headless: false, visible: false, startMinimized: true,
        keepWindowHidden: plan.silentNoWindow,
      });
      ownsBrowser = Boolean(launched);
      if (plan.silentNoWindow && !ownsBrowser) throw new Error("京东市场榜单静默模式拒绝复用未受本次窗口守护控制的 Chromium 实例。");
      await waitForChrome(store.browser.debugPort);
      browser = await connectPlaywrightBrowser(store.browser.debugPort);
      const { page } = await connectPlaywrightJackyunTarget(browser, { workerName: "teruisi-jd-market-ranking", targetUrlPattern: /jdsz\.jd\.com/i, requireMini: false });
      activePage = page;
      await installRequestCapture(page);
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await assertStoreIdentity(page, plan);
      const runDirectory = path.join(outputRoot, plan.runId);
      await mkdir(runDirectory, { recursive: true });
      for (const targetPlan of plan.targets) {
        if (!targetPlan.chunks.length) continue;
        activeTargetPlan = targetPlan;
        const target = config.categories.find((candidate) => candidate.key === targetPlan.key);
        if (!target) throw new Error(`市场榜单受控类目不存在：${targetPlan.key}`);
        const { frame, imageHeaders } = await selectRankingIdentity(page, config, target);
        await saveEvidenceScreenshot(page, plan, targetPlan, "filters");
        const exportPanel = activeExportPanel(frame);
        const exportPanelCount = await exportPanel.count();
        if (exportPanelCount > 1) throw new Error("京东商品榜单当前版本导出增强面板不唯一");
        if (exportPanelCount === 1) {
          const fromInput = exportPanel.locator("#jdsz-from");
          const toInput = exportPanel.locator("#jdsz-to");
          const startDate = targetPlan.chunks[0]!.startDate;
          const endDate = targetPlan.chunks.at(-1)!.endDate;
          await fromInput.fill(startDate);
          await toInput.fill(endDate);
          if (await fromInput.inputValue() !== startDate || await toInput.inputValue() !== endDate) {
            throw new Error("京东商品榜单导出增强日期未精确生效");
          }
          await saveEvidenceScreenshot(page, plan, targetPlan, "exportPanel");
        }
        for (const chunk of targetPlan.chunks) {
          if (chunk.batchId) continue;
          const results: Array<{ date: string; block: RankBlock }> = [];
          for (const date of chunk.dates) {
            results.push({ date, block: await fetchRankDay(frame, date) });
            await frame.waitForTimeout(config.requestDelayMs);
          }
          const first = results[0]?.block;
          const emptyDate = results.find((result) => result.block.data.length === 0)?.date;
          if (emptyDate === plan.endDate) {
            throw new Error(`京东商智昨日数据尚未开放：${target.systemCategory} ${emptyDate}；已按安全规则停止，未缩短日期范围或导入空集合`);
          }
          if (!first || emptyDate || !results.every((result) => result.block.data.length <= 200)) throw new Error(`京东商品榜单返回空日或超过 SKU 榜单行数上限：${target.systemCategory}`);
          const skuIds = [...new Set(results.flatMap(({ block }) => block.data.map((row) => String(row[block.metaIndex.skuId!]))))];
          const images = await fetchImages(frame, skuIds, imageHeaders);
          const bytes = buildCsv(config, target, results, images);
          const fileName = `京东商智_交易榜单_SKU_${target.systemCategory}_${chunk.startDate}至${chunk.endDate}.csv`;
          const filePath = path.join(runDirectory, fileName);
          if (!inside(runDirectory, filePath)) throw new Error("市场榜单下载文件路径越界");
          await writeFile(filePath, bytes);
          chunk.filePath = filePath;
          chunk.fileHash = createHash("sha256").update(bytes).digest("hex");
          chunk.fileSizeBytes = bytes.byteLength;
          await persistPlan(plan);
          const imported = await importCsv(plan, config, target, chunk, filePath);
          chunk.batchId = imported.batchId;
          chunk.rowCount = imported.rowCount;
          await persistPlan(plan);
        }
        await saveEvidenceScreenshot(page, plan, targetPlan, "imported");
      }
      plan.stage = "executed"; delete plan.failure; await persistPlan(plan);
      return {
        ok: true, stage: "run", runId: plan.runId,
        importedFiles: plan.targets.reduce((sum, target) => sum + target.chunks.length, 0),
        rowCount: plan.targets.reduce((sum, target) => sum + target.chunks.reduce((targetSum, chunk) => targetSum + Number(chunk.rowCount ?? 0), 0), 0),
      };
    } catch (error) {
      if (activePage && activeTargetPlan) await saveEvidenceScreenshot(activePage, plan, activeTargetPlan, "filters");
      plan.stage = "failed";
      plan.failure = { stage: "run", message: (error instanceof Error ? error.message : String(error)).slice(0, 1000), at: new Date().toISOString() };
      await persistPlan(plan);
      throw error;
    } finally {
      await browser?.close().catch(() => undefined);
      if (ownsBrowser) await closeChromeBrowser(store.browser.debugPort);
    }
  }));
}

export async function verifyJdMarketDailyPlan(plan: JdMarketDailyPlan, request: typeof fetch = fetch) {
  const config = await loadJdMarketDailyConfig();
  if (plan.stage === "completed") return { ok: true, stage: "verify", runId: plan.runId, missingAfterImport: [] };
  if (plan.stage !== "executed") throw new Error("市场榜单计划尚未进入可核验阶段");
  const configuredTargets = new Map(config.categories.map((target) => [target.key, target]));
  const missingAfterImport: Array<{ key: string; category: string; date: string }> = [];
  for (const targetPlan of plan.targets) {
    const target = configuredTargets.get(targetPlan.key);
    if (!target || target.systemCategory !== targetPlan.identity.category || JSON.stringify(target.categoryPath) !== JSON.stringify(targetPlan.categoryPath)
      || targetPlan.identity.scope !== config.scope || targetPlan.identity.rankingDimension !== config.dimension || targetPlan.identity.priceBandFilter !== config.priceBandFilter) {
      throw new Error(`市场榜单核验类目与当前受控配置不一致：${targetPlan.key}`);
    }
    for (const chunk of targetPlan.chunks) {
      if (!chunk.batchId || !chunk.fileHash || !chunk.filePath || !chunk.fileSizeBytes || !chunk.rowCount) throw new Error("市场榜单计划缺少完整文件或导入批次证据");
      const bytes = await readFile(chunk.filePath);
      const fileInfo = await stat(chunk.filePath);
      if (!fileInfo.isFile() || fileInfo.size !== chunk.fileSizeBytes || createHash("sha256").update(bytes).digest("hex") !== chunk.fileHash) {
        throw new Error("市场榜单签收文件缺失、大小变化或 SHA-256 不匹配");
      }
    }
    const coverage = await readCoverage(plan.baseUrl, config, target, plan.startDate, plan.endDate, request);
    for (const date of targetPlan.missingDates.filter((candidate) => coverage.missingDates.includes(candidate))) {
      missingAfterImport.push({ key: target.key, category: target.systemCategory, date });
    }
  }
  if (missingAfterImport.length) throw new Error(`市场榜单导入后仍缺少 ${missingAfterImport.length} 个目标日`);
  plan.stage = "completed"; delete plan.failure; await persistPlan(plan);
  return { ok: true, stage: "verify", runId: plan.runId, importedDateCount: plan.targets.reduce((sum, target) => sum + target.missingDates.length, 0), missingAfterImport };
}

export function jdMarketHelperRequestError(stage: string, busy: boolean, route: string, requestExecutionId: string | null, claimedExecutionId: string | null) {
  if (!requestExecutionId) return { error: "missing_or_invalid_execution_id" as const };
  if (claimedExecutionId && requestExecutionId !== claimedExecutionId) return { error: "execution_mismatch" as const };
  if (!claimedExecutionId && route !== "/jd-market/plan") return { error: "execution_not_claimed" as const, expected: "/jd-market/plan" as const };
  if (busy) return { error: "pipeline_busy" as const };
  const expected = route === "/jd-market/plan" ? "ready" : route === "/jd-market/run" ? "planned" : "executed";
  return stage === expected ? null : { error: "invalid_stage" as const, expected, actual: stage };
}
