import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  boundedNetshopInteger,
  isNetshopIsoDate,
  netshopOutletKey,
  NETSHOP_OUTLET_MAX_ITEMS,
  NETSHOP_QUERY_MAX_PAGE,
  NETSHOP_QUERY_MAX_PAGE_SIZE,
  NetshopQueryError,
  netshopQueryErrorPayload,
  normalizeNetshopOutletFilters,
  readNetshopOutletFilters,
  readNetshopQueryInteger,
  resolveNetshopQueryPeriod,
} from "../lib/netshop/query-contract";
import { NetshopSchemaUpgradePendingError } from "../lib/netshop/daily-row-migration";

test("netshop periods require valid paired natural dates and expose a left-closed right-open boundary", () => {
  assert.equal(resolveNetshopQueryPeriod(undefined, undefined), null);
  assert.deepEqual(resolveNetshopQueryPeriod("2026-08-01", "2026-08-18"), {
    startDate: "2026-08-01",
    endDate: "2026-08-18",
    endExclusive: "2026-08-19",
    days: 18,
  });
  assert.equal(isNetshopIsoDate("2024-02-29"), true);
  assert.equal(isNetshopIsoDate("2026-02-29"), false);
  assert.throws(() => resolveNetshopQueryPeriod("2026-08-01", undefined), NetshopQueryError);
  assert.throws(() => resolveNetshopQueryPeriod("2026-02-30", "2026-03-01"), /有效的 YYYY-MM-DD/);
  assert.throws(() => resolveNetshopQueryPeriod("2026-08-31", "2026-08-01"), /不能晚于/);
  assert.throws(() => resolveNetshopQueryPeriod("9999-12-31", "9999-12-31"), /超出支持范围/);
  assert.doesNotThrow(() => resolveNetshopQueryPeriod("2024-01-01", "2025-12-30"));
  assert.throws(() => resolveNetshopQueryPeriod("2024-01-01", "2025-12-31"), /最多支持 730 天/);
});

test("netshop pagination is strictly bounded at both URL and domain boundaries", () => {
  assert.equal(readNetshopQueryInteger(null, "page", 1, 1, NETSHOP_QUERY_MAX_PAGE), 1);
  assert.equal(readNetshopQueryInteger("10000", "page", 1, 1, NETSHOP_QUERY_MAX_PAGE), 10_000);
  assert.equal(boundedNetshopInteger(100, "pageSize", 50, 1, NETSHOP_QUERY_MAX_PAGE_SIZE), 100);
  for (const value of ["0", "1.5", "10001", "1e2", "1e308", "NaN", "+1", " 1 "]) {
    assert.throws(() => readNetshopQueryInteger(value, "page", 1, 1, NETSHOP_QUERY_MAX_PAGE), NetshopQueryError);
  }
  assert.throws(() => boundedNetshopInteger(Number.NaN, "pageSize", 50, 1, NETSHOP_QUERY_MAX_PAGE_SIZE), NetshopQueryError);
});

test("netshop outlet filters preserve platform plus shop identity and reject malformed or oversized input", () => {
  const values = [
    netshopOutletKey("京东", "同名店"),
    netshopOutletKey("天猫", "同名店"),
    netshopOutletKey("京东", "同名店"),
  ];
  assert.deepEqual(readNetshopOutletFilters(values), [
    { platform: "京东", shopName: "同名店" },
    { platform: "天猫", shopName: "同名店" },
  ]);
  for (const invalid of ["同名店", "京东\u001f", "\u001f同名店", "京东\u001f同名店\u001f额外", "京\u0000东\u001f同名店"]) {
    assert.throws(() => readNetshopOutletFilters([invalid]), NetshopQueryError);
  }
  const oversized = Array.from({ length: NETSHOP_OUTLET_MAX_ITEMS + 1 }, () => netshopOutletKey("京东", "同名店"));
  assert.throws(() => readNetshopOutletFilters(oversized), /最多 50 项/);
  try {
    readNetshopOutletFilters(oversized);
    assert.fail("oversized outlet filter should fail");
  } catch (error) {
    assert.deepEqual(netshopQueryErrorPayload(error, "读取失败"), {
      body: { error: "outlet 筛选最多 50 项", code: "too_many_outlet_filters" },
      status: 400,
    });
  }
  assert.throws(
    () => normalizeNetshopOutletFilters(Array.from({ length: NETSHOP_OUTLET_MAX_ITEMS + 1 }, (_, index) => ({ platform: "京东", shopName: `店-${index}` }))),
    /最多 50 项/,
  );
});

