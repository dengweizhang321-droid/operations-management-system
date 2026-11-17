import assert from "node:assert/strict";
import test from "node:test";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { JdLogisticsManifest } from "../lib/jd/logistics-manifest";
import type { JdLogisticsBinding, JdLogisticsConfig, JdLogisticsSettings } from "../lib/jd/logistics-policy";
import type { JdStore } from "../lib/jd/store-registry";
import { planJdLogisticsN8nRun } from "../tools/jd-logistics-n8n-pipeline";
import { assessJdLogisticsZeroEffect, inspectJdLogisticsZeroEffect, JD_LOGISTICS_CREDENTIAL_RISK_SUFFIXES, JD_LOGISTICS_PRE_BUSINESS_FAILURE_CODES,
  JD_LOGISTICS_PRE_BUSINESS_THROW_SUFFIXES, zeroEffectClosureDirectoryName } from "../tools/jd-logistics-zero-effect-closure";

const now = new Date("2026-10-30T00:50:00.000Z");
const store: JdStore = { storeKey: "jd-test", platform: "京东", enabled: true, accountLabel: "测试", shopName: "测试店", shopId: "10001",
  browser: { executablePath: "unused/chrome.exe", userDataDir: "unused/profiles", profileName: "Default", profileDir: "unused/profiles/Default", debugPort: 9224, downloadDir: "unused/downloads" } };
const kinds = ["flow", "shop_products", "realtime_inventory", "inventory_snapshot"] as const;
const binding = (sourceKind: JdLogisticsBinding["sourceKind"]): JdLogisticsBinding => ({ sourceKind, departmentId: "department-1", businessUnitCode: "00001",
  enabled: true, sourceVerified: true, contractVersion: "jd-logistics-v1", collectorStoreKey: store.storeKey, authorizedStoreKeys: [store.storeKey], warehouseCode: "",
  ...(sourceKind === "flow" ? { initialStartDate: "2026-10-01", maxSpanDays: 31 } : {}) });
const settings = (): JdLogisticsSettings => ({ contractVersion: "jd-logistics-v1", departments: [{ id: "department-1", businessUnitCode: "00001", storeKeys: [store.storeKey],
  logisticsEnabled: true, capabilities: { flow: true, shop_products: true, realtime_inventory: true, inventory_snapshot: true }, revision: 1 }], scopeRevisions: [] });
