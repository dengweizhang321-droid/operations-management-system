import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Page } from "playwright-core";

import { closeChromeBrowser, launchDedicatedChrome, waitForChrome } from "../lib/jackyun/cdp-client";
import { connectPlaywrightBrowser, connectPlaywrightJackyunTarget } from "../lib/jackyun/playwright-client";
import { withJdChromiumRunLock } from "../lib/jd/chromium-run-lock";
import { assertJdProductDetailStoreIdentity, parseJdProductDetailStoreIdentity } from "../lib/jd/product-detail-store-identity";
import { getJdStore } from "../lib/jd/store-registry";
import { normalizeJdMarketRepairImageUrl, type MarketImageRepairCandidate, type MarketImageRepairMapping } from "../lib/market/image-repair";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(projectRoot, "config", "jd-market-ranking-daily.json");
const targetUrl = "https://jdsz.jd.com/szweb/view/industry/industry-product-rank-temp.html?sz=%2Fszweb%2Fsz%2Fview%2FindustryMarket%2FproductRanks.html";

type CandidatePage = { items: MarketImageRepairCandidate[]; pagination: { page: number; pageSize: number; pageCount: number; total: number } };

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("市场图片修复只允许访问本机运营系统根地址");
  }
  return url.toString().replace(/\/$/, "");
}

async function jsonRequest<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(120_000) });
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error || `运营系统请求失败：HTTP ${response.status}`);
  return body;
}

async function readRepairCandidates(baseUrl: string) {
  const first = await jsonRequest<CandidatePage>(`${baseUrl}/api/market/images/repair?page=1&pageSize=200`);
  const items = [...first.items];
  for (let page = 2; page <= first.pagination.pageCount; page += 1) {
    const next = await jsonRequest<CandidatePage>(`${baseUrl}/api/market/images/repair?page=${page}&pageSize=200`);
    items.push(...next.items);
  }
  return items;
}

