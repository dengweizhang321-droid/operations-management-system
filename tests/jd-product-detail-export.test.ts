import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createSubmittingTaskManifest,
  importJdProductDetailFile,
  isRealtimeSummaryDownloadDialog,
  isStaticCurrentTimestamp,
  isVerifiedJdDateRangeEcho,
  jdDateRangeSelectionPlan,
  taskManifestPath,
  waitForStableTaskBaseline,
} from "../tools/jdsz-product-detail-export";

test("single-day ranges retain the second endpoint click", () => {
  assert.deepEqual(jdDateRangeSelectionPlan("2026-07-21", "2026-07-21"), ["2026-07-21", "2026-07-21"]);
  assert.deepEqual(jdDateRangeSelectionPlan("2026-07-20", "2026-07-21"), ["2026-07-20", "2026-07-21"]);
});

test("a static current-time echo never verifies a custom range", () => {
  const echo = "当前：2026-07-22 09:51:31";
  assert.equal(isStaticCurrentTimestamp(echo), true);
  assert.equal(isVerifiedJdDateRangeEcho(echo, "2026-07-21", "2026-07-21"), false);
});

test("realtime download-settings dialogs are rejected before task submission", () => {
  assert.equal(isRealtimeSummaryDownloadDialog("下载设置\n最多 1000 行\n取消\n确定"), true);
  assert.equal(isRealtimeSummaryDownloadDialog("下载类型\n分天下载\n不包含对比时间\n确定"), false);
});

test("download-center baseline does not accept its first empty loading snapshot", async () => {
  const snapshots = [
    { rows: [], emptyConfirmed: false },
    { rows: [], emptyConfirmed: false },
    { rows: [{ fingerprint: "old" }], emptyConfirmed: false },
    { rows: [{ fingerprint: "old" }], emptyConfirmed: false },
  ];
  let read = 0;
  const baseline = await waitForStableTaskBaseline(async () => snapshots[Math.min(read++, snapshots.length - 1)]!, async () => undefined);
  assert.deepEqual(baseline, [{ fingerprint: "old" }]);
});

test("download-center baseline tolerates a prolonged non-confirmed loading state", async () => {
  const snapshots = [
    ...Array.from({ length: 12 }, () => ({ rows: [], emptyConfirmed: false })),
    { rows: [{ fingerprint: "old" }], emptyConfirmed: false },
    { rows: [{ fingerprint: "old" }], emptyConfirmed: false },
  ];
  let read = 0;
  const baseline = await waitForStableTaskBaseline(async () => snapshots[Math.min(read++, snapshots.length - 1)]!, async () => undefined);
  assert.deepEqual(baseline, [{ fingerprint: "old" }]);
});

test("download-center confirmed empty state returns quickly without a fixed delay", async () => {
  let reads = 0;
  const baseline = await waitForStableTaskBaseline(async () => ({ rows: [], emptyConfirmed: (++reads) >= 1 }), async () => undefined);
  assert.deepEqual(baseline, []);
  assert.equal(reads, 2);
});

test("download-center accepts an empty target-range baseline after other task rows prove the table loaded", async () => {
  let reads = 0;
  const baseline = await waitForStableTaskBaseline(
    async () => ({ rows: [], emptyConfirmed: false, tableReady: (++reads) >= 1 }),
    async () => undefined,
  );
  assert.deepEqual(baseline, []);
  assert.equal(reads, 2);
});

test("daily auto-import rejects a batch whose coverage is not the requested interval", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jdsz-import-"));
  const file = path.join(directory, "daily.xlsx");
  try {
    await writeFile(file, "workbook");
    const options = { baseUrl: "http://localhost:3000", shopName: "示例店", dimension: "SKU" as const, startDate: "2026-07-01", endDate: "2026-07-02" };
    await assert.rejects(
      importJdProductDetailFile(options, file, async () => Response.json({ ok: true, status: "imported", batch: { id: "b", source: "jd_sku_daily", dataset: "sku_daily", platform: "京东", shopName: "示例店", status: "completed", warningCount: 0, rowCount: 2, dateMin: "2026-07-01", dateMax: "2026-07-01" } }, { status: 201 })),
      /failed validation/,
    );
    const result = await importJdProductDetailFile(options, file, async () => Response.json({ ok: true, status: "duplicate", batch: { id: "b", source: "jd_sku_daily", dataset: "sku_daily", platform: "京东", shopName: "示例店", status: "completed", warningCount: 0, rowCount: 2, dateMin: "2026-07-01", dateMax: "2026-07-02" } }, { status: 200 }));
    assert.deepEqual(result, { status: "duplicate", batchId: "b", rowCount: 2, warningCount: 0, dateMin: "2026-07-01", dateMax: "2026-07-02", source: "jd_sku_daily", dataset: "sku_daily", platform: "京东", shopName: "示例店", batchStatus: "completed" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("task manifest path rejects traversal-shaped shop ids", () => {
  assert.throws(() => taskManifestPath({ dimension: "SKU", shopId: "../outside", startDate: "2026-07-01", endDate: "2026-07-02" }), /invalid/);
});

test("daily import requires imported=201 and duplicate=200 exactly", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jdsz-import-"));
  const file = path.join(directory, "daily.xlsx");
  try {
    await writeFile(file, "workbook");
    const options = { baseUrl: "http://localhost:3000", shopName: "示例店", dimension: "SKU" as const, startDate: "2026-07-01", endDate: "2026-07-01" };
    const payload = { ok: true, status: "imported", batch: { id: "b", source: "jd_sku_daily", dataset: "sku_daily", platform: "京东", shopName: "示例店", status: "completed", warningCount: 0, rowCount: 1, dateMin: "2026-07-01", dateMax: "2026-07-01" } };
    await assert.rejects(importJdProductDetailFile(options, file, async () => Response.json(payload, { status: 200 })), /failed validation/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("submitting manifest records the confirmation time, not the older baseline time", () => {
  const preparedAt = new Date("2026-07-20T00:00:00.000Z");
  const confirmedAt = new Date("2026-07-20T00:03:00.000Z");
  const manifest = createSubmittingTaskManifest({ dimension: "SKU", shopId: "701455", startDate: "2026-07-01", endDate: "2026-07-02" }, [{ fingerprint: "old" }], confirmedAt);
  assert.notEqual(manifest.createdAt, preparedAt.toISOString());
  assert.equal(manifest.createdAt, confirmedAt.toISOString());
  assert.deepEqual(manifest.baseline, ["old"]);
});
