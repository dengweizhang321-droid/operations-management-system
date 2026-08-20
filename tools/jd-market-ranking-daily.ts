import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Locator, Page } from "playwright-core";

import { closeChromeBrowser, launchDedicatedChrome, waitForChrome } from "../lib/jackyun/cdp-client";
import { connectPlaywrightBrowser } from "../lib/jackyun/playwright-client";
import { readJsonFile, writeJsonAtomic } from "../lib/jackyun/json-file";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { getJdStore } from "../lib/jd/store-registry";
import { withJdChromiumRunLock } from "../lib/jd/chromium-run-lock";
import { assertJdProductDetailStoreIdentity, parseJdProductDetailStoreIdentity } from "../lib/jd/product-detail-store-identity";
import {
  assertJdMarketImportProof,
  claimExactJdMarketPlan,
  claimRecoverableJdMarketPlan,
  inspectJdMarketSignedCsv,
  validateJdMarketImportResponse,
  type JdMarketImportProof,
  type JdMarketSignedFileEvidence,
} from "../lib/jd/market-ranking-import-contract";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetUrl = "https://jdsz.jd.com/szweb/view/industry/industry-product-rank-temp.html?sz=%2Fszweb%2Fsz%2Fview%2FindustryMarket%2FproductRanks.html";
const outputRoot = path.join(projectRoot, "outputs", "jd-market-ranking-daily");
const configPath = path.join(projectRoot, "config", "jd-market-ranking-daily.json");
const lockPath = path.join(outputRoot, "run.lock");
const coverageRequestTimeoutMs = 120_000;
const importRequestTimeoutMs = 900_000;
export type JdMarketRankRequest = Readonly<{ headers: Readonly<Record<string, string>>; url: string; capturedAt: number }>;
const capturedRankRequests = new WeakMap<Page, JdMarketRankRequest>();
const capturedImageRequests = new WeakMap<Page, { headers: Readonly<Record<string, string>>; capturedAt: number }>();
const replayableHeaderNames = new Set(["accept", "p-pin", "user-mnp", "user-mup", "uuid", "x-requested-with"]);

