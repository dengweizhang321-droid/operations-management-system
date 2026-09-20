import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  attachTrafficQuadrantExamples,
  buildIndustryBrandConcentrationTrend,
  buildIndustryOpportunityMatrix,
  buildIndustryPeriodHighlights,
  buildIndustryProductSignals,
  COMMERCIAL_DIRECT_DRINKING_PROFILE,
  monthlyGrowthByValue,
} from "../lib/market/industry-report";

test("商用直饮机预设严格区分核心细分与相邻市场", () => {
  assert.equal(COMMERCIAL_DIRECT_DRINKING_PROFILE.category, "商用净饮水设备");
  assert.deepEqual(COMMERCIAL_DIRECT_DRINKING_PROFILE.coreSubcategories, [
    "商用直饮机", "净饮一体机", "校园饮水机", "工厂饮水机", "幼儿园饮水机", "商用管线机",
  ]);
  assert.ok(COMMERCIAL_DIRECT_DRINKING_PROFILE.adjacentSubcategories.includes("桶装水饮水机"));
  assert.ok(COMMERCIAL_DIRECT_DRINKING_PROFILE.adjacentCategories.includes("商用净水设备"));
});

test("行业周期只对连续月和同月去年计算增长，并保持榜单进出边界为空", () => {
  const trend = [
    { period: "2025-07", gmvCents: 800, quantity: 8, visitors: 80, productCount: 2, brandCount: 2 },
    { period: "2026-06", gmvCents: 1_000, quantity: 10, visitors: 100, productCount: 3, brandCount: 2 },
    { period: "2026-07", gmvCents: 1_200, quantity: 12, visitors: 120, productCount: 4, brandCount: 3 },
  ];
  const result = buildIndustryPeriodHighlights(trend, [
    { period: "2025-07", entryCount: null, exitCount: 1 },
    { period: "2026-06", entryCount: 2, exitCount: 1 },
    { period: "2026-07", entryCount: 1, exitCount: null },
  ]);
  assert.equal(result.monthOverMonthBps, 2_000);
  assert.equal(result.yearOverYearBps, 5_000);
  assert.deepEqual(result.peak, { period: "2026-07", gmvCents: 1_200 });
  assert.equal(result.latestEntryCount, 1);
  assert.equal(result.latestExitCount, 1);
  assert.equal(result.latestExitPeriod, "2026-06");
});

test("细分与品牌月度增长不会把缺失月份误当成零销售", () => {
  const growth = monthlyGrowthByValue([
    { period: "2025-07", value: "校园饮水机", gmvCents: 100, quantity: 1, skuCount: 1 },
    { period: "2026-06", value: "校园饮水机", gmvCents: 200, quantity: 2, skuCount: 1 },
    { period: "2026-07", value: "校园饮水机", gmvCents: 300, quantity: 3, skuCount: 2 },
    { period: "2026-07", value: "工厂饮水机", gmvCents: 500, quantity: 5, skuCount: 1 },
  ]);
  assert.equal(growth.get("校园饮水机")?.monthOverMonthBps, 5_000);
  assert.equal(growth.get("校园饮水机")?.yearOverYearBps, 20_000);
  assert.equal(growth.get("工厂饮水机")?.monthOverMonthBps, null);
});

test("品牌集中度按月份独立计算 CR3 与 CR5", () => {
  const rows = buildIndustryBrandConcentrationTrend([
    { period: "2026-06", value: "甲", gmvCents: 500, quantity: 5, skuCount: 1 },
    { period: "2026-06", value: "乙", gmvCents: 300, quantity: 3, skuCount: 1 },
    { period: "2026-06", value: "丙", gmvCents: 100, quantity: 1, skuCount: 1 },
    { period: "2026-06", value: "丁", gmvCents: 100, quantity: 1, skuCount: 1 },
    { period: "2026-07", value: "甲", gmvCents: 600, quantity: 6, skuCount: 1 },
  ]);
  assert.deepEqual(rows, [
    { period: "2026-06", gmvCents: 1_000, brandCount: 4, cr3Bps: 9_000, cr5Bps: 10_000 },
    { period: "2026-07", gmvCents: 600, brandCount: 1, cr3Bps: 10_000, cr5Bps: 10_000 },
  ]);
});

test("机会矩阵在无连续月或正式价格时不会给出进入结论", () => {
  const rows = buildIndustryOpportunityMatrix([
    {
      subcategory: "校园饮水机", priceBand: "3000-5000", gmvCents: 900_000, quantity: 90, skuCount: 3,
      visitors: 900, conversionBps: 1_000, selfGmvCents: 90_000, brandCount: 2,
      latestGmvCents: 600_000, previousGmvCents: 300_000, pendingPriceCount: 0,
    },
    {
      subcategory: "工厂饮水机", priceBand: "未确认价格", gmvCents: 100_000, quantity: 10, skuCount: 4,
      visitors: 1_000, conversionBps: 100, selfGmvCents: 90_000, brandCount: 4,
      latestGmvCents: 100_000, previousGmvCents: 0, pendingPriceCount: 4,
    },
  ], 1_000_000);
  const campus = rows.find((row) => row.subcategory === "校园饮水机");
  const factory = rows.find((row) => row.subcategory === "工厂饮水机");
  assert.equal(campus?.scenario, "校园");
  assert.equal(campus?.growthBps, 10_000);
  assert.equal(campus?.decisionReady, true);
  assert.equal(factory?.decisionReady, false);
  assert.notEqual(factory?.recommendation, "建议进入");
});

