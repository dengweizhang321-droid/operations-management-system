/** The owning ERP integer quantity is not a physical item count or an order count. */
export function formatNativeIntegerQuantityValue(value: number | null): string {
  if (value === null || !Number.isSafeInteger(value)) return "—";
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })} 原生数量`;
}

export function formatComparisonMetric(metric: ComparisonMetric): string {
  if (metric.unit === "NATIVE_INTEGER_QUANTITY") return formatNativeIntegerQuantityValue(metric.value);
  return metric.unit === "CNY_CENT_PER_COUNT" ? formatDerivedMoneyPerCount(metric) : formatMetric(metric);
}
import { formatMetric, formatDerivedMoneyPerCount } from "@/lib/netshop/insights-contract";
import type { ComparisonMetric } from "./contract";
