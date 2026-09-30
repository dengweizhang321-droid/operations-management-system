import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { syntheticInsightsContext } from "../lib/netshop/insights-fixtures";
import type { AppPrincipal } from "../lib/auth/authorization";

const runtime = globalThis as typeof globalThis & { __foundationPrincipals?: AppPrincipal[]; __foundationResult?: unknown; __foundationRevision?: string; __foundationCalls?: number };
const compiled = await build({ entryPoints: ["app/api/netshop/insights-context/route.ts"], bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "foundation-private-reader-fixture", setup(builder) {
  builder.onResolve({ filter: /^@\/lib\/auth\/authorization$/ }, () => ({ path: "auth", namespace: "fixture" }));
  builder.onResolve({ filter: /^@\/lib\/django\/netshop-service$/ }, () => ({ path: "service", namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path === "auth" ? `
    export class AuthorizationError extends Error { constructor(status,code,message){super(message);this.status=status;this.code=code;} }
    export async function requireAppPrincipal(){const p=globalThis.__foundationPrincipals.shift();if(!p)throw new AuthorizationError(403,'access_denied','账号不可用');return p;}
    export function authorizationErrorResponse(e){return e instanceof AuthorizationError?Response.json({error:e.message,code:e.code},{status:e.status,headers:{'cache-control':'no-store'}}):null;}` : `
    export const NETSHOP_INSIGHTS_CONTEXT_PATH='/api/netshop/insights-context';
    export function createDjangoNetshopService(){return {request:async(p,input,options)=>{if(input.service!=='reader'||input.method!=='GET'||input.path!==NETSHOP_INSIGHTS_CONTEXT_PATH||!options.signal||options.insightsTimeoutMs!==90000)throw Error('unsafe reader request');globalThis.__foundationCalls++;return {data:globalThis.__foundationResult,revision:globalThis.__foundationRevision};}};}` }));
} }] });
const route = await import("data:text/javascript;base64,"+Buffer.from(compiled.outputFiles[0].text).toString("base64")) as { GET(request: Request): Promise<Response> };
const principal: AppPrincipal = { email: "foundation@example.test", displayName: "Synthetic", role: "viewer", scope: null };
const url = "http://127.0.0.1/api/netshop/insights-context?platform=京东&outlet=京东%1F合成店A&startDate=2026-09-01&endDate=2026-09-01";
function reset(first = principal, second = first) { runtime.__foundationPrincipals = [first, second]; runtime.__foundationResult = syntheticInsightsContext(); runtime.__foundationRevision = "1:aaaaaaaaaaaa"; runtime.__foundationCalls = 0; }

test("public UI adapter releases only matched owning context and revision header", async () => {
  reset(); const response = await route.GET(new Request(url)); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("X-Netshop-Data-Revision"), "1:aaaaaaaaaaaa"); assert.equal(runtime.__foundationCalls, 1);
});
test("API rejects unsupported channel/warehouse scopes and duplicate request before reading", async () => {
  for (const scope of [{ platforms: ["京东"], channels: ["A"], warehouses: [] }, { platforms: ["京东"], channels: [], warehouses: ["W"] }]) {
    reset({ ...principal, scope }); const response = await route.GET(new Request(url)); assert.equal(response.status, 403); assert.equal(runtime.__foundationCalls, 0);
  }
  reset(); assert.equal((await route.GET(new Request(url+"&platform=京东"))).status, 400); assert.equal(runtime.__foundationCalls, 0);
});
test("valid but wrong request/window/header response is never released as success", async () => {
  for (const requestUrl of [url.replace("合成店A", "其他店"), url.replaceAll("2026-09-01", "2026-08-01"), url+"&dimension=sku", url+"&periodKind=rolling"]) {
    reset(); const response = await route.GET(new Request(requestUrl)); assert.notEqual(response.status, 200);
  }
  reset(); runtime.__foundationRevision = "2:bbbbbbbbbbbb"; assert.notEqual((await route.GET(new Request(url))).status, 200);
});
test("actor permissions changed during transport prevent releasing original range", async () => {
  reset(principal, { ...principal, scope: { platforms: ["天猫"], channels: [], warehouses: [] } }); assert.equal((await route.GET(new Request(url))).status, 403); assert.equal(runtime.__foundationCalls, 1);
});
