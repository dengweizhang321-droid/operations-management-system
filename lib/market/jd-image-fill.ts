import type { Frame, Page } from "playwright-core";

import { assertJdProductDetailStoreIdentity, parseJdProductDetailStoreIdentity } from "../jd/product-detail-store-identity";
import { normalizeJdMarketRepairImageUrl, type MarketImageFillCandidate, type MarketImageFillMapping } from "./image-repair-contract";

// Shared by tools/jd-market-image-repair.ts and tools/jd-market-ranking-daily.ts. It must stay free of
// module-URL based path lookups so the immutable Worker helper bundle can include it.
const targetUrl = "https://jdsz.jd.com/szweb/view/industry/industry-product-rank-temp.html?sz=%2Fszweb%2Fsz%2Fview%2FindustryMarket%2FproductRanks.html";

export type MarketImageCacheRequest = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type CandidatePage = { items: MarketImageFillCandidate[]; pagination: { page: number; pageSize: number; pageCount: number; total: number } };

export type JdMarketImageFillResult = {
  candidateIdentityCount: number;
  requestedSkuCount: number;
  resolvedSkuCount: number;
  unresolvedSkuCount: number;
  entriesFilled: number;
  snapshotsFilled: number;
  skippedIdentityCount: number;
  truncated: boolean;
};

const FILL_POST_BATCH_SIZE = 200;
export const JD_MARKET_IMAGE_FILL_MAX_SKUS = 5_000;
const JD_MARKET_IMAGE_FILL_DEADLINE_MS = 10 * 60_000;

export function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("市场图片修复只允许访问本机运营系统根地址");
  }
  return url.toString().replace(/\/$/, "");
}

export async function jsonRequest<T>(url: string, init?: RequestInit, request: MarketImageCacheRequest = fetch) {
  const timeoutSignal = AbortSignal.timeout(120_000);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  const response = await request(url, { ...init, signal });
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error || `运营系统请求失败：HTTP ${response.status}`);
  return body;
}

/** Identities whose sku_code has no non-empty image_url in any ranking row; bounded by distinct SKU count. */
export async function readFillCandidates(baseUrl: string, maxSkus: number, request: MarketImageCacheRequest = fetch) {
  const items: MarketImageFillCandidate[] = [];
  const skus = new Set<string>();
  let truncated = false;
  for (let page = 1; ; page += 1) {
    const body = await jsonRequest<CandidatePage>(`${baseUrl}/api/market/images/repair?mode=fill&page=${page}&pageSize=200`, undefined, request);
    for (const item of body.items) {
      if (!skus.has(item.skuCode) && skus.size >= maxSkus) { truncated = true; continue; }
      skus.add(item.skuCode);
      items.push(item);
    }
    if (page >= body.pagination.pageCount) break;
    if (skus.size >= maxSkus) { truncated = true; break; }
  }
  return { items, truncated };
}

