import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createXlsxWorkbookBytes } from "../lib/imports/xlsx-write";
import { jackyunModuleOrder, type JackyunModule } from "../lib/jackyun/post-download";
import { assertJackyunHistoricalSnapshotEvidence, assertJackyunSnapshotEvidence,
  jackyunExportFirstPolicyVersion, jackyunExportOrder, type JackyunCurrentSnapshotEvidence } from "../lib/jackyun/run-contract";
import { jackyunDjangoImportReceipt } from "../lib/jackyun/django-import-receipt";
import { writeJsonAtomic } from "../lib/jackyun/json-file";
import { runJackyunExportFirstAction, type ExportFirstDependencies } from "../tools/jackyun-export-first-pipeline";
import { stableRowCount, type QueryRefreshTracking } from "../tools/jackyun-browser-controller";
import { runApiExports } from "../tools/jackyun-api-export";
import type { ApiTemplates } from "../lib/jackyun/api-plan";
import type { JackyunHttpSession } from "../lib/jackyun/direct-http";
import type { BrowserAutomationClient } from "../lib/jackyun/cdp-client";

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 6, 1, 0, seconds)).toISOString();
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const counts = { products: 5000, inventory: 20000, inventory_age: 4000, combos: 1000, sales: 1 };
function workbook(module: JackyunModule) {
  const rows = Array.from({ length: counts[module] }, (_, i) => {
    if (module === "inventory") return [`SKU-${i}`, "测试货品", "标准", "台", "测试仓", 10, 2];
    if (module === "inventory_age") return ["测试仓", `SKU-${i}`, "测试货品", 2, 7];
    if (module === "products") return [`SKU-${i}`, "测试货品", 10, "台"];
    return [`COMBO-${i}`, "测试组合装"];
  });
  const headers = { inventory: ["货品编号", "货品名称", "规格", "单位", "仓库", "固定成本价", "库存数量"],
    inventory_age: ["仓库", "货品编号", "货品名称", "库存数量", "库龄(天)"],
    products: ["货品编号", "货品名称", "固定成本价", "基础单位"], combos: ["货品编号", "货品名称"], sales: ["订单编号"] };
  const sheets = [{ name: "数据", rows: [headers[module], ...rows] }];
  if (module === "combos") sheets.push({ name: "子件", rows: [["母件编号", "编号", "名称", "数量"],
    ...rows.flatMap((row, index) => [[row[0], `SKU-${index}`, "测试子件", 1], [row[0], `SKU-B-${index}`, "另一子件", 2]])] });
  return createXlsxWorkbookBytes(sheets);
}
const currentEvidence: JackyunCurrentSnapshotEvidence = { version: 1, module: "inventory", runId: "test-run",
  source: "current_query", targetDate: "2026-09-06", queryIntentAt: at(2), queryRefreshSource: "module_network_request",
  queryRefreshCompletedAt: at(3), tableStableAt: at(4) };
