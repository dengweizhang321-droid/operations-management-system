import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeSalesPeriodsForRequest,validateSalesPeriodsRequest,restoreSalesPeriodSeriesPoint } from "../lib/netshop/sales-periods-contract";
const directory=new URL("./fixtures/netshop-sales-platform-series/",import.meta.url);
const fixture=(grain:string)=>({body:JSON.parse(readFileSync(new URL(`platform-series-${grain}.json`,directory),"utf8")),request:JSON.parse(readFileSync(new URL(`platform-series-${grain}.meta.json`,directory),"utf8")).request});
test("actual PG platform grouping retains >4 RAW and composite distinct weekly orders",()=>{
  for(const grain of ["day","week","month"]){const {body,request}=fixture(grain);assert.deepEqual(decodeSalesPeriodsForRequest(body,request,"7:3"),body);}
  const {body}=fixture("week");assert.equal(body.platformSeries.items[0].rawCandidateCount,6);assert.equal(restoreSalesPeriodSeriesPoint(body.platformSeries.items[0].current[0]).facts.orders.trustedOrderCount,6);
});
test("two platforms fifty RAW and complete 366/365 independent bucket receipt decodes",()=>{
  const body=JSON.parse(readFileSync(new URL("platform-max.json",directory),"utf8")),meta=JSON.parse(readFileSync(new URL("platform-max.meta.json",directory),"utf8"));
  const dto=decodeSalesPeriodsForRequest(body,meta.request,"7:3");assert.deepEqual(dto.platformSeries!.items.map(row=>row.rawCandidateCount),[25,25]);assert.equal(dto.platformSeries!.items.reduce((n,row)=>n+row.current.length+row.baseline.length,0),1462);
});
test("actual signed HTTP receipt carries the same complete platform DTO and revision",()=>{
  const envelope=JSON.parse(readFileSync(new URL("registered-platform-max.json",directory),"utf8"));
  const meta=JSON.parse(readFileSync(new URL("registered-platform-max.meta.json",directory),"utf8"));
  const dto=decodeSalesPeriodsForRequest(envelope.data,meta.request,meta.headers["X-Sales-Data-Revision"]);
  assert.equal(meta.bytes,266750);assert.equal(meta.headers["X-Sales-Overview-Cache"],"bypass_owned_periods_v1");
  assert.equal(dto.platformSeries!.items.reduce((n,row)=>n+row.current.length+row.baseline.length,0),1462);
});
test("native platform zero negative missing-order and no-record buckets retain original proof",()=>{
  const {body,request}=fixture("day");const dto=decodeSalesPeriodsForRequest(body,request,"7:3");
  const points=dto.platformSeries!.items[0].current.map(restoreSalesPeriodSeriesPoint);
  assert.equal(points[6].facts.values.netSalesCents,-500);
  assert.equal(points[7].facts.values.netSalesCents,0);assert.equal(points[7].facts.orders.netAmountPerOrder.reasonCode,"missing_order_no");
  assert.equal(points[2].facts.values.netSalesCents,null);assert.equal(points[2].facts.orders.netAmountPerOrder.reasonCode,"no_records");
  assert.equal(dto.platformSeries!.metricMetadata.cost.verification,"unverified_source");
  assert.equal(dto.platformSeries!.metricMetadata.cost.zeroCostVerification,"unknown");
});
test("platform names are closed and mutually exclusive with original RAW series",()=>{
  const {request}=fixture("day");for(const value of [{...request,seriesPlatforms:[]},{...request,seriesPlatforms:["京东","京东"]},{...request,seriesPlatforms:[["京东"]]},{...request,seriesPlatforms:["ghost"]},{...request,seriesOutlets:[]},{...request,seriesGrain:["day"]}])assert.throws(()=>validateSalesPeriodsRequest(value));
});
test("platform schema intent full members tuple window version and quality cannot be forged",()=>{
  const {body,request}=fixture("week");
  for(const mutate of [(d:typeof body)=>{d.platformSeries.schemaVersion=["netshop-sales-platform-series-v1"];},(d:typeof body)=>{d.platformSeries.intent.platformNames.reverse();},(d:typeof body)=>{d.platformSeries.items.reverse();},(d:typeof body)=>{d.platformSeries.items[0].rawMembers.pop();},(d:typeof body)=>{d.platformSeries.items[0].rawMembers[0]=d.platformSeries.items[1].rawMembers[0];},(d:typeof body)=>{d.platformSeries.items[0].rawCandidateCount=true;},(d:typeof body)=>{d.platformSeries.items[0].current.pop();},(d:typeof body)=>{d.platformSeries.items[0].current[0][1][0]=.25;},(d:typeof body)=>{d.platformSeries.items[0].current[0][3]=true;},(d:typeof body)=>{d.platformSeries.sourceRevisions=[];},(d:typeof body)=>{d.platformSeries.basis.membership="first_four_raw";},(d:typeof body)=>{d.platformSeries.items[0].availability.status=["available"];}]){const data=structuredClone(body);mutate(data);assert.throws(()=>decodeSalesPeriodsForRequest(data,request,"7:3"));}
});
