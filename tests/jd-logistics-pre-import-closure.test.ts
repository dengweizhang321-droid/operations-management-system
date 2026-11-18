import assert from "node:assert/strict";
import test from "node:test";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import type { JdLogisticsBinding, JdLogisticsConfig, JdLogisticsSettings } from "../lib/jd/logistics-policy";
import type { JdStore } from "../lib/jd/store-registry";
import { planJdLogisticsN8nRun } from "../tools/jd-logistics-n8n-pipeline";
import { assessJdLogisticsPreImport, assessJdLogisticsZeroEffect, closeJdLogisticsPreImportPlan, inspectJdLogisticsPreImport, JD_LOGISTICS_CREDENTIAL_RISK_SUFFIXES,
  preImportClosureDirectoryName, ZeroEffectRefusal } from "../tools/jd-logistics-zero-effect-closure";
import { runJdLogisticsPreImportCli } from "../tools/jd-logistics-pre-import-closure";

type Draft = { stage: string; outcome: string; baseUrl: string; extra?: number; failure?: { code: string; stage: string; at: string }; notification: Record<string, unknown>;
  operations: Array<{ stage: string; receipt?: unknown; somethingNew?: number; contentHash?: string; rowCount?: number; parserVersion?: string; operationId: string }> };
const now = new Date("2026-11-18T00:50:00.000Z");
const store: JdStore = { storeKey: "jd-test", platform: "京东", enabled: true, accountLabel: "测试", shopName: "测试店", shopId: "10001",
  browser: { executablePath: "unused/chrome.exe", userDataDir: "unused/profiles", profileName: "Default", profileDir: "unused/profiles/Default", debugPort: 9224, downloadDir: "unused/downloads" } };
const kinds = ["flow", "shop_products", "realtime_inventory", "inventory_snapshot"] as const;
const binding = (sourceKind: JdLogisticsBinding["sourceKind"]): JdLogisticsBinding => ({ sourceKind, departmentId: "department-1", businessUnitCode: "00001",
  enabled: true, sourceVerified: true, contractVersion: "jd-logistics-v1", collectorStoreKey: store.storeKey, authorizedStoreKeys: [store.storeKey], warehouseCode: "",
  ...(sourceKind === "flow" ? { initialStartDate: "2026-11-01", maxSpanDays: 31 } : {}) });
const settings = (): JdLogisticsSettings => ({ contractVersion: "jd-logistics-v1", departments: [{ id: "department-1", businessUnitCode: "00001", storeKeys: [store.storeKey],
  logisticsEnabled: true, capabilities: { flow: true, shop_products: true, realtime_inventory: true, inventory_snapshot: true }, revision: 1 }], scopeRevisions: [] });