async function applyRepairs(baseUrl: string, repairs: MarketImageRepairMapping[]) {
  const totals = { repairCount: 0, rankingRowsUpdated: 0, snapshotsUpdated: 0, inheritedPrices: 0 };
  for (let index = 0; index < repairs.length; index += 20) {
    const body = await jsonRequest<{ result: typeof totals }>(`${baseUrl}/api/market/images/repair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repairs: repairs.slice(index, index + 20) }),
    });
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += Number(body.result[key] ?? 0);
  }
  return totals;
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

async function ensureSkuDimension(frame: Frame) {
  const surface = frame.locator("#sz-old-version").filter({ visible: true });
  await surface.first().waitFor({ state: "visible", timeout: 30_000 });
  if (await surface.count() !== 1) throw new Error("京东商品榜单受控业务容器不唯一");
  const controls = surface.first().locator(".jmtd-base-input-top").filter({ visible: true });
  await controls.first().waitFor({ state: "visible", timeout: 30_000 });
  if (await controls.count() < 3) throw new Error("京东商品榜单筛选控件不完整");
  if ((await controls.nth(0).innerText()).trim() === "SKU") return;
  await controls.nth(0).click();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const options = surface.first().locator(".jmtd-dropdown-option").filter({ visible: true }).filter({ hasText: /^SKU$/ });
    if (await options.count() === 1 && await options.first().click({ timeout: 3_000, force: true }).then(() => true).catch(() => false)) return;
    await frame.waitForTimeout(100);
  }
  throw new Error("京东商品榜单无法精确切换到 SKU 维度");
}

async function captureSkuHeaders(page: Page) {
  let headers: Record<string, string> | null = null;
  page.on("request", (request) => {
    if (!/\/sz\/api\/industryMarket\/getProductBillBoardDealData\.ajax/.test(request.url())) return;
    const params = new URL(request.url()).searchParams;
    if (params.get("unitType") === "1") headers = request.headers();
  });
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const frame = page.frames().find((candidate) => /productRanks\.html/.test(candidate.url()));
  if (!frame) throw new Error("未找到京东商品榜单业务框架");
  await ensureSkuDimension(frame);
  for (let attempt = 0; attempt < 300 && !headers; attempt += 1) await frame.waitForTimeout(100);
  if (!headers) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    for (let attempt = 0; attempt < 300 && !headers; attempt += 1) await page.waitForTimeout(100);
  }
  if (!headers) throw new Error("未捕获到京东商品榜单 SKU 原生请求头");
  return headers;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseJdMarketRepairImageResponse(body: unknown) {
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
  const images = new Map<string, string>();
  for (const row of rows) {
    const skuId = String(row.skuId ?? row.skuID ?? row.sku ?? row.id ?? "").trim();
    const imageUrl = normalizeJdMarketRepairImageUrl(row.imgSrc ?? row.imageUrl ?? row.imgUrl);
    if (skuId && imageUrl) images.set(skuId, imageUrl);
  }
  return images;
}

async function fetchJdImages(page: Page, skuIds: string[], headers: Record<string, string>) {
  const images = new Map<string, string>();
  for (let index = 0; index < skuIds.length; index += 50) {
    const chunk = skuIds.slice(index, index + 50);
    const body = await page.evaluate(async ({ ids, requestHeaders }) => {
      const response = await fetch(`/sz/api/industry/getImageURL.ajax?ids=${ids.join(",")}`, {
        credentials: "include",
        headers: requestHeaders,
      });
      const value = await response.json();
      if (!response.ok) throw new Error(`京东商品图片接口请求失败：HTTP ${response.status}`);
      return value as unknown;
    }, { ids: chunk, requestHeaders: headers });
    for (const [skuId, imageUrl] of parseJdMarketRepairImageResponse(body)) images.set(skuId, imageUrl);
    await page.waitForTimeout(100);
  }
  return images;
}

async function cacheRepairedImages(baseUrl: string) {
  let latest = { pending: 0, cached: 0, failed: 0, processed: 0 };
  let noProgressRounds = 0;
  for (let round = 0; round < 250; round += 1) {
    const body = await jsonRequest<{ result: { pending: number; cached: number; failed: number; processed: number; cachedThisRun: number } }>(
      `${baseUrl}/api/market/images/cache`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 24 }) },
    );
    latest = { ...body.result, processed: Number(body.result.processed ?? 0) };
    if (latest.pending <= 0) break;
    noProgressRounds = Number(body.result.processed ?? 0) === 0 ? noProgressRounds + 1 : 0;
    if (noProgressRounds >= 3) break;
  }
  return latest;
}

export async function runJdMarketImageRepair(options: { baseUrl?: string } = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.OPERATIONS_SYSTEM_URL ?? "http://127.0.0.1:3000");
  const candidates = await readRepairCandidates(baseUrl);
  if (!candidates.length) return { ok: true, candidateCount: 0, repairedCount: 0, unresolvedCount: 0 };

  const reusable = candidates.filter((candidate) => normalizeJdMarketRepairImageUrl(candidate.reusableImageUrl));
  const external = candidates.filter((candidate) => !normalizeJdMarketRepairImageUrl(candidate.reusableImageUrl));
  const reusableResult = reusable.length ? await applyRepairs(baseUrl, reusable.map((candidate) => ({
    category: candidate.category, scope: candidate.scope, rankingDimension: candidate.rankingDimension,
    skuCode: candidate.skuCode, imageUrl: candidate.reusableImageUrl,
  }))) : { repairCount: 0, rankingRowsUpdated: 0, snapshotsUpdated: 0, inheritedPrices: 0 };

  let resolvedImages = new Map<string, string>();
  if (external.length) {
    const config = JSON.parse(await readFile(configPath, "utf8")) as { storeKey?: string };
    if (!config.storeKey) throw new Error("京东市场榜单配置缺少受控店铺");
    const store = await getJdStore(config.storeKey);
    resolvedImages = await withJdChromiumRunLock("market-image-repair", async () => {
      const launched = await launchDedicatedChrome({
        executablePath: store.browser.executablePath,
        profileDirectory: store.browser.userDataDir,
        profileName: store.browser.profileName,
        port: store.browser.debugPort,
        startUrl: "about:blank",
        headless: false,
        visible: false,
        startMinimized: true,
        keepWindowHidden: true,
      });
      if (!launched) throw new Error("京东图片修复拒绝复用不受本次窗口守护控制的 Chromium 实例");
      let browser: Awaited<ReturnType<typeof connectPlaywrightBrowser>> | null = null;
      try {
        await waitForChrome(store.browser.debugPort);
        browser = await connectPlaywrightBrowser(store.browser.debugPort);
        const { page } = await connectPlaywrightJackyunTarget(browser, {
          workerName: "teruisi-jd-market-image-repair",
          targetUrlPattern: /jdsz\.jd\.com/i,
          requireMini: false,
        });
        const headers = await captureSkuHeaders(page);
        await assertStoreIdentity(page, store);
        return await fetchJdImages(page, [...new Set(external.map((candidate) => candidate.skuCode))], headers);
      } finally {
        await browser?.close().catch(() => undefined);
        await closeChromeBrowser(store.browser.debugPort);
      }
    });
  }

  const resolved = external.flatMap((candidate) => {
    const imageUrl = resolvedImages.get(candidate.skuCode);
    return imageUrl ? [{
      category: candidate.category, scope: candidate.scope, rankingDimension: candidate.rankingDimension,
      skuCode: candidate.skuCode, imageUrl,
    }] : [];
  });
  const resolvedResult = resolved.length ? await applyRepairs(baseUrl, resolved) : { repairCount: 0, rankingRowsUpdated: 0, snapshotsUpdated: 0, inheritedPrices: 0 };
  const cache = await cacheRepairedImages(baseUrl);
  const repairedCount = reusableResult.repairCount + resolvedResult.repairCount;
  return {
    ok: true,
    candidateCount: candidates.length,
    historicalReuseCount: reusableResult.repairCount,
    jdResolvedCount: resolvedResult.repairCount,
    repairedCount,
    unresolvedCount: candidates.length - repairedCount,
    rankingRowsUpdated: reusableResult.rankingRowsUpdated + resolvedResult.rankingRowsUpdated,
    snapshotsUpdated: reusableResult.snapshotsUpdated + resolvedResult.snapshotsUpdated,
    inheritedPrices: reusableResult.inheritedPrices + resolvedResult.inheritedPrices,
    cache,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runJdMarketImageRepair().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.unresolvedCount > 0) process.exitCode = 2;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