test("netshop query errors are public while unexpected database details are redacted", () => {
  const expected = netshopQueryErrorPayload(new NetshopQueryError("invalid_date", "日期无效"), "读取失败");
  assert.deepEqual(expected, { body: { error: "日期无效", code: "invalid_date" }, status: 400 });
  const unexpected = netshopQueryErrorPayload(new Error("no such table: secret_rows"), "读取失败");
  assert.deepEqual(unexpected, { body: { error: "读取失败", code: "internal_error" }, status: 500 });
  const pending = netshopQueryErrorPayload(new NetshopSchemaUpgradePendingError(), "读取失败");
  assert.deepEqual(pending, {
    body: { error: "网店数据正在升级，请稍后重试", code: "service_unavailable" },
    status: 503,
  });
});

test("every netshop route maps schema-upgrade pending to a safe public response", async () => {
  const queryRoutes = await Promise.all([
    "products",
    "product-performance",
    "promotion-performance",
  ].map((name) => readFile(new URL(`../app/api/netshop/${name}/route.ts`, import.meta.url), "utf8")));
  const safeRoutes = await Promise.all([
    "overview",
    "import",
  ].map((name) => readFile(new URL(`../app/api/netshop/${name}/route.ts`, import.meta.url), "utf8")));
  for (const source of queryRoutes) {
    assert.match(source, /netshopQueryErrorPayload\(error,/);
    assert.match(source, /readNetshopOutletFilters\(params\.getAll\("outlet"\)\)/);
    assert.match(source, /params\.has\("shop"\)/);
    assert.doesNotMatch(source, /getAll\("shop"\)[\s\S]{0,120}slice\(0, 50\)/);
  }
  for (const source of safeRoutes) assert.match(source, /safeApiErrorResponse\(error,/);
  for (const source of [...queryRoutes, ...safeRoutes]) {
    assert.doesNotMatch(source, /error instanceof Error \? error\.message/);
    assert.match(source, /cache-control["']?:?\s*["']no-store/);
  }
  assert.match(queryRoutes[0]!, /salesChannels: principal\.scope === null \? null : principal\.scope\.channels/);
});

test("netshop query indexes are identical in the forward migration and runtime upgrade", async () => {
  const [runtime, dailyMigration, migration] = await Promise.all([
    readFile(new URL("../lib/netshop/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/netshop/daily-row-migration.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0060_market_netshop_query_safety.sql", import.meta.url), "utf8"),
  ]);
  for (const source of [runtime, migration]) {
    assert.match(source, /netshop_rows_source_dataset_scope_date_idx/);
    assert.match(source, /netshop_import_batches_latest_product_idx/);
  }
  for (const source of [dailyMigration, migration]) {
    assert.match(source, /netshop_rows_daily_natural_identity_idx/);
    assert.match(source, /CASE WHEN `?dataset`?\s*=\s*'sku_daily' THEN `?sku_id`? ELSE `?spu_id`? END/);
  }
  assert.match(runtime, /DAILY_ROW_NATURAL_IDENTITY_INDEX_SQL/);
  assert.doesNotMatch(runtime, /PRAGMA index_(?:info|list)[\s\S]{0,200}\.catch\(\(\) =>/);
  assert.match(runtime, /\.then\(\(\) => ensureDailyRowNaturalKeys\(db\)\)[\s\S]*?schemaReadyByDatabase\.delete\(key\)/);
});

test("netshop import-history route parses strict decimal pagination before listing", async () => {
  const route = await readFile(new URL("../app/api/netshop/import/route.ts", import.meta.url), "utf8");
  assert.match(route, /readNetshopQueryInteger\(params\.get\("page"\)/);
  assert.match(route, /params\.get\("pageSize"\) \?\? params\.get\("limit"\)/);
  assert.match(route, /listNetshopImportBatches\(db,\s*\{\s*page,\s*pageSize,/);
  assert.doesNotMatch(route, /Number\(params\.get\("(?:page|pageSize|limit)"\)/);
});