const request: typeof fetch = async input => {
  const url = new URL(String(input)); assert.equal(url.searchParams.get("operation"), "settings");
  return Response.json({ success: true, data: settings() });
};
const lock = { assertOwned: async () => undefined };
const withLock = async <T>(_root: string, operation: (value: typeof lock) => Promise<T>) => operation(lock);
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const reasonText = "11740 导入前解析失败，确认从未发起导入";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "jd-pre-import-"));
  const config: JdLogisticsConfig = { version: 1, bindings: kinds.map(binding) };
  const directory = path.join(root, "outputs", "jd-logistics-pipeline");
  let counter = 0;
  const plan = (executionId: string) => planJdLogisticsN8nRun({ root, executionId, now, stores: [store], config, request, runIdFactory: () => `run-${executionId}-${++counter}` });
  // The 11740 shape: the first source was exported and downloaded, the parser then refused it, and the pipeline
  // recorded the generic failure code. The first operation is still "exporting"; nothing was ever imported.
  async function failedPlan(executionId = "11740", mutate: (manifest: Draft) => void = () => undefined, withFiles = true) {
    const original = await plan(executionId);
    const manifestFile = path.join(directory, `${original.runId}.json`);
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    manifest.stage = "failed"; manifest.failure = { code: "JD_LOGISTICS_PIPELINE_FAILED_MANUAL_ACTION", stage: "run", at: "2026-11-18T00:51:27.838Z" };
    manifest.operations[0].stage = "exporting";
    mutate(manifest);
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    const operationId = manifest.operations[0].operationId as string;
    const downloads = path.join(directory, "downloads", original.runId, operationId);
    if (withFiles) {
      await mkdir(downloads, { recursive: true });
      await writeFile(path.join(downloads, "export-manifest.json"), JSON.stringify({ stage: "submitted" }));
      await writeFile(path.join(downloads, "source.csv"), "synthetic,csv\r\n1,2\r\n");
    }
    return { runId: original.runId as string, operationId, downloads, active: { runId: original.runId as string, executionId, planHash: original.planHash as string } };
  }
  const read = (name: string) => readFile(path.join(directory, name));
  const activeSha = async () => sha(await read("active.json"));
  const closures = async (prefix: string) => (await readdir(directory)).filter(name => name.startsWith(prefix));
  const snapshot = async () => {
    const out: string[] = [];
    const walk = async (dir: string) => { for (const entry of (await readdir(dir)).sort()) {
      const full = path.join(dir, entry), stat = await lstat(full);
      out.push(`${path.relative(root, full)}:${stat.isDirectory() ? "d" : `${stat.size}:${sha(await readFile(full))}`}`); if (stat.isDirectory()) await walk(full);
    } };
    await walk(root); return out;
  };
  const cli = (...args: string[]) => runJdLogisticsPreImportCli(args, { withLock, now: () => now });
  const confirmArgs = async (reason = reasonText) => ["close", root, "--confirm", "--expect-sha256", await activeSha(), "--reason", reason];
  return { root, directory, plan, failedPlan, read, activeSha, closures, snapshot, cli, confirmArgs };
}
const unresolved = /JD_LOGISTICS_PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION/;

test("11740 shape is closable; the CLI archives active and keeps the failed manifest and every download byte-identical", async () => {
  const f = await fixture(); const old = await f.failedPlan();
  const manifestBefore = await f.read(`${old.runId}.json`), activeBefore = await f.read("active.json");
  const downloadsBefore = [await readFile(path.join(old.downloads, "export-manifest.json")), await readFile(path.join(old.downloads, "source.csv"))];
  // The automatic zero-effect closure still refuses this plan: failure code is outside its whitelist and downloads are not empty.
  assert.equal((await assessJdLogisticsZeroEffect(f.root, old.active)).verdict, "not_closable");
  await assert.rejects(f.plan("exec-auto"), unresolved);
  const verdict = await assessJdLogisticsPreImport(f.root, old.active);
  assert.equal(verdict.verdict, "closable"); assert.deepEqual(verdict.evidence!.downloads.map(file => file.path), [`${old.operationId}/export-manifest.json`, `${old.operationId}/source.csv`]);
  const result = await f.cli(...await f.confirmArgs());
  assert.equal(result.code, 0, result.err);
  const name = preImportClosureDirectoryName("11740", sha(activeBefore));
  assert.deepEqual(JSON.parse(result.out), { ok: true, mode: "confirm", status: "closed", directory: name });
  assert.deepEqual(await f.closures("pre-import-"), [name]); assert.deepEqual(await f.closures("zero-effect-"), []);
  const dir = path.join(f.directory, name);
  assert.deepEqual((await readdir(dir)).sort(), ["active.archived.json", "active.original.json", "committed.json", "intent.json", "manifest.original.json"]);
  assert.ok((await readFile(path.join(dir, "active.archived.json"))).equals(activeBefore)); assert.ok((await readFile(path.join(dir, "active.original.json"))).equals(activeBefore));
  assert.ok((await readFile(path.join(dir, "manifest.original.json"))).equals(manifestBefore)); assert.ok((await f.read(`${old.runId}.json`)).equals(manifestBefore));
  await assert.rejects(lstat(path.join(f.directory, "active.json")));
  assert.ok((await readFile(path.join(old.downloads, "export-manifest.json"))).equals(downloadsBefore[0])); assert.ok((await readFile(path.join(old.downloads, "source.csv"))).equals(downloadsBefore[1]));
  const intent = JSON.parse(await readFile(path.join(dir, "intent.json"), "utf8")), committed = JSON.parse(await readFile(path.join(dir, "committed.json"), "utf8"));
  assert.equal(intent.version, "jd-logistics-pre-import-closure-v1"); assert.equal(intent.kind, "pre_import"); assert.equal(intent.reason, reasonText);
  assert.equal(intent.original.executionId, "11740"); assert.equal(intent.evidence.kind, "pre_import"); assert.equal(intent.evidence.failureCode, "JD_LOGISTICS_PIPELINE_FAILED_MANUAL_ACTION");
  assert.equal(intent.evidence.downloads.length, 2); assert.equal(intent.oldExecutionReplayAllowed, false);
  assert.equal(committed.status, "committed"); assert.equal(committed.kind, "pre_import"); assert.deepEqual(committed.committedBy, { channel: "manual_cli" });
  // A now plans a fresh execution; nothing is treated as a zero-effect closure.
  const created = await f.plan("exec-new");
  assert.equal(created.executionId, "exec-new"); assert.notEqual(created.runId, old.runId); assert.deepEqual(await f.closures("zero-effect-"), []);
  // The previous execution can never be replayed or closed a second time.
  assert.equal((await assessJdLogisticsPreImport(f.root, old.active)).verdict, "not_closable");
});

