"use client";

import { Fragment } from "react";
import type { JdLogisticsItem } from "@/lib/inventory/jd-logistics-contract";

export const cwarehouseMetricFields = ["onHandQuantity", "availableQuantity", "lockedQuantity", "purchaseInTransitQuantity", "transferInTransitQuantity", "postReplenishmentQuantity", "sales7dQuantity", "sales30dQuantity", "turnoverDays", "stockoutAvailableDays30d", "availableDays", "availableWithTransitDays", "nativeTurnover30d"] as const;
export type CwarehouseMetricField = typeof cwarehouseMetricFields[number];
export type CwarehouseMetricSet = Record<CwarehouseMetricField, number | null> & {
  metricQualifications: Record<string, string[]>; qualifications: string[]; warningState: string;
  stockoutThresholdDays?: number | null; qualified?: boolean;
};
export type CwarehouseMatrixColumn = { key: string; label: string; kind: "source_province_city" | "warehouse"; sourceProvinceCity?: string | null; warehouseKeys: string[] };
export type CwarehouseProduct = {
  id: string; departmentId: string; businessUnitCode: string; goodsCodeKind: "jd_sku"; goodsCode: string; goodsName: string;
  erpGoodsCode: string; erpGoodsName: string; imageUrl: string | null; summary: CwarehouseMetricSet;
  cells: Array<CwarehouseMetricSet & { columnKey: string }>; details: Array<JdLogisticsItem & CwarehouseMetricSet>; detailCount: number; detailsComplete: boolean;
};
export type CwarehouseProductMonitor = {
  layout: "product"; salesWindow: 7 | 30; columns: CwarehouseMatrixColumn[]; items: CwarehouseProduct[];
  total: number; page: number; pageSize: number; summary: { monitoredCount: number; qualifiedCount: number; stockoutRiskCount: number };
  totals: CwarehouseMetricSet; coverageWarnings: string[]; notificationAvailable: boolean;
};

