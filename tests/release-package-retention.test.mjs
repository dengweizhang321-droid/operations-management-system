import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { packagesRoot, parseWorktrees, planRetention, resolveProtected, selectPackageWorktrees } from "../tools/release-package-retention.mjs";

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

async function buildWorld({ packages = [1, 3], django = 1, catalogSource = 3, frontendSource = 3, frontendRaw, catalog, writeCatalog = true } = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), "retention-protect-"));
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
