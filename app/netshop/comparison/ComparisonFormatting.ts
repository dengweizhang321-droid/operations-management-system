import { formatMetric, formatDerivedMoneyPerCount } from "@/lib/netshop/insights-contract";
import type { ComparisonMetric, ErpEvidence } from "./contract";

/** The owning ERP integer quantity is not a physical item count or an order count. */
export function formatNativeIntegerQuantityValue(value: number | null): string {
  if (value === null || !Number.isSafeInteger(value)) return "—";
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })} 原生数量`;
}

export function formatComparisonMetric(metric: ComparisonMetric): string {
  if (metric.unit === "NATIVE_INTEGER_QUANTITY") return formatNativeIntegerQuantityValue(metric.value);
  return metric.unit === "CNY_CENT_PER_COUNT" ? formatDerivedMoneyPerCount(metric) : formatMetric(metric);
}
export const isErpObservationMetric = (metric: ComparisonMetric) => metric.unit === "NATIVE_INTEGER_QUANTITY" || metric.basis.startsWith("erp_");
export const partialMetricObservationLabel = (metric: ComparisonMetric) => isErpObservationMetric(metric) ? "已观察记录 · 完整性未知" : "部分覆盖";
export function erpTemporalMessage(temporal: ErpEvidence["temporalState"]): string {
  if (temporal.state === "ready") return "ERP 趋势来自同一次拥有方读取的原生业务日期桶；缺记录留空、真实零保留，结算完整性仍未知。";
  if (temporal.code === "platform_series_dependency_pending") return "平台 ERP 时间序列的拥有方能力尚待冻结；完整排名仍可查看，不拼接原始店铺快照或累加去重订单。";
  if (temporal.state === "unavailable") return "当前选择不具备 ERP 时间序列读取能力；完整排名仍可查看，金额和数量不按天均摊。";
  return "ERP 时间序列来源尚未就绪；不按天均摊或从记录日期补造序列。";
}
