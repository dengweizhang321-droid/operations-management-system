/** Actual C owning PG receipts. Only supplied table rows are projected for
 * display sort/page; no metric, F carrier, denominator, dates or source rewrite. */
import corpus from "./m5m6-C-source/index.mjs";
import { validateComparisonQuery, decodeComparisonInsights } from "@/app/netshop/comparison/contract";
import panorama from "./m5m6-source/response-owning-jd.json";
import owningP from "./m5m6-source/P-owning-view.json";
import owningA from "./m5m6-source/A-owning-view.json";
import owningSeries from "./m5m6-source/series-owning-view.json";
import sourceMeta from "./m5m6-source/metadata.json";
import owningSales from "@/tests/fixtures/netshop-panorama/response-sales.json";
import owningSalesMissingOrder from "@/tests/fixtures/netshop-panorama/response-sales-missing-order.json";
import owningWorkflow from "@/tests/fixtures/netshop-panorama/response-workflow.json";
import { validatePanoramaQuery,decodeStorePanorama } from "@/app/netshop/panorama/contract";
import { decodeProductInsights } from "@/app/netshop/products/contract";
import { decodePromotionInsightsForQuery } from "@/lib/netshop/promotion-insights-contract";
import { validateContextQuery } from "@/lib/netshop/insights-contract";