export type JdMarketDailyCategoryConfig = {
  key: string;
  categoryPath: [string, string];
  systemCategory: string;
  secondIndId: string;
  thirdIndId: string;
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

type JdMarketDailyChunk = {
  startDate: string;
  endDate: string;
  dates: string[];
  filePath?: string;
  fileHash?: string;
  fileSizeBytes?: number;
  batchId?: string;
  rowCount?: number;
  importProof?: JdMarketImportProof;
};

export type JdMarketDailyTargetPlan = {
  key: string;
  categoryPath: [string, string];
  identity: { category: string; scope: string; rankingDimension: "SKU"; priceBandFilter: string; secondIndId: string; thirdIndId: string };
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
  const industryIds = categories.map((target) => `${target?.secondIndId}:${target?.thirdIndId}`);
  if (config.version !== 3 || !config.enabled || config.silentNoWindow !== true || config.dimension !== "SKU" || categories.length !== 7
    || categories.some((target) => !target || !/^[a-z0-9-]{1,80}$/.test(target.key)
      || !Array.isArray(target.categoryPath) || target.categoryPath.length !== 2 || !target.categoryPath.every(Boolean) || !target.systemCategory
      || !/^\d+$/.test(String(target.secondIndId ?? "")) || !/^\d+$/.test(String(target.thirdIndId ?? "")))
    || new Set(categoryKeys).size !== categories.length || new Set(systemCategories).size !== categories.length || new Set(categoryPaths).size !== categories.length
    || new Set(industryIds).size !== categories.length
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

async function loadPersistedJdMarketPlans() {
  const entries = await readdir(outputRoot, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile() && /^plan-[A-Za-z0-9._-]+\.json$/.test(entry.name));
  const plans: JdMarketDailyPlan[] = [];
  for (const entry of files) {
    const plan = await readJsonFile<unknown>(path.join(outputRoot, entry.name));
    if (!plan || typeof plan !== "object" || !Array.isArray((plan as Partial<JdMarketDailyPlan>).targets)) continue;
    plans.push(plan as JdMarketDailyPlan);
  }
  return plans;
}

function expectedJdMarketPlanIdentity(
  config: JdMarketDailyConfig,
  store: Awaited<ReturnType<typeof getJdStore>>,
  baseUrl: string,
  endDate: string,
) {
  return {
    version: 3,
    baseUrl,
    silentNoWindow: true,
    storeKey: store.storeKey,
    shopId: store.shopId,
    shopName: store.shopName,
    browserProfileName: store.browser.profileName,
    browserDebugPort: store.browser.debugPort,
    startDate: config.earliestDate,
    endDate,
    targets: config.categories.map((target) => ({
      key: target.key,
      categoryPath: target.categoryPath,
      identity: {
        category: target.systemCategory,
        scope: config.scope,
        rankingDimension: config.dimension,
        priceBandFilter: config.priceBandFilter,
        secondIndId: target.secondIndId,
        thirdIndId: target.thirdIndId,
      },
    })),
  } as const;
}

export async function planJdMarketDailyRun(options: {
  executionId: string;
  baseUrl?: string;
  now?: Date;
  request?: typeof fetch;
  runId?: string;
  resumeRunId?: string;
  silentNoWindow?: boolean;
}) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(options.executionId)) throw new Error("n8n execution ID 无效");
  const config = await loadJdMarketDailyConfig();
  const store = await getJdStore(config.storeKey);
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.OPERATIONS_SYSTEM_URL ?? "http://localhost:3000");
  const endDate = shanghaiYesterday(options.now);
  if (options.silentNoWindow === false) throw new Error("京东市场榜单计划必须使用隐藏 Chromium");
  return withRunLock(`jd-market-plan-${randomUUID()}`, async () => {
    const identity = expectedJdMarketPlanIdentity(config, store, baseUrl, endDate);
    const persistedPlans = await loadPersistedJdMarketPlans();
    const recovered = options.resumeRunId
      ? claimExactJdMarketPlan(persistedPlans, identity, options.executionId, options.resumeRunId)
      : claimRecoverableJdMarketPlan(persistedPlans, identity, options.executionId);
    if (recovered) {
      await persistPlan(recovered);
      return recovered;
    }
    const runId = options.runId ?? `jd-market-${randomUUID()}`;
    const targets: JdMarketDailyTargetPlan[] = [];
    for (const target of config.categories) {
      const coverage = await readCoverage(baseUrl, config, target, config.earliestDate, endDate, options.request);
      targets.push({
        key: target.key,
        categoryPath: target.categoryPath,
        identity: { category: target.systemCategory, scope: config.scope, rankingDimension: "SKU", priceBandFilter: config.priceBandFilter,
          secondIndId: target.secondIndId, thirdIndId: target.thirdIndId },
        missingDates: coverage.missingDates,
        chunks: chunksOfMissingDates(coverage.missingDates, config.maxDaysPerFile, endDate),
      });
    }
    const plan: JdMarketDailyPlan = {
      version: 3, runId, ownerExecutionId: options.executionId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      baseUrl, silentNoWindow: true, stage: "planned",
      storeKey: store.storeKey, shopId: store.shopId, shopName: store.shopName,
      browserProfileName: store.browser.profileName, browserDebugPort: store.browser.debugPort,
      startDate: config.earliestDate, endDate,
      targets,
    };
    await persistPlan(plan);
    return plan;
  });
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
  return Object.freeze(Object.fromEntries(Object.entries(headers).filter(([name]) => replayableHeaderNames.has(name.toLowerCase()))));
}

export function isJdMarketRankRequestForTarget(urlValue: string, target: Pick<JdMarketDailyCategoryConfig, "secondIndId" | "thirdIndId">) {
  try {
    const url = new URL(urlValue, targetUrl);
    const exactly = (name: string, expected: string) => {
      const values = url.searchParams.getAll(name);
      return values.length === 1 && values[0] === expected;
    };
    return url.protocol === "https:" && url.hostname === "jdsz.jd.com"
      && /\/sz\/api\/industryMarket\/getProductBillBoardDealData\.ajax$/.test(url.pathname)
      && exactly("unitType", "1") && exactly("secondIndId", target.secondIndId) && exactly("thirdIndId", target.thirdIndId);
  } catch {
    return false;
  }
}

