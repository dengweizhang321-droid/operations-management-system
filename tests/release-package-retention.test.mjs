import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { packagesRoot, parseWorktrees, planRetention, queueProtectedPackages, resolveProtected, selectPackageWorktrees, withQueueLock } from "../tools/release-package-retention.mjs";
import { acquireQueueLock, durableCreate, queueVersion, submitPreparation } from "../tools/main-prebuild-queue.mjs";
import { artifactLossPacketId } from "../tools/prepared-artifact-loss.mjs";

const name = (index) => `${index.toString(16).padStart(12, "0")}-aabbccdd-11223344`;
const pkg = (index, mtimeMs) => ({ name: name(index), mtimeMs });
const worktree = (index, extra = {}) => ({ worktree: `${packagesRoot}\\${name(index)}\\source`, packageName: name(index), ...extra });

test("protected installed and rollback anchor survive even when oldest", () => {
  const packages = [pkg(1, 1000), pkg(2, 2000), pkg(3, 3000), pkg(4, 4000)];
  const plan = planRetention({ packages, worktrees: [], branches: [], protectedNames: [name(1), name(2)], keepRecent: 1 });
  assert.deepEqual(plan.keep, [name(1), name(2), name(4)].sort());
  assert.deepEqual(plan.removeDirectories.map((item) => item.name), [name(3)]);
});

test("keepRecent retains the newest packages by mtime, newest first", () => {
  const packages = [pkg(1, 10), pkg(2, 50), pkg(3, 30), pkg(4, 40), pkg(5, 20)];
  const plan = planRetention({ packages, worktrees: [], branches: [], protectedNames: [name(1)], keepRecent: 2 });
  assert.deepEqual(plan.keep, [name(1), name(2), name(4)].sort());
  assert.deepEqual(plan.removeDirectories.map((item) => item.name).sort(), [name(3), name(5)].sort());
});

test("only worktrees physically inside the packages root are ever in scope", () => {
  const rows = parseWorktrees([
    `worktree ${packagesRoot}\\${name(1)}\\source`, "HEAD abc", "locked reason", "",
    "worktree D:\\运营管理系统", "HEAD def", "",
    "worktree D:\\运营管理系统\\.claude\\worktrees\\other", "HEAD 111", "",
    `worktree ${packagesRoot}\\not-a-package\\source`, "HEAD 222", "",
  ].join("\n"));
  const selected = selectPackageWorktrees(rows);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].packageName, name(1));
});

test("stale registrations cover vanished directories and ones this run removes", () => {
  const packages = [pkg(1, 100), pkg(2, 200)];
  const plan = planRetention({
    packages,
    worktrees: [worktree(1, { locked: "reason" }), worktree(2), worktree(9, { locked: "reason" })],
    branches: [], protectedNames: [name(2)], keepRecent: 0,
  });
  // name(9) has no directory at all; name(1) is removed by this run; name(2) is protected.
  assert.deepEqual(plan.staleWorktrees.map((row) => row.packageName).sort(), [name(1), name(9)].sort());
});

test("branch cleanup spares live packages and ignores unrelated branches", () => {
  const packages = [pkg(1, 100), pkg(2, 200)];
  const plan = planRetention({
    packages, worktrees: [], branches: [`codex/manual-main-${name(1)}`, `codex/manual-main-${name(2)}`, `codex/manual-main-${name(9)}`, "codex/other-work", "main"],
    protectedNames: [name(2)], keepRecent: 0,
  });
  assert.deepEqual(plan.staleBranches, [`codex/manual-main-${name(1)}`, `codex/manual-main-${name(9)}`]);
});

test("real-world retry and recovery package names are in scope", () => {
  // Observed in production: -r2/-r3/-r4 retry suffixes and pi150-forward recovery packets.
  const real = ["36668589cab0-71ecf390-bbc9a5ef-r2", "4dccd1883e95-cac80221-9ea443c1-r2", "47e1e89fea91-pi150-forward"];
  const rows = parseWorktrees(real.map((n) => `worktree ${packagesRoot}\\${n}\\source\nHEAD abc\n`).join("\n"));
  assert.deepEqual(selectPackageWorktrees(rows).map((row) => row.packageName), real);
  const packages = real.map((n, i) => ({ name: n, mtimeMs: i }));
  const plan = planRetention({ packages, worktrees: [], branches: [], protectedNames: [real[0]], keepRecent: 0 });
  assert.deepEqual(plan.removeDirectories.map((item) => item.name).sort(), real.slice(1).sort());
});

