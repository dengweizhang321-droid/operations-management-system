import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { decodePromotionInsightsForQuery } from "../lib/netshop/promotion-insights-contract";

function positive(name="product") {
  const value=JSON.parse(fs.readFileSync(new URL(`./fixtures/netshop-promotion/response-${name}.json`,import.meta.url),"utf8"));
  const c=value.context, s=value.sections, query=new URLSearchParams({platform:c.requestedScope.platforms[0],dimension:c.requestedScope.dimension,
    startDate:c.periods.current.startDate,endDate:c.periods.current.endDate,periodKind:c.requestedScope.periodKind,trendGrain:s.trend.grain,
    objectKind:s.listScope.objectKind,q:s.listScope.q,page:String(s.pagination.page),pageSize:String(s.pagination.pageSize)});
  c.requestedScope.shopKeys.forEach((key:string)=>query.append("outlet",key));
  const revision=c.sourceRevisions.find((r:{kind:string})=>r.kind==="owning_revision").revision;
  decodePromotionInsightsForQuery(value,query,revision);
  return {value,query,revision};
}
const mutations: Array<[string,(v:ReturnType<typeof positive>["value"])=>void]> = [
  ["comparison status array bypassing numeric guards",v=>Object.assign(v.sections.comparisons.spend.previous,{status:["available"],value:"untrusted value",reasonCode:"invalid"})],
  ["capability status array bypassing reason guards",v=>Object.assign(v.sections.objectCapabilities.product,{status:["available"],reasonCode:"invalid"})],
  ["source matrix status array bypassing reason guards",v=>Object.assign(v.sections.sourceMatrix[0].fields[0],{status:["available"],reasonCode:"invalid"})],
  ["diagnostic status array",v=>{v.sections.diagnostic.status=["available"];}],
  ["nested report format array",v=>{v.sections.diagnostic.reportFormats=[["html"]];}],
  ["mapping status array avoiding matched identity",v=>Object.assign(v.sections.items[0].mapping,{status:["matched"],linkIdentity:null})],
  ["identity kind array",v=>{v.sections.items[0].identityKind=[v.sections.items[0].identityKind];}],
  ["base metric status array with null numeric value",v=>Object.assign(v.sections.summary.orders,{status:["available"],value:null,reasonCode:"missing_field"})],
  ["trend ISO date array",v=>{v.sections.trend.items[0].endDate=[v.sections.trend.items[0].endDate];}],
  ["source coverage reference array",v=>{v.sections.sourceMatrix[0].coverageRef=[v.sections.sourceMatrix[0].coverageRef];}],
  ["unavailable diagnostic carrying invented supported shop/formats",v=>Object.assign(v.sections.diagnostic,{status:"unavailable",reasonCode:null,shopName:"other",reportFormats:["html","xlsx"]})],
];
for(const [name,mutate] of mutations) test(`closed enum boundary rejects ${name}`,()=>{
  const {value,query,revision}=positive(); mutate(value);
  assert.throws(()=>decodePromotionInsightsForQuery(value,query,revision));
});
test("real diagnostic availability remains bound to valid formats and reason",()=>{
  const {value,query,revision}=positive("plan");
  assert.equal(value.sections.diagnostic.status,"available");
  value.sections.diagnostic.reasonCode="missing_field";
  assert.throws(()=>decodePromotionInsightsForQuery(value,query,revision));
});
