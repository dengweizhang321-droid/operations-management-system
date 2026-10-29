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

// A directory is "holding" a worktree when any registration lives at or below it.
export function holdsWorktree(directory, worktreePaths) {
  const base = path.resolve(directory);
  const prefix = base + path.sep;
  return worktreePaths.some((item) => item === base || item.startsWith(prefix));
}

export function classify({ entries, worktreePaths, now, minAgeDays, protectedNames = alwaysProtected }) {
  if (!Number.isFinite(minAgeDays) || minAgeDays < 1) throw new Error("Invalid minAgeDays");
  const protectedSet = new Set(protectedNames);
  const candidates = [], skipped = [];
  for (const entry of entries) {
    const reasonsToSkip = [];
    if (!taskName.test(entry.name)) reasonsToSkip.push("name-not-simple");
    if (protectedSet.has(entry.name)) reasonsToSkip.push("protected");
    const ageDays = (now - entry.mtimeMs) / 86400000;
    if (!(ageDays >= minAgeDays)) reasonsToSkip.push(`recent(${ageDays.toFixed(1)}d)`);
    if (holdsWorktree(path.join(isolatedRoot, entry.name), worktreePaths)) reasonsToSkip.push("holds-worktree");
    if (entry.uncommitted > 0) reasonsToSkip.push(`uncommitted(${entry.uncommitted})`);
    if (reasonsToSkip.length) skipped.push({ name: entry.name, reasons: reasonsToSkip, sizeMB: entry.sizeMB });
    else candidates.push({ name: entry.name, ageDays: Number(ageDays.toFixed(1)), sizeMB: entry.sizeMB });
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

export async function collect({ repository, minAgeDays = 7, names = null }) {
  const worktreePaths = parseWorktreePaths((await run("git", ["worktree", "list", "--porcelain"], { cwd: repository })).stdout);
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
  return classify({ entries, worktreePaths, now: Date.now(), minAgeDays });
}

async function main(argv) {
  const dryRun = argv.includes("--dry-run"), execute = argv.includes("--execute");
  if (dryRun === execute) throw new Error("Pass exactly one of --dry-run or --execute");
  const ageIndex = argv.indexOf("--min-age-days");
  const minAgeDays = ageIndex === -1 ? 7 : Number(argv[ageIndex + 1]);
  const onlyIndex = argv.indexOf("--only");
  const names = onlyIndex === -1 ? null : argv[onlyIndex + 1].split(",").map((item) => item.trim()).filter(Boolean);
  const { candidates, skipped } = await collect({ repository: process.cwd(), minAgeDays, names });
  const report = {
    version: "teruisi-codex-isolated-task-retention-v1",
    mode: dryRun ? "dry-run" : "execute", minAgeDays,
    candidateCount: candidates.length,
    candidateTotalGB: Number((candidates.reduce((sum, item) => sum + item.sizeMB, 0) / 1024).toFixed(2)),
    candidates,
    skippedCount: skipped.length,
    skipped,
  };
  if (execute) {
    const removed = [];
    for (const item of candidates) {
      const target = path.join(isolatedRoot, item.name);
      if (path.dirname(path.resolve(target)) !== path.resolve(isolatedRoot)) throw new Error("Target escaped isolated root");
      if (alwaysProtected.includes(item.name)) throw new Error("Refusing to remove a protected directory");
      await rm(target, { recursive: true, force: true });
      removed.push(item.name);
    }
    report.removed = removed.length;
  }
  process.stdout.write(JSON.stringify(report, null, 1) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
