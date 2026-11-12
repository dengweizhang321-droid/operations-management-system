import assert from "node:assert/strict";
import test from "node:test";
import { COVERAGE_GAPS_GROUPED_RULE, GAP_GROUPS_KEY, NetshopAiCompaction, compactDates, datesToRangeStrings, expandRangeStrings, restoreCoverageGaps } from "../lib/ai/netshop-ai-compaction";

type Plain = Record<string, any>;
const span = (start: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

test("range strings are lossless: cross-month, cross-year, leap day, single day, empty", () => {
  const cases: string[][] = [
    span("2026-08-29", 6), span("2026-12-30", 5), ["2028-02-28", "2028-02-29", "2028-03-01"], ["2026-09-01"], [],
    ["2026-09-01", "2026-09-03", "2026-09-05", "2026-09-06"], span("2026-01-01", 366),
  ];
  for (const dates of cases) assert.deepEqual(expandRangeStrings(datesToRangeStrings(dates)), dates);
  assert.deepEqual(datesToRangeStrings(span("2026-09-01", 7)), ["2026-09-01~2026-09-07"]);
  assert.deepEqual(datesToRangeStrings(["2026-09-01"]), ["2026-09-01"]);
  assert.deepEqual(datesToRangeStrings(["2028-02-28", "2028-02-29", "2028-03-01"]), ["2028-02-28~2028-03-01"]);
});

test("compactDates converts only when strictly shorter, and never for unordered or duplicate input", () => {
  // One missing day: the plain list is already shorter, so nothing changes.
  assert.deepEqual(compactDates(["2026-09-01"], "missingRanges"), { dates: ["2026-09-01"] });
  // Every-other-day gaps would grow; stay as dates.
  const sparse = ["2026-09-01", "2026-09-03", "2026-09-05", "2026-09-07"];
  assert.deepEqual(compactDates(sparse, "missingRanges"), { dates: sparse });
  // A long run shrinks.
  const run = span("2026-09-01", 10);
  assert.deepEqual(compactDates(run, "missingRanges"), { missingRanges: ["2026-09-01~2026-09-10"] });
  // Unordered / duplicate lists could not be expanded back identically, so they are kept verbatim.
  const unordered = ["2026-09-03", "2026-09-01", "2026-09-02", "2026-09-04", "2026-09-05", "2026-09-06"];
  assert.deepEqual(compactDates(unordered, "missingRanges"), { dates: unordered });
  const dup = ["2026-09-01", "2026-09-01", "2026-09-02"];
  assert.deepEqual(compactDates(dup, "missingRanges"), { dates: dup });
  assert.deepEqual(compactDates([], "missingRanges"), { dates: [] });
  // Output is never longer than the original form.
  for (const dates of [run, sparse, ["2026-09-01"], span("2026-02-20", 30)]) {
    const out = compactDates(dates, "missingRanges");
    assert.ok(JSON.stringify(out).length <= JSON.stringify({ dates }).length);
  }
});

test("identical gap entries are grouped, restore is lossless, and the grouped form is shorter", () => {
  const gap = (shop: string, dates: string[]) => ({ expectedShopDatePairs: 14, coveredShopDatePairs: 13, complete: false, truncated: false, missingByShop: [{ shopKey: `京东\u001f${shop}`, dates }] });
  const coverage: Plain = {};
  for (let i = 0; i < 20; i++) coverage[`promotion:object:${String(i).padStart(16, "0")}:current`] = gap(i % 2 ? "A" : "B", ["2026-09-04"]);
  coverage["promotion:summary:current"] = gap("C", span("2026-09-01", 8));
  coverage["promotion:ok"] = { expectedShopDatePairs: 14, coveredShopDatePairs: 14, complete: true, missingByShop: [], truncated: false };
  coverage["promotion:odd"] = { expectedShopDatePairs: 1, coveredShopDatePairs: 0, complete: false, truncated: true, missingByShop: [] };
  const c = new NetshopAiCompaction();
  const kept = c.keepCoverageGaps("sections.coverage", coverage);
  const expected = Object.fromEntries(Object.entries(coverage).filter(([, v]) => v.complete === false));
  assert.deepEqual(restoreCoverageGaps(kept), expected);
  assert.equal(Object.keys(restoreCoverageGaps(kept)).length, 22, "no gap entry lost");
  assert.ok(JSON.stringify(kept).length < JSON.stringify(expected).length);
  const groups = kept[GAP_GROUPS_KEY] as Array<{ refs: string[]; value: Plain }>;
  assert.equal(groups.length, 2, "two distinct values among the 20 object entries");
  assert.equal(groups.reduce((n, g) => n + g.refs.length, 0), 20);
  assert.ok(c.sections.some(s => s.path === "sections.coverage" && s.rule === COVERAGE_GAPS_GROUPED_RULE));
  assert.match(c.mark().note, /_groupedByValue/);
  // Complete entries are folded away on purpose; the odd truncated entry stays whole.
  assert.equal("promotion:ok" in kept, false);
  assert.deepEqual(kept["promotion:odd"], coverage["promotion:odd"]);
});

test("grouping is skipped when it would not be shorter, and the note then does not mention it", () => {
  const gap = (n: number) => ({ expectedShopDatePairs: n, coveredShopDatePairs: 0, complete: false, truncated: false, missingByShop: [{ shopKey: "京东\u001fA", dates: ["2026-09-01"] }] });
  const coverage = { "a": gap(1), "b": gap(2), "c": gap(3) };
  const c = new NetshopAiCompaction();
  const kept = c.keepCoverageGaps("sections.coverage", coverage);
  assert.equal(GAP_GROUPS_KEY in kept, false);
  assert.deepEqual(restoreCoverageGaps(kept), coverage);
  assert.doesNotMatch(c.mark().note, /_groupedByValue/);
});