export const cwarehouseWarningLabels: Record<string, string> = { unconfigured: "未配置阈值", insufficient_evidence: "待补充依据", stockout_risk: "缺货风险", within_threshold: "未触发阈值" };
export const cwarehouseQualificationLabels: Record<string, string> = {
  missing_realtime_source: "缺少实时库存", missing_snapshot_source: "缺少库存快照", ambiguous_source_rows: "同范围来源存在多行歧义", source_date_mismatch: "来源日期不满足已核验口径",
  unconfirmed_product_mapping: "ERP商品映射未确认", missing_quantity_components: "数量分量缺失", nonpositive_sales30d: "30日销量不大于零", region_unmapped: "区域未映射，按来源仓库显示",
  realtime_collection_date_mismatch: "实时业务日与采集日不符", snapshot_source_as_of_mismatch: "快照业务日与来源截至日不符", snapshot_business_date_in_future: "快照业务日超出采集日",
  missing_metric_component: "当前指标依据不齐", nonpositive_sales: "对应窗口销量不大于零", native_turnover_not_aggregatable: "原生周转不跨仓平均",
  period_mismatch: "成员来源日期不一致，天数不可合并计算", native_turnover_not_additive: "京东原生周转不跨仓平均", native_turnover_not_provided: "来源未提供京东原生周转", invalid_native_turnover: "京东原生周转不是有效数值",
};
const metricLabels: Record<string, string> = { onHandQuantity: "现有库存", availableQuantity: "可用库存", lockedQuantity: "锁定库存", purchaseInTransitQuantity: "采购在途", transferInTransitQuantity: "调拨在途", postReplenishmentQuantity: "补货后库存", sales7dQuantity: "7日销量", sales30dQuantity: "30日销量", turnoverDays: "系统30日周转", stockoutAvailableDays30d: "30日可用库存可售天数", availableDays: "可售天数", availableWithTransitDays: "含在途可售天数", nativeTurnover30d: "京东原生30天周转" };
export function cwarehouseQualificationLabel(value: string) {
  if (cwarehouseQualificationLabels[value]) return cwarehouseQualificationLabels[value];
  if (value.startsWith("missing_") && metricLabels[value.slice(8)]) return `缺少${metricLabels[value.slice(8)]}`;
  if (value.startsWith("nonpositive_") && metricLabels[value.slice(12)]) return `${metricLabels[value.slice(12)]}不大于零`;
  return "当前指标来源或口径待核实";
}
export const displayCwarehouseValue = (value: unknown) => value === null || value === undefined || value === "" ? "—" : typeof value === "number" ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value) : String(value);
const collectionTimeFormat = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
export function formatCwarehouseCollectionTime(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return "—";
  return collectionTimeFormat.format(new Date(value));
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

/** Response decoding never aggregates a warehouse page or fills missing metrics with zero. */
export function decodeCwarehouseProductMonitor(value: unknown): CwarehouseProductMonitor {
  const invalid = () => { throw new Error("C仓单品矩阵响应不完整，请检查后端版本"); };
  if (!record(value) || value.layout !== "product" || value.salesWindow !== 7 && value.salesWindow !== 30 || !Array.isArray(value.columns) || !Array.isArray(value.items)
    || !Number.isSafeInteger(value.total) || Number(value.total) < 0 || !Number.isSafeInteger(value.page) || Number(value.page) < 1
    || !Number.isSafeInteger(value.pageSize) || Number(value.pageSize) < 1 || Number(value.pageSize) > 100 || value.items.length > Number(value.pageSize) || value.columns.length > 200
    || !record(value.summary) || !strings(value.coverageWarnings) || typeof value.notificationAvailable !== "boolean") return invalid();
  if (["monitoredCount", "qualifiedCount", "stockoutRiskCount"].some(key => !Number.isSafeInteger((value.summary as Record<string, unknown>)[key]) || Number((value.summary as Record<string, unknown>)[key]) < 0)) return invalid();
  const metric = (data: unknown) => {
    if (!record(data) || cwarehouseMetricFields.some(key => data[key] !== null && (typeof data[key] !== "number" || !Number.isFinite(data[key])))
      || !record(data.metricQualifications) || Object.values(data.metricQualifications).some(value => !strings(value)) || !strings(data.qualifications) || typeof data.warningState !== "string") invalid();
  };
  metric(value.totals);
  const columnKeys = new Set<string>();
  for (const column of value.columns) {
    if (!record(column) || typeof column.key !== "string" || !column.key || typeof column.label !== "string" || !["source_province_city", "warehouse"].includes(String(column.kind)) || !strings(column.warehouseKeys) || columnKeys.has(column.key)) return invalid();
    columnKeys.add(column.key);
  }
  const productKeys = new Set<string>();
  for (const product of value.items) {
    if (!record(product) || typeof product.id !== "string" || productKeys.has(product.id) || typeof product.goodsCode !== "string" || typeof product.goodsName !== "string"
      || !Array.isArray(product.cells) || !Array.isArray(product.details) || !Number.isSafeInteger(product.detailCount) || typeof product.detailsComplete !== "boolean"
      || Number(product.detailCount) < product.details.length || product.detailsComplete && product.detailCount !== product.details.length) return invalid();
    productKeys.add(product.id); metric(product.summary);
    const cells = new Set<string>();
    for (const cell of product.cells) {
      if (!record(cell) || typeof cell.columnKey !== "string" || !columnKeys.has(cell.columnKey) || cells.has(cell.columnKey)) return invalid();
      cells.add(cell.columnKey); metric(cell);
    }
    for (const detail of product.details) metric(detail);
  }
  return value as CwarehouseProductMonitor;
}

function Health({ value, stockoutDays }: { value: string; stockoutDays: number | null }) {
  return <span title={`缺货依据：30日可用库存可售天数 ${displayCwarehouseValue(stockoutDays)} 天（固定30日，不随销量窗口切换）`} className={`status ${value === "stockout_risk" ? "status-danger" : value === "within_threshold" ? "status-success" : "status-warning"}`}>{cwarehouseWarningLabels[value] ?? value}</span>;
}
function Metric({ metrics, field, suffix = "" }: { metrics: CwarehouseMetricSet; field: CwarehouseMetricField; suffix?: string }) {
  const reasons = metrics.metricQualifications[field] ?? [];
  return <span title={reasons.map(cwarehouseQualificationLabel).join("；")}>{displayCwarehouseValue(metrics[field])}{metrics[field] === null ? "" : suffix}</span>;
}
function StockCell({ metrics, window }: { metrics: CwarehouseMetricSet; window: 7 | 30 }) {
  return <div className="jd-cwarehouse-stock-cell"><strong><Metric metrics={metrics} field="availableQuantity" /><small> 可用</small></strong>
    <span>采 <Metric metrics={metrics} field="purchaseInTransitQuantity" /> · 调 <Metric metrics={metrics} field="transferInTransitQuantity" /></span>
    <small>{window}日销 <Metric metrics={metrics} field={window === 7 ? "sales7dQuantity" : "sales30dQuantity"} /> · 可售 <Metric metrics={metrics} field="availableDays" suffix="天" /></small>
    <Health value={metrics.warningState} stockoutDays={metrics.stockoutAvailableDays30d} /></div>;
}

export function CwarehouseDetails({ rows, complete, count, productName }: { rows: CwarehouseProduct["details"]; complete: boolean; count: number; productName: string }) {
  const labels = ["来源省市 / 仓库", "实时 / 快照日", "现有", "可用", "锁定", "采购在途", "调拨在途", "补货后", "7日销量", "30日销量", "系统30日周转", "缺货依据（30日可售）", "可售天数", "含在途可售", "京东原生30天周转", "健康与依据"];
  const metrics: CwarehouseMetricField[] = ["onHandQuantity", "availableQuantity", "lockedQuantity", "purchaseInTransitQuantity", "transferInTransitQuantity", "postReplenishmentQuantity", "sales7dQuantity", "sales30dQuantity", "turnoverDays", "stockoutAvailableDays30d", "availableDays", "availableWithTransitDays", "nativeTurnover30d"];
  return <section className="jd-cwarehouse-expanded" aria-label={`${productName}的分仓明细`}><div className="jd-cwarehouse-detail-heading"><strong>分仓来源明细</strong><span>显示 {rows.length} / {count} 个仓库身份 · 系统天数与京东原生周转分列</span></div>
    {!complete && <p className="inventory-feedback inventory-feedback-warning" role="alert">当前商品分仓明细未完整返回，不能据此判断完整仓库分布。</p>}
    <div className="data-table-wrap"><table className="data-table jd-cwarehouse-detail-table" data-column-filter-scope="none"><thead><tr>{labels.map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? `${row.warehouseKey}:${index}`)}>
      <td><strong>{displayCwarehouseValue(row.sourceProvinceCity)}</strong><small className="cell-note">{displayCwarehouseValue(row.warehouseName)}{row.warehouseCode ? ` · ${row.warehouseCode}` : "（来源仓名）"}</small></td>
      <td>{displayCwarehouseValue(row.realtimeDate)} / {displayCwarehouseValue(row.snapshotDate)}<small className="cell-note" title={displayCwarehouseValue(row.realtimeCollectedAt)}>采集 {formatCwarehouseCollectionTime(row.realtimeCollectedAt)}（上海）</small><small className="cell-note">销量截至 {displayCwarehouseValue(row.salesAsOfDate)}{row.datePairing === "previous_day" ? "（T-1）" : ""}</small></td>
      {metrics.map(field => <td key={field}><Metric metrics={row} field={field} /></td>)}<td><Health value={row.warningState} stockoutDays={row.stockoutAvailableDays30d} /><small className="cell-note">{row.qualifications.map(cwarehouseQualificationLabel).join("；") || "各指标按服务端资格显示"}</small></td>
    </tr>)}</tbody></table></div></section>;
}

