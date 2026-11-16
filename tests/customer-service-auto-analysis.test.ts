import assert from "node:assert/strict";
import { test } from "node:test";
import type { AppPrincipal } from "../lib/auth/authorization";
import { registerHooks } from "node:module";
import type { CustomerServiceAnalysisRecord } from "../lib/customer-service/analysis";
import type { CustomerServiceAutoAnalysisDependencies } from "../lib/customer-service/auto-analysis-scheduled";

registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "cloudflare:workers"
      ? { url: "data:text/javascript,export const env={};", shortCircuit: true }
      : nextResolve(specifier, context);
  },
});
const {
  buildCustomerServiceAnalysisPrompt,
  CUSTOMER_SERVICE_ANALYSIS_PROMPT_LIMIT,
  packCustomerServiceAnalysisBatches,
} = await import("../lib/customer-service/analysis");
const { customerServiceAutoAnalysisSettings, runScheduledCustomerServiceAnalysis } = await import("../lib/customer-service/auto-analysis-scheduled");
const { PublicApiError } = await import("../lib/http/api-error");

const admin: AppPrincipal = { email: "local-admin@teruisi.local", displayName: "本地管理员", role: "admin", scope: null };
const settings = { enabled: true, owner: admin.email, dailyLimit: 480 };

function harness(overrides: CustomerServiceAutoAnalysisDependencies = {}) {
  const calls = { candidates: 0, model: 0, analyze: [] as number[][] };
  const dependencies: CustomerServiceAutoAnalysisDependencies = {
    settings: async () => settings,
    resolvePrincipal: async () => ({ ok: true, principal: admin }),
    loadCandidates: async () => { calls.candidates += 1; return { ids: [3, 1, 2], pendingCount: 3, analyzedToday: 10, windowHours: 72 }; },
    hasChatModel: async () => { calls.model += 1; return true; },
    analyze: async (ids) => { calls.analyze.push(ids); return { analyzed: ids.length, requested: ids.length, conflicts: 0, failed: 0 }; },
    ...overrides,
  };
  return { calls, dependencies };
}

test("settings default to enabled, local admin and 480 per day", () => {
  assert.deepEqual(customerServiceAutoAnalysisSettings({}), { enabled: true, owner: "local-admin@teruisi.local", dailyLimit: 480 });
  for (const off of ["off", "FALSE", " 0 "]) assert.equal(customerServiceAutoAnalysisSettings({ CUSTOMER_SERVICE_AUTO_ANALYSIS: off }).enabled, false);
  assert.equal(customerServiceAutoAnalysisSettings({ CUSTOMER_SERVICE_AUTO_ANALYSIS: "on" }).enabled, true);
  assert.deepEqual(customerServiceAutoAnalysisSettings({ CUSTOMER_SERVICE_AUTO_ANALYSIS_OWNER: " a@b.c ", CUSTOMER_SERVICE_AUTO_ANALYSIS_DAILY_LIMIT: "16" }), { enabled: true, owner: "a@b.c", dailyLimit: 16 });
  for (const bad of ["0", "-1", "abc", "1.5", ""]) assert.equal(customerServiceAutoAnalysisSettings({ CUSTOMER_SERVICE_AUTO_ANALYSIS_DAILY_LIMIT: bad }).dailyLimit, 480);
});

test("disabled switch returns before any lookup", async () => {
  const { calls, dependencies } = harness({ settings: async () => ({ ...settings, enabled: false }) });
  assert.deepEqual(await runScheduledCustomerServiceAnalysis(dependencies), { skipped: "disabled" });
  assert.equal(calls.candidates + calls.model + calls.analyze.length, 0);
});

test("owner failures skip without reading candidates or calling the model", async () => {
  const cases: Array<[CustomerServiceAutoAnalysisDependencies, string]> = [
    [{ resolvePrincipal: async () => ({ ok: false, retryable: true }) }, "owner_unavailable"],
    [{ resolvePrincipal: async () => ({ ok: false }) }, "owner_invalid"],
    [{ resolvePrincipal: async () => ({ ok: true, principal: { ...admin, role: "viewer" } }) }, "owner_invalid"],
    [{ resolvePrincipal: async () => ({ ok: true, principal: { ...admin, scope: { warehouses: ["主仓"], channels: [], platforms: [] } } }) }, "owner_invalid"],
  ];
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const [override, skipped] of cases) {
      const { calls, dependencies } = harness(override);
      assert.deepEqual(await runScheduledCustomerServiceAnalysis(dependencies), { skipped });
      assert.equal(calls.candidates + calls.model + calls.analyze.length, 0);
    }
  } finally {
    console.error = originalError;
  }
});

test("daily limit, empty candidates and missing model never reach analysis", async () => {
  let harnessed = harness({ loadCandidates: async () => ({ ids: [1], pendingCount: 1, analyzedToday: 480, windowHours: 72 }) });
  assert.deepEqual(await runScheduledCustomerServiceAnalysis(harnessed.dependencies), { skipped: "daily_limit", analyzedToday: 480 });
  assert.equal(harnessed.calls.model + harnessed.calls.analyze.length, 0);

  harnessed = harness({ loadCandidates: async () => ({ ids: [], pendingCount: 0, analyzedToday: 0, windowHours: 72 }) });
  assert.deepEqual(await runScheduledCustomerServiceAnalysis(harnessed.dependencies), { skipped: "no_candidates" });
  assert.equal(harnessed.calls.model + harnessed.calls.analyze.length, 0);

  harnessed = harness({ hasChatModel: async () => false });
  assert.deepEqual(await runScheduledCustomerServiceAnalysis(harnessed.dependencies), { skipped: "no_model" });
  assert.equal(harnessed.calls.analyze.length, 0);
});

