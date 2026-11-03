import assert from "node:assert/strict";
import test from "node:test";
import { readImportRecordsPage, type RecordReader } from "../lib/imports/run-records-page";
import type { ImportRecord } from "../lib/imports/run-records-contract";

const rows = (sourceKey: "sales" | "finance", count: number): ImportRecord[] => Array.from({ length: count }, (_, i) => ({
  id: `${sourceKey}-${String(i).padStart(4, "0")}`, sourceKey, sourceLabel: sourceKey, fileName: "synthetic.xlsx", status: "completed",
  rowCount: 1, insertedCount: 1, warningCount: 0, createdAt: "2026-11-03T00:00:00Z", sortAt: `2026-11-03T00:00:00.${String(999999 - i).padStart(6, "0")}+00:00`,
}));
function reader(items: ImportRecord[]): RecordReader {
  return async (page, size) => {
    const subset = items.slice((page - 1) * size, page * size);
    const truncated = page * size < items.length;
    return { items: subset, sources: [], revision: "stable", pagination: { page, pageSize: size, total: items.length, returned: subset.length, truncated, completeness: truncated ? "truncated_do_not_infer_absence" : "complete" } };
  };
}

test("empty range is an explicit complete empty page", async () => {
  const result = await readImportRecordsPage([reader([])], 9, 20);
  assert.deepEqual(result.pagination, { page: 1, pageSize: 20, total: 0, returned: 0, truncated: false, completeness: "complete" });
});
test("last page, shrinking last page, global ties and deep SQL page merging", async () => {
  const a = rows("sales", 163), b = rows("finance", 64);
  const expected = [...a, ...b].sort((a, b) => b.sortAt.localeCompare(a.sortAt) || a.sourceKey.localeCompare(b.sourceKey) || a.id.localeCompare(b.id));
  const result = await readImportRecordsPage([reader(a), reader(b)], 12, 20);
  assert.equal(result.pagination.total, 227);
  assert.equal(result.pagination.returned, 7);
  assert.equal(result.pagination.truncated, false);
  assert.deepEqual(result.items, expected.slice(220));
  const shrunk = await readImportRecordsPage([reader(a.slice(0, 3))], 12, 20);
  assert.equal(shrunk.pagination.page, 1);
  assert.equal(shrunk.items.length, 3);
});
test("filtering is applied before page counting and can be paged independently", async () => {
  const filtered = rows("sales", 45);
  const result = await readImportRecordsPage([reader(filtered)], 2, 20);
  assert.deepEqual(result.items, filtered.slice(20, 40));
  assert.equal(result.pagination.total, 45);
  assert.equal(result.pagination.completeness, "truncated_do_not_infer_absence");
});
test("source failures and changes cannot become an empty or apparently complete result", async () => {
  await assert.rejects(readImportRecordsPage([async () => { throw new Error("unavailable"); }], 1, 20));
  const base = reader(rows("sales", 250));
  await assert.rejects(readImportRecordsPage([async (page, size) => ({ ...await base(page, size), revision: String(page) })], 8, 20), /读取期间发生变化/);
});
test("deep-page cap reports an error without falsifying total", async () => {
  await assert.rejects(readImportRecordsPage([reader(rows("sales", 10100))], 501, 20), /10000/);
});
