// Retention for task working directories under D:\codex-isolated.
//
// These are leftovers from past release/task runs. Unlike main-release-packages
// (see tools/release-package-retention.mjs) they have no naming convention and
// no production manifest pointing at them, so safety comes from re-verifying
// every候选 at run time rather than trusting any stored list:
//
//   * skip anything written within --min-age-days (default 7)
//   * skip anything holding a registered git worktree (those need the
//     unlock -> remove -> prune -> delete-branch sequence instead)
//   * skip anything with uncommitted changes
//   * skip an explicit protected list (the release-package generator's host)
//
// --dry-run prints the plan and touches nothing. --execute removes only
// directories that pass every check in the same run.
import { execFile } from "node:child_process";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const isolatedRoot = "D:\\codex-isolated";
// Never a candidate: the packages root has its own tool, and the generator host
// is read by publish-latest-main.mjs (pwshDirectory / npmCacheDirectory).
export const alwaysProtected = Object.freeze(["main-release-packages", "main-manual-release-20261016"]);
const taskName = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function run(file, args, { cwd } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => resolve({ stdout: stdout ?? "", failed: Boolean(error) }));
  });
}

export function parseWorktreePaths(porcelain) {
  return porcelain.split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.resolve(line.slice("worktree ".length).trim()));
}

// Full records, needed to unlock and to delete the right branch. `locked` and
// `prunable` appear as bare keywords, optionally followed by a reason.
export function parseWorktreeRecords(porcelain) {
  const records = [];
  let current = {};
  for (const line of porcelain.split("\n")) {
    const text = line.trimEnd();
    if (!text) { if (current.worktree) records.push(current); current = {}; continue; }
    const index = text.indexOf(" ");
    const key = index === -1 ? text : text.slice(0, index);
    current[key] = index === -1 ? true : text.slice(index + 1);
  }
  if (current.worktree) records.push(current);
  return records.map((record) => ({
    path: path.resolve(record.worktree),
    branch: typeof record.branch === "string" ? record.branch.replace(/^refs\/heads\//, "") : null,
    locked: record.locked !== undefined,
    prunable: record.prunable !== undefined,
  }));
}

// Registrations to retire for a set of task directories being removed. Scoped
// strictly to paths at or below those directories so unrelated worktrees -
// including this session's own - can never be selected.
export function selectWorktreesFor(directoryNames, records, root = isolatedRoot) {
  const bases = directoryNames.map((name) => path.resolve(root, name));
  return records.filter((record) => bases.some((base) => record.path === base || record.path.startsWith(base + path.sep)));
}

// A directory is "holding" a worktree when any registration lives at or below it.
export function holdsWorktree(directory, worktreePaths) {
  const base = path.resolve(directory);
  const prefix = base + path.sep;
  return worktreePaths.some((item) => item === base || item.startsWith(prefix));
}

// withWorktrees=false (default) refuses any directory holding a registration,
// so a plain run can never leave a stale one behind. Passing true opts in to
// retiring them, which the caller must then carry out in full.
export function classify({ entries, worktreePaths, now, minAgeDays, protectedNames = alwaysProtected, withWorktrees = false }) {
  if (!Number.isFinite(minAgeDays) || minAgeDays < 1) throw new Error("Invalid minAgeDays");
  const protectedSet = new Set(protectedNames);
  const candidates = [], skipped = [];
  for (const entry of entries) {
    const reasonsToSkip = [];
    if (!taskName.test(entry.name)) reasonsToSkip.push("name-not-simple");
    if (protectedSet.has(entry.name)) reasonsToSkip.push("protected");
    const ageDays = (now - entry.mtimeMs) / 86400000;
    if (!(ageDays >= minAgeDays)) reasonsToSkip.push(`recent(${ageDays.toFixed(1)}d)`);
    const holding = holdsWorktree(path.join(isolatedRoot, entry.name), worktreePaths);
    if (holding && !withWorktrees) reasonsToSkip.push("holds-worktree");
    if (entry.uncommitted > 0) reasonsToSkip.push(`uncommitted(${entry.uncommitted})`);
    if (reasonsToSkip.length) skipped.push({ name: entry.name, reasons: reasonsToSkip, sizeMB: entry.sizeMB });
    else candidates.push({ name: entry.name, ageDays: Number(ageDays.toFixed(1)), sizeMB: entry.sizeMB, holdsWorktree: holding });
  }
  return { candidates, skipped };
}

async function directorySizeMB(root) {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let items;
    try { items = await readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) { stack.push(full); continue; }
      try { total += (await stat(full)).size; } catch { /* vanished */ }
    }
  }
  return Math.round(total / 2 ** 20 * 10) / 10;
}

