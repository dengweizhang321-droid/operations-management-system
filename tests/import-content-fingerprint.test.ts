import assert from "node:assert/strict";
import test from "node:test";

import {
  buildImportAttemptHash,
  buildImportContentFingerprint,
  importScopeStateToken,
} from "../lib/imports/content-fingerprint";

test("业务内容指纹忽略行序、对象键序和明确的技术字段", async () => {
  const first = await buildImportContentFingerprint({
    domain: "test",
    scope: { shop: "A", dataset: "daily" },
    rows: [
      { sourceRowNumber: 2, sku: "B", amount: 20, raw: { y: 2, x: 1 } },
      { sourceRowNumber: 1, sku: "A", amount: 10, raw: { x: 1, y: 2 } },
    ],
    ignoredTopLevelKeys: ["sourceRowNumber"],
  });
  const reordered = await buildImportContentFingerprint({
    domain: "test",
    scope: { dataset: "daily", shop: "A" },
    rows: [
      { sourceRowNumber: 99, amount: 10, raw: { y: 2, x: 1 }, sku: "A" },
      { sourceRowNumber: 88, amount: 20, raw: { x: 1, y: 2 }, sku: "B" },
    ],
    ignoredTopLevelKeys: ["sourceRowNumber"],
  });
  assert.equal(reordered.scopeKey, first.scopeKey);
  assert.equal(reordered.contentHash, first.contentHash);
});

test("任一业务字段、记录数量或业务范围变化都会改变指纹", async () => {
  const base = await buildImportContentFingerprint({ domain: "test", scope: { shop: "A" }, rows: [{ sku: "A", amount: 10 }] });
  const changed = await buildImportContentFingerprint({ domain: "test", scope: { shop: "A" }, rows: [{ sku: "A", amount: 11 }] });
  const duplicated = await buildImportContentFingerprint({ domain: "test", scope: { shop: "A" }, rows: [{ sku: "A", amount: 10 }, { sku: "A", amount: 10 }] });
  const otherScope = await buildImportContentFingerprint({ domain: "test", scope: { shop: "B" }, rows: [{ sku: "A", amount: 10 }] });
  assert.notEqual(changed.contentHash, base.contentHash);
  assert.notEqual(duplicated.contentHash, base.contentHash);
  assert.notEqual(otherScope.contentHash, base.contentHash);
  assert.notEqual(otherScope.scopeKey, base.scopeKey);
});

test("重叠业务范围可以共享稳定写锁，但内容指纹仍保留精确范围", async () => {
  const wide = await buildImportContentFingerprint({
    domain: "finance",
    scope: { source: "monthly-finance-report", months: ["2026-07", "2026-08"] },
    lockScope: { source: "monthly-finance-report" },
    rows: [{ month: "2026-07", amount: 100 }, { month: "2026-08", amount: 100 }],
  });
  const overlapping = await buildImportContentFingerprint({
    domain: "finance",
    scope: { source: "monthly-finance-report", months: ["2026-08", "2026-09"] },
    lockScope: { source: "monthly-finance-report" },
    rows: [{ month: "2026-08", amount: 200 }, { month: "2026-09", amount: 200 }],
  });
  assert.equal(overlapping.scopeKey, wide.scopeKey);
  assert.notEqual(overlapping.contentHash, wide.contentHash);
  assert.notEqual(overlapping.scopeJson, wide.scopeJson);
});

test("导入尝试指纹对同一当前状态稳定，并允许内容版本回滚", async () => {
  const fingerprint = await buildImportContentFingerprint({ domain: "test", scope: { shop: "A" }, rows: [{ sku: "A" }] });
  const first = await buildImportAttemptHash({ fingerprint, currentStateToken: "batch-current" });
  const concurrent = await buildImportAttemptHash({ fingerprint, currentStateToken: "batch-current" });
  const rollback = await buildImportAttemptHash({ fingerprint, currentStateToken: "batch-newer" });
  assert.equal(concurrent, first);
  assert.notEqual(rollback, first);
});

test("粗粒度范围状态令牌与批次数量无关地保持固定长度", async () => {
  const forward = await importScopeStateToken([
    { batchId: "batch-b", rowCount: 2 },
    { batchId: "batch-a", rowCount: 1 },
  ]);
  const reversed = await importScopeStateToken([
    { batchId: "batch-a", rowCount: 1 },
    { batchId: "batch-b", rowCount: 2 },
  ]);
  assert.equal(forward, reversed);
  assert.match(forward, /^[a-f0-9]{64}$/);
  assert.equal(await importScopeStateToken([]), "initial");
});
