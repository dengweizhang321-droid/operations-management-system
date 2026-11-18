import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { JD_FLOW_CSV_HEADERS_WITH_PLATFORM_ORDER } from "../lib/inventory/jd-logistics-workbook";
import { classifyHourlyRetryFailure } from "../tools/n8n-hourly-retry-policy.mjs";
import { JD_LOGISTICS_SOURCE_FILE_REJECTED_CODE, parseJdLogisticsSourceFile } from "../tools/jd-logistics-source-file";

const repoRoot = path.resolve(import.meta.dirname, "..");

test("a parser refusal becomes one terminal failure code and the parser message goes to stderr once", t => {
  const logged = t.mock.method(console, "error", () => undefined);
  const header = JD_FLOW_CSV_HEADERS_WITH_PLATFORM_ORDER.join(",");
  const tooWide = `${header},多余列\r\n${JD_FLOW_CSV_HEADERS_WITH_PLATFORM_ORDER.map(() => '"x"').join(",")},"y"\r\n`;
  assert.throws(() => parseJdLogisticsSourceFile(new TextEncoder().encode(tooWide), "flow", "EBU0000000000001"), error => {
    assert.ok(error instanceof Error); assert.equal(error.message, JD_LOGISTICS_SOURCE_FILE_REJECTED_CODE); return true;
  });
  assert.equal(logged.mock.callCount(), 1);
  const line = String(logged.mock.calls[0].arguments[0]);
  assert.match(line, /^\[jd-logistics\] source file rejected: CSV超过31列$/); assert.ok(!line.includes("\n"));
});

test("the new code keeps the logistics prefix shape, is terminal for the hourly retry classifier and is not a zero-effect whitelist code", async () => {
  assert.match(JD_LOGISTICS_SOURCE_FILE_REJECTED_CODE, /^JD_LOGISTICS_[A-Z_]+$/); assert.match(JD_LOGISTICS_SOURCE_FILE_REJECTED_CODE, /_MANUAL_ACTION$/);
  const { JD_LOGISTICS_PRE_BUSINESS_FAILURE_CODES } = await import("../tools/jd-logistics-zero-effect-closure");
  assert.ok(!JD_LOGISTICS_PRE_BUSINESS_FAILURE_CODES.includes(JD_LOGISTICS_SOURCE_FILE_REJECTED_CODE));
  const decision = classifyHourlyRetryFailure({ workflow: { id: "jd-logistics" }, execution: { mode: "trigger", error: { message: JD_LOGISTICS_SOURCE_FILE_REJECTED_CODE } } });
  assert.equal(decision.retry, false);
});

test("a malformed binary workbook is rejected through the same code", t => {
  t.mock.method(console, "error", () => undefined);
  assert.throws(() => parseJdLogisticsSourceFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), "flow", "EBU0000000000001"), new RegExp(JD_LOGISTICS_SOURCE_FILE_REJECTED_CODE));
});

test("the exporter and the pipeline parse downloaded source files only through the wrapper", async () => {
  for (const file of ["tools/jd-logistics-export.ts", "tools/jd-logistics-n8n-pipeline.ts"]) {
    const text = await readFile(path.join(repoRoot, file), "utf8");
    assert.ok(!/parseJdLogisticsWorkbook\s*\(/.test(text), `${file} must not call the raw parser`);
    assert.ok(/parseJdLogisticsSourceFile\s*\(/.test(text), `${file} must call the wrapper`);
  }
});
