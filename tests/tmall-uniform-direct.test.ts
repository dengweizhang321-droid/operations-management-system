import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { applyTmallDirectDailyPolicy } from "../lib/netshop/tmall-direct-daily-policy";
import type { TmallStore } from "../lib/netshop/tmall-store-registry";
import { tmallStoreRegistryData } from "../lib/netshop/tmall-store-catalog";
import { tmallN8nWorkflowDefinitions, type WorkflowTemplate } from "../tools/generate-tmall-n8n-workflows";
import { resolveTmallDailyPlanRange, planTmallDailyGaps } from "../tools/tmall-daily-gap-plan";
import { adaptTmallUniformDirectWorkflow, buildTmallUniformDirectCandidate } from "../tools/tmall-uniform-direct-workflows";
import { tmallDirectPmProtocolForStore, tmallDirectPmProtocolError } from "../tools/tmall-yijiu-direct-pm-contract";
import { runTmallProductMasterTerminalStage } from "../tools/tmall-sycm-cookie-pipeline";
import { decideTmallProductMasterCadence, migrateTmallProductMasterCadenceInterval } from "../tools/tmall-product-master-cadence";

function singleDay(storeKey: string): WorkflowTemplate {
  const definition = tmallN8nWorkflowDefinitions.find(item => item.storeKey === storeKey)!;
  const names = ["领取共享 helper", "A·计划目标日期", "B·逐日下载", "C·导入回查", "P·页面导出", "M·页面导出"];
  const routes = ["/coordination/claim", "/plan", "/fetch", "/import", "/promotion", "/product-master"];
  const connections = Object.fromEntries(names.slice(0, -1).map((name, i) => [name,
    { main: [[{ node: names[i + 1], type: "main", index: 0 }]] },
  ]));
  return { id: definition.workflowId, name: definition.workflowName, active: true,
    versionId: "original", settings: { timezone: "Asia/Shanghai", errorWorkflow: "TeruisiHourlyRetry2026" },
    nodes: [
      { id: "schedule", name: definition.scheduleName, type: "n8n-nodes-base.scheduleTrigger", parameters: {
        rule: { interval: [{ field: "cronExpression", expression: definition.cronExpression }] },
      } },
      ...names.map((name, i) => ({ id: `http-${i}`, name, type: "n8n-nodes-base.httpRequest", parameters: {
        method: "POST", url: `http://127.0.0.1:5791${routes[i]}`, options: { timeout: 120000 },
        headerParameters: { parameters: [
          { name: "X-TERUISI-TMALL-STORE-KEY", value: storeKey },
          { name: "X-TERUISI-N8N-EXECUTION-ID", value: "={{ $execution.id }}" },
          ...(i === 5 ? [{ name: "X-TERUISI-TMALL-FORCE-PRODUCT-MASTER", value: "original-force-expression" }] : []),
        ] },
      } })),
    ], connections,
  };
}

test("preparation preserves the old live registry and stages six single-day candidates with daily configuration", async () => {
  const old = JSON.parse(await readFile(new URL("../config/tmall-store-accounts.json", import.meta.url), "utf8")) as { stores: TmallStore[] };
  for (const storeKey of ["tmall-tuofeng", "tmall-cuizhiwang", "tmall-masitu"]) {
    assert.equal(old.stores.find(item => item.storeKey === storeKey)?.productMasterCadence?.intervalDays, 3);
  }
  const enabled = tmallStoreRegistryData.stores.filter(item => item.enabled);
  assert.equal(enabled.length, 6);
  for (const store of enabled) {
    assert.equal(store.productMasterExportMode, "direct_mtop");
    assert.equal(store.productMasterCadence?.intervalDays, 1);
    const candidate = JSON.parse(await readFile(new URL(`../automation/n8n/${store.storeKey}-seven-day-direct.workflow.json`, import.meta.url), "utf8")) as WorkflowTemplate;
    assert.equal(candidate.active, false);
    assert.equal(candidate.settings?.timezone, "Asia/Shanghai");
    assert.equal(candidate.nodes.filter(node => node.type === "n8n-nodes-base.scheduleTrigger").length, 1);
    assert.equal(candidate.nodes.some(node => String(node.parameters?.url).endsWith("/next-day")), false);
    assert.deepEqual(buildTmallUniformDirectCandidate(candidate, store.storeKey), candidate);
  }
});

