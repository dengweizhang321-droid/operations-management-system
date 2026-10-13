import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { coordinateWorkbookImport, verifyRecordedWorkbookPublication } from "../lib/jackyun/import-coordination";
import { importRecoveryScope } from "../lib/jackyun/publication-baseline";

test("accepted publication with a lost response resumes adjuncts without replaying import", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-import-coordinate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let imports = 0, adjuncts = 0;
  const options = { checkpointPath: path.join(root, "products.json"), module: "products" as const, runId: "n8n-export-first-8556",
    runDate: "2026-10-13", asOfDate: "2026-10-12", fileName: "products.xlsx", fileSizeBytes: 1000, rawFileHash: "1".repeat(64),
    fingerprint: "exact-file-and-original-baseline", baseUrl: "http://localhost:3000", isRecovery: false, assertOwned: async () => undefined,
    request: (async url => {
      if (String(url).includes("/finish")) { adjuncts++; return Response.json({ ok: true, status: "imported", batch: { id: "products:exact" } }); }
      return Response.json({ ok: true, version: "import-recovery-query-v1", status: "committed_current", scope: { source: "products" }, batch: { id: "products:exact" } });
    }) as typeof fetch,
    perform: async (beforeComplete: (id: string) => Promise<void>) => {
      imports++; await beforeComplete("12345678-1234-1234-1234-123456789000"); throw new Error("response lost after commit");
    } };
  await assert.rejects(coordinateWorkbookImport(options), /response lost/);
  const original = JSON.parse(await readFile(options.checkpointPath, "utf8"));
  assert.equal(original.stage, "complete_intent");
  const resumed = await coordinateWorkbookImport({ ...options, isRecovery: true });
  assert.equal((resumed.batch as { id: string }).id, "products:exact");
  assert.equal(imports, 1); assert.equal(adjuncts, 1);
});

test("unknown results, superseded batches, processing, wrong scopes and lost upload identities never re-submit", async t => {
  for (const status of ["unknown", "committed_superseded", "waiting", "wrong_scope", "uncommitted_upload"]) {
    const root = await mkdtemp(path.join(tmpdir(), "jackyun-import-denial-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    let imports = 0;
    const plan = { runDate: "2026-10-13", asOfDate: "2026-10-12" };
    const options = { ...plan, checkpointPath: path.join(root, "stock.json"), module: "inventory" as const, runId: "n8n-export-first-8556",
      fileName: "stock.xlsx", fileSizeBytes: 1000, rawFileHash: "1".repeat(64), fingerprint: "exact-original", baseUrl: "http://localhost:3000",
      isRecovery: false, assertOwned: async () => undefined,
      perform: async (beforeComplete: (id: string) => Promise<void>) => { imports++; await beforeComplete("original-upload"); throw new Error("lost"); },
      request: (async () => Response.json({ ok: true, version: "import-recovery-query-v1", status,
        scope: status === "wrong_scope" ? { dataset: "age", snapshotDate: "2026-10-13" } : importRecoveryScope("inventory", plan),
        uploadId: "different-upload" })) as typeof fetch };
    await assert.rejects(coordinateWorkbookImport(options));
    const evidence = await readFile(options.checkpointPath);
    await assert.rejects(coordinateWorkbookImport({ ...options, isRecovery: true }));
    assert.equal(imports, 1); assert.deepEqual(await readFile(options.checkpointPath), evidence);
  }
});

test("recorded success cannot be recovered using another workbook identity", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-import-success-")); t.after(() => rm(root, { recursive: true, force: true }));
  const checkpointPath = path.join(root, "stock.json");
  await coordinateWorkbookImport({ checkpointPath, module: "inventory", runId: "run", runDate: "2026-10-13", asOfDate: "2026-10-12",
    fileName: "stock.xlsx", fileSizeBytes: 1000, rawFileHash: "1".repeat(64), fingerprint: "original", baseUrl: "http://localhost:3000",
    isRecovery: false, assertOwned: async () => undefined,
    perform: async before => { await before("original"); return { batch: { id: "batch" } }; } });
  await assert.rejects(verifyRecordedWorkbookPublication({ checkpointPath, module: "inventory", runId: "run",
    outputSha256: "2".repeat(64), baseUrl: "http://localhost:3000", assertOwned: async () => undefined }), /精确发布身份/);
});
