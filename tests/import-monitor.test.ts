import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { importRunDuration, importRunStatus } from "../lib/imports/run-presentation";
import { jdCustomerServiceStores } from "../lib/jd/customer-service-stores";
import catalog from "../lib/imports/chain-catalog.generated.json";
import { scheduleErrorLabel } from "../lib/ai/schedule-presentation";

test("customer-service monitoring binds exactly one registered workflow to each store", () => {
  const rules = catalog.rules.filter(rule => rule.chainKey === "jd_customer_service");
  assert.equal(rules.length, 4);
  // Independently stated per 线上实际 (store, time-of-day), not copied from the file under test.
  const liveSchedule: Record<string, string> = {
    JdCustomerService2026: "10 13 * * *",
    JdCustomerServiceCutMeat2026: "10 12 * * *",
    JdCustomerServiceChudian2026: "50 12 * * *",
    JdCustomerServiceDishwasher2026: "30 12 * * *",
  };
  for (const store of jdCustomerServiceStores) {
    const rule = rules.find(rule => rule.workflowId === store.workflowId);
    assert.deepEqual(rule?.entityKeys, [store.storeKey]);
    assert.deepEqual(rule?.schedules, [liveSchedule[store.workflowId]]);
  }
  assert.match(scheduleErrorLabel("provider_subscription_invalid"), /订阅.*密钥.*权限/);
  assert.match(scheduleErrorLabel("provider_error"), /模型服务拒绝/);
});

test("every chain's entities run at a unique time of day, and the definition file agrees with the generated directory", async () => {
  const { buildImportChainCatalog } = await import("../tools/build-import-chain-catalog.mjs");
  const rebuilt = await buildImportChainCatalog();
  for (const chainKey of new Set(catalog.rules.map(rule => rule.chainKey))) {
    const rulesInChain = catalog.rules.filter(rule => rule.chainKey === chainKey);
    const rebuiltInChain = rebuilt.rules.filter((rule: { chainKey: string }) => rule.chainKey === chainKey);
    const timesOfDay = rulesInChain.map(rule => rule.schedules.join(","));
    // A regex over cron strings cannot tell "10 12" from "12 10"; compare the full
    // generated-vs-rebuilt schedule arrays per workflow instead of a scraped count.
    assert.equal(new Set(timesOfDay).size, timesOfDay.length,
      `${chainKey} 下存在重复调度时点: ${JSON.stringify(timesOfDay)}`);
    for (const rule of rulesInChain) {
      const rebuiltRule = rebuiltInChain.find((candidate: { workflowId: string }) => candidate.workflowId === rule.workflowId);
      assert.ok(rebuiltRule, `${rule.workflowId} 在重新生成的目录中缺失`);
      assert.deepEqual(rule.schedules, rebuiltRule!.schedules,
        `${rule.workflowId} 的 lib/imports/chain-catalog.generated.json 与 automation/n8n 定义文件不一致`);
    }
  }
  // Cross-check with an independent per-source read, so a stale generated file
  // that merely echoes its own prior (wrong) output cannot pass silently.
  for (const [workflowId, fileName, expectedCron] of [
    ["JdCustomerService2026", "jd-customer-service-daily.workflow.json", "10 13 * * *"],
    ["JdCustomerServiceCutMeat2026", "jd-customer-service-cut-meat-daily.candidate.workflow.json", "10 12 * * *"],
    ["JdCustomerServiceChudian2026", "jd-customer-service-chudian-daily.candidate.workflow.json", "50 12 * * *"],
    ["JdCustomerServiceDishwasher2026", "jd-customer-service-dishwasher-daily.candidate.workflow.json", "30 12 * * *"],
  ]) {
    const definition = JSON.parse(await readFile(new URL(`../automation/n8n/${fileName}`, import.meta.url), "utf8"));
    assert.equal(definition.id, workflowId);
    const trigger = definition.nodes.find((node: { type: string }) => node.type === "n8n-nodes-base.scheduleTrigger");
    assert.equal(trigger.parameters.rule.interval[0].expression, expectedCron, fileName);
    const catalogRule = catalog.rules.find(rule => rule.workflowId === workflowId);
    assert.deepEqual(catalogRule?.schedules, [expectedCron], fileName);
  }
});
import { normalizeShellLocation } from "../app/shell/navigation-contract";

