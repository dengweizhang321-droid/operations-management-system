import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { compareMetrics, type MetricValue } from "../lib/netshop/insights-contract";
import { syntheticInsightsContext } from "../lib/netshop/insights-fixtures";
import { productMetricKeys } from "../app/netshop/products/contract";
import type { AppPrincipal } from "../lib/auth/authorization";
import { completeProductSectionsFixture } from "./netshop-products-test-fixture";

const runtime = globalThis as typeof globalThis & { __pPrincipals?: AppPrincipal[]; __pData?: unknown; __pRevision?: string; __pCalls?: number };
const compiled = await build({ entryPoints: ["app/api/netshop/product-insights/route.ts"], bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "products-private-route-fixture", setup(builder) {
  builder.onResolve({ filter: /^@\/lib\/auth\/authorization$/ }, () => ({ path: "auth", namespace: "fixture" }));
  builder.onResolve({ filter: /^@\/lib\/django\/netshop-service$/ }, () => ({ path: "service", namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path === "auth" ? `
    export class AuthorizationError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
    export async function requireAppPrincipal(){const p=globalThis.__pPrincipals.shift();if(!p)throw new AuthorizationError(403,'access_denied','账号不可用');return p;}
    export function authorizationErrorResponse(e){return e instanceof AuthorizationError?Response.json({code:e.code,error:e.message},{status:e.status,headers:{'cache-control':'no-store'}}):null;}` : `
    export function createDjangoNetshopService(){return {request:async(p,input,options)=>{if(input.method!=='GET'||input.service!=='reader'||input.path!=='/api/netshop/product-insights'||!options.signal||options.insightsTimeoutMs!==90000)throw Error('unsafe product transport');globalThis.__pCalls++;return {data:globalThis.__pData,revision:globalThis.__pRevision};}};}` }));
} }] });
const route = await import("data:text/javascript;base64,"+Buffer.from(compiled.outputFiles[0].text).toString("base64")) as { GET(request: Request): Promise<Response> };
const principal: AppPrincipal = { email: "products-route@example.test", displayName: "Synthetic", role: "viewer", scope: null };
const url = "http://127.0.0.1/api/netshop/product-insights?platform=京东&outlet=京东%1F合成店A&startDate=2026-09-01&endDate=2026-09-01";
function reset() {
  const context = syntheticInsightsContext();
  const metrics = Object.fromEntries(productMetricKeys.map(key => [key, { value: 0, unit: key === "payment" || key === "refundPayment" ? "CNY_CENT" : key === "conversion" || key === "addCartRate" ? "RATIO" : "COUNT", status: "available", reasonCode: null, basis: "product_day_sum", sourceIds: ["jd_sku_daily:spu_daily:京东"], aggregation: key === "conversion" || key === "addCartRate" ? "ratio_of_sums" : "sum", coverageRef: "jd_sku_daily:spu_daily:京东:current", ...(key === "conversion" || key === "addCartRate" ? { numerator: 0, denominator: 10 } : {}) }])) as Record<typeof productMetricKeys[number], MetricValue>;
  const comparisons = Object.fromEntries(productMetricKeys.map(key => [key, { previous: compareMetrics(metrics[key], metrics[key]), yearAgo: compareMetrics(metrics[key], metrics[key]) }]));
  const item = { identity: { platform: "京东", shopName: "合成店A", dimension: "spu", id: "P01" }, title: "Synthetic", category: null, imageUrl: null, imageStatus: "unverified", metrics, comparisons, baselineMetrics: { previous: metrics, yearAgo: metrics } };
  const pagination = { page: 1, pageSize: 20, total: 1, returned: 1, hasMore: false, truncated: false };
  const payload = { schemaVersion: "netshop-product-insights-v1", context, sectionToken: "a".repeat(64), tableScope: { q: "", category: "", sort: "payment_desc", page: 1, pageSize: 20 }, joinedSourceRevisions: context.sourceRevisions, consistency: "revision_vector_checked", sections: { ...completeProductSectionsFixture(metrics), summary: metrics, comparisons, items: [item], pagination, baselineReads: { previous: { state: "ready", data: metrics }, yearAgo: { state: "ready", data: metrics } }, growth: { state: "ready", data: { collection: "paired_full_set_before_pagination", items: [item], pagination } } } };
  runtime.__pPrincipals = [principal, principal]; runtime.__pData = payload; runtime.__pRevision = "1:aaaaaaaaaaaa"; runtime.__pCalls = 0; return payload;
}
test("product route releases only signed reader-bound validated owning payload", async () => { reset(); const response = await route.GET(new Request(url)); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("X-Netshop-Data-Revision"), "1:aaaaaaaaaaaa"); assert.equal(runtime.__pCalls, 1); });
test("invalid parameters and unsupported ERP scopes are rejected before reading", async () => {
  for (const suffix of ["&q=a&q=b", "&sort=growth", "&pageSize=101", "&source=erp"]) { reset(); assert.equal((await route.GET(new Request(url+suffix))).status, 400); assert.equal(runtime.__pCalls, 0); }
  reset(); runtime.__pPrincipals![0] = { ...principal, scope: { platforms: ["京东"], warehouses: ["W"], channels: [] } }; assert.equal((await route.GET(new Request(url))).status, 403); assert.equal(runtime.__pCalls, 0);
});
test("actor mutation and malformed cross-store success cannot release cached numbers", async () => {
  reset(); runtime.__pPrincipals![1] = { ...principal, role: "analyst" }; assert.equal((await route.GET(new Request(url))).status, 403);
  const data = reset(); data.sections.items[0].identity.shopName = "Foreign"; assert.equal((await route.GET(new Request(url))).status, 400);
  reset(); runtime.__pRevision = "2:bbbbbbbbbbbb"; assert.equal((await route.GET(new Request(url))).status, 400);
});
test("embedded baseline access denial under HTTP200 is promoted to closed HTTP403", async () => {
  const data = reset(); runtime.__pData = { ...data, sections: { ...data.sections, baselineReads: { ...data.sections.baselineReads, previous: { state: "error", data: null, code: "access_denied", message: "Access changed" } } } }; const response = await route.GET(new Request(url)); assert.equal(response.status, 403); const body = await response.json(); assert.equal(body.code, "access_denied"); assert.equal(body.sections, undefined);
});