test("invalid retention input and malformed names fail closed", () => {
  const packages = [pkg(1, 100)];
  const base = { packages, worktrees: [], branches: [], protectedNames: [name(1)] };
  for (const keepRecent of [-1, 1.5, 51, "5"]) assert.throws(() => planRetention({ ...base, keepRecent }), /Invalid keepRecent/);
  assert.throws(() => planRetention({ ...base, protectedNames: [] }), /Invalid protected set/);
  assert.throws(() => planRetention({ ...base, protectedNames: ["../../escape"] }), /Invalid protected set/);
  assert.throws(() => planRetention({ ...base, packages: [{ name: "../../etc", mtimeMs: 1 }] }), /Invalid package name/);
});

// ---- protected set: catalog / frontend source / preparation pointer (synthetic temp trees only) ----
const release = "20261112T000000Z-test";
const elsewhere = path.join(os.tmpdir(), "retention-elsewhere");

// Every temp tree is removed after its test, pass or fail.
const createdBases = [];
afterEach(async () => {
  for (const base of createdBases.splice(0)) await rm(base, { recursive: true, force: true });
});

async function buildWorld({ packages = [1, 3], django = 1, catalogSource = 3, frontendSource = 3, frontendRaw, catalog, writeCatalog = true } = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), "retention-protect-"));
  createdBases.push(base);
  const packagesDirectory = path.join(base, "packages");
  const roots = { djangoRoot: path.join(base, "django"), stateDirectory: path.join(base, "state"), workerRoot: path.join(base, "worker"), packagesDirectory };
  const source = (index) => path.join(packagesDirectory, name(index), "source");
  for (const index of packages) await mkdir(source(index), { recursive: true });
  await mkdir(path.join(roots.djangoRoot, "app"), { recursive: true });
  await mkdir(roots.stateDirectory, { recursive: true });
  await mkdir(path.join(roots.workerRoot, "releases", release), { recursive: true });
  await writeFile(path.join(roots.djangoRoot, "app", "deployment.json"), JSON.stringify({ sourceRoot: source(django) }));
  await writeFile(path.join(roots.workerRoot, "releases", release, "deployment-manifest.json"),
    JSON.stringify({ source: { sourceBinding: { raw: frontendRaw ?? JSON.stringify({ sourceRoot: source(frontendSource) }) } } }));
  const catalogFile = path.join(roots.stateDirectory, "PUBLISHED-MAIN.json");
  const writeCatalogFile = (value) => writeFile(catalogFile, typeof value === "string" ? value : JSON.stringify(value));
  const standard = { source: source(catalogSource), workerRelease: release,
    receiptPath: path.join(packagesDirectory, name(catalogSource), "publish-aabbccddeeff", "SUCCESS.json") };
  if (writeCatalog) await writeCatalogFile(typeof catalog === "string" ? catalog : { ...standard, ...catalog });
  const writePointer = (value) => writeFile(path.join(roots.stateDirectory, "LATEST-PREPARED.json"), typeof value === "string" ? value : JSON.stringify(value));
  return { roots, source, writeCatalogFile, writePointer, standard };
}

test("frontend-only release: catalog package differs from Django and survives as oldest with keepRecent 0", async () => {
  // Django still runs package 1; catalog and frontend point at package 3, the oldest by mtime.
  const world = await buildWorld({ packages: [1, 3], django: 1, catalogSource: 3, frontendSource: 3 });
  const guard = await resolveProtected(world.roots);
  assert.equal(guard.installed, name(1));
  assert.equal(guard.catalogSource, name(3));
  assert.deepEqual([...guard.names].sort(), [name(1), name(3)].sort());
  const packages = [pkg(3, 1), pkg(1, 2), pkg(7, 3)];
  const plan = planRetention({ packages, worktrees: [], branches: [], protectedNames: guard.names, keepRecent: 0 });
  assert.ok(plan.keep.includes(name(3)));
  assert.deepEqual(plan.removeDirectories.map((item) => item.name), [name(7)]);
});

