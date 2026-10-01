import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeSalesPeriodsForRequest, validateSalesPeriodsRequest, isSalesRevisionPair } from "../lib/netshop/sales-periods-contract";

const request={operation:"netshop_periods_v1" as const,current:{startDate:"2026-08-01",endExclusive:"2026-08-03"},baseline:{startDate:"2026-07-01",endExclusive:"2026-08-01"}};
const fixture=()=>JSON.parse(readFileSync(new URL("./fixtures/netshop-sales-periods/response-periods.json",import.meta.url),"utf8"));
test("actual isolated PG full two-period envelope decodes with owning pair",()=>{
  const body=fixture(),result=decodeSalesPeriodsForRequest(body,request,"7:3");
  assert.equal(result.periodTotals.current.values.netSalesCents,14000);assert.equal(result.periodTotals.baseline.values.netSalesCents,null);
  assert.equal(result.periodTotals.current.observations.completeness,"unknown");
  // Object key order is not a business binding.
  body.requestedScope.current={days:2,endDate:"2026-08-02",endExclusive:"2026-08-03",startDate:"2026-08-01"};decodeSalesPeriodsForRequest(body,request,"7:3");
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
