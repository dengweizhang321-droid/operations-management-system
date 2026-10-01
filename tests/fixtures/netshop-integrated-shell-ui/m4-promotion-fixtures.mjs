/** Byte-preserved source6 Owner-A PG captures. Projections change only bounded
 * list presentation/typed parent echo; never money, ratios, dates or coverage. */
import whole from "./source6/response-seven-day-shop-week.json";
import six from "./source6/response-seven-day-shop-week-object-focus-six.json";
import exact from "./source6/response-seven-day-shop-week-exact-product.json";
import detail from "./source6/response-seven-day-shop-week-exact-detail.json";
import diagnosticCurrent from "./source6/diagnostic-current.json";
import diagnosticPrevious from "./source6/diagnostic-previous-equal.json";
import { validatePromotionQuery, decodePromotionInsightsForQuery, decodePromotionDetailForQuery, PROMOTION_SORTS } from "@/lib/netshop/promotion-insights-contract";
import { validateDiagnosticResponse } from "@/lib/jd/promotion-diagnostic-report";

export const m4OwnerIdentity = exact.sections.listScope.productFocus.identity;
export const m4OwnerRevision = exact.context.sourceRevisions.find(item => item.kind === "owning_revision").revision;
export const m4FixtureLimits = { source: "Root06 actual-capture-final-source6 manifest; byte-preserved 7-day/week/full/exact/6-day-focus/report DTOs", identity: m4OwnerIdentity, owningRevision: m4OwnerRevision };
export function projectM4Promotion(url, telemetry) {
  const isDetail = url.pathname.endsWith("/detail"), params = url.searchParams, spec = validatePromotionQuery(params, isDetail);
  const shopKey = `${m4OwnerIdentity.platform}\u001f${m4OwnerIdentity.shopName}`;
  if (spec.context.window.startDate !== "2026-09-01" || spec.context.window.endDate !== "2026-09-07" || spec.trendGrain !== "week" || spec.objectKind !== "product" || spec.platform !== "京东" || spec.context.shops.length !== 1 || spec.context.shops.some(shop => `${shop.platform}\u001f${shop.shopName}` !== shopKey)) throw Error("synthetic_fixture_pending: source6 does not cover this scope/date/grain/kind");
  if (spec.productIdentity && JSON.stringify(spec.productIdentity) !== JSON.stringify(m4OwnerIdentity)) throw Error("synthetic_fixture_pending: no captured exact product fixture for this ID");
  const objectFocus = params.has("objectStartDate");
  if (objectFocus && (spec.objectStartDate !== "2026-09-01" || spec.objectEndDate !== "2026-09-06") || spec.productIdentity && objectFocus) throw Error("synthetic_fixture_pending: no captured combined product/date focus DTO");
  const raw = isDetail ? detail : objectFocus ? six : spec.productIdentity ? exact : whole;
  const body = structuredClone(raw), parentToken = spec.productIdentity ? exact.sectionToken : whole.sectionToken;
  if (spec.sectionToken && spec.sectionToken !== parentToken || params.has("snapshotToken") && params.get("snapshotToken") !== body.context.snapshotToken) throw Error("promotion_revision_changed");
  if (isDetail) {
    if (spec.objectId !== detail.sections.item.rowKey || spec.shopKey !== detail.sections.item.shopKey) throw Error("synthetic_fixture_pending: only actual SKU-001 detail captured");
    body.sectionToken = parentToken;
    decodePromotionDetailForQuery(body, params, m4OwnerRevision);
  } else {
    body.sections.listScope.q = spec.q;
    const fields = { spend_desc: row => row.metrics.spend.value, attributedPayment_desc: row => row.metrics.attributedPayment.value, roas_desc: row => row.metrics.roas.value, spend_change_desc: row => row.changes.spend.previous.value, spend_change_asc: row => row.changes.spend.previous.value };
    if (PROMOTION_SORTS.length !== Object.keys(fields).length || !PROMOTION_SORTS.every(key => Object.hasOwn(fields, key))) throw Error("synthetic_fixture_pending: mock sorter does not implement the actual v1 enum");
    const rows = body.sections.items.filter(item => !spec.q || [item.id, item.title, item.shopName].some(value => value?.includes(spec.q)));
    rows.sort((a, b) => { const x = fields[spec.sort](a), y = fields[spec.sort](b); return x === null || y === null ? x === y ? a.rowKey.localeCompare(b.rowKey) : x === null ? 1 : -1 : (spec.sort === "spend_change_asc" ? x - y : y - x) || a.rowKey.localeCompare(b.rowKey); });
    body.sections.items = rows.slice((spec.page - 1) * spec.pageSize, spec.page * spec.pageSize);
    body.sections.pagination = { page: spec.page, pageSize: spec.pageSize, total: rows.length, returned: body.sections.items.length, hasMore: spec.page * spec.pageSize < rows.length, truncated: false };
    decodePromotionInsightsForQuery(body, params, m4OwnerRevision);
  }
  telemetry.projections.push({ path: url.pathname, fixture: isDetail ? "source6/exact-detail" : objectFocus ? "source6/object-focus-six" : spec.productIdentity ? "source6/exact-product" : "source6/seven-day-shop-week", fixture_projection: isDetail ? "Same actual SKU-001/shop/full-period detail; typed parent section echo uses captured whole/exact parent token. No numeric/date/coverage change." : "Bounded literal search, supplied-metric ordering and pagination over full captured object rows; complete summary/trend/contribution/calendar/coverage/identity data preserved. SQL sort semantics not claimed." });
  return body;
}
export function projectM4Diagnostic(url, telemetry) {
  const q = url.searchParams, from = q.get("startDate"), to = q.get("endDate"), body = from === "2026-09-01" && to === "2026-09-07" ? diagnosticCurrent : from === "2026-08-25" && to === "2026-08-31" ? diagnosticPrevious : null;
  if (!body) throw Error("synthetic_fixture_pending: source6 report period not captured");
  validateDiagnosticResponse(body, m4OwnerRevision, { shopName: m4OwnerIdentity.shopName, startDate: from, endDate: to, expectedOwningRevision: m4OwnerRevision });
  telemetry.projections.push({ path: url.pathname, fixture: from === "2026-09-01" ? "source6/diagnostic-current" : "source6/diagnostic-previous-equal", fixture_projection: "none; actual PG report DTO and owning header preserved" });
  return structuredClone(body);
}
export function projectM4Product(body, url, telemetry) {
  if (body.schemaVersion !== "netshop-product-insights-v1") return body;
  let result = body;
  if (url.searchParams.get("dimension") === "sku") result = JSON.parse(JSON.stringify(body).replaceAll("jd_sku_daily:spu_daily:京东", "jd_sku_daily:sku_daily:京东"));
  const alignOwning = value => { if (!value || typeof value !== "object") return; if (value.domain === "netshop" && value.kind === "owning_revision") value.revision = m4OwnerRevision; for (const child of Object.values(value)) alignOwning(child); };
  alignOwning(result);
  const selected = rows => rows.map(row => row.identity.id === "P21" ? { ...row, identity: { ...m4OwnerIdentity }, title: `合成商品 ${m4OwnerIdentity.id}` } : row);
  if (result.sections.items) { result.sections.items = selected(result.sections.items); result.sections.growth.data.items = selected(result.sections.growth.data.items); result.sections.efficiency.watchlist = selected(result.sections.efficiency.watchlist); }
  else if (JSON.stringify(result.identity) === JSON.stringify(m4OwnerIdentity)) {
    result.sections.promotion.data.mapping = { status: "verified", method: "exact_code_shop", sourceId: "jd_promotion", version: m4OwnerRevision, code: m4OwnerIdentity.id, effectiveFrom: result.context.periods.current.startDate, effectiveTo: result.context.periods.current.endDate, reasonCode: null };
    for (const metric of Object.values(result.sections.promotion.data.metrics)) metric.reasonCode = "unverified_source";
    result.sections.metadata.limitations.push("fixture_projection: synthetic P positive mapping eligibility uses actual A unique SKU/shop link; P numeric fields remain Owner synthetic values, not source proof");
  }
  telemetry.projections.push({ path: url.pathname, fixture: "Owner-P synthetic builder + completeProductSectionsFixture", fixture_projection: "P21 identity renamed to actual A SKU-001; SKU source labels and owning-header echo aligned. P positive mapping is explicit synthetic UI eligibility; P numeric cells unchanged, no numeric parity with A claimed." });
  return result;
}