test("remaining daily budget trims the batch", async () => {
  const { calls, dependencies } = harness({
    settings: async () => ({ ...settings, dailyLimit: 12 }),
    loadCandidates: async () => ({ ids: [1, 2, 3, 4, 5, 6, 7, 8], pendingCount: 40, analyzedToday: 10, windowHours: 72 }),
  });
  await runScheduledCustomerServiceAnalysis(dependencies);
  assert.deepEqual(calls.analyze, [[1, 2]]);
});

test("normal tick analyzes exactly the returned ids as the background principal", async () => {
  let seen: AppPrincipal | undefined;
  const { calls, dependencies } = harness({
    analyze: async (ids, principal) => { seen = principal; calls.analyze.push(ids); return { analyzed: 3, requested: 3, conflicts: 0, failed: 0 }; },
  });
  assert.deepEqual(await runScheduledCustomerServiceAnalysis(dependencies), { analyzed: 3, requested: 3, conflicts: 0, failed: 0, pendingCount: 3 });
  assert.deepEqual(calls.analyze, [[3, 1, 2]]);
  assert.equal(seen, admin);
});

test("quota 429 and missing model return skipped while other errors propagate", async () => {
  let result = await runScheduledCustomerServiceAnalysis(harness({ analyze: async () => { throw new PublicApiError(429, "invalid_request", "quota"); } }).dependencies);
  assert.deepEqual(result, { skipped: "quota" });
  result = await runScheduledCustomerServiceAnalysis(harness({ analyze: async () => { throw new PublicApiError(503, "service_unavailable", "尚未配置可用的文本模型。"); } }).dependencies);
  assert.deepEqual(result, { skipped: "model_unavailable" });
  await assert.rejects(
    runScheduledCustomerServiceAnalysis(harness({ analyze: async () => { throw new PublicApiError(503, "service_unavailable", "Django 不可用"); } }).dependencies),
    /Django 不可用/,
  );
  await assert.rejects(runScheduledCustomerServiceAnalysis(harness({ analyze: async () => { throw new Error("boom"); } }).dependencies), /boom/);
});

function record(id: number, messageCount: number): CustomerServiceAnalysisRecord {
  return {
    id, shopName: "店", consultedAt: "2026-11-16 10:00:00", agent: "客服A", productSku: "SKU", consultationType: "商品咨询",
    messages: Array.from({ length: messageCount }, (_, index) => ({ sender: "顾客", sentAt: "2026-11-16 10:00:00", content: `${index}`.padEnd(300, "字") })),
  };
}

test("long conversations are split so every prompt stays within 40,000 characters", () => {
  const records = Array.from({ length: 8 }, (_, index) => record(index + 1, 24));
  assert.ok(buildCustomerServiceAnalysisPrompt(records).length > 48_000);
  const batches = packCustomerServiceAnalysisBatches(records);
  assert.ok(batches.length >= 2);
  assert.deepEqual(batches.flat().map((item) => item.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const batch of batches) assert.ok(buildCustomerServiceAnalysisPrompt(batch).length <= CUSTOMER_SERVICE_ANALYSIS_PROMPT_LIMIT);
});

test("short conversations stay in one batch", () => {
  const records = Array.from({ length: 8 }, (_, index) => record(index + 1, 3));
  assert.equal(packCustomerServiceAnalysisBatches(records).length, 1);
  assert.deepEqual(packCustomerServiceAnalysisBatches([]), []);
});

test("a single oversized conversation is trimmed from the end instead of failing", () => {
  const huge: CustomerServiceAnalysisRecord = { ...record(1, 0), messages: Array.from({ length: 24 }, (_, index) => ({ sender: "顾客", sentAt: "t", content: `${index}`.padEnd(3_000, "字") })) };
  const [batch, ...rest] = packCustomerServiceAnalysisBatches([huge]);
  assert.equal(rest.length, 0);
  assert.equal(batch?.length, 1);
  const kept = batch![0]!.messages;
  assert.ok(kept.length > 0 && kept.length < 24);
  assert.equal(kept[0]!.content, huge.messages[0]!.content);
  assert.ok(buildCustomerServiceAnalysisPrompt(batch!).length <= CUSTOMER_SERVICE_ANALYSIS_PROMPT_LIMIT);
});

test("Django client signs a reader GET for the candidate path and validates the payload", async () => {
  const { CUSTOMER_SERVICE_AUTO_ANALYSIS_PATH, requestDjangoCustomerServiceAutoAnalysisCandidates } = await import("../lib/django/customer-service");
  const config = { readerBaseUrl: "http://127.0.0.1:9101", writerBaseUrl: "http://127.0.0.1:9102", internalSecret: "s".repeat(40) };
  const respond = (body: unknown): typeof fetch => async (input, init) => {
    assert.equal(String(input), `http://127.0.0.1:9101${CUSTOMER_SERVICE_AUTO_ANALYSIS_PATH}?limit=8`);
    assert.equal(init?.method, "GET");
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "x-customer-service-data-revision": "7:0123456789ab" } });
  };
  const good = { ids: [5, 9], pendingCount: 2, analyzedToday: 4, windowHours: 72 };
  assert.deepEqual(await requestDjangoCustomerServiceAutoAnalysisCandidates(admin, 8, { config, fetchImpl: respond(good) }), good);
  for (const bad of [{ ...good, ids: [0] }, { ...good, ids: "x" }, { ...good, pendingCount: -1 }, { ...good, ids: [1, 2, 3, 4, 5, 6, 7, 8, 9] }]) {
    await assert.rejects(requestDjangoCustomerServiceAutoAnalysisCandidates(admin, 8, { config, fetchImpl: respond(bad) }), PublicApiError);
  }
});