test("not closable: any sign the import API may have been reached, a credential-risk failure or a changed shape", async () => {
  const cases: Array<[string, (manifest: Draft) => void, RegExp]> = [
    ["importing", m => { m.operations[0].stage = "importing"; }, /operation_0_stage_importing/],
    ["imported", m => { m.operations[0].stage = "imported"; }, /stage_imported/],
    ["verified", m => { m.operations[1].stage = "verified"; }, /operation_1_stage_verified/],
    ["receipt on an exporting operation", m => { m.operations[0].receipt = { batchId: "b" }; }, /receipt_or_unknown_field:receipt/],
    ["receipt on a planned operation", m => { m.operations[1].receipt = { batchId: "b" }; }, /operation_1_receipt_or_unknown_field/],
    ["unknown operation field", m => { m.operations[0].somethingNew = 1; }, /unknown_field:somethingNew/],
    ["failure at verify", m => { m.failure!.stage = "verify"; }, /failure_missing_or_not_run_stage/],
    ["failure at notify", m => { m.failure!.stage = "notify"; }, /failure_missing_or_not_run_stage/],
    ["stage running", m => { m.stage = "running"; }, /manifest_stage_running/],
    ["stage executed", m => { m.stage = "executed"; delete m.failure; }, /manifest_stage_executed/],
    ["outcome imported", m => { m.outcome = "imported"; }, /manifest_outcome_imported/],
    ["notification notifying", m => { m.notification.stage = "notifying"; }, /notification_not_pristine/],
    ["notification result", m => { m.notification.result = { status: "sent" }; }, /notification_not_pristine/],
    ["unknown top-level field", m => { m.extra = 1; }, /manifest_unknown_field/],
    ...JD_LOGISTICS_CREDENTIAL_RISK_SUFFIXES.map(suffix => [`credential risk ${suffix}`, (m: Draft) => { m.failure!.code = `JD_LOGISTICS_${suffix}`; }, /failure_code_credential_risk/] as [string, (manifest: Draft) => void, RegExp]),
  ];
  for (const [label, mutate, expected] of cases) {
    const f = await fixture(); const old = await f.failedPlan("old", mutate);
    const verdict = await assessJdLogisticsPreImport(f.root, old.active);
    assert.equal(verdict.verdict, "not_closable", label); assert.match(verdict.reasons[0], expected, label);
    const before = await f.snapshot();
    const result = await f.cli(...await f.confirmArgs());
    assert.equal(result.code, 1, label); assert.deepEqual(await f.snapshot(), before, label);
    await assert.rejects(f.plan("exec-new"), unresolved, label);
  }
  // Binding: a manifest that no longer matches its plan hash or active pointer is never closable.
  const f = await fixture(); const old = await f.failedPlan("old", m => { m.baseUrl = "http://localhost:3999"; });
  assert.equal((await assessJdLogisticsPreImport(f.root, old.active)).verdict, "not_closable");
  assert.equal((await assessJdLogisticsPreImport(f.root, { ...old.active, executionId: "someone-else" })).verdict, "not_closable");
});

