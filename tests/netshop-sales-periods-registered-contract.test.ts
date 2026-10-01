import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { decodeSalesPeriodsForRequest, type SalesPeriodsRequest } from "../lib/netshop/sales-periods-contract";
import { readDjangoSalesConsumer, type SalesConsumerReaderConfig } from "../lib/django/sales-consumer-reader";
import type { AppPrincipal } from "../lib/auth/authorization";

const directory=new URL("./fixtures/netshop-sales-periods-registered/",import.meta.url);
const names=readdirSync(directory).filter(name=>name.startsWith("registered-")&&name.endsWith(".json")&&!name.endsWith(".meta.json"));
const principal:AppPrincipal={email:"signed-periods@example.test",displayName:"Synthetic",role:"admin",scope:null};
const config:SalesConsumerReaderConfig={djangoBaseUrl:"http://127.0.0.1:1",internalSecret:"synthetic-replay-only-no-network-at-least-32",timeoutMs:5000,maxRequestBytes:65536,maxResponseBytes:2*1024*1024};

test("registered signed HTTP fixtures retain exact bytes/header binding and decode in the actual SDK",async()=>{
  assert.equal(names.length,6);
  for(const name of names){
    const raw=readFileSync(new URL(name,directory));
    const metadata=JSON.parse(readFileSync(new URL(name.replace(/\.json$/,".meta.json"),directory),"utf8"));
    assert.equal(raw.byteLength,metadata.bytes);assert.equal(createHash("sha256").update(raw).digest("hex"),metadata.sha256);
    assert.equal(metadata.dataSource,"actual_registered_signed_loopback_synthetic_pg");
    const envelope=JSON.parse(raw.toString("utf8")),request:SalesPeriodsRequest=metadata.request;
    const revision=metadata.headers["X-Sales-Data-Revision"];
    assert.equal(revision,metadata.headers["X-Sales-Source-Revision"]);
    assert.equal(metadata.headers["X-Sales-Overview-Cache"],"bypass_owned_periods_v1");
    assert.deepEqual(decodeSalesPeriodsForRequest(envelope.data,request,revision),envelope.data);
    const result=await readDjangoSalesConsumer(principal,request,{config,fetchImpl:async()=>new Response(raw,{headers:metadata.headers})});
    assert.deepEqual(result.data,envelope.data);assert.equal(result.data.metricMetadata.quantity.unit,"NATIVE_INTEGER_QUANTITY");
    assert.equal(result.data.metricMetadata.reportedGrossProfit.verification,"unverified_source");
  }
});

test("registered baseline-only collection stays complete before q/page and raw spaces stay exact",()=>{
  const union=JSON.parse(readFileSync(new URL("registered-baseline-union.json",directory),"utf8")).data;
  assert.equal(union.candidatePagination.candidateCount,603);assert.equal(union.candidatePagination.filteredCount,601);assert.equal(union.items.length,100);
  assert.ok(union.items.every((row:typeof union.items[number])=>row.current.rowCount===0&&row.baseline.rowCount===1));
  const spaces=JSON.parse(readFileSync(new URL("registered-restricted-spaces.json",directory),"utf8")).data;
  assert.equal(spaces.items[0].identity.rawShopName," 京东一店 ");assert.equal(spaces.items[0].identity.rawChannel," 渠道B ");
});

test("registered true zero and missing-order evidence never promote unknown cost to an available primary metric",()=>{
  const zero=JSON.parse(readFileSync(new URL("registered-zero.json",directory),"utf8")).data;
  assert.equal(zero.periodTotals.current.values.netSalesCents,0);assert.equal(zero.periodTotals.current.orders.netAmountPerOrder.value,0);
  for(const name of ["cost","grossProfit","reportedGrossProfit"])assert.equal(zero.metricMetadata[name].primaryMetricUse,"unavailable_or_partial");
  assert.equal(zero.metricMetadata.cost.zeroCostVerification,"unknown");
  const missing=JSON.parse(readFileSync(new URL("registered-missing-order.json",directory),"utf8")).data;
  assert.equal(missing.periodTotals.current.orders.netAmountPerOrder.reasonCode,"missing_order_no");assert.equal(missing.periodTotals.current.orders.netAmountPerOrder.value,null);
});
