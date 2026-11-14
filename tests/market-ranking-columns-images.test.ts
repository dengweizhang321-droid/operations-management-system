import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { marketItem } from "../lib/market/cache-payload-validators";
import { FILL_CANDIDATE_PAGE_SIZE, fetchJdImages, readFillCandidates, type JdMarketImageFillResult } from "../lib/market/jd-image-fill";
import { fillMissingImagesBestEffort } from "../tools/jd-market-ranking-daily";

function rankingItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, periodStart: "2026-08-01", periodEnd: "2026-08-31", category: "净水", scope: "全部", rankingDimension: "SKU",
    operationMode: "POP", subcategory: "", rank: 1, previousRank: null, rankChange: null, skuCode: "100001",
    productName: "商品", brand: "品牌", priceCents: null, marketPriceCents: null, candidatePriceCents: null,
    marketPriceSource: "missing", candidatePriceSource: "missing", averageTransactionPriceCents: null,
    discountBps: null, discountReference: false, gmvCents: 405_000_00, quantity: 53, pageViews: 0, visitors: 1000,
    orderCount: 53, averageOrderValueCents: 76_415, gmvIsReal: false, conversionBps: 530, conversionEstimated: true,
    cartCustomers: 0, searchClicks: 0, imageUrl: "", sourceImageUrl: "", imageCacheStatus: "missing", productUrl: "",
    periodCount: 1, isOwn: false, ownSalesCents: 0, gmvOutOfBand: false,
    ...overrides,
  };
}

test("overview ranking item validator requires the new order, average-order and estimate fields", () => {
  assert.equal(marketItem(rankingItem()), true);
  assert.equal(marketItem(rankingItem({ orderCount: null, averageOrderValueCents: null, conversionBps: null, conversionEstimated: false })), true);
  for (const key of ["orderCount", "averageOrderValueCents", "gmvIsReal", "conversionEstimated"]) {
    const item: Record<string, unknown> = rankingItem();
    delete item[key];
    assert.equal(marketItem(item), false, `${key} must be required`);
  }
  assert.equal(marketItem(rankingItem({ gmvIsReal: "yes" })), false);
  assert.equal(marketItem(rankingItem({ orderCount: "53" })), false);
  assert.equal(marketItem(rankingItem({ conversionEstimated: null })), false);
});

function fakeFrame(bodies: unknown[]) {
  const calls: string[][] = [];
  return {
    calls,
    waits: [] as number[],
    async evaluate(_fn: unknown, arg: { ids: string[] }) {
      calls.push(arg.ids);
      return bodies.shift();
    },
    async waitForTimeout(ms: number) { this.waits.push(ms); },
  };
}

const keyedBody = (ids: string[]) => ({ content: { data: Object.fromEntries(ids.map((id) => [id, { imgSrc: `//img10.360buyimg.com/n7/jfs/${id}.jpg` }])) } });

test("JD image fetch keeps the strict failure by default and tolerates empty batches only when asked", async () => {
  const skus = Array.from({ length: 120 }, (_, index) => String(1000 + index));
  const strict = fakeFrame([keyedBody(skus.slice(0, 50)), { code: 601 }]);
  await assert.rejects(fetchJdImages(strict as never, skus, {}), /未返回可验证主图/);

  const tolerant = fakeFrame([keyedBody(skus.slice(0, 50)), { code: 601 }, keyedBody(skus.slice(100))]);
  const state = { stoppedEarly: false };
  const images = await fetchJdImages(tolerant as never, skus, {}, { tolerateEmptyBatches: true, delayMs: 7, state });
  assert.equal(images.size, 50 + 20);
  assert.equal(images.get("1000"), "https://img10.360buyimg.com/n5/jfs/1000.jpg");
  assert.equal(images.has("1050"), false);
  assert.equal(state.stoppedEarly, false);
  assert.deepEqual(tolerant.waits, [7, 7, 7]);
});