async function installRequestCapture(page: Page) {
  page.on("request", (request) => {
    const headers = jdMarketReplayableHeaders(request.headers());
    if (/\/sz\/api\/industry\/getImageURL\.ajax/.test(request.url())) {
      capturedImageRequests.set(page, { headers, capturedAt: Date.now() });
      return;
    }
    if (!/\/sz\/api\/industryMarket\/getProductBillBoardDealData\.ajax/.test(request.url())) return;
    capturedRankRequests.set(page, Object.freeze({ url: request.url(), headers, capturedAt: Date.now() }));
  });
}

async function clickDropdownControl(control: Locator) {
  const count = await control.count();
  const className = count === 1 ? String(await control.getAttribute("class") ?? "") : "";
  const eventName = count === 1 ? String(await control.getAttribute("data-event-name") ?? "") : "";
  if (count !== 1 || !className.split(/\s+/).includes("jmtd-base-input") || eventName !== "open") {
    throw new Error("京东商品榜单下拉控件真实触发层不唯一或契约已变化");
  }
  await control.click({ timeout: 3_000, force: true });
}

async function triggerUniqueDropdownOption(surface: Locator, frame: Frame, label: string, action: "click" | "hover", control?: Locator) {
  const exactLabel = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  let lastCandidateCount = 0;
  let controlClicks = 0;
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
    if (lastCandidateCount === 0 && control && attempt % 10 === 0) {
      const visibleOptionCount = await surface.locator(".jmtd-dropdown-option").filter({ visible: true }).count();
      if (visibleOptionCount === 0 || attempt >= 20) {
        const clicked = await clickDropdownControl(control).then(() => true).catch(() => false);
        if (clicked) {
          controlClicks += 1;
          await frame.waitForTimeout(300);
        }
      }
    }
    if (attempt === 99) {
      lastVisibleLabels = (await surface.locator(".jmtd-dropdown-option").filter({ visible: true }).allTextContents())
        .map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40);
    }
    await frame.waitForTimeout(100);
  }
  throw new Error(`京东商品榜单下拉选项无法唯一定位：${label}；候选=${lastCandidateCount}；控件点击=${controlClicks}；可见选项=${lastVisibleLabels.join("|").slice(0, 600)}`);
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
      const clicked = await clickDropdownControl(control)
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
      const expanded = await parents.first().hover({ timeout: 3_000, force: true }).then(() => true).catch(() => false);
      if (expanded) {
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

async function waitForSelectorText(control: Locator, frame: Frame, expected: string, exact: boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const actual = (await control.innerText().catch(() => "")).trim();
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

async function waitForRankingIdentityControls(surface: Locator, frame: Frame) {
  const selectOpeners = surface.locator('.jmtd-base-input[data-component-name="Select"][data-event-name="open"]').filter({ visible: true });
  await selectOpeners.first().waitFor({ state: "visible", timeout: 30_000 });
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const dimensionControl = selectOpeners.filter({ hasText: /^(?:SKU|SPU)$/ });
    const categoryControl = selectOpeners.filter({ hasText: /商用/ });
    if (await selectOpeners.count() >= 3 && await dimensionControl.count() === 1 && await categoryControl.count() === 1) {
      return { dimensionControl, categoryControl };
    }
    await frame.waitForTimeout(100);
  }
  throw new Error("京东商品榜单 SKU/SPU 或商用类目筛选控件未在有界时间内唯一稳定");
}

async function selectRankingIdentity(page: Page, config: JdMarketDailyConfig, target: JdMarketDailyCategoryConfig) {
  const frame = page.frames().find((candidate) => /productRanks\.html/.test(candidate.url()));
  if (!frame) throw new Error("未找到京东商品榜单业务框架");
  const surface = await waitForRankingSurface(frame);
  const { dimensionControl, categoryControl } = await waitForRankingIdentityControls(surface, frame);
  const currentDimension = (await dimensionControl.innerText()).trim();
  if (currentDimension !== "SKU") {
    await clickUniqueDropdownOption(surface, frame, "SKU", dimensionControl);
    await waitForSelectorText(dimensionControl, frame, "SKU", true);
  }
  const categoryLabel = target.categoryPath.join(" > ");
  const currentCategory = (await categoryControl.innerText()).trim();
  if (currentCategory.includes(categoryLabel)) {
    const alternate = config.categories.find((candidate) => candidate.key !== target.key);
    if (!alternate) throw new Error("京东商品榜单缺少用于刷新同类目请求的受控备用类目");
    await selectUniqueCategoryPath(surface, frame, categoryControl, alternate.categoryPath);
    await waitForSelectorText(categoryControl, frame, alternate.categoryPath.join(" > "), false);
  }
  const categorySelectionStartedAt = Date.now();
  capturedRankRequests.delete(page);
  capturedImageRequests.delete(page);
  await selectUniqueCategoryPath(surface, frame, categoryControl, target.categoryPath);
  await waitForSelectorText(categoryControl, frame, categoryLabel, false);
  await frame.waitForTimeout(1_000);
  if ((await dimensionControl.innerText()).trim() !== "SKU" || !(await categoryControl.innerText()).includes(categoryLabel)) throw new Error("京东商品榜单 SKU 或类目选择未精确生效");
  const exportPanel = activeExportPanel(frame);
  const exportPanelCount = await exportPanel.count();
  if (exportPanelCount > 1) throw new Error("京东商品榜单当前版本导出增强面板不唯一");
  if (exportPanelCount === 1) {
    await exportPanel.waitFor({ state: "visible", timeout: 10_000 });
    const dayGranularity = exportPanel.locator('input[name="jdsz-gran"][value="day"]');
    await dayGranularity.check();
    if (!(await dayGranularity.isChecked())) throw new Error("京东商品榜单导出增强未切换到按日");
  }
  let value: JdMarketRankRequest | undefined;
  let imageHeaders: Readonly<Record<string, string>> | undefined;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const candidate = capturedRankRequests.get(page);
    if (candidate && candidate.capturedAt >= categorySelectionStartedAt && isJdMarketRankRequestForTarget(candidate.url, target)) { value = candidate; break; }
    await frame.waitForTimeout(100);
  }
  if (!value) throw new Error("未捕获到京东商品榜单 SKU 原生请求");
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const candidate = capturedImageRequests.get(page);
    if (candidate && candidate.capturedAt >= categorySelectionStartedAt) { imageHeaders = candidate.headers; break; }
    await frame.waitForTimeout(100);
  }
  if (!imageHeaders) throw new Error("未捕获到京东商品图片接口原生请求头");
  return Object.freeze({ frame, imageHeaders, rankRequest: value });
}

