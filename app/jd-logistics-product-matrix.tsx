"use client";

import { Fragment, useRef } from "react";
import { jdInventoryHealthStates, jdInventoryHealthLabels, type JdInventoryHealthCounts, type JdInventoryHealthState, type JdInventoryHealthFilter, type JdLogisticsItem } from "@/lib/inventory/jd-logistics-contract";

export const cwarehouseMetricFields = ["onHandQuantity", "availableQuantity", "lockedQuantity", "purchaseInTransitQuantity", "transferInTransitQuantity", "postReplenishmentQuantity", "sales7dQuantity", "sales30dQuantity", "turnoverDays", "stockoutAvailableDays30d", "availableDays", "availableWithTransitDays", "nativeTurnover30d", "suggestedReplenishmentQuantity"] as const;
export type CwarehouseMetricField = typeof cwarehouseMetricFields[number];
export type CwarehouseInventoryHealth = {
  inventoryHealthState: JdInventoryHealthState; inventoryHealthReasons: string[]; healthCounts: JdInventoryHealthCounts; hasStockout: boolean; hasReplenishmentNeed: boolean;
};
export type CwarehouseMetricSet = Record<CwarehouseMetricField, number | null> & CwarehouseInventoryHealth & {
  metricQualifications: Record<string, string[]>; qualifications: string[]; warningState: string;
  stockoutThresholdDays?: number | null; replenishmentCycleDays?: number | null; qualified?: boolean;
};
export type CwarehouseMatrixColumn = { key: string; label: string; kind: "source_province_city" | "warehouse"; sourceProvinceCity?: string | null; warehouseKeys: string[] };
export type CwarehouseProduct = CwarehouseInventoryHealth & {
  id: string; departmentId: string; businessUnitCode: string; goodsCodeKind: "jd_sku"; goodsCode: string; goodsName: string;
  erpGoodsCode: string; erpGoodsName: string; imageUrl: string | null; summary: CwarehouseMetricSet;
  cells: Array<CwarehouseMetricSet & { columnKey: string }>; details: Array<JdLogisticsItem & CwarehouseMetricSet>; detailCount: number; detailsComplete: boolean;
};
export type CwarehouseProductMonitor = {
  layout: "product"; salesWindow: 7 | 30; healthState: JdInventoryHealthFilter; healthCounts: JdInventoryHealthCounts; healthFilterCounts: JdInventoryHealthCounts; columns: CwarehouseMatrixColumn[]; items: CwarehouseProduct[];
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
  partial_quantity_sum: "仅合计已有数值的仓库，缺失数据未按零计入",
  negative_sales30dQuantity: "30日销售出库为负，无法计算建议补货", mixed_replenishment_cycles: "成员补货周期不同，合计采用逐仓缺口之和",
  available_nonpositive_with_positive_demand: "30日有销量且可用库存不大于零", zero_sales30dQuantity: "近30日无销售出库", positive_replenishment_quantity: "按目标覆盖天数计算仍需补货",
  in_transit_meets_coverage_target: "可用加在途可覆盖目标天数", coverage_target_not_verified: "目标覆盖依据尚未核实", turnover_over_180_days: "系统30日周转超过180天", coverage_target_met: "库存已满足目标覆盖天数", empty_scope: "当前范围尚无可判定仓项",
};
const metricLabels: Record<string, string> = { onHandQuantity: "现有库存", availableQuantity: "可用库存", lockedQuantity: "锁定库存", purchaseInTransitQuantity: "采购在途", transferInTransitQuantity: "调拨在途", postReplenishmentQuantity: "补货后库存", sales7dQuantity: "7日销量", sales30dQuantity: "30日销量", turnoverDays: "系统30日周转", stockoutAvailableDays30d: "30日可用库存可售天数", availableDays: "可售天数", availableWithTransitDays: "含在途可售天数", nativeTurnover30d: "京东原生30天周转", suggestedReplenishmentQuantity: "建议补货" };
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
  const validCounts = (counts: unknown) => record(counts) && ["all", ...jdInventoryHealthStates].every(state => Number.isSafeInteger(counts[state]) && Number(counts[state]) >= 0);
  const health = (data: unknown) => {
    if (!record(data) || !jdInventoryHealthStates.includes(data.inventoryHealthState as JdInventoryHealthState) || !strings(data.inventoryHealthReasons)
      || !validCounts(data.healthCounts) || typeof data.hasStockout !== "boolean" || typeof data.hasReplenishmentNeed !== "boolean") invalid();
  };
  if (value.healthState !== "all" && !jdInventoryHealthStates.includes(value.healthState as JdInventoryHealthState) || !validCounts(value.healthCounts) || !validCounts(value.healthFilterCounts)) return invalid();
  const metric = (data: unknown) => {
    health(data);
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
    productKeys.add(product.id); health(product); metric(product.summary);
    const cells = new Set<string>();
    for (const cell of product.cells) {
      if (!record(cell) || typeof cell.columnKey !== "string" || !columnKeys.has(cell.columnKey) || cells.has(cell.columnKey)) return invalid();
      cells.add(cell.columnKey); metric(cell);
    }
    for (const detail of product.details) metric(detail);
  }
  return value as CwarehouseProductMonitor;
}

