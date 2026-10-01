import test from "node:test";
import assert from "node:assert/strict";
import { panoramaFinanceReadPlan } from "../app/netshop/panorama/contract";
import { resolveNetshopPeriods } from "../lib/netshop/periods";
import { panoramaFixture } from "./netshop-panorama-fixture";

test("financial reads preserve each actual independent month window and native shop identity", () => {
  const context = panoramaFixture().context;
  context.periods = resolveNetshopPeriods("2026-09-29", "2026-09-30");
  const plan = panoramaFinanceReadPlan(context);
  assert.equal(plan.requests.length, 3);
  assert.deepEqual(plan.requests.map(request => request.months), [["2026-09"], ["2026-08"], ["2025-09"]]);
  assert.deepEqual(plan.requests[0].shopKeys, ['["京东","合成店A"]']);
  assert.deepEqual(plan.periodReadRefs, { current: 0, previous: 1, yearAgo: 2 });
  assert.deepEqual(plan.annualReadRefs, [0]);
});

test("cross-year selection reads both existing full-year targets and never manufactures a month target", () => {
  const context = panoramaFixture().context;
  context.periods = resolveNetshopPeriods("2025-12-31", "2026-01-02");
  const plan = panoramaFinanceReadPlan(context);
  assert.equal(plan.requests.length, 4);
  assert.deepEqual(plan.requests[0].months, ["2025-12", "2026-01"]);
  assert.deepEqual(plan.annualReadRefs.map(index => plan.requests[index].year), ["2025", "2026"]);
  assert.deepEqual(plan.requests[3].months, plan.requests[0].months);
  assert.equal(plan.requests[3].year, "2026");
});

test("366-day selection and 367-day actual year-ago remain separate bounded natural month reads", () => {
  const context = panoramaFixture().context;
  context.periods = resolveNetshopPeriods("2024-03-01", "2025-03-01", "rolling");
  assert.equal(context.periods.yearAgo.days, 367);
  const plan = panoramaFinanceReadPlan(context);
  assert.equal(plan.requests.length, 4);
  assert.deepEqual(plan.requests.map(request => request.months.length), [13, 12, 13, 13]);
  assert.equal(plan.requests[plan.periodReadRefs.yearAgo].months[0], "2023-03");
  assert.equal(plan.requests[plan.periodReadRefs.yearAgo].months.at(-1), "2024-03");
});

test("identical month and annual requests are reused without losing three period references", () => {
  const context = panoramaFixture().context;
  context.periods.previous = { ...context.periods.current };
  context.periods.yearAgo = { ...context.periods.current };
  const plan = panoramaFinanceReadPlan(context);
  assert.equal(plan.requests.length, 1);
  assert.deepEqual(plan.periodReadRefs, { current: 0, previous: 0, yearAgo: 0 });
  assert.deepEqual(plan.annualReadRefs, [0]);
});
