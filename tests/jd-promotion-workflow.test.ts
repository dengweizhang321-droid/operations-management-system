import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  inspectJdPromotionCsv,
  jdPromotionReportPrefix,
  selectJdPromotionDownloadTask,
  validateJdPromotionImportProof,
  type JdPromotionDownloadTask,
} from "../lib/jd/promotion-report";
import type { JdStore } from "../lib/jd/store-registry";
import { parseJdPromotionArgs, type JdPromotionExportResult } from "../tools/jd-promotion-export";
import {
  jdPromotionHelperRequestError,
  parseJdPromotionStoreKeyHeader,
  planJdPromotionN8nRun,
  runJdPromotionN8nPlan,
  verifyJdPromotionN8nPlan,
} from "../tools/jd-promotion-n8n-pipeline";

const csvText = [
  "日期,跟单SKU ID,产品线,账户昵称,展现数,点击数,花费,总订单行,总订单金额",
  "20260813,1001,商智,志高亿用-小燕,10,2,3.25,1,998.75",
  "20260814,1002,商智,志高亿用-小燕,20,3,4.50,0,0",
].join("\r\n");

function bytes(text = csvText) {
  return new TextEncoder().encode(text);
}

function store(storeKey: "jd-yiyong-director" | "jd-maidehao-operator1" = "jd-yiyong-director"): JdStore {
  const cutMeat = storeKey === "jd-maidehao-operator1";
  return {
    storeKey,
    accountLabel: cutMeat ? "志高迈德豪-运营1" : "志高亿用-总监",
    platform: "京东",
    shopName: cutMeat ? "志高切肉机旗舰店" : "志高商用设备旗舰店",
    shopId: cutMeat ? "745866" : "701455",
    enabled: true,
    browser: {
      executablePath: "unused/chromium.exe",
      userDataDir: "unused/user-data",
      profileName: cutMeat ? "Profile 2" : "Default",
      profileDir: cutMeat ? "unused/user-data/Profile 2" : "unused/user-data/Default",
      debugPort: cutMeat ? 9226 : 9224,
      downloadDir: cutMeat ? "unused/cut-meat-downloads" : "unused/downloads",
    },
  };
}

function importPayload(hash: string) {
  return {
    ok: true,
    status: "imported",
    batch: {
      id: "batch-13-14",
      status: "completed",
      source: "jd_promotion",
      dataset: "ad",
      platform: "京东",
      shopName: "志高商用设备旗舰店",
      rowCount: 2,
      warningCount: 0,
      dateMin: "2026-08-13",
      dateMax: "2026-08-14",
      totals: { rawFileHash: hash },
    },
    verification: {
      verified: true,
      readbackRowCount: 2,
      dateMin: "2026-08-13",
      dateMax: "2026-08-14",
      shopName: "志高商用设备旗舰店",
    },
  };
}

test("京准通 CSV 必须完整覆盖精确日期范围并重算关键汇总", () => {
  const inspection = inspectJdPromotionCsv(bytes(), "2026-08-13", "2026-08-14");
  assert.deepEqual({
    rowCount: inspection.rowCount,
    columnCount: inspection.columnCount,
    dateMin: inspection.dateMin,
    dateMax: inspection.dateMax,
    accountNicknames: inspection.accountNicknames,
    uniqueSkuCount: inspection.uniqueSkuCount,
    impressions: inspection.impressions,
    clicks: inspection.clicks,
    spendYuan: inspection.spendYuan,
    totalOrders: inspection.totalOrders,
    totalOrderAmountYuan: inspection.totalOrderAmountYuan,
  }, {
    rowCount: 2,
    columnCount: 9,
    dateMin: "2026-08-13",
    dateMax: "2026-08-14",
    accountNicknames: ["志高亿用-小燕"],
    uniqueSkuCount: 2,
    impressions: 30,
    clicks: 5,
    spendYuan: 7.75,
    totalOrders: 1,
    totalOrderAmountYuan: 998.75,
  });
  assert.rejects(Promise.resolve().then(() => inspectJdPromotionCsv(bytes(csvText.split("\r\n").slice(0, 2).join("\r\n")), "2026-08-13", "2026-08-14")), /必须完整覆盖/);
  assert.throws(() => inspectJdPromotionCsv(bytes(), "2026-08-14", "2026-08-14"), /必须完整覆盖/);
});