test("live captures cannot claim yesterday, cross midnight, or enter the historical protocol", () => {
  const expected = { module: "inventory" as const, runId: "test-run", snapshotDate: "2026-09-06", policyVersion: jackyunExportFirstPolicyVersion,
    navigationIntentAt: at(1), exportIntentAt: at(5) };
  assert.doesNotThrow(() => assertJackyunSnapshotEvidence(currentEvidence, expected));
  assert.throws(() => assertJackyunSnapshotEvidence(currentEvidence, { ...expected, snapshotDate: "2026-09-05" }));
  assert.throws(() => assertJackyunSnapshotEvidence({ ...currentEvidence, tableStableAt: "2026-09-06T16:00:01Z" }, expected));
  assert.throws(() => assertJackyunHistoricalSnapshotEvidence(currentEvidence, expected));
  assert.throws(() => assertJackyunSnapshotEvidence(currentEvidence, { ...expected, policyVersion: "2026-08-06.2" }));
  assert.throws(() => assertJackyunSnapshotEvidence({ ...currentEvidence, module: "inventory_age" }, expected));
});
test("Django returned content batches support a duplicate with different XLSX bytes", () => {
  const incoming = "a".repeat(64);
  const response = { ok: true, status: "duplicate", batch: { id: `products:${"b".repeat(64)}`, sourceKey: "products",
    status: "completed", totals: { rawFileHash: "c".repeat(64), contentHash: "d".repeat(64) } } };
  const receipt = jackyunDjangoImportReceipt("products", incoming, response);
  assert.equal(receipt.batchId, response.batch.id);
  assert.equal(receipt.inputSha256, incoming);
  assert.throws(() => jackyunDjangoImportReceipt("combos", incoming, response));
  assert.throws(() => jackyunDjangoImportReceipt("products", incoming, { ...response, status: "imported" }));
  assert.throws(() => jackyunDjangoImportReceipt("products", incoming, { ...response, batch: { ...response.batch, totals: {} } }));
});
test("current inventory still requires a completed module network query", async () => {
  const tracking: QueryRefreshTracking = { token: "test-query", module: "inventory", queryIntentAt: at(1), currentCapture: true,
    pageProbeArmed: true, pageStartedAt: at(2), pageCompletedAt: at(3) };
  const client = { send: async () => ({ result: { value: { text: "共 20000 条", gridTotals: [20000], anyGridLoading: false, probes: [] } } }) } as unknown as BrowserAutomationClient;
  const policy = { browser: { tableStableTimeoutMs: 1000, pageTimeoutMs: 1000, stableSamples: 2, pollIntervalMs: 1, fastPollIntervalMs: 1 } } as Parameters<typeof stableRowCount>[1];
  await assert.rejects(stableRowCount(client, policy, [], tracking));
  tracking.networkStartedAt = at(2); tracking.networkCompletedAt = at(3);
  assert.equal(await stableRowCount(client, policy, [], tracking), 20000);
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-export-first-"));
  const downloadDirectory = path.join(root, "downloads");
  await mkdir(path.join(root, "config"));
  await writeJsonAtomic(path.join(root, "config", "jackyun-export-first-policy.json"), {
    version: jackyunExportFirstPolicyVersion,
    browser: { downloadDirectory, allowedDownloadHosts: [], controller: { profileDirectory: path.join(root, "profile") } },
  });
  const calls: string[] = [];
  const files = new Map<JackyunModule, string>();
  const deps: ExportFirstDependencies = { root, lockDirectory: path.join(root, ".runtime", "test.lock"),
    now: () => new Date(at(0)), profileReady: async () => true,
    request: async () => new Response("{}", { status: 200 }),
    runBrowser: async options => {
      const moduleKey = options.exportOnlyModule!;
      calls.push(`export:${moduleKey}`);
      const bytes = workbook(moduleKey);
      const filePath = path.join(downloadDirectory, "jackyun", options.runId, moduleKey, "12345678.xlsx");
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, bytes);
      files.set(moduleKey, filePath);
      const eventPath = path.join(options.eventRoot, options.runId, `${String(jackyunModuleOrder.indexOf(moduleKey) + 1).padStart(2, "0")}-${moduleKey}.json`);
      await writeJsonAtomic(eventPath, { schemaVersion: 2, runId: options.runId, policyVersion: jackyunExportFirstPolicyVersion, module: moduleKey,
        filePath, navigationIntentAt: at(1), queryIntentAt: at(2), tableStableAt: at(4), exportIntentAt: at(5), downloadEventAt: at(6),
        expectedSourceRows: counts[moduleKey],
        fieldChecks: [{ field: "模式", value: "规格模式(SKU)", verifiedAt: at(2) },
          { field: "统计时间类型", value: "发货时间", verifiedAt: at(2) },
          { field: "日期区间", value: "2026-09-01 00:00:00 至 2026-09-05 23:59:59", verifiedAt: at(2) }],
        snapshotEvidence: moduleKey === "inventory" || moduleKey === "inventory_age" ? { ...currentEvidence, module: moduleKey, runId: options.runId } : undefined,
        downloadProvenance: { runId: options.runId, module: moduleKey, policyVersion: jackyunExportFirstPolicyVersion,
          method: "browser_event", downloadId: `test-${moduleKey}`, originalFileName: "12345678.xlsx", completedAt: at(6), sha256: hash(bytes), bytes: bytes.length,
          ...(options.exportFirstBatch ? { sourceUrlHash: "a".repeat(64) } : {}) },
        ...(options.exportFirstBatch ? { evidence: { exportTransport: options.directHttp ? "web_prepared_http_v1" : "web_session_batch_v1", taskQuerySource: options.directHttp ? "direct_http_api" : "web_session_api",
          ...(options.directHttp ? { directPayloadSha256: "b".repeat(64) } : {}),
          exportTaskBinding: { version: 1, taskId: `sys-${100 + jackyunModuleOrder.indexOf(moduleKey)}`, module: moduleKey,
            label: "fixture", sourceRows: counts[moduleKey], sourceUrlHash: "a".repeat(64), createdAt: at(5), observedAt: at(6) } } } : {}),
      });
      return { status: "exported", runId: options.runId, controllerStatePath: "unused" };
    },
    runDownload: async options => {
      assert.equal(files.size, 5, "no validation or import before all exports");
      calls.push(`${options.dryRun ? "validate" : "import"}:${options.module}`);
      assert.equal(options.snapshotDate, options.module === "inventory" || options.module === "inventory_age" ? "2026-09-06" : undefined);
      return { status: options.dryRun ? "prepared" : "completed", runId: options.runId, module: options.module,
        auditPath: "unused", manifestPath: "unused", outputPath: "unused", outputSha256: "a".repeat(64),
        salesCostSourcePath: path.join(root, "inventory-cost.xlsx"), batch: null } as Awaited<ReturnType<NonNullable<ExportFirstDependencies["runDownload"]>>>;
    },
  };
  return { root, deps, calls, files };
}

