import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  isConfiguredWorkday,
  previousIsoDate,
  salesPeriodForShanghaiDay,
  selectDateInputIndexes,
  validateSalesWorkbook,
} from "../tools/erp-sales-automation";

test("ERP 销售任务计算当月 1 日至昨天", () => {
  assert.deepEqual(salesPeriodForShanghaiDay("2026-07-17"), {
    startDate: "2026-07-01",
    endDate: "2026-07-16",
  });
});

test("每月 1 日自动导出上个完整自然月", () => {
  assert.deepEqual(salesPeriodForShanghaiDay("2026-07-01"), {
    startDate: "2026-06-01",
    endDate: "2026-06-30",
  });
  assert.equal(previousIsoDate("2026-03-01"), "2026-02-28");
});

test("工作日门禁仅允许周一至周五", () => {
  const weekdays = [1, 2, 3, 4, 5];
  assert.equal(isConfiguredWorkday("2026-07-17", weekdays), true);
  assert.equal(isConfiguredWorkday("2026-07-18", weekdays), false);
  assert.equal(isConfiguredWorkday("2026-07-19", weekdays), false);
});

test("日期输入框按开始和结束语义选择", () => {
  assert.deepEqual(selectDateInputIndexes([
    { index: 0, id: "other", name: "", placeholder: "", value: "" },
    { index: 1, id: "beginTime", name: "startDate", placeholder: "开始时间", value: "2026-07-01 00:00:00" },
    { index: 2, id: "endTime", name: "endDate", placeholder: "结束时间", value: "2026-07-16 23:59:59" },
  ]), { startIndex: 1, endIndex: 2 });
});

test("下载文件必须包含销售导入必要列和数据行", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["发货仓库", "货品编号", "货品成本"],
    ["广东仓", "SKU-1", 100],
  ]), "销售单明细账");
  const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
  assert.deepEqual(validateSalesWorkbook(bytes), {
    sheetName: "销售单明细账",
    headerRow: 1,
    sourceRows: 1,
  });
});
