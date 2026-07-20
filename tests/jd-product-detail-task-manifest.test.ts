import assert from "node:assert/strict";
import test from "node:test";
import { assertJdProductDetailTaskManifest, selectManifestTaskRow, type JdProductDetailTaskManifest } from "../lib/jd/product-detail-task-manifest";

const base: JdProductDetailTaskManifest = {
  version: 1, status: "submitting", dimension: "SPU", shopId: "701455", startDate: "2026-07-01", endDate: "2026-07-02", baseline: ["old"], createdAt: "2026-07-20T00:00:00.000Z",
};

test("a restarted SPU submission takes over exactly one post-baseline row", () => {
  assert.deepEqual(selectManifestTaskRow(base, [{ fingerprint: "old" }, { fingerprint: "new" }]), { fingerprint: "new" });
});

test("a restarted SPU submission never takes over a baseline SKU row", () => {
  assert.equal(selectManifestTaskRow(base, [{ fingerprint: "old" }]), null);
});

test("ambiguous post-baseline SPU rows stop safely", () => {
  assert.throws(() => selectManifestTaskRow(base, [{ fingerprint: "new-a" }, { fingerprint: "new-b" }]), /Ambiguous/);
});

test("a SKU manifest cannot be reused for an SPU request", () => {
  const skuManifest: JdProductDetailTaskManifest = { ...base, dimension: "SKU" };
  assert.throws(
    () => assertJdProductDetailTaskManifest(skuManifest, { dimension: "SPU", shopId: skuManifest.shopId, startDate: skuManifest.startDate, endDate: skuManifest.endDate }),
    /does not match/,
  );
});
