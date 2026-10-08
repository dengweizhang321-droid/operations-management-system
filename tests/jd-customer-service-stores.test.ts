import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import type { Page } from "playwright-core";
import { customerServiceStore, customerServiceStoreContextError, jdCustomerServiceStores, resolveCustomerServiceImportShop } from "../lib/jd/customer-service-stores";
import { customerServicePeriod } from "../lib/jd/customer-service-workflow";
import { assertCustomerServicePlanStore, planCustomerServiceRun, publicCustomerServicePlan, runCustomerServicePlan } from "../tools/jd-customer-service-n8n-pipeline";
import { assertCustomerServiceShop } from "../tools/jd-customer-service-export";
import { buildCustomerServiceDailyFiles } from "../tools/jd-customer-service-daily-files";
import { importCustomerServiceDay, verifyCustomerServiceBatch } from "../tools/jd-customer-service-import";

test("四店身份精确匹配原注册表，缺省仅兼容设备店，未知/重复头不回退", async () => {
  const registry = JSON.parse(await readFile(new URL("../config/jd-store-accounts.json", import.meta.url), "utf8"));
  for (const store of jdCustomerServiceStores) {
    const actual = registry.stores.filter((item: {storeKey: string}) => item.storeKey === store.storeKey);
    assert.equal(actual.length, 1);
    assert.equal(actual[0].shopId, store.shopId);
    assert.equal(actual[0].shopName, store.shopName);
    for (const other of jdCustomerServiceStores) {
      assert.equal(customerServiceStoreContextError(store.storeKey, other.storeKey) === null, store === other);
    }
  }
  assert.equal(customerServiceStore().storeKey, jdCustomerServiceStores[0].storeKey);
  assert.ok(customerServiceStoreContextError(undefined, jdCustomerServiceStores[1].storeKey));
  for (const value of [null, "", "../other", "unknown", [jdCustomerServiceStores[0].storeKey]]) {
    assert.throws(() => customerServiceStore(value));
    assert.ok(customerServiceStoreContextError(value));
  }
});