test("inventory workflows use department and owner rows without inventing sales-store bindings", () => {
  for (const [key, workflowId, schedule] of [
    ["jd_logistics", "JdLogisticsDaily2026", "50 8 * * *"],
    ["tmall_warehouse", "TmallWarehouseDaily2026", "20 8 * * *"],
  ]) {
    const rule = catalog.rules.find(rule => rule.workflowId === workflowId);
    assert.deepEqual(rule?.entityKeys, [key]);
    assert.deepEqual(rule?.schedules, [schedule]);
    assert.equal(catalog.rules.filter(rule => rule.chainKey === key).length, 1);
  }
});
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ImportChainRulesView from "../app/import-chain-rules-view";
import { completedAtLabel, formatChainStatusTime, todayStatusLabel, validateTodayStatus, type ChainTodayResponse } from "../lib/imports/chain-status";

test("in-flight, failed and unknown imports never acquire a green completed status", () => {
  for (const status of ["processing", "running", "pending", "queued", "rejected", "failed", "expired", "future_status", ""]) {
    assert.notEqual(importRunStatus(status, 0).tone, "success");
    assert.notEqual(importRunStatus(status, 3).tone, "success");
  }
  assert.equal(importRunStatus("completed").group, "completed");
  assert.equal(importRunStatus("completed", 3).group, "warning");
  assert.equal(importRunStatus("duplicate").group, "duplicate");
  assert.equal(importRunStatus("partial").group, "warning");
});

test("duration leaves missing, invalid and reversed timestamps unknown", () => {
  assert.equal(importRunDuration("2026-09-10T00:00:00Z", null), "—");
  assert.equal(importRunDuration("invalid", "invalid"), "—");
  assert.equal(importRunDuration("2026-09-10T00:01:00Z", "2026-09-10T00:00:00Z"), "—");
  assert.equal(importRunDuration("2026-09-10T00:00:00Z", "2026-09-10T00:01:20Z"), "1 分 20 秒");
});

test("removed continuity links normalize safely and chain links survive refresh", () => {
  assert.equal(normalizeShellLocation("/?module=import&view=continuity"), "/?module=import");
  assert.equal(normalizeShellLocation("/?module=import&view=chains"), "/?module=import&view=chains");
  assert.equal(normalizeShellLocation("/?module=import&view=history"), "/?module=import&view=history");
});

test("display catalog matches allowlisted workflow definitions without bundling operational configuration", async () => {
  const { buildImportChainCatalog, buildManualCompletionContracts } = await import("../tools/build-import-chain-catalog.mjs");
  const text = await readFile(new URL("../lib/imports/chain-catalog.generated.json", import.meta.url), "utf8");
  const catalog = JSON.parse(text);
  assert.deepEqual(catalog, await buildImportChainCatalog());
  const backend = JSON.parse(await readFile(new URL("../backend/workflow/import_chain_catalog.json", import.meta.url), "utf8"));
  assert.deepEqual(backend.workflowIds, catalog.rules.map((r: { workflowId: string }) => r.workflowId));
  assert.deepEqual(backend.manualCompletion, await buildManualCompletionContracts(catalog));
  assert.equal(new Set(catalog.rules.map((r: { workflowId: string }) => r.workflowId)).size, catalog.rules.length);
  const jdRule = catalog.rules.find((r: { chainKey: string }) => r.chainKey === "jd");
  assert.equal(jdRule?.workflowId, "JdN8nSilentCopy2026");
  assert.equal(catalog.rules.some((r: { workflowId: string }) => r.workflowId === "JdN8nM3uL7tI2026"), false);
  assert.doesNotMatch(text, /userDataDir|profileDir|debugPort|downloadDir|credentials|httpRequest|localhost:5791/);
  assert.doesNotMatch(text, /"active"|"lastRun"|"nextRun"/);
  const entities = new Set(catalog.entities.map((e: { key: string }) => e.key));
  for (const rule of catalog.rules) {
    assert.ok(rule.entityKeys.every((key: string) => entities.has(key)));
    assert.ok(catalog.chains.some((c: { key: string }) => c.key === rule.chainKey));
  }
});