test("adoption receipt outside the packages root: no throw, receipt entry null, source still protected", async () => {
  const world = await buildWorld({ packages: [1, 2], catalogSource: 2, frontendSource: 2,
    catalog: { receiptPath: path.join(elsewhere, "adoptions", "u", "ADOPTED.json") } });
  const guard = await resolveProtected(world.roots);
  assert.equal(guard.catalogReceipt, null);
  assert.equal(guard.catalogSource, name(2));
  assert.ok(guard.names.includes(name(2)));
});

test("catalog missing, unparsable, sourceless or pointing outside a package fails closed", async () => {
  await assert.rejects(resolveProtected((await buildWorld({ writeCatalog: false })).roots), /Publication catalog unreadable/);
  await assert.rejects(resolveProtected((await buildWorld({ catalog: "{not json" })).roots), /Publication catalog is not valid JSON/);
  await assert.rejects(resolveProtected((await buildWorld({ catalog: { source: "" } })).roots), /Publication catalog has no source/);
  await assert.rejects(resolveProtected((await buildWorld({ catalog: { source: path.join(elsewhere, "source") } })).roots),
    /catalog source is not inside a release package/);
  const world = await buildWorld();
  await mkdir(path.join(world.roots.packagesDirectory, "not-a-package", "source"), { recursive: true });
  await world.writeCatalogFile({ ...world.standard, source: path.join(world.roots.packagesDirectory, "not-a-package", "source") });
  await assert.rejects(resolveProtected(world.roots), /catalog source is not inside a release package/);
});

test("catalog source or receipt package absent from the packages root fails closed", async () => {
  const ghostSource = await buildWorld();
  await ghostSource.writeCatalogFile({ ...ghostSource.standard, source: ghostSource.source(9) });
  await assert.rejects(resolveProtected(ghostSource.roots), /source package is missing/);
  const ghostReceipt = await buildWorld();
  await ghostReceipt.writeCatalogFile({ ...ghostReceipt.standard,
    receiptPath: path.join(ghostReceipt.roots.packagesDirectory, name(8), "publish-aabbccddeeff", "SUCCESS.json") });
  await assert.rejects(resolveProtected(ghostReceipt.roots), /receipt package is missing/);
});

test("receipt inside the packages root with the wrong shape fails closed", async () => {
  const world = await buildWorld();
  const inside = path.join(world.roots.packagesDirectory, name(3));
  for (const receiptPath of [path.join(inside, "publish-aabbccddeeff"), path.join(inside, "publish-xyz", "SUCCESS.json"),
    path.join(inside, "other", "SUCCESS.json"), path.join(inside, "publish-aabbccddeeff", "deep", "SUCCESS.json")]) {
    await world.writeCatalogFile({ ...world.standard, receiptPath });
    await assert.rejects(resolveProtected(world.roots), /receiptPath has an unexpected shape/, receiptPath);
  }
});

test("frontend manifest unreadable or without sourceRoot fails closed", async () => {
  await assert.rejects(resolveProtected((await buildWorld({ frontendRaw: "{}" })).roots), /Frontend manifest has no sourceRoot/);
  await assert.rejects(resolveProtected((await buildWorld({ frontendRaw: "{nope" })).roots), /no parsable sourceRoot/);
  await assert.rejects(resolveProtected((await buildWorld({ catalog: { workerRelease: "../escape" } })).roots), /workerRelease is missing or malformed/);
  const gone = await buildWorld();
  await rm(path.join(gone.roots.workerRoot, "releases"), { recursive: true });
  await assert.rejects(resolveProtected(gone.roots), /Frontend deployment manifest unreadable/);
});

test("frontend source package already deleted is reported, not fatal", async () => {
  const world = await buildWorld({ frontendSource: 5 });
  const guard = await resolveProtected(world.roots);
  assert.equal(guard.frontendSource, name(5));
  assert.equal(guard.frontendSourceExists, false);
  assert.ok(guard.names.includes(name(5)));
});

