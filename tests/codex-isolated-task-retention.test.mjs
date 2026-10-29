import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { alwaysProtected, classify, holdsWorktree, isolatedRoot, parseWorktreePaths, parseWorktreeRecords, selectWorktreesFor } from "../tools/codex-isolated-task-retention.mjs";

const DAY = 86400000;
const now = Date.parse("2026-10-29T12:00:00Z");
const entry = (name, { days = 30, sizeMB = 100, uncommitted = 0 } = {}) =>
  ({ name, mtimeMs: now - days * DAY, sizeMB, uncommitted });
const base = { worktreePaths: [], now, minAgeDays: 7 };

test("old plain directories are candidates", () => {
  const { candidates, skipped } = classify({ ...base, entries: [entry("jd-pop-release-20261015"), entry("combined-release-20261014")] });
  assert.deepEqual(candidates.map((item) => item.name), ["jd-pop-release-20261015", "combined-release-20261014"]);
  assert.equal(skipped.length, 0);
});

test("recently written directories are skipped with their age", () => {
  const { candidates, skipped } = classify({ ...base, entries: [entry("fresh", { days: 2 }), entry("edge", { days: 6.9 })] });
  assert.equal(candidates.length, 0);
  assert.deepEqual(skipped.map((item) => item.name), ["fresh", "edge"]);
  assert.match(skipped[0].reasons[0], /^recent\(2\.0d\)$/);
});

test("the packages root and the generator host are never candidates", () => {
  const { candidates, skipped } = classify({ ...base, entries: alwaysProtected.map((name) => entry(name)) });
  assert.equal(candidates.length, 0);
  assert.equal(skipped.length, alwaysProtected.length);
  for (const item of skipped) assert.ok(item.reasons.includes("protected"), item.name);
});

test("a directory holding a registered worktree is skipped, nested paths included", () => {
  const held = path.join(isolatedRoot, "has-wt", "source");
  const { candidates, skipped } = classify({
    ...base, entries: [entry("has-wt"), entry("no-wt")], worktreePaths: [path.resolve(held)],
  });
  assert.deepEqual(candidates.map((item) => item.name), ["no-wt"]);
  assert.ok(skipped[0].reasons.includes("holds-worktree"));
});

test("uncommitted changes keep a directory even when old", () => {
  const { candidates, skipped } = classify({ ...base, entries: [entry("dirty", { uncommitted: 4 })] });
  assert.equal(candidates.length, 0);
  assert.ok(skipped[0].reasons.includes("uncommitted(4)"));
});

test("unusual names are refused rather than guessed at", () => {
  const { candidates, skipped } = classify({ ...base, entries: [entry("..")] });
  assert.equal(candidates.length, 0);
  assert.ok(skipped[0].reasons.includes("name-not-simple"));
});

test("worktree porcelain parsing keeps only worktree lines", () => {
  const paths = parseWorktreePaths(["worktree D:/a/b", "HEAD abc", "branch refs/heads/x", "", "worktree D:/c/d", "locked reason"].join("\n"));
  assert.deepEqual(paths, [path.resolve("D:/a/b"), path.resolve("D:/c/d")]);
  assert.equal(holdsWorktree("D:/a/b", paths), true);
  assert.equal(holdsWorktree("D:/a", paths), true);
  assert.equal(holdsWorktree("D:/a/bc", paths), false);
});

test("withWorktrees opts a holding directory in and records it", () => {
  const held = path.resolve(isolatedRoot, "has-wt", "source");
  const args = { ...base, entries: [entry("has-wt")], worktreePaths: [held] };
  assert.equal(classify(args).candidates.length, 0, "default must refuse");
  const opted = classify({ ...args, withWorktrees: true });
  assert.deepEqual(opted.candidates.map((item) => item.name), ["has-wt"]);
  assert.equal(opted.candidates[0].holdsWorktree, true);
});

test("withWorktrees never overrides protection, age or uncommitted changes", () => {
  const entries = [entry("main-release-packages"), entry("fresh", { days: 1 }), entry("dirty", { uncommitted: 2 })];
  const worktreePaths = entries.map((item) => path.resolve(isolatedRoot, item.name, "source"));
  const { candidates } = classify({ ...base, entries, worktreePaths, withWorktrees: true });
  assert.equal(candidates.length, 0);
});

test("worktree records expose branch and lock state", () => {
  const records = parseWorktreeRecords([
    "worktree D:/codex-isolated/a/source", "HEAD abc", "branch refs/heads/codex/a", "locked keep while in use", "",
    "worktree D:/codex-isolated/b/source", "HEAD def", "detached", "",
  ].join("\n"));
  assert.equal(records.length, 2);
  assert.deepEqual({ branch: records[0].branch, locked: records[0].locked }, { branch: "codex/a", locked: true });
  assert.deepEqual({ branch: records[1].branch, locked: records[1].locked }, { branch: null, locked: false });
});

test("retirement selection is confined to the directories being removed", () => {
  const records = parseWorktreeRecords([
    "worktree D:/codex-isolated/doomed/source", "branch refs/heads/codex/doomed", "",
    "worktree D:/codex-isolated/doomed-sibling/source", "branch refs/heads/codex/sibling", "",
    "worktree D:/codex-isolated/keep/source", "branch refs/heads/codex/keep", "",
    "worktree D:/运营管理系统", "branch refs/heads/main", "",
    "worktree D:/运营管理系统/.claude/worktrees/mine", "branch refs/heads/codex/mine", "",
  ].join("\n"));
  const selected = selectWorktreesFor(["doomed"], records);
  // "doomed-sibling" shares a prefix but is a different directory; the main
  // checkout and this session's own worktree must never be touched.
  assert.deepEqual(selected.map((item) => item.branch), ["codex/doomed"]);
});

test("an invalid minimum age fails closed", () => {
  for (const minAgeDays of [0, -1, Number.NaN, "7"]) {
    assert.throws(() => classify({ ...base, minAgeDays, entries: [entry("x")] }), /Invalid minAgeDays/);
  }
});
