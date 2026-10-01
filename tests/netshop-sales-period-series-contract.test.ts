import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeSalesPeriodsForRequest, validateSalesPeriodsRequest, salesPeriodBuckets, restoreSalesPeriodSeriesPoint, type SalesPeriodsRequest } from "../lib/netshop/sales-periods-contract";
const fixture=(grain:string)=>{const url=new URL(`./fixtures/netshop-sales-period-series/sales-series-${grain}.json`,import.meta.url),meta=JSON.parse(readFileSync(new URL(`./fixtures/netshop-sales-period-series/sales-series-${grain}.meta.json`,import.meta.url),"utf8"));return {body:JSON.parse(readFileSync(url,"utf8")),request:meta.request as SalesPeriodsRequest};};
test("actual private PG complete day/week/month series decode and weekly denominator stays native",()=>{
  for(const grain of ["day","week","month"]){const {body,request}=fixture(grain);assert.deepEqual(decodeSalesPeriodsForRequest(body,request,"7:3"),body);}
  const {body}=fixture("week");assert.equal(restoreSalesPeriodSeriesPoint(body.series.items[0].current[0]).facts.orders.trustedOrderCount,1);assert.equal(restoreSalesPeriodSeriesPoint(body.series.items[0].current[0]).facts.orders.netAmountPerOrder.value,3000);
});
test("optin is closed, requires both fields and exact requested-subset identity",()=>{
  const {request}=fixture("day");
  for(const value of [{...request,seriesOutlets:[]},{...request,seriesGrain:["day"]},{...request,seriesGrain:undefined},{...request,seriesOutlets:[...request.seriesOutlets!,...request.seriesOutlets!]},{...request,rawOutlets:[{platform:"京东",rawShopName:"foreign",rawChannel:"other"}]}])assert.throws(()=>validateSalesPeriodsRequest(value));
});
test("series cannot swap periods, lose buckets, foreign identity, typed pair, cost proof or denominator meaning",()=>{
  const {body,request}=fixture("week");
  const mutations=[(d:typeof body)=>{d.series.schemaVersion=["netshop-sales-period-series-v1"];},(d:typeof body)=>{d.series.intent.grain=["week"];},(d:typeof body)=>{d.series.items[0].current.pop();},(d:typeof body)=>{d.series.items[0].current[0][0][1]="2026-09-07";},(d:typeof body)=>{d.series.items[0].current[0][3]=true;},(d:typeof body)=>{d.series.items[0].current[0][1][0]=.25;},(d:typeof body)=>{d.series.items[0].identity.rawShopName="foreign";},(d:typeof body)=>{d.series.sourceRevisions=[];},(d:typeof body)=>{d.series.metricMetadata.cost.verification="verified";},(d:typeof body)=>{d.series.basis.completeness="complete";},(d:typeof body)=>{d.series.items[0].current=d.series.items[0].baseline;}];
  for(const mutate of mutations){const data=structuredClone(body);mutate(data);assert.throws(()=>decodeSalesPeriodsForRequest(data,request,"7:3"));}
  for(const mutate of [(d:typeof body)=>{d.series.projection=["native-period-tuples-v1"];},(d:typeof body)=>{d.series.metricColumns.reverse();},(d:typeof body)=>{d.series.windowColumns.pop();},(d:typeof body)=>{d.series.pointColumns[0]="wrong";},(d:typeof body)=>{d.series.items[0].current[0].pop();},(d:typeof body)=>{d.series.items[0].current[0][1].pop();},(d:typeof body)=>{d.series.items[0].current[0][5]=999;},(d:typeof body)=>{d.series.items[0].current[0][6]=true;}]){const data=structuredClone(body);mutate(data);assert.throws(()=>decodeSalesPeriodsForRequest(data,request,"7:3"));}
});
test("declared native month buckets preserve leap day and independent original window",()=>{
  const s=validateSalesPeriodsRequest({...fixture("month").request,current:{startDate:"2024-02-28",endExclusive:"2024-03-03"}});
  assert.deepEqual(salesPeriodBuckets(s.current,"month").map(p=>[p.startDate,p.endDate,p.days]),[["2024-02-28","2024-02-29",2],["2024-03-01","2024-03-02",2]]);
});
test("actual signed HTTP maximum 4x366 two-window compact receipt decodes without losing points",()=>{
  const raw=JSON.parse(readFileSync(new URL("./fixtures/netshop-sales-period-series/registered-optin-max-series.json",import.meta.url),"utf8"));
  const metadata=JSON.parse(readFileSync(new URL("./fixtures/netshop-sales-period-series/registered-optin-max-series.meta.json",import.meta.url),"utf8"));
  const dto=decodeSalesPeriodsForRequest(raw.data,metadata.request,metadata.headers["X-Sales-Data-Revision"]);
  assert.equal(dto.series!.items.length,4);assert.equal(dto.series!.items.reduce((n,item)=>n+item.current.length+item.baseline.length,0),2928);
  for(const item of dto.series!.items){assert.equal(restoreSalesPeriodSeriesPoint(item.current[0]).window.startDate,"2024-02-28");assert.equal(restoreSalesPeriodSeriesPoint(item.baseline.at(-1)!).window.endDate,"2021-02-27");}
  assert.ok(metadata.bytes<=2*1024*1024);
});
