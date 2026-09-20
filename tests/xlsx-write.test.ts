import assert from "node:assert/strict";
import test from "node:test";
import { parseXlsxFirstSheets } from "../lib/imports/xlsx";
import { createXlsxWorkbookBytes } from "../lib/imports/xlsx-write";

test("value-only XLSX writer round-trips multiple sheets and XML-sensitive values", () => {
  const bytes = createXlsxWorkbookBytes([
    {
      name: "中文&表",
      rows: [
        ["文本", "数字", "布尔", "空值"],
        ["<测试>&\"'", 12.5, true, null],
      ],
    },
    { name: "审计", rows: [["状态"], ["完成"]] },
  ]);

  const sheets = parseXlsxFirstSheets(bytes, 2);
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].sheetName, "中文&表");
  assert.deepEqual(sheets[0].rows[1].cells.slice(0, 3), ["<测试>&\"'", 12.5, true]);
  assert.equal(sheets[0].rows[1].cells[3], undefined);
  assert.equal(sheets[1].rows[1].cells[0], "完成");
});

test("value-only XLSX writer requires at least one worksheet", () => {
  assert.throws(() => createXlsxWorkbookBytes([]), /至少需要一个工作表/);
});

test("value-only XLSX writer is byte-deterministic across wall-clock changes", () => {
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-01-01T00:00:00Z");
    const first = createXlsxWorkbookBytes([{ name: "sheet", rows: [["值"], [1]] }]);
    Date.now = () => Date.parse("2027-01-01T00:00:00Z");
    const second = createXlsxWorkbookBytes([{ name: "sheet", rows: [["值"], [1]] }]);
    assert.deepEqual(first, second);
  } finally {
    Date.now = originalNow;
  }
});
