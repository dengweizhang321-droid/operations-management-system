import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("sales chunk completion claims the session before assembly and fences later chunk writes", async () => {
  const [route, service] = await Promise.all([
    readFile(path.resolve("app/api/imports/sales/chunks/route.ts"), "utf8"),
    readFile(path.resolve("lib/sales/chunked-upload.ts"), "utf8"),
  ]);
  const claimIndex = route.indexOf("await claimSalesUpload(uploadId)");
  const assembleIndex = route.indexOf("await assembleSalesUpload(uploadId)");
  assert.ok(claimIndex >= 0 && assembleIndex > claimIndex);
  assert.match(service, /WHERE id = \? AND status = 'ready' AND expires_at > \?/);
  assert.match(service, /upload\.status === "processing"/);
  assert.match(service, /WHERE id = \? AND status IN \('uploading', 'ready'\)/);
  assert.match(service, /crypto\.randomUUID\(\)/);
  assert.match(service, /current\?\.object_key !== previous\.object_key/);
  assert.match(service, /toHex\(await sha256\(part\)\) !== chunk\.sha256/);
  assert.match(service, /WHERE id = \? AND status = 'processing'/);
});