export function InventoryHealth({ metrics }: { metrics: CwarehouseInventoryHealth }) {
  const state = metrics.inventoryHealthState;
  const tone = state === "stockout" ? "status-danger" : state === "healthy" || state === "in_transit_cover" ? "status-success" : "status-warning";
  const reasons = metrics.inventoryHealthReasons.map(cwarehouseQualificationLabel).join("；");
  return <span className="jd-cwarehouse-health-badges"><span title={reasons || "库存健康按当前来源与目标覆盖天数判断，独立于消息提醒阈值"} className={`status ${tone}`}>{jdInventoryHealthLabels[state]}</span>{metrics.hasStockout && state !== "stockout" && <span className="status status-danger">含缺货仓</span>}{metrics.hasReplenishmentNeed && state !== "replenish" && <span className="status status-warning">需补货</span>}</span>;
}
function Metric({ metrics, field, suffix = "", partialLabel = true }: { metrics: CwarehouseMetricSet; field: CwarehouseMetricField; suffix?: string; partialLabel?: boolean }) {
  const reasons = metrics.metricQualifications[field] ?? [];
  return <span title={reasons.map(cwarehouseQualificationLabel).join("；")}>{displayCwarehouseValue(metrics[field])}{metrics[field] === null ? "" : suffix}{partialLabel && metrics[field] !== null && reasons.includes("partial_quantity_sum") && <small className="cell-note">部分数据</small>}</span>;
}
export function compactProductTitle(value: string, limit = 24) {
  const title = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(title);
  return characters.length > limit ? `${characters.slice(0, limit).join("")}…` : title;
}

function compactWarehouseTitle(value: unknown, provinceCity = false) {
  const full = String(value ?? "");
  if (provinceCity) return full.replace(/[市区]$/, "");
  const city = full.match(/^(.{1,12}?)(?:常温|冷链|冷冻|C平台|平台仓)/)?.[1];
  return city ? `${city}${full.match(/\d+号库/) ? `·${full.match(/\d+号库/)![0]}` : ""}` : compactProductTitle(full, 12);
}

function StockCell({ metrics }: { metrics: CwarehouseMetricSet }) {
  const partial = (["availableQuantity", "purchaseInTransitQuantity", "transferInTransitQuantity"] as const).some(field => metrics.metricQualifications[field]?.includes("partial_quantity_sum"));
  const title = `可用 ${displayCwarehouseValue(metrics.availableQuantity)}；采购在途 ${displayCwarehouseValue(metrics.purchaseInTransitQuantity)}；调拨在途 ${displayCwarehouseValue(metrics.transferInTransitQuantity)}；${jdInventoryHealthLabels[metrics.inventoryHealthState]}${partial ? "；部分数据：仅合计已有数值的仓库，缺失数据未按零计入" : ""}`;
  const visibleTransit = (["purchaseInTransitQuantity", "transferInTransitQuantity"] as const).filter(field => metrics[field] !== null && metrics[field] !== 0);
  const unknownTransit = metrics.purchaseInTransitQuantity === null || metrics.transferInTransitQuantity === null;
  return <div className={`jd-cwarehouse-stock-cell${metrics.availableQuantity === 0 ? " zero-available" : ""}`} title={title}>
    <strong><Metric metrics={metrics} field="availableQuantity" partialLabel={false} /></strong>{visibleTransit.map(field => <sup key={field}>{metrics[field]! >= 0 ? "+" : ""}<Metric metrics={metrics} field={field} partialLabel={false} /></sup>)}{unknownTransit && <sup>+—</sup>}{partial && <small className="cell-note">部分数据</small>}
  </div>;
}

