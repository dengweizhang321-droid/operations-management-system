import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { jdInventoryHealthStates, type JdInventoryHealthCounts } from "../lib/inventory/jd-logistics-contract";
import ProductMatrix, { compactProductTitle, cwarehouseMetricFields, cwarehouseQualificationLabel, decodeCwarehouseProductMonitor, type CwarehouseMetricSet, type CwarehouseProductMonitor } from "../app/jd-logistics-product-matrix";

const healthCounts = (): JdInventoryHealthCounts => Object.fromEntries(["all", ...jdInventoryHealthStates].map(state => [state, 0])) as JdInventoryHealthCounts;
function metrics(overrides: Partial<CwarehouseMetricSet> = {}): CwarehouseMetricSet {
  return { ...Object.fromEntries(cwarehouseMetricFields.map(key => [key, null])), metricQualifications: {}, qualifications: [], warningState: "unconfigured", inventoryHealthState: "insufficient_evidence", inventoryHealthReasons: [], healthCounts: healthCounts(), hasStockout: false, hasReplenishmentNeed: false, ...overrides } as CwarehouseMetricSet;
}
function fixture(): CwarehouseProductMonitor {
  const detail = { ...metrics({ onHandQuantity: 5, availableQuantity: 0, lockedQuantity: 0, transferInTransitQuantity: 5, sales7dQuantity: 2, sales30dQuantity: 2, turnoverDays: 75, stockoutAvailableDays30d: 0, nativeTurnover30d: 12.5, warningState: "unconfigured", inventoryHealthState: "stockout", hasStockout: true }), id: "detail-one", warehouseKey: "name:合成甲仓", warehouseName: "合成甲仓", warehouseCode: "", sourceProvinceCity: "原文省市甲", realtimeDate: "2026-10-15", realtimeCollectedAt: "2026-10-15T07:59:21.571581+00:00", snapshotDate: "2026-10-14", datePairing: "previous_day", salesAsOfDate: "2026-10-14" };
  return { layout: "product", salesWindow: 30, healthState: "all", healthCounts: { ...healthCounts(), all: 61, stockout: 20, replenish: 41 }, healthFilterCounts: { ...healthCounts(), all: 61, stockout: 20, replenish: 55 }, columns: [{ key: "raw-city", label: "原文省市甲", kind: "source_province_city", sourceProvinceCity: "原文省市甲", warehouseKeys: ["name:合成甲仓"] }, { key: "warehouse-one", label: "无省市仓甲", kind: "warehouse", warehouseKeys: ["name:无省市仓甲"] }, { key: "warehouse-two", label: "无省市仓乙", kind: "warehouse", warehouseKeys: ["name:无省市仓乙"] }], items: [{ ...metrics(), id: "product-one", departmentId: "synthetic", businessUnitCode: "SYNTHETIC", goodsCodeKind: "jd_sku", goodsCode: "SYNTHETIC-SKU", goodsName: "合成矩阵商品", erpGoodsCode: "", erpGoodsName: "", imageUrl: null, summary: metrics({ availableQuantity: 999, purchaseInTransitQuantity: 20, transferInTransitQuantity: 5 }), cells: [{ ...metrics({ availableQuantity: 11, warningState: "unconfigured", inventoryHealthState: "stockout", hasStockout: true }), columnKey: "raw-city" }, { ...metrics({ availableQuantity: -3 }), columnKey: "warehouse-one" }], details: [detail], detailCount: 1, detailsComplete: true }], total: 61, page: 2, pageSize: 25, summary: { monitoredCount: 80, qualifiedCount: 40, stockoutRiskCount: 2 }, totals: metrics({ availableQuantity: 12345 }), coverageWarnings: ["合成验证"], notificationAvailable: false };
}
function render(data: CwarehouseProductMonitor, expanded = false) {
  return renderToStaticMarkup(createElement(ProductMatrix, { data, expandedIds: new Set(expanded ? ["product-one"] : []), onToggle: () => undefined }));
}

test("single-product matrix uses server totals and complete source columns without summing current-page cells", () => {
  const value = decodeCwarehouseProductMonitor(fixture());
  assert.equal(value.total, 61); assert.equal(value.page, 2); assert.equal(value.totals.availableQuantity, 12345);
  const html = render(value);
  assert.match(html, /999<\/span>/); assert.match(html, /11<\/span>/); assert.match(html, /-3<\/span>/);
  assert.match(html, /无省市仓甲/); assert.match(html, /无省市仓乙/); assert.match(html, /暂无该范围来源/);
  assert.match(html, /jd-cwarehouse-risk-cell/); assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /<img|中山|昆山|15日|京东原生30天周转/);
});

test("expanded product retains warehouse sources, original turnover and separate unknown metrics", () => {
  const html = render(fixture(), true);
  assert.match(html, /aria-expanded="true"/); assert.match(html, /合成矩阵商品的分仓明细/);
  assert.match(html, /京东原生30天周转/); assert.match(html, /系统30日周转/); assert.match(html, /12.5<\/span>/);
  assert.match(html, /缺货依据（30日可售）/); assert.match(html, /缺货依据（30日可售）[^<]*<span[^>]*>0<\/span>天/); assert.match(html, /75<\/span>/);
  assert.match(html, /15:59:21/); assert.match(html, /title="2026-10-15T07:59:21.571581\+00:00"/);
  assert.match(html, /显示 1 \/ 1 个仓库身份/); assert.match(html, /2026-10-14/); assert.match(html, /T-1/);
  assert.match(html, /锁定/); assert.match(html, /含在途可售/); assert.match(html, /—/);
  const partial = fixture(); partial.items[0].detailsComplete = false; partial.items[0].detailCount = 201;
  assert.match(render(decodeCwarehouseProductMonitor(partial), true), /分仓明细未完整返回/);
});