test("seven complete days end yesterday, cross months/leap days and respect registration and retry anchors", () => {
  assert.deepEqual(resolveTmallDailyPlanRange({ initialStartDate: "2026-08-01", latestAllowedDate: "2026-10-06" }),
    { startDate: "2026-09-30", endDate: "2026-10-06" });
  assert.deepEqual(resolveTmallDailyPlanRange({ initialStartDate: "2024-01-01", latestAllowedDate: "2024-03-02" }),
    { startDate: "2024-02-25", endDate: "2024-03-02" });
  assert.deepEqual(resolveTmallDailyPlanRange({ initialStartDate: "2026-10-04", latestAllowedDate: "2026-10-06" }),
    { startDate: "2026-10-04", endDate: "2026-10-06" });
  assert.deepEqual(resolveTmallDailyPlanRange({ initialStartDate: "2026-08-01", latestAllowedDate: "2026-10-07", endDate: "2026-10-06" }),
    { startDate: "2026-09-30", endDate: "2026-10-06" });
  assert.deepEqual(resolveTmallDailyPlanRange({ initialStartDate: "2026-08-01", latestAllowedDate: "2026-10-06", startDate: "2026-08-10", endDate: "2026-08-11" }),
    { startDate: "2026-08-10", endDate: "2026-08-11" });
  for (const change of [{ initialStartDate: null }, { latestAllowedDate: "2026-02-30" },
    { endDate: "2026-10-07" }, { startDate: "2026-07-31" }, { startDate: "2026-10-07" }]) {
    assert.throws(() => resolveTmallDailyPlanRange({ initialStartDate: "2026-08-01", latestAllowedDate: "2026-10-06", ...change }));
  }
});

test("daily policy is idempotent, preserves original and disabled stores, and rejects unexpected legacy configuration", () => {
  const source = [{ storeKey: "tmall-masitu", enabled: true, productMasterExportMode: "on_sale_pagewise_excel",
    productMasterCadence: { intervalDays: 3, initialDueDate: "2026-08-26" }, browser: { debugPort: 9331 } },
  { storeKey: "tmall-ledu", enabled: false }, { storeKey: "unknown", enabled: true }];
  const before = structuredClone(source);
  const derived = applyTmallDirectDailyPolicy(source);
  assert.deepEqual(source, before);
  assert.deepEqual(applyTmallDirectDailyPolicy(derived), derived);
  assert.equal(derived[0]?.browser, source[0]?.browser);
  assert.equal(derived[1], source[1]);
  assert.equal(derived[2], source[2]);
  assert.throws(() => applyTmallDirectDailyPolicy([{ ...source[0]!, productMasterExportMode: "unsafe" }]));
  assert.throws(() => applyTmallDirectDailyPolicy([{ ...source[0]!, productMasterCadence: { intervalDays: 4, initialDueDate: "2026-08-26" } }]));
});

test("coverage outside seven days cannot steal today's plan; product/promotion gaps remain independent", () => {
  const range = resolveTmallDailyPlanRange({ initialStartDate: "2026-08-01", latestAllowedDate: "2026-10-06" });
  const all = ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"];
  const first = planTmallDailyGaps({ ...range, maximumDays: 1, productDailyDates: all, promotionDates: all.slice(1) });
  assert.deepEqual(first.selectedDates, ["2026-09-30"]);
  assert.deepEqual(first.productDownloadDates, []);
  assert.deepEqual(first.missingProductDates, []);
  const complete = planTmallDailyGaps({ ...range, maximumDays: 1, productDailyDates: all, promotionDates: all });
  assert.deepEqual(complete.selectedDates, []);
  const missingProduct = planTmallDailyGaps({ ...range, maximumDays: 1, productDailyDates: all.slice(1), promotionDates: all });
  assert.deepEqual(missingProduct.productDownloadDates, ["2026-09-30"]);
  assert.deepEqual(missingProduct.missingPromotionDates, []);
});

test("all six protocols accept their own P/M, reject every other store, multi-value and disabled/unknown keys", () => {
  for (const definition of tmallN8nWorkflowDefinitions) {
    const protocol = tmallDirectPmProtocolForStore(definition.storeKey)!;
    for (const route of ["/promotion-direct-v1", "/product-master-direct-v1"]) {
      assert.equal(tmallDirectPmProtocolError({ route, storeKey: definition.storeKey, protocol }), null);
      for (const other of tmallN8nWorkflowDefinitions.filter(item => item.storeKey !== definition.storeKey)) {
        assert.equal(tmallDirectPmProtocolError({ route, storeKey: other.storeKey, protocol })?.error, "missing_or_invalid_tmall_direct_pm_protocol");
      }
      for (const bad of [undefined, "", [protocol]]) {
        assert.ok(tmallDirectPmProtocolError({ route, storeKey: definition.storeKey, protocol: bad }));
      }
      for (const storeKey of [null, "tmall-ledu", "constructor", "__proto__"]) {
        assert.equal(tmallDirectPmProtocolError({ route, storeKey, protocol })?.error, "tmall_direct_pm_store_not_allowed");
      }
    }
  }
});

