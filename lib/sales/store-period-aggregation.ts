import type { SalesStats } from "@/app/module-view-shared";

export type StoreGranularity = "day" | "week" | "month";

export type StorePeriodRow = SalesStats & {
  key: string;
  label: string;
  promotionSpendCents?: number;
  promotionNetTransactionCents?: number;
  platformPaymentCents?: number;
  promotionClicks?: number;
  promotionSpendRate?: number | null;
  promotionTransactionShare?: number | null;
};

export function storePeriodKey(dateValue: string, granularity: StoreGranularity) {
  if (granularity === "day") return dateValue;
  if (granularity === "month") return dateValue.slice(0, 7);
  const date = new Date(`${dateValue}T00:00:00Z`);
  const weekDay = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (weekDay === 0 ? -6 : 1 - weekDay));
  return date.toISOString().slice(0, 10);
}

/**
 * 客单价口径固定为件均价：Σ净销售额(排除配件) / Σ净数量。
 * 周/月聚合必须先对分子、分母各自求和再相除，不得对各日客单价取平均，
 * 也不得改用订单量做分母（net_quantity !== order_count 时两者不等价）。
 */
export function aggregateStorePeriods(
  daily: Array<{ date: string } & SalesStats>,
  granularity: StoreGranularity,
): StorePeriodRow[] {
  const buckets = new Map<string, StorePeriodRow>();
  for (const item of daily) {
    const key = storePeriodKey(item.date, granularity);
    const label = granularity === "week" ? `${key} 周` : key;
    const row = buckets.get(key) ?? {
      key,
      label,
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
    };
    row.grossSalesCents += item.grossSalesCents;
    row.netSalesCents += item.netSalesCents;
    row.netSalesExcludingAccessoriesCents += item.netSalesExcludingAccessoriesCents;
    row.costAmountCents += item.costAmountCents;
    row.grossProfitCents += item.grossProfitCents;
    row.refundAmountCents += item.refundAmountCents;
    row.orderCount += item.orderCount;
    row.lineCount += item.lineCount;
    row.netQuantity += item.netQuantity;
    row.averageOrderValueCents = row.netQuantity === 0 ? 0 : row.netSalesExcludingAccessoriesCents / row.netQuantity;
    row.grossMarginRate = row.netSalesCents === 0 ? 0 : (row.netSalesCents - row.costAmountCents) / row.netSalesCents;
    row.refundRate = row.grossSalesCents === 0 ? 0 : row.refundAmountCents / row.grossSalesCents;
    buckets.set(key, row);
  }
  return [...buckets.values()].sort((left, right) => left.key.localeCompare(right.key));
}
