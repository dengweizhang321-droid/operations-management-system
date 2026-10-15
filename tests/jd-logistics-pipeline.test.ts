import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { JD_FLOW_CSV_HEADERS, JD_SHOP_PRODUCTS_CSV_HEADERS, jdLogisticsWorkbookFields } from "../lib/inventory/jd-logistics-workbook";
import { jdLogisticsHelperRequestError, logisticsContentHash, logisticsRawHash, type JdLogisticsManifest, type JdLogisticsReceipt } from "../lib/jd/logistics-manifest";
import { jdLogisticsProtocol, jdLogisticsSourceUrls, parseJdLogisticsConfig, planJdLogisticsNotifications, selectJdLogisticsOperations,
  type JdLogisticsBinding, type JdLogisticsConfig, type JdLogisticsExportOptions, type JdLogisticsExportResult, type JdLogisticsSettings } from "../lib/jd/logistics-policy";
import type { JdStore } from "../lib/jd/store-registry";
import { notifyJdLogisticsN8nPlan, planJdLogisticsN8nRun, runJdLogisticsN8nPlan, verifyJdLogisticsN8nPlan } from "../tools/jd-logistics-n8n-pipeline";
import { isolatedRequestIdentity, IsolatedHelperSlots } from "../tools/tmall-isolated-helper";

const now = new Date("2026-10-15T04:00:00.000Z");
const store: JdStore = { storeKey: "jd-test", platform: "京东", enabled: true, accountLabel: "测试", shopName: "测试店", shopId: "10001",
  browser: { executablePath: "unused/chrome.exe", userDataDir: "unused/profiles", profileName: "Default", profileDir: "unused/profiles/Default", debugPort: 9224, downloadDir: "unused/downloads" } };
const binding = (sourceKind: JdLogisticsBinding["sourceKind"] = "shop_products"): JdLogisticsBinding => ({ sourceKind, departmentId: "department-1", businessUnitCode: "00001",
  enabled: true, sourceVerified: true, contractVersion: "jd-logistics-v1", collectorStoreKey: store.storeKey, authorizedStoreKeys: [store.storeKey], warehouseCode: "",
  ...(sourceKind === "flow" ? { initialStartDate: "2026-10-01", maxSpanDays: 31 } : {}) });
function settings(): JdLogisticsSettings { return { contractVersion: "jd-logistics-v1", departments: [{ id: "department-1", businessUnitCode: "00001", storeKeys: [store.storeKey],
  logisticsEnabled: true, capabilities: { flow: true, shop_products: true, realtime_inventory: true, inventory_snapshot: true }, revision: 1 }], scopeRevisions: [] }; }
