import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test, { type TestContext } from "node:test";
import { collectionPublicationBaseline, importRecoveryScope } from "../lib/jackyun/publication-baseline";
import type { JackyunModule } from "../lib/jackyun/post-download";

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-original-rules-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = { runId: "n8n-export-first-8548", runDate: "2026-10-13", asOfDate: "2026-10-12", salesStartDate: "2026-08-29" };
  let rules: string | undefined = "9".repeat(64), stateToken = "initial", reads = 0;
  const request: typeof fetch = async input => {
    const query = new URL(String(input)).searchParams; reads++;
    return Response.json({ ok: true, version: "import-recovery-query-v1", status: "ready", stateToken,
      rulesDigest: rules, scope: importRecoveryScope(query.get("module") as JackyunModule, plan) });
  };
  const options = { allowCapture: true, request, baseUrl: "http://localhost:3000", assertOwned: async () => undefined, at: "2026-10-13T00:00:00.000Z" };
  const file = path.join(root, "outputs/jackyun-export-first/publication-baselines", plan.runId + ".json");
  return { root, plan, options, file, changeRules: (value?: string) => { rules = value; }, changeToken: () => { stateToken = "a".repeat(64); }, reads: () => reads };
}

test("recovery compares current rules but never substitutes a new scope token for the original collection", async t => {
  const f = await fixture(t), original = await collectionPublicationBaseline(f.root, f.plan, f.options);
  const bytes = await readFile(f.file); f.changeToken();
  assert.deepEqual(await collectionPublicationBaseline(f.root, f.plan, { ...f.options, allowCapture: false }), original);
  assert.deepEqual(await readFile(f.file), bytes); assert.equal(original.tokens.sales, "initial");
});

test("changed domain code or missing rule identity stops before importing and preserves the original baseline", async t => {
  const f = await fixture(t); await collectionPublicationBaseline(f.root, f.plan, f.options);
  const bytes = await readFile(f.file);
  for (const changed of ["a".repeat(64), undefined]) {
    f.changeRules(changed);
    await assert.rejects(collectionPublicationBaseline(f.root, f.plan, { ...f.options, allowCapture: false }), /RULES_CHANGED_MANUAL_ACTION/);
    assert.deepEqual(await readFile(f.file), bytes);
  }
});

test("creating or changing a public cleaning rule file invalidates prepared-file reuse", async t => {
  const f = await fixture(t); await collectionPublicationBaseline(f.root, f.plan, f.options);
  const { mkdir } = await import("node:fs/promises"); await mkdir(path.join(f.root, "config"));
  await writeFile(path.join(f.root, "config/sales-import-policy.json"), '{"version":"changed"}');
  const reads = f.reads(), bytes = await readFile(f.file);
  await assert.rejects(collectionPublicationBaseline(f.root, f.plan, { ...f.options, allowCapture: false }), /RULES_CHANGED_MANUAL_ACTION/);
  assert.equal(f.reads(), reads); assert.deepEqual(await readFile(f.file), bytes);
});

test("an old unfinished baseline is never silently upgraded with present-day rules", async t => {
  const f = await fixture(t); const baseline = await collectionPublicationBaseline(f.root, f.plan, f.options);
  const old: Partial<typeof baseline> = { ...baseline }; delete old.rules;
  const bytes = JSON.stringify({ ...old, version: "jackyun-publication-baseline-v1" }); await writeFile(f.file, bytes);
  await assert.rejects(collectionPublicationBaseline(f.root, f.plan, f.options), /完整规则证明/);
  assert.equal(await readFile(f.file, "utf8"), bytes);
});
