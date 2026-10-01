import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeSalesPeriodsForRequest, validateSalesPeriodsRequest, isSalesRevisionPair, salesPeriodMetrics } from "../lib/netshop/sales-periods-contract";

const request={operation:"netshop_periods_v1" as const,current:{startDate:"2026-08-01",endExclusive:"2026-08-03"},baseline:{startDate:"2026-07-01",endExclusive:"2026-08-01"}};
const fixture=(name="response-periods.json")=>JSON.parse(readFileSync(new URL(`./fixtures/netshop-sales-periods/${name}`,import.meta.url),"utf8"));
test("actual isolated PG full two-period envelope decodes with owning pair",()=>{
  const body=fixture(),result=decodeSalesPeriodsForRequest(body,request,"7:3");
  assert.equal(result.periodTotals.current.values.netSalesCents,14000);assert.equal(result.periodTotals.baseline.values.netSalesCents,null);
  assert.equal(result.periodTotals.current.observations.completeness,"unknown");
  // Object key order is not a business binding.
  body.requestedScope.current={days:2,endDate:"2026-08-02",endExclusive:"2026-08-03",startDate:"2026-08-01"};decodeSalesPeriodsForRequest(body,request,"7:3");
});
test("actual PG enums reject arrays, boxed strings and forged available means",()=>{
  const mutations=[
    (b:ReturnType<typeof fixture>,v:unknown)=>{b.scopeMode=v;},
    (b:ReturnType<typeof fixture>,v:unknown)=>{b.schemaVersion=v;},
    (b:ReturnType<typeof fixture>,v:unknown)=>{b.operation=v;},
    (b:ReturnType<typeof fixture>,v:unknown)=>{b.sourceRevisions[0].domain=v;},
    (b:ReturnType<typeof fixture>,v:unknown)=>{b.sourceRevisions[0].kind=v;},
    (b:ReturnType<typeof fixture>,v:unknown)=>{b.candidatePagination.collection=v;},
    (b:ReturnType<typeof fixture>,v:unknown)=>{b.periodTotals.current.orders.basis=v;},
    (b:ReturnType<typeof fixture>,v:unknown)=>{b.periodTotals.current.orders.netAmountPerOrder.unit=v;},
    (b:ReturnType<typeof fixture>,v:unknown)=>{b.periodTotals.current.orders.netAmountPerOrder.status=v;b.periodTotals.current.orders.netAmountPerOrder.value=123456;},
    (b:ReturnType<typeof fixture>,v:unknown)=>{b.periodTotals.baseline.orders.netAmountPerOrder.reasonCode=v;},
    (b:ReturnType<typeof fixture>,v:unknown)=>{b.periodTotals.current.observations.basis=v;},
    (b:ReturnType<typeof fixture>,v:unknown)=>{b.periodTotals.current.observations.completeness=v;},
    (b:ReturnType<typeof fixture>,v:unknown)=>{b.metricMetadata.quantity.unit=v;},
  ];
  const strings=["unrestricted","netshop-sales-periods-v1","netshop_periods_v1","sales","sales_erp_revision_pair","authorized_two_period_union_before_search_pagination","ERP_order_no_only_within_exact_raw_source_identity","CNY_CENT_PER_ORDER","available","no_records","imported_business_date_records","unknown","NATIVE_INTEGER_QUANTITY"];
  mutations.forEach((mutate,index)=>{for(const value of [[strings[index]],new String(strings[index]),{},true,0]){const body=fixture();mutate(body,value);assert.throws(()=>decodeSalesPeriodsForRequest(body,request,"7:3"),`enum ${index}`);}});
  for(const value of [0,123456,Infinity,NaN]){const body=fixture();body.periodTotals.current.orders.netAmountPerOrder.value=value;assert.throws(()=>decodeSalesPeriodsForRequest(body,request,"7:3"));}
});
test("actual PG COUNT, cents and native integer quantity reject fractional and unsafe values",()=>{
  const paths=[
    ["periodTotals","current","rowCount"],["periodTotals","current","orders","trustedOrderCount"],
    ["periodTotals","current","orders","missingOrderNoRows"],["periodTotals","current","orders","netAmountPerOrder","denominator"],
    ["periodTotals","current","observations","observedDateCount"],["periodTotals","current","observations","requestedDays"],
    ...["candidateCount","filteredCount","returned","page","pageSize"].map(key=>["candidatePagination",key]),["latestRelevantBatch","rowCount"],
    ...salesPeriodMetrics.map(key=>["periodTotals","current","values",key]),
  ];
  for(const path of paths)for(const value of [0.5,Number.MAX_SAFE_INTEGER+1,"1",true]){const body=fixture();let node=body;for(const key of path.slice(0,-1))node=node[key];node[path.at(-1)!]=value;assert.throws(()=>decodeSalesPeriodsForRequest(body,request,"7:3"),path.join("."));}
});
test("actual PG typed zero stays zero while cost and reported profit proof remain unverified",()=>{
  const zero=decodeSalesPeriodsForRequest(fixture("response-typed-zero.json"),request,"7:3");
  assert.equal(zero.periodTotals.current.values.netSalesCents,0);assert.equal(zero.periodTotals.current.orders.netAmountPerOrder.value,0);
  assert.equal(zero.metricMetadata.quantity.unit,"NATIVE_INTEGER_QUANTITY");
  for(const name of ["cost","grossProfit","reportedGrossProfit"] as const){assert.equal(zero.metricMetadata[name].verification,"unverified_source");assert.equal(zero.metricMetadata[name].primaryMetricUse,"unavailable_or_partial");}
  for(const mutate of [(b:ReturnType<typeof fixture>)=>{b.metricMetadata.cost.zeroCostVerification="validatedZero";},(b:ReturnType<typeof fixture>)=>{b.metricMetadata.reportedGrossProfit.originalFieldPresence="verified";},(b:ReturnType<typeof fixture>)=>{delete b.metricMetadata;},(b:ReturnType<typeof fixture>)=>{b.metricMetadata.quantity.unit="COUNT";},(b:ReturnType<typeof fixture>)=>{b.metricSemantics.costCents=["typed means verified"];},(b:ReturnType<typeof fixture>)=>{b.metricSemantics.unknown=0;}]){const body=fixture();mutate(body);assert.throws(()=>decodeSalesPeriodsForRequest(body,request,"7:3"));}
});
test("actual PG missing order number remains unavailable and never becomes a payment customer count",()=>{
  const body=fixture("response-missing-order.json"),decoded=decodeSalesPeriodsForRequest(body,request,"7:3");
  assert.equal(decoded.periodTotals.current.orders.netAmountPerOrder.reasonCode,"missing_order_no");assert.equal(decoded.periodTotals.current.orders.netAmountPerOrder.value,null);
  for(const mutate of [(b:ReturnType<typeof fixture>)=>{b.periodTotals.current.orders.netAmountPerOrder.status=["available"];b.periodTotals.current.orders.netAmountPerOrder.value=999;},(b:ReturnType<typeof fixture>)=>{b.periodTotals.current.orders.netAmountPerOrder.reasonCode=["missing_order_no"];},(b:ReturnType<typeof fixture>)=>{b.periodTotals.current.orders.missingOrderNoRows=0;},(b:ReturnType<typeof fixture>)=>{b.periodTotals.current.orders.trustedOrderCount=0;b.periodTotals.current.orders.netAmountPerOrder.denominator=0;}]){const changed=structuredClone(body);mutate(changed);assert.throws(()=>decodeSalesPeriodsForRequest(changed,request,"7:3"));}
});
test("unknown fields, expiry in external query and invalid closed windows fail",()=>{
  for(const invalid of [{...request,expiresAtEpochMs:1},{...request,pageSize:101},{...request,canonicalShopName:"guess"},{...request,rawOutlets:[{platform:"京东",rawShopName:"店",rawChannel:null}]},{...request,rawOutlets:[{platform:"京东",rawShopName:"店",rawChannel:""}]},{...request,current:{startDate:"2026-02-29",endExclusive:"2026-03-02"}},{...request,baseline:{startDate:"2024-01-01",endExclusive:"2025-01-02"}}])assert.throws(()=>validateSalesPeriodsRequest(invalid));
  validateSalesPeriodsRequest({...request,expiresAtEpochMs:1},true);
  assert.equal(isSalesRevisionPair("7:3"),true);for(const token of ["7:abcdefabcdef","a".repeat(64),"07:3","9007199254740992:3"])assert.equal(isSalesRevisionPair(token),false);
});
test("header, wrong raw scope, periods and mandatory typed vector cannot be replaced",()=>{
  for(const mutate of [(b: ReturnType<typeof fixture>)=>{b.periods.baseline.startDate="2026-07-02";},(b: ReturnType<typeof fixture>)=>{b.sourceRevisions=[];},(b: ReturnType<typeof fixture>)=>{b.sourceRevisions[0].kind="owning_revision";},(b: ReturnType<typeof fixture>)=>{b.requestedScope.rawOutlets=[{platform:"京东",rawShopName:"other",rawChannel:"other"}];},(b: ReturnType<typeof fixture>)=>{b.candidatePagination.page=2;}]){const body=fixture();mutate(body);assert.throws(()=>decodeSalesPeriodsForRequest(body,request,"7:3"));}
  assert.throws(()=>decodeSalesPeriodsForRequest(fixture(),request,"8:3"));assert.throws(()=>decodeSalesPeriodsForRequest(fixture(),request,"7:abcdefabcdef"));
});
test("no record, observed completeness and order denominator cannot become false zero or line count",()=>{
  for(const mutate of [(b: ReturnType<typeof fixture>)=>{b.periodTotals.baseline.values.netSalesCents=0;},(b: ReturnType<typeof fixture>)=>{b.periodTotals.current.observations.completeness="complete";},(b: ReturnType<typeof fixture>)=>{b.periodTotals.current.orders.basis="source_line_key";},(b: ReturnType<typeof fixture>)=>{b.periodTotals.current.orders.netAmountPerOrder.denominator=1;},(b: ReturnType<typeof fixture>)=>{b.periodTotals.current.values.netSalesCents=Infinity;},(b: ReturnType<typeof fixture>)=>{b.items[0].identity.rawChannel="other";}]){const body=fixture();mutate(body);assert.throws(()=>decodeSalesPeriodsForRequest(body,request,"7:3"));}
});