test("京准通下载中心只接管唯一、精确范围且不在 baseline 中的任务", () => {
  const prefix = jdPromotionReportPrefix("志高亿用-总监", "2026-08-13", "2026-08-14");
  assert.equal(prefix, "志高亿用-总监_AI推广数据自动下载_20260813_20260814");
  const task: JdPromotionDownloadTask = {
    fingerprint: "task-1",
    reportName: `${prefix}_2026年08月15日18时07分23秒下载`,
    status: "报表已生成",
    startDate: "2026-08-13",
    endDate: "2026-08-14",
    createdAt: "2026-08-15 18:07:23",
  };
  assert.equal(selectJdPromotionDownloadTask([task], prefix, task.startDate, task.endDate), task);
  assert.equal(selectJdPromotionDownloadTask([task], prefix, task.startDate, task.endDate, new Set([task.fingerprint])), null);
  assert.throws(() => selectJdPromotionDownloadTask([task, { ...task, fingerprint: "task-2" }], prefix, task.startDate, task.endDate), /多个本轮候选任务/);
});

test("京准通导入证明必须绑定精确店铺、日期、行数、原文件哈希和零告警", () => {
  const inspection = inspectJdPromotionCsv(bytes(), "2026-08-13", "2026-08-14");
  const proof = validateJdPromotionImportProof({
    payload: importPayload(inspection.sha256),
    shopName: store().shopName,
    startDate: inspection.dateMin,
    endDate: inspection.dateMax,
    rowCount: inspection.rowCount,
    rawFileHash: inspection.sha256,
  });
  assert.equal(proof.batchId, "batch-13-14");
  assert.throws(() => validateJdPromotionImportProof({
    payload: importPayload("wrong-hash"),
    shopName: store().shopName,
    startDate: inspection.dateMin,
    endDate: inspection.dateMax,
    rowCount: inspection.rowCount,
    rawFileHash: inspection.sha256,
  }), /缺少精确批次/);
});

test("京准通命令行默认使用上海昨天，并接受同月显式范围", () => {
  const now = new Date("2026-08-15T03:00:00+08:00");
  const daily = parseJdPromotionArgs([], now);
  assert.deepEqual([daily.storeKey, daily.startDate, daily.endDate], ["jd-yiyong-director", "2026-08-14", "2026-08-14"]);
  const range = parseJdPromotionArgs(["--start-date", "2026-08-13", "--end-date", "2026-08-14", "--run-id", "range-13-14"], now);
  assert.deepEqual([range.startDate, range.endDate, range.runId], ["2026-08-13", "2026-08-14", "range-13-14"]);
  assert.throws(() => parseJdPromotionArgs(["--start-date", "2026-07-31", "--end-date", "2026-08-01"], now), /同一自然月/);
});

test("京准通 helper 绑定同一 execution 并拒绝空、跨执行、并发和乱序请求", () => {
  assert.equal(jdPromotionHelperRequestError("ready", false, "/jd-promotion/plan", "execution-1", null), null);
  assert.deepEqual(jdPromotionHelperRequestError("ready", false, "/jd-promotion/run", "execution-1", null), { error: "execution_not_claimed", expected: "/jd-promotion/plan" });
  assert.deepEqual(jdPromotionHelperRequestError("planned", false, "/jd-promotion/run", "other", "execution-1"), { error: "execution_mismatch" });
  assert.deepEqual(jdPromotionHelperRequestError("planned", true, "/jd-promotion/run", "execution-1", "execution-1"), { error: "pipeline_busy" });
  assert.deepEqual(jdPromotionHelperRequestError("planned", false, "/jd-promotion/verify", "execution-1", "execution-1"), { error: "invalid_stage", expected: "executed", actual: "planned" });
  assert.deepEqual(jdPromotionHelperRequestError("ready", false, "/jd-promotion/plan", null, null), { error: "missing_or_invalid_execution_id" });
});

