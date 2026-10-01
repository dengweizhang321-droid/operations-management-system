import { isNetshopIsoDate } from "./query-contract";

export const SALES_PERIODS_OPERATION = "netshop_periods_v1";
export const SALES_PERIODS_SCHEMA = "netshop-sales-periods-v1";
/** Owning integer quantity is distinct from a generic count or a historical cost proof. */
export const salesPeriodMetricMetadata = {
  money: { unit: "CNY_CENT", basis: "persisted_sales_source_amounts" },
  quantity: { unit: "NATIVE_INTEGER_QUANTITY", basis: "is_net_quantity_row_signed_source_quantity", fractionalValues: "not_supported_by_owning_column" },
  cost: { basis: "persisted_typed_source_cost", originalFieldPresence: "unknown", historicalCostVerification: "unknown", historicalMappingVerification: "unknown", zeroCostVerification: "unknown", verification: "unverified_source", primaryMetricUse: "unavailable_or_partial" },
  grossProfit: { basis: "net_sales_minus_persisted_source_cost", originalFieldPresence: "unknown", historicalCostVerification: "unknown", historicalMappingVerification: "unknown", verification: "unverified_source", primaryMetricUse: "unavailable_or_partial" },
  reportedGrossProfit: { basis: "persisted_gross_profit_may_be_write_chain_recomputed", originalFieldPresence: "unknown", historicalCostVerification: "unknown", historicalMappingVerification: "unknown", verification: "unverified_source", primaryMetricUse: "unavailable_or_partial" },
} as const;
export const salesPeriodMetrics = ["netSalesCents", "positiveSalesCents", "refundCents", "costCents", "grossProfitCents", "reportedGrossProfitCents", "feeCents", "netQuantity", "positiveQuantity", "returnQuantity", "netSalesExcludingAccessoriesCents"] as const;
export type SalesPeriodMetric = typeof salesPeriodMetrics[number];
export type RawSalesIdentity = { platform: string; rawShopName: string; rawChannel: string };
export type SalesWindowRequest = { startDate: string; endExclusive: string };
export type SalesPeriodWindow = SalesWindowRequest & { endDate: string; days: number };
export type SalesPeriodSeriesIntent = { grain: "day" | "week" | "month"; rawOutlets: RawSalesIdentity[] };
export type SalesPeriodsRequest = {
  operation: typeof SALES_PERIODS_OPERATION; current: SalesWindowRequest; baseline: SalesWindowRequest;
  rawOutlets?: RawSalesIdentity[]; categories?: string[]; q?: string; page?: number; pageSize?: number;
  expectedRevision?: string | null; snapshotToken?: string | null;
  seriesGrain?: SalesPeriodSeriesIntent["grain"]; seriesOutlets?: RawSalesIdentity[];
};
/** Internal signed-RPC field; never accepted by an external C/S query decoder. */
export type SalesPeriodsRpcRequest = SalesPeriodsRequest & { expiresAtEpochMs?: number };
export type SalesObservedPeriod = {
  values: Record<SalesPeriodMetric, number | null>; rowCount: number; rowPresence: boolean;
  orders: { basis: "ERP_order_no_only_within_exact_raw_source_identity"; trustedOrderCount: number | null; missingOrderNoRows: number | null;
    netAmountPerOrder: { unit: "CNY_CENT_PER_ORDER"; value: number | null; numerator: number | null; denominator: number | null; status: "available" | "unavailable"; reasonCode: "no_records" | "missing_order_no" | "zero_denominator" | null } };
  observations: { basis: "imported_business_date_records"; requestedDays: number; observedDateCount: number; observedDateRanges: Array<{ startDate: string; endDate: string }>; completeness: "unknown"; absenceMeaning: string };
};
export type SalesPeriodsResponse = {
  schemaVersion: typeof SALES_PERIODS_SCHEMA; operation: typeof SALES_PERIODS_OPERATION; scopeKey: string; snapshotToken: string;
  requestedScope: { current: SalesPeriodWindow; baseline: SalesPeriodWindow; rawOutlets: RawSalesIdentity[]; categories: string[]; seriesIntent?: SalesPeriodSeriesIntent };
  scopeMode: "restricted" | "unrestricted"; periods: { current: SalesPeriodWindow; baseline: SalesPeriodWindow };
  periodTotals: { current: SalesObservedPeriod; baseline: SalesObservedPeriod };
  items: Array<{ identity: RawSalesIdentity; identityKey: string; current: SalesObservedPeriod; baseline: SalesObservedPeriod }>;
  candidatePagination: { collection: "authorized_two_period_union_before_search_pagination"; candidateCount: number; filteredCount: number; q: string; page: number; pageSize: number; returned: number; hasMore: boolean; truncated: false };
  latestRelevantBatch: null | { id: string; source: string; completedAt: string | null; rowCount: number };
  sourceRevisions: Array<{ domain: "sales"; kind: "sales_erp_revision_pair"; scopeKey: string; revision: string }>;
  metricSemantics: Record<string, string>; metricMetadata: typeof salesPeriodMetricMetadata;
  series?: SalesPeriodSeries;
};
export const salesPeriodSeriesBasis = { date:"imported_business_date",bucket:"clipped_calendar_day_week_monday_sunday_month",orders:"distinct_ERP_order_no_within_exact_raw_identity_and_bucket",category:"native_resolved_category_cohort",completeness:"unknown" } as const;
export const salesSeriesWindowColumns=["startDate","endDate","endExclusive","days"] as const;
export const salesSeriesPointColumns=["window","values","rowCount","trustedOrderCount","missingOrderNoRows","netAmountPerOrderValue","observedDateCount","observedDateRanges"] as const;
export type SalesPeriodSeriesPoint=[[string,string,string,number],Array<number|null>,number,number|null,number|null,number|null,number,Array<[string,string]>];
export type SalesPeriodSeries = {schemaVersion:"netshop-sales-period-series-v1";projection:"native-period-tuples-v1";windowColumns:typeof salesSeriesWindowColumns;metricColumns:typeof salesPeriodMetrics;pointColumns:typeof salesSeriesPointColumns;scopeKey:string;intent:SalesPeriodSeriesIntent;periods:{current:SalesPeriodWindow;baseline:SalesPeriodWindow};basis:typeof salesPeriodSeriesBasis;metricMetadata:typeof salesPeriodMetricMetadata;sourceRevisions:SalesPeriodsResponse["sourceRevisions"];items:Array<{identity:RawSalesIdentity;identityKey:string;current:SalesPeriodSeriesPoint[];baseline:SalesPeriodSeriesPoint[]}>};