test("API plan dispatches only its adapter and a sales cost validation failure blocks every import", async () => {
  const f = await fixture();
  const makeFile = f.deps.runBrowser!;
  f.deps.runBrowser = async () => { throw new Error("DOM_REPORT_ADAPTER_MUST_NOT_RUN"); };
  f.deps.runApi = async options => {
    for (const moduleKey of jackyunExportOrder) {
      await options.beforeModule?.(moduleKey);
      await makeFile({ runId: options.runId, snapshotDate: options.runDate, asOfDate: options.asOfDate, outputRoot: options.outputRoot,
        eventRoot: options.eventRoot, exportOnlyModule: moduleKey, exportFirstBatch: true, directHttp: true,
        headless: true, launchOnly: false, checkLoginOnly: false });
      const eventPath = path.join(options.eventRoot, options.runId, `${String(jackyunModuleOrder.indexOf(moduleKey) + 1).padStart(2, "0")}-${moduleKey}.json`);
      const handoff = JSON.parse(await readFile(eventPath, "utf8"));
      if (moduleKey === "sales") {
        assert.equal(options.salesStartDate, "2026-07-23");
        handoff.fieldChecks.find((item: { field: string }) => item.field === "日期区间").value = "2026-07-23 00:00:00 至 2026-09-05 23:59:59";
      }
      handoff.evidence = { ...handoff.evidence, controller: "authenticated_http_api", exportTransport: "session_api_v1",
        apiPreflightStartedAt: handoff.navigationIntentAt, apiQueryCompletedAt: handoff.tableStableAt,
        apiQuerySha256: "a".repeat(64), permissionSha256: "b".repeat(64), templateSha256: "c".repeat(64),
        serverClock: { requestStartedAt: "2026-09-06T01:00:03.891Z", receivedAt: "2026-09-06T01:00:04.099Z", serverDate: at(5) } };
      handoff.evidence.exportTaskBinding.observedAt = "2026-09-06T01:00:06.901Z";
      await writeJsonAtomic(eventPath, handoff);
      await options.afterModule?.(moduleKey);
    }
    return { status: "exported", runId: options.runId, transport: "session_api_v1", statePath: "fixture" };
  };
  const prepare = f.deps.runDownload!;
  f.deps.runDownload = async options => {
    if (options.module === "sales") { assert.equal(options.salesStartDate,"2026-07-23"); throw new Error("COST_VALIDATION_FAILED"); }
    assert.equal(options.dryRun, true);
    return prepare(options);
  };
  const run = (action: string) => runJackyunExportFirstAction(action, "81818", f.deps);
  assert.equal((await run("plan-api")).exportTransport, "session_api_v1");
  await assert.rejects(run("plan-direct-http"), /不能接管/);
  await assert.rejects(run("import"), /全部导出/);
  await run("export-all");
  await assert.rejects(run("validate"), /COST_VALIDATION_FAILED/);
  await assert.rejects(run("import"), /阶段不匹配/);
  assert.equal(f.calls.filter(call => call.startsWith("import:")).length, 0);
});
test("pipeline enforces order, all-file barrier, replay checks and execution ownership", async () => {
  const f = await fixture();
  const run = (action: string) => runJackyunExportFirstAction(action, "12345", f.deps);
  await assert.rejects(run("import"), /缺少/);
  const plan = await run("plan");
  assert.equal(plan.snapshotDate, "2026-09-06"); assert.equal(plan.salesEndDate, "2026-09-05");
  await assert.rejects(run("export/combos"), /乱序/);
  await assert.rejects(run("import"), /全部导出/);
  await assert.rejects(runJackyunExportFirstAction("plan", "999", f.deps), /尚未闭合/);
  for (const moduleKey of jackyunExportOrder) await run(`export/${moduleKey}`);
  await run("export/inventory");
  assert.deepEqual(f.calls, jackyunExportOrder.map(module => `export:${module}`));
  await assert.rejects(run("import"), /阶段不匹配/);
  await run("validate");
  const validatedCalls = [...f.calls];
  const productBytes = await readFile(f.files.get("products")!);
  await writeFile(f.files.get("products")!, Buffer.concat([productBytes, Buffer.from("changed")]));
  await assert.rejects(run("import"), /已经变化/);
  assert.deepEqual(f.calls, validatedCalls);
  await writeFile(f.files.get("products")!, productBytes);
  await run("import");
  assert.deepEqual(f.calls, [...jackyunExportOrder.map(module => `export:${module}`),
    ...jackyunModuleOrder.map(module => `validate:${module}`), ...jackyunModuleOrder.map(module => `import:${module}`)]);
  await run("export/inventory");
  assert.equal((await run("plan")).phase, "imported", "replay must not rewind phase");
  await assert.rejects(run("verify"), /JSON 文件/);
});