export function CwarehouseDetails({ rows, complete, count, productName, summary }: { rows: CwarehouseProduct["details"]; complete: boolean; count: number; productName: string; summary?: CwarehouseMetricSet }) {
  const labels = ["城市 / 仓", "现有", "可用", "锁定", "采购在途", "调拨在途", "补货后", "7日销量", "30日销量", "可售天数", "含在途可售", "京东30天周转", "健康", "建议补货"];
  const metrics: CwarehouseMetricField[] = ["onHandQuantity", "availableQuantity", "lockedQuantity", "purchaseInTransitQuantity", "transferInTransitQuantity", "postReplenishmentQuantity", "sales7dQuantity", "sales30dQuantity", "availableDays", "availableWithTransitDays", "nativeTurnover30d"];
  const metricCells = (row: CwarehouseMetricSet) => <>{metrics.map(field => <td key={field}><Metric metrics={row} field={field} suffix={field === "availableDays" || field === "availableWithTransitDays" ? "天" : ""} /></td>)}<td><InventoryHealth metrics={row} /></td><td className="jd-cwarehouse-suggestion" title={`库存周转周期（目标覆盖） ${displayCwarehouseValue(row.replenishmentCycleDays)} 天；按近30日销售出库与可用、采购和调拨在途计算，逐仓缺口向上取整。`}><Metric metrics={row} field="suggestedReplenishmentQuantity" /></td></>;
  return <section className="jd-cwarehouse-expanded" aria-label={`${productName}的分仓明细`}><div className="jd-cwarehouse-detail-heading"><strong>分仓来源明细</strong><span>显示 {rows.length} / {count} 个仓库身份 · 日期与天数口径见下方依据</span></div>
    {!complete && <p className="inventory-feedback inventory-feedback-warning" role="alert">当前商品分仓明细未完整返回，不能据此判断完整仓库分布。</p>}
    <div className="data-table-wrap"><table className="data-table jd-cwarehouse-detail-table" data-column-filter-scope="none"><thead><tr>{labels.map(label => <th key={label} title={label === "京东30天周转" ? "京东原生30天周转，保留来源单仓原值，不跨仓求和或平均" : undefined}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? `${row.warehouseKey}:${index}`)}>
      <td title={`${displayCwarehouseValue(row.sourceProvinceCity)} · ${displayCwarehouseValue(row.warehouseName)} · ${displayCwarehouseValue(row.warehouseCode)}`}>{row.warehouseDisplayName ? String(row.warehouseDisplayName) : compactWarehouseTitle(row.warehouseName) || displayCwarehouseValue(row.sourceProvinceCity)}</td>{metricCells(row)}
    </tr>)}{summary && <tr className="jd-cwarehouse-detail-total"><td>当前范围合计</td>{metricCells(summary)}</tr>}</tbody></table></div>
    <details className="jd-cwarehouse-source-notes"><summary>数据日期与计算依据</summary>{rows.map((row, index) => <p key={String(row.id ?? index)}><strong>{displayCwarehouseValue(row.warehouseDisplayName || row.warehouseName)}</strong> · 实时 {displayCwarehouseValue(row.realtimeDate)} / 快照 {displayCwarehouseValue(row.snapshotDate)} · <span title={displayCwarehouseValue(row.realtimeCollectedAt)}>采集 {formatCwarehouseCollectionTime(row.realtimeCollectedAt)}（上海）</span> · 销量截至 {displayCwarehouseValue(row.salesAsOfDate)}{row.datePairing === "previous_day" ? "（T-1）" : ""} · 系统30日周转 <Metric metrics={row} field="turnoverDays" />天 · 缺货依据（30日可售） <Metric metrics={row} field="stockoutAvailableDays30d" />天 · {row.qualifications.map(cwarehouseQualificationLabel).join("；") || "各指标按来源资格显示"}</p>)}</details></section>;
}

