import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("sales chunk completion claims the session before assembly and fences later chunk writes", async () => {
  const [route, service] = await Promise.all([
    readFile(path.resolve("app/api/imports/sales/chunks/route.ts"), "utf8"),
    readFile(path.resolve("lib/sales/chunked-upload.ts"), "utf8"),
  ]);
  const claimIndex = route.indexOf("await claimSalesUpload(principal, uploadId)");
  const assembleIndex = route.indexOf("await assembleSalesUpload(principal, claim.session)");
  const readStart = service.indexOf("async function readSalesUpload");
  const readEnd = service.indexOf("export async function beginSalesUpload", readStart);
  const readSalesUpload = service.slice(readStart, readEnd);
  assert.ok(claimIndex >= 0 && assembleIndex > claimIndex);
  assert.ok(readStart >= 0 && readEnd > readStart);
  assert.match(readSalesUpload, /service:\s*"writer"/);
  assert.doesNotMatch(readSalesUpload, /service:\s*"reader"/);
  assert.match(service, /reconciled\.chunks/);
  assert.match(service, /adopted\?\.objectKey === objectKey/);
  assert.match(service, /An ambiguous writer read must retain the object/);
  assert.match(service, /upload\.status === "processing"/);
  assert.match(service, /crypto\.randomUUID\(\)/);
  assert.match(service, /toHex\(await sha256\(part\)\) !== chunk\.sha256/);
  assert.match(service, /reconciled\.resultBatchId === resultBatchId/);
  assert.match(service, /bucket\(\)\.list\(\{ prefix: item\.objectPrefix/);
  assert.match(service, /cleanupToken: item\.cleanupToken/);
  assert.match(route, /claim\.kind === "completed"/);
  assert.match(route, /cleanupCompletedSalesUpload/);
});
