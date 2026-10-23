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

test("bundle margin distribution is independent of detail totals and rejects wrong dimensions or malformed counts", () => {
  const q=query();q.set("productKind","single");
  const valid={...fixture,productKind:"single",productMarginMetrics:{dimension:"single",productCount:0,marginBuckets:{below38Count:0,between38And42Count:0,between42And46Count:0,atLeast46Count:0}},comboMarginMetrics:{dimension:"combo",comboCount:6,marginBuckets:{below38Count:1,between38And42Count:2,between42And46Count:2,atLeast46Count:1}}};
  assert.equal(decodeProductRead(valid,q),valid);
  for (const mutate of [
    (p:typeof valid)=>{p.productMarginMetrics.dimension="combo";},
    (p:typeof valid)=>{p.productMarginMetrics.productCount=-1;},
    (p:typeof valid)=>{p.productMarginMetrics.marginBuckets.atLeast46Count=1;},
    (p:typeof valid)=>{p.comboMarginMetrics.dimension="single";},
    (p:typeof valid)=>{p.comboMarginMetrics.comboCount=3;},
    (p:typeof valid)=>{p.comboMarginMetrics.marginBuckets.below38Count=-1;},
    (p:typeof valid)=>{p.comboMarginMetrics.marginBuckets.atLeast46Count=NaN;},
    (p:typeof valid)=>{Reflect.deleteProperty(p.comboMarginMetrics.marginBuckets,"between38And42Count");},
  ]) {const bad=structuredClone(valid);mutate(bad);assert.throws(()=>decodeProductRead(bad,q));}
});

test("allocated component cents must match the bundle and singles cannot masquerade as bundles",()=>{
  const q=query();q.set("productKind","combo");q.set("view","page");
  const sales={netQuantity:2,grossSalesCents:100,refundAmountCents:0,netSalesCents:100,costCents:50,feeCents:5,grossProfitCents:45,grossMarginRate:.5};
  const item={productKind:"combo",components:[{productCode:"CHILD",productName:"child",quantity:2,sales}],productCode:"KIT",productName:"kit",brand:"",supplierName:"",specification:"",category:"",outlets:[],...sales,refundRate:0,shippingRate:null,averageSalePriceCents:100,averageCostCents:50,observedFeeRate:.05,availableQuantity:null,stockValueCents:null,knownStockValueCents:null,costCoverageRate:null};
  const payload={...fixture,productKind:"combo",projection:"page",items:[item],pagination:{page:1,pageSize:50,total:1,returned:1,totalPages:1,truncated:false}};
  assert.equal(decodeProductRead(payload,q),payload);
  const bad=structuredClone(payload);bad.items[0].components[0].sales.netSalesCents++;assert.throws(()=>decodeProductRead(bad,q));
  assert.throws(()=>decodeProductRead({...payload,items:[{...item,productKind:"single"}]},q));
  assert.equal(decodeProductRead({...payload,items:[{...item,productKind:"single",components:[]}]},q).items.length,1);
  q.set("productKind","single");assert.throws(()=>decodeProductRead({...payload,productKind:"single"},q));
});
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
