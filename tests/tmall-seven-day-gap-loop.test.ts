import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { planTmallDailyGaps } from "../tools/tmall-daily-gap-plan";
import { advanceTmallBackfill, beginTmallSevenDayBackfill, publicTmallBackfill,
  tmallBackfillMaximumMs, tmallSevenDayBackfillRoute } from "../tools/tmall-daily-backfill";
import type { TmallBackfillState } from "../tools/tmall-daily-backfill";
import { buildTmallSevenDayGapLoopCandidate } from "../tools/tmall-uniform-direct-workflows";
import { tmallN8nWorkflowDefinitions } from "../tools/generate-tmall-n8n-workflows";
import { helperRequestError } from "../tools/tmall-sycm-cookie-pipeline";
import { isolatedRequestIdentity } from "../tools/tmall-isolated-helper";

const days = Array.from({ length: 7 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
const identity = { executionId: "123", storeKey: "tmall-lili" };
function plan(products: string[], promotions = products) {
  const range = { startDate: days[0]!, endDate: days.at(-1)! };
  return { ...range, ...planTmallDailyGaps({ ...range, productDailyDates: products,
    promotionDates: promotions, maximumDays: 1 }), planPathBase64: "fixture" };
}

test("seven-day policy completes all seven gaps even when processing exceeds the old 30-minute budget", () => {
  let state: TmallBackfillState = beginTmallSevenDayBackfill(identity.executionId, identity.storeKey, plan([]), 0);
  for (let i = 0; i < 7; i++) {
    assert.deepEqual(state.currentDates, [days[i]]);
    state = advanceTmallBackfill(state, { ...identity, cycle: String(i), now: (i + 1) * tmallBackfillMaximumMs,
      plan: plan(days.slice(0, i + 1)) });
    assert.equal(state.status, i === 6 ? "completed" : "running");
    assert.equal(state.budgetReason, null);
  }
  assert.deepEqual(state.completedDates, days);
  assert.deepEqual(state.remainingDates, []);
  assert.equal(publicTmallBackfill(state).maximumDays, 7);
  assert.equal(publicTmallBackfill(state).maximumMinutes, null);
  assert.throws(() => advanceTmallBackfill(state, { ...identity, cycle: "7", now: 9 * tmallBackfillMaximumMs, plan: plan(days) }));
});

test("mixed and non-contiguous product/promotion gaps retain per-dataset skips, fixed range and verified progress", () => {
  const products = days.filter((_, i) => i !== 1 && i !== 5);
  const promotions = days.filter((_, i) => i !== 3 && i !== 5);
  const initial = plan(products, promotions);
  assert.deepEqual(initial.productDownloadDates, [days[1]]);
  let state: TmallBackfillState = beginTmallSevenDayBackfill(identity.executionId, identity.storeKey, initial, 100);
  const afterProduct = plan([...products, days[1]!], promotions);
  assert.deepEqual(afterProduct.productDownloadDates, []);
  state = advanceTmallBackfill(state, { ...identity, cycle: "0", now: 200, plan: afterProduct });
  assert.deepEqual(state.currentDates, [days[3]]);
  assert.throws(() => advanceTmallBackfill(state, { ...identity, cycle: "1", now: 300, plan: initial }), /覆盖回退/);
  assert.throws(() => advanceTmallBackfill(state, { ...identity, cycle: "0", now: 300, plan: afterProduct }), /不一致/);
  assert.throws(() => advanceTmallBackfill(state, { ...identity, cycle: "1", now: 300,
    plan: { ...afterProduct, endDate: "2026-10-08" } }), /七日|不一致/);
});

test("new seven-day route refuses oversized/invalid/cross-scope plans rather than silently applying a legacy budget", () => {
  const p = plan([]);
  for (const bad of [{ ...p, endDate: "2026-10-08" }, { ...p, startDate: "2026-02-30" },
    { ...p, selectedDates: [days[1]!] }, { ...p, selectedDates: [] },
    { ...p, missingPromotionDates: ["2026-09-30"] }]) {
    assert.throws(() => beginTmallSevenDayBackfill(identity.executionId, identity.storeKey, bad, 0), /七日/);
  }
  assert.equal(helperRequestError("ready", false, tmallSevenDayBackfillRoute, "123", "123"), null);
  assert.ok(helperRequestError("promoted", false, tmallSevenDayBackfillRoute, "123", "123"));
  assert.ok(helperRequestError("ready", false, tmallSevenDayBackfillRoute, "124", "123"));
  assert.equal(isolatedRequestIdentity(tmallSevenDayBackfillRoute, {
    "x-teruisi-n8n-execution-id": "123", "x-teruisi-tmall-store-key": "tmall-lili",
    "x-teruisi-workflow-key": "tmall",
  })?.storeKey, "tmall-lili");
});

test("no-gap preflight still rechecks P and N; a new execution replans only unresolved dates", () => {
  const initial = beginTmallSevenDayBackfill("123", "tmall-lili", plan(days), 0);
  assert.equal(initial.status, "running");
  assert.equal(advanceTmallBackfill(initial, { ...identity, cycle: "0", now: 100, plan: plan(days) }).status, "completed");
  const recovery = beginTmallSevenDayBackfill("124", "tmall-lili", plan(days.slice(0, 3)), 200);
  assert.deepEqual(recovery.currentDates, [days[3]]);
});

test("upgrade all six original direct graphs without changing identity, schedules, coordination, B/C or force-M headers", async () => {
  for (const definition of tmallN8nWorkflowDefinitions) {
    const source = JSON.parse(await readFile(new URL(`../automation/n8n/${definition.storeKey}-seven-day-direct.workflow.json`, import.meta.url), "utf8"));
    const original = structuredClone(source);
    const result = buildTmallSevenDayGapLoopCandidate(source, definition.storeKey);
    assert.deepEqual(source, original);
    assert.equal(result.id, source.id);
    assert.equal(result.active, false);
    assert.deepEqual(result.settings, source.settings);
    for (const node of source.nodes.filter((n: { name: string; type: string }) =>
      !n.name.startsWith("A·") && !n.name.startsWith("M·") && n.type !== "n8n-nodes-base.stickyNote")) {
      assert.deepEqual(result.nodes.find(n => n.id === node.id), node);
    }
    assert.equal(result.nodes.find(n => n.name.startsWith("A·"))?.parameters?.url, "http://127.0.0.1:5791" + tmallSevenDayBackfillRoute);
    assert.deepEqual(result.nodes.find(n => n.name.startsWith("M·"))?.parameters,
      source.nodes.find((n: { name: string }) => n.name.startsWith("M·")).parameters);
    assert.equal(new Set(result.nodes.map(n => n.name)).size, result.nodes.length);
    assert.deepEqual(buildTmallSevenDayGapLoopCandidate(result, definition.storeKey), result);
    const edges = result.connections as Record<string, { main: { node: string }[][] }>;
    assert.equal(edges["还有缺口？"]!.main[0]![0]!.node, "B·逐日下载并验证 XLS");
    assert.equal(edges["还有缺口？"]!.main[1]![0]!.node, "M·MTOP 分批导出、合并校验并导入");
  }
});