test("web batch shares one controller and preserves a verified export prefix after partial failure", async () => {
  const f = await fixture();
  const single = f.deps.runBrowser!;
  let browserCalls = 0, fail = true;
  f.deps.runBrowser = async options => {
    browserCalls++;
    assert.equal(options.exportFirstBatch, true);
    assert.equal(options.exportOnlyModule, undefined);
    for (const moduleKey of jackyunExportOrder) {
      await options.beforeModule!(moduleKey);
      if (fail && moduleKey === "sales") throw new Error("synthetic pending export");
      if (!f.files.has(moduleKey)) await single({ ...options, exportOnlyModule: moduleKey });
      await options.afterModule!(moduleKey);
    }
    return { status: "exported", runId: options.runId, controllerStatePath: "unused" };
  };
  const run = (action: string) => runJackyunExportFirstAction(action, "975", f.deps);
  await run("plan-web-session");
  await assert.rejects(run("export/inventory"), /降级/);
  await assert.rejects(run("export-all"), /synthetic pending/);
  assert.equal(browserCalls, 1);
  assert.deepEqual(f.calls, ["export:inventory", "export:combos"]);
  await assert.rejects(run("import"), /全部导出/);
  await assert.rejects(runJackyunExportFirstAction("plan-web-session", "976", f.deps), /尚未闭合/);
  fail = false;
  const result = await run("export-all");
  assert.equal(result.phase, "exported");
  assert.deepEqual(f.calls, jackyunExportOrder.map(module => `export:${module}`));
  assert.equal(browserCalls, 2);
  await run("export-all");
  assert.equal(browserCalls, 2, "a completed export replay only verifies original files");
  await run("validate");
  await run("import");
  assert.deepEqual(f.calls.slice(5), [...jackyunModuleOrder.map(m => `validate:${m}`), ...jackyunModuleOrder.map(m => `import:${m}`)]);
});

