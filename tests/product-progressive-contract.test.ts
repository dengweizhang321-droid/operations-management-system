import assert from "node:assert/strict";
import test from "node:test";
import { decodeProductRead } from "../lib/products/read-contract";
import type { ProductSummaryFullResponse } from "../lib/products/summary";

export const fixture: ProductSummaryFullResponse = {
  projection:"full", snapshotToken:"a".repeat(64),hasSales:true,range:"custom",
  sync:{salesThrough:"2026-09-30",salesWindowStart:"2026-09-01",requestedStartDate:"2026-09-01",requestedEndDate:"2026-09-30",dataStartDate:"2026-09-01",dataCutoffDate:"2026-09-30",inventoryAsOf:null,latestSalesFile:"synthetic"},
  filters:{platforms:[],shops:[],categories:[]},filtersApplied:{platforms:[],shops:[],query:"",categories:[],marginBands:[]},
  sort:{by:"netSalesCents",direction:"desc"}, pagination:{page:1,pageSize:50,total:0,returned:0,totalPages:0,truncated:false},
  items:[],metrics:{skuCount:0,grossSalesCents:0,netSalesCents:0,grossProfitCents:0,grossMarginRate:null,lossSkuCount:0,stockedSkuCount:0,marginBuckets:{below35Count:0,between35And40Count:0,between40And45Count:0,atLeast45Count:0}}
};
const query=()=>new URLSearchParams({range:"custom",startDate:"2026-09-01",endDate:"2026-09-30",page:"1",pageSize:"50",sortBy:"netSalesCents",direction:"desc"});
test("progressive regions require their complete projection and range witnesses",()=>{
  const initial={...fixture,projection:"initial-page"}; const q=query();q.set("view","initial-page");
  assert.equal(decodeProductRead(initial,q),initial);
  const overview={...fixture,projection:"overview"};q.set("view","overview");q.set("snapshotToken",fixture.snapshotToken);
  assert.equal(decodeProductRead(overview,q),overview);
  for(const mutation of [
    (p: typeof overview)=>{p.snapshotToken="b".repeat(64);},
    (p: typeof overview)=>{p.pagination.page=2;},
    (p: typeof overview)=>{p.sort.by="grossProfitCents";},
    (p: typeof overview)=>{p.sync.requestedStartDate="2026-08-01";},
    (p: typeof overview)=>{p.filtersApplied.query="other";},
    (p: typeof overview)=>{delete (p.metrics.marginBuckets as Partial<typeof p.metrics.marginBuckets>).below35Count;},
    (p: typeof overview)=>{p.metrics.marginBuckets.below35Count=1;},
    (p: typeof overview)=>{p.metrics.netSalesCents=NaN;},
  ]){const invalid=structuredClone(overview);mutation(invalid);assert.throws(()=>decodeProductRead(invalid,q));}
});
test("an unloaded, malformed, truncated or wrong page cannot become a business empty/zero region",()=>{
  const q=query();
  for(const invalid of [null,{}, {...fixture,pagination:{...fixture.pagination,total:51,totalPages:2,returned:0}}, {...fixture,items:[{productCode:"A"}]}, {...fixture,metrics:undefined}])assert.throws(()=>decodeProductRead(invalid,q));
});