test("京准通 n8n 店铺请求头只接受两条显式推广白名单", () => {
  assert.throws(() => parseJdPromotionStoreKeyHeader(undefined), /店铺请求头无效/);
  assert.equal(parseJdPromotionStoreKeyHeader("jd-yiyong-director"), "jd-yiyong-director");
  assert.equal(parseJdPromotionStoreKeyHeader("jd-maidehao-operator1"), "jd-maidehao-operator1");
  assert.throws(() => parseJdPromotionStoreKeyHeader("jd-chudian-weizhang"), /不在推广工作流白名单/);
  assert.throws(() => parseJdPromotionStoreKeyHeader(["jd-maidehao-operator1"]), /店铺请求头无效/);
});

test("京准通 n8n 计划拒绝店铺对象与请求头跨店错配", async () => {
  await assert.rejects(() => planJdPromotionN8nRun({
    executionId: "mismatched-store",
    storeKey: "jd-yiyong-director",
    store: store("jd-maidehao-operator1"),
  }), /店铺对象与受控请求头不一致/);
});

test("京准通 n8n 计划把切肉机店铺、Profile 2 和 8月13日至14日固化在同一计划", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jd-promotion-cut-meat-plan-"));
  const targetStore = store("jd-maidehao-operator1");
  const plan = await planJdPromotionN8nRun({
    root,
    baseUrl: "http://localhost:3000",
    executionId: "cut-meat-execution",
    storeKey: targetStore.storeKey,
    startDate: "2026-08-13",
    endDate: "2026-08-14",
    store: targetStore,
    request: async () => new Response("ok"),
    profileStatus: async (stores) => {
      assert.deepEqual(stores.map((item) => [item.storeKey, item.browser.profileName]), [["jd-maidehao-operator1", "Profile 2"]]);
      return "ready";
    },
    runIdFactory: () => "jd-promotion-cut-meat-13-14",
  });
  assert.deepEqual(plan.store, {
    storeKey: "jd-maidehao-operator1",
    shopId: "745866",
    shopName: "志高切肉机旗舰店",
    accountLabel: "志高迈德豪-运营1",
  });
  assert.deepEqual([plan.startDate, plan.endDate, plan.stage], ["2026-08-13", "2026-08-14", "planned"]);
});

test("京准通 n8n A/B/C 固化 8月13日至14日并独立复验文件和已发布批次", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jd-promotion-n8n-"));
  const targetStore = store();
  const savedPath = path.join(root, "promotion.csv");
  await writeFile(savedPath, bytes());
  const inspection = inspectJdPromotionCsv(bytes(), "2026-08-13", "2026-08-14");
  const importResult = validateJdPromotionImportProof({
    payload: importPayload(inspection.sha256),
    shopName: targetStore.shopName,
    startDate: inspection.dateMin,
    endDate: inspection.dateMax,
    rowCount: inspection.rowCount,
    rawFileHash: inspection.sha256,
  });
  const plan = await planJdPromotionN8nRun({
    root,
    now: new Date("2026-08-15T03:00:00+08:00"),
    baseUrl: "http://localhost:3000",
    executionId: "execution-13-14",
    startDate: "2026-08-13",
    endDate: "2026-08-14",
    store: targetStore,
    request: async () => new Response("ok"),
    profileStatus: async () => "ready",
    runIdFactory: () => "jd-promotion-13-14",
  });
  assert.deepEqual([plan.store.storeKey, plan.startDate, plan.endDate, plan.stage], ["jd-yiyong-director", "2026-08-13", "2026-08-14", "planned"]);
  const result: JdPromotionExportResult = {
    ok: true,
    runId: plan.runId,
    storeKey: targetStore.storeKey,
    shopName: targetStore.shopName,
    startDate: plan.startDate,
    endDate: plan.endDate,
    reportName: "受控报表",
    taskCreatedAt: "2026-08-15 18:07:23",
    savedPath,
    fileSizeBytes: bytes().byteLength,
    sha256: inspection.sha256,
    rowCount: inspection.rowCount,
    accountNicknames: inspection.accountNicknames,
    productLines: inspection.productLines,
    impressions: inspection.impressions,
    clicks: inspection.clicks,
    spendYuan: inspection.spendYuan,
    totalOrders: inspection.totalOrders,
    totalOrderAmountYuan: inspection.totalOrderAmountYuan,
    importResult,
  };
  await runJdPromotionN8nPlan(plan, { root, store: targetStore, run: async () => result });
  assert.equal(plan.stage, "executed");
  const request: typeof fetch = async () => Response.json({
    items: [{
      id: importResult.batchId,
      status: "completed",
      source: "jd_promotion",
      dataset: "ad",
      platform: "京东",
      shopName: targetStore.shopName,
      warningCount: 0,
      rowCount: inspection.rowCount,
      dateMin: inspection.dateMin,
      dateMax: inspection.dateMax,
      totals: { rawFileHash: inspection.sha256 },
    }],
  });
  const verified = await verifyJdPromotionN8nPlan(plan, { root, store: targetStore, request });
  assert.deepEqual([verified.stage, verified.rowCount, plan.stage], ["verify", 2, "completed"]);
});