test("downloads are kept as they are, but links and unexpected entries make the plan not closable", async () => {
  const f = await fixture(); const old = await f.failedPlan();
  assert.equal((await assessJdLogisticsPreImport(f.root, old.active)).verdict, "closable");
  await writeFile(path.join(f.directory, "downloads", old.runId, "stray.txt"), "x");
  assert.match((await assessJdLogisticsPreImport(f.root, old.active)).reasons[0], /download_unexpected_entry/);
  await rm(path.join(f.directory, "downloads", old.runId, "stray.txt"));
  await mkdir(path.join(f.directory, "downloads", old.runId, "not-an-operation"));
  assert.match((await assessJdLogisticsPreImport(f.root, old.active)).reasons[0], /download_unexpected_entry/);
  await rm(path.join(f.directory, "downloads", old.runId, "not-an-operation"), { recursive: true });
  const target = await mkdtemp(path.join(tmpdir(), "jd-pre-import-target-"));
  await symlink(target, path.join(old.downloads, "link"), "junction");
  assert.match((await assessJdLogisticsPreImport(f.root, old.active)).reasons[0], /download_contains_link/);
  await rm(path.join(old.downloads, "link"), { recursive: true, force: true });
  // No downloads directory at all is fine too.
  const g = await fixture(); const none = await g.failedPlan("none", () => undefined, false);
  assert.equal((await assessJdLogisticsPreImport(g.root, none.active)).evidence!.downloads.length, 0);
});

test("a first-run failure on a later operation after earlier validated ones is closable (nothing imports before all validate)", async () => {
  const f = await fixture(); const old = await f.failedPlan("old", m => { m.operations[0].stage = "validated"; m.operations[0].contentHash = "a".repeat(64); m.operations[0].rowCount = 3;
    m.operations[0].parserVersion = "jd-logistics-workbook-v1"; m.operations[1].stage = "exporting"; });
  assert.equal((await assessJdLogisticsPreImport(f.root, old.active)).verdict, "closable");
});

test("inspect reports the verdict, the active sha256 and pending closures without writing", async () => {
  const f = await fixture(); const old = await f.failedPlan();
  const before = await f.snapshot();
  const result = await f.cli("inspect", f.root); assert.equal(result.code, 0);
  const parsed = JSON.parse(result.out);
  assert.equal(parsed.verdict, "closable"); assert.equal(parsed.activeSha256, await f.activeSha()); assert.equal(parsed.active.runId, old.runId); assert.deepEqual(parsed.pendingClosures, []);
  assert.deepEqual(await f.snapshot(), before);
  assert.equal((await inspectJdLogisticsPreImport((await fixture()).root)).verdict, "not_closable");
});

test("dry-run prints the plan and writes nothing; it also works without an expected hash", async () => {
  const f = await fixture(); const old = await f.failedPlan(); const before = await f.snapshot();
  for (const args of [["close", f.root, "--dry-run"], ["close", f.root, "--dry-run", "--expect-sha256", await f.activeSha(), "--reason", reasonText]]) {
    const result = await f.cli(...args); assert.equal(result.code, 0, result.err);
    const parsed = JSON.parse(result.out);
    assert.equal(parsed.mode, "dry-run"); assert.equal(parsed.evidence.runId, old.runId); assert.deepEqual(parsed.untouched, ["failed manifest", "downloads"]);
    assert.match(parsed.wouldCreate.directory, /pre-import-11740-/); assert.equal(parsed.wouldMove, "active.json -> active.archived.json");
    assert.deepEqual(await f.snapshot(), before);
  }
  const wrong = await f.cli("close", f.root, "--dry-run", "--expect-sha256", "0".repeat(64)); assert.equal(wrong.code, 1); assert.match(wrong.err, /expect_sha256_mismatch/);
  assert.deepEqual(await f.snapshot(), before);
});

