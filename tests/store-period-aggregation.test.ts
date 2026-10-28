import assert from "node:assert/strict";
import test from "node:test";

import { aggregateStorePeriods } from "@/lib/sales/store-period-aggregation";
import type { SalesStats } from "@/app/module-view-shared";

/**
 * 客单价口径 = 件均价：Σ净销售额(排除配件) / Σ净数量。
 * 构造 net_quantity ≠ order_count 的多件订单日，验证日维度与周/月聚合维度
 * 必须算出同一个客单价——不得对各日客单价取平均，也不得改用订单量做分母。
 */
function day(date: string, overrides: Partial<SalesStats>): { date: string } & SalesStats {
  return {
    date,
    grossSalesCents: 0,
    netSalesCents: 0,
    netSalesExcludingAccessoriesCents: 0,
    costAmountCents: 0,
    grossProfitCents: 0,
    refundAmountCents: 0,
    orderCount: 0,
    lineCount: 0,
    netQuantity: 0,
    averageOrderValueCents: 0,
    grossMarginRate: 0,
    refundRate: 0,
    ...overrides,
  };
}

test("week aggregation matches per-day ratio-of-sums even when net_quantity differs from order_count", () => {
  // 周一：1 笔订单含 3 件商品（多件订单），净销售额剔除配件 30000 分。
  const monday = day("2026-08-03", {
    netSalesCents: 30_000,
    netSalesExcludingAccessoriesCents: 30_000,
    orderCount: 1,
    netQuantity: 3,
    averageOrderValueCents: 10_000, // 件均价：30000 / 3
  });
  // 周二：2 笔订单各 1 件，净销售额剔除配件 20000 分。
  const tuesday = day("2026-08-04", {
    netSalesCents: 20_000,
    netSalesExcludingAccessoriesCents: 20_000,
    orderCount: 2,
    netQuantity: 2,
    averageOrderValueCents: 10_000, // 件均价：20000 / 2
  });
  const daily = [monday, tuesday];

  const [weekRow] = aggregateStorePeriods(daily, "week");
  // 正确口径：Σ净销售额剔除配件(30000+20000=50000) / Σ净数量(3+2=5) = 10000。
  assert.equal(weekRow.averageOrderValueCents, 10_000);
  // 错误的订单均价口径会给出 50000 / 3（订单量）= 16666.67，必须与之不同。
  assert.notEqual(weekRow.averageOrderValueCents, weekRow.netSalesCents / weekRow.orderCount);
});

test("ratio-of-sums differs from naive average of per-day average order values", () => {
  // 两天件均价恰好相等(10000)时合计也是10000，不足以暴露“先求日均再取平均”的 bug；
  // 这里构造两天件均价不同，证明周度口径必须重新按汇总分子分母计算，不能对日客单价取平均或求和再除以天数。
  const dayA = day("2026-08-10", {
    netSalesCents: 10_000,
    netSalesExcludingAccessoriesCents: 10_000,
    orderCount: 1,
    netQuantity: 1,
    averageOrderValueCents: 10_000,
  });
  const dayB = day("2026-08-11", {
    netSalesCents: 40_000,
    netSalesExcludingAccessoriesCents: 40_000,
    orderCount: 1,
    netQuantity: 4,
    averageOrderValueCents: 10_000,
  });
  const [weekRow] = aggregateStorePeriods([dayA, dayB], "week");
  // Σ净销售额剔除配件(50000) / Σ净数量(5) = 10000；与简单对日客单价取平均（也是10000）恰好一致，
  // 但下一断言证明实现确实是按汇总分子分母计算，而不是凑巧：改变其中一天的配件占比后两者会分叉。
  assert.equal(weekRow.averageOrderValueCents, 10_000);

  const dayWithAccessories = day("2026-08-12", {
    netSalesCents: 40_000,
    // 配件行拉低了剔除配件后的净销售额，但不影响净数量（配件不计入净数量口径）。
    netSalesExcludingAccessoriesCents: 20_000,
    orderCount: 1,
    netQuantity: 4,
    averageOrderValueCents: 5_000, // 20000 / 4
  });
  const [mixedWeekRow] = aggregateStorePeriods([dayA, dayWithAccessories], "week");
  // Σ净销售额剔除配件(10000+20000=30000) / Σ净数量(1+4=5) = 6000。
  assert.equal(mixedWeekRow.averageOrderValueCents, 6_000);
  // 若错误地对两天的客单价取平均，会得到 (10000+5000)/2 = 7500，必须与正确口径不同。
  const naiveAverageOfDailyAov = (dayA.averageOrderValueCents + dayWithAccessories.averageOrderValueCents) / 2;
  assert.notEqual(mixedWeekRow.averageOrderValueCents, naiveAverageOfDailyAov);
});

test("month aggregation reuses the same ratio-of-sums rule across more buckets", () => {
  const days = [
    day("2026-08-01", { netSalesCents: 10_000, netSalesExcludingAccessoriesCents: 10_000, orderCount: 1, netQuantity: 2, averageOrderValueCents: 5_000 }),
    day("2026-08-15", { netSalesCents: 10_000, netSalesExcludingAccessoriesCents: 10_000, orderCount: 1, netQuantity: 1, averageOrderValueCents: 10_000 }),
    day("2026-08-31", { netSalesCents: 10_000, netSalesExcludingAccessoriesCents: 10_000, orderCount: 1, netQuantity: 2, averageOrderValueCents: 5_000 }),
  ];
  const [monthRow] = aggregateStorePeriods(days, "month");
  assert.equal(monthRow.key, "2026-08");
  // Σ净销售额剔除配件(30000) / Σ净数量(5) = 6000。
  assert.equal(monthRow.averageOrderValueCents, 6_000);
});

test("zero net quantity in the bucket reports zero, not a division error", () => {
  const empty = day("2026-09-01", { netSalesCents: 0, netSalesExcludingAccessoriesCents: 0, orderCount: 0, netQuantity: 0, averageOrderValueCents: 0 });
  const [row] = aggregateStorePeriods([empty], "day");
  assert.equal(row.averageOrderValueCents, 0);
});
