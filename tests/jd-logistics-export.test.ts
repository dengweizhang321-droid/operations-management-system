import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertJhExportRequest, assertLogisticsFullScope, awaitJhLogisticsTask, downloadJhLogisticsFile,
  exactTaskCandidates, exportJdLogistics, logisticsDebugPortClosed, logisticsExportIdentity } from "../tools/jd-logistics-export";
import type { JdLogisticsExportOptions } from "../lib/jd/logistics-policy";
import { logisticsContentHash } from "../lib/jd/logistics-manifest";
import { jhLogisticsDownloadUrl, legacyLogisticsTask, parseJhLogisticsTaskPage, parseProductLogisticsTaskPage,
  productLogisticsExportTaskId, productLogisticsQueryTotal, selectJhLogisticsTask, selectProductLogisticsTask, type JhLogisticsTaskPage } from "../lib/jd/logistics-source-tasks";
import { productLogisticsDownloadAck, productLogisticsDownloadAttachment } from "../lib/jd/logistics-source-tasks";
import { assertFlowLogisticsRequest, flowLogisticsAttachment, flowLogisticsQueryTotal, flowLogisticsRequest, jhLogisticsQueryRequest, jhLogisticsQueryTotal } from "../lib/jd/logistics-source-tasks";
import type { Page } from "playwright-core";

test("content fingerprints preserve microseconds and use Django's exact six-digit fractional normalization", () => {
  const base = { goodsCode: "g", businessTime: "2026-10-15T12:00:00.123+08:00" };
  assert.equal(logisticsContentHash([base]), logisticsContentHash([{ ...base, businessTime: "2026-10-15T12:00:00.123000+08:00" }]));
  assert.equal(logisticsContentHash([base]), logisticsContentHash([{ ...base, businessTime: "2026-10-15T04:00:00.123Z" }]));
  assert.notEqual(logisticsContentHash([base]), logisticsContentHash([{ ...base, businessTime: "2026-10-15T12:00:00.123001+08:00" }]));
  assert.throws(() => logisticsContentHash([{ ...base, businessTime: "2026-10-15T12:00:00.1234567+08:00" }]), /INVALID_BUSINESS_TIME/);
});