test("matrix renders workflows across columns and shops down rows", () => {
  const html = renderToStaticMarkup(createElement(ImportChainRulesView, { currentUser: null }));
  const head = html.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] || "";
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || "";
  assert.match(head, /n8n 工作流/);
  assert.match(head, /京东 · 商品数据/);
  assert.match(head, /京东 · 入仓库存/);
  assert.match(head, /天猫 · 入仓库存/);
  assert.match(body, /京东入仓监控（事业部）/);
  assert.match(body, /天猫入仓监控（货主）/);
  assert.doesNotMatch(head, /志高商用设备旗舰店/);
  assert.match(body, /<th scope="row"><strong>志高商用设备旗舰店/);
  assert.match(body, /读取今天状态/);
  assert.match(html, /统计定时、自动重试及已核验的完整手动补跑成功/);
  assert.doesNotMatch(html, /只统计自动触发|手动调试不计入今天完成/);
});

test("today status rejects impossible completion and shows later failure distinctly", () => {
  assert.equal(formatChainStatusTime("2026-09-09T16:30:00+00:00"), "09/10 00:30");
  const item = { workflowId: "test", active: true, state: "failed" as const, completedToday: true, completedAt: "2026-09-10T01:00:00Z", executionId: "1", startedAt: null, finishedAt: null };
  const response: ChainTodayResponse = { date: "2026-09-10", timezone: "Asia/Shanghai", checkedAt: "2026-09-10T02:00:00Z", source: "n8n_execution_metadata", items: [item] };
  assert.equal(validateTodayStatus(response), true);
  assert.equal(todayStatusLabel(item).tone, "danger");
  assert.equal(todayStatusLabel(item).label, "最近自动执行失败");
  assert.equal(todayStatusLabel().label, "今天：无法核实");
  assert.equal(validateTodayStatus({ ...response, items: [{ ...item, state: "completed", completedAt: null }] }), false);
  assert.equal(validateTodayStatus({ ...response, items: [item, item] }), false);
});

test("today status distinguishes scheduled completion from an automatic retry", () => {
  const base = { workflowId: "test", active: true, state: "completed" as const, completedToday: true,
    completedAt: "2026-09-10T01:00:00Z", executionId: "1", startedAt: "2026-09-10T00:00:00Z", finishedAt: "2026-09-10T01:00:00Z" };
  const scheduled = { ...base, completedMode: "trigger" as const, executionMode: "trigger" as const };
  const retried = { ...base, completedMode: "webhook" as const, executionMode: "webhook" as const };
  assert.equal(todayStatusLabel(scheduled).label, "今天定时已完成");
  assert.equal(completedAtLabel(scheduled), "今日定时完成于");
  assert.equal(todayStatusLabel(retried).label, "今天重试已完成");
  assert.equal(completedAtLabel(retried), "今日重试完成于");
  const manual = { ...base, completedMode: "manual" as const, executionMode: "manual" as const };
  assert.equal(todayStatusLabel(manual).label, "今日手动补跑已完成");
  assert.equal(completedAtLabel(manual), "今日手动补跑完成于");
  const response: ChainTodayResponse = { date: "2026-09-10", timezone: "Asia/Shanghai", checkedAt: "2026-09-10T02:00:00Z", source: "n8n_execution_metadata", items: [manual] };
  assert.equal(validateTodayStatus(response), true);
  assert.equal(validateTodayStatus({ ...response, items: [{ ...manual, state: "running" }] }), false);
  assert.equal(validateTodayStatus({ ...response, items: [{ ...manual, completedMode: "trigger" }] }), false);
});
