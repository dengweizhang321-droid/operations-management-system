import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import * as XLSX from "xlsx";

import { inspectTmallImportBytes } from "../lib/netshop/import-service";
import { inspectTmallMasterFile } from "../tools/tmall-product-master-export";
import {
  chooseTmallOnSaleHeaderCheckbox,
  chooseTmallOnSaleNextPageCandidate,
  chooseTmallPagewiseExportRecords,
  chooseTmallOnSalePaginationRegions,
  decideTmallPagewiseAuditRecovery,
  expectedTmallPageItemCount,
  mergeTmallPagewiseProductWorkbooks,
  normalizeTmallPagewiseAuditForWrite,
  parseTmallOnSalePagination,
  submitTmallPagewiseExportAction,
} from "../tools/tmall-pagewise-product-master-export";

const headers = [
  "商品Id", "类目id", "类目名称", "商品标题", "一口价", "导购标题", "商家编码", "发货时间",
  "最长发货时间", "销售属性", "属性对", "发货时间", "skuId", "价格（元）", "数量", "商家编码",
  "生产日期（年/月/日）", "保质期",
];

function masterWorkbook(rows: Array<{ productId: string; skuId: string; skuCode: string }>) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["发布模板"],
    [null],
    headers,
    ...rows.map((row) => [
      row.productId, "cat", "测试类目", `测试商品-${row.productId}`, "10.00", null, `ITEM-${row.productId}`, 2,
      15, "颜色:红", null, null, row.skuId, "9.90", 5, row.skuCode, null, null,
    ]),
  ]), "发布模板");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}

test("出售中分页必须同时核对商品总数、当前页和按 20 条计算的总页数", () => {
  assert.deepEqual(parseTmallOnSalePagination("共134件商品  1 / 7"), {
    totalProducts: 134,
    currentPage: 1,
    totalPages: 7,
  });
  assert.equal(parseTmallOnSalePagination("共134件商品 1/6"), null);
  assert.equal(parseTmallOnSalePagination("共134件商品 1/7 2/7"), null);
  assert.equal(parseTmallOnSalePagination("1/7"), null);
  assert.equal(expectedTmallPageItemCount(134, 7, 1), 20);
  assert.equal(expectedTmallPageItemCount(134, 7, 7), 14);
  assert.throws(() => expectedTmallPageItemCount(134, 6, 6), /分页参数无效/);
});

test("出售中分页只接受商品总数附近的唯一稳定区域，不受页面其他页码干扰", () => {
  assert.deepEqual(chooseTmallOnSalePaginationRegions([
    "共134件商品 上一页 1 / 7 下一页",
    "商品巡检 1/1",
  ]), {
    totalProducts: 134,
    currentPage: 1,
    totalPages: 7,
  });
  assert.equal(chooseTmallOnSalePaginationRegions([
    "共134件商品 1/7",
    "共134件商品 2/7",
  ]), null);
  assert.equal(chooseTmallOnSalePaginationRegions([
    "共134件商品 1/7 2/7",
  ]), null);
});

test("重复商品标题 DOM 只要指向同一全选框即可合并，真正的并列全选框仍失败关闭", () => {
  assert.deepEqual(chooseTmallOnSaleHeaderCheckbox([
    { signature: "same-checkbox", score: 96 },
    { signature: "same-checkbox", score: 92 },
  ]), { signature: "same-checkbox", score: 96 });
  assert.equal(chooseTmallOnSaleHeaderCheckbox([
    { signature: "first-checkbox", score: 96 },
    { signature: "second-checkbox", score: 96 },
  ]), null);
  assert.deepEqual(chooseTmallOnSaleHeaderCheckbox([
    { signature: "near-checkbox", score: 97 },
    { signature: "far-checkbox", score: 91 },
  ]), { signature: "near-checkbox", score: 97 });
});

test("下一页父子 DOM 优先选择可操作控件，真正同分的两个下一页入口仍失败关闭", () => {
  assert.deepEqual(chooseTmallOnSaleNextPageCandidate([
    { signature: "same-next", score: 900 },
    { signature: "same-next", score: 1_500 },
  ]), { signature: "same-next", score: 1_500 });
  assert.deepEqual(chooseTmallOnSaleNextPageCandidate([
    { signature: "container", score: 720 },
    { signature: "actionable", score: 1_520 },
  ]), { signature: "actionable", score: 1_520 });
  assert.equal(chooseTmallOnSaleNextPageCandidate([
    { signature: "first-next", score: 1_520 },
    { signature: "second-next", score: 1_520 },
  ]), null);
});

