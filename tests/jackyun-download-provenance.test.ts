import assert from "node:assert/strict";
import test from "node:test";
import { assertDownloadProvenance } from "../lib/jackyun/download-provenance";

test("OSS fallback requires a whitelisted host and hashed URL without storing the signed URL", () => {
  const valid = {
    runId: "run-20260805",
    module: "inventory" as const,
    policyVersion: "2026-08-06.1",
    downloadId: "2ac0c4f0-1111-4222-8333-123456789abc",
    method: "oss_fallback" as const,
    completedAt: "2026-07-17T01:00:00.000Z",
    originalFileName: "2525143708216076928.xlsx",
    sourceHost: "jackyun-shortterm.oss-cn-zhangjiakou.aliyuncs.com",
    sourceUrlHash: "a".repeat(64),
    sha256: "b".repeat(64),
    bytes: 1024,
  };
  assert.doesNotThrow(() => assertDownloadProvenance(valid));
  assert.throws(() => assertDownloadProvenance({ ...valid, sourceHost: "example.com" }), /允许列表/);
  assert.throws(
    () => assertDownloadProvenance({ ...valid, method: "untrusted" } as never),
    /method 无效/,
  );
  assert.throws(() => assertDownloadProvenance({ ...valid, runId: "" }), /runId/);
  assert.equal("url" in valid, false);
});