type RankBlock = { metaIndex: Record<string, number>; data: unknown[][] };
type JdMarketImage = { imageUrl: string; productUrl: string };

export async function withSingleJdMarketRequestRefresh<TState, TResult>(
  state: TState,
  request: (current: TState) => Promise<TResult>,
  refresh: () => Promise<TState>,
) {
  try {
    return { state, result: await request(state), refreshed: false as const };
  } catch (firstError) {
    let refreshedState: TState;
    try {
      refreshedState = await refresh();
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
      throw new Error(`京东商品榜单原生请求重新捕获失败：${message}`, { cause: firstError });
    }
    try {
      return { state: refreshedState, result: await request(refreshedState), refreshed: true as const };
    } catch (secondError) {
      const message = secondError instanceof Error ? secondError.message : String(secondError);
      throw new Error(`京东商品榜单使用新鲜原生请求后仍失败：${message}`, { cause: firstError });
    }
  }
}

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

type JdMarketRequestState = Readonly<{
  frame: Frame;
  imageHeaders: Readonly<Record<string, string>>;
  rankRequest: JdMarketRankRequest;
}>;

async function fetchRankDay(state: JdMarketRequestState, date: string): Promise<RankBlock> {
  let lastError = "未知错误";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (Date.now() - state.rankRequest.capturedAt > 60 * 60_000) throw new Error("榜单请求头缺失或已过期");
      return await state.frame.evaluate(async ({ targetDate, rankRequest }) => {
        const url = new URL(rankRequest.url, location.origin);
        url.searchParams.set("date", targetDate.replaceAll("-", ""));
        url.searchParams.set("startDate", targetDate);
        url.searchParams.set("endDate", targetDate);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
          const response = await fetch(url, { credentials: "include", headers: rankRequest.headers, signal: controller.signal });
          const body = await response.json();
          const block = body?.content?.trade;
          if (!response.ok || !block?.metaIndex || !Array.isArray(block.data)) throw new Error("京东榜单接口未返回可验证的交易榜单数据");
          return block as RankBlock;
        } finally {
          clearTimeout(timeout);
        }
      }, { targetDate: date, rankRequest: state.rankRequest });
    } catch (error) {
      lastError = (error instanceof Error ? error.message : String(error)).split("\n", 1)[0]!.slice(0, 300);
      if (attempt < 2) await state.frame.waitForTimeout(1_000);
    }
  }
  throw new Error(`京东商品榜单单日请求连续 3 次失败：${date}；${lastError}`);
}