export default function JdLogisticsProductMatrix({ data, expandedIds, onToggle }: { data: CwarehouseProductMonitor; expandedIds: ReadonlySet<string>; onToggle: (id: string) => void }) {
  return <div className="data-table-wrap jd-cwarehouse-matrix-wrap"><table className="data-table jd-cwarehouse-product-table" data-column-filter-scope="none"><thead><tr><th className="jd-cwarehouse-product-column">单品 / 京东 SKU</th><th>当前范围总计</th>{data.columns.map(column => <th key={column.key} title={column.kind === "source_province_city" ? "按来源省市原文归集" : "未提供省市，按明确仓库身份单列"}>{column.label}<small className="cell-note">{column.kind === "source_province_city" ? "来源省市" : "来源仓库"}</small></th>)}</tr></thead>
    <tbody>{data.items.map((product, index) => { const expanded = expandedIds.has(product.id); const detailsId = `jd-cwarehouse-product-details-${index}`;
      return <Fragment key={product.id}><tr className={expanded ? "jd-cwarehouse-product-row expanded" : "jd-cwarehouse-product-row"}>
        <td className="jd-cwarehouse-product-column"><div className="jd-cwarehouse-product-identity"><button type="button" className="jd-cwarehouse-expand" aria-expanded={expanded} aria-controls={detailsId} aria-label={`${expanded ? "收起" : "展开"}${product.goodsName || product.goodsCode}的分仓明细`} onClick={() => onToggle(product.id)}>{expanded ? "−" : "+"}</button>
          {/* eslint-disable-next-line @next/next/no-img-element -- Source image URLs are dynamic; render the supplied source directly, and use a placeholder when absent. */}
          {product.imageUrl && /^https?:\/\//.test(product.imageUrl) ? <img className="product-thumb" src={product.imageUrl} alt="" loading="lazy" /> : <span className="product-thumb" aria-hidden="true">货</span>}<div><strong>{product.goodsName || product.goodsCode}</strong><small>{product.goodsCode}</small><small>ERP {displayCwarehouseValue(product.erpGoodsCode)}</small><small>{product.detailCount} 个仓库身份</small></div></div></td>
        <td className="jd-cwarehouse-total-cell"><StockCell metrics={product.summary} window={data.salesWindow} /></td>
        {data.columns.map(column => { const cell = product.cells.find(value => value.columnKey === column.key); return <td key={column.key} className={cell?.warningState === "stockout_risk" ? "jd-cwarehouse-risk-cell" : undefined}>{cell ? <StockCell metrics={cell} window={data.salesWindow} /> : <span className="jd-cwarehouse-no-source">—<small>暂无该范围来源</small></span>}</td>; })}
      </tr>{expanded && <tr id={detailsId} className="jd-cwarehouse-details-row"><td colSpan={data.columns.length + 2}><CwarehouseDetails rows={product.details} complete={product.detailsComplete} count={product.detailCount} productName={product.goodsName || product.goodsCode} /></td></tr>}</Fragment>;
    })}{!data.items.length && <tr><td colSpan={data.columns.length + 2}><div className="table-state">当前范围暂无已导入单品。</div></td></tr>}</tbody></table></div>;
}
