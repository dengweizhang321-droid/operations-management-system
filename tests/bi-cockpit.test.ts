import assert from "node:assert/strict";
import test from "node:test";
import { decodeBiCockpit, flowData } from "../lib/bi/cockpit-contract";
import { requestDjangoBiCockpit } from "../lib/django/bi-service";
import { createDjangoFinanceService, FINANCE_ERP_TARGETS_PATH } from "../lib/django/finance-service";
import { registerHooks } from "node:module";
import { getAnthropicTools, getOpenAiTools, validateToolArguments } from "../lib/ai/tool-registry-contract";
registerHooks({ resolve(specifier, context, nextResolve) { return specifier === "cloudflare:workers" ? { url: "data:text/javascript,export const env={};", shortCircuit: true } : nextResolve(specifier, context); } });
const { aiToolRegistry } = await import("../lib/ai/tool-registry");

const principal = { email: "admin@example.test", displayName: "Admin", role: "admin" as const, scope: null };
const config = { readerBaseUrl: "http://127.0.0.1:8081", writerBaseUrl: "http://127.0.0.1:8082", internalSecret: "bi-cockpit-contract-test-secret-32bytes", timeoutMs: 2000 };
const revision = "a".repeat(64);
function fixture() {
  const metric = { netSalesCents: 100, costCents: 80, grossProfitCents: 20, orderMarginCents: 15, positiveSalesCents: 100, refundCents: 0, grossMarginRate: .2, refundRate: 0, trustedOrders: 1, missingOrderNoRows: 0, averageOrderValueCents: 100, orderStatus: "available", rowCount: 1, status: "available", coverage: { observedDays: 1, expectedDays: 1, dateComplete: true, basis: "published_business_row_dates" } };
  const window = { startDate: "2026-09-01", endDate: "2026-09-01", endExclusive: "2026-09-02", days: 1 };
  const goal = { targetCents: null, actualCents: 100, completion: null, pace: .5, mom: null, yoy: null, progressChangePp: null };
  return { contractVersion: "bi-cockpit-v1", projection: "cockpit", revision, erp: { periods: { timezone: "Asia/Shanghai", current: window, previous: window, yearAgo: window }, sales: { current: structuredClone(metric), previous: metric, yearAgo: metric, daily: [] }, shops: [], categories: [], options: [] }, goals: { basis: "erp_net_sales", periods: [goal, goal], items: [] }, sources: Object.fromEntries(["targets", "operations", "inventory", "flow"].map(source => [source, { source, status: "unavailable", data: null, revision: null }])) };
}
test("cockpit contract preserves nulls and rejects invalid calendar and margin", () => {
  const data = fixture(); assert.equal(decodeBiCockpit(data).goals.periods[0].targetCents, null);
  data.erp.sales.current.grossProfitCents = 15; assert.throws(() => decodeBiCockpit(data), /毛利/);
  const invalid = fixture(); invalid.erp.periods.current.endExclusive = "2026-09-03"; assert.throws(() => decodeBiCockpit(invalid), /日期/);
  const unsafe = fixture(); unsafe.erp.sales.current.netSalesCents = Number.MAX_SAFE_INTEGER + 1; assert.throws(() => decodeBiCockpit(unsafe), /数字/);
});
test("unavailable flow values never become false zero", () => {
  assert.throws(() => flowData({ source: "flow", status: "ready", revision: "1:aaaa", data: { schemaVersion: "netshop-bi-flow-v1", status: "ready", summary: { payment: { value: 0, status: "unavailable", unit: "CNY_CENT" } }, platforms: [], shops: [], options: [] } }), /不可用/);
});
test("dedicated cockpit signer validates its distinct revision and path", async () => {
  const result = await requestDjangoBiCockpit(principal, "range=month", { config, fetchImpl: async (input, init) => { const request = new Request(input, init); assert.equal(new URL(request.url).pathname, "/api/bi/cockpit"); assert.ok(request.headers.get("x-teruisi-signature")); return Response.json({ contractVersion: "bi-cockpit-v1", projection: "cockpit", revision }, { headers: { "x-bi-data-revision": revision } }); } });
  assert.equal(result.revision, revision);
});
test("ERP target POST uses only finance writer", async () => {
  const service = createDjangoFinanceService(config);
  const result = await service.request(principal, { method: "POST", path: FINANCE_ERP_TARGETS_PATH, payload: { salesTargetCents: 100 }, service: "writer" }, { fetchImpl: async (input, init) => { const request = new Request(input, init); assert.equal(new URL(request.url).origin, config.writerBaseUrl); assert.equal(request.method, "POST"); return Response.json({ item: {} }, { status: 201, headers: { "x-finance-data-revision": "1:abcdef123456" } }); } }); assert.equal(result.status, 201);
});
test("BI summary is shared across providers, scoped principals cannot see it", () => {
  const entry = aiToolRegistry.find(row => row.name === "get_bi_cockpit"); assert.ok(entry);
  assert.equal(entry.scopePolicy, "unscoped_only"); assert.equal(entry.risk, "read_only");
  assert.ok(getOpenAiTools(principal, "ai_chat", aiToolRegistry).some(row => row.function.name === entry.name));
  assert.ok(getAnthropicTools(principal, "ai_chat", aiToolRegistry).some(row => row.name === entry.name));
  const scoped = { ...principal, scope: { platforms: ["京东"], warehouses: [], channels: [] } };
  assert.ok(!getOpenAiTools(scoped, "ai_chat", aiToolRegistry).some(row => row.function.name === entry.name));
  assert.throws(() => validateToolArguments({ range: "month", sql: "SELECT *" }, entry.inputSchema));
});