test("机会矩阵存在任一未确认正式价格时只保留观察结论", () => {
  const [cell] = buildIndustryOpportunityMatrix([{
    subcategory: "校园饮水机", priceBand: "3000-5000", gmvCents: 900_000, quantity: 90, skuCount: 3,
    visitors: 900, conversionBps: 1_000, selfGmvCents: 90_000, brandCount: 2,
    latestGmvCents: 600_000, previousGmvCents: 300_000, pendingPriceCount: 1,
  }], 900_000);
  assert.equal(cell?.decisionReady, false);
  assert.equal(cell?.recommendation, "持续观察");
});

test("机会矩阵在类目、范围或榜单维度未锁定时不输出进入或回避建议", () => {
  const [cell] = buildIndustryOpportunityMatrix([{
    subcategory: "校园饮水机", priceBand: "3000-5000", gmvCents: 900_000, quantity: 90, skuCount: 3,
    visitors: 900, conversionBps: 1_000, selfGmvCents: 90_000, brandCount: 2,
    latestGmvCents: 600_000, previousGmvCents: 300_000, pendingPriceCount: 0,
  }], 900_000, { identityReady: false });
  assert.equal(cell?.decisionReady, false);
  assert.equal(cell?.recommendation, "持续观察");
  assert.ok(cell?.reasons.includes("分析身份未锁定"));
});

test("标题信号按完整市场身份去重并提取场景、过滤、温控与服务", () => {
  const base = {
    category: "商用净饮水设备", scope: "整体SKU", rankingDimension: "SKU", skuCode: "JD-1",
    productName: "校园RO反渗透立式直饮机 100人 一开一温 包安装", subcategory: "校园饮水机",
    periodEnd: "2026-06-30", gmvCents: 100, quantity: 1, visitors: 10, conversionBps: 1_000,
  };
  const signals = buildIndustryProductSignals([
    base,
    { ...base, periodEnd: "2026-07-31", gmvCents: 200 },
    { ...base, skuCode: "JD-2", productName: "工厂超滤柜式饮水机 500人 质保", subcategory: "工厂饮水机" },
  ]);
  assert.equal(signals.sampleSize, 2);
  assert.equal(signals.signals.find((item) => item.label === "RO反渗透")?.count, 1);
  assert.equal(signals.signals.find((item) => item.label === "工厂")?.count, 1);
  assert.equal(signals.signals.find((item) => item.label === "300人以上")?.count, 1);
  assert.equal(signals.signals.find((item) => item.label === "安装服务")?.count, 1);
});

test("流量转化象限样例同样按类目、范围、维度和商品编码去重", () => {
  const quadrants = attachTrafficQuadrantExamples([{
    quadrant: "high_traffic_high_conversion", productCount: 1, gmvCents: 200, quantity: 2, visitors: 20,
    conversionBps: 1_000, visitorThreshold: 10, conversionThresholdBps: 500,
  }], [{
    category: "商用净饮水设备", scope: "整体SKU", rankingDimension: "SKU", skuCode: "JD-1",
    productName: "校园直饮机", subcategory: "校园饮水机", periodEnd: "2026-07-31", gmvCents: 200, quantity: 2, visitors: 20, conversionBps: 1_000,
  }]);
  assert.deepEqual(quadrants[0]?.examples, [{ skuCode: "JD-1", productName: "校园直饮机", gmvCents: 200 }]);
});

test("市场页面与中央只读工具接入行业汇报、榜单范围锁定和数据缺口声明", async () => {
  const [view, sql, adminService, registry] = await Promise.all([
    readFile(new URL("../app/market-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/overview-sql.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/admin-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/tool-registry.ts", import.meta.url), "utf8"),
  ]);
  for (const label of ["行业汇报", "应用商用直饮机核心口径", "商品流量 × 转化象限", "机会矩阵", "消费者、服务、利润与合规补充清单"]) {
    assert.match(view, new RegExp(label));
  }
  assert.match(view, /SearchMultiFilter label="榜单范围"/);
  assert.match(view, /scopes\.forEach\(\(value\) => params\.append\("scope", value\)\)/);
  assert.match(view, /setScopes\(\[preferredScope\?\.value \?\? "整体SKU"\]\)/);
  assert.match(view, /setSubcategories\(\[\.\.\.profile\.coreSubcategories\]\)/);
  assert.match(view, /timeZone: "Asia\/Shanghai"/);
  for (const section of ["lifecycle", "operation_mode", "subcategory_month", "brand_month", "opportunity_cell", "traffic_quadrant"]) {
    assert.match(sql, new RegExp(`'${section}'`));
  }
  assert.match(adminService, /scopes: optionalText\(args\.scope, 120\)/);
  assert.match(adminService, /opportunities: industryReport\.opportunities\.slice\(0, 20\)/);
  assert.match(registry, /name: "get_market_overview"[\s\S]*scope: \{ type: "string", maxLength: 120 \}/);
});
