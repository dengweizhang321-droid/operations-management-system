import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

type Principal = { email: string; role: string; scope: null | { platforms: string[]; brands: string[] } };
const state = globalThis as typeof globalThis & { __overviewPrincipals?: Principal[]; __overviewCalls?: number };
const compiled = await build({ entryPoints: ["app/api/netshop/store-overview/route.ts"], bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "overview-permission-fixture", setup(builder) {
  builder.onResolve({ filter: /^@\/lib\/auth\/authorization$/ }, () => ({ path: "auth", namespace: "fixture" }));
  builder.onResolve({ filter: /^@\/lib\/django\/netshop-service$/ }, () => ({ path: "service", namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path === "auth" ? `
    export class AuthorizationError extends Error { constructor(status,code,message){super(message);this.status=status;this.code=code;} }
    export async function requireAppPrincipal(){return globalThis.__overviewPrincipals.shift();}
    export function authorizationErrorResponse(e){return e instanceof AuthorizationError?Response.json({error:e.message,code:e.code},{status:e.status,headers:{'cache-control':'no-store'}}):null;}` : `
    export const NETSHOP_STORE_OVERVIEW_PATH='/api/netshop/store-overview';
    export function createDjangoNetshopService(){return{request:async(p,input,options)=>{if(input.method!=='GET'||input.service!=='reader'||input.path!==NETSHOP_STORE_OVERVIEW_PATH||!options.signal)throw Error('invalid reader call');globalThis.__overviewCalls++;return{data:{}};}};}` }));
} }] });
const route = await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64")) as { GET: (request: Request) => Promise<Response> };
const admin: Principal = { email: "reader@example.test", role: "admin", scope: null };

test("permission changes during the new overview read prevent releasing the old scope", async () => {
  state.__overviewPrincipals = [admin, { ...admin, role: "viewer", scope: { platforms: ["京东"], brands: [] } }]; state.__overviewCalls = 0;
  const response = await route.GET(new Request("http://127.0.0.1/api/netshop/store-overview?platform=天猫&startDate=2026-09-01&endDate=2026-09-29"));
  assert.equal(response.status, 403); assert.equal(state.__overviewCalls, 1);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match((await response.json()).error, /权限已变化/);
});

test("a malformed owning response is an error, never an all-zero success", async () => {
  state.__overviewPrincipals = [admin, admin]; state.__overviewCalls = 0;
  const response = await route.GET(new Request("http://127.0.0.1/api/netshop/store-overview?platform=天猫&startDate=2026-09-01&endDate=2026-09-29"));
  assert.equal(response.status, 500); assert.equal(state.__overviewCalls, 1);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