async function fetchImages(frame: Page | import("playwright-core").Frame, skuIds: string[], imageHeaders: Readonly<Record<string, string>>) {
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

function canonicalChunkFileName(target: JdMarketDailyCategoryConfig, chunk: JdMarketDailyChunk) {
  return `京东商智_交易榜单_SKU_${target.systemCategory}_${chunk.startDate}至${chunk.endDate}.csv`;
}

async function inspectSignedChunk(
  plan: JdMarketDailyPlan,
  config: JdMarketDailyConfig,
  target: JdMarketDailyCategoryConfig,
  chunk: JdMarketDailyChunk,
) {
  const runDirectory = path.join(outputRoot, plan.runId);
  const expectedPath = path.join(runDirectory, canonicalChunkFileName(target, chunk));
  const evidenceFields = [chunk.filePath, chunk.fileHash, chunk.fileSizeBytes];
  if (evidenceFields.some((value) => value !== undefined) && evidenceFields.some((value) => value === undefined)) {
    throw new Error("市场榜单计划包含不完整的签收文件证据");
  }
  if (!chunk.filePath || !chunk.fileHash || !chunk.fileSizeBytes || path.resolve(chunk.filePath) !== path.resolve(expectedPath)
    || !inside(runDirectory, chunk.filePath)) {
    throw new Error("市场榜单签收文件路径或规范文件名与计划不一致");
  }
  const info = await stat(chunk.filePath);
  if (!info.isFile()) throw new Error("市场榜单签收文件不是普通文件");
  const bytes = new Uint8Array(await readFile(chunk.filePath));
  const evidence = inspectJdMarketSignedCsv({
    bytes,
    fileName: path.basename(chunk.filePath),
    expectedFileSizeBytes: chunk.fileSizeBytes,
    expectedRawFileSha256: chunk.fileHash,
    dates: chunk.dates,
    identity: {
      category: target.systemCategory,
      scope: config.scope,
      rankingDimension: config.dimension,
      priceBandFilter: config.priceBandFilter,
    },
  });
  return { bytes, evidence };
}

async function importCsv(
  plan: JdMarketDailyPlan,
  config: JdMarketDailyConfig,
  target: JdMarketDailyCategoryConfig,
  chunk: JdMarketDailyChunk,
  bytes: Uint8Array,
  evidence: JdMarketSignedFileEvidence,
  request: typeof fetch = fetch,
) {
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "text/csv;charset=utf-8" }), evidence.fileName);
  form.set("sourceType", "market_ranking");
  form.set("periodStart", chunk.startDate);
  form.set("periodEnd", chunk.endDate);
  form.set("category", target.systemCategory);
  form.set("scope", config.scope);
  form.set("priceBandFilter", config.priceBandFilter);
  const response = await request(`${plan.baseUrl}/api/market/import`, { method: "POST", body: form, signal: AbortSignal.timeout(importRequestTimeoutMs) });
  const body = await response.json().catch(() => null);
  return validateJdMarketImportResponse(response.status, body, evidence);
}