test("a remote task must match the post-baseline source, business unit and complete date interval", () => {
  const task = { fingerprint: "new", sourceName: "库存流水", text: "库存流水 EBU-A 2026-10-01 至 2026-10-14", rowIndex: 1, rowCount: 20, createdAt: "2026-10-15 12:00:00" };
  const window = { submittedAt: "2026-10-15T12:00:00.120+08:00", observedAt: "2026-10-15T12:00:03+08:00" };
  assert.equal(exactTaskCandidates([task], [], "库存流水", "EBU-A", "2026-10-01", "2026-10-14", window).length, 1);
  assert.equal(exactTaskCandidates([task], ["new"], "库存流水", "EBU-A", "2026-10-01", "2026-10-14", window).length, 0);
  assert.equal(exactTaskCandidates([task], [], "库存流水", "EBU", "2026-10-01", "2026-10-14", window).length, 0);
  assert.equal(exactTaskCandidates([task], [], "库存流水", "EBU-B", "2026-10-01", "2026-10-14", window).length, 0);
  assert.equal(exactTaskCandidates([task], [], "库存流水", "EBU-A", "2026-10-01", "2026-10-15", window).length, 0);
  assert.equal(exactTaskCandidates([{ ...task, createdAt: "2026-10-15 11:59:59" }], [], "库存流水", "EBU-A", "2026-10-01", "2026-10-14", window).length, 0);
});
test("legacy pending to completed quantity/state changes keep the identical baseline identity", () => {
  const headers = ["任务名称", "查询条件", "创建时间", "数量", "状态"];
  const pending = legacyLogisticsTask(["库存流水", "EBU-A 2026-10-01 至 2026-10-14", "2026-10-15 12:00:00", "0", "执行中"], headers, 1);
  const completed = legacyLogisticsTask(["库存流水", "EBU-A 2026-10-01 至 2026-10-14", "2026-10-15 12:00:00", "400", "执行完成"], headers, 1);
  assert.equal(pending.fingerprint, completed.fingerprint); assert.equal(completed.rowCount, 400);
  assert.equal(exactTaskCandidates([completed], [pending.fingerprint], "库存流水", "EBU-A", "2026-10-01", "2026-10-14",
    { submittedAt: "2026-10-15T12:00:00+08:00", observedAt: "2026-10-15T12:00:01+08:00" }).length, 0);
});
test("a closed CDP port is established by TCP refusal rather than a second close return value", async () => {
  const server = createServer(socket => socket.end());
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const port = address.port;
  assert.equal(await logisticsDebugPortClosed(port), false);
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  assert.equal(await logisticsDebugPortClosed(port), true);
});
test("unresolved manifests and altered download paths refuse reuse before any browser launch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jd-logistics-export-test-"));
  const options = { root, runId: "r1", executionId: "e1", operationId: "o1", sourceKind: "flow", departmentId: "d1",
    businessUnitCode: "EBU-A", rangeStart: "2026-10-01", rangeEnd: "2026-10-15", warehouseCode: "",
    contractVersion: "jd-logistics-v1", downloadDirectory: path.join(root, "export"), assertOwner: async () => undefined,
    store: { storeKey: "test", enabled: true, platform: "京东", accountLabel: "synthetic", shopName: "synthetic", shopId: "1",
      browser: { executablePath: "absent", userDataDir: root, profileName: "Default", profileDir: root, debugPort: 1, downloadDir: root } },
  } satisfies JdLogisticsExportOptions;
  try {
    const { mkdir } = await import("node:fs/promises"); await mkdir(options.downloadDirectory);
    const manifest = { version: 2, identity: logisticsExportIdentity(options), stage: "submitting" };
    await writeFile(path.join(options.downloadDirectory, "export-manifest.json"), JSON.stringify(manifest));
    await assert.rejects(exportJdLogistics(options), /UNRESOLVED_NO_RESUBMIT/);
    await writeFile(path.join(options.downloadDirectory, "export-manifest.json"), JSON.stringify({ ...manifest,
      stage: "downloaded", result: { filePath: path.join(root, "outside.xlsx") }, rawFileHash: "a".repeat(64) }));
    await assert.rejects(exportJdLogistics(options), /REUSE_PATH_MISMATCH/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function jhOptions(sourceKind: "realtime_inventory" | "inventory_snapshot" = "realtime_inventory"): JdLogisticsExportOptions {
  return { root: "D:/synthetic", runId: "r1", executionId: "e1", operationId: "o1", sourceKind, departmentId: "d1", businessUnitCode: "EBU-A",
    rangeStart: sourceKind === "realtime_inventory" ? "2026-10-15" : "2026-10-14", rangeEnd: sourceKind === "realtime_inventory" ? "2026-10-16" : "2026-10-15", warehouseCode: "",
    contractVersion: "jd-logistics-v1", downloadDirectory: "D:/synthetic/downloads", assertOwner: async () => undefined,
    store: { storeKey: "synthetic", enabled: true, platform: "京东", accountLabel: "synthetic", shopName: "synthetic", shopId: "1",
      browser: { executablePath: "absent", userDataDir: "absent", profileDir: "absent", profileName: "Default", debugPort: 1, downloadDir: "absent" } } };
}
const signed = "https://s3.cn-north-1.jdcloud-oss.com/synthetic.xlsx?one=1&amp;two=2";
function task(id = 101, changes: Record<string, unknown> = {}) {
  return { id, filesName: "仓储-实时库存监控明细表2026年10月15日", createTime: "2026-10-15 12:00:00", filesStatus: 100,
    deptNo: null, sourceMenu: "仓储-实时库存监控", systemSource: "数据看板", filesUrl: signed, ...changes };
}
function page(records: unknown[], total = records.length): JhLogisticsTaskPage {
  return parseJhLogisticsTaskPage({ success: true, data: records, pageNum: 1, pageSize: 10, total, pages: Math.ceil(total / 10) }, { pageNum: 1, pageSize: 10 });
}
const sourceWindow = { submittedAt: "2026-10-15T12:00:00.120+08:00", observedAt: "2026-10-15T12:00:04+08:00" };
function baseline() { return page([task(100, { createTime: "2026-10-15 11:59:59", filesStatus: 0, filesUrl: null })]); }
test("JH page validates real first-page shape, safe IDs and monotonic source order", () => {
  assert.equal(page([task(), task(100, { createTime: "2026-10-15 11:59:59" })]).records[0].id, 101);
  assert.throws(() => page([task(Number.MAX_SAFE_INTEGER + 1)]), /TASK_RECORD_INVALID/);
  assert.throws(() => page([task(100), task(101)]), /TASK_ORDER_UNPROVEN/);
  assert.throws(() => page([task(101, { createTime: "2026-10-15 11:59:59" }), task(100)]), /TASK_ORDER_UNPROVEN/);
  assert.throws(() => parseJhLogisticsTaskPage({ success: true, data: [task()], total: 11, pages: 2, pageNum: 1, pageSize: 10 }, { pageNum: 1, pageSize: 10 }), /PAGE_INCOMPLETE/);
  assert.throws(() => parseJhLogisticsTaskPage({ success: true, data: [task()], total: 1, pages: 1, pageNum: 1, pageSize: 10 }, { pageNum: 2, pageSize: 10 }), /PAGE_INCOMPLETE/);
});
test("JH exact filenames, source enums, late old IDs, department and truncation constrain selection", () => {
  const scope = jhOptions(), before = baseline();
  assert.equal(selectJhLogisticsTask(page([task(), before.records[0]]), before, scope, sourceWindow)?.id, 101);
  for (const changes of [{ filesName: "仓储-实时库存监控明细表2026年10月14日" }, { sourceMenu: "库存快照" }, { systemSource: "other" }, { deptNo: "EBU-AB" }, { createTime: "2026-10-15 11:59:58" }]) {
    assert.equal(selectJhLogisticsTask(page([task(101, changes)]), before, scope, sourceWindow), undefined);
  }
  assert.equal(selectJhLogisticsTask(page([task(99)]), before, scope, sourceWindow), undefined);
  assert.throws(() => selectJhLogisticsTask(page([task(102), task(101)]), before, scope, sourceWindow), /TASK_AMBIGUOUS/);
  const tenNew = Array.from({ length: 10 }, (_, index) => task(120 - index));
  assert.throws(() => selectJhLogisticsTask(page(tenNew, 1443), before, scope, sourceWindow), /PREFIX_TRUNCATED/);
  const snapshot = task(101, { filesName: "仓储监控-库存快照监控_分仓_2026.10.14-2026.10.14", sourceMenu: "仓储监控-库存快照监控" });
  assert.equal(selectJhLogisticsTask(page([snapshot]), before, jhOptions("inventory_snapshot"), sourceWindow)?.id, 101);
});
test("JH state progression keeps one bound numeric task and rechecks readiness without resubmitting", async () => {
  const before = baseline(); const pending = page([task(101, { filesStatus: 0, filesUrl: null }), before.records[0]]);
  const ready = page([task(), before.records[0]]); const reads = [pending, ready, ready]; const bindings: number[] = []; let calls = 0;
  const selected = await awaitJhLogisticsTask({ baseline: before, scope: jhOptions(), submittedAt: sourceWindow.submittedAt,
    readPage: async () => { calls++; return reads.shift()!; }, persistBound: async record => { bindings.push(record.id); }, assertOwner: async () => undefined,
    now: () => new Date(sourceWindow.observedAt), wait: async () => undefined, attempts: 3 });
  assert.equal(selected.id, 101); assert.equal(calls, 3); assert.deepEqual(bindings, [101]); assert.equal(selected.deptNo, null);
});
test("JH a second matching task or changed bound identity refuses late completion", async () => {
  for (const changed of [page([task(102), task(101)]), page([task(101, { createTime: "2026-10-15 12:00:01" })])]) {
    const before = baseline(), reads = [page([task(101, { filesStatus: 0, filesUrl: null })]), changed];
    await assert.rejects(awaitJhLogisticsTask({ baseline: before, scope: jhOptions(), submittedAt: sourceWindow.submittedAt,
      readPage: async () => reads.shift()!, persistBound: async () => undefined, assertOwner: async () => undefined,
      now: () => new Date(sourceWindow.observedAt), wait: async () => undefined, attempts: 2 }), /TASK_AMBIGUOUS|TASK_CHANGED/);
  }
});
test("JH URL handling decodes only amp and never accepts another download origin", async () => {
  assert.equal(jhLogisticsDownloadUrl(signed), "https://s3.cn-north-1.jdcloud-oss.com/synthetic.xlsx?one=1&two=2");
  assert.equal(jhLogisticsDownloadUrl(`${signed}&raw=%26amp%3B`).endsWith("&raw=%26amp%3B"), true);
  for (const bad of ["https://evil.invalid/synthetic.xlsx", "http://s3.cn-north-1.jdcloud-oss.com/a", "https://s3.cn-north-1.jdcloud-oss.com.evil.invalid/a", "https://user@s3.cn-north-1.jdcloud-oss.com/a"]) assert.throws(() => jhLogisticsDownloadUrl(bad), /URL_REJECTED/);
  for (const redirect of [false, true]) {
    const navigations: string[] = [], saved: string[] = [], commands: string[] = []; let gate: ((event: unknown) => void) | undefined;
    const session = { on: (_name: string, callback: typeof gate) => { gate = callback; }, off: () => undefined, detach: async () => undefined,
      send: async (command: string) => { commands.push(command); return {}; } };
    const fake = { context: () => ({ newCDPSession: async () => session }),
      waitForEvent: async () => ({ url: () => jhLogisticsDownloadUrl(signed), failure: async () => null, saveAs: async (target: string) => { saved.push(target); } }),
      goto: async (url: string) => { navigations.push(url); gate!({ requestId: "test", request: { url: redirect ? "https://evil.invalid/redirect" : url } }); await Promise.resolve(); return null; } } as unknown as Page;
    if (redirect) {
      await assert.rejects(downloadJhLogisticsFile(fake, signed, "synthetic.xlsx"), /BROWSER_DOWNLOAD_FAILED/);
      assert.ok(commands.includes("Fetch.failRequest")); assert.equal(saved.length, 0);
    } else {
      await downloadJhLogisticsFile(fake, signed, "synthetic.xlsx"); assert.equal(navigations[0].includes("&amp;"), false); assert.deepEqual(saved, ["synthetic.xlsx"]);
      assert.ok(commands.includes("Fetch.continueRequest"));
    }
  }
});
test("full source scope rejects retained filters before any business submission", () => {
  const options = jhOptions("inventory_snapshot"); const controls = [{ label: "事业部", values: ["EBU-A"], checked: false }, { label: "日期", values: ["2026-10-14"], checked: false }, { label: "仓库状态", values: ["全部"], checked: false }, { label: "商品", values: [""], checked: false }];
  assert.equal(typeof assertLogisticsFullScope(controls, options), "string");
  assert.throws(() => assertLogisticsFullScope(controls.map(control => control.label === "仓库状态" ? { ...control, values: ["启用"] } : control), options), /PARTIAL_SCOPE_FILTER/);
  assert.throws(() => assertLogisticsFullScope([...controls, { label: "商品", values: ["SKU1"], checked: false }], options), /PARTIAL_SCOPE_FILTER/);
  assert.throws(() => assertLogisticsFullScope([], options), /READBACK_UNAVAILABLE/);
});
test("fresh export request enforces the observed full scope and exact business unit", () => {
  const options = jhOptions(); const body = { deptNo: "EBU-A", storeCode: null, storeCodeList: null, goods: "", sellerGoodsSign: "", sortField: "", sortType: "", lasType: "NORMAL", categoryId: null,
    secondCategoryId: null, thirdCategoryId: null, stockQtyFilterZeroFlag: false, pageWareType: "2", pipeline: null };
  assert.equal(typeof assertJhExportRequest(body, options), "string");
  for (const extra of [{ goods: "retained" }, { deptNo: "EBU-AB" }, { stockQtyFilterZeroFlag: true }, { extraFilter: null }]) assert.throws(() => assertJhExportRequest({ ...body, ...extra }, options), /REQUEST_SCOPE_MISMATCH/);
});
test("enabled products bind the fresh RPC task ID and precise numeric department instead of a latest task", () => {
  const unit = "EBU4418046540089";
  const request = [{ params: { status: 1, deptId: "4418046540089", deptNo: unit } }];
  assert.equal(productLogisticsExportTaskId({ success: true, data: "4418061014417" }, request, unit), "4418061014417");
  assert.throws(() => productLogisticsExportTaskId({ success: true, data: "4418061014417" }, [{ params: { ...request[0].params, status: 0 } }], unit), /EXPORT_SCOPE_MISMATCH/);
  assert.throws(() => productLogisticsExportTaskId({ success: true, data: Number.MAX_SAFE_INTEGER + 1 }, request, unit), /TASK_ID_INVALID/);
  const query = [{ ids: [], pageNo: 0, pageSize: 10, taskNameList: ["店铺商品列表"], bizTypeList: ["111"] }];
  const record = { id: "4418061014417", deptId: "4418046540089", taskStatus: "2", taskName: "店铺商品列表", bizType: "111", recordCount: "906", successCount: 0, createTime: "2026-10-15 12:00:00.0",
    taskParams: JSON.stringify({ shopGoodsShopIdList: [1, 2, 3, 4, 5], shopGoodsDeptId: 4418046540089, shopGoodsDeptNo: unit, shopGoodsYn: 1, shopGoodsStatus: 1 }) };
  const records = parseProductLogisticsTaskPage({ success: true, data: { aaData: [record], iDisplayStart: 0, iDisplayLength: 10, iTotalRecords: 1 } }, query);
  const scope = { ...jhOptions(), sourceKind: "shop_products" as const, businessUnitCode: unit };
  assert.equal(selectProductLogisticsTask(records, record.id, scope, sourceWindow)?.recordCount, 906);
  assert.equal(selectProductLogisticsTask(records, record.id, scope, sourceWindow)?.successCount, 0);
  assert.equal(selectProductLogisticsTask(records, record.id, scope, sourceWindow)?.shopCount, 5);
  assert.equal(selectProductLogisticsTask(records, "4418061014418", scope, sourceWindow), undefined);
  assert.throws(() => selectProductLogisticsTask([{ ...record, deptId: "4418046540090" }], record.id, scope, sourceWindow), /TASK_SCOPE_MISMATCH/);
  assert.throws(() => selectProductLogisticsTask([{ ...record, createTime: "2026-10-15 11:59:59.0" }], record.id, scope, sourceWindow), /TASK_SCOPE_MISMATCH/);
  assert.throws(() => selectProductLogisticsTask([{ ...record, taskParams: JSON.stringify({ shopGoodsStatus: 0 }) }], record.id, scope, sourceWindow), /TASK_SCOPE_MISMATCH/);
});
test("fresh all-warehouse JH query excludes the retained enabled subset and binds the exact page total", () => {
  const scope = jhOptions("inventory_snapshot"), request = jhLogisticsQueryRequest(scope);
  const response = { success: true, data: { currPage: 1, pageSize: 20, total: 900, rows: [] } };
  assert.equal(jhLogisticsQueryTotal(response, request, scope), 900);
  assert.throws(() => jhLogisticsQueryTotal({ ...response, data: { ...response.data, total: 600 } }, { ...request, whStatus: 1 }, scope), /QUERY_SCOPE_MISMATCH/);
  assert.throws(() => jhLogisticsQueryTotal({ ...response, data: { ...response.data, total: "900" } }, request, scope), /TOTAL_UNPROVEN/);
  const realtime = jhOptions(); assert.equal(jhLogisticsQueryTotal({ success: true, data: { currPage: 1, total: 427, rows: [] } }, jhLogisticsQueryRequest(realtime), realtime), 427);
});
test("flow direct attachment requires its exact half-open request and explicit type 1 source receipt", () => {
  const scope = { ...jhOptions(), sourceKind: "flow" as const, businessUnitCode: "EBU4418046540089", rangeStart: "2026-10-14", rangeEnd: "2026-10-15" };
  const request = flowLogisticsRequest(scope);
  assert.equal(request[0].stockFlowRequest.startTime, "2026-10-14 00:00:00"); assert.equal(request[0].stockFlowRequest.endTime, "2026-10-15 00:00:00");
  assert.equal(request[0].dateEnd, "2026-10-14"); assert.equal(typeof assertFlowLogisticsRequest(request, scope), "string");
  const query = { success: true, data: { code: 200, success: true, total: 122, stockFlowDataList: Array.from({ length: 10 }, () => ({})) } };
  assert.equal(flowLogisticsQueryTotal(query, request, scope), 122);
  const url = "https://s3-ipv6.cn-north-1.jdcloud-oss.com/eclp-stock-back-oss/export/pub/stock_flow_synthetic.csv";
  const receipt = { success: true, data: { code: 200, success: true, type: 1, msg: url } };
  assert.equal(flowLogisticsAttachment(receipt, request, scope), url);
  assert.throws(() => flowLogisticsAttachment({ ...receipt, data: { ...receipt.data, type: 2 } }, request, scope), /DIRECT_ATTACHMENT_UNPROVEN/);
  assert.throws(() => flowLogisticsAttachment({ ...receipt, data: { ...receipt.data, msg: "https://evil.invalid/stock_flow.csv" } }, request, scope), /URL_REJECTED/);
  assert.throws(() => flowLogisticsAttachment({ ...receipt, data: { ...receipt.data, msg: `${url}?unknown=1` } }, request, scope), /URL_REJECTED/);
  const partial = flowLogisticsRequest(scope); partial[0].stockFlowRequest.bizTypeList = ["subset"] as never[];
  assert.throws(() => assertFlowLogisticsRequest(partial, scope), /REQUEST_SCOPE_MISMATCH/);
});
test("enabled products query and full-scope UI agree on the complete enabled relation count", () => {
  const unit = "EBU4418046540089", options = { ...jhOptions(), sourceKind: "shop_products" as const, businessUnitCode: unit };
  const request = [{ commonPageRequest: { iDisplayStart: 0, iDisplayLength: 10 }, params: { status: 1, deptId: "4418046540089", deptNo: unit } }];
  const response = { success: true, data: { iTotalRecords: 906, iTotalDisplayRecords: 906, aaData: Array.from({ length: 10 }, () => ({})) } };
  assert.equal(productLogisticsQueryTotal(response, request, unit), 906);
  assert.throws(() => productLogisticsQueryTotal(response, [{ ...request[0], params: { ...request[0].params, goodsCode: "subset" } }], unit), /QUERY_SCOPE_MISMATCH/);
  assert.throws(() => productLogisticsQueryTotal({ ...response, data: { ...response.data, iTotalDisplayRecords: 900 } }, request, unit), /TOTAL_UNPROVEN/);
  assert.equal(typeof assertLogisticsFullScope([{ label: "商品状态", values: ["启用"], checked: false }, { label: "商品", values: [""], checked: false }], options), "string");
  assert.throws(() => assertLogisticsFullScope([{ label: "商品状态", values: ["全部"], checked: false }], options), /ENABLED_PRODUCT_SCOPE_MISMATCH/);
});
test("a source4 native download is bound through both fresh task RPCs and its exact attachment URL", () => {
  const taskId = "4418061014417", path = "report/shop_goods_task_list_report-synthetic-20261015.csv";
  assert.equal(typeof productLogisticsDownloadAck({ code: 0, success: true, data: 4418061014417 }, [{ taskId }], taskId), "string");
  assert.throws(() => productLogisticsDownloadAck({ code: 0, success: true, data: 4418061014416 }, [{ taskId }], taskId), /TASK_MISMATCH/);
  const response = { code: 0, success: true, data: `//s3.cn-north-1.jdcloud-oss.com/ka-admin-web/${path}?first=1&amp;second=2` };
  const request = [{ downloadUrl: path, id: taskId }];
  assert.equal(productLogisticsDownloadAttachment(response, request, taskId), `https://s3.cn-north-1.jdcloud-oss.com/ka-admin-web/${path}?first=1&second=2`);
  assert.throws(() => productLogisticsDownloadAttachment(response, [{ downloadUrl: path, id: "4418061014416" }], taskId), /TASK_MISMATCH/);
  assert.throws(() => productLogisticsDownloadAttachment({ ...response, data: response.data.replace("report/shop_goods_task_list_report-synthetic", "report/shop_goods_task_list_report-old") }, request, taskId), /URL_UNPROVEN/);
  assert.throws(() => productLogisticsDownloadAttachment({ ...response, data: response.data.replace("s3.cn-north-1.jdcloud-oss.com", "evil.invalid") }, request, taskId), /URL_REJECTED/);
});
