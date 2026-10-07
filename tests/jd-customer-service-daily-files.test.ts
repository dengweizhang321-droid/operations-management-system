import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { buildCustomerServiceDailyFiles } from "../tools/jd-customer-service-daily-files";
const period = { scheduledDate: "2026-10-06", startDate: "2026-09-06", endDate: "2026-10-05" };
const separator = "/*****************以下为一通会话************************************/\n";
function workbook(rows: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["咨询时间", "顾客", "cid", "新平均响应时间(S)"], ...rows,
  ]), "会话");
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
}
const bytes = (value: string) => new TextEncoder().encode(value);
test("自然日分拆保留全部业务值、缺失值和跨截止日消息", () => {
  const source = workbook([
    ["2026-09-06 10:00:00", "synthetic01", "first", "-"],
    ["2026-10-05 23:00:00", "synthetic02", "last", 0],
  ]);
  const log = bytes(separator + "synthetic01 2026-09-06 10:00:00\n测试1\n" + separator
    + "synthetic02 2026-10-05 23:00:00\n测试2\n客服 2026-10-06 09:00:00\n次日回复\n");
  const result = buildCustomerServiceDailyFiles(source, log, period);
  assert.deepEqual(result.files.map(file => file.date), ["2026-09-06", "2026-10-05"]);
  assert.equal(result.conversationCount, 2);
  assert.ok(result.files.every(file => file.normalizedBytes < 16 * 1024 * 1024));
  assert.match(new TextDecoder().decode(result.files[1].chatBytes), /次日回复/);
  assert.deepEqual(buildCustomerServiceDailyFiles(source, log, period).files.map(x => x.contentSha256), result.files.map(x => x.contentSha256));
});
test("跨午夜分拆改变匹配时拒绝，不丢掉前一天候选", () => {
  const source = workbook([
    ["2026-09-06 23:00:00", "synthetic01", "one", 0],
    ["2026-09-06 23:59:30", "synthetic02", "two", 0],
    ["2026-09-07 00:00:30", "synthetic03", "three", 0],
  ]);
  const log = bytes(separator + "synthetic01 2026-09-06 23:00:00\n测试\n" + separator
    + "不唯一的客服 2026-09-07 00:00:00\n测试\n");
  assert.throws(() => buildCustomerServiceDailyFiles(source, log, period), /DAILY_PARTITION_CHANGED_BUSINESS_VALUES/);
});
test("错范围、单边有数、非法编码均失败关闭", () => {
  const source = workbook([["2026-09-06 10:00:00", "synthetic01", "one", 0]]);
  assert.throws(() => buildCustomerServiceDailyFiles(source, bytes(separator + "synthetic01 2026-09-07 10:00:00\n测试\n"), period), /UNPAIRED_SOURCE_DAY/);
  assert.throws(() => buildCustomerServiceDailyFiles(source, bytes(separator + "synthetic01 2026-10-06 10:00:00\n测试\n"), period), /FILE_DATE_OUT_OF_SCOPE/);
  assert.throws(() => buildCustomerServiceDailyFiles(source, new Uint8Array([0xff]), period), /PAIR_PARSE_REJECTED/);
});