async function applyFills(baseUrl: string, fills: MarketImageFillMapping[], request: MarketImageCacheRequest = fetch) {
  const totals = { entriesFilled: 0, snapshotsFilled: 0, skipped: 0 };
  for (let index = 0; index < fills.length; index += FILL_POST_BATCH_SIZE) {
    const body = await jsonRequest<{ result: typeof totals }>(`${baseUrl}/api/market/images/repair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fills: fills.slice(index, index + FILL_POST_BATCH_SIZE) }),
    }, request);
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += Number(body.result[key] ?? 0);
  }
  return totals;
}

export async function assertStoreIdentity(page: Page, expected: { shopId: string; shopName: string }) {
  // Product ranking rows also contain mall links after their data finishes
  // loading. Only the signed-in shop link in the page header is authoritative.
  const links = page.locator('.user-info .shop-name a[href*="mall.jd.com/index-"]').filter({ visible: true });
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
  let networkState: { headers: Record<string, string>; url: string } | null = null;
  let imageHeaders: Record<string, string> | null = null;
  const replayableHeaderNames = new Set(["accept", "p-pin", "user-mnp", "user-mup", "uuid", "x-requested-with"]);
  page.on("request", (request) => {
    const replayableHeaders = Object.fromEntries(Object.entries(request.headers()).filter(([name]) => replayableHeaderNames.has(name.toLowerCase())));
    if (/\/sz\/api\/industry\/getImageURL\.ajax/.test(request.url())) {
      imageHeaders = replayableHeaders;
      return;
    }
    if (/\/sz\/api\/industryMarket\/getProductBillBoardDealData\.ajax/.test(request.url())
      && new URL(request.url()).searchParams.get("unitType") === "1") {
      networkState = { url: request.url(), headers: replayableHeaders };
    }
  });
  await page.addInitScript(() => {
    const target = window as typeof window & { __teruisiImageRepairRank?: { headers: Record<string, string>; url: string } };
    const rawOpen = XMLHttpRequest.prototype.open;
    const invokeOpen = rawOpen as unknown as (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ) => void;
    const rawHeader = XMLHttpRequest.prototype.setRequestHeader;
    const rawSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ) {
      (this as XMLHttpRequest & { __teruisiUrl?: string }).__teruisiUrl = String(url);
      return async === undefined
        ? invokeOpen.call(this, method, url)
        : invokeOpen.call(this, method, url, async, username, password);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (...args: Parameters<XMLHttpRequest["setRequestHeader"]>) {
      const request = this as XMLHttpRequest & { __teruisiHeaders?: Record<string, string> };
      (request.__teruisiHeaders ??= {})[args[0]] = args[1];
      return rawHeader.apply(this, args as never);
    };
    XMLHttpRequest.prototype.send = function (...args: Parameters<XMLHttpRequest["send"]>) {
      const request = this as XMLHttpRequest & { __teruisiUrl?: string; __teruisiHeaders?: Record<string, string> };
      if (/\/sz\/api\/industryMarket\/getProductBillBoardDealData\.ajax/.test(request.__teruisiUrl ?? "") && request.__teruisiHeaders) {
        target.__teruisiImageRepairRank = { headers: { ...request.__teruisiHeaders }, url: request.__teruisiUrl! };
      }
      return rawSend.apply(this, args as never);
    };
  });
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  let frame = page.frames().find((candidate) => /productRanks\.html/.test(candidate.url()));
  if (!frame) throw new Error("未找到京东商品榜单业务框架");
  await ensureSkuDimension(frame);
  let state: { headers: Record<string, string>; url: string } | null = null;
  for (let attempt = 0; attempt < 300 && (!state || !imageHeaders); attempt += 1) {
    state = await frame.evaluate(() => (window as typeof window & { __teruisiImageRepairRank?: { headers: Record<string, string>; url: string } }).__teruisiImageRepairRank ?? null).catch(() => null) ?? networkState;
    if (!state || !imageHeaders) await frame.waitForTimeout(100);
  }
  if (!state || !imageHeaders || new URL(state.url, targetUrl).searchParams.get("unitType") !== "1") {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    frame = page.frames().find((candidate) => /productRanks\.html/.test(candidate.url()));
    if (!frame) throw new Error("重新加载后未找到京东商品榜单业务框架");
    await ensureSkuDimension(frame);
    state = null;
    networkState = null;
    imageHeaders = null;
    for (let attempt = 0; attempt < 300 && (!state || !imageHeaders); attempt += 1) {
      state = await frame.evaluate(() => (window as typeof window & { __teruisiImageRepairRank?: { headers: Record<string, string>; url: string } }).__teruisiImageRepairRank ?? null).catch(() => null) ?? networkState;
      if (!state || !imageHeaders) await frame.waitForTimeout(100);
    }
  }
  if (!state || !imageHeaders || new URL(state.url, targetUrl).searchParams.get("unitType") !== "1") throw new Error("未捕获到京东商品榜单 SKU 与图片原生请求头");
  return { headers: imageHeaders, frame };
}

export function recordValue(value: unknown): Record<string, unknown> | null {
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

export function summarizeJdMarketRepairImageResponse(body: unknown) {
  const root = recordValue(body);
  const content = recordValue(root?.content);
  return {
    rootKeys: Object.keys(root ?? {}).slice(0, 12),
    contentKeys: Object.keys(content ?? {}).slice(0, 12),
    code: String(root?.code ?? root?.errorCode ?? content?.code ?? content?.errorCode ?? "").slice(0, 80),
    status: String(root?.status ?? content?.status ?? "").slice(0, 80),
    message: String(root?.message ?? content?.message ?? "").replace(/[\r\n]+/g, " ").slice(0, 160),
    success: root?.success ?? content?.success ?? null,
  };
}

type FetchJdImagesOptions = {
  /** Pause after each batch; the repair tool historically used 100 ms. */
  delayMs?: number;
  /** Skip batches with no verifiable image instead of failing the whole run (stops after 3 in a row). */
  tolerateEmptyBatches?: boolean;
  deadlineAt?: number;
  /** Out-parameter: set when the loop stopped before every SKU was asked about. */
  state?: { stoppedEarly: boolean };
};

export async function fetchJdImages(frame: Pick<Frame, "evaluate" | "waitForTimeout">, skuIds: string[], headers: Record<string, string>, options: FetchJdImagesOptions = {}) {
  const images = new Map<string, string>();
  const requestedBatchSize = Number(process.env.JD_MARKET_IMAGE_REPAIR_BATCH_SIZE ?? 50);
  const batchSize = Number.isInteger(requestedBatchSize) && requestedBatchSize >= 1 && requestedBatchSize <= 50 ? requestedBatchSize : 50;
  let emptyInARow = 0;
  for (let index = 0; index < skuIds.length; index += batchSize) {
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) {
      if (options.state) options.state.stoppedEarly = true;
      break;
    }
    const chunk = skuIds.slice(index, index + batchSize);
    const body = await frame.evaluate(async ({ ids, requestHeaders }) => {
      const response = await fetch(`/sz/api/industry/getImageURL.ajax?ids=${ids.join(",")}`, {
        credentials: "include",
        headers: requestHeaders,
      });
      const value = await response.json();
      if (!response.ok) throw new Error(`京东商品图片接口请求失败：HTTP ${response.status}`);
      return value as unknown;
    }, { ids: chunk, requestHeaders: headers });
    const parsed = parseJdMarketRepairImageResponse(body);
    if (parsed.size === 0) {
      if (!options.tolerateEmptyBatches) {
        throw new Error(`京东商品图片接口未返回可验证主图：${JSON.stringify(summarizeJdMarketRepairImageResponse(body))}`);
      }
      emptyInARow += 1;
      if (emptyInARow >= 3) {
        if (options.state) options.state.stoppedEarly = true;
        break;
      }
    } else {
      emptyInARow = 0;
    }
    for (const [skuId, imageUrl] of parsed) images.set(skuId, imageUrl);
    await frame.waitForTimeout(options.delayMs ?? 100);
  }
  return images;
}

export function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string) {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new Error(`${label} 必须是 ${minimum}–${maximum} 的整数`);
  }
  return candidate;
}

function emptyFillResult(overrides: Partial<JdMarketImageFillResult> = {}): JdMarketImageFillResult {
  return {
    candidateIdentityCount: 0, requestedSkuCount: 0, resolvedSkuCount: 0, unresolvedSkuCount: 0,
    entriesFilled: 0, snapshotsFilled: 0, skippedIdentityCount: 0, truncated: false, ...overrides,
  };
}

/**
 * Fill empty image_url values for SKUs that never had an image, using an ALREADY-OPEN
 * jdsz page. It never takes the Chromium run lock: the caller either holds it
 * (daily ranking run) or wraps this call in it (standalone repair tool).
 */
export async function fillMissingImagesOnOpenPage(
  page: Page,
  expectedStore: { shopId: string; shopName: string },
  options: {
    baseUrl: string;
    request?: MarketImageCacheRequest;
    maxSkus?: number;
    delayMs?: number;
    deadlineMs?: number;
  },
): Promise<JdMarketImageFillResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const maxSkus = boundedInteger(options.maxSkus, JD_MARKET_IMAGE_FILL_MAX_SKUS, 1, 100_000, "图片补全 SKU 上限");
  const deadlineAt = Date.now() + boundedInteger(options.deadlineMs, JD_MARKET_IMAGE_FILL_DEADLINE_MS, 1_000, 3_600_000, "图片补全时限");
  const { items, truncated: candidatesTruncated } = await readFillCandidates(baseUrl, maxSkus, options.request);
  if (!items.length) return emptyFillResult({ truncated: candidatesTruncated });
  const skuIds = [...new Set(items.map((candidate) => candidate.skuCode))];
  const { headers, frame } = await captureSkuHeaders(page);
  await assertStoreIdentity(page, expectedStore);
  const state = { stoppedEarly: false };
  const images = await fetchJdImages(frame, skuIds, headers, { delayMs: options.delayMs, tolerateEmptyBatches: true, deadlineAt, state });
  const fills: MarketImageFillMapping[] = items.flatMap((candidate) => {
    const imageUrl = images.get(candidate.skuCode);
    return imageUrl ? [{
      category: candidate.category, scope: candidate.scope, rankingDimension: candidate.rankingDimension,
      skuCode: candidate.skuCode, imageUrl,
    }] : [];
  });
  const applied = fills.length ? await applyFills(baseUrl, fills, options.request) : { entriesFilled: 0, snapshotsFilled: 0, skipped: 0 };
  const resolvedSkuCount = new Set(fills.map((fill) => fill.skuCode)).size;
  return {
    candidateIdentityCount: items.length,
    requestedSkuCount: skuIds.length,
    resolvedSkuCount,
    unresolvedSkuCount: skuIds.length - resolvedSkuCount,
    entriesFilled: applied.entriesFilled,
    snapshotsFilled: applied.snapshotsFilled,
    skippedIdentityCount: applied.skipped,
    truncated: candidatesTruncated || state.stoppedEarly,
  };
}