test("preparation pointer: absent is null, valid is protected, malformed fails closed", async () => {
  const world = await buildWorld({ packages: [1, 3, 4] });
  const absent = await resolveProtected(world.roots);
  assert.equal(absent.preparedPacket, null);
  const packetDir = path.join(world.roots.packagesDirectory, name(4));
  await world.writePointer({ packet: packetDir });
  const guard = await resolveProtected(world.roots);
  assert.equal(guard.preparedPacket, name(4));
  assert.equal(guard.preparedPacketExists, true);
  assert.deepEqual([...guard.names].sort(), [name(1), name(3), name(4)].sort());
  for (const bad of ["{nope", "{}", JSON.stringify({ packet: path.join(world.roots.packagesDirectory, "not-a-package") }),
    JSON.stringify({ packet: path.join(packetDir, "source") }), JSON.stringify({ packet: path.join(elsewhere, "p") })]) {
    await world.writePointer(bad);
    await assert.rejects(resolveProtected(world.roots), /Preparation pointer/, bad);
  }
});

test("four protections each hold their own package: Django, frontend source, catalog source, catalog receipt", async () => {
  // Four distinct packages, all older than the unprotected 5 and 6; no preparation pointer to cover for any of them.
  const world = await buildWorld({ packages: [1, 2, 3, 4, 5, 6], django: 1, frontendSource: 2, catalogSource: 3 });
  await world.writeCatalogFile({ ...world.standard,
    receiptPath: path.join(world.roots.packagesDirectory, name(4), "publish-aabbccddeeff", "SUCCESS.json") });
  const guard = await resolveProtected(world.roots);
  assert.equal(guard.installed, name(1));
  assert.equal(guard.frontendSource, name(2));
  assert.equal(guard.catalogSource, name(3));
  assert.equal(guard.catalogReceipt, name(4));
  assert.equal(guard.preparedPacket, null);
  const packages = [pkg(1, 1), pkg(2, 2), pkg(3, 3), pkg(4, 4), pkg(5, 5), pkg(6, 6)];
  const plan = planRetention({ packages, worktrees: [], branches: [], protectedNames: guard.names, keepRecent: 0 });
  for (const index of [1, 2, 3, 4]) assert.ok(plan.keep.includes(name(index)), "protected: " + name(index));
  assert.deepEqual(plan.removeDirectories.map((item) => item.name).sort(), [name(5), name(6)].sort());
});

test("root containment ignores drive/directory case and slash style", { skip: process.platform !== "win32" }, async () => {
  const world = await buildWorld({ packages: [1, 2, 3, 4], django: 1 });
  // Same directory, written upper-case with forward slashes; package names stay lower-case hex.
  const variant = world.roots.packagesDirectory.toUpperCase().replaceAll("\\", "/");
  assert.notEqual(variant, world.roots.packagesDirectory);
  await world.writeCatalogFile({ ...world.standard, source: variant + "/" + name(3) + "/source",
    receiptPath: variant + "/" + name(4) + "/publish-aabbccddeeff/SUCCESS.json" });
  const manifestFile = path.join(world.roots.workerRoot, "releases", release, "deployment-manifest.json");
  await writeFile(manifestFile, JSON.stringify({ source: { sourceBinding: { raw: JSON.stringify({ sourceRoot: variant + "/" + name(2) + "/source" }) } } }));
  const guard = await resolveProtected(world.roots);
  assert.equal(guard.catalogSource, name(3));
  assert.equal(guard.catalogReceipt, name(4));
  assert.equal(guard.frontendSource, name(2));
});

test("relative catalog receiptPath fails closed instead of being treated as outside the root", async () => {
  const world = await buildWorld();
  for (const receiptPath of ["publish-aabbccddeeff/SUCCESS.json", "../adoptions/ADOPTED.json"]) {
    await world.writeCatalogFile({ ...world.standard, receiptPath });
    await assert.rejects(resolveProtected(world.roots), /receiptPath is not an absolute path/, receiptPath);
  }
});

// ---- queue-referenced packages (synthetic temp queue only) ----
const queueGeneration = { configSha256: "1".repeat(64), bundleSha256: "2".repeat(64) };
const queueTarget = "a".repeat(40);