test("同execution四店状态隔离；同店并发及跨日未决计划都不可覆盖", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jd-cs-stores-"));
  const now = new Date("2026-10-08T01:00:00Z");
  try {
    const plans = await Promise.all(jdCustomerServiceStores.map(store => planCustomerServiceRun(root, "shared-fixture", now, store.storeKey)));
    for (const [index, store] of jdCustomerServiceStores.entries()) {
      const dir = path.join(root, "outputs/jd-customer-service-pipeline", index === 0 ? "" : store.storeKey);
      const saved = JSON.parse(await readFile(path.join(dir, "shared-fixture.json"), "utf8"));
      assert.equal(saved.storeKey, store.storeKey);
      assert.deepEqual(saved.period, plans[0].period);
      assert.equal(publicCustomerServicePlan(plans[index]).shopName, store.shopName);
      await assert.rejects(planCustomerServiceRun(root, "later", new Date("2026-10-09T01:00:00Z"), store.storeKey), /UNRESOLVED/);
    }
    const store = jdCustomerServiceStores[1];
    const dir = path.join(root, "outputs/jd-customer-service-pipeline", store.storeKey);
    const completed = { ...plans[1], stage: "completed" };
    await writeFile(path.join(dir, "shared-fixture.json"), JSON.stringify(completed));
    const race = await Promise.allSettled(["race-a", "race-b"].map(id => planCustomerServiceRun(root, id, now, store.storeKey)));
    assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(race.filter(result => result.status === "rejected").length, 1);
    // A completed plan for another shop is still invalid in this shop's state.
    const winner = race.find(result => result.status === "fulfilled");
    assert.ok(winner?.status === "fulfilled");
    await writeFile(path.join(dir, `${winner.value.executionId}.json`), JSON.stringify({ ...winner.value, storeKey: plans[2].storeKey, shopName: plans[2].shopName, shopId: plans[2].shopId, stage: "completed" }));
    await assert.rejects(planCustomerServiceRun(root, "tampered", now, store.storeKey), /PLAN_STORE_IDENTITY/);
    await assert.rejects(runCustomerServicePlan(root, { ...plans[1], shopId: plans[2].shopId }), /PLAN_STORE_IDENTITY/);
    assert.throws(() => assertCustomerServicePlanStore(plans[1], plans[2].storeKey), /PLAN_STORE_IDENTITY/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("客服页头必须是选定店铺，另一注册店铺也必须失败关闭", async () => {
  for (const expected of jdCustomerServiceStores) for (const actual of jdCustomerServiceStores) {
    const header = { filter() { return this; }, waitFor: async () => {}, count: async () => 1,
      getAttribute: async () => actual.shopName, innerText: async () => actual.shopName };
    const page = { url: () => "https://shop.jd.com/jdm/kefu/kf-manage-lite/#/UtilsSetting/ChatLog", locator: () => header } as unknown as Page;
    if (expected === actual) await assertCustomerServiceShop(page, false, expected.storeKey);
    else await assert.rejects(assertCustomerServiceShop(page, false, expected.storeKey), /IDENTITY_MISMATCH/);
  }
});

test("共用客服名称不改写显式店铺；每店导入及精确回查拒绝跨店回执", async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["咨询时间", "客服", "顾客", "cid"], ["2026-10-07 10:00:00", "志高厨电-合成", "synthetic", "fixture"],
  ]), "会话");
  const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
  const log = new TextEncoder().encode("/*****************以下为一通会话************************************/\nsynthetic 2026-10-07 10:00:00\n合成内容\n");
  const period = customerServicePeriod(new Date("2026-10-08T01:00:00Z"));
  assert.throws(() => resolveCustomerServiceImportShop("旧交互店铺", undefined), /STORE_REQUIRED/);
  for (const store of jdCustomerServiceStores) {
    assert.equal(resolveCustomerServiceImportShop(store.shopName, store.storeKey), store.shopName);
    assert.throws(() => resolveCustomerServiceImportShop("另一店铺", store.storeKey));
    const day = buildCustomerServiceDailyFiles(bytes, log, period, store.storeKey).files[0];
    const batch = { id: `cs_${"a".repeat(64)}`, fileHash: "b".repeat(64), shopName: store.shopName,
      status: "completed", completedAt: "2026-10-08T01:00:00Z", conversationCount: day.conversationCount,
      matchedCount: day.summary.matchedCount + day.summary.timeOnlyMatchedCount, sessionOnlyCount: day.summary.sessionOnlyCount,
      chatOnlyCount: day.summary.chatOnlyCount, ambiguousCount: day.summary.ambiguousCount, warningTotalCount: 0 };
    let calls = 0;
    const request = (async (_url, init) => {
      calls++;
      const form = init?.body as FormData;
      assert.equal(form.get("storeKey"), store.storeKey);
      assert.equal(resolveCustomerServiceImportShop(String(form.get("shopName")), form.get("storeKey")), store.shopName);
      return Response.json({ ok: true, status: "imported", batch }, { status: 201 });
    }) as typeof fetch;
    const proof = await importCustomerServiceDay(day, "http://localhost:3000", request, store.storeKey);
    assert.equal(calls, 1);
    const history = (shopName: string) => (async () => Response.json({ items: [{ ...batch, shopName }],
      pagination: { page: 1, pageSize: 100, total: 1, returned: 1, truncated: false } })) as typeof fetch;
    await verifyCustomerServiceBatch(proof, "http://localhost:3000", history(store.shopName), store.storeKey);
    for (const other of jdCustomerServiceStores.filter(item => item !== store)) {
      await assert.rejects(verifyCustomerServiceBatch(proof, "http://localhost:3000", history(other.shopName), store.storeKey), /IDENTITY_MISMATCH/);
      await assert.rejects(verifyCustomerServiceBatch(proof, "http://localhost:3000", history(other.shopName), other.storeKey), /IDENTITY_MISMATCH/);
    }
    await assert.rejects(importCustomerServiceDay(day, "http://localhost:3000", (async () => Response.json({ ok: true, status: "imported", batch: { ...batch, shopName: "wrong" } }, { status: 201 })) as typeof fetch, store.storeKey), /IDENTITY_MISMATCH/);
  }
});

test("三份新增n8n定义与设备店逐节点同条件，仅更换身份、名称、ID和采用说明", async () => {
  const load = async (file: string) => JSON.parse(await readFile(new URL(`../automation/n8n/${file}`, import.meta.url), "utf8"));
  const baseline = await load("jd-customer-service-daily.workflow.json");
  const ids = new Set([baseline.id]);
  for (const store of jdCustomerServiceStores.slice(1)) {
    const flow = await load(`${store.fileStem}.candidate.workflow.json`);
    assert.equal(flow.id, store.workflowId);
    assert.ok(!ids.has(flow.id)); ids.add(flow.id);
    assert.equal(flow.active, false);
    assert.deepEqual(flow.settings, baseline.settings);
    assert.deepEqual(flow.connections, baseline.connections);
    assert.equal(flow.nodes.length, baseline.nodes.length);
    for (let i = 0; i < flow.nodes.length; i++) {
      const actual = structuredClone(flow.nodes[i]); const expected = structuredClone(baseline.nodes[i]);
      assert.notEqual(actual.id, expected.id); delete actual.id; delete expected.id;
      if (actual.type === "n8n-nodes-base.stickyNote") continue;
      if (actual.type === "n8n-nodes-base.httpRequest") {
        const headers = actual.parameters.headerParameters.parameters;
        assert.deepEqual(headers.pop(), { name: "X-TERUISI-JD-CUSTOMER-SERVICE-STORE-KEY", value: store.storeKey });
      }
      assert.deepEqual(actual, expected);
    }
  }
});