test("six live single-day graphs change P/M only, retain IDs, retries, cron, force and A/B/C, and never add a loop", () => {
  for (const definition of tmallN8nWorkflowDefinitions) {
    const source = singleDay(definition.storeKey);
    const before = structuredClone(source);
    const result = adaptTmallUniformDirectWorkflow(source, definition.storeKey);
    assert.deepEqual(source, before);
    assert.deepEqual(result.nodes.slice(0, -2), source.nodes.slice(0, -2));
    assert.deepEqual(result.settings, source.settings);
    assert.equal(result.active, source.active);
    assert.equal(result.id, source.id);
    assert.equal(result.nodes.length, source.nodes.length);
    const requests = result.nodes.filter(node => node.name.startsWith("P·") || node.name.startsWith("M·"));
    assert.deepEqual(requests.map(node => node.parameters?.url), ["http://127.0.0.1:5791/promotion-direct-v1", "http://127.0.0.1:5791/product-master-direct-v1"]);
    assert.deepEqual(requests[1]?.parameters?.headerParameters?.parameters?.find(header => header.name === "X-TERUISI-TMALL-FORCE-PRODUCT-MASTER"),
      source.nodes.at(-1)?.parameters?.headerParameters?.parameters?.find(header => header.name === "X-TERUISI-TMALL-FORCE-PRODUCT-MASTER"));
    assert.equal(result.nodes.some(node => String(node.parameters?.url).endsWith("/next-day")), false);
    assert.deepEqual(adaptTmallUniformDirectWorkflow(result, definition.storeKey), result);
    const candidate = buildTmallUniformDirectCandidate(source, definition.storeKey);
    assert.equal(candidate.active, false);
    assert.deepEqual(buildTmallUniformDirectCandidate(source, definition.storeKey), candidate);
    assert.throws(() => adaptTmallUniformDirectWorkflow(source, "tmall-ledu"));
    for (const mutate of [
      (item: WorkflowTemplate) => { item.id = "wrong-id"; },
      (item: WorkflowTemplate) => { item.nodes.push(structuredClone(item.nodes.at(-1)!)); },
      (item: WorkflowTemplate) => { item.nodes.at(-1)!.parameters!.url = "https://unexpected.example/export"; },
      (item: WorkflowTemplate) => { item.nodes[2]!.parameters!.headerParameters!.parameters![0]!.value = "wrong-store"; },
      (item: WorkflowTemplate) => { item.nodes[2]!.parameters!.headerParameters!.parameters!.push({ name: "X-TERUISI-N8N-EXECUTION-ID", value: "another" }); },
    ]) {
      const invalid = structuredClone(source); mutate(invalid);
      assert.throws(() => adaptTmallUniformDirectWorkflow(invalid, definition.storeKey));
    }
  }
});

test("newly daily stores preserve success facts during CAS migration; registered M uses direct only and failure never advances", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tmall-uniform-cadence-"));
  try {
    const registry = JSON.parse(await readFile(new URL("../config/tmall-store-accounts.json", import.meta.url), "utf8")) as { stores: TmallStore[] };
    for (const store of applyTmallDirectDailyPolicy(registry.stores).filter(item => ["tmall-tuofeng", "tmall-cuizhiwang", "tmall-masitu"].includes(item.storeKey))) {
      assert.equal(store.productMasterCadence?.intervalDays, 1);
      const file = path.join(root, `${store.storeKey}.json`);
      const old = { version: 1, storeKey: store.storeKey, intervalDays: 3, lastSuccessDate: "2026-10-07", lastSnapshotDate: "2026-10-07", nextDueDate: "2026-10-10", updatedAt: "2026-10-07T00:00:00Z" };
      await writeFile(file, JSON.stringify(old));
      await assert.rejects(migrateTmallProductMasterCadenceInterval({ store, expectedPreviousIntervalDays: 3, expectedLastSuccessDate: "2026-10-06", stateDirectory: root }));
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), old);
      const migrated = await migrateTmallProductMasterCadenceInterval({ store, expectedPreviousIntervalDays: 3, expectedLastSuccessDate: "2026-10-07", stateDirectory: root });
      assert.equal(migrated.nextDueDate, "2026-10-08");
      assert.equal(migrated.lastSnapshotDate, old.lastSnapshotDate);
      assert.equal(migrated.lastSuccessDate, old.lastSuccessDate);
      let writes = 0;
      await assert.rejects(runTmallProductMasterTerminalStage({ store, forced: false,
        getDecision: async () => decideTmallProductMasterCadence({ store, state: migrated, operationDate: "2026-10-08" }),
        runDirect: async () => { throw new Error("fixture-import-proof-failure"); },
        runPagewise: async () => { assert.fail("UI fallback"); },
        runProductManager: async () => { assert.fail("manager fallback"); },
        recordSuccess: async () => { writes++; return null; },
      }), /fixture-import-proof-failure/);
      assert.equal(writes, 0);
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), migrated);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
