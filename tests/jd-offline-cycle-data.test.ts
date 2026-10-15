import assert from "node:assert/strict";
import test from "node:test";
import { eventAt, seriesAt, validCycleDay, cyclePreviewAt, type ArbitraryCycleData, type NumericSeries } from "../tools/html/jd-offline-cycle-data";

test("offline series decodes every offset across phases and changing delta runs", () => {
  const series: NumericSeries = { kind: "phase-delta", length: 3650, stride: 30, phases: Array.from({ length: 30 }, (_, phase) => ({ first: phase, runs: [[40, 0], [35, 2], [46, 5]] })) };
  for (let index = 0; index < 3650; index++) {
    const step = Math.floor(index / 30);
    const expected = index % 30 + Math.min(Math.max(0, step - 40), 35) * 2 + Math.max(0, step - 75) * 5;
    assert.equal(seriesAt(series, index), expected);
  }
  assert.equal(seriesAt({ kind: "constant", value: null }, 3649), null);
  assert.equal(seriesAt({ kind: "constant", value: 0 }, 3649), 0);
  for (const index of [-1, 1.5, NaN, Infinity]) assert.throws(() => seriesAt(series, index));
  assert.throws(() => seriesAt(series, 3650));
  assert.throws(() => seriesAt({ kind: "phase-delta", length: 3650, stride: 1, phases: [{ first: 0, runs: [[1, 2]] }] }, 3));
});

test("offline interval lookups retain exact start boundaries and refuse invalid days", () => {
  const events = [{ from: 1, value: "a" }, { from: 35, value: "b" }, { from: 42, value: "c" }];
  assert.equal(eventAt(events, 0), undefined);
  for (const [day, value] of [[1, "a"], [34, "a"], [35, "b"], [41, "b"], [42, "c"], [3650, "c"]] as const) assert.equal(eventAt(events, day)?.value, value);
  for (const day of [0, -1, 1.5, 3651, NaN, Infinity]) assert.equal(validCycleDay(day), false);
  for (const day of [1, 35, 42, 3650]) assert.equal(validCycleDay(day), true);
  const health = { inventoryHealthState: "insufficient_evidence", inventoryHealthReasons: ["unknown"], healthCounts: { insufficient_evidence: 1 }, hasStockout: false, hasReplenishmentNeed: false };
  const data: ArbitraryCycleData = { min: 1, max: 3650, default: 30, masks: {}, groups: { unknown: { quantitySeries: { kind: "constant", value: null }, reasons: ["missing"], hasMembers: true, healthEvents: [{ from: 1, projection: health }] } } };
  assert.deepEqual(cyclePreviewAt(data, "unknown", 42), { ...health, quantity: null, days: 42, cycles: [42], reasons: ["missing"] });
  assert.equal(cyclePreviewAt(data, "unknown", 3651), undefined);
  assert.equal(cyclePreviewAt(data, "missing", 42), undefined);
});