test("web transport cannot adopt legacy plans or start a browser after midnight", async () => {
  const legacy = await fixture();
  await runJackyunExportFirstAction("plan", "981", legacy.deps);
  await assert.rejects(runJackyunExportFirstAction("export-all", "981", legacy.deps), /旧单表/);
  assert.deepEqual(legacy.calls, []);
  const f = await fixture();
  await runJackyunExportFirstAction("plan-web-session", "982", f.deps);
  await assert.rejects(runJackyunExportFirstAction("export-all", "982", { ...f.deps, now: () => new Date("2026-09-07T01:00:00Z") }), /跨日/);
  assert.deepEqual(f.calls, []);
});

test("HTTP plans stay distinct, preserve the five-file import barrier, and require matching handoff transport", async () => {
  const f = await fixture();
  const single = f.deps.runBrowser!;
  f.deps.runBrowser = async options => {
    assert.equal(options.directHttp, true);
    for (const moduleKey of jackyunExportOrder) {
      await options.beforeModule!(moduleKey);
      await single({ ...options, exportOnlyModule: moduleKey });
      await options.afterModule!(moduleKey);
    }
    return { status: "exported", runId: options.runId, controllerStatePath: "unused" };
  };
  const run = (action: string) => runJackyunExportFirstAction(action, "987", f.deps);
  assert.equal((await run("plan-direct-http")).exportTransport, "web_prepared_http_v1");
  await assert.rejects(run("plan-web-session"), /不能接管/);
  await assert.rejects(run("import"), /全部导出/);
  await run("export-all"); await run("validate"); await run("import");
  assert.deepEqual(f.calls, [...jackyunExportOrder.map(m => `export:${m}`), ...jackyunModuleOrder.map(m => `validate:${m}`), ...jackyunModuleOrder.map(m => `import:${m}`)]);
});
test("cross-day and concurrent executions stop before browser side effects", async () => {
  const f = await fixture();
  await runJackyunExportFirstAction("plan", "222", f.deps);
  await assert.rejects(runJackyunExportFirstAction("export/inventory", "222", { ...f.deps, now: () => new Date("2026-09-07T01:00:00Z") }), /跨日/);
  assert.equal(f.calls.length, 0);
  const fresh = await fixture();
  const settled = await Promise.allSettled([333, 444].map(id => runJackyunExportFirstAction("plan", String(id), fresh.deps)));
  assert.equal(settled.filter(value => value.status === "fulfilled").length, 1);
  assert.equal(fresh.calls.length, 0);
});

// Minimal authenticated-API fixture: enough scope/count/validation answers for
// prepareApiExport to reach the server-clock assertion for the first module.
const apiTemplates = JSON.parse(await readFile(new URL("../config/jackyun-api-templates.json", import.meta.url), "utf8")) as ApiTemplates;
function apiHttp(driftMs: number) {
  const calls: string[] = [];
  const warehouseIds = Array.from({ length: 256 }, (_, i) => String(i + 1));
  const http = {
    get serverClock() {
      const now = new Date().toISOString();
      return { requestStartedAt: now, receivedAt: now, serverDate: new Date(Math.floor(Date.now() / 1000) * 1000 + driftMs).toISOString() };
    },
    request: async (operation: string) => {
      calls.push(operation);
      const data: Record<string, unknown> = {
        rolePermissions: ["branch_stock", "goods_managet_combination", "order_detail_list", "warehouse_age_analysis", "goods_managet_query"]
          .map(moduleCode => ({ moduleCode, hasPermission: 1, isBuy: 1 })),
        roleFunctions: ["branch_stock_export", "goods_managet_combination_export", "goods_managet_query_export", "oms_order_detail_list_export"]
          .map(funCode => ({ funCode })),
        dataFieldPermissions: { visible: ["coupon_password", "creditOverdueLimit"], write: ["creditOverdueLimit"] },
        warehouses: warehouseIds.map(warehouseId => ({ warehouseId, warehouseTypeCode: "1" })),
        owners: [{ id: "123", jlinkOwnerId: "123", name: "自营", memberName: "fixture" }],
        inventoryCount: "25734", goodsCount: 1942, ageCount: 5684, salesCount: "6556", validateExport: null, tasks: [],
      };
      const result = data[operation];
      return { data: result, pageInfo: operation === "tasks" ? { total: 0 } : null, noPrivilegeItem: null, desensitizationItem: null };
    },
  } as unknown as JackyunHttpSession;
  return { http, calls };
}

