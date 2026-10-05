import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validSalesSummary } from "../lib/sales/summary-response";
import { validFinanceAnalysis, validAnnualProgress, validTargetList, validTargetOptions } from "../lib/sales/view-response";
import { validCategoryAnalysis, validCategoryDetail } from "../lib/sales/category-response";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../docs/performance/sales/fixtures/${name}.json`, import.meta.url), "utf8"));
const categoryScope = { startDate: "2026-09-01", endDate: "2026-09-30", page: 1, pageSize: 20, granularity: "day", sortBy: "netSalesCents", direction: "desc" };

test("sales-owned guards accept complete synthetic PostgreSQL endpoint responses", () => {
  assert.ok(validSalesSummary(fixture("core"), "core"));
  assert.ok(validSalesSummary(fixture("full"), "full"));
  assert.ok(validCategoryAnalysis(fixture("category"), categoryScope));
  assert.ok(validCategoryDetail(fixture("detail"), "2026-09-01", "2026-09-30", "合成品类00"));
  assert.ok(validFinanceAnalysis(fixture("finance")));
  assert.ok(validAnnualProgress(fixture("annual"), "2026", 1));
  assert.ok(validTargetList(fixture("targets"), "2026", 1));
  assert.ok(validTargetOptions(fixture("options").options));
});

test("malformed business regions never reach sales rendering", () => {
  const full = fixture("full");
  delete full.shops[0].shareRate; assert.equal(validSalesSummary(full, "full"), false);
  const badOption = fixture("full"); badOption.filterOptions.shops[0] = null;
  assert.equal(validSalesSummary(badOption, "full"), false);
  const count = fixture("full"); count.trendReturned++;
  assert.equal(validSalesSummary(count, "full"), false);
  const category = fixture("category"); category.details.items[0].trend.points[0].netSalesCents = NaN;
  assert.equal(validCategoryAnalysis(category, categoryScope), false);
  assert.equal(validCategoryAnalysis(fixture("category"), { ...categoryScope, page: 2 }), false);
  const finance = fixture("finance"); finance.shops[0].actual.netSalesCents = null;
  assert.equal(validFinanceAnalysis(finance), false);
  const annual = fixture("annual"); annual.items[0].target.version = 0;
  assert.equal(validAnnualProgress(annual, "2026", 1), false);
  assert.equal(validAnnualProgress(fixture("annual"), "2025", 1), false);
  assert.equal(validTargetList(fixture("targets"), "2026", 2), false);
  const options = fixture("options").options; options.shops[0] = null;
  assert.equal(validTargetOptions(options), false);
});