test("京准通 n8n 模板保持未激活并以同一 execution ID 串联三段环回请求", async () => {
  const workflow = JSON.parse(await readFile(new URL("../automation/n8n/jd-promotion-daily.workflow.json", import.meta.url), "utf8")) as {
    active: boolean;
    settings?: { timezone?: string };
    nodes: Array<{ type: string; parameters?: { url?: string; rule?: { interval?: Array<{ expression?: string }> }; headerParameters?: { parameters?: Array<{ name?: string; value?: string }> } } }>;
  };
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings?.timezone, "Asia/Shanghai");
  assert.equal(workflow.nodes.find((node) => node.type === "n8n-nodes-base.scheduleTrigger")?.parameters?.rule?.interval?.[0]?.expression, "30 10 * * *");
  const requests = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");
  assert.deepEqual(requests.map((node) => node.parameters?.url), [
    "http://127.0.0.1:5791/jd-promotion/plan",
    "http://127.0.0.1:5791/jd-promotion/run",
    "http://127.0.0.1:5791/jd-promotion/verify",
  ]);
  for (const request of requests) {
    assert.deepEqual(request.parameters?.headerParameters?.parameters?.[0], { name: "X-TERUISI-N8N-EXECUTION-ID", value: "={{ $execution.id }}" });
  }
  assert.deepEqual(requests[0]?.parameters?.headerParameters?.parameters?.[1], { name: "X-TERUISI-JD-PROMOTION-STORE-KEY", value: "jd-yiyong-director" });
});

test("切肉机京准通 n8n 模板固定 Profile 2 店铺和 2026年8月13日至14日且保持未激活", async () => {
  const workflow = JSON.parse(await readFile(new URL("../automation/n8n/jd-promotion-cut-meat-20260813-14.workflow.json", import.meta.url), "utf8")) as {
    id: string;
    active: boolean;
    settings?: { timezone?: string };
    nodes: Array<{ type: string; parameters?: { url?: string; assignments?: { assignments?: Array<{ name?: string; value?: string }> }; headerParameters?: { parameters?: Array<{ name?: string; value?: string }> } } }>;
  };
  assert.equal(workflow.id, "JdPromotionCutMeat2026");
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings?.timezone, "Asia/Shanghai");
  assert.equal(workflow.nodes.some((node) => node.type === "n8n-nodes-base.scheduleTrigger"), false);
  const dates = workflow.nodes.find((node) => node.type === "n8n-nodes-base.set")?.parameters?.assignments?.assignments;
  assert.deepEqual(dates?.map((item) => [item.name, item.value]), [["startDate", "2026-08-13"], ["endDate", "2026-08-14"]]);
  const requests = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");
  assert.deepEqual(requests.map((node) => node.parameters?.url), [
    "http://127.0.0.1:5791/jd-promotion-cut-meat/plan",
    "http://127.0.0.1:5791/jd-promotion/run",
    "http://127.0.0.1:5791/jd-promotion/verify",
  ]);
  assert.deepEqual(requests[0]?.parameters?.headerParameters?.parameters, [
    { name: "X-TERUISI-N8N-EXECUTION-ID", value: "={{ $execution.id }}" },
    { name: "X-TERUISI-JD-PROMOTION-STORE-KEY", value: "jd-maidehao-operator1" },
    { name: "X-TERUISI-JD-PROMOTION-START-DATE", value: "={{ $json.startDate }}" },
    { name: "X-TERUISI-JD-PROMOTION-END-DATE", value: "={{ $json.endDate }}" },
  ]);
});
