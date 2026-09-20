import assert from "node:assert/strict";
import test from "node:test";
import { jdDateRangeEchoMatches } from "../lib/jd/product-detail-selection";

test("accepts both endpoints for a date range", () => {
  assert.equal(jdDateRangeEchoMatches("\u5f53\u524d\uff1a2026-07-01 ~ 07-19", "2026-07-01", "2026-07-19"), true);
  assert.equal(jdDateRangeEchoMatches("\u5f53\u524d\uff1a2026-07-01 ~ 07-18", "2026-07-01", "2026-07-19"), false);
});

test("rejects every range separator for a single-day selection", () => {
  assert.equal(jdDateRangeEchoMatches("\u5f53\u524d\uff1a2026-07-18", "2026-07-18", "2026-07-18"), true);
  assert.equal(jdDateRangeEchoMatches("\u5f53\u524d\uff1a2026-07-18 ~ 07-19", "2026-07-18", "2026-07-18"), false);
  assert.equal(jdDateRangeEchoMatches("\u5f53\u524d\uff1a2026-07-18 \u81f3 07-19", "2026-07-18", "2026-07-18"), false);
});