async function withRunLock<T>(runId: string, task: () => Promise<T>) {
  await mkdir(outputRoot, { recursive: true });
  return withJackyunRunLock({
    runId,
    purpose: "jd-market-ranking-daily",
    lockDirectory: lockPath,
  }, task);
}

export async function runJdMarketDailyPlan(plan: JdMarketDailyPlan, options: { request?: typeof fetch } = {}) {
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
      secondIndId: target.secondIndId, thirdIndId: target.thirdIndId,
      scope: config.scope, rankingDimension: config.dimension, priceBandFilter: config.priceBandFilter,
    }));
    const plannedTargets = plan.targets.map((target) => ({
      key: target.key, categoryPath: target.categoryPath, systemCategory: target.identity.category,
      secondIndId: target.identity.secondIndId, thirdIndId: target.identity.thirdIndId,
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
      const runDirectory = path.join(outputRoot, plan.runId);
      await mkdir(runDirectory, { recursive: true });
      for (const targetPlan of plan.targets) {
        const target = config.categories.find((candidate) => candidate.key === targetPlan.key);
        if (!target) throw new Error(`市场榜单受控类目不存在：${targetPlan.key}`);
        for (const chunk of targetPlan.chunks) {
          const hasSignedEvidence = chunk.filePath !== undefined || chunk.fileHash !== undefined || chunk.fileSizeBytes !== undefined;
          if (!chunk.importProof && !chunk.batchId && !hasSignedEvidence) continue;
          const { bytes, evidence } = await inspectSignedChunk(plan, config, target, chunk);
          if (chunk.importProof) {
            assertJdMarketImportProof(chunk.importProof, evidence);
            if (chunk.batchId !== chunk.importProof.batchId || chunk.rowCount !== chunk.importProof.rowCount) {
              throw new Error("市场榜单计划批次摘要与严格导入证明不一致");
            }
            continue;
          }
          const proof = await importCsv(plan, config, target, chunk, bytes, evidence, options.request);
          chunk.importProof = proof;
          chunk.batchId = proof.batchId;
          chunk.rowCount = proof.rowCount;
          await persistPlan(plan);
        }
      }
      if (plan.targets.every((target) => target.chunks.every((chunk) => Boolean(chunk.importProof)))) {
        plan.stage = "executed";
        delete plan.failure;
        await persistPlan(plan);
        return {
          ok: true, stage: "run", runId: plan.runId, recoveredWithoutBrowser: true,
          importedFiles: totalChunks,
          rowCount: plan.targets.reduce((sum, target) => sum + target.chunks.reduce((targetSum, chunk) => targetSum + Number(chunk.rowCount ?? 0), 0), 0),
        };
      }
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
      const context = browser.contexts()[0];
      if (!context) throw new Error("京东商品榜单专用 Chromium 没有可用的浏览器上下文。");
      const blankPages = context.pages().filter((candidate) => candidate.url() === "about:blank");
      if (blankPages.length !== 1) throw new Error("京东商品榜单专用 Chromium 本轮空白启动页不唯一。");
      const page = blankPages[0]!;
      await page.evaluate(() => { window.name = "teruisi-jd-market-ranking"; });
      activePage = page;
      await installRequestCapture(page);
      const navigation = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (!navigation?.ok() || !/^https:\/\/jdsz\.jd\.com\/szweb\/view\/industry\/industry-product-rank-temp\.html(?:\?|$)/i.test(page.url())) {
        throw new Error("京东商品榜单唯一受控页面未精确导航到榜单地址。");
      }
      await assertStoreIdentity(page, plan);
      for (const targetPlan of plan.targets) {
        if (!targetPlan.chunks.length) continue;
        activeTargetPlan = targetPlan;
        const target = config.categories.find((candidate) => candidate.key === targetPlan.key);
        if (!target) throw new Error(`市场榜单受控类目不存在：${targetPlan.key}`);
        const captureTargetRequest = async () => {
          await assertStoreIdentity(page, plan);
          return selectRankingIdentity(page, config, target);
        };
        let evidencePrepared = false;
        for (const chunk of targetPlan.chunks) {
          if (chunk.importProof) continue;
          let requestState = await captureTargetRequest();
          if (!evidencePrepared) {
            await saveEvidenceScreenshot(page, plan, targetPlan, "filters");
            const exportPanel = activeExportPanel(requestState.frame);
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
            evidencePrepared = true;
          }
          const results: Array<{ date: string; block: RankBlock }> = [];
          for (const date of chunk.dates) {
            const fetched = await withSingleJdMarketRequestRefresh(
              requestState,
              (current) => fetchRankDay(current, date),
              captureTargetRequest,
            );
            requestState = fetched.state;
            results.push({ date, block: fetched.result });
            await requestState.frame.waitForTimeout(config.requestDelayMs);
          }
          const first = results[0]?.block;
          const emptyDate = results.find((result) => result.block.data.length === 0)?.date;
          if (emptyDate === plan.endDate) {
            throw new Error(`京东商智昨日数据尚未开放：${target.systemCategory} ${emptyDate}；已按安全规则停止，未缩短日期范围或导入空集合`);
          }
          if (!first || emptyDate || !results.every((result) => result.block.data.length <= 200)) throw new Error(`京东商品榜单返回空日或超过 SKU 榜单行数上限：${target.systemCategory}`);
          const skuIds = [...new Set(results.flatMap(({ block }) => block.data.map((row) => String(row[block.metaIndex.skuId!]))))];
          const images = await fetchImages(requestState.frame, skuIds, requestState.imageHeaders);
          const bytes = buildCsv(config, target, results, images);
          const fileName = canonicalChunkFileName(target, chunk);
          const filePath = path.join(runDirectory, fileName);
          if (!inside(runDirectory, filePath)) throw new Error("市场榜单下载文件路径越界");
          await writeFile(filePath, bytes);
          chunk.filePath = filePath;
          chunk.fileHash = createHash("sha256").update(bytes).digest("hex");
          chunk.fileSizeBytes = bytes.byteLength;
          await persistPlan(plan);
          const signed = await inspectSignedChunk(plan, config, target, chunk);
          const proof = await importCsv(plan, config, target, chunk, signed.bytes, signed.evidence, options.request);
          chunk.importProof = proof;
          chunk.batchId = proof.batchId;
          chunk.rowCount = proof.rowCount;
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
      || target.secondIndId !== targetPlan.identity.secondIndId || target.thirdIndId !== targetPlan.identity.thirdIndId
      || targetPlan.identity.scope !== config.scope || targetPlan.identity.rankingDimension !== config.dimension || targetPlan.identity.priceBandFilter !== config.priceBandFilter) {
      throw new Error(`市场榜单核验类目与当前受控配置不一致：${targetPlan.key}`);
    }
    for (const chunk of targetPlan.chunks) {
      if (!chunk.batchId || !chunk.rowCount || !chunk.importProof) throw new Error("市场榜单计划缺少严格导入批次证明");
      const { evidence } = await inspectSignedChunk(plan, config, target, chunk);
      assertJdMarketImportProof(chunk.importProof, evidence);
      if (chunk.batchId !== chunk.importProof.batchId || chunk.rowCount !== chunk.importProof.rowCount) {
        throw new Error("市场榜单计划批次摘要与严格导入证明不一致");
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
  if (route === "/jd-market/plan") {
    return ["ready", "planned", "executed", "completed"].includes(stage)
      ? null
      : { error: "invalid_stage" as const, expected: "ready|planned|executed|completed", actual: stage };
  }
  if (route === "/jd-market/run") {
    return stage === "planned" || stage === "executed"
      ? null
      : { error: "invalid_stage" as const, expected: "planned|executed", actual: stage };
  }
  return stage === "executed" || stage === "completed"
    ? null
    : { error: "invalid_stage" as const, expected: "executed|completed", actual: stage };
}