// One dispatch for one packet whose single ticket ends in the given terminal kind.
async function addQueueDispatch(queue, packet, kind) {
  const submitted = await submitPreparation(queue, { ...queueGeneration, origin: "manual" });
  const live = { mainCommit: "b".repeat(40), head: { bindingSha256: "5".repeat(64) }, djangoManifestSha256: "6".repeat(64), chainStateSha256: "7".repeat(64) };
  const dispatchId = randomUUID();
  const dispatch = { version: queueVersion, dispatchId, requestId: submitted.requestId, mode: "prepare-only", ...queueGeneration, selectedTarget: queueTarget,
    selection: { targetCommit: queueTarget, packet, live }, deadlineUnixMs: Date.now() - 3600000, dispatchedAt: new Date().toISOString(),
    tickets: [{ requestId: submitted.requestId, ticketSha256: submitted.ticketSha256, observedTarget: null }] };
  const dispatchSha256 = await durableCreate(path.join(queue, "dispatches", dispatchId + ".json"), dispatch);
  const refs = { dispatchId, dispatchSha256, selectedTarget: queueTarget, winnerRequestId: submitted.requestId };
  const base = { version: queueVersion, requestId: submitted.requestId, ticketSha256: submitted.ticketSha256, at: new Date().toISOString(), ...queueGeneration };
  let terminal;
  if (kind === "prepared") {
    terminal = { ...base, status: "prepared", ...refs, nativeResult: { status: "prepared-only", mainCommit: queueTarget, publicationPerformed: false,
      preparationFile: path.join(packet, "publish-" + queueTarget.slice(0, 12), "preparation/PREPARED.json"), preparationSha256: "3".repeat(64) } };
  } else if (kind === "failed-native") {
    terminal = { ...base, status: "failed", ...refs, error: "failed", preparationTerminal: { kind: "native-preparation-failed", phase: "prepare",
      resultFile: path.join(packet, "invocations", randomUUID() + ".json"), resultSha256: "4".repeat(64) } };
  } else if (kind === "failed-rejected") {
    terminal = { ...base, status: "failed", ...refs, error: "failed", preparationTerminal: { kind: "rejected-before-native", stage: "fetch" } };
  } else if (kind === "unknown") terminal = { ...base, status: "unknown", ...refs, error: "unknown" };
  if (terminal) await durableCreate(path.join(queue, "results", submitted.requestId + ".json"), terminal);
  return { dispatchId, requestId: submitted.requestId };
}

async function queueWorld() {
  const world = await buildWorld({ packages: [1, 3, 5, 6, 7, 8, 9], django: 1, catalogSource: 3, frontendSource: 3 });
  const queue = path.join(world.roots.stateDirectory, "prebuild-queue-v2");
  for (const leaf of ["tickets", "dispatches", "results"]) await mkdir(path.join(queue, leaf), { recursive: true });
  const packet = (index) => path.join(world.roots.packagesDirectory, name(index));
  return { world, queue, packet };
}

test("queue protection: prepared and native-failed packets are protected, rejected-before-native and unknown groups are not", async () => {
  const { world, queue, packet } = await queueWorld();
  await addQueueDispatch(queue, packet(5), "prepared");
  await addQueueDispatch(queue, packet(6), "failed-native");
  await addQueueDispatch(queue, packet(7), "failed-rejected");
  await addQueueDispatch(queue, packet(8), "unknown");
  assert.deepEqual(await queueProtectedPackages({ queueDirectory: queue, packagesDirectory: world.roots.packagesDirectory }), [name(5), name(6)].sort());
  const guard = await resolveProtected(world.roots);
  assert.deepEqual(guard.queueProtected, [name(5), name(6)].sort());
  for (const protectedName of [name(1), name(3), name(5), name(6)]) assert.ok(guard.names.includes(protectedName), protectedName);
  // Only evidence-free packages stay deletable, even with keepRecent 0 and the queue packages being the oldest.
  const packages = [1, 3, 5, 6, 7, 8, 9].map((index) => pkg(index, index));
  const plan = planRetention({ packages, worktrees: [], branches: [], protectedNames: guard.names, keepRecent: 0 });
  assert.deepEqual(plan.removeDirectories.map((item) => item.name).sort(), [name(7), name(8), name(9)].sort());
});

