import assert from "node:assert/strict";
import test from "node:test";

import {
  datesInRange,
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
  assert.equal(parseRunnerArgs([], now).endDate, "2026-08-01");
  assert.deepEqual(parseRunnerArgs(["--dates", "2026-08-01,2026-07-28,2026-08-01"], now).dates, ["2026-07-28", "2026-08-01"]);
  assert.throws(() => parseRunnerArgs(["--dates", "2026-07-28", "--start-date", "2026-07-28"], now), /不能与 --start-date/);
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
  };
  assert.equal(validateImportPayload(payload, 201, { shopName: "天猫-志高亿玖专卖店" }, "2026-07-31").batchId, "batch-1");
  assert.throws(() => validateImportPayload({ ...payload, batch: { ...payload.batch, shopName: "B店" } }, 201, { shopName: "天猫-志高亿玖专卖店" }, "2026-07-31"), /回查不一致/);
  assert.throws(() => validateImportPayload(payload, 200, { shopName: "天猫-志高亿玖专卖店" }, "2026-07-31"), /回查不一致/);
});