export const comparisonFixtureScopes = corpus.cases.map(record => ({name:record.name,query:record.request.query,revision:record.request.headerRevision}));
const comparable = value => JSON.stringify(value);
function queryFamily(spec){return {platforms:[...spec.shared.platforms].sort(),shops:spec.shared.shops,dimension:spec.shared.dimension,periodKind:spec.shared.periodKind,current:spec.shared.window,scope:spec.scope,baseline:spec.baseline,metricKey:spec.metricKey,trendGrain:spec.trendGrain};}
export async function projectM5M6Comparison(url,telemetry){
  const spec=validateComparisonQuery(url.searchParams);
  const record=corpus.cases.find(row=>(!window.__integratedControl.comparisonCapture||row.name===window.__integratedControl.comparisonCapture)&&comparable(queryFamily(validateComparisonQuery(new URLSearchParams(row.request.query))))===comparable(queryFamily(spec)));
  if(!record)throw new Error("synthetic_fixture_pending: no actual C scope/date/baseline/category/metric/grain capture for this query");
  if((url.searchParams.get("q")||"").trim()!==(new URLSearchParams(record.request.query).get("q")||"").trim())throw new Error("synthetic_fixture_pending: table search requires an actual owning capture");
  const body=structuredClone(record.response),sourceRows=body.sections.scale.items;
  if(sourceRows.length!==body.sections.scale.pagination.total)throw new Error("synthetic_fixture_pending: captured C ranking is not the full set for presentation projection");
  if(spec.chartObjectKeys.length&&comparable(spec.chartObjectKeys)!==comparable(body.chartObjectKeys))throw new Error("synthetic_fixture_pending: C chart selection requires an actual owning capture");
  if(spec.sectionToken&&spec.sectionToken!==body.sectionToken||url.searchParams.has("snapshotToken")&&url.searchParams.get("snapshotToken")!==body.currentContext.snapshotToken)throw new Error("comparison_revision_changed");
  const field=row=>spec.sort.startsWith("growth")||spec.sort.startsWith("decline")?row.comparisons[spec.metricKey].value:row.current[spec.metricKey].value;
  const rows=[...sourceRows].sort((a,b)=>{
    if(a.qualification.comparable!==b.qualification.comparable)return a.qualification.comparable?-1:1;
    if(spec.sort==="name_asc")return a.objectKey.localeCompare(b.objectKey);
    const x=field(a),y=field(b);return x===null||y===null?x===y?a.objectKey.localeCompare(b.objectKey):x===null?1:-1:(spec.sort==="value_asc"||spec.sort==="decline_desc"?x-y:y-x)||a.objectKey.localeCompare(b.objectKey);
  });
  body.sort=spec.sort;
  body.sections.scale.items=rows.slice((spec.page-1)*spec.pageSize,spec.page*spec.pageSize);
  body.sections.scale.pagination={page:spec.page,pageSize:spec.pageSize,total:rows.length,returned:body.sections.scale.items.length,hasMore:spec.page*spec.pageSize<rows.length,truncated:false};
  const keys=body.sections.scale.items.map(row=>row.objectKey);body.sections.efficiency.items=keys;body.sections.promotion.items=keys;
  await decodeComparisonInsights(body,url.searchParams,record.request.headerRevision);
  telemetry.projections.push({path:url.pathname,fixture:record.name,fixture_projection:"table-only: sorting supplied metric/change values and paging captured full rows; efficiency/promotion page references follow the same keys. All source/F carriers, money, operands, summary, distributions, contributions, scope, dates and complete candidates unchanged."});
  return {body,revision:record.request.headerRevision};
}
const sharedFamily=params=>{const s=validateContextQuery(params);return {platforms:s.platforms,shops:s.shops,dimension:s.dimension,periodKind:s.periodKind,window:s.window};};
export function projectM5M6Panorama(url,telemetry){
  const selected=window.__integratedControl.panoramaCapture;
  const capture={sales:owningSales,"sales-missing-order":owningSalesMissingOrder,workflow:owningWorkflow}[selected];
  if(selected&&!capture)throw new Error("synthetic_fixture_pending: unknown owning panorama capture");
  const original=capture||panorama;
  const carrier=original.context,table=original.tableScope;
  const reference=capture?new URLSearchParams({platform:carrier.requestedScope.platforms[0],outlet:carrier.requestedScope.shopKeys[0],dimension:carrier.requestedScope.dimension,startDate:carrier.periods.current.startDate,endDate:carrier.periods.current.endDate,periodKind:carrier.requestedScope.periodKind,...Object.fromEntries(Object.entries(table).map(([key,value])=>[key,String(value)]))}):new URLSearchParams(sourceMeta.Squery);
  const revision=capture?carrier.sourceRevisions.find(ref=>ref.domain==="netshop"&&ref.kind==="owning_revision").revision:sourceMeta.owningHeader;
  const spec=validatePanoramaQuery(url.searchParams),expected=validatePanoramaQuery(reference);
  if(comparable(sharedFamily(spec.query))!==comparable(sharedFamily(expected.query))||spec.tableScope.grain!==expected.tableScope.grain||spec.tableScope.q!==""||spec.tableScope.page!==1||spec.tableScope.pageSize!==5)throw new Error("synthetic_fixture_pending: actual S capture supports JD/A SPU 9/1 custom/day empty-search page1 size5 only");
  const body=structuredClone(original);
  body.tableScope.section=spec.tableScope.section;
  decodeStorePanorama(body,url.searchParams,revision);
  telemetry.projections.push({path:url.pathname,fixture:selected?`S-owning-${selected}`:"S-owning-e8f7",fixture_projection:"section-only presentation echo; actual full S source envelope, table rows, all money/operands/F dates/carriers/coverage/identities unchanged; source states remain exactly as captured"});
  return {body,revision};
}
export function projectM5M6OwningTopic(url,telemetry){
  const kind=url.pathname==="/api/netshop/product-insights"?"P":url.pathname==="/api/netshop/promotion-insights"?"A":null;
  if(!kind)throw new Error("synthetic_fixture_pending: actual source e8f7 has no detail response");
  const reference=new URLSearchParams(sourceMeta.files[kind].query),params=url.searchParams;
  const keys=kind==="P"?["platform","outlet","dimension","startDate","endDate","periodKind","q","page","pageSize","sort"]:["platform","outlet","dimension","startDate","endDate","periodKind","q","page","pageSize","objectKind","sort","trendGrain"];
  if(keys.some(key=>comparable(params.getAll(key))!==comparable(reference.getAll(key))))throw new Error(`synthetic_fixture_pending: actual ${kind} extracted source query differs`);
  const body=structuredClone(kind==="P"?owningP:owningA);
  if(kind==="P")decodeProductInsights(body,params,sourceMeta.owningHeader);else decodePromotionInsightsForQuery(body,params,sourceMeta.owningHeader);
  telemetry.projections.push({path:url.pathname,fixture:`S-owning-e8f7/${kind}-nested-view`,fixture_projection:"none; Owner extracted unchanged nested P/A envelope, not an independent HTTP capture; P SPU and A JD SKU are not remapped"});
  return {body,revision:sourceMeta.owningHeader};
}
