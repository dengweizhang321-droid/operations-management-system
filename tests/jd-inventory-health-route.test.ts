import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { type TestContext } from "node:test";
import { build } from "esbuild";
import type { AppPrincipal } from "../lib/auth/authorization";
import { jdInventoryHealthStates } from "../lib/inventory/jd-logistics-contract";

const path = "/api/inventory/jd-logistics";
const principal: AppPrincipal = { email: "health-route@example.invalid", displayName: "Synthetic", role: "viewer", scope: null };
const secret = "jd-health-route-synthetic-secret-at-least-32-bytes";
const state = globalThis as typeof globalThis & { __jdHealthRoutePrincipal?: AppPrincipal | null };
// The actual public route and signed inventory transport are bundled. Only the
// authenticated session is synthetic; every network request is intercepted.
const bundled = await build({ entryPoints: ["app/api/inventory/jd-logistics/route.ts"], bundle: true,
  write: false, platform: "node", format: "esm", external: ["cloudflare:workers"],
  banner: { js: "import { createRequire as fixtureCreateRequire } from 'node:module'; const require = fixtureCreateRequire(process.cwd() + '/package.json');" },
  plugins: [{ name: "jd-health-session", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/auth\/authorization$/ }, () => ({ path: "session", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: `
      export async function requireAppPrincipal(roles) {
        const value = globalThis.__jdHealthRoutePrincipal;
        if (!value) throw Object.assign(new Error('Authentication required'), {status:401});
        if (!roles.includes(value.role)) throw Object.assign(new Error('Forbidden role'), {status:403});
        return value;
      }
      export function requireUnrestrictedDataScope(value) {
        if(value.scope!==null) throw Object.assign(new Error('Restricted scope'), {status:403});
      }
      export function authorizationErrorResponse(error) {
        return [401,403].includes(error.status) ? Response.json({error:error.message}, {status:error.status}) : null;
      }` }));
  } }] });
const route = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`) as {
  GET(request: Request): Promise<Response>;
};

function setup(t: TestContext, fetcher: typeof fetch) {
  const environment = { TERUISI_DJANGO_INVENTORY_READER_BASE_URL: "http://127.0.0.1:18151",
    TERUISI_DJANGO_INVENTORY_WRITER_BASE_URL: "http://127.0.0.1:18152", TERUISI_DJANGO_INTERNAL_SECRET: secret };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  Object.assign(process.env, environment);
  globalThis.fetch = fetcher;
  state.__jdHealthRoutePrincipal = principal;
  t.after(() => {
    globalThis.fetch = previousFetch;
    delete state.__jdHealthRoutePrincipal;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test("public health TAB query reaches the exact signed reader with all members and revision preserved", async t => {
  let expected = new URLSearchParams(), calls = 0;
  const payload = { success: true, data: { healthState: "stockout", total: 2, page: 1, pageSize: 1,
    items: [{ goodsCode: "SYNTHETIC", detailCount: 3, detailsComplete: true }], synthetic: true } };
  setup(t, async (input, init) => {
    calls++;
    const request = new Request(input, init), url = new URL(request.url), headers = request.headers;
    assert.equal(url.origin, "http://127.0.0.1:18151");
    assert.equal(url.pathname, path);
    assert.equal(url.search.slice(1), expected.toString());
    assert.equal(request.method, "GET");
    const canonical = ["v1", headers.get("x-teruisi-timestamp"), headers.get("x-teruisi-request-id"),
      "GET", path, expected.toString(), headers.get("x-teruisi-content-sha256"), headers.get("x-teruisi-principal")].join("\n");
    assert.equal(headers.get("x-teruisi-signature"), `v1=${createHmac("sha256", secret).update(canonical).digest("hex")}`);
    return Response.json(payload, { headers: { "x-inventory-data-revision": "5:abcdef123456" } });
  });
  for (const healthState of ["all", ...jdInventoryHealthStates]) {
    expected = new URLSearchParams({ operation: "inventory_monitor", departmentId: "SYNTHETIC-BU", layout: "product", salesWindow: "30", healthState, pageSize: "1" });
    const response = await route.GET(new Request(`https://test.invalid${path}?${expected}`));
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.deepEqual(await response.json(), payload);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-inventory-data-revision"), "5:abcdef123456");
  }
  assert.equal(calls, 8);
});

test("public health rejects unknown, empty, repeated, or invented query keys before transport", async t => {
  let calls = 0;
  setup(t, async () => { calls++; throw new Error("must not dispatch"); });
  for (const query of ["healthState=unknown", "healthState=", "healthState=stockout&healthState=replenish", "healthState=all&healthFilter=stockout"]) {
    const response = await route.GET(new Request(`https://test.invalid${path}?operation=inventory_monitor&${query}`));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_request");
  }
  assert.equal(calls, 0);
});

test("public health keeps session and unrestricted-scope gates before transport", async t => {
  let calls = 0;
  setup(t, async () => { calls++; throw new Error("must not dispatch"); });
  const request = () => new Request(`https://test.invalid${path}?operation=inventory_monitor&healthState=replenish`);
  state.__jdHealthRoutePrincipal = null;
  assert.equal((await route.GET(request())).status, 401);
  state.__jdHealthRoutePrincipal = { ...principal, scope: { warehouses: ["SYNTHETIC"], channels: [], platforms: [] } };
  assert.equal((await route.GET(request())).status, 403);
  assert.equal(calls, 0);
});