const request: typeof fetch = async input => {
  const url = new URL(String(input)); assert.equal(url.searchParams.get("operation"), "settings");
  return Response.json({ success: true, data: settings() });
};
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "jd-zero-effect-"));
  const config: JdLogisticsConfig = { version: 1, bindings: kinds.map(binding) };
  const directory = path.join(root, "outputs", "jd-logistics-pipeline");
  let counter = 0;
  const plan = (executionId: string) => planJdLogisticsN8nRun({ root, executionId, now, stores: [store], config, request, runIdFactory: () => `run-${executionId}-${++counter}` });
  // Same shape production left behind for execution 11037: the first source was
  // marked exporting, then the guard failed before any export click.
  async function failedPlan(executionId = "11037", mutate: (manifest: any) => void = () => undefined) {
    const original = await plan(executionId);
    const manifest = JSON.parse(await readFile(path.join(directory, `${original.runId}.json`), "utf8"));
    manifest.stage = "failed"; manifest.failure = { code: "JD_LOGISTICS_LOGIN_REQUIRED", stage: "run", at: "2026-10-30T00:50:27.838Z" };
    manifest.operations[0].stage = "exporting";
    mutate(manifest);
    await writeFile(path.join(directory, `${original.runId}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
    return { runId: original.runId as string, active: { runId: original.runId as string, executionId, planHash: original.planHash as string } };
  }
  const read = (name: string) => readFile(path.join(directory, name));
  const closures = async () => (await readdir(directory)).filter(name => name.startsWith("zero-effect-"));
  return { root, directory, plan, failedPlan, read, closures };
}
const unresolved = /JD_LOGISTICS_PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION/;

test("11037 shape: zero-effect failure is closed and a new plan is created; original manifest bytes stay", async () => {
  const f = await fixture(); const old = await f.failedPlan();
  const manifestBefore = await f.read(`${old.runId}.json`), activeBefore = await f.read("active.json");
  const verdict = await assessJdLogisticsZeroEffect(f.root, old.active); assert.equal(verdict.verdict, "zero_effect");
  const created = await f.plan("exec-new");
  assert.notEqual(created.runId, old.runId); assert.equal(created.executionId, "exec-new"); assert.equal(created.stage, "planned");
  assert.deepEqual(JSON.parse((await f.read("active.json")).toString()), { runId: created.runId, executionId: "exec-new", planHash: created.planHash });
  assert.ok((await f.read(`${old.runId}.json`)).equals(manifestBefore));
  const [name] = await f.closures(); assert.deepEqual(await f.closures(), [zeroEffectClosureDirectoryName("11037", verdict.evidence!.activeSha256)]);
  const dir = path.join(f.directory, name);
  assert.deepEqual((await readdir(dir)).sort(), ["active.archived.json", "active.original.json", "committed.json", "intent.json", "manifest.original.json"]);
  assert.ok((await readFile(path.join(dir, "active.archived.json"))).equals(activeBefore)); assert.ok((await readFile(path.join(dir, "active.original.json"))).equals(activeBefore));
  assert.ok((await readFile(path.join(dir, "manifest.original.json"))).equals(manifestBefore));
  const intent = JSON.parse(await readFile(path.join(dir, "intent.json"), "utf8")), committed = JSON.parse(await readFile(path.join(dir, "committed.json"), "utf8"));
  assert.equal(intent.closedBy.executionId, "exec-new"); assert.equal(intent.original.executionId, "11037"); assert.equal(intent.oldExecutionReplayAllowed, false);
  assert.equal(intent.evidence.failureCode, "JD_LOGISTICS_LOGIN_REQUIRED"); assert.equal(committed.status, "committed");
  // Re-entry by the same execution is the existing path and is not a second closure.
  assert.equal((await f.plan("exec-new")).runId, created.runId); assert.equal((await f.closures()).length, 1);
  // The new plan is now an ordinary unresolved plan for yet another execution.
  await assert.rejects(f.plan("exec-third"), unresolved);
});

test("credential-risk and non-whitelisted failure codes stay unresolved; whitelist excludes them", async () => {
  assert.ok(JD_LOGISTICS_CREDENTIAL_RISK_SUFFIXES.every(suffix => JD_LOGISTICS_PRE_BUSINESS_THROW_SUFFIXES.includes(suffix)));
  assert.ok(JD_LOGISTICS_CREDENTIAL_RISK_SUFFIXES.every(suffix => !JD_LOGISTICS_PRE_BUSINESS_FAILURE_CODES.includes(`JD_LOGISTICS_${suffix}`)));
  for (const code of ["JD_LOGISTICS_POLICY_CHANGED_OR_REVOKED", "JD_LOGISTICS_PIPELINE_FAILED_MANUAL_ACTION", "JD_LOGISTICS_EXPORT_RESULT_MISSING", "JD_LOGISTICS_LOGIN_LOCKED_MANUAL_ACTION",
    "JD_LOGISTICS_LOGIN_CREDENTIAL_REJECTED_MANUAL_ACTION", "JD_LOGISTICS_LOGIN_SUBMISSION_UNKNOWN_MANUAL_ACTION", "JD_LOGISTICS_LOGIN_NOT_COMPLETED_MANUAL_ACTION", "LOGIN_REQUIRED"]) {
    const f = await fixture(); const old = await f.failedPlan("old", manifest => { manifest.failure.code = code; });
    const verdict = await assessJdLogisticsZeroEffect(f.root, old.active); assert.equal(verdict.verdict, "not_closable", code);
    assert.match(verdict.reasons[0], /failure_code_not_whitelisted/);
    await assert.rejects(f.plan("exec-new"), unresolved);
    assert.deepEqual(await f.closures(), []); assert.equal(JSON.parse((await f.read("active.json")).toString()).runId, old.runId);
  }
  for (const suffix of JD_LOGISTICS_PRE_BUSINESS_THROW_SUFFIXES.filter(suffix => !(JD_LOGISTICS_CREDENTIAL_RISK_SUFFIXES as readonly string[]).includes(suffix))) {
    const f = await fixture(); const old = await f.failedPlan("old", manifest => { manifest.failure.code = `JD_LOGISTICS_${suffix}`; });
    assert.equal((await assessJdLogisticsZeroEffect(f.root, old.active)).verdict, "zero_effect", suffix);
  }
});

test("any sign of progress, wrong stage or notification state makes the plan not closable", async () => {
  const cases: Array<[string, (manifest: any) => void]> = [
    ["export evidence", m => { m.operations[0].export = { relativePath: "x" }; }],
    ["receipt", m => { m.operations[0].receipt = { batchId: "b" }; }],
    ["content hash", m => { m.operations[0].contentHash = "a".repeat(64); }],
    ["row count", m => { m.operations[0].rowCount = 1; }],
    ["parser version", m => { m.operations[0].parserVersion = "v1"; }],
    ["unknown progress field", m => { m.operations[1].somethingNew = true; }],
    ["downloaded", m => { m.operations[0].stage = "downloaded"; }],
    ["validated", m => { m.operations[0].stage = "validated"; }],
    ["importing", m => { m.operations[0].stage = "importing"; }],
    ["imported", m => { m.operations[0].stage = "imported"; }],
    ["verified", m => { m.operations[0].stage = "verified"; }],
    ["two exporting", m => { m.operations[1].stage = "exporting"; }],
    ["later op exporting, first planned", m => { m.operations[0].stage = "planned"; m.operations[2].stage = "exporting"; }],
    ["stage running", m => { m.stage = "running"; }],
    ["stage executed", m => { m.stage = "executed"; delete m.failure; }],
    ["failure at verify", m => { m.failure.stage = "verify"; }],
    ["failure missing", m => { delete m.failure; }],
    ["outcome imported", m => { m.outcome = "imported"; }],
    ["notification notifying", m => { m.notification.stage = "notifying"; }],
    ["notification unknown", m => { m.notification.stage = "unknown"; }],
    ["notification has result", m => { m.notification.result = { status: "sent" }; }],
    ["notification has request hash", m => { m.notification.requestHash = "a".repeat(64); }],
    ["unknown top-level field", m => { m.extra = 1; }],
  ];
  for (const [label, mutate] of cases) {
    const f = await fixture(); const old = await f.failedPlan("old", mutate);
    const verdict = await assessJdLogisticsZeroEffect(f.root, old.active); assert.equal(verdict.verdict, "not_closable", label);
    await assert.rejects(f.plan("exec-new"), unresolved, label); assert.deepEqual(await f.closures(), [], label);
  }
  // Identity binding: a manifest that no longer matches its plan hash is never closable.
  const f = await fixture(); const old = await f.failedPlan("old", m => { m.baseUrl = "http://localhost:3999"; });
  assert.equal((await assessJdLogisticsZeroEffect(f.root, old.active)).verdict, "not_closable");
  assert.equal((await assessJdLogisticsZeroEffect(f.root, { ...old.active, planHash: "0".repeat(64) })).verdict, "not_closable");
  assert.equal((await assessJdLogisticsZeroEffect(f.root, { ...old.active, executionId: "someone-else" })).verdict, "not_closable");
});

test("download directory content, links and unexpected entries block closure; empty directories do not", async () => {
  const f = await fixture(); const old = await f.failedPlan();
  const opId = (JSON.parse(await readFile(path.join(f.directory, `${old.runId}.json`), "utf8")) as JdLogisticsManifest).operations[0].operationId;
  const downloads = path.join(f.directory, "downloads", old.runId), flowDir = path.join(downloads, opId);
  await mkdir(flowDir, { recursive: true });
  assert.equal((await assessJdLogisticsZeroEffect(f.root, old.active)).evidence?.downloads, "directories_only");
  await writeFile(path.join(flowDir, "export-manifest.json"), "{}");
  assert.match((await assessJdLogisticsZeroEffect(f.root, old.active)).reasons[0], /download_contains_file/);
  await assert.rejects(f.plan("exec-new"), unresolved); assert.deepEqual(await f.closures(), []);
  await rm(path.join(flowDir, "export-manifest.json"));
  await mkdir(path.join(flowDir, "nested"), { recursive: true }); await writeFile(path.join(flowDir, "nested", "deep.csv"), "x");
  assert.match((await assessJdLogisticsZeroEffect(f.root, old.active)).reasons[0], /download_contains_file/);
  await rm(path.join(flowDir, "nested"), { recursive: true });
  await mkdir(path.join(downloads, "not-an-operation"));
  assert.match((await assessJdLogisticsZeroEffect(f.root, old.active)).reasons[0], /download_unexpected_directory/);
  await rm(path.join(downloads, "not-an-operation"), { recursive: true });
  const target = await mkdtemp(path.join(tmpdir(), "jd-zero-effect-target-"));
  await symlink(target, path.join(flowDir, "link"), "junction");
  assert.match((await assessJdLogisticsZeroEffect(f.root, old.active)).reasons[0], /download_contains_link/);
  await rm(path.join(flowDir, "link"), { recursive: true, force: true });
  assert.equal((await assessJdLogisticsZeroEffect(f.root, old.active)).verdict, "zero_effect");
  await rm(downloads, { recursive: true }); await symlink(target, downloads, "junction");
  assert.match((await assessJdLogisticsZeroEffect(f.root, old.active)).reasons[0], /download_root_is_link/);
});

test("interrupted closure: archived without committed is completed; intent without archive resumes on identical evidence", async () => {
  // State C: archive moved, committed missing, no new plan yet.
  let f = await fixture(); let old = await f.failedPlan();
  const created = await f.plan("exec-1"); const [name] = await f.closures(); let dir = path.join(f.directory, name);
  await rm(path.join(dir, "committed.json")); await rm(path.join(f.directory, "active.json")); await rm(path.join(f.directory, `${created.runId}.json`));
  const replacement = await f.plan("exec-2");
  assert.equal(JSON.parse(await readFile(path.join(dir, "committed.json"), "utf8")).committedBy.executionId, "exec-2");
  assert.equal(replacement.executionId, "exec-2"); assert.equal((await f.closures()).length, 1);
  // State B: only intent (and originals) exist; the live active pointer is still there.
  f = await fixture(); old = await f.failedPlan();
  await f.plan("exec-1"); [dir] = (await f.closures()).map(n => path.join(f.directory, n));
  const intentBefore = await readFile(path.join(dir, "intent.json"));
  await copyFile(path.join(dir, "active.archived.json"), path.join(f.directory, "active.json")); await rm(path.join(dir, "active.archived.json")); await rm(path.join(dir, "committed.json"));
  const resumed = await f.plan("exec-2");
  assert.equal(resumed.executionId, "exec-2"); assert.ok((await readFile(path.join(dir, "intent.json"))).equals(intentBefore));
  assert.deepEqual((await readdir(dir)).sort(), ["active.archived.json", "active.original.json", "committed.json", "intent.json", "manifest.original.json"]);
  assert.equal((await f.closures()).length, 1);
  // State A: directory created, only some create-only files written.
  f = await fixture(); old = await f.failedPlan();
  await f.plan("exec-1"); [dir] = (await f.closures()).map(n => path.join(f.directory, n));
  await copyFile(path.join(dir, "active.archived.json"), path.join(f.directory, "active.json"));
  for (const file of ["active.archived.json", "committed.json", "intent.json", "manifest.original.json"]) await rm(path.join(dir, file));
  assert.equal((await f.plan("exec-2")).executionId, "exec-2");
  assert.equal((await readdir(dir)).length, 5);
});

test("interrupted closure fails closed on digest mismatch, two actives, no actives or changed evidence", async () => {
  const unresolvedAfter = async (label: string, tamper: (f: Awaited<ReturnType<typeof fixture>>, dir: string, oldRunId: string) => Promise<void>) => {
    const f = await fixture(); const old = await f.failedPlan(); await f.plan("exec-1");
    const [name] = await f.closures(); const dir = path.join(f.directory, name);
    await rm(path.join(dir, "committed.json")); await rm(path.join(f.directory, "active.json"));
    await tamper(f, dir, old.runId);
    await assert.rejects(f.plan("exec-2"), unresolved, label);
  };
  await unresolvedAfter("archive bytes differ", async (_f, dir) => { await writeFile(path.join(dir, "active.archived.json"), "{\"runId\":\"x\"}\n"); });
  await unresolvedAfter("manifest changed after closure", async (f, _dir, runId) => { await writeFile(path.join(f.directory, `${runId}.json`), "{}\n"); });
  await unresolvedAfter("archive missing and active missing", async (_f, dir) => { await rm(path.join(dir, "active.archived.json")); });
  await unresolvedAfter("two actives", async (f, dir) => { await copyFile(path.join(dir, "active.archived.json"), path.join(f.directory, "active.json")); });
  await unresolvedAfter("intent missing", async (_f, dir) => { await rm(path.join(dir, "intent.json")); });
  await unresolvedAfter("intent tampered", async (_f, dir) => {
    const intent = JSON.parse(await readFile(path.join(dir, "intent.json"), "utf8")); intent.original.activeSha256 = "0".repeat(64);
    await writeFile(path.join(dir, "intent.json"), JSON.stringify(intent));
  });
  // Intent only, but the evidence changed (a download file appeared) before the retry.
  const f = await fixture(); const old = await f.failedPlan(); await f.plan("exec-1");
  const [name] = await f.closures(); const dir = path.join(f.directory, name);
  await copyFile(path.join(dir, "active.archived.json"), path.join(f.directory, "active.json")); await rm(path.join(dir, "active.archived.json")); await rm(path.join(dir, "committed.json"));
  const opId = (JSON.parse(await readFile(path.join(f.directory, `${old.runId}.json`), "utf8")) as JdLogisticsManifest).operations[0].operationId;
  await mkdir(path.join(f.directory, "downloads", old.runId, opId), { recursive: true }); await writeFile(path.join(f.directory, "downloads", old.runId, opId, "source.csv"), "x");
  await assert.rejects(f.plan("exec-2"), unresolved);
  assert.equal(JSON.parse((await readFile(path.join(f.directory, "active.json"))).toString()).runId, old.runId);
});

test("inspect is read-only and reports the verdict for the current active pointer", async () => {
  const f = await fixture(); const old = await f.failedPlan();
  const snapshot = async () => { const out: string[] = []; const walk = async (dir: string) => { for (const e of (await readdir(dir)).sort()) {
    const p = path.join(dir, e), s = await lstat(p); out.push(`${path.relative(f.root, p)}:${s.isDirectory() ? "d" : `${s.size}:${s.mtimeMs}`}`); if (s.isDirectory()) await walk(p); } }; await walk(f.root); return out; };
  const before = await snapshot(); const result = await inspectJdLogisticsZeroEffect(f.root);
  assert.equal(result.verdict, "zero_effect"); assert.equal(result.active?.runId, old.runId);
  assert.deepEqual(await snapshot(), before);
  const empty = await fixture(); assert.equal((await inspectJdLogisticsZeroEffect(empty.root)).verdict, "not_closable");
});

// --- throw-site pins -------------------------------------------------------
const repoRoot = path.resolve(import.meta.dirname, "..");
async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!["node_modules", ".next", "dist"].includes(entry.name)) out.push(...await sourceFiles(full)); }
    else if (/\.(?:ts|tsx|mjs|js|py|ps1)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const rel = (file: string) => path.relative(repoRoot, file).split(path.sep).join("/");
const functionSlice = (text: string, start: string) => {
  const from = text.indexOf(start); assert.ok(from >= 0, `missing ${start}`);
  const next = text.indexOf("\nasync function ", from + start.length), nextExport = text.indexOf("\nexport ", from + start.length);
  return text.slice(from, Math.min(...[next, nextExport].filter(index => index >= 0), text.length));
};

test("pin: pre-business failure codes are raised only inside the session guard, before any business frame", async () => {
  const files = [...await sourceFiles(path.join(repoRoot, "tools")), ...await sourceFiles(path.join(repoRoot, "lib"))];
  const sessionPath = rel(path.join(repoRoot, "tools", "jd-logistics-session.ts"));
  const sessionText = await readFile(path.join(repoRoot, sessionPath), "utf8");
  const guard = sessionText.slice(sessionText.indexOf("export function createJdLogisticsSessionGuard("));
  const expectedCounts: Record<string, number> = { LOGIN_REQUIRED: 2, LOGIN_CHALLENGE_MANUAL_ACTION: 3, LOGIN_CREDENTIAL_REJECTED_MANUAL_ACTION: 2, LOGIN_LOCKED_MANUAL_ACTION: 2,
    LOGIN_CONTROL_AMBIGUOUS: 2, BUSINESS_FRAME_AMBIGUOUS: 1, LOGIN_ORIGIN_REJECTED: 2, LOGIN_STORE_MISMATCH: 1, LOGIN_CREDENTIAL_UNAVAILABLE_MANUAL_ACTION: 1,
    LOGIN_SUBMISSION_UNKNOWN_MANUAL_ACTION: 1, LOGIN_FORM_NOT_READY_MANUAL_ACTION: 1, LOGIN_NOT_COMPLETED_MANUAL_ACTION: 1, BUSINESS_FRAME_NOT_READY: 1 };
  assert.deepEqual(Object.keys(expectedCounts).sort(), [...JD_LOGISTICS_PRE_BUSINESS_THROW_SUFFIXES].sort());
  // Every quoted occurrence of a code (bare suffix passed to fail() or full code string) outside the
  // guard must be a known historical/data reference, never a new raise point.
  const allowedElsewhere = new Set(["tools/close-jd-logistics-login-9851.ts", "tools/jd-logistics-login-9851-target.ts", "tools/jd-logistics-login-11037-target.ts",
    "tools/jd-logistics-zero-effect-closure.ts"]);
  for (const suffix of JD_LOGISTICS_PRE_BUSINESS_THROW_SUFFIXES) {
    // bare suffix only counts when handed to fail(...); the full code string counts anywhere.
    const literal = new RegExp(`fail\\([^;)]*["'\`]${suffix}["'\`]|["'\`]JD_LOGISTICS_${suffix}["'\`]`, "g");
    assert.equal((guard.match(literal) ?? []).length, expectedCounts[suffix], `${suffix} raise count inside the guard changed`);
    assert.equal((sessionText.match(literal) ?? []).length, expectedCounts[suffix], `${suffix} appears outside the guard in the session file`);
    for (const file of files) {
      if (rel(file) === sessionPath) continue;
      const text = await readFile(file, "utf8");
      if (literal.test(text)) assert.ok(allowedElsewhere.has(rel(file)), `${suffix} is now referenced by ${rel(file)}; zero-effect whitelist must be re-verified`);
      literal.lastIndex = 0;
      // The only code strings that may be built dynamically are the session file's `JD_LOGISTICS_${code}` prefix.
      assert.ok(!new RegExp(`JD_LOGISTICS_${suffix}`).test(text) || allowedElsewhere.has(rel(file)), `${suffix} full code appears in ${rel(file)}`);
    }
  }
  assert.ok(sessionText.includes("function fail(code: string): never { throw new Error(`JD_LOGISTICS_${code}`); }"));
  const dynamic: string[] = [];
  for (const file of files) if (/`JD_LOGISTICS_\$\{/.test(await readFile(file, "utf8"))) dynamic.push(rel(file));
  assert.deepEqual(dynamic, [sessionPath, "tools/jd-logistics-zero-effect-closure.ts"], "another file builds JD_LOGISTICS_ codes dynamically");
});

test("pin: exporter calls the session guard only before its first export manifest write", async () => {
  const text = await readFile(path.join(repoRoot, "tools", "jd-logistics-export.ts"), "utf8");
  assert.equal((text.match(/createJdLogisticsSessionGuard\(/g) ?? []).length, 1, "exactly one construction");
  assert.equal((text.match(/\bsession\(page/g) ?? []).length, 1, "the guard is invoked from exactly one place");
  assert.ok(text.includes("const navigate = async () => { await page.goto(jdLogisticsSourceUrls[options.sourceKind], { waitUntil: \"domcontentloaded\", timeout: 60000 }); return session(page, options.sourceKind); };"));
  const exportFn = text.slice(text.indexOf("export async function exportJdLogistics("));
  assert.ok(exportFn.indexOf("const business = await navigate();") > 0);
  assert.ok(exportFn.indexOf("const business = await navigate();") < exportFn.indexOf("exportJhSource(page"), "first navigate precedes every source exporter");
  // Callers of navigate(): the entry point and exportJhSource only, and in exportJhSource before the manifest exists.
  const jh = functionSlice(text, "async function exportJhSource(");
  assert.ok(jh.includes("surface = await navigate();"));
  assert.ok(jh.indexOf("await navigate()") < jh.indexOf("writeJsonDurable(manifestPath"), "navigate must stay before the export manifest write");
  assert.ok(jh.indexOf("await navigate()") < jh.indexOf("observedJhExport("), "navigate must stay before the export submission");
  assert.equal((text.match(/await navigate\(\)/g) ?? []).length, 2, "a new navigate() call needs the whitelist re-verified");
  for (const start of ["async function exportEnabledProducts(", "async function exportFlowSource("]) {
    assert.ok(!/navigate/.test(functionSlice(text, start)), `${start} must not re-run the session guard after business actions`);
  }
});

// --- archive safety --------------------------------------------------------
import { closeJdLogisticsZeroEffectPlan, zeroEffectMoveNoReplace, ZeroEffectRefusal } from "../tools/jd-logistics-zero-effect-closure";
const lockStub = { assertOwned: async () => undefined };

test("archive move never replaces an existing destination", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jd-zero-move-"));
  const from = path.join(dir, "a.json"), to = path.join(dir, "b.json");
  await writeFile(from, "from"); await writeFile(to, "to");
  await assert.rejects(zeroEffectMoveNoReplace(from, to));
  assert.equal(await readFile(from, "utf8"), "from"); assert.equal(await readFile(to, "utf8"), "to");
  await rm(to); await zeroEffectMoveNoReplace(from, to);
  assert.equal(await readFile(to, "utf8"), "from"); await assert.rejects(lstat(from));
});

test("an existing active.archived.json fails closed and leaves the original active untouched", async () => {
  const f = await fixture(); const old = await f.failedPlan();
  const verdict = await assessJdLogisticsZeroEffect(f.root, old.active);
  const dir = path.join(f.directory, zeroEffectClosureDirectoryName("11037", verdict.evidence!.activeSha256));
  await mkdir(dir); await writeFile(path.join(dir, "active.archived.json"), "squatter");
  const activeBefore = await f.read("active.json"), manifestBefore = await f.read(`${old.runId}.json`);
  await assert.rejects(closeJdLogisticsZeroEffectPlan(f.root, old.active, "exec-new", lockStub), ZeroEffectRefusal);
  assert.ok((await f.read("active.json")).equals(activeBefore)); assert.ok((await f.read(`${old.runId}.json`)).equals(manifestBefore));
  assert.equal(await readFile(path.join(dir, "active.archived.json"), "utf8"), "squatter");
  assert.deepEqual((await readdir(dir)).includes("committed.json"), false);
});

test("evidence changed between intent and archive is re-verified and blocks the move", async () => {
  const mutations: Array<[string, (f: Awaited<ReturnType<typeof fixture>>, runId: string) => Promise<void>]> = [
    ["active bytes", async f => { await writeFile(path.join(f.directory, "active.json"), `${(await f.read("active.json")).toString()} `); }],
    ["manifest bytes", async (f, runId) => { await writeFile(path.join(f.directory, `${runId}.json`), `${(await f.read(`${runId}.json`)).toString()} `); }],
    ["manifest progress", async (f, runId) => {
      const manifest = JSON.parse((await f.read(`${runId}.json`)).toString()); manifest.operations[0].rowCount = 1;
      await writeFile(path.join(f.directory, `${runId}.json`), JSON.stringify(manifest)); }],
  ];
  for (const [label, mutate] of mutations) {
    const f = await fixture(); const old = await f.failedPlan();
    await assert.rejects(closeJdLogisticsZeroEffectPlan(f.root, old.active, "exec-new", lockStub, new Date(), { afterIntent: () => mutate(f, old.runId) }), ZeroEffectRefusal, label);
    const [name] = await f.closures(); const dir = path.join(f.directory, name);
    assert.ok((await readdir(dir)).includes("intent.json"), label);
    assert.deepEqual((await readdir(dir)).filter(entry => ["active.archived.json", "committed.json"].includes(entry)), [], label);
    await lstat(path.join(f.directory, "active.json"));
  }
});

// --- defense in depth: the workflow stops on the fixed message --------------
import { classifyHourlyRetryFailure } from "../tools/n8n-hourly-retry-policy.mjs";
test("every business failure exit of the logistics workflow ends at the fixed stop message, classified terminal", async () => {
  const workflow = JSON.parse(await readFile(path.join(repoRoot, "automation", "n8n", "jd-logistics-daily.workflow.json"), "utf8"));
  const nodes: Array<{ name: string; type: string; onError?: string; parameters: { errorMessage?: string } }> = workflow.nodes;
  const edges = (name: string, output?: number): string[] => (workflow.connections[name]?.main ?? [])
    .flatMap((targets: Array<{ node: string }>, index: number) => output === undefined || output === index ? targets.map(target => target.node) : []);
  const stops = nodes.filter(node => node.type === "n8n-nodes-base.stopAndError");
  assert.equal(stops.length, 1);
  const message = stops[0].parameters.errorMessage!; assert.ok(message.startsWith("京东物流流程未完成；原计划与未决任务已保留，禁止自动重发导出或导入"));
  const business = nodes.filter(node => /^[ABCD]·/.test(node.name) || node.name === "领取共享 helper" || node.name.includes("成功后释放"));
  assert.ok(business.length >= 6);
  for (const node of business) {
    assert.equal(node.onError, "continueErrorOutput", node.name);
    const seen = new Set<string>(), terminals = new Set<string>(), queue = edges(node.name, 1);
    assert.ok(queue.length > 0, `${node.name} has no failure exit`);
    while (queue.length) {
      const next = queue.pop()!; if (seen.has(next)) continue; seen.add(next);
      const following = edges(next); if (!following.length) terminals.add(next); queue.push(...following);
    }
    assert.deepEqual([...terminals], [stops[0].name], `${node.name} failure exit must end only at the stop node`);
  }
  const release = nodes.find(node => node.name.startsWith("失败后释放"))!; assert.equal(release.onError, "continueRegularOutput");
  assert.deepEqual(edges(release.name), [stops[0].name]);
  const decision = classifyHourlyRetryFailure({ workflow: { id: workflow.id }, execution: { mode: "trigger", error: { message } } });
  assert.equal(decision.retry, false);
});
