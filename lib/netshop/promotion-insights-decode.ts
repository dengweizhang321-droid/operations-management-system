import { decodeDerivedMoneyPerCount, decodeInsightsContextForQuery, decodeInsightPagination, decodeMetric, encodeProductIdentity, metricReasons, type InsightsContext, type SourceCoverage } from "./insights-contract";
import { NetshopQueryError, isNetshopIsoDate, readNetshopOutletFilters } from "./query-contract";
import { validatePromotionQuery } from "./promotion-insights-query";
import { PROMOTION_COLUMN_VERSION, PROMOTION_METRIC_KEYS, PROMOTION_OBJECT_KINDS, type PromotionCpc, type PromotionDetailResponse, type PromotionInsightsResponse } from "./promotion-insights-contract";

function fail(message: string): never { throw new NetshopQueryError("invalid_promotion_insights_contract", message); }
function rec(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) fail("推广响应对象无效"); return value as Record<string, unknown>; }
function txt(value: unknown, maximum = 200): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value); }
function int(value: unknown, maximum = Number.MAX_SAFE_INTEGER) { return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum; }
function token(value: unknown) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function notes(value: unknown, maximum = 50) { if (!Array.isArray(value) || value.length > maximum || !value.every(v => txt(v, 1500))) fail("推广说明超出边界"); }
function nullableText(value: unknown, maximum = 200) { if (value !== null && !txt(value, maximum)) fail("推广来源身份或字段无效"); }
function dates(value: unknown, context: InsightsContext, period?: "current" | "previous" | "yearAgo") {
  if (!Array.isArray(value) || value.length > 1099 || new Set(value).size !== value.length) fail("推广日期集合无效");
  const windows = period ? [context.periods[period]] : [context.periods.current, context.periods.previous, context.periods.yearAgo];
  if (!value.every(v => typeof v === "string" && isNetshopIsoDate(v) && windows.some(w => v >= w.startDate && v <= w.endDate))) fail("推广日期超出原范围");
  return value as string[];
}
function shop(value: unknown, context: InsightsContext) { if (typeof value !== "string" || !context.effectiveScope.shopKeys.includes(value)) fail("推广对象串店或越权"); return readNetshopOutletFilters([value])[0]; }
function coverage(value: unknown, context: InsightsContext) {
  const c = rec(value);
  if (!int(c.expectedShopDatePairs, 100000) || !int(c.coveredShopDatePairs, Number(c.expectedShopDatePairs)) || c.truncated !== false || c.complete !== (Number(c.expectedShopDatePairs) > 0 && c.coveredShopDatePairs === c.expectedShopDatePairs) || !Array.isArray(c.missingByShop) || c.missingByShop.length > 50) fail("推广覆盖统计不完整");
  const seen = new Set<string>(); let missing = 0;
  for (const raw of c.missingByShop) { const m = rec(raw); shop(m.shopKey, context); if (seen.has(String(m.shopKey))) fail("推广覆盖店铺重复"); seen.add(String(m.shopKey)); missing += dates(m.dates, context).length; }
  if (missing !== Number(c.expectedShopDatePairs)-Number(c.coveredShopDatePairs)) fail("推广覆盖和缺日不一致");
  return c as SourceCoverage;
}
function registry(value: unknown, context: InsightsContext) {
  const extra = rec(value);
  if (Object.keys(extra).length > 2500) fail("推广覆盖引用超限");
  const result: Record<string, SourceCoverage> = { ...context.coverageBySource };
  for (const [ref, raw] of Object.entries(extra)) { if (!txt(ref) || !ref.startsWith("promotion:") || Object.hasOwn(result, ref)) fail("推广覆盖标签无效或重复"); result[ref] = coverage(raw, context); }
  return result;
}
function referenced(value: unknown, covers: Record<string, SourceCoverage>, context: InsightsContext, cpc = false) {
  const m = cpc ? (() => {
    const decoded = decodeDerivedMoneyPerCount(value); if (decoded.denominatorKind !== "clicks") fail("CPC须使用真实点击次数分母"); return decoded as PromotionCpc;
  })() : decodeMetric(value);
  if (!Object.hasOwn(covers, m.coverageRef)) fail("推广指标引用未知覆盖");
  if (m.status === "available" && !covers[m.coverageRef].complete) fail("可用指标须绑定它自己的完整来源范围");
  const sources = new Set(context.freshness.flatMap(v => [v.sourceId, v.sourceId.split(":")[0]]));
  if (m.sourceIds.some(v => !sources.has(v))) fail("推广指标引用未知来源");
  return m;
}
function metricMap(value: unknown, covers: Record<string, SourceCoverage>, context: InsightsContext) {
  const m = rec(value), units = { spend: "CNY_CENT", attributedPayment: "CNY_CENT", roas: "MULTIPLE", impressions: "COUNT", clicks: "COUNT", ctr: "RATIO", orders: "COUNT", spendRate: "RATIO" };
  for (const key of PROMOTION_METRIC_KEYS) { const item = referenced(m[key], covers, context, key === "cpc"); if (key !== "cpc" && item.unit !== units[key]) fail("推广指标单位被替换"); }
}
function comparisons(value: unknown) {
  const c = rec(value);
  for (const key of PROMOTION_METRIC_KEYS) for (const period of ["previous", "yearAgo"]) {
    const m = rec(rec(c[key])[period]), expected = key === "ctr" || key === "spendRate" ? "percentage_points" : "relative_change";
    if (m.method !== expected || !["available", "unavailable"].includes(String(m.status)) || m.status === "available" && (typeof m.value !== "number" || !Number.isFinite(m.value) || m.reasonCode !== null) || m.status === "unavailable" && (m.value !== null || !metricReasons.includes(m.reasonCode as typeof metricReasons[number]))) fail("推广比较方法、状态或数值无效");
  }
}
function changes(value: unknown, covers: Record<string, SourceCoverage>, context: InsightsContext) {
  const r = rec(value);
  for (const key of ["spend", "attributedPayment"]) for (const period of ["previous", "yearAgo"]) { const m = referenced(rec(r[key])[period], covers, context); if (m.unit !== "CNY_CENT" || m.aggregation !== "sum") fail("增减差额须为来源内安全整数金额"); }
}
function row(value: unknown, covers: Record<string, SourceCoverage>, context: InsightsContext) {
  const r = rec(value), outlet = shop(r.shopKey, context);
  if (!token(r.rowKey) || r.platform !== outlet.platform || r.shopName !== outlet.shopName || !PROMOTION_OBJECT_KINDS.includes(r.objectKind as typeof PROMOTION_OBJECT_KINDS[number]) || !txt(r.title, 500) || typeof r.drillable !== "boolean" || !txt(r.coverageRef) || !Object.hasOwn(covers, r.coverageRef)) fail("推广对象身份或覆盖无效");
  for (const name of ["id", "planId", "unitId", "matchType"]) nullableText(r[name]);
  if (r.id === null && r.drillable) fail("无业务身份对象不能钻取");
  if (r.observation !== undefined) for (const period of ["current", "previous", "yearAgo"] as const) { const o = rec(rec(r.observation)[period]); const observed = dates(o.observedDates, context, period), absent = dates(o.verifiedAbsentDates, context, period); if (absent.some(d => observed.includes(d)) || r.id === null && absent.length) fail("来源缺席不能冒记录或虚构身份"); }
  const identityKinds = { product: ["follow_order_sku", "promotion_product"], plan: ["plan"], unit: ["unit"], keyword: ["keyword"], search_term: ["search_term"] };
  if (!identityKinds[r.objectKind as keyof typeof identityKinds].includes(String(r.identityKind))) fail("推广、触发与跟单身份被混用");
  metricMap(r.metrics, covers, context); comparisons(r.comparisons); changes(r.changes, covers, context);
  const share = referenced(r.spendShare, covers, context); if (share.unit !== "RATIO") fail("对象花费份额单位无效");
  const mapping = rec(r.mapping);
  if (!["matched", "unmapped", "ambiguous", "not_applicable"].includes(String(mapping.status)) || !["exact_source_identity", "unverified"].includes(String(mapping.evidence))) fail("推广商品关联状态无效");
  for (const name of ["advertisedSkuId", "triggerSkuId", "followSkuId"]) nullableText(mapping[name]);
  if (mapping.status === "matched") {
    const identity = rec(mapping.linkIdentity) as unknown as Parameters<typeof encodeProductIdentity>[0]; encodeProductIdentity(identity);
    if (mapping.evidence !== "exact_source_identity" || identity.platform !== r.platform || identity.shopName !== r.shopName || identity.id !== r.id || r.objectKind !== "product") fail("商品联动不是当前对象的精确关联");
  } else if (mapping.linkIdentity !== null) fail("未关联或多义对象不得携带商品联动目标");
}
function trend(value: unknown, covers: Record<string, SourceCoverage>, context: InsightsContext, grain: string) {
  const t = rec(value); if (t.grain !== grain || !Array.isArray(t.items) || t.items.length > 366) fail("推广趋势粒度或点数无效");
  let end = "";
  for (const raw of t.items) { const point = rec(raw); if (!isNetshopIsoDate(String(point.startDate)) || !isNetshopIsoDate(String(point.endDate)) || String(point.startDate) > String(point.endDate) || String(point.startDate) <= end || String(point.startDate) < context.periods.current.startDate || String(point.endDate) > context.periods.current.endDate || point.days !== (Date.parse(String(point.endDate)+"T00:00:00Z")-Date.parse(String(point.startDate)+"T00:00:00Z"))/86400000+1 || !Object.hasOwn(covers, String(point.coverageRef))) fail("推广趋势范围无效"); end = String(point.endDate); metricMap(point.metrics, covers, context); }
}
function envelope(value: unknown, query: URLSearchParams, revision: string | null, detail: boolean) {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 2*1024*1024) fail("推广完整响应超过2MiB");
  const p = rec(value), expected = validatePromotionQuery(query, detail);
  if (p.columnVersion !== PROMOTION_COLUMN_VERSION || !token(p.sectionToken)) fail("推广专属协议或版本无效");
  if (expected.sectionToken !== null && p.sectionToken !== expected.sectionToken) fail("推广章节响应不是所属版本");
  const context = decodeInsightsContextForQuery(p.context, expected.contextQuery, revision), sections = rec(p.sections), covers = registry(sections.coverage, context);
  return { p, expected, context, sections, covers };
}
export function decodePromotionInsightsForQuery(value: unknown, query: URLSearchParams, owningRevision: string | null): PromotionInsightsResponse {
  const { p, expected, context, sections: s, covers } = envelope(value, query, owningRevision, false);
  metricMap(s.summary, covers, context); comparisons(s.comparisons); changes(s.changes, covers, context);
  const a = rec(s.attribution);
  if (a.amountDefinition !== (expected.platform === "京东" ? "jd_total_order_amount" : "tmall_net_amount") || a.orderDefinition !== (expected.platform === "京东" ? "jd_order_lines" : "tmall_net_transactions") || a.roiDisplayLabel !== "ROI" || a.window !== null && !txt(a.window)) fail("推广金额、订单或ROI定义被替换");
  const list = rec(s.listScope);
  if (list.objectKind !== expected.objectKind || list.q !== expected.q || list.objectStartDate !== expected.objectStartDate || list.objectEndDate !== expected.objectEndDate || list.summaryUnaffectedBySearch !== true) fail("对象列表或搜索改变了原范围");
  const calendar = rec(list.comparisonDates); dates(calendar.previous, context, "previous"); dates(calendar.yearAgo, context, "yearAgo");
  for (const period of ["previous", "yearAgo"] as const) { const focused = query.has("focusDate") || query.has("objectStartDate"); const targetDates = focused ? context.calendar.filter(r => r.date >= expected.objectStartDate && r.date <= expected.objectEndDate).map(r => r[period]).filter((v): v is string => v !== null) : Array.from({ length: context.periods[period].days }, (_, i) => new Date(Date.parse(context.periods[period].startDate+"T00:00:00Z")+i*86400000).toISOString().slice(0,10)); if (JSON.stringify(calendar[period]) !== JSON.stringify(targetDates)) fail("对象比较不是所属实际基期范围"); }
  const pagination = decodeInsightPagination(s.pagination);
  if (pagination.page !== expected.page || pagination.pageSize !== expected.pageSize || !Array.isArray(s.items) || s.items.length !== pagination.returned) fail("推广列表截断或分页不一致");
  const keys = new Set<string>();
  for (const raw of s.items) { row(raw, covers, context); const r = rec(raw); if (r.objectKind !== expected.objectKind || keys.has(String(r.rowKey))) fail("对象视角错位或重复"); keys.add(String(r.rowKey)); }
  trend(s.trend, covers, context, expected.trendGrain);
  const shops = rec(s.shops); if (!Array.isArray(shops.items) || shops.items.length !== context.effectiveScope.shopKeys.length || shops.visible !== (shops.items.length > 1)) fail("店铺对比集合不完整");
  const shopSet = new Set<string>();
  for (const raw of shops.items) { const r = rec(raw), o = shop(r.shopKey, context); if (shopSet.has(String(r.shopKey)) || r.shopName !== o.shopName || r.platform !== o.platform) fail("店铺对比重复或跨店"); shopSet.add(String(r.shopKey)); metricMap(r.metrics, covers, context); comparisons(r.comparisons); changes(r.changes, covers, context); const share = referenced(r.spendShare, covers, context); if (share.unit !== "RATIO") fail("店铺占比单位无效"); }
  if (s.matchedRange !== null) { const m = rec(s.matchedRange); if (!txt(m.scopeLabel, 500) || !Object.hasOwn(covers, String(m.coverageRef)) || !Array.isArray(m.shopDates) || m.shopDates.length > 50) fail("辅助费率匹配范围无效"); const seen = new Set<string>(); for (const raw of m.shopDates) { const r = rec(raw); shop(r.shopKey, context); if (seen.has(String(r.shopKey))) fail("辅助费率店铺重复"); seen.add(String(r.shopKey)); dates(r.dates, context, "current"); } for (const name of ["spend", "payment", "spendRate"]) referenced(rec(m.metrics)[name], covers, context); }
  const capabilities = rec(s.objectCapabilities);
  for (const kind of PROMOTION_OBJECT_KINDS) { const c = rec(capabilities[kind]); if (typeof c.canQuery !== "boolean" || !["available", "unavailable"].includes(String(c.status)) || !txt(c.message, 1500) || c.unidentifiedCount !== null && !int(c.unidentifiedCount, 1000000) || !Array.isArray(c.sourceIds) || !c.sourceIds.every(v => txt(v)) || c.status === "available" && c.reasonCode !== null || c.status === "unavailable" && !metricReasons.includes(c.reasonCode as typeof metricReasons[number])) fail("对象资格、字段能力或未核计数无效"); }
  const d = rec(s.diagnostic); if (!txt(d.message, 1500) || !["available", "unavailable"].includes(String(d.status)) || d.maximumDays !== 7 || d.paidModelAllowed !== false || !Array.isArray(d.reportFormats) || !d.reportFormats.every(v => ["html", "xlsx"].includes(String(v)))) fail("原诊断边界或付费限制无效"); nullableText(d.shopName);
  if (!Array.isArray(s.sourceMatrix) || s.sourceMatrix.length > 20) fail("来源能力矩阵超限");
  for (const raw of s.sourceMatrix) { const m = rec(raw); if (!txt(m.sourceId) || !txt(m.label, 500) || !Object.hasOwn(covers, String(m.coverageRef)) || !Array.isArray(m.fields) || m.fields.length > 50) fail("来源能力引用无效"); for (const rawField of m.fields) { const f = rec(rawField); if (!txt(f.field) || !["available", "unavailable"].includes(String(f.status)) || f.status === "available" && f.reasonCode !== null || f.status === "unavailable" && !metricReasons.includes(f.reasonCode as typeof metricReasons[number])) fail("来源字段状态无效"); } notes(m.notes); }
  const contributions = rec(s.contributions), lists = rec(contributions.previous);
  if (contributions.collection !== "comparable_full_set_before_search_pagination" || !int(contributions.comparedObjectCount, 100000) || !int(contributions.excludedObjectCount, 100000)) fail("贡献集合未经完整配对");
  for (const name of ["spendIncrease", "spendDecrease", "attributedPaymentIncrease", "attributedPaymentDecrease"]) { const rows = lists[name]; if (!Array.isArray(rows) || rows.length > 10) fail("贡献展示超限"); for (const r of rows) row(r, covers, context); }
  notes(s.limitations); return p as unknown as PromotionInsightsResponse;
}
export function decodePromotionDetailForQuery(value: unknown, query: URLSearchParams, owningRevision: string | null): PromotionDetailResponse {
  const { p, expected, context, sections: s, covers } = envelope(value, query, owningRevision, true);
  row(s.item, covers, context); const item = rec(s.item);
  if (item.rowKey !== expected.objectId || item.shopKey !== expected.shopKey || item.objectKind !== expected.objectKind || item.id === null || !item.drillable) fail("详情不属于请求的可靠对象");
  trend(s.trend, covers, context, expected.trendGrain);
  if (!Array.isArray(s.relations) || s.relations.length > 100) fail("对象关系超限");
  for (const raw of s.relations) { const r = rec(raw); if (r.kind !== "explicit_source_fields" || !txt(r.description, 1500) || !Array.isArray(r.sourceFields) || !r.sourceFields.every(v => txt(v)) || !Array.isArray(r.targets) || r.targets.length > 50) fail("关系未经真实来源证明"); for (const rawTarget of r.targets) { const t = rec(rawTarget); if (!PROMOTION_OBJECT_KINDS.includes(t.objectKind as typeof PROMOTION_OBJECT_KINDS[number]) || t.rowKey !== null && !token(t.rowKey)) fail("关系对象身份无效"); nullableText(t.id); } }
  notes(s.limitations); return p as unknown as PromotionDetailResponse;
}
