import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { assertSealedJackyunCloseEvidence } from "../lib/jackyun/n8n-preflight-evidence";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const files = { "outputs/jackyun-import-runs/n8n-export-first-11221/run-manifest.json": "a".repeat(64) };
const census = [{ executionId: "11221", status: "error", startedAt: "2026-11-05T16:10:04.514Z", stoppedAt: "2026-11-05T16:23:06.028Z" }];
const sealed = { evidenceDigest: digest({ files, n8n: census }), files, candidate: census, digest };
const pruned = { anyActive: () => false, row: () => undefined };
const live = {
  anyActive: () => false,
  row: () => ({ id: "11221", status: "error", startedAt: "2026-11-05 16:10:04.514", stoppedAt: "2026-11-05 16:23:06.028", retrySuccessId: null, deletedAt: null }),
};

test("a pruned execution closes only when the sealed evidenceDigest is reproduced", () => {
  assert.deepEqual(assertSealedJackyunCloseEvidence(["11221", "11221", "11221"], sealed, pruned), census);

  // Any drift in the declared census breaks the commitment, so it cannot be
  // used to assert a terminal state the sealed intent never witnessed.
  for (const candidate of [
    [{ ...census[0], status: "canceled" }],
    [{ ...census[0], stoppedAt: "2026-11-05T16:23:06.029Z" }],
    [{ ...census[0], startedAt: "2026-11-05T16:10:04.515Z" }],
  ]) {
    assert.throws(() => assertSealedJackyunCloseEvidence(["11221"], { ...sealed, candidate }, pruned),
      /原闭合证据摘要无法复现/);
  }
  assert.throws(() => assertSealedJackyunCloseEvidence(["11221"], { ...sealed, files: { ...files, extra: "b".repeat(64) } }, pruned),
    /原闭合证据摘要无法复现/);
});

test("the declaration must name this close target and carry an exact failed census", () => {
  assert.throws(() => assertSealedJackyunCloseEvidence(["11222"], sealed, pruned), /原闭合证据与当前闭合目标不一致/);
  assert.throws(() => assertSealedJackyunCloseEvidence(["11221", "11223"], sealed, pruned), /原闭合证据与当前闭合目标不一致/);
  for (const candidate of [
    [{ ...census[0], status: "success" }],
    [{ ...census[0], status: "waiting" }],
    [{ ...census[0], extra: 1 }],
    [{ executionId: "11221", status: "error", startedAt: "2026-11-05T16:10:04.514Z" }],
    [{ ...census[0], startedAt: "2026-11-05T16:23:06.029Z", stoppedAt: "2026-11-05T16:10:04.514Z" }],
  ]) {
    assert.throws(() => assertSealedJackyunCloseEvidence(["11221"], { ...sealed, candidate: candidate as never }, pruned),
      /原闭合证据与当前闭合目标不一致/);
  }
  assert.throws(() => assertSealedJackyunCloseEvidence([], sealed, pruned), /闭合执行身份无效/);
  assert.throws(() => assertSealedJackyunCloseEvidence(["0"], sealed, pruned), /闭合执行身份无效/);
  assert.throws(() => assertSealedJackyunCloseEvidence(["11221"], { ...sealed, evidenceDigest: "nope" }, pruned), /原闭合证据摘要无效/);
});

test("the fallback never applies while n8n still holds the rows or a task is live", () => {
  assert.throws(() => assertSealedJackyunCloseEvidence(["11221"], sealed, live), /原任务证据仍完整/);
  assert.throws(() => assertSealedJackyunCloseEvidence(["11221"], sealed, { ...pruned, anyActive: () => true }),
    /仍有运行或等待中的任务/);
});

test("a surviving row keeps the strict census and must match the sealed one", () => {
  const rows: Record<string, unknown>[] = [
    { id: "11221", status: "waiting", startedAt: "2026-11-05 16:10:04.514", stoppedAt: "2026-11-05 16:23:06.028", retrySuccessId: null, deletedAt: null },
    { id: "11221", status: "error", startedAt: "2026-11-05 16:10:04.514", stoppedAt: null, retrySuccessId: null, deletedAt: null },
    { id: "11221", status: "error", startedAt: "2026-11-05 16:10:04.514", stoppedAt: "2026-11-05 16:23:06.028", retrySuccessId: "9", deletedAt: null },
    { id: "11221", status: "error", startedAt: "2026-11-05 16:10:04.514", stoppedAt: "2026-11-05 16:23:06.028", retrySuccessId: null, deletedAt: "2026-11-05 18:00:00.000" },
  ];
  for (const row of rows) {
    assert.throws(() => assertSealedJackyunCloseEvidence(["11221", "11223"], {
      ...sealed, candidate: [census[0], { ...census[0], executionId: "11223" }],
    }, { anyActive: () => false, row: id => (id === "11221" ? row : undefined) }), /缺少明确失败终态/);
  }
  // Present, terminal, but not the execution the intent sealed.
  assert.throws(() => assertSealedJackyunCloseEvidence(["11221", "11223"], {
    ...sealed, candidate: [census[0], { ...census[0], executionId: "11223" }],
  }, {
    anyActive: () => false,
    row: id => (id === "11221"
      ? { id, status: "crashed", startedAt: "2026-11-05 16:10:04.514", stoppedAt: "2026-11-05 16:23:06.028", retrySuccessId: null, deletedAt: null }
      : undefined),
  }), /与原闭合证据不一致/);
});
