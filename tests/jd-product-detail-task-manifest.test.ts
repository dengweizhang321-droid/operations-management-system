import assert from "node:assert/strict";
import test from "node:test";
import { assertJdProductDetailTaskManifest, isJdProductDetailTaskCreatedNear, selectManifestTaskRow, type JdProductDetailTaskManifest } from "../lib/jd/product-detail-task-manifest";

const base: JdProductDetailTaskManifest = {
  version: 1, status: "submitting", dimension: "SPU", shopId: "701455", startDate: "2026-07-01", endDate: "2026-07-02", baseline: ["old"], createdAt: "2026-07-20T00:00:00.000Z",
};

test("a restarted SPU submission takes over exactly one nearby post-baseline row", () => {
  assert.deepEqual(selectManifestTaskRow(base, [{ fingerprint: "old" }, { fingerprint: "new", createdAt: "2026-07-20 08:00:16" }]), { fingerprint: "new", createdAt: "2026-07-20 08:00:16" });
});

test("a restarted SPU submission never takes over a baseline SKU row", () => {
  assert.equal(selectManifestTaskRow(base, [{ fingerprint: "old" }]), null);
});

test("ambiguous nearby post-baseline SPU rows stop safely", () => {
  assert.throws(() => selectManifestTaskRow(base, [{ fingerprint: "new-a", createdAt: "2026-07-20 08:00:10" }, { fingerprint: "new-b", createdAt: "2026-07-20 08:00:20" }]), /Ambiguous/);
});

test("submitting recovery rejects old/future rows but accepts the Shanghai-near timestamp", () => {
  assert.equal(isJdProductDetailTaskCreatedNear(base.createdAt, "2026-07-20 08:00:16"), true);
  assert.equal(isJdProductDetailTaskCreatedNear(base.createdAt, "2026-07-20 07:55:00"), false);
  assert.equal(isJdProductDetailTaskCreatedNear(base.createdAt, "2026-07-20 08:05:00"), false);
});

test("a SKU manifest cannot be reused for an SPU request", () => {
  const skuManifest: JdProductDetailTaskManifest = { ...base, dimension: "SKU" };
  assert.throws(
    () => assertJdProductDetailTaskManifest(skuManifest, { dimension: "SPU", shopId: skuManifest.shopId, startDate: skuManifest.startDate, endDate: skuManifest.endDate }),
    /does not match/,
  );
});

test("manifest task rows require a uniquely matched persisted fingerprint", () => {
  const manifest: JdProductDetailTaskManifest = { ...base, rowFingerprint: "target" };
  assert.equal(selectManifestTaskRow(manifest, [{ fingerprint: "baseline" }, { fingerprint: "target" }])?.fingerprint, "target");
});