test("matrix contract rejects duplicate or foreign columns, missing metrics and falsely complete details", () => {
  const duplicate = fixture(); duplicate.columns.push(duplicate.columns[0]); assert.throws(() => decodeCwarehouseProductMonitor(duplicate), /响应不完整/);
  const foreign = fixture(); foreign.items[0].cells[0].columnKey = "unreported-scope"; assert.throws(() => decodeCwarehouseProductMonitor(foreign), /响应不完整/);
  const incomplete = fixture(); incomplete.items[0].detailCount = 2; assert.throws(() => decodeCwarehouseProductMonitor(incomplete), /响应不完整/);
  const missing = fixture(); delete (missing.items[0].summary as Partial<CwarehouseMetricSet>).availableQuantity; assert.throws(() => decodeCwarehouseProductMonitor(missing), /响应不完整/);
  const textWindow = { ...fixture(), salesWindow: "7" }; assert.throws(() => decodeCwarehouseProductMonitor(textWindow), /响应不完整/);
});

test("backend metric reason codes have Chinese explanations", () => {
  assert.equal(cwarehouseQualificationLabel("missing_onHandQuantity"), "缺少现有库存");
  assert.equal(cwarehouseQualificationLabel("nonpositive_sales7dQuantity"), "7日销量不大于零");
  assert.equal(cwarehouseQualificationLabel("native_turnover_not_additive"), "京东原生周转不跨仓平均");
  assert.equal(cwarehouseQualificationLabel("period_mismatch"), "成员来源日期不一致，天数不可合并计算");
  assert.equal(cwarehouseQualificationLabel("missing_stockoutAvailableDays30d"), "缺少30日可用库存可售天数");
});

test("compact identity preserves full source title and places complete-scope total at the right", () => {
  const data = fixture();
  const full = "合成品牌😀 商用研磨机粉碎机超长商品标题及完整型号不会被覆盖";
  data.items[0].goodsName = full;
  const before = JSON.stringify(data);
  const html = render(data);
  assert.equal(Array.from(compactProductTitle(full)).length, 25);
  assert.ok(compactProductTitle(full).endsWith("…"));
  assert.ok(html.includes(`title="${full}"`));
  const header = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
  assert.ok(header.indexOf("当前范围合计") > header.indexOf("无省市仓乙"));
  assert.equal(JSON.stringify(data), before);
});

test("compact detail table displays backend suggestion and full-scope summary without deriving a recommendation", () => {
  const data = fixture();
  data.items[0].details[0].suggestedReplenishmentQuantity = 3;
  data.items[0].details[0].replenishmentCycleDays = 30;
  data.items[0].summary.suggestedReplenishmentQuantity = 41;
  data.items[0].summary.replenishmentCycleDays = 30;
  const html = render(data, true);
  assert.match(html, /城市 \/ 仓/); assert.match(html, /建议补货/);
  assert.match(html, /jd-cwarehouse-suggestion[^>]*><span[^>]*>3<\/span>/);
  assert.match(html, /jd-cwarehouse-detail-total[\s\S]*?jd-cwarehouse-suggestion[^>]*><span[^>]*>41<\/span>/);
  assert.match(html, /数据日期与计算依据/);
  assert.doesNotMatch(html, /全国/);
});


test("independent inventory health stays visible when notification threshold is unconfigured", () => {
  const data = fixture();
  Object.assign(data.items[0].summary, { inventoryHealthState: "stockout", hasStockout: true, hasReplenishmentNeed: true, warningState: "unconfigured", inventoryHealthReasons: ["available_nonpositive_with_positive_demand"] });
  const html = render(data, true);
  assert.match(html, /jd-cwarehouse-product-identity[\s\S]*?status-danger[^>]*>缺货<\/span>/);
  assert.match(html, /需补货/); assert.match(html, /30日有销量且可用库存不大于零/);
  assert.doesNotMatch(html, /未配置阈值/);
  const decoded = decodeCwarehouseProductMonitor(data);
  assert.equal(decoded.healthFilterCounts.replenish, 55);
  assert.equal(decoded.items.length, 1);
});

test("health contract rejects missing counts, invalid states and coerced boolean flags", () => {
  const counts = fixture(); delete (counts.healthFilterCounts as Partial<JdInventoryHealthCounts>).stockout;
  assert.throws(() => decodeCwarehouseProductMonitor(counts), /响应不完整/);
  const state = fixture(); Reflect.set(state.items[0].summary, "inventoryHealthState", "unconfigured");
  assert.throws(() => decodeCwarehouseProductMonitor(state), /响应不完整/);
  const flag = fixture(); Reflect.set(flag.items[0].details[0], "hasStockout", "true");
  assert.throws(() => decodeCwarehouseProductMonitor(flag), /响应不完整/);
});
