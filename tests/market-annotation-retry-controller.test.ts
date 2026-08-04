import assert from "node:assert/strict";
import test from "node:test";

import { AnnotationRunRetryController } from "../lib/market/annotation-retry";

test("ordinary transient cooldown is isolated to the failing worker", () => {
  const retry = new AnnotationRunRetryController(4);

  const first = retry.schedule("transient", 0, 0, 1_000);
  assert.deepEqual(first, {
    kind: "transient",
    scope: "worker",
    delayMs: 5_000,
    blockedUntil: 6_000,
    previousConcurrency: 4,
    concurrency: 3,
    countedIncident: true,
    suppressedByGlobalRateLimit: false,
  });
  assert.equal(retry.blockedUntil(0), 6_000);
  assert.equal(retry.blockedUntil(1), 0);

  const concurrent = retry.schedule("transient", 1, 0, 1_100);
  assert.equal(concurrent.countedIncident, false);
  assert.equal(concurrent.concurrency, 3);
  assert.equal(retry.blockedUntil(0), 6_000);
  assert.equal(retry.blockedUntil(1), 6_100);
  assert.equal(retry.blockedUntil(2), 0);

  const repeated = retry.schedule("transient", 2, 0, 7_000);
  assert.equal(repeated.countedIncident, true);
  assert.equal(repeated.delayMs, 10_000);
  assert.equal(repeated.concurrency, 2);
  assert.equal(retry.blockedUntil(0), 6_000);
  assert.equal(retry.blockedUntil(1), 6_100);
  assert.equal(retry.blockedUntil(2), 17_000);
});

test("provider rate limits block every worker and concurrent responses count once", () => {
  const retry = new AnnotationRunRetryController(8);

  const first = retry.schedule("rate_limit", 3, 0, 10_000);
  assert.equal(first.scope, "global");
  assert.equal(first.delayMs, 60_000);
  assert.equal(first.concurrency, 4);
  assert.equal(retry.blockedUntil(0), 70_000);
  assert.equal(retry.blockedUntil(49), 70_000);

  const concurrent = retry.schedule("rate_limit", 4, 0, 10_100);
  assert.equal(concurrent.countedIncident, false);
  assert.equal(concurrent.concurrency, 4);
  assert.equal(retry.blockedUntil(1), 70_100);

  const transientDuringRateLimit = retry.schedule("transient", 1, 0, 10_200);
  assert.equal(transientDuringRateLimit.countedIncident, false);
  assert.equal(transientDuringRateLimit.suppressedByGlobalRateLimit, true);
  assert.equal(transientDuringRateLimit.concurrency, 4);
  assert.equal(retry.blockedUntil(1), 70_100);
});

test("successful images recover concurrency and a live target update stays bounded", () => {
  const retry = new AnnotationRunRetryController(4);
  retry.schedule("transient", 0, 0, 1_000);
  assert.equal(retry.workerLimit, 3);
  assert.equal(retry.recordSuccess(2).recovered, false);
  assert.deepEqual(retry.recordSuccess(1), { previousConcurrency: 3, concurrency: 4, recovered: true });
  assert.equal(retry.recovering, false);

  retry.updateTarget(6);
  assert.equal(retry.workerLimit, 6);
  retry.schedule("transient", 2, 0, 10_000);
  assert.equal(retry.workerLimit, 5);
  retry.updateTarget(4);
  assert.equal(retry.targetConcurrency, 4);
  assert.equal(retry.workerLimit, 4);
  assert.equal(retry.recovering, false);
});
