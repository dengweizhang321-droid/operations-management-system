/** Runs only against the private Django LiveServer selected by the owned PG test. */
import assert from "node:assert/strict";
import { readDjangoSalesConsumer, type SalesConsumerReaderConfig } from "../lib/django/sales-consumer-reader";
import type { AppPrincipal } from "../lib/auth/authorization";
import { PublicApiError } from "../lib/http/api-error";
import type { SalesPeriodsRequest } from "../lib/netshop/sales-periods-contract";

const base=process.env.TERUISI_CROSSDOMAIN_LIVE_BASE;
assert.ok(base&&/^http:\/\/127\.0\.0\.1:\d+$/.test(base));
assert.ok(!["5432","8001"].includes(new URL(base).port));
const secret=process.env.TERUISI_DJANGO_INTERNAL_SECRET;
assert.ok(secret&&secret.startsWith("django-sales-contract-test-secret"));
const config:SalesConsumerReaderConfig={djangoBaseUrl:base,internalSecret:secret,timeoutMs:5000,maxRequestBytes:65536,maxResponseBytes:2*1024*1024};
const principal:AppPrincipal={email:"signed-periods@example.test",displayName:"Synthetic",role:"admin",scope:null};
const request:SalesPeriodsRequest={operation:"netshop_periods_v1",current:{startDate:"2026-08-01",endExclusive:"2026-08-03"},baseline:{startDate:"2026-07-01",endExclusive:"2026-08-01"}};
let actualExpiry:number|undefined;
let unknownNetworkCalls=0,actualHttpCalls=0;
const nativeFetch=globalThis.fetch;
const realTransport:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));
  if(url.origin!==base||url.pathname!=="/api/sales/consumers/query"||init?.method!=="POST"){unknownNetworkCalls++;throw new Error("Private SDK probe refused an unknown network request");}
  actualHttpCalls++;
  assert.equal(init?.method,"POST");
  actualExpiry=JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)).expiresAtEpochMs;
  assert.ok(typeof actualExpiry==="number"&&Number.isSafeInteger(actualExpiry));
  return nativeFetch(input,init);
};
globalThis.fetch=realTransport;
const started=Date.now(),result=await readDjangoSalesConsumer(principal,request,{config,fetchImpl:realTransport});
assert.equal(result.revision,"7:3");assert.equal(result.data.periodTotals.current.values.netSalesCents,14000);
assert.equal(result.data.metricMetadata.cost.verification,"unverified_source");
assert.equal(Object.hasOwn(result.data.requestedScope,"expiresAtEpochMs"),false);
assert.ok(actualExpiry!>=started&&actualExpiry!<=Date.now()+5000);
await assert.rejects(readDjangoSalesConsumer(principal,{...request,expectedRevision:"8:3"},{config}),error=>error instanceof PublicApiError&&error.status===409&&error.code==="version_conflict");
await assert.rejects(readDjangoSalesConsumer({...principal,email:"absent@example.test"},request,{config}),error=>error instanceof PublicApiError&&error.status===403&&error.code==="access_denied");
await assert.rejects(readDjangoSalesConsumer(principal,request,{config:{...config,internalSecret:"wrong-private-synthetic-signature-at-least-32"}}),error=>error instanceof PublicApiError&&error.status===401&&error.code==="access_denied");
const canceled=new AbortController();
await assert.rejects(readDjangoSalesConsumer({...principal,email:"absent@example.test"},request,{config,signal:canceled.signal,fetchImpl:async(input,init)=>{const response=await realTransport(input,init);assert.equal(response.status,403);canceled.abort();return response;}}),error=>error instanceof PublicApiError&&error.status===499);
assert.equal(unknownNetworkCalls,0);assert.equal(actualHttpCalls,5);
process.stdout.write(JSON.stringify({dataSource:"actual_ts_sdk_to_registered_django_loopback_synthetic_pg",revision:result.revision,signedExpiryBounded:true,registeredConflict:409,registeredDenied:403,registeredBadSignature:401,cancelAfterActual403:499,body:result.data,unknownNetworkCalls,actualHttpCalls,production:false,paidCalls:0}));