function workbook(options: JdLogisticsExportOptions) {
  const fields = jdLogisticsWorkbookFields[options.sourceKind];
  const data: Record<string, unknown> = { businessUnitCode: "00001", goodsCode: "00002", goodsName: "测试货品", warehouseCode: "00003", warehouseName: "京东仓",
    platform: "京东", shopName: "测试店", shopProductCode: "00004", documentNo: "00005", businessType: "调拨入库", businessTime: `${options.rangeStart}T12:00:00+08:00`,
    snapshotDate: options.rangeStart, actualBegin: 0, actualChange: 2, actualEnd: 2, availableBegin: 0, availableChange: 2, availableEnd: 2,
    onHandQuantity: 2, availableQuantity: 2, lockedQuantity: 0, inTransitQuantity: 0, productStatus: "启用" };
  const headers = fields.map(field => field.key), values = fields.map(field => data[field.key] ?? "");
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, values]), "明细");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
async function fixture(kinds: JdLogisticsBinding["sourceKind"][] = ["shop_products"]) {
  const root = await mkdtemp(path.join(tmpdir(), "jd-logistics-test-"));
  const config: JdLogisticsConfig = { version: 1, bindings: kinds.map(binding) };
  const state = { settings: settings(), exports: 0, imports: 0, getBatches: 0, failImportResponse: false, stale: false, wrongReceipt: false, duplicate: false,
    batches: new Map<string, JdLogisticsReceipt>(), exportedPaths: [] as string[], notifyCalls: 0, notificationLedgerReads: 0, notificationEffects: 0,
    notifyNetworkLost: false, badNotificationLedger: false, notifyUnknownCount: 0, notifyStatus: "sent" as "sent" | "duplicate" | "unknown" | "empty" | "not_configured" | "disabled", notificationLedger: null as Record<string, unknown> | null,
    notifyBody: null as Record<string, unknown> | null };
  const options = { root, executionId: "execution-1", now, stores: [store], config };
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, "http://localhost:3000"); assert.equal(url.pathname, "/api/inventory/jd-logistics");
    if (!init?.body) {
      if (url.searchParams.get("operation") === "settings") return Response.json({ success: true, data: state.settings });
      if (url.searchParams.get("operation") === "notifications") {
        state.notificationLedgerReads++;
        const ledger = state.notificationLedger?.deliveryId === url.searchParams.get("deliveryId") ? state.notificationLedger : null;
        return Response.json({ success: true, data: { items: ledger ? [{ ...ledger, ...(state.badNotificationLedger ? { configDigest: "0".repeat(64) } : {}) }] : [], total: ledger ? 1 : 0, page: 1, pageSize: 1 } });
      }
      state.getBatches++;
      const batch = state.batches.get(url.searchParams.get("batchId")!);
      return Response.json({ success: true, data: { items: batch ? [{ ...batch, currentSelection: { current: !state.stale, verifiedRowCount: batch.rowCount, contentHash: batch.contentHash, scopeRevision: batch.scopeRevision } }] : [], total: batch ? 1 : 0, page: 1, pageSize: 1 } });
    }
    const body = JSON.parse(String(init.body));
    if (body.operation === "notify") {
      state.notifyCalls++; state.notifyBody = body;
      const persisted = JSON.parse(await readFile(path.join(root, "outputs/jd-logistics-pipeline", `${body.runId}.json`), "utf8"));
      assert.equal(persisted.stage, "verified"); assert.equal(persisted.notification.stage, "notifying");
      assert.ok(persisted.operations.every((operation: { stage: string }) => operation.stage === "verified"));
      assert.deepEqual(Object.keys(body).sort(), ["operation", "departmentIds", "runId", "executionId", "protocol", "planHash", "verifiedBatches"].sort());
      for (const proof of body.verifiedBatches) {
        const batch = state.batches.get(proof.batchId)!; assert.equal(proof.departmentId, batch.departmentId); assert.equal(proof.contentHash, batch.contentHash); assert.equal(proof.rawFileHash, batch.rawFileHash);
      }
      if (state.notifyStatus === "sent") state.notificationEffects++;
      const riskCount = state.notifyStatus === "empty" ? 0 : 2;
      const digests = { configDigest: state.settings.notification!.configDigest, sourceDigest: "c".repeat(64), scopeDigest: "d".repeat(64) };
      const confirmed = state.notifyStatus === "sent" || state.notifyStatus === "duplicate";
      state.notificationLedger = { deliveryId: "delivery-1", status: confirmed ? "sent" : "unknown", businessDate: "2026-10-15", departmentIds: body.departmentIds,
        riskCount, unknownCount: state.notifyUnknownCount, displayedCount: riskCount, messageHash: "f".repeat(64), receiptHash: confirmed ? "b".repeat(64) : "", ...digests, targetDigest: "e".repeat(64), sentAt: now.toISOString() };
      if (state.notifyNetworkLost) throw new Error("synthetic notify response lost");
      return Response.json({ success: true, data: { status: state.notifyStatus, ...(state.notifyStatus !== "empty" ? { deliveryId: "delivery-1", ...digests, receiptHash: confirmed ? "b".repeat(64) : "" } : {}),
        riskCount, unknownCount: state.notifyUnknownCount, notificationAvailable: true, departments: body.departmentIds.map((departmentId: string) => ({ departmentId, status: state.notifyStatus, riskCount })) } });
    }
    state.imports++;
    const receipt: JdLogisticsReceipt = { batchId: `batch-${state.imports}`, sourceKind: body.sourceKind, departmentId: body.departmentId, businessUnitCode: body.businessUnitCode,
      rangeStart: body.rangeStart, rangeEnd: body.rangeEnd, warehouseCode: body.warehouseCode, rawFileHash: body.rawFileHash,
      contentHash: logisticsContentHash(body.rows), rowCount: body.rows.length, status: state.duplicate ? "duplicate" : "imported", referenceBatchId: state.duplicate ? "reference-1" : "", scopeRevision: body.expectedScopeRevision + (state.duplicate ? 0 : 1),
      origin: "workflow", storeKey: body.storeKey, collectedAt: body.collectedAt, ...(body.sourceAsOf ? { sourceAsOf: body.sourceAsOf } : {}), collectorEvidence: body.collectorEvidence };
    if (body.sourceKind === "shop_products") receipt.sourceStatus = "enabled";
    assert.equal(body.collectorEvidence.protocol, jdLogisticsProtocol);
    assert.equal(body.identityEvidence.observedBusinessUnitCode, "00001"); assert.equal(init.headers && (init.headers as Record<string, string>).origin, "http://localhost:3000");
    const previous = state.settings.scopeRevisions.find(scope => scope.departmentId === body.departmentId && scope.sourceKind === body.sourceKind);
    if (previous) previous.revision = receipt.scopeRevision;
    else state.settings.scopeRevisions.push({ departmentId: body.departmentId, sourceKind: body.sourceKind, revision: receipt.scopeRevision });
    state.batches.set(receipt.batchId, receipt);
    if (state.duplicate) state.batches.set("reference-1", { ...receipt, batchId: "reference-1", status: "imported", referenceBatchId: "", rawFileHash: "f".repeat(64) });
    if (state.failImportResponse) throw new Error("synthetic response lost");
    return Response.json({ success: true, data: { ...receipt, ...(state.wrongReceipt ? { rawFileHash: "0".repeat(64) } : {}), verifiedRowCount: receipt.rowCount, contractVersion: "jd-logistics-v1", mode: "live", revision: 1 } });
  };
  const exporter = async (input: JdLogisticsExportOptions) => {
    state.exports++; await input.assertOwner(); await mkdir(input.downloadDirectory, { recursive: true });
    const filePath = path.join(input.downloadDirectory, "source.xlsx"); await writeFile(filePath, workbook(input)); state.exportedPaths.push(filePath);
    return { filePath, taskIdentity: `task-${input.operationId}`, complete: true as const, browserClosed: true as const, collectedAt: now.toISOString(),
      ...(input.sourceKind === "inventory_snapshot" ? { sourceAsOf: `${input.rangeStart}T00:00:00+08:00` } : {}),
      identityEvidence: { observedBusinessUnitCode: input.businessUnitCode, observedAt: now.toISOString(), sourceUrl: jdLogisticsSourceUrls[input.sourceKind], storeKey: input.store.storeKey },
      scope: { sourceKind: input.sourceKind, departmentId: input.departmentId, businessUnitCode: input.businessUnitCode, rangeStart: input.rangeStart, rangeEnd: input.rangeEnd, warehouseCode: input.warehouseCode }, contractVersion: "jd-logistics-v1",
      ...(input.sourceKind === "shop_products" ? { sourceStatus: "enabled" as const } : {}) };
  };
  const dependencies = { ...options, request };
  const plan = () => planJdLogisticsN8nRun(dependencies);
  const run = (p: JdLogisticsManifest) => runJdLogisticsN8nPlan(p, { ...dependencies, exporter });
  const verify = (p: JdLogisticsManifest) => verifyJdLogisticsN8nPlan(p, dependencies);
  const notify = (p: JdLogisticsManifest) => notifyJdLogisticsN8nPlan(p, dependencies);
  return { root, state, options, dependencies, config, plan, run, verify, notify, exporter };
}

