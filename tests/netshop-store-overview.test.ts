import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseShellLocation, serializeShellLocation, normalizeShellLocation, updateModuleViewLocation, defaultStoreOverviewLocation } from "../app/shell/navigation-contract";
import { overviewMetricKeys, formatOverviewMetric, decodeStoreOverview, type OverviewMetric } from "../lib/netshop/store-overview-contract";

test("balanced view keeps exact shop keys and date intent through refresh and navigation", () => {
  const url = "/?module=shop&view=outlets&overviewView=balanced&overviewPlatform=京东&overviewOutlet=京东%1FA&overviewTrend=week&period=custom&from=2026-09-24&to=2026-09-30&periodIntent=rolling#report";
  const state = parseShellLocation(url);
  assert.equal(state.overview?.view, "balanced");
  assert.deepEqual(state.overview?.outlets, ["京东\x1fA"]);
  assert.deepEqual(state.period, { kind: "custom", from: "2026-09-24", to: "2026-09-30", intent: "rolling" });
  assert.deepEqual(parseShellLocation(serializeShellLocation(state, url)), state);
  const explicitCustom = serializeShellLocation({ ...state, period: { kind: "custom", from: "2026-09-24", to: "2026-09-30" } }, url);
  assert.deepEqual(parseShellLocation(explicitCustom).period, { kind: "custom", from: "2026-09-24", to: "2026-09-30" });
  const changed = serializeShellLocation({ ...state, period: { kind: "custom", from: "2026-09-05", to: "2026-09-20" } }, url);
  assert.equal(parseShellLocation(changed).overview?.trend, "week");
  assert.deepEqual(parseShellLocation(changed).period, { kind: "custom", from: "2026-09-05", to: "2026-09-20" });
  assert.equal(new URL(normalizeShellLocation(url), "http://local").hash, "#report");
  assert.equal(parseShellLocation(updateModuleViewLocation(url, "shop", "products")).overview, undefined);
});

test("old bookmarks and invalid mode retain classic; cross-platform keys are removed", () => {
  assert.equal(parseShellLocation("/?module=shop&view=outlets").overview?.view, "classic");
  assert.equal(parseShellLocation("/?module=shop&view=outlets&overviewView=other").overview?.view, "classic");
  const state = parseShellLocation("/?module=shop&view=outlets&overviewView=balanced&overviewOutlet=京东%1FSame");
  assert.deepEqual(state.overview?.outlets, []);
  assert.equal(parseShellLocation("/?module=sales&overviewView=balanced").overview, undefined);
  assert.equal(defaultStoreOverviewLocation.view, "classic");
});

test("cents, ratios and percentage points keep units and unavailable differs from zero", () => {
  const m: OverviewMetric = { value: 1_000_000, unit: "CNY_CENT", status: "available", reasonCode: null, basis: "product_day_sum", sourceIds: ["jd_sku_daily"], aggregation: "sum" };
  assert.equal(formatOverviewMetric(m), "1.00");
  assert.equal(formatOverviewMetric(m, "yuan"), "10,000.00");
  assert.equal(formatOverviewMetric({ ...m, unit: "RATIO", value: 1.5 }), "150.00%");
  assert.equal(formatOverviewMetric({ ...m, unit: "MULTIPLE", value: 2 }), "2.00 倍");
  assert.equal(formatOverviewMetric({ ...m, value: 0 }), "0.00");
  assert.equal(formatOverviewMetric({ ...m, value: null, status: "unavailable" }), "—");
});

test("DTO decoder rejects malformed success, non-finite values and unsafe cents", () => {
  assert.throws(() => decodeStoreOverview({ schemaVersion: "netshop-store-overview-v1" }));
  const summary = Object.fromEntries(overviewMetricKeys.map(k => [k, { value: null, unit: "COUNT", status: "unavailable", reasonCode: "unverified_source", basis: "unverified", sourceIds: [], aggregation: "source_value_only" }]));
  const base = { schemaVersion: "netshop-store-overview-v1", scopeKey: "a".repeat(64), overviewToken: "b".repeat(64), filters: { platform: "京东", shopKeys: [], trendGrain: "day", detailGrain: "day" }, periods: { timezone: "Asia/Shanghai", current: { startDate: "2026-09-01", endDate: "2026-09-01", endExclusive: "2026-09-02", days: 1 }, previous: { startDate: "2026-08-31", endDate: "2026-08-31", endExclusive: "2026-09-01", days: 1 }, yearAgo: { startDate: "2025-09-01", endDate: "2025-09-01", endExclusive: "2025-09-02", days: 1 } }, summary };
  for (const value of [Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => decodeStoreOverview({ ...base, summary: { ...summary, payment: { ...summary.payment, unit: "CNY_CENT", status: "available", value } } }));
  }
});

test("only active overview mounts; all reads are cancellable and stale scopes are hidden", async () => {
  const [view, balanced, route] = await Promise.all(["app/shop-module-view.tsx", "app/netshop-overview/balanced-overview.tsx", "app/api/netshop/store-overview/route.ts"].map(p => readFile(p, "utf8")));
  assert.match(view, /props\.overview\.view === "balanced"/);
  assert.match(view, /<ClassicShopView/);
  assert.match(view, /createReloadableLazy\("shop-balanced"/);
  assert.match(view, /returnLabel="返回旧视图"/);
  assert.match(balanced, /controller\.signal\.aborted \|\| id !== generation\.current/);
  assert.match(balanced, /loaded\?\.key === requestKey/);
  assert.match(balanced, /return \(\) => controller\.abort\(\)/);
  assert.match(route, /requireAppPrincipal/);
  assert.match(route, /service: "reader"/);
  assert.doesNotMatch(route, /service: "writer"/);
});