// Uncommitted changes are only meaningful for a checkout; a plain directory
// reports nothing, and a nested repo is detected via its own status.
async function uncommittedCount(directory) {
  const { stdout, failed } = await run("git", ["status", "--porcelain"], { cwd: directory });
  if (failed) return 0;
  return stdout.split("\n").filter((line) => line.trim()).length;
}

export async function collect({ repository, minAgeDays = 7, names = null, withWorktrees = false }) {
  const porcelain = (await run("git", ["worktree", "list", "--porcelain"], { cwd: repository })).stdout;
  const records = parseWorktreeRecords(porcelain);
  const worktreePaths = parseWorktreePaths(porcelain);
  const listing = await readdir(isolatedRoot, { withFileTypes: true });
  const entries = [];
  for (const item of listing) {
    if (!item.isDirectory() || item.isSymbolicLink()) continue;
    if (names && !names.includes(item.name)) continue;
    const full = path.join(isolatedRoot, item.name);
    const info = await stat(full);
    const source = path.join(full, "source");
    let uncommitted = 0;
    try { if ((await stat(source)).isDirectory()) uncommitted = await uncommittedCount(source); } catch { /* no source */ }
    entries.push({ name: item.name, mtimeMs: info.mtimeMs, sizeMB: await directorySizeMB(full), uncommitted });
  }
  const result = classify({ entries, worktreePaths, now: Date.now(), minAgeDays, withWorktrees });
  const retiring = withWorktrees ? selectWorktreesFor(result.candidates.map((item) => item.name), records) : [];
  return { ...result, retiring };
}

async function main(argv) {
  const dryRun = argv.includes("--dry-run"), execute = argv.includes("--execute");
  if (dryRun === execute) throw new Error("Pass exactly one of --dry-run or --execute");
  const ageIndex = argv.indexOf("--min-age-days");
  const minAgeDays = ageIndex === -1 ? 7 : Number(argv[ageIndex + 1]);
  const onlyIndex = argv.indexOf("--only");
  const names = onlyIndex === -1 ? null : argv[onlyIndex + 1].split(",").map((item) => item.trim()).filter(Boolean);
  const withWorktrees = argv.includes("--with-worktrees");
  const repository = process.cwd();
  const { candidates, skipped, retiring } = await collect({ repository, minAgeDays, names, withWorktrees });
  const report = {
    version: "teruisi-codex-isolated-task-retention-v1",
    mode: dryRun ? "dry-run" : "execute", minAgeDays, withWorktrees,
    candidateCount: candidates.length,
    candidateTotalGB: Number((candidates.reduce((sum, item) => sum + item.sizeMB, 0) / 1024).toFixed(2)),
    candidates,
    retiringWorktreeCount: retiring.length,
    retiringWorktrees: retiring.map((record) => ({ path: record.path, branch: record.branch, locked: record.locked })),
    retiringBranches: retiring.map((record) => record.branch).filter(Boolean),
    skippedCount: skipped.length,
    skipped,
  };
  if (execute) {
    // Order matters: unlock first (a locked worktree survives prune), then drop
    // the directories, then prune the now-dangling registrations, then branches.
    for (const record of retiring) {
      if (record.locked) await run("git", ["worktree", "unlock", record.path], { cwd: repository });
    }
    const removed = [];
    for (const item of candidates) {
      const target = path.join(isolatedRoot, item.name);
      if (path.dirname(path.resolve(target)) !== path.resolve(isolatedRoot)) throw new Error("Target escaped isolated root");
      if (alwaysProtected.includes(item.name)) throw new Error("Refusing to remove a protected directory");
      await rm(target, { recursive: true, force: true });
      removed.push(item.name);
    }
    if (retiring.length) await run("git", ["worktree", "prune"], { cwd: repository });
    let branches = 0;
    for (const branch of report.retiringBranches) {
      const { failed } = await run("git", ["branch", "-D", branch], { cwd: repository });
      if (!failed) branches += 1;
    }
    report.removed = removed.length;
    report.prunedWorktrees = retiring.length;
    report.deletedBranches = branches;
  }
  process.stdout.write(JSON.stringify(report, null, 1) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