test("逐页清单在点击未决时失败关闭，预检失败可安全重试，已提交任务跨日只恢复原快照", () => {
  const audit = (stage: "planned" | "browser_ready" | "page_export_submitting" | "page_export_submitted", taskCount = 0) => ({
    snapshotDate: "2026-08-22",
    stage,
    tasks: Array.from({ length: taskCount }, (_, index) => ({ page: index + 1, itemCount: 20, submittedAt: "2026-08-22T10:30:00Z" })),
    files: [],
  });
  assert.deepEqual(decideTmallPagewiseAuditRecovery("2026-08-23", audit("page_export_submitting")), {
    action: "block", snapshotDate: "2026-08-22",
  });
  assert.deepEqual(decideTmallPagewiseAuditRecovery("2026-08-23", audit("page_export_submitted", 1)), {
    action: "resume_previous", snapshotDate: "2026-08-22",
  });
  assert.deepEqual(decideTmallPagewiseAuditRecovery("2026-08-23", audit("planned")), {
    action: "discard", snapshotDate: "2026-08-23",
  });
  assert.deepEqual(decideTmallPagewiseAuditRecovery("2026-08-23", audit("browser_ready")), {
    action: "discard", snapshotDate: "2026-08-23",
  });
});

test("逐页导出只有在唯一业务控件已解析后才记录点击未决", async () => {
  const failedCalls: string[] = [];
  await assert.rejects(() => submitTmallPagewiseExportAction({
    resolveAction: async () => {
      failedCalls.push("resolve");
      throw new Error("菜单尚未出现");
    },
    markSubmitting: async () => { failedCalls.push("mark"); },
  }), /菜单尚未出现/);
  assert.deepEqual(failedCalls, ["resolve"]);

  const calls: string[] = [];
  const submittedAt = await submitTmallPagewiseExportAction({
    resolveAction: async () => {
      calls.push("resolve");
      return async () => { calls.push("click"); };
    },
    markSubmitting: async (value) => { calls.push(`mark:${value}`); },
    now: () => "2026-08-23T06:03:40.000Z",
  });
  assert.equal(submittedAt, "2026-08-23T06:03:40.000Z");
  assert.deepEqual(calls, ["resolve", "mark:2026-08-23T06:03:40.000Z", "click"]);
});

test("失败后成功续接的最终审计不保留陈旧错误", () => {
  assert.equal(normalizeTmallPagewiseAuditForWrite({ stage: "downloading", lastError: "旧错误" }).lastError, "旧错误");
  assert.equal(normalizeTmallPagewiseAuditForWrite({ stage: "completed", lastError: "旧错误" }).lastError, undefined);
});

test("导出记录只接管本轮全部任务，处理中等待、失败或并发多任务均失败关闭", () => {
  const tasks = [
    { page: 1, itemCount: 20, submittedAt: "2026-08-22T10:30:00.000Z" },
    { page: 2, itemCount: 14, submittedAt: "2026-08-22T10:30:10.000Z" },
  ];
  const record = (patch: Partial<{
    signature: string; recordIdentity: string; taskCreatedAt: string; status: string; downloadReady: boolean;
  }> = {}) => ({
    signature: "one", recordIdentity: "record-one", taskCreatedAt: "2026-08-22 18:30:02", status: "已完成", downloadReady: true,
    ...patch,
  });
  assert.equal(chooseTmallPagewiseExportRecords([record()], tasks), null);
  assert.equal(chooseTmallPagewiseExportRecords([
    record(), record({ signature: "two", recordIdentity: "record-two", taskCreatedAt: "2026-08-22 18:30:12", status: "处理中", downloadReady: false }),
  ], tasks), null);
  assert.deepEqual(chooseTmallPagewiseExportRecords([
    record(), record({ signature: "two", recordIdentity: "record-two", taskCreatedAt: "2026-08-22 18:30:12" }),
  ], tasks)?.map((item) => item.recordIdentity), ["record-one", "record-two"]);
  assert.throws(() => chooseTmallPagewiseExportRecords([
    record(),
    record({ signature: "two", recordIdentity: "record-two", taskCreatedAt: "2026-08-22 18:30:12" }),
    record({ signature: "manual", recordIdentity: "record-manual", taskCreatedAt: "2026-08-22 18:30:14" }),
  ], tasks), /超过预期/);
  assert.throws(() => chooseTmallPagewiseExportRecords([
    record(), record({ signature: "two", recordIdentity: "record-two", taskCreatedAt: "2026-08-22 18:30:12", status: "任务失败" }),
  ], tasks), /明确失败/);
});

