import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { importRunDuration, importRunStatus } from "../lib/imports/run-presentation";
import { normalizeShellLocation } from "../app/shell/navigation-contract";

test("in-flight, failed and unknown imports never acquire a green completed status", () => {
  for (const status of ["processing", "running", "pending", "queued", "rejected", "failed", "expired", "future_status", ""]) {
    assert.notEqual(importRunStatus(status, 0).tone, "success");
    assert.notEqual(importRunStatus(status, 3).tone, "success");
  }
  assert.equal(importRunStatus("completed").group, "completed");
  assert.equal(importRunStatus("completed", 3).group, "warning");
  assert.equal(importRunStatus("duplicate").group, "duplicate");
  assert.equal(importRunStatus("partial").group, "warning");
});

test("duration leaves missing, invalid and reversed timestamps unknown", () => {
  assert.equal(importRunDuration("2026-09-10T00:00:00Z", null), "—");
  assert.equal(importRunDuration("invalid", "invalid"), "—");
  assert.equal(importRunDuration("2026-09-10T00:01:00Z", "2026-09-10T00:00:00Z"), "—");
  assert.equal(importRunDuration("2026-09-10T00:00:00Z", "2026-09-10T00:01:20Z"), "1 分 20 秒");
});

test("removed continuity links normalize safely and chain links survive refresh", () => {
  assert.equal(normalizeShellLocation("/?module=import&view=continuity"), "/?module=import");
  assert.equal(normalizeShellLocation("/?module=import&view=chains"), "/?module=import&view=chains");
  assert.equal(normalizeShellLocation("/?module=import&view=history"), "/?module=import&view=history");
});

test("display catalog matches allowlisted workflow definitions without bundling operational configuration", async () => {
  const { buildImportChainCatalog } = await import("../tools/build-import-chain-catalog.mjs");
  const text = await readFile(new URL("../lib/imports/chain-catalog.generated.json", import.meta.url), "utf8");
  const catalog = JSON.parse(text);
  assert.deepEqual(catalog, await buildImportChainCatalog());
  assert.equal(new Set(catalog.rules.map((r: { workflowId: string }) => r.workflowId)).size, catalog.rules.length);
  assert.doesNotMatch(text, /userDataDir|profileDir|debugPort|downloadDir|credentials|httpRequest|localhost:5791/);
  assert.doesNotMatch(text, /"active"|"lastRun"|"nextRun"/);
  const entities = new Set(catalog.entities.map((e: { key: string }) => e.key));
  for (const rule of catalog.rules) {
    assert.ok(rule.entityKeys.every((key: string) => entities.has(key)));
    assert.ok(catalog.chains.some((c: { key: string }) => c.key === rule.chainKey));
  }
});
