import assert from "node:assert/strict";
import test from "node:test";
import { waitForJdLogisticsIdentity } from "../tools/jd-logistics-export";
const expected = "EBU4418046540089";

test("logistics waits for a department field that hydrates after the iframe body", async () => {
  let reads = 0, waits = 0;
  const result = await waitForJdLogisticsIdentity(async () => ++reads < 4 ? [] : [expected, expected], new Set(), expected, async () => { waits++; });
  assert.equal(result, expected); assert.equal(reads, 4); assert.equal(waits, 3);
});
test("different and ambiguous source identities fail immediately without a wait", async () => {
  for (const observed of [["EBU123"], [expected, "EBU123"]]) {
    let waits = 0;
    await assert.rejects(waitForJdLogisticsIdentity(async () => observed, new Set(), expected, async () => { waits++; }), /BUSINESS_UNIT_MISMATCH/);
    assert.equal(waits, 0);
  }
});
test("missing source evidence never substitutes the configured department", async () => {
  let reads = 0, waits = 0;
  await assert.rejects(waitForJdLogisticsIdentity(async () => { reads++; return []; }, new Set(), expected, async () => { waits++; }), /BUSINESS_UNIT_NOT_READY/);
  assert.equal(reads, 40); assert.equal(waits, 39);
});
test("fresh captured evidence is retained and visible disagreement still rejects", async () => {
  assert.equal(await waitForJdLogisticsIdentity(async () => [], new Set([expected]), expected), expected);
  await assert.rejects(waitForJdLogisticsIdentity(async () => ["EBU123"], new Set([expected]), expected), /BUSINESS_UNIT_MISMATCH/);
});