test("所有分页先合并为一个权威货品快照，再由现有解析器完整回读", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tmall-pagewise-merge-"));
  const first = path.join(root, "page-1.xlsx");
  const second = path.join(root, "page-2.xlsx");
  const merged = path.join(root, "merged.xlsx");
  const store = {
    shopName: "天猫-志高拓丰专卖店",
    browser: { profileDir: root, debugPort: 9327, downloadDir: root },
  };
  try {
    await writeFile(first, masterWorkbook([
      { productId: "10001", skuId: "20001", skuCode: "SKU-1" },
      { productId: "10002", skuId: "20002", skuCode: "SKU-2" },
    ]));
    await writeFile(second, masterWorkbook([
      { productId: "10003", skuId: "20003", skuCode: "SKU-3" },
    ]));
    const evidence = await mergeTmallPagewiseProductWorkbooks({
      sourceFiles: [first, second], targetPath: merged, store, snapshotDate: "2026-08-22", expectedProductCount: 3,
    });
    assert.equal(evidence.rowCount, 3);
    assert.equal(evidence.uniqueProductCount, 3);
    const bytes = new Uint8Array(await readFile(merged));
    const inspection = await inspectTmallImportBytes({
      source: "tmall_product_master", bytes, fileName: "merged.xlsx", fileSizeBytes: bytes.byteLength,
      platform: "天猫", shopName: store.shopName, snapshotDate: "2026-08-22",
    });
    assert.deepEqual(inspection.errors, []);
    assert.equal(inspection.sheetName, "发布模板");
    assert.equal(inspection.totals.rowCount, 3);
    assert.deepEqual(new Set(inspection.rows.map((row) => row.spuId)), new Set(["10001", "10002", "10003"]));
    const recovered = await mergeTmallPagewiseProductWorkbooks({
      sourceFiles: [first, second], targetPath: merged, store, snapshotDate: "2026-08-22", expectedProductCount: 3,
    });
    assert.equal(recovered.sha256, evidence.sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("分页文件变化后与活动清单证据不一致时禁止合并", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tmall-pagewise-evidence-"));
  const source = path.join(root, "page-1.xlsx");
  const store = { shopName: "天猫-志高拓丰专卖店", browser: { profileDir: root, debugPort: 9327, downloadDir: root } };
  try {
    await writeFile(source, masterWorkbook([{ productId: "10001", skuId: "20001", skuCode: "SKU-1" }]));
    const recorded = await inspectTmallMasterFile(source, store, "2026-08-22");
    await writeFile(source, masterWorkbook([{ productId: "10002", skuId: "20002", skuCode: "SKU-2" }]));
    await assert.rejects(() => mergeTmallPagewiseProductWorkbooks({
      sourceFiles: [source], sourceEvidence: [{ ...recorded, page: 1, taskCreatedAt: "2026-08-22 18:30:00" }],
      targetPath: path.join(root, "merged.xlsx"), store, snapshotDate: "2026-08-22", expectedProductCount: 1,
    }), /活动清单证据不一致/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("已有合并文件与当前分页内容不同即使商品数相同也拒绝续接", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tmall-pagewise-stale-merge-"));
  const source = path.join(root, "page-1.xlsx");
  const merged = path.join(root, "merged.xlsx");
  const store = { shopName: "天猫-志高拓丰专卖店", browser: { profileDir: root, debugPort: 9327, downloadDir: root } };
  try {
    await writeFile(source, masterWorkbook([{ productId: "10001", skuId: "20001", skuCode: "SKU-1" }]));
    await writeFile(merged, masterWorkbook([{ productId: "10002", skuId: "20002", skuCode: "SKU-2" }]));
    await assert.rejects(() => mergeTmallPagewiseProductWorkbooks({
      sourceFiles: [source], targetPath: merged, store, snapshotDate: "2026-08-22", expectedProductCount: 1,
    }), /与当前分页内容不一致/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("分页文件商品重叠或缺页时禁止合并为完整快照", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tmall-pagewise-overlap-"));
  const first = path.join(root, "page-1.xlsx");
  const second = path.join(root, "page-2.xlsx");
  try {
    await writeFile(first, masterWorkbook([{ productId: "10001", skuId: "20001", skuCode: "SKU-1" }]));
    await writeFile(second, masterWorkbook([{ productId: "10001", skuId: "20002", skuCode: "SKU-2" }]));
    await assert.rejects(() => mergeTmallPagewiseProductWorkbooks({
      sourceFiles: [first, second], targetPath: path.join(root, "merged.xlsx"),
      store: { shopName: "天猫-志高拓丰专卖店", browser: { profileDir: root, debugPort: 9327, downloadDir: root } },
      snapshotDate: "2026-08-22", expectedProductCount: 2,
    }), /唯一商品.*不一致/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