test("new source bindings are independently off and disabled is a zero-action terminal outcome", async () => {
  const f = await fixture(); f.config.bindings[0].enabled = false;
  const p = await f.plan(); assert.equal(p.outcome, "disabled"); assert.equal(p.operations.length, 0);
  assert.equal((await f.run(p)).status, "disabled"); assert.equal((await f.verify(p)).status, "disabled");
  assert.equal((await f.notify(p)).notification.status, "disabled"); assert.equal(f.state.notifyCalls, 0);
  assert.equal(f.state.exports, 0); assert.equal(f.state.imports, 0); assert.equal(f.state.getBatches, 0);
});
test("four sources keep independent exact dates and complete after exact independent rereads", async () => {
  const f = await fixture(["flow", "shop_products", "realtime_inventory", "inventory_snapshot"]); const p = await f.plan();
  assert.deepEqual(p.operations.map(op => [op.sourceKind, op.rangeStart, op.rangeEnd]), [["flow", "2026-10-01", "2026-10-15"], ["shop_products", "2026-10-15", "2026-10-16"], ["realtime_inventory", "2026-10-15", "2026-10-16"], ["inventory_snapshot", "2026-10-14", "2026-10-15"]]);
  await f.run(p); await f.run(p); assert.equal(f.state.exports, 4); // B response replay is observation only.
  const result = await f.verify(p); assert.equal(result.verifiedCount, 4); assert.equal(result.status, "imported"); assert.equal(f.state.getBatches, 4);
});
test("shared source is exported once; competing account choices fail closed", () => {
  const config: JdLogisticsConfig = { version: 1, bindings: [binding(), binding()] };
  assert.equal(selectJdLogisticsOperations(config, settings(), [store], now).length, 1);
  const second = { ...store, storeKey: "jd-second" }; config.bindings[1] = { ...binding(), collectorStoreKey: second.storeKey, authorizedStoreKeys: [second.storeKey] };
  const current = settings(); current.departments[0].storeKeys.push(second.storeKey);
  assert.throws(() => selectJdLogisticsOperations(config, current, [store, second], now), /AMBIGUOUS_SHARED_COLLECTOR/);
});
test("enabled unknown source contracts and unconfigured flow dates cannot form plans", async () => {
  const f = await fixture(); f.config.bindings[0].sourceVerified = false;
  await assert.rejects(f.plan(), /SOURCE_NOT_READY/);
  const b = binding("flow"); delete b.initialStartDate;
  assert.throws(() => selectJdLogisticsOperations({ version: 1, bindings: [b] }, settings(), [store], now), /FLOW_RANGE_NOT_CONFIGURED/);
  assert.throws(() => parseJdLogisticsConfig({ version: 1, bindings: [{ ...binding(), token: "forbidden" }] }), /INVALID_SOURCE_BINDING/);
});
test("A returns its original execution plan and rejects cross-execution unfinished ownership", async () => {
  const f = await fixture(); const p = await f.plan(); assert.equal((await f.plan()).runId, p.runId);
  await assert.rejects(planJdLogisticsN8nRun({ ...f.dependencies, executionId: "other" }), /PREVIOUS_RUN_UNRESOLVED/);
  await assert.rejects(runJdLogisticsN8nPlan(p, { ...f.dependencies, executionId: "other", exporter: f.exporter }), /EXECUTION_OWNER_MISMATCH/);
  assert.equal(f.state.exports, 0);
});
test("revoking an enabled backend capability after A blocks B before export", async () => {
  const f = await fixture(); const p = await f.plan(); f.state.settings.departments[0].capabilities.shop_products = false;
  await assert.rejects(f.run(p), /POLICY_CHANGED_OR_REVOKED/); assert.equal(f.state.exports, 0); assert.equal(f.state.imports, 0);
});
test("invalid later source blocks every import at the full-file barrier", async () => {
  const f = await fixture(["shop_products", "realtime_inventory"]); const p = await f.plan();
  await assert.rejects(runJdLogisticsN8nPlan(p, { ...f.dependencies, exporter: async input => {
    const result = await f.exporter(input); if (input.sourceKind === "realtime_inventory") await writeFile(result.filePath, "invalid workbook"); return result;
  } }), /PIPELINE_FAILED_MANUAL_ACTION/);
  assert.equal(f.state.exports, 2); assert.equal(f.state.imports, 0);
  await assert.rejects(f.run(p), /REPLAY_REQUIRES_MANUAL_ACTION/); assert.equal(f.state.exports, 2);
});
test("source identity, exact scope and browser cleanup are required before import", async () => {
  for (const mutate of [
    (result: JdLogisticsExportResult) => { result.identityEvidence.storeKey = "jd-other"; },
    (result: JdLogisticsExportResult) => { result.scope.warehouseCode = "foreign"; },
    (result: JdLogisticsExportResult) => { (result as { browserClosed: boolean }).browserClosed = false; },
  ]) {
    const f = await fixture(); const p = await f.plan();
    await assert.rejects(runJdLogisticsN8nPlan(p, { ...f.dependencies, exporter: async input => { const result = await f.exporter(input); mutate(result); return result; } }), /EXPORT_EVIDENCE_MISMATCH/);
    assert.equal(f.state.imports, 0);
  }
});
test("lost import response leaves importing evidence and never resends the POST", async () => {
  const f = await fixture(); const p = await f.plan(); f.state.failImportResponse = true;
  await assert.rejects(f.run(p), /IMPORT_RESULT_UNKNOWN/);
  const manifest = JSON.parse(await readFile(path.join(f.root, "outputs/jd-logistics-pipeline", `${p.runId}.json`), "utf8"));
  assert.equal(manifest.operations[0].stage, "importing"); assert.equal(manifest.stage, "failed");
  await assert.rejects(f.run(p), /REPLAY_REQUIRES_MANUAL_ACTION/); assert.equal(f.state.imports, 1); assert.equal(f.state.exports, 1);
});
test("an HTTP success with a wrong raw hash is not import completion", async () => {
  const f = await fixture(); const p = await f.plan(); f.state.wrongReceipt = true;
  await assert.rejects(f.run(p), /IMPORT_RECEIPT_MISMATCH/);
});
test("C rejects a completed historical batch that is no longer selected", async () => {
  const f = await fixture(); const p = await f.plan(); await f.run(p); f.state.stale = true;
  await assert.rejects(f.verify(p), /BATCH_NO_LONGER_CURRENT/);
});
test("duplicate resolves the exact original batch and reports no new import", async () => {
  const f = await fixture(); f.state.duplicate = true;
  f.state.settings.scopeRevisions.push({ departmentId: "department-1", sourceKind: "shop_products", revision: 1 });
  const p = await f.plan(); await f.run(p); const result = await f.verify(p);
  assert.equal(result.status, "duplicate"); assert.equal(result.importedCount, 0); assert.equal(result.duplicateCount, 1); assert.equal(f.state.getBatches, 2);
});
test("a duplicate receipt without its exact existing reference cannot complete", async () => {
  const f = await fixture(); f.state.duplicate = true;
  const p = await f.plan(); await f.run(p); f.state.batches.delete("reference-1");
  await assert.rejects(f.verify(p), /DUPLICATE_REFERENCE_MISSING/);
});
test("C reopens actual bytes rather than trusting B's saved hashes", async () => {
  const f = await fixture(); const p = await f.plan(); await f.run(p);
  const bytes = await readFile(f.state.exportedPaths[0]); bytes[bytes.length - 1] ^= 1; await writeFile(f.state.exportedPaths[0], bytes);
  await assert.rejects(f.verify(p), /INDEPENDENT_FILE_CHECK_FAILED|PIPELINE_FAILED_MANUAL_ACTION/);
});
test("content hash ignores row positions/order but retains duplicate multiplicity", () => {
  const rows = [{ goodsCode: "00001", sourceRowNumber: 2 }, { goodsCode: "00002", sourceRowNumber: 3 }];
  assert.equal(logisticsContentHash(rows), logisticsContentHash([{ goodsCode: "00002", sourceRowNumber: 8 }, { goodsCode: "00001", sourceRowNumber: 9 }]));
  assert.notEqual(logisticsContentHash(rows), logisticsContentHash([...rows, rows[0]]));
});
test("flow and enabled-product CSV keep their original byte hashes through B and C", async () => {
  for (const sourceKind of ["flow", "shop_products"] as const) {
    const f = await fixture([sourceKind]), p = await f.plan(); let raw = Buffer.alloc(0);
    await runJdLogisticsN8nPlan(p, { ...f.dependencies, exporter: async input => {
      const result = await f.exporter(input);
      const headers = sourceKind === "flow" ? JD_FLOW_CSV_HEADERS : JD_SHOP_PRODUCTS_CSV_HEADERS;
      const cells: Record<string, string> = { "序号": "1", "业务发生时间": `${input.rangeStart} 12:00:00`, "事业部编码": input.businessUnitCode, "事业部名称": "测试事业部", "仓库编码": "00003", "仓库名称": "测试仓库",
        "事业部商品编号": "00002", "事业部商品编码": "00002", "事业部商品名称": "测试货品", "商品名称": "测试货品", "京东单据编码": "00005", "业务类型": "调拨入库", "实际原始库存": "0", "实际库存加减数量": "2", "实际库存结存": "2",
        "可用原始库存": "0", "可用库存加减数量": "2", "可用库存结存": "2", "店铺": "测试店", "店铺商品编码": "00004", "商品状态": "启用" };
      raw = Buffer.from(`${headers.join(",")}\r\n${headers.map(header => cells[header] ?? "").join(",")}\r\n`, "utf8");
      result.filePath = path.join(input.downloadDirectory, "source.csv"); await writeFile(result.filePath, raw); return result;
    } });
    await f.verify(p);
    const manifest = JSON.parse(await readFile(path.join(f.root, "outputs/jd-logistics-pipeline", `${p.runId}.json`), "utf8"));
    assert.ok(manifest.operations[0].export.relativePath.endsWith("/source.csv"));
    assert.equal(manifest.operations[0].receipt.rawFileHash, logisticsRawHash(raw));
  }
});
test("inventory sources cannot relabel a CSV download as a supported snapshot file", async () => {
  const f = await fixture(["realtime_inventory"]), p = await f.plan();
  await assert.rejects(runJdLogisticsN8nPlan(p, { ...f.dependencies, exporter: async input => {
    const result = await f.exporter(input); result.filePath = path.join(input.downloadDirectory, "source.csv"); await writeFile(result.filePath, "not allowed"); return result;
  } }), /DOWNLOAD_PATH_REJECTED/);
  assert.equal(f.state.imports, 0);
});
test("real router allocates logistics in the shared legacy slot and fences owner/route order", async () => {
  const headers = { "x-teruisi-n8n-execution-id": "123", "x-teruisi-workflow-key": "jd-logistics" };
  const identity = isolatedRequestIdentity("/coordination/claim", headers)!;
  assert.equal(identity.workflow, "jd-logistics"); assert.equal(identity.key, "legacy");
  assert.equal(isolatedRequestIdentity("/jd-logistics/run", headers)?.workflow, "jd-logistics");
  const pool = new IsolatedHelperSlots(new Set(["tmall-test"]), async () => ({ port: 12345, token: "synthetic", stop: async () => undefined }));
  await pool.claim(identity).slot!.ready;
  assert.equal(pool.claim({ ...identity, workflow: "jd", executionId: "124" }).status, "waiting");
  assert.equal(jdLogisticsHelperRequestError("ready", false, "/jd-logistics/plan", "123", null)?.error, "execution_not_claimed");
  assert.equal(jdLogisticsHelperRequestError("planned", false, "/jd-logistics/run", "124", "123")?.error, "execution_mismatch");
  assert.equal(jdLogisticsHelperRequestError("planned", true, "/jd-logistics/release", "123", "123")?.error, "pipeline_busy");
  assert.equal(jdLogisticsHelperRequestError("failed", false, "/jd-logistics/release", "123", "123"), null);
  assert.equal(jdLogisticsHelperRequestError("executed", false, "/jd-logistics/notify", "123", "123")?.error, "jd_logistics_stage_mismatch");
  assert.equal(jdLogisticsHelperRequestError("verified", false, "/jd-logistics/notify", "123", "123"), null);
});