test("a real drifted-clock API export clears the plan intent and keeps its own error code", async () => {
  const f = await fixture();
  // The API adapter reads the live clock, so this run must use real time.
  f.deps.now = () => new Date();
  f.deps.runBrowser = async () => { throw new Error("DOM_REPORT_ADAPTER_MUST_NOT_RUN"); };
  // 13.03s ahead, the exact 11055 shape: past the 10s tolerance.
  const api = apiHttp(13033);
  f.deps.runApi = async options => runApiExports(options,
    { http: api.http, tenantId: "fixture", templates: apiTemplates, taskTimeoutMs: 5, pollIntervalMs: 1 });
  const run = (action: string) => runJackyunExportFirstAction(action, "11055", f.deps);
  const plan = await run("plan-api");
  assert.equal(plan.exportTransport, "session_api_v1");
  const planPath = path.join(f.root, "outputs", "jackyun-export-first", "n8n-export-first-11055.json");
  // The real adapter throws, and the original clock code must survive the catch:
  // a TypeError here would be unclassifiable and lose the generic closure route.
  await assert.rejects(run("export-all"), /^Error: API_SERVER_CLOCK_UNVERIFIED$/);
  assert.equal(api.calls.filter(operation => operation === "submitExport").length, 0);
  // The failure is decided locally before any write, so the pipeline must drop
  // the intent beforeModule wrote; a retained intent blocks every zero-effect route.
  const after = JSON.parse(await readFile(planPath, "utf8"));
  assert.equal(Object.hasOwn(after, "exportIntent"), false);
  assert.equal(after.phase, "exporting");
  assert.deepEqual(after.exports, {});
  // No controller, event or download tree was left behind either.
  for (const target of [path.join(f.root, "outputs", "jackyun-import-runs", "n8n-export-first-11055"),
    path.join(f.root, "outputs", "jackyun-browser-events", "n8n-export-first-11055")]) {
    await assert.rejects(lstat(target), /ENOENT/, `${target} must not exist`);
  }
  // A healthy clock on the same fixture still proceeds past the assertion.
  const healthy = apiHttp(0);
  f.deps.runApi = async options => runApiExports(options,
    { http: healthy.http, tenantId: "fixture", templates: apiTemplates, taskTimeoutMs: 5, pollIntervalMs: 1 });
  await assert.rejects(run("export-all"), /ORIGINAL_EXPORT_TASK_PENDING|SUBMIT|提交/);
  assert.ok(healthy.calls.includes("submitExport"), "a verified clock must reach the export POST");
});

test("a degenerate API controller keeps the plan intent instead of masking the clock error", async () => {
  for (const [label, controller] of [
    ["null module entry", JSON.stringify({ version: 2, modules: { inventory: null } })],
    ["non-object module entry", JSON.stringify({ version: 2, modules: { inventory: "prepared" } })],
    ["array module map", JSON.stringify({ version: 2, modules: [] })],
    ["corrupt json", "{ not json"],
  ] as const) {
    const f = await fixture();
    f.deps.runBrowser = async () => { throw new Error("DOM_REPORT_ADAPTER_MUST_NOT_RUN"); };
    // Stand in for an adapter that persisted a controller and then failed the
    // clock check (the persist>5s shape), leaving state that proves nothing.
    f.deps.runApi = async options => {
      await options.beforeModule?.("inventory");
      const directory = path.join(options.outputRoot, options.runId);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "api-controller-state.json"), controller);
      throw new Error("API_SERVER_CLOCK_UNVERIFIED");
    };
    const run = (action: string) => runJackyunExportFirstAction(action, "11056", f.deps);
    await run("plan-api");
    // The guard must neither throw a TypeError nor accept unreadable state as
    // proof: the original error propagates and the intent is preserved.
    await assert.rejects(run("export-all"), /^Error: API_SERVER_CLOCK_UNVERIFIED$/, label);
    const after = JSON.parse(await readFile(path.join(f.root, "outputs", "jackyun-export-first", "n8n-export-first-11056.json"), "utf8"));
    assert.equal(after.exportIntent, "inventory", `${label} must keep the intent`);
  }
});
