import assert from "node:assert/strict";
import test from "node:test";

import {
  businessDateFromInspection,
  decodeWatchedFilePath,
  validateWatchedBusinessDate,
} from "../tools/tmall-n8n-receipt-import";

test("n8n 文件路径使用规范 Base64 传递且拒绝控制字符", () => {
  const filePath = "D:\\谷歌浏览器\\tmall-yijiu\\商品效果_2026-08-02.xls";
  assert.equal(decodeWatchedFilePath(Buffer.from(filePath, "utf8").toString("base64")), filePath);
  assert.throws(() => decodeWatchedFilePath("%%%"), /Base64/);
  assert.throws(() => decodeWatchedFilePath(Buffer.from("D:\\bad\n.xls", "utf8").toString("base64")), /路径编码无效/);
});

test("n8n 签收只接受单一业务日期并保留格式校验错误", () => {
  assert.equal(businessDateFromInspection({
    errors: [{ code: "MISSING_EXPECTED_DATE_RANGE", message: "待二次校验" }],
    totals: { dateMin: "2026-08-02", dateMax: "2026-08-02" },
  }), "2026-08-02");
  assert.throws(() => businessDateFromInspection({
    errors: [],
    totals: { dateMin: "2026-08-01", dateMax: "2026-08-02" },
  }), /只能覆盖一个/);
  assert.throws(() => businessDateFromInspection({
    errors: [{ code: "MISSING_SPU_ID", message: "缺少商品 ID" }],
    totals: { dateMin: "2026-08-02", dateMax: "2026-08-02" },
  }), /缺少商品 ID/);
  assert.equal(validateWatchedBusinessDate("2026-08-02", "2026-07-28", "2026-08-02"), "2026-08-02");
  assert.throws(() => validateWatchedBusinessDate("2026-07-27", "2026-07-28", "2026-08-02"), /起始日至昨天/);
  assert.throws(() => validateWatchedBusinessDate("2026-08-03", "2026-07-28", "2026-08-02"), /起始日至昨天/);
});