export default function JdLogisticsProductMatrix({ data, expandedIds, onToggle, canReorder = false, onMove }: { canReorder?: boolean; onMove?: (goodsCode: string, targetGoodsCode: string, placement: "before" | "after") => void; data: CwarehouseProductMonitor; expandedIds: ReadonlySet<string>; onToggle: (id: string) => void }) {
  const dragged = useRef<string | null>(null);
  return <div className="data-table-wrap jd-cwarehouse-matrix-wrap"><table className="data-table jd-cwarehouse-product-table" data-column-filter-scope="none"><thead><tr><th className="jd-cwarehouse-product-column">商品</th>{data.columns.map(column => <th key={column.key} title={`${column.label} · ${column.kind === "source_province_city" ? "按来源省市原文归集" : "未提供省市，按明确仓库身份单列"}`}>{column.label}<small className="cell-note">{column.warehouseKeys.length} 个源仓</small></th>)}<th className="jd-cwarehouse-total-cell">当前范围合计</th></tr></thead>
    <tbody>{data.items.map((product, index) => { const expanded = expandedIds.has(product.id); const detailsId = `jd-cwarehouse-product-details-${index}`;
      return <Fragment key={product.id}><tr data-goods-code={product.goodsCode} onDragOver={event => { if (canReorder && dragged.current && dragged.current !== product.goodsCode) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (canReorder && dragged.current && dragged.current !== product.goodsCode) onMove?.(dragged.current, product.goodsCode, data.items.findIndex(row => row.goodsCode === dragged.current) < index ? "after" : "before"); dragged.current = null; }} className={expanded ? "jd-cwarehouse-product-row expanded" : "jd-cwarehouse-product-row"}>
        <td className="jd-cwarehouse-product-column"><div className="jd-cwarehouse-product-identity">{canReorder && <button type="button" className="row-action jd-monitor-drag" draggable aria-label={`拖动${product.goodsName || product.goodsCode}排序`} onDragStart={event => { dragged.current = product.goodsCode; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", product.goodsCode); }} onDragEnd={() => { dragged.current = null; }} onKeyDown={event => { if (event.altKey && event.key === "ArrowUp" && index > 0) { event.preventDefault(); onMove?.(product.goodsCode, data.items[index - 1].goodsCode, "before"); } if (event.altKey && event.key === "ArrowDown" && index < data.items.length - 1) { event.preventDefault(); onMove?.(product.goodsCode, data.items[index + 1].goodsCode, "after"); } }} title="拖动调整商品顺序；也可用 Alt+↑/↓">⠿</button>}<button type="button" className="jd-cwarehouse-expand" aria-expanded={expanded} aria-controls={detailsId} aria-label={`${expanded ? "收起" : "展开"}${product.goodsName || product.goodsCode}的分仓明细`} onClick={() => onToggle(product.id)}>{expanded ? "−" : "+"}</button>
          {/* eslint-disable-next-line @next/next/no-img-element -- Source image URLs are dynamic; render the supplied source directly, and use a placeholder when absent. */}
          {product.imageUrl && /^https?:\/\//.test(product.imageUrl) ? <img className="product-thumb" src={product.imageUrl} alt="" loading="lazy" /> : <span className="product-thumb" aria-hidden="true">货</span>}<div><strong className="jd-cwarehouse-short-title" title={product.goodsName || product.goodsCode}>{compactProductTitle(product.goodsName || product.goodsCode)}</strong><small>京东 SKU：{product.goodsCode}</small><InventoryHealth metrics={product.summary} /><small title={product.erpGoodsName}>{product.erpGoodsCode ? `ERP：${product.erpGoodsCode}` : "ERP待对照"} · {product.detailCount} 个源仓</small></div></div></td>
        {data.columns.map(column => { const cell = product.cells.find(value => value.columnKey === column.key); return <td key={column.key} className={cell?.hasStockout ? "jd-cwarehouse-risk-cell" : undefined}>{cell ? <StockCell metrics={cell} /> : <span className="jd-cwarehouse-no-source" title="暂无该范围来源">—</span>}</td>; })}
        <td className="jd-cwarehouse-total-cell"><StockCell metrics={product.summary} /></td>
      </tr>{expanded && <tr id={detailsId} className="jd-cwarehouse-details-row"><td colSpan={data.columns.length + 2}><CwarehouseDetails rows={product.details} complete={product.detailsComplete} count={product.detailCount} productName={product.goodsName || product.goodsCode} summary={product.summary} /></td></tr>}</Fragment>;
    })}{!data.items.length && <tr><td colSpan={data.columns.length + 2}><div className="table-state">当前范围暂无已导入单品。</div></td></tr>}</tbody></table></div>;
}
