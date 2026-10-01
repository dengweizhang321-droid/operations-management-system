import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolveNetshopPeriods } from "../lib/netshop/periods";
import type { InsightPeriods } from "../lib/netshop/insights-contract";

const fixtures = JSON.parse(await readFile("lib/netshop/fixtures/periods.synthetic.json", "utf8")) as { databaseRead: boolean; cases: Array<{ input: { startDate: string; endDate: string; kind: string; maximumCurrentDays: number }; expected: InsightPeriods }> };
for (const fixture of fixtures.cases) test(`pure UI adapter equals owning calendar ${JSON.stringify(fixture.input)}`, () => {
  const { startDate, endDate, kind, maximumCurrentDays } = fixture.input;
  assert.deepEqual(resolveNetshopPeriods(startDate, endDate, kind, maximumCurrentDays), fixture.expected);
});
test("custom and rolling intent stay distinct while legacy 730 selection remains supported", () => {
  assert.equal(resolveNetshopPeriods("2026-09-03", "2026-09-04", "custom").previous.startDate, "2026-08-03");
  assert.equal(resolveNetshopPeriods("2026-09-03", "2026-09-04", "rolling").previous.startDate, "2026-09-01");
  assert.equal(resolveNetshopPeriods("2024-01-01", "2025-12-30", "custom", 730).current.days, 730);
  assert.equal(resolveNetshopPeriods("2025-02-28", "2027-02-27", "custom", 730).yearAgo.days, 731);
  assert.throws(() => resolveNetshopPeriods("2024-01-01", "2025-12-30", "custom", 366));
  for (const kind of ["invalid", "last7", "quarter", "month"]) assert.throws(() => resolveNetshopPeriods("2026-09-03", "2026-09-04", kind));
  assert.equal(fixtures.databaseRead, false);
});