test("refused invocations change nothing: wrong hash, missing reason, no --confirm, conflicting flags, bad options, relative root", async () => {
  const f = await fixture(); await f.failedPlan();
  const before = await f.snapshot(); const good = await f.activeSha();
  const attempts: Array<[string, string[], RegExp]> = [
    ["wrong sha", ["close", f.root, "--confirm", "--expect-sha256", "0".repeat(64), "--reason", reasonText], /expect_sha256_mismatch/],
    ["sha of a different file", ["close", f.root, "--confirm", "--expect-sha256", sha("other"), "--reason", reasonText], /expect_sha256_mismatch/],
    ["no sha", ["close", f.root, "--confirm", "--reason", reasonText], /expect_sha256_missing/],
    ["malformed sha", ["close", f.root, "--confirm", "--expect-sha256", good.slice(0, 63), "--reason", reasonText], /expect_sha256_missing/],
    ["missing reason", ["close", f.root, "--confirm", "--expect-sha256", good], /reason_length/],
    ["blank reason", ["close", f.root, "--confirm", "--expect-sha256", good, "--reason", "   "], /reason_length/],
    ["no --confirm", ["close", f.root, "--expect-sha256", good, "--reason", reasonText], /not_confirmed/],
    ["dry-run and confirm", ["close", f.root, "--dry-run", "--confirm", "--expect-sha256", good, "--reason", reasonText], /mode_conflict/],
  ];
  for (const [label, args, expected] of attempts) {
    const result = await f.cli(...args); assert.equal(result.code, 1, label); assert.match(result.err, expected, label); assert.deepEqual(await f.snapshot(), before, label);
  }
  for (const args of [["close", f.root, "--confirm", "--bogus", "x"], ["close", "relative/root", "--dry-run"], ["inspect"], ["inspect", f.root, "extra"], ["unknown", f.root]]) {
    const result = await f.cli(...args); assert.equal(result.code, 2, args.join(" ")); assert.deepEqual(await f.snapshot(), before);
  }
});

