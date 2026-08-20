import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { AppPrincipal } from "../lib/auth/authorization";
import { getSalesCategoryAnalysis, SalesCategoryRequestError } from "../lib/sales/category-analysis";
import type { SalesDatabase } from "../lib/sales/database";

type SqlValue = string | number | bigint | Uint8Array | null;

function sqliteAdapter(sqlite: DatabaseSync): SalesDatabase {
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let values: SqlValue[] = [];
      return {
        bind(...nextValues: unknown[]) { values = nextValues as SqlValue[]; return this; },
        async first<T>() { return (statement.get(...values) ?? null) as T | null; },
        async all<T>() { return { results: statement.all(...values) as T[] }; },
        async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
    },
  } as SalesDatabase;
}

const unrestricted: AppPrincipal = { email: "admin@test", displayName: "Admin", role: "admin", scope: null };

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE erp_product_master (product_code TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT '');
    CREATE TABLE sales_order_lines (
      source_line_key TEXT PRIMARY KEY,
      order_no TEXT NOT NULL,
      online_order_no TEXT NOT NULL,
      channel TEXT NOT NULL,
      platform TEXT NOT NULL,
      shop_name TEXT NOT NULL,
      warehouse TEXT NOT NULL,
      product_code TEXT NOT NULL,
      product_name TEXT NOT NULL,
      category TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      allocated_amount_cents INTEGER NOT NULL,
      gross_profit_cents INTEGER NOT NULL,
      ship_time TEXT NOT NULL
    );
    INSERT INTO erp_product_master VALUES ('P1','饮水设备');
    INSERT INTO sales_order_lines VALUES
      ('L1','O1','','渠道A','京东','京东一店','主仓','P1','饮水机','旧类目',2,10000,3000,'2026-07-31 10:00:00'),
      ('L2','O1','','渠道A','京东','京东一店','主仓','P1','饮水机','旧类目',-1,-2000,-500,'2026-08-01 10:00:00'),
      ('L3','O2','','渠道A','京东','京东一店','主仓','P2','制冰机','制冰设备',1,5000,1000,'2026-08-02 10:00:00'),
      ('L4','O3','','渠道A','京东','京东二店','主仓','P3','未知商品','',1,1000,200,'2026-08-02 11:00:00'),
      ('L5','O4','','渠道A','京东','京东一店','刷刷仓','P4','排除商品','排除品类',9,99999,50000,'2026-08-02 12:00:00'),
      ('L6','O5','','渠道B','天猫','天猫一店','主仓','P5','切肉机','食品机械',1,7000,1000,'2026-08-02 13:00:00'),
      ('L8','O7','','渠道A','京东','京东一店','主仓','P1','饮水机','旧类目',1,4000,1000,'2026-07-28 10:00:00'),
      ('L9','O8','','渠道A','京东','京东一店','主仓','P1','饮水机','旧类目',1,5000,1200,'2025-07-31 10:00:00');
  `);
  return { sqlite, db: sqliteAdapter(sqlite) };
}

test("category aggregation uses product master first, keeps refunds, excludes 刷刷仓, and exposes 未分类", async () => {
  const { sqlite, db } = fixture();
  const result = await getSalesCategoryAnalysis(db, {
    startDate: "2026-07-31",
    endDate: "2026-08-02",
    granularity: "month",
    pageSize: 100,
  }, unrestricted);

  assert.equal(result.categoryHierarchy.levels.length, 1);
  assert.equal(result.categoryHierarchy.source.primary, "erp_product_master.category");
  assert.equal(result.summary.grossSalesCents, 23_000);
  assert.equal(result.summary.refundAmountCents, 2_000);
  assert.equal(result.summary.netSalesCents, 21_000);
  assert.equal(result.summary.positiveQuantity, 5);
  assert.equal(result.summary.returnQuantity, 1);
  assert.equal(result.summary.netQuantity, 3);
  assert.equal(result.summary.grossProfitCents, 4_700);
  assert.equal(result.uncategorized.productCount, 1);
  assert.equal(result.uncategorized.netSalesCents, 1_000);
  assert.equal(result.uncategorized.visible, true);
  assert.equal(result.details.items.find((item) => item.category === "未分类")?.netQuantity, 0);
  assert.equal(result.details.pagination.total, 4);
  const water = result.details.items.find((item) => item.category === "饮水设备");
  assert.equal(water?.netSalesCents, 8_000);
  assert.equal(water?.netQuantity, 1);
  assert.equal(water?.refundRate, 0.2);
  assert.equal(water?.previousNetSalesCents, 4_000);
  assert.equal(water?.monthOverMonthRate, 1);
  assert.equal(water?.yearAgoNetSalesCents, 5_000);
  assert.equal(water?.yearOverYearRate, 0.6);
  assert.deepEqual(water?.trend.points, [
    { period: "2026-07", netSalesCents: 10_000 },
    { period: "2026-08", netSalesCents: -2_000 },
  ]);
  assert.equal(water?.trend.changeRate, -1.2);
  assert.equal(water?.trend.direction, "down");
  assert.deepEqual(result.comparisonPeriods, {
    previous: { startDate: "2026-07-28", endDate: "2026-07-30" },
    yearAgo: { startDate: "2025-07-31", endDate: "2025-08-02" },
  });
  assert.equal(result.details.items.some((item) => item.category === "旧类目"), false);
  assert.equal(result.details.items.some((item) => item.category === "排除品类"), false);
  assert.ok(Math.abs(result.details.items.reduce((sum, item) => sum + item.shareRate, 0) - 1) < 1e-12);
  assert.deepEqual([...new Set(result.trend.items.map((item) => item.period))], ["2026-07", "2026-08"]);
  sqlite.close();
});

test("date bounds are inclusive in the request and left-closed/right-open in SQL, including a negative refund-only day", async () => {
  const { sqlite, db } = fixture();
  const result = await getSalesCategoryAnalysis(db, {
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    pageSize: 100,
  }, unrestricted);
  assert.equal(result.range.endExclusive, "2026-08-02");
  assert.equal(result.summary.grossSalesCents, 0);
  assert.equal(result.summary.refundAmountCents, 2_000);
  assert.equal(result.summary.netSalesCents, -2_000);
  assert.equal(result.summary.returnQuantity, 1);
  assert.equal(result.details.items[0]?.shareRate, 1);
  assert.equal(result.details.items[0]?.grossMarginRate, 0.25);
  assert.equal(result.details.items[0]?.refundRate, 0);
  assert.equal(result.details.items[0]?.monthOverMonthRate, -1.2);
  sqlite.close();
});

test("principal warehouse, channel, and platform scope is always intersected with requested filters and empty scope is denied", async () => {
  const { sqlite, db } = fixture();
  const scoped: AppPrincipal = {
    email: "analyst@test",
    displayName: "Analyst",
    role: "analyst",
    scope: { warehouses: [], channels: [], platforms: ["京东"] },
  };
  const result = await getSalesCategoryAnalysis(db, {
    startDate: "2026-07-31",
    endDate: "2026-08-02",
    platforms: ["天猫"],
  }, scoped);
  assert.equal(result.summary.netSalesCents, 0);
  assert.equal(result.details.pagination.total, 0);
  assert.equal(result.filtersApplied.dataScope.mode, "restricted");

  const channelScoped = await getSalesCategoryAnalysis(db, {
    startDate: "2026-07-31",
    endDate: "2026-08-02",
  }, {
    ...scoped,
    scope: { warehouses: ["主仓"], channels: ["渠道A"], platforms: [] },
  });
  assert.equal(channelScoped.summary.netSalesCents, 14_000);
  assert.equal(channelScoped.details.items.some((item) => item.category === "食品机械"), false);
  assert.deepEqual(channelScoped.filtersApplied.dataScope, {
    mode: "restricted",
    warehouses: ["主仓"],
    channels: ["渠道A"],
    platforms: [],
  });

  await assert.rejects(() => getSalesCategoryAnalysis(db, {
    startDate: "2026-07-31",
    endDate: "2026-08-02",
  }, { ...scoped, scope: { warehouses: [], channels: [], platforms: [] } }), /没有可读取的销售数据范围/);
  sqlite.close();
});

test("category detail sorting and pagination remain server-bounded with explicit metadata", async () => {
  const { sqlite, db } = fixture();
  const first = await getSalesCategoryAnalysis(db, {
    startDate: "2026-07-31",
    endDate: "2026-08-02",
    sortBy: "grossProfitCents",
    direction: "asc",
    page: 1,
    pageSize: 2,
  }, unrestricted);
  assert.deepEqual(first.details.items.map((item) => item.category), ["未分类", "制冰设备"]);
  assert.deepEqual(first.details.pagination, { page: 1, pageSize: 2, total: 4, returned: 2, truncated: true });

  const second = await getSalesCategoryAnalysis(db, {
    startDate: "2026-07-31",
    endDate: "2026-08-02",
    sortBy: "grossProfitCents",
    direction: "asc",
    page: 2,
    pageSize: 2,
  }, unrestricted);
  assert.deepEqual(second.details.items.map((item) => item.category), ["食品机械", "饮水设备"]);
  assert.equal(second.details.pagination.truncated, false);

  const comparisonSorted = await getSalesCategoryAnalysis(db, {
    startDate: "2026-07-31",
    endDate: "2026-08-02",
    sortBy: "yearOverYearRate",
    direction: "desc",
    pageSize: 2,
  }, unrestricted);
  assert.equal(comparisonSorted.details.items[0]?.category, "饮水设备");
  assert.equal(comparisonSorted.details.items[0]?.yearOverYearRate, 0.6);
  sqlite.close();
});

test("empty results, invalid hierarchy level, and ranges over 366 days fail or close safely", async () => {
  const { sqlite, db } = fixture();
  const empty = await getSalesCategoryAnalysis(db, {
    startDate: "2025-01-01",
    endDate: "2025-01-02",
  }, unrestricted);
  assert.equal(empty.summary.netSalesCents, 0);
  assert.equal(empty.details.pagination.total, 0);
  assert.equal(empty.details.pagination.returned, 0);
  assert.equal(empty.uncategorized.visible, false);
  await assert.rejects(() => getSalesCategoryAnalysis(db, { startDate: "2026-08-01", endDate: "2026-08-02", level: 2 }, unrestricted), SalesCategoryRequestError);
  await assert.rejects(() => getSalesCategoryAnalysis(db, { startDate: "2025-01-01", endDate: "2026-01-02" }, unrestricted), /最长支持 366 天/);
  sqlite.close();
});

test("zero-net-sales categories stay visible with zero contribution and zero margin", async () => {
  const { sqlite, db } = fixture();
  sqlite.prepare("INSERT INTO sales_order_lines VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
    "L7", "O6", "", "渠道A", "京东", "京东一店", "主仓", "P6", "零销售商品", "零销售", 0, 0, 0, "2026-08-02 14:00:00",
  );
  const result = await getSalesCategoryAnalysis(db, {
    startDate: "2026-08-02",
    endDate: "2026-08-02",
    categories: ["零销售"],
  }, unrestricted);
  assert.equal(result.details.pagination.total, 1);
  assert.equal(result.details.items[0]?.category, "零销售");
  assert.equal(result.details.items[0]?.netSalesCents, 0);
  assert.equal(result.details.items[0]?.shareRate, 0);
  assert.equal(result.details.items[0]?.grossMarginRate, 0);
  sqlite.close();
});

test("net quantity and refund rate reuse the sales summary exclusions and amount-based return rate", async () => {
  const { sqlite, db } = fixture();
  sqlite.exec(`
    INSERT INTO erp_product_master VALUES ('P7','饮水设备');
    INSERT INTO erp_product_master VALUES ('P8','饮水设备');
    INSERT INTO sales_order_lines VALUES
      ('L10','O9','','渠道A','京东','京东一店','主仓','P7','随单配件','配件',5,0,0,'2026-08-02 15:00:00'),
      ('L11','O10','','渠道A','京东','京东一店','主仓','P8','补差价专用','饮水设备',8,0,0,'2026-08-02 16:00:00');
  `);
  const result = await getSalesCategoryAnalysis(db, {
    startDate: "2026-07-31",
    endDate: "2026-08-02",
    categories: ["饮水设备"],
  }, unrestricted);
  assert.equal(result.details.items[0]?.netQuantity, 1);
  assert.equal(result.details.items[0]?.refundRate, 0.2);
  sqlite.close();
});

test("category API, UI, URL state, concurrency guard, and AI registry are wired to bounded authenticated contracts", async () => {
  const [route, page, view, service, registry] = await Promise.all([
    readFile(new URL("../app/api/sales/category-analysis/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/sales-category-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/sales/category-analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/tool-registry.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /requireAppPrincipal\(\["viewer", "analyst", "operator", "admin"\]\)/);
  assert.match(route, /authorizationErrorResponse/);
  assert.match(route, /cache-control": "no-store/);
  assert.match(page, />品类分析</);
  assert.match(page, /useModuleViewState/);
  assert.match(page, /sales: \(\{ range, customStartDate, customEndDate, moduleView, onModuleViewChange \}\)/);
  assert.match(view, /requestGenerationRef/);
  assert.match(view, /controller\.abort\(\)/);
  assert.match(view, /window\.history\[mode === "push" \? "pushState" : "replaceState"\]/);
  assert.match(view, /pagination\.truncated/);
  const detailColumns = view.slice(view.indexOf("const sortableColumns"), view.indexOf("export default function SalesCategoryView"));
  assert.match(detailColumns, /label: "净销量"/);
  assert.match(detailColumns, /label: "退货率"/);
  assert.match(detailColumns, /label: "同比"/);
  assert.match(detailColumns, /label: "环比"/);
  assert.doesNotMatch(detailColumns, /正向销量|退货量|商品数/);
  assert.match(view, /<th>品类趋势<\/th>/);
  assert.match(service, /LIMIT 3000/);
  assert.match(service, /DETAIL_TREND_PERIOD_LIMIT = 24/);
  assert.match(service, /comparisonPeriods/);
  assert.match(service, /TRIM\(s\.warehouse\) <> '刷刷仓'/);
  assert.match(registry, /name: "get_sales_category_analysis"/);
  assert.match(registry, /scopePolicy: "principal_scope"/);
});
