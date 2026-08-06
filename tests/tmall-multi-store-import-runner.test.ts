import assert from "node:assert/strict";
import test from "node:test";

import {
  datesInRange,
  explicitDatesToPlan,
  missingDatesInRange,
  parseRunnerArgs,
  selectReceiptForDate,
  shanghaiYesterday,
  validateImportPayload,
} from "../tools/tmall-multi-store-import-runner";

test("天猫补数日期按上海时区截止昨天且保留中间缺口", () => {
  const now = new Date("2026-08-02T04:00:00Z");
  assert.equal(shanghaiYesterday(now), "2026-08-01");
  assert.deepEqual(datesInRange("2026-07-30", "2026-08-01"), ["2026-07-30", "2026-07-31", "2026-08-01"]);
  assert.deepEqual(missingDatesInRange("2026-07-30", "2026-08-01", ["2026-07-30", "2026-08-01"]), ["2026-07-31"]);
  assert.deepEqual(explicitDatesToPlan(["2026-07-31", "2026-08-01"], ["2026-07-31"]), ["2026-08-01"]);
  assert.deepEqual(explicitDatesToPlan(["2026-07-31", "2026-08-01"], ["2026-07-31"], true), ["2026-07-31", "2026-08-01"]);
  assert.equal(parseRunnerArgs([], now).endDate, "2026-08-01");
  assert.deepEqual(parseRunnerArgs(["--dates", "2026-08-01,2026-07-28,2026-08-01"], now).dates, ["2026-07-28", "2026-08-01"]);
  assert.equal(parseRunnerArgs(["--dates", "2026-08-01", "--force-existing"], now).forceExistingDates, true);
  assert.throws(() => parseRunnerArgs(["--dates", "2026-07-28", "--start-date", "2026-07-28"], now), /不能与 --start-date/);
  assert.throws(() => parseRunnerArgs(["--force-existing"], now), /只能与 --dates/);
  assert.throws(() => parseRunnerArgs(["--end-date", "2026-08-02"], now), /最多补到昨天/);
});

function receipt(hash: string, downloadedAt: string) {
  return {
    receiptPath: `C:\\download\\${hash}.json`,
    filePath: `C:\\download\\${hash}.xls`,
    bytes: new Uint8Array([1]),
    receipt: {
      version: 1 as const,
      storeKey: "tmall-yijiu",
      shopName: "天猫-志高亿玖专卖店",
      businessDate: "2026-07-31",
      fileName: `${hash}.xls`,
      sha256: hash,
      size: 1,
      downloadedAt,
    },
  };
}

test("同日相同哈希可复用，内容不同则停止而不猜测", () => {
  const hashA = "a".repeat(64);
  const same = selectReceiptForDate([receipt(hashA, "2026-08-01T01:00:00Z"), receipt(hashA, "2026-08-01T02:00:00Z")], "2026-07-31");
  assert.equal(same?.receipt.downloadedAt, "2026-08-01T02:00:00Z");
  assert.throws(() => selectReceiptForDate([receipt(hashA, "2026-08-01T01:00:00Z"), receipt("b".repeat(64), "2026-08-01T02:00:00Z")], "2026-07-31"), /内容不同/);
});

test("天猫导入结果必须精确匹配店铺、日期、数据集与 HTTP 状态", () => {
  const payload = {
    ok: true as const,
    status: "imported" as const,
    warnings: [],
    batch: {
      id: "batch-1",
      source: "tmall_product_daily",
      dataset: "spu_daily",
      platform: "天猫",
      shopName: "天猫-志高亿玖专卖店",
      status: "completed",
      warningCount: 0,
      rowCount: 10,
      dateMin: "2026-07-31",
      dateMax: "2026-07-31",
    },
    verification: {
      verified: true,
      parsedRowCount: 10,
      readbackRowCount: 10,
      dataset: "spu_daily",
      platform: "天猫",
      shopName: "天猫-志高亿玖专卖店",
      dateMin: "2026-07-31",
      dateMax: "2026-07-31",
    },
  };
  const store = { shopName: "天猫-志高亿玖专卖店" };
  assert.equal(validateImportPayload(payload, 201, store, "2026-07-31", 10).batchId, "batch-1");
  assert.equal(validateImportPayload({ ...payload, status: "duplicate" }, 200, store, "2026-07-31", 10).batchId, "batch-1");
  assert.throws(() => validateImportPayload({ ...payload, batch: { ...payload.batch, shopName: "B店" } }, 201, store, "2026-07-31", 10), /回查不一致/);
  assert.throws(() => validateImportPayload(payload, 200, store, "2026-07-31", 10), /回查不一致/);
  assert.throws(() => validateImportPayload({ ...payload, status: "duplicate" }, 201, store, "2026-07-31", 10), /回查不一致/);

  const failures = [
    { label: "缺少 verification", payload: { ...payload, verification: undefined } },
    { label: "verification 未通过", payload: { ...payload, verification: { ...payload.verification, verified: false } } },
    { label: "批次行数少于预检", payload: { ...payload, batch: { ...payload.batch, rowCount: 9 } } },
    { label: "解析行数不一致", payload: { ...payload, verification: { ...payload.verification, parsedRowCount: 9 } } },
    { label: "回查行数不一致", payload: { ...payload, verification: { ...payload.verification, readbackRowCount: 9 } } },
    { label: "回查店铺不一致", payload: { ...payload, verification: { ...payload.verification, shopName: "B店" } } },
    { label: "回查日期不一致", payload: { ...payload, verification: { ...payload.verification, dateMax: "2026-07-30" } } },
  ];
  for (const failure of failures) {
    assert.throws(
      () => validateImportPayload(failure.payload, 201, store, "2026-07-31", 10),
      /回查不一致/,
      failure.label,
    );
  }
});