test("JD image fetch stops after three consecutive empty batches and at the deadline", async () => {
  const skus = Array.from({ length: 400 }, (_, index) => String(2000 + index));
  const empties = fakeFrame([{}, {}, {}, keyedBody(skus.slice(150, 200))]);
  const state = { stoppedEarly: false };
  const images = await fetchJdImages(empties as never, skus, {}, { tolerateEmptyBatches: true, state });
  assert.equal(images.size, 0);
  assert.equal(empties.calls.length, 3);
  assert.equal(state.stoppedEarly, true);

  const expired = fakeFrame([keyedBody(skus.slice(0, 50))]);
  const deadlineState = { stoppedEarly: false };
  await fetchJdImages(expired as never, skus, {}, { deadlineAt: Date.now() - 1, state: deadlineState });
  assert.equal(expired.calls.length, 0);
  assert.equal(deadlineState.stoppedEarly, true);
});

const planIdentity = { baseUrl: "http://127.0.0.1:3000", shopId: "shop-1", shopName: "店铺" };

test("daily image fill turns every failure into a warning and never throws", async () => {
  const result: JdMarketImageFillResult = {
    candidateIdentityCount: 3, requestedSkuCount: 3, resolvedSkuCount: 2, unresolvedSkuCount: 1,
    entriesFilled: 4, snapshotsFilled: 2, skippedIdentityCount: 0, truncated: false,
  };
  let received: { options: Record<string, unknown>; store: unknown } | null = null;
  const ok = await fillMissingImagesBestEffort({} as never, planIdentity, { requestDelayMs: 500 }, {
    fill: async (_page, store, options) => { received = { options: options as never, store }; return result; },
  });
  assert.equal(ok.ok, true);
  assert.deepEqual("result" in ok ? ok.result : null, result);
  assert.equal(received!.store, planIdentity);
  assert.equal(received!.options.baseUrl, planIdentity.baseUrl);
  assert.equal(received!.options.maxSkus, 5_000);
  assert.equal(received!.options.delayMs, 500);

  const failed = await fillMissingImagesBestEffort({} as never, planIdentity, { requestDelayMs: 500 }, {
    fill: async () => { throw new Error("京东图片接口\n限流 ".repeat(100)); },
  });
  assert.equal(failed.ok, false);
  assert.match("warning" in failed ? failed.warning : "", /^京东图片接口 限流/);
  assert.ok(("warning" in failed ? failed.warning : "").length <= 300);
  assert.doesNotMatch("warning" in failed ? failed.warning : "", /\n/);

  const nonError = await fillMissingImagesBestEffort({} as never, planIdentity, { requestDelayMs: 500 }, {
    fill: async () => { throw "plain string"; },
  });
  assert.deepEqual({ ok: nonError.ok, warning: "warning" in nonError ? nonError.warning : "" }, { ok: false, warning: "plain string" });
});

