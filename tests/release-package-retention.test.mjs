import assert from "node:assert/strict";
import test from "node:test";
import { packagesRoot, parseWorktrees, planRetention, selectPackageWorktrees } from "../tools/release-package-retention.mjs";

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