test("interrupted closure: A refuses while it is pending, only the CLI resumes it, and changed evidence blocks the resume", async () => {
  // Interrupted after the intent: active is still there.
  let f = await fixture(); let old = await f.failedPlan();
  const expect = await f.activeSha();
  await assert.rejects(closeJdLogisticsPreImportPlan(f.root, { expectSha256: expect, reason: reasonText }, lock, now, { afterIntent: async () => { throw new Error("simulated crash"); } }), /simulated crash/);
  const [name] = await f.closures("pre-import-"); const dir = path.join(f.directory, name);
  assert.ok((await readdir(dir)).includes("intent.json")); await lstat(path.join(f.directory, "active.json"));
  await assert.rejects(f.plan("exec-auto"), unresolved);
  const wrongReason = await f.cli("close", f.root, "--confirm", "--expect-sha256", expect, "--reason", "另一个原因的文字"); assert.equal(wrongReason.code, 1); assert.match(wrongReason.err, /resume_reason_differs/);
  const resumed = await f.cli(...await f.confirmArgs()); assert.equal(resumed.code, 0, resumed.err); assert.equal(JSON.parse(resumed.out).status, "closed");
  assert.deepEqual((await readdir(dir)).sort(), ["active.archived.json", "active.original.json", "committed.json", "intent.json", "manifest.original.json"]);
  assert.equal((await f.plan("exec-new")).executionId, "exec-new");

  // Interrupted after the archive move, before committed: active is gone, A still refuses, CLI commits.
  f = await fixture(); old = await f.failedPlan();
  const sha2 = await f.activeSha();
  assert.equal((await f.cli("close", f.root, "--confirm", "--expect-sha256", sha2, "--reason", reasonText)).code, 0);
  const [name2] = await f.closures("pre-import-"); const dir2 = path.join(f.directory, name2);
  await rm(path.join(dir2, "committed.json"));
  await assert.rejects(f.plan("exec-auto"), unresolved);
  assert.deepEqual(JSON.parse((await f.cli("inspect", f.root)).out).pendingClosures, [name2]);
  const dry = await f.cli("close", f.root, "--dry-run", "--expect-sha256", sha2); assert.equal(dry.code, 1);
  const bad = await f.cli("close", f.root, "--confirm", "--expect-sha256", "0".repeat(64), "--reason", reasonText); assert.equal(bad.code, 1); assert.match(bad.err, /expect_sha256_mismatch/);
  const done = await f.cli("close", f.root, "--confirm", "--expect-sha256", sha2, "--reason", reasonText);
  assert.equal(done.code, 0, done.err); assert.equal(JSON.parse(done.out).status, "resumed_committed");
  assert.equal(JSON.parse(await readFile(path.join(dir2, "committed.json"), "utf8")).status, "committed");
  assert.equal((await f.plan("exec-new")).executionId, "exec-new");
  assert.ok((await readFile(path.join(f.directory, `${old.runId}.json`))).length > 0);

  // Interrupted after the intent, then a download file changes: the resume re-verifies the evidence and refuses.
  f = await fixture(); old = await f.failedPlan();
  const sha3 = await f.activeSha();
  await assert.rejects(closeJdLogisticsPreImportPlan(f.root, { expectSha256: sha3, reason: reasonText }, lock, now, { afterIntent: async () => { throw new Error("simulated crash"); } }), /simulated crash/);
  await writeFile(path.join(old.downloads, "source.csv"), "changed after the intent");
  const refused = await f.cli("close", f.root, "--confirm", "--expect-sha256", sha3, "--reason", reasonText);
  assert.equal(refused.code, 1); assert.match(refused.err, /resume_evidence_differs/);
  await lstat(path.join(f.directory, "active.json"));
  // Evidence changing between the intent and the archive step blocks the move in the same way.
  const g = await fixture(); const gold = await g.failedPlan();
  await assert.rejects(closeJdLogisticsPreImportPlan(g.root, { expectSha256: await g.activeSha(), reason: reasonText }, lock, now,
    { afterIntent: async () => { await writeFile(path.join(gold.downloads, "source.csv"), "changed mid-flight"); } }), ZeroEffectRefusal);
  await lstat(path.join(g.directory, "active.json"));
});

test("pending pre-import closures with tampered state fail closed", async () => {
  const tamper = async (label: string, change: (f: Awaited<ReturnType<typeof fixture>>, dir: string) => Promise<void>) => {
    const f = await fixture(); await f.failedPlan(); const expect = await f.activeSha();
    assert.equal((await f.cli("close", f.root, "--confirm", "--expect-sha256", expect, "--reason", reasonText)).code, 0);
    const [name] = await f.closures("pre-import-"); const dir = path.join(f.directory, name);
    await rm(path.join(dir, "committed.json")); await change(f, dir);
    const result = await f.cli("close", f.root, "--confirm", "--expect-sha256", expect, "--reason", reasonText);
    assert.equal(result.code, 1, label); assert.ok(!(await readdir(dir)).includes("committed.json"), label);
    await assert.rejects(f.plan("exec-new"), unresolved, label);
  };
  await tamper("archive bytes differ", async (_f, dir) => { await writeFile(path.join(dir, "active.archived.json"), "{\"runId\":\"x\"}\n"); });
  await tamper("intent tampered", async (_f, dir) => { const intent = JSON.parse(await readFile(path.join(dir, "intent.json"), "utf8")); intent.original.activeSha256 = "0".repeat(64); await writeFile(path.join(dir, "intent.json"), JSON.stringify(intent)); });
  await tamper("two actives", async (f, dir) => { await writeFile(path.join(f.directory, "active.json"), await readFile(path.join(dir, "active.archived.json"))); });
  await tamper("archive missing", async (_f, dir) => { await rm(path.join(dir, "active.archived.json")); });
  await tamper("intent is a zero-effect intent", async (_f, dir) => { const intent = JSON.parse(await readFile(path.join(dir, "intent.json"), "utf8")); delete intent.kind; await writeFile(path.join(dir, "intent.json"), JSON.stringify(intent)); });
});
