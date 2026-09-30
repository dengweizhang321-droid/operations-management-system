import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { build } from "esbuild";
import type { AppPrincipal } from "../lib/auth/authorization";

const runtime = globalThis as typeof globalThis & {
  __promotionPrincipals?: AppPrincipal[]; __promotionResult?: unknown;
  __promotionRevision?: string; __promotionCalls?: number;
};
async function compile(path: string) {
  const compiled = await build({ entryPoints: [path], bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "promotion-reader-fixture", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/auth\/authorization$/ }, () => ({ path: "auth", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/lib\/django\/netshop-service$/ }, () => ({ path: "service", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path === "auth" ? `
      export class AuthorizationError extends Error { constructor(status,code,message){super(message);this.status=status;this.code=code;} }
      export async function requireAppPrincipal(){const p=globalThis.__promotionPrincipals.shift();if(!p)throw new AuthorizationError(403,'access_denied','账号不可用');return p;}
      export function authorizationErrorResponse(e){return e instanceof AuthorizationError?Response.json({error:e.message,code:e.code},{status:e.status,headers:{'cache-control':'no-store'}}):null;}` : `
      export function createDjangoNetshopService(){return {request:async(p,input,options)=>{if(input.service!=='reader'||input.method!=='GET'||!['/api/netshop/promotion-insights','/api/netshop/promotion-insights/detail'].includes(input.path)||!options.signal||options.insightsTimeoutMs!==90000)throw Error('unsafe reader request');globalThis.__promotionCalls++;return {data:globalThis.__promotionResult,revision:globalThis.__promotionRevision};}};}` }));
  } }] });
  return await import("data:text/javascript;base64,"+Buffer.from(compiled.outputFiles[0].text).toString("base64")) as { GET(request: Request): Promise<Response> };
}
const listRoute = await compile("app/api/netshop/promotion-insights/route.ts");
const detailRoute = await compile("app/api/netshop/promotion-insights/detail/route.ts");
const principal: AppPrincipal = { email: "promotion@example.test", displayName: "Synthetic", role: "admin", scope: null };
function reset(detail = false, first = principal, second = first) {
  const value = JSON.parse(fs.readFileSync(new URL(`./fixtures/netshop-promotion/response-${detail ? "detail" : "product"}.json`, import.meta.url), "utf8"));
  runtime.__promotionPrincipals = [first, second]; runtime.__promotionResult = value;
  runtime.__promotionRevision = value.context.sourceRevisions.find((r: { kind: string }) => r.kind === "owning_revision").revision;
  runtime.__promotionCalls = 0;
  const c = value.context, s = value.sections;
  const query = new URLSearchParams({ platform: c.requestedScope.platforms[0], dimension: c.requestedScope.dimension,
    startDate: c.periods.current.startDate, endDate: c.periods.current.endDate, periodKind: c.requestedScope.periodKind,
    objectKind: detail ? s.item.objectKind : s.listScope.objectKind });
  c.requestedScope.shopKeys.forEach((key: string) => query.append("outlet", key));
  if (detail) { query.set("shopKey", s.item.shopKey); query.set("objectId", s.item.rowKey); query.set("sectionToken", value.sectionToken); }
  return `http://127.0.0.1/api/netshop/promotion-insights${detail ? "/detail" : ""}?${query}`;
}
test("A public readers release only complete, revision-bound DTOs without caching", async () => {
  for (const detail of [false, true]) {
    const url = reset(detail), response = await (detail ? detailRoute : listRoute).GET(new Request(url));
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("X-Netshop-Data-Revision"), runtime.__promotionRevision);
    assert.equal(runtime.__promotionCalls, 1);
  }
});
test("unknown or duplicate parameters never reach the reader", async () => {
  for (const suffix of ["&platform=京东", "&objectKind=product", "&category=other"]) {
    const url = reset(); assert.equal((await listRoute.GET(new Request(url+suffix))).status, 400); assert.equal(runtime.__promotionCalls, 0);
  }
});
test("unsupported and unauthorized principal scopes fail before facts are read", async () => {
  for (const scope of [{ platforms: ["京东"], channels: ["A"], warehouses: [] }, { platforms: ["天猫"], channels: [], warehouses: [] }]) {
    const url = reset(false, { ...principal, scope });
    assert.equal((await listRoute.GET(new Request(url))).status, 403); assert.equal(runtime.__promotionCalls, 0);
  }
});
test("permission changes during transport suppress list and detail payloads", async () => {
  for (const detail of [false, true]) {
    const url = reset(detail, principal, { ...principal, role: "viewer" });
    assert.equal((await (detail ? detailRoute : listRoute).GET(new Request(url))).status, 403);
    assert.equal(runtime.__promotionCalls, 1);
  }
});
test("a foreign source revision or shape is never a successful public response", async () => {
  const url = reset(); runtime.__promotionRevision = "99:bbbbbbbbbbbb";
  assert.notEqual((await listRoute.GET(new Request(url))).status, 200);
  const badUrl = reset(); (runtime.__promotionResult as { sections: { items: unknown } }).sections.items = null;
  assert.notEqual((await listRoute.GET(new Request(badUrl))).status, 200);
});
test("detail requires its version and exact store-bound row, without list focus", async () => {
  for (const name of ["sectionToken", "objectKind", "shopKey"]) {
    const url = new URL(reset(true)); url.searchParams.delete(name);
    assert.equal((await detailRoute.GET(new Request(url))).status, 400); assert.equal(runtime.__promotionCalls, 0);
  }
  const focused = reset(true)+"&focusDate=2026-09-01";
  assert.equal((await detailRoute.GET(new Request(focused))).status, 400); assert.equal(runtime.__promotionCalls, 0);
  const wrong = new URL(reset(true)); wrong.searchParams.set("objectId", "f".repeat(64));
  assert.notEqual((await detailRoute.GET(new Request(wrong))).status, 200);
});