export class SalesPeriodsContractError extends Error { constructor(message: string) { super(message); this.name = "SalesPeriodsContractError"; } }
function fail(message: string): never { throw new SalesPeriodsContractError(message); }
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail("销售两期对象无效");
const number = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const enumValue = <T extends string>(value: unknown, allowed: readonly T[]): value is T => typeof value === "string" && allowed.includes(value as T);
const text = (value: unknown, max: number, empty = false): value is string => typeof value === "string" && value.length <= max && (empty || !!value.trim()) && !/[\u0000-\u001f\u007f]/.test(value);
const token = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const isSalesRevisionPair = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value) && value.split(":").every(part => number(Number(part)));
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []) { if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail("销售两期字段未知或缺失"); }
function window(value: unknown, expanded = false): SalesPeriodWindow {
  const w = record(value); keys(w, expanded ? ["startDate", "endExclusive", "endDate", "days"] : ["startDate", "endExclusive"]);
  if (typeof w.startDate!=="string"||typeof w.endExclusive!=="string"||!isNetshopIsoDate(w.startDate) || !isNetshopIsoDate(w.endExclusive)) fail("销售日期必须是真实ISO日期");
  const start = Date.parse(`${w.startDate}T00:00:00Z`), end = Date.parse(`${w.endExclusive}T00:00:00Z`), days = (end-start)/86400000;
  if (!number(days, 1, 366)) fail("独立销售窗口必须1—366天");
  const result = { startDate: w.startDate, endExclusive: w.endExclusive, endDate: new Date(end-86400000).toISOString().slice(0,10), days };
  if (expanded && (w.endDate !== result.endDate || w.days !== days)) fail("销售窗口派生边界不一致");
  return result;
}
function identity(value: unknown, request = false): RawSalesIdentity {
  const r=record(value);keys(r,["platform","rawShopName","rawChannel"]);
  if (!text(r.platform,200,!request) || !text(r.rawShopName,200,true) || !text(r.rawChannel,200,!request)) fail("销售RAW三元组无效；请求渠道不得缺失或为空");
  return {platform:r.platform,rawShopName:r.rawShopName,rawChannel:r.rawChannel};
}
const identityKey = (value: RawSalesIdentity) => JSON.stringify([value.platform,value.rawShopName,value.rawChannel]);
const utf8 = (value: string) => new TextEncoder().encode(value);
const byteCompare = (a: string, b: string) => { const x=utf8(a),y=utf8(b);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length; };
const compareIdentity = (a: RawSalesIdentity, b: RawSalesIdentity) => byteCompare(a.platform,b.platform)||byteCompare(a.rawShopName,b.rawShopName)||byteCompare(a.rawChannel,b.rawChannel);
export function validateSalesPeriodsRequest(value: unknown, internal = false) {
  const r=record(value);keys(r,["operation","current","baseline"],["rawOutlets","categories","q","page","pageSize","expectedRevision","snapshotToken","seriesGrain","seriesOutlets",...(internal?["expiresAtEpochMs"]:[])]);
  if(!enumValue(r.operation,[SALES_PERIODS_OPERATION]))fail("销售两期operation无效");
  const outlets=r.rawOutlets??[],categories=r.categories??[];
  if(!Array.isArray(outlets)||outlets.length>50||!Array.isArray(categories)||categories.length>50)fail("销售来源或标签数量超限");
  const identities=outlets.map(item=>identity(item,true));if(new Set(identities.map(identityKey)).size!==identities.length)fail("销售原始身份重复");
  let seriesIntent:SalesPeriodSeriesIntent|undefined;
  if(Object.hasOwn(r,"seriesGrain")||Object.hasOwn(r,"seriesOutlets")){
    if(!enumValue(r.seriesGrain,["day","week","month"] as const)||!Array.isArray(r.seriesOutlets)||r.seriesOutlets.length<1||r.seriesOutlets.length>4)fail("原生序列须提供真实粒度及1—4个精确RAW对象");
    const selected=r.seriesOutlets.map(item=>identity(item,true)).sort(compareIdentity);
    if(new Set(selected.map(identityKey)).size!==selected.length||identities.length&&selected.some(row=>!identities.some(item=>identityKey(item)===identityKey(row))))fail("图形对象重复或越出显式完整请求范围");
    seriesIntent={grain:r.seriesGrain,rawOutlets:selected};
  }
  if(categories.some(item=>!text(item,200))||new Set(categories).size!==categories.length)fail("原ERP标签重复或非法");
  const q=r.q??"",page=r.page??1,pageSize=r.pageSize??20;if(!text(q,120,true)||!number(page,1,10000)||!number(pageSize,1,100))fail("销售查询或分页超限");
  if(r.expectedRevision!=null&&!isSalesRevisionPair(r.expectedRevision)||r.snapshotToken!=null&&!token(r.snapshotToken))fail("销售版本种类或范围token无效");
  if(Object.hasOwn(r,"expiresAtEpochMs")&&!number(r.expiresAtEpochMs))fail("内部UTC期限无效");
  return { operation: SALES_PERIODS_OPERATION, current:window(r.current),baseline:window(r.baseline),rawOutlets:identities.sort(compareIdentity),categories:(categories as string[]).slice().sort(byteCompare),q:q.trim(),page:Number(page),pageSize:Number(pageSize),expectedRevision:r.expectedRevision??null,snapshotToken:r.snapshotToken??null,...(seriesIntent?{seriesIntent}:{}) };
}
function period(value: unknown, w: SalesPeriodWindow): SalesObservedPeriod {
  const r=record(value);keys(r,["values","rowCount","rowPresence","orders","observations"]);if(!number(r.rowCount)||r.rowPresence!==(Number(r.rowCount)>0))fail("销售有行状态不一致");
  const values=record(r.values);keys(values,[...salesPeriodMetrics]);for(const v of Object.values(values))if(r.rowPresence?!number(v,-Number.MAX_SAFE_INTEGER):v!==null)fail("销售无记录不能补零或返回非法整数");
  if(r.rowPresence){
    for(const name of ["positiveSalesCents","refundCents","positiveQuantity","returnQuantity"] as const)if(!number(values[name]))fail("销售正向与退货绝对值不能为负");
    if(values.netSalesCents!==Number(values.positiveSalesCents)-Number(values.refundCents)||values.netQuantity!==Number(values.positiveQuantity)-Number(values.returnQuantity)||values.grossProfitCents!==Number(values.netSalesCents)-Number(values.costCents))fail("销售签名净额、原数量或净额减成本口径不一致");
  }
  const o=record(r.orders);keys(o,["basis","trustedOrderCount","missingOrderNoRows","netAmountPerOrder"]);if(!enumValue(o.basis,["ERP_order_no_only_within_exact_raw_source_identity"]))fail("订单分母不能回退来源行键");
  if(r.rowPresence){if(!number(o.trustedOrderCount)||!number(o.missingOrderNoRows,0,r.rowCount)||o.trustedOrderCount>r.rowCount-o.missingOrderNoRows||(o.trustedOrderCount===0)!==(o.missingOrderNoRows===r.rowCount))fail("可信订单计数无效");}else if(o.trustedOrderCount!==null||o.missingOrderNoRows!==null)fail("无记录订单不能当零");
  const mean=record(o.netAmountPerOrder);keys(mean,["unit","value","numerator","denominator","status","reasonCode"]);
  const reason=!r.rowPresence?"no_records":Number(o.missingOrderNoRows)>0?"missing_order_no":o.trustedOrderCount===0?"zero_denominator":null;
  if(!enumValue(mean.unit,["CNY_CENT_PER_ORDER"])||!enumValue(mean.status,["available","unavailable"])||(mean.reasonCode!==null&&!enumValue(mean.reasonCode,["no_records","missing_order_no","zero_denominator"]))||mean.numerator!==values.netSalesCents||mean.denominator!==o.trustedOrderCount||mean.reasonCode!==reason||mean.status!==(reason?"unavailable":"available"))fail("订单净额均值或缺号原因不一致");
  if(reason?mean.value!==null:typeof mean.value!=="number"||!Number.isFinite(mean.value)||mean.value!==Number(mean.numerator)/Number(mean.denominator))fail("订单净额均值不能伪造");
  const c=record(r.observations);keys(c,["basis","requestedDays","observedDateCount","observedDateRanges","completeness","absenceMeaning"]);
  if(!enumValue(c.basis,["imported_business_date_records"])||!enumValue(c.completeness,["unknown"])||c.requestedDays!==w.days||!number(c.observedDateCount,r.rowPresence?1:0,w.days)||c.observedDateCount>r.rowCount||!Array.isArray(c.observedDateRanges)||c.observedDateRanges.length>w.days||!text(c.absenceMeaning,500))fail("观察日期不能冒店日完整结算");
  let count=0,previous=0;for(const range of c.observedDateRanges){const x=record(range);keys(x,["startDate","endDate"]);if(typeof x.startDate!=="string"||typeof x.endDate!=="string"||!isNetshopIsoDate(x.startDate)||!isNetshopIsoDate(x.endDate))fail("观察范围日期无效");const a=Date.parse(`${x.startDate}T00:00:00Z`),b=Date.parse(`${x.endDate}T00:00:00Z`);if(a>b||x.startDate<w.startDate||x.endDate>=w.endExclusive||previous&&a<=previous+86400000)fail("观察范围不是有界、唯一压缩日期");count+=(b-a)/86400000+1;previous=b;}if(count!==c.observedDateCount)fail("观察日期数不一致");
  return r as SalesObservedPeriod;
}
/** Declared native calendar boundaries; never a business value aggregation. */
export function salesPeriodBuckets(w:SalesPeriodWindow,grain:SalesPeriodSeriesIntent["grain"]):SalesPeriodWindow[]{
  const end=Date.parse(`${w.endExclusive}T00:00:00Z`),buckets:SalesPeriodWindow[]=[];
  for(let cursor=Date.parse(`${w.startDate}T00:00:00Z`);cursor<end;){
    const day=new Date(cursor);let last=cursor;
    if(grain==="week")last+=((7-day.getUTCDay())%7)*86400000;
    else if(grain==="month"){day.setUTCMonth(day.getUTCMonth()+1,0);last=day.getTime();}
    else if(grain!=="day")fail("原生序列粒度无效");
    last=Math.min(last,end-86400000);buckets.push(window({startDate:new Date(cursor).toISOString().slice(0,10),endExclusive:new Date(last+86400000).toISOString().slice(0,10)}));cursor=last+86400000;
  }
  return buckets;
}
export function restoreSalesPeriodSeriesPoint(value:unknown):{window:SalesPeriodWindow;facts:SalesObservedPeriod}{
  if(!Array.isArray(value)||value.length!==salesSeriesPointColumns.length||!Array.isArray(value[0])||value[0].length!==salesSeriesWindowColumns.length||!Array.isArray(value[1])||value[1].length!==salesPeriodMetrics.length||!number(value[2])||!Array.isArray(value[7])||value[7].some(row=>!Array.isArray(row)||row.length!==2))fail("原生元组窗口/值/计数/观察列长度或类型无效");
  const w=window(Object.fromEntries(salesSeriesWindowColumns.map((key,index)=>[key,value[0][index]])),true);
  const values=Object.fromEntries(salesPeriodMetrics.map((key,index)=>[key,value[1][index]]));
  const count=value[2],trusted=value[3],missing=value[4],reason=count===0?"no_records":missing?"missing_order_no":trusted===0?"zero_denominator":null;
  const facts={values,rowCount:count,rowPresence:count>0,orders:{basis:"ERP_order_no_only_within_exact_raw_source_identity",trustedOrderCount:trusted,missingOrderNoRows:missing,netAmountPerOrder:{unit:"CNY_CENT_PER_ORDER",value:value[5],numerator:values.netSalesCents,denominator:trusted,status:reason?"unavailable":"available",reasonCode:reason}},observations:{basis:"imported_business_date_records",requestedDays:w.days,observedDateCount:value[6],observedDateRanges:value[7].map(row=>({startDate:row[0],endDate:row[1]})),completeness:"unknown",absenceMeaning:"无记录日期不能判为店日缺源、真实零或完整结算"}};
  return {window:w,facts:period(facts,w)};
}
function series(value:unknown,expected:SalesPeriodSeriesIntent,parent:Record<string,unknown>,windows:{current:SalesPeriodWindow;baseline:SalesPeriodWindow}){
  const s=record(value);keys(s,["schemaVersion","projection","windowColumns","metricColumns","pointColumns","scopeKey","intent","periods","basis","metricMetadata","sourceRevisions","items"]);
  if(!enumValue(s.schemaVersion,["netshop-sales-period-series-v1"])||!enumValue(s.projection,["native-period-tuples-v1"])||JSON.stringify(s.windowColumns)!==JSON.stringify(salesSeriesWindowColumns)||JSON.stringify(s.metricColumns)!==JSON.stringify(salesPeriodMetrics)||JSON.stringify(s.pointColumns)!==JSON.stringify(salesSeriesPointColumns)||s.scopeKey!==parent.scopeKey)fail("原生序列版本、列顺序或父范围错位");
  const intent=record(s.intent);keys(intent,["grain","rawOutlets"]);
  if(!enumValue(intent.grain,[expected.grain])||!Array.isArray(intent.rawOutlets)||JSON.stringify(intent.rawOutlets.map(row=>identity(row,true)))!==JSON.stringify(expected.rawOutlets))fail("图形精确身份或粒度不属于请求");
  const periods=record(s.periods);keys(periods,["current","baseline"]);
  for(const kind of ["current","baseline"] as const)if(JSON.stringify(window(periods[kind],true))!==JSON.stringify(windows[kind]))fail("原生序列两期不能互换或调整");
  const basis=record(s.basis);keys(basis,Object.keys(salesPeriodSeriesBasis));for(const [field,meaning] of Object.entries(salesPeriodSeriesBasis))if(!enumValue(basis[field],[meaning]))fail("原生序列不能冒完整结算或累计日订单");
  const stable=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
  if(stable(s.metricMetadata)!==stable(parent.metricMetadata)||stable(s.sourceRevisions)!==stable(parent.sourceRevisions))fail("原生序列原生单位、未知成本或同种版本向量不完整");
  if(!Array.isArray(s.items)||s.items.length!==expected.rawOutlets.length)fail("图形对象不能省略、添加或重复");
  for(const [index,item] of s.items.entries()){
    const row=record(item);keys(row,["identity","identityKey","current","baseline"]);const id=identity(row.identity,true);
    if(identityKey(id)!==identityKey(expected.rawOutlets[index])||row.identityKey!==identityKey(id))fail("序列身份、规范key或排列越界");
    for(const kind of ["current","baseline"] as const){const points=row[kind],expectedBuckets=salesPeriodBuckets(windows[kind],expected.grain);if(!Array.isArray(points)||points.length!==expectedBuckets.length)fail("序列须覆盖原期完整自然桶，缺桶不得截断");for(const [i,value]of points.entries()){const decoded=restoreSalesPeriodSeriesPoint(value);if(JSON.stringify(decoded.window)!==JSON.stringify(expectedBuckets[i]))fail("序列桶须按原窗口剪首尾自然周/月");}}
  }
}
export function decodeSalesPeriodsForRequest(value: unknown, request: SalesPeriodsRequest | SalesPeriodsRpcRequest, revision: string | null): SalesPeriodsResponse {
  if(utf8(JSON.stringify(value)).length>2*1024*1024)fail("完整销售响应超过2MiB");
  const spec=validateSalesPeriodsRequest(request,Object.hasOwn(request,"expiresAtEpochMs")),r=record(value);
  keys(r,["schemaVersion","operation","scopeKey","snapshotToken","requestedScope","scopeMode","periods","periodTotals","items","candidatePagination","latestRelevantBatch","sourceRevisions","metricSemantics","metricMetadata",...(spec.seriesIntent?["series"]:[])]);
  if(!enumValue(r.schemaVersion,[SALES_PERIODS_SCHEMA])||!enumValue(r.operation,[SALES_PERIODS_OPERATION])||!token(r.scopeKey)||!token(r.snapshotToken)||!isSalesRevisionPair(revision)||spec.expectedRevision&&spec.expectedRevision!==revision||spec.snapshotToken&&spec.snapshotToken!==r.snapshotToken)fail("销售协议、拥有方版本或范围token错位");
  const expectedScope={current:spec.current,baseline:spec.baseline,rawOutlets:spec.rawOutlets,categories:spec.categories};
  const scope=record(r.requestedScope);keys(scope,["current","baseline","rawOutlets","categories",...(spec.seriesIntent?["seriesIntent"]:[])]);
  if(!Array.isArray(scope.rawOutlets)||!Array.isArray(scope.categories))fail("销售返回范围身份或标签无效");
  const normalizedOutlets=scope.rawOutlets.map(item=>identity(item,true)).sort(compareIdentity);
  if(spec.seriesIntent){const intent=record(scope.seriesIntent);keys(intent,["grain","rawOutlets"]);if(!enumValue(intent.grain,[spec.seriesIntent.grain])||!Array.isArray(intent.rawOutlets)||JSON.stringify(intent.rawOutlets.map(row=>identity(row,true)))!==JSON.stringify(spec.seriesIntent.rawOutlets))fail("序列选择意图回显错位");}
  if(JSON.stringify(window(scope.current,true))!==JSON.stringify(expectedScope.current)||JSON.stringify(window(scope.baseline,true))!==JSON.stringify(expectedScope.baseline)||JSON.stringify(normalizedOutlets)!==JSON.stringify(expectedScope.rawOutlets)||JSON.stringify(scope.categories)!==JSON.stringify(expectedScope.categories))fail("销售响应属于其他窗口或原始身份范围");
  if(!enumValue(r.scopeMode,["restricted","unrestricted"]))fail("销售授权模式无效");
  const windows=record(r.periods),totals=record(r.periodTotals);keys(windows,["current","baseline"]);keys(totals,["current","baseline"]);
  for(const kind of ["current","baseline"] as const){const actual=window(windows[kind],true);if(JSON.stringify(actual)!==JSON.stringify(spec[kind]))fail("用户独立窗口被调整");period(totals[kind],actual);}
  const p=record(r.candidatePagination);keys(p,["collection","candidateCount","filteredCount","q","page","pageSize","returned","hasMore","truncated"]);
  if(!enumValue(p.collection,["authorized_two_period_union_before_search_pagination"])||!number(p.page,1,10000)||!number(p.pageSize,1,100)||p.page!==spec.page||p.pageSize!==spec.pageSize||p.q!==spec.q||!number(p.candidateCount)||!number(p.filteredCount,0,Number(p.candidateCount))||!number(p.returned,0,spec.pageSize)||p.truncated!==false||p.returned!==Math.min(spec.pageSize,Math.max(0,Number(p.filteredCount)-(spec.page-1)*spec.pageSize))||p.hasMore!==(spec.page*spec.pageSize<Number(p.filteredCount))||!Array.isArray(r.items)||r.items.length!==p.returned)fail("两期完整候选分页不一致");
  let last:RawSalesIdentity|null=null;for(const item of r.items){const x=record(item);keys(x,["identity","identityKey","current","baseline"]);const id=identity(x.identity);if(x.identityKey!==identityKey(id)||last&&compareIdentity(last,id)>=0||spec.rawOutlets.length&&!spec.rawOutlets.some(selected=>identityKey(selected)===identityKey(id)))fail("候选原始身份重复、越界或非有序");last=id;period(x.current,spec.current);period(x.baseline,spec.baseline);if(record(x.current).rowCount===0&&record(x.baseline).rowCount===0)fail("候选必须来自两期完整union");}
  if(!Array.isArray(r.sourceRevisions)||r.sourceRevisions.length!==1)fail("销售参与向量必须完整且独占所属kind");const source=record(r.sourceRevisions[0]);keys(source,["domain","kind","scopeKey","revision"]);if(!enumValue(source.domain,["sales"])||!enumValue(source.kind,["sales_erp_revision_pair"])||source.scopeKey!==r.scopeKey||source.revision!==revision)fail("销售pair不能混为其他域digest版本");
  if(r.latestRelevantBatch!==null){const b=record(r.latestRelevantBatch);keys(b,["id","source","completedAt","rowCount"]);if(!text(b.id,200)||!text(b.source,200)||b.completedAt!==null&&!text(b.completedAt,100)||!number(b.rowCount))fail("相关导入批次无效");}
  const definitions=record(r.metricSemantics);if(["date","netSalesCents","costCents","grossProfitCents","reportedGrossProfitCents","quantity","orders","category"].some(key=>!text(definitions[key],2000))||Object.values(definitions).some(value=>!text(value,2000)))fail("ERP来源口径未完整声明");
  const metadata=record(r.metricMetadata);keys(metadata,Object.keys(salesPeriodMetricMetadata));
  for(const name of Object.keys(salesPeriodMetricMetadata) as Array<keyof typeof salesPeriodMetricMetadata>){const expected=salesPeriodMetricMetadata[name],actual=record(metadata[name]);keys(actual,Object.keys(expected));for(const [field,meaning] of Object.entries(expected))if(!enumValue(actual[field],[meaning]))fail("原生单位或成本证据不能伪装为已验证");}
  if(spec.seriesIntent)series(r.series,spec.seriesIntent,r,{current:spec.current,baseline:spec.baseline});
  return r as SalesPeriodsResponse;
}