test("queue protection: a loss-covered packet is not protected; a mixed group is protected by its prepared ticket", async () => {
  const { world, queue, packet } = await queueWorld();
  await addQueueDispatch(queue, packet(5), "prepared");
  await addQueueDispatch(queue, packet(6), "prepared");
  await addQueueDispatch(queue, packet(7), "failed-rejected");
  await addQueueDispatch(queue, packet(7), "prepared");
  await mkdir(path.join(queue, "artifact-losses"), { recursive: true });
  // Retention reads only the packet identity of a loss record; the registry validates the rest elsewhere.
  await durableCreate(path.join(queue, "artifact-losses", artifactLossPacketId(packet(5)) + ".json"), { version: "teruisi-prepared-artifact-loss-record-v1", packet: packet(5) });
  assert.deepEqual(await queueProtectedPackages({ queueDirectory: queue, packagesDirectory: world.roots.packagesDirectory }), [name(6), name(7)].sort());
});

test("queue protection: path normalization ignores case and slash style; packets outside the root are ignored; nested paths fail closed", async () => {
  const { queue, packet, world } = await queueWorld();
  const root = world.roots.packagesDirectory;
  await addQueueDispatch(queue, path.join(root.toUpperCase(), name(5)).replaceAll("\\", "/"), "prepared");
  await addQueueDispatch(queue, path.join(elsewhere, name(6)), "prepared");
  assert.deepEqual(await queueProtectedPackages({ queueDirectory: queue, packagesDirectory: root }), [name(5)]);
  await addQueueDispatch(queue, path.join(packet(7), "source"), "prepared");
  await assert.rejects(queueProtectedPackages({ queueDirectory: queue, packagesDirectory: root }), /not a direct release package/);
});

test("queue protection: an absent queue protects nothing; an unreadable queue or loss record refuses to plan", async () => {
  const none = await buildWorld();
  assert.deepEqual((await resolveProtected(none.roots)).queueProtected, []);
  const { world, queue, packet } = await queueWorld();
  const { requestId } = await addQueueDispatch(queue, packet(5), "prepared");
  const roots = world.roots;
  const resultFile = path.join(queue, "results", requestId + ".json");
  const good = await readFile(resultFile);
  await writeFile(resultFile, "{not json");
  await assert.rejects(resolveProtected(roots), /Preparation queue unreadable; refusing to plan retention/);
  await writeFile(resultFile, JSON.stringify({ version: "teruisi-main-prebuild-queue-v2" }));
  await assert.rejects(resolveProtected(roots), /Preparation queue unreadable/);
  await writeFile(resultFile, good);
  assert.deepEqual((await resolveProtected(roots)).queueProtected, [name(5)]);
  await writeFile(path.join(queue, "dispatches", "not-a-dispatch.json"), "{}");
  await assert.rejects(resolveProtected(roots), /Preparation queue unreadable/);
  await rm(path.join(queue, "dispatches", "not-a-dispatch.json"));
  await mkdir(path.join(queue, "artifact-losses"), { recursive: true });
  const lossFile = path.join(queue, "artifact-losses", artifactLossPacketId(packet(5)) + ".json");
  await writeFile(lossFile, "{broken");
  await assert.rejects(resolveProtected(roots), /Artifact loss record unreadable/);
  await rm(lossFile);
  await durableCreate(lossFile, { version: "teruisi-prepared-artifact-loss-record-v1", packet: packet(6) });
  await assert.rejects(resolveProtected(roots), /does not match its name/);
  await rm(lossFile);
  await writeFile(path.join(queue, "artifact-losses", "stray.json"), "{}");
  await assert.rejects(resolveProtected(roots), /Unknown artifact loss record name/);
});

test("execute holds the queue lock for the whole operation and refuses when the lock is busy", async () => {
  const { queue } = await queueWorld();
  const result = await withQueueLock(queue, async () => {
    assert.equal(await acquireQueueLock(queue), null, "the queue is locked while the operation runs");
    return "done";
  });
  assert.equal(result, "done");
  const release = await acquireQueueLock(queue);
  assert.ok(release);
  let ranBusy = false;
  await assert.rejects(withQueueLock(queue, async () => { ranBusy = true; }), /queue lock is busy/);
  assert.equal(ranBusy, false);
  await release();
  // The lock is released after a failing operation too.
  await assert.rejects(withQueueLock(queue, async () => { throw new Error("planned failure"); }), /planned failure/);
  const again = await acquireQueueLock(queue);
  assert.ok(again);
  await again();
});