function enableNotifications(settings: JdLogisticsSettings) {
  settings.notification = { implemented: true, enabled: true, configured: true, groupName: "测试群聊", robotName: "志高助手", configDigest: "a".repeat(64) };
  settings.departments[0].monitorEnabled = true; settings.departments[0].pushEnabled = true; settings.departments[0].stockoutThresholdDays = 15;
}
async function notificationFixture() {
  const f = await fixture(["realtime_inventory", "inventory_snapshot"]); enableNotifications(f.state.settings);
  const p = await f.plan(); await f.run(p); const c = await f.verify(p);
  assert.equal(c.stage, "verified"); assert.equal(c.notification.stage, "pending"); assert.equal(f.state.notifyCalls, 0);
  return { ...f, p };
}
test("notification planning freezes paired source scope, all three switches, threshold and exact target", () => {
  const current = settings(); enableNotifications(current);
  const config: JdLogisticsConfig = { version: 1, bindings: [binding("realtime_inventory"), binding("inventory_snapshot")] };
  const operations = selectJdLogisticsOperations(config, current, [store], now);
  const eligible = planJdLogisticsNotifications(current, operations);
  assert.deepEqual(eligible.departmentIds, ["department-1"]);
  assert.deepEqual(planJdLogisticsNotifications(current, operations.filter(op => op.sourceKind === "realtime_inventory")).departmentIds, []);
  for (const change of [{ monitorEnabled: false }, { pushEnabled: false }, { logisticsEnabled: false }, { stockoutThresholdDays: null }]) {
    const altered = { ...current, departments: current.departments.map(department => ({ ...department, ...change })) };
    assert.deepEqual(planJdLogisticsNotifications(altered, operations).departmentIds, []);
  }
  assert.throws(() => planJdLogisticsNotifications({ ...current, notification: { ...current.notification!, groupName: "other" } }, operations), /TARGET_MISMATCH/);
});
test("D step rejects owner changes and any attempt before full C verification", async () => {
  const f = await fixture(); enableNotifications(f.state.settings); const p = await f.plan();
  await assert.rejects(f.notify(p), /NOT_READY_FOR_NOTIFICATION/);
  await assert.rejects(notifyJdLogisticsN8nPlan(p, { ...f.dependencies, executionId: "foreign" }), /EXECUTION_OWNER_MISMATCH/);
  assert.equal(f.state.notifyCalls, 0);
});
test("D step keeps flow-only verified departments outside notification scope", async () => {
  const f = await fixture(["flow"]); enableNotifications(f.state.settings);
  const p = await f.plan(); await f.run(p); await f.verify(p);
  const result = await f.notify(p); assert.equal(result.stage, "completed"); assert.equal(result.notification.status, "empty"); assert.equal(f.state.notifyCalls, 0);
});
test("D step missing notification configuration and empty enabled plans remain zero POST", async () => {
  for (const configured of [false, true]) {
    const f = await fixture(); f.config.bindings[0].enabled = false; enableNotifications(f.state.settings);
    f.state.settings.notification = { ...f.state.settings.notification!, enabled: configured, configured, configDigest: configured ? "a".repeat(64) : "" };
    const p = await f.plan(); await f.run(p); await f.verify(p);
    const result = await f.notify(p); assert.equal(result.notification.status, configured ? "empty" : "not_configured"); assert.equal(f.state.notifyCalls, 0); assert.equal(f.state.imports, 0);
  }
});
test("D step confirms one sent ledger exactly and only reads it on a response replay", async () => {
  const f = await notificationFixture(); f.state.notifyUnknownCount = 3; const result = await f.notify(f.p);
  assert.equal(result.stage, "completed"); assert.equal(result.notification.stage, "notified"); assert.equal(result.notification.status, "sent");
  assert.equal(f.state.notifyCalls, 1); assert.equal(f.state.notificationLedgerReads, 1); assert.equal(f.state.notificationEffects, 1);
  assert.equal(result.notification.riskCount, 2); assert.equal(result.notification.unknownCount, 3);
  const body = f.state.notifyBody!; assert.deepEqual(body.departmentIds, ["department-1"]);
  assert.deepEqual((body.verifiedBatches as Array<{ sourceKind: string }>).map(row => row.sourceKind).sort(), ["inventory_snapshot", "realtime_inventory"]);
  await f.notify(f.p); assert.equal(f.state.notifyCalls, 1); assert.equal(f.state.notificationLedgerReads, 2);
});
test("D step distinguishes duplicate notification from a newly sent message", async () => {
  const f = await notificationFixture(); f.state.notifyStatus = "duplicate";
  const result = await f.notify(f.p); assert.equal(result.notification.status, "duplicate"); assert.equal(result.stage, "completed");
  assert.equal(f.state.notificationEffects, 0); assert.equal(f.state.notificationLedgerReads, 1);
});
test("D step never reposts a lost send response or an explicit unknown result", async () => {
  for (const failure of ["lost", "unknown"] as const) {
    const f = await notificationFixture(); f.state.notifyNetworkLost = failure === "lost"; if (failure === "unknown") f.state.notifyStatus = "unknown";
    await assert.rejects(f.notify(f.p), /NOTIFICATION_RESULT_UNKNOWN/);
    const manifest = JSON.parse(await readFile(path.join(f.root, "outputs/jd-logistics-pipeline", `${f.p.runId}.json`), "utf8"));
    assert.equal(manifest.notification.stage, "unknown"); assert.equal(manifest.stage, "failed");
    assert.ok(manifest.operations.every((operation: { stage: string }) => operation.stage === "verified"));
    await assert.rejects(f.notify(f.p), /REPLAY_REQUIRES_MANUAL_ACTION/);
    assert.equal(f.state.notifyCalls, 1); assert.equal(f.state.notificationLedgerReads, 0);
  }
});
test("D step refuses a mismatched exact delivery ledger without sending again", async () => {
  const f = await notificationFixture(); f.state.badNotificationLedger = true;
  await assert.rejects(f.notify(f.p), /NOTIFICATION_LEDGER_MISMATCH/);
  await assert.rejects(f.notify(f.p), /REPLAY_REQUIRES_MANUAL_ACTION/);
  assert.equal(f.state.notifyCalls, 1); assert.equal(f.state.notificationLedgerReads, 1);
});
test("D step observes notification revocation after C and preserves verified data", async () => {
  const f = await notificationFixture(); f.state.settings.notification = { ...f.state.settings.notification!, enabled: false, configDigest: "0".repeat(64) };
  await assert.rejects(f.notify(f.p), /NOTIFICATION_POLICY_CHANGED/); assert.equal(f.state.notifyCalls, 0);
  const manifest = JSON.parse(await readFile(path.join(f.root, "outputs/jd-logistics-pipeline", `${f.p.runId}.json`), "utf8"));
  assert.ok(manifest.operations.every((operation: { stage: string }) => operation.stage === "verified"));
});
test("D step attempted but unconfigured delivery is a failure rather than a normal skip", async () => {
  const f = await notificationFixture(); f.state.notifyStatus = "not_configured";
  await assert.rejects(f.notify(f.p), /NOTIFICATION_NOT_DELIVERED/);
  const manifest = JSON.parse(await readFile(path.join(f.root, "outputs/jd-logistics-pipeline", `${f.p.runId}.json`), "utf8"));
  assert.equal(manifest.notification.stage, "failed"); assert.equal(manifest.stage, "failed");
  assert.equal(f.state.notificationEffects, 0); assert.equal(f.state.notificationLedgerReads, 0);
  await assert.rejects(f.notify(f.p), /REPLAY_REQUIRES_MANUAL_ACTION/); assert.equal(f.state.notifyCalls, 1);
});
test("D step distinguishes truly empty risks from unresolved risk coverage", async () => {
  for (const unknownCount of [0, 2]) {
    const f = await notificationFixture(); f.state.notifyStatus = "empty"; f.state.notifyUnknownCount = unknownCount;
    if (unknownCount) {
      await assert.rejects(f.notify(f.p), /COVERAGE_UNCONFIRMED/);
      await assert.rejects(f.notify(f.p), /REPLAY_REQUIRES_MANUAL_ACTION/);
    } else {
      const result = await f.notify(f.p); assert.equal(result.notification.status, "empty"); assert.equal(result.stage, "completed");
    }
    assert.equal(f.state.notificationEffects, 0); assert.equal(f.state.notifyCalls, 1);
  }
});