test("daily run fills images only after the executed stage is persisted, inside the held lock, without touching proofs", async () => {
  const runner = await readFile(new URL("../tools/jd-market-ranking-daily.ts", import.meta.url), "utf8");
  const run = runner.slice(runner.indexOf("export async function runJdMarketDailyPlan"), runner.indexOf("export async function verifyJdMarketDailyPlan"));
  const executed = run.indexOf('plan.stage = "executed"; delete plan.failure; await persistPlan(plan);\n      // Imports are final');
  const fill = run.indexOf("await fillMissingImagesBestEffort(page, plan, config, options)");
  const closing = run.indexOf("await browser?.close()");
  assert.ok(executed > 0 && fill > executed && closing > fill, "fill must sit between the executed persist and the browser close");
  assert.equal(run.split("withJdChromiumRunLock(").length - 1, 1, "the Chromium lock is taken exactly once and never nested");
  assert.doesNotMatch(run.slice(fill, run.indexOf("} catch (error) {", fill)), /plan\.stage\s*=|plan\.failure\s*=|importProof/);
  assert.match(run, /plan\.imageFill = imageFill;\s*await persistPlan\(plan\)\.catch\(\(\) => undefined\)/);
  const helper = runner.slice(runner.indexOf("export async function fillMissingImagesBestEffort"), runner.indexOf("export async function runJdMarketDailyPlan"));
  assert.doesNotMatch(helper, /withJdChromiumRunLock|plan\.stage|persistPlan/);
  const shared = await readFile(new URL("../lib/market/jd-image-fill.ts", import.meta.url), "utf8");
  assert.doesNotMatch(shared, /withJdChromiumRunLock|import\.meta/);
  const repair = await readFile(new URL("../tools/jd-market-image-repair.ts", import.meta.url), "utf8");
  assert.match(repair.slice(repair.indexOf("export async function runJdMarketImageRepair")), /withJdChromiumRunLock\("market-image-repair"/);
  assert.match(repair, /fillMissingImagesOnOpenPage\(page, store,/);
});

test("repair route exposes fill candidates and the fill command without changing apply_image_repairs", async () => {
  const route = await readFile(new URL("../app/api/market/images/repair/route.ts", import.meta.url), "utf8");
  assert.match(route, /mode === "fill" \? "image_fill_candidates" : "image_repair_candidates"/);
  assert.match(route, /action: "fill_missing_images", fills: body\.fills/);
  assert.match(route, /action: "apply_image_repairs", repairs: body\.repairs \?\? \[\]/);
  assert.match(route, /repairs 与 fills 不能同时提交/);
  assert.match(route, /图片修复清单模式无效/);
});

test("ranking table renames sales, adds the order columns and keeps the empty-row span equal to the header count", async () => {
  const view = await readFile(new URL("../app/market-view.tsx", import.meta.url), "utf8");
  const table = view.slice(view.indexOf("function RankingTable"), view.indexOf("function TrendDrawer"));
  const headers = [...table.slice(table.indexOf("<thead>"), table.indexOf("</thead>")).matchAll(/<th>([^<]*)<\/th>/g)].map((match) => match[1]);
  assert.deepEqual(headers, ["对比", "排名", "商品主图和标题", "预估销售额", "成交件数", "成交单量", "客单价", "市场定位价（主图）", "成交均价", "访客", "转化率", "排名变化", "趋势操作"]);
  assert.match(table, new RegExp(`colSpan=\\{${headers.length}\\}`));
  assert.match(table, /item\.gmvIsReal \? "自有·真实值" : "竞品·估算"/);
  assert.match(table, /item\.conversionEstimated && <small>估算<\/small>/);
  assert.match(table, /item\.orderCount === null \? "-" : count\(item\.orderCount\)/);
  const trend = view.slice(view.indexOf("function TrendDrawer"), view.indexOf("function CompareWorkspace"));
  assert.match(trend, /<th>月份<\/th><th>预估销售额<\/th>/);
});

function candidatePager(total: number) {
  const urls: string[] = [];
  const request = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    urls.push(url.search);
    const page = Number(url.searchParams.get("page"));
    const pageSize = Number(url.searchParams.get("pageSize"));
    const first = (page - 1) * pageSize;
    const items = Array.from({ length: Math.max(0, Math.min(pageSize, total - first)) }, (_, offset) => ({
      category: "净水", scope: "全部", rankingDimension: "SKU", skuCode: `sku-${first + offset}`,
      productName: "", brand: "", productUrl: "", periodEnd: "2026-08-31",
    }));
    return new Response(JSON.stringify({ items, pagination: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  return { urls, request };
}

test("fill candidates are read with 1000-row pages so a full run needs at most a handful of server queries", async () => {
  assert.equal(FILL_CANDIDATE_PAGE_SIZE, 1_000);
  const full = candidatePager(6_250);
  const all = await readFillCandidates("http://127.0.0.1:3000", 20_000, full.request);
  assert.equal(all.items.length, 6_250);
  assert.equal(all.truncated, false);
  assert.equal(full.urls.length, 7);
  assert.ok(full.urls.every((search) => search.includes("mode=fill") && search.includes("pageSize=1000")));

  const capped = candidatePager(6_250);
  const bounded = await readFillCandidates("http://127.0.0.1:3000", 5_000, capped.request);
  assert.equal(bounded.items.length, 5_000);
  assert.equal(bounded.truncated, true);
  assert.equal(capped.urls.length, 5, "stops reading as soon as the SKU cap is reached");

  const empty = candidatePager(0);
  assert.deepEqual(await readFillCandidates("http://127.0.0.1:3000", 5_000, empty.request), { items: [], truncated: false });
  assert.equal(empty.urls.length, 1);
});
