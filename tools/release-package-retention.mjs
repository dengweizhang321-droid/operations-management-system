// Retention for D:\codex-isolated\main-release-packages.
//
// Each package there is a locked git worktree created by
// tools/publish-latest-main.mjs (prepareLatestMainOnce), which has no retention
// of its own. Deleting only the directory leaves a stale locked worktree
// registration plus its codex/manual-main-* branch behind, so cleanup must run
// unlock -> remove -> prune -> delete branch as one unit.
//
// The protected set is READ AT RUN TIME from the two production manifests and
// never from a stored list: the installed Django app and its rollback anchor.
import { execFile } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const packagesRoot = "D:\\codex-isolated\\main-release-packages";
const djangoRuntimeRoot = "D:\\teruisi-runtime\\django-sales";
// Real names observed in production are not only "<12 hex>-<8>-<8>": retries
// append -r2/-r3/-r4, and recovery packets use forms like
// "47e1e89fea91-pi150-forward". Anchor on the 12-hex commit prefix and allow
// any further dash-separated alphanumeric segments, while still refusing
// traversal and separators.
const packageName = /^[0-9a-f]{12}(?:-[0-9a-z]+)+$/;
const branchPrefix = "codex/manual-main-";

function run(file, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd, encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => error ? reject(new Error(`${file} ${args.join(" ")}: ${stderr || error.message}`)) : resolve(stdout));
  });
}

async function readSourceRoot(manifestPath) {
  // A missing app.previous is legitimate (no deploy has been superseded yet).
  let raw;
  try { raw = await readFile(manifestPath, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  const sourceRoot = JSON.parse(raw).sourceRoot;
  if (typeof sourceRoot !== "string" || !sourceRoot) throw new Error(`Manifest has no sourceRoot: ${manifestPath}`);
  const name = path.basename(path.dirname(path.resolve(sourceRoot)));
  if (!packageName.test(name)) throw new Error(`sourceRoot is not a release package: ${sourceRoot}`);
  return name;
}

export async function resolveProtected() {
  const installed = await readSourceRoot(path.join(djangoRuntimeRoot, "app", "deployment.json"));
  if (!installed) throw new Error("Installed Django manifest is missing; refusing to plan retention");
  const previous = await readSourceRoot(path.join(djangoRuntimeRoot, "app.previous", "deployment.json"));
  return { installed, previous, names: [installed, ...(previous ? [previous] : [])] };
}

export function parseWorktrees(porcelain) {
  const rows = [];
  let current = {};
  for (const line of porcelain.split("\n")) {
    const text = line.trimEnd();
    if (!text) { if (current.worktree) rows.push(current); current = {}; continue; }
    const index = text.indexOf(" ");
    if (index === -1) current[text] = true;
    else current[text.slice(0, index)] = text.slice(index + 1);
  }
  if (current.worktree) rows.push(current);
  return rows;
}

// Only rows physically inside packagesRoot are in scope; the repository has many
// unrelated worktrees and none of them may be touched.
export function selectPackageWorktrees(rows) {
  const root = path.resolve(packagesRoot) + path.sep;
  return rows.filter((row) => {
    const full = path.resolve(row.worktree ?? "");
    if (!full.startsWith(root)) return false;
    return path.basename(full) === "source" && packageName.test(path.basename(path.dirname(full)));
  }).map((row) => ({ ...row, packageName: path.basename(path.dirname(path.resolve(row.worktree))) }));
}

export function planRetention({ packages, worktrees, branches, protectedNames, keepRecent = 5 }) {
  if (!Number.isInteger(keepRecent) || keepRecent < 0 || keepRecent > 50) throw new Error("Invalid keepRecent");
  if (!Array.isArray(protectedNames) || !protectedNames.length
      || protectedNames.some((name) => !packageName.test(name))) throw new Error("Invalid protected set");
  for (const item of packages) if (!packageName.test(item.name)) throw new Error(`Invalid package name: ${item.name}`);
  const ordered = [...packages].sort((left, right) => right.mtimeMs - left.mtimeMs);
  const keep = new Set([...protectedNames, ...ordered.slice(0, keepRecent).map((item) => item.name)]);
  const removeDirectories = ordered.filter((item) => !keep.has(item.name));
  const removeNames = new Set(removeDirectories.map((item) => item.name));
  // A stale registration is one whose package directory is already gone, or one
  // belonging to a package this run removes. Protected packages are never listed.
  const staleWorktrees = worktrees.filter((row) => !keep.has(row.packageName)
    && (row.prunable !== undefined || !packages.some((item) => item.name === row.packageName) || removeNames.has(row.packageName)));
  const liveNames = new Set([...keep]);
  const staleBranches = branches.filter((branch) => {
    if (!branch.startsWith(branchPrefix)) return false;
    return !liveNames.has(branch.slice(branchPrefix.length));
  });
  return { keep: [...keep].sort(), removeDirectories, staleWorktrees, staleBranches };
}

async function listPackages() {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const packages = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !packageName.test(entry.name)) continue;
    const info = await stat(path.join(packagesRoot, entry.name));
    packages.push({ name: entry.name, mtimeMs: info.mtimeMs });
  }
  return packages;
}

export async function collect({ repository, keepRecent = 5 }) {
  const guard = await resolveProtected();
  const packages = await listPackages();
  if (!packages.some((item) => item.name === guard.installed)) throw new Error("Installed package is missing from the packages root");
  const worktrees = selectPackageWorktrees(parseWorktrees(await run("git", ["worktree", "list", "--porcelain"], { cwd: repository })));
  const branches = (await run("git", ["branch", "--list", `${branchPrefix}*`, "--format=%(refname:short)"], { cwd: repository }))
    .split("\n").map((line) => line.trim()).filter(Boolean);
  return { guard, plan: planRetention({ packages, worktrees, branches, protectedNames: guard.names, keepRecent }) };
}

async function apply({ repository, plan }) {
  const removed = { worktrees: 0, directories: 0, branches: 0 };
  for (const row of plan.staleWorktrees) {
    if (row.locked !== undefined) await run("git", ["worktree", "unlock", row.worktree], { cwd: repository }).catch(() => {});
    removed.worktrees += 1;
  }
  for (const item of plan.removeDirectories) {
    const target = path.join(packagesRoot, item.name);
    if (path.dirname(path.resolve(target)) !== path.resolve(packagesRoot)) throw new Error("Target escaped packages root");
    await rm(target, { recursive: true, force: true });
    removed.directories += 1;
  }
  await run("git", ["worktree", "prune"], { cwd: repository });
  for (const branch of plan.staleBranches) {
    await run("git", ["branch", "-D", branch], { cwd: repository });
    removed.branches += 1;
  }
  return removed;
}

async function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const execute = argv.includes("--execute");
  if (dryRun === execute) throw new Error("Pass exactly one of --dry-run or --execute");
  const keepIndex = argv.indexOf("--keep-recent");
  const keepRecent = keepIndex === -1 ? 5 : Number(argv[keepIndex + 1]);
  const repository = process.cwd();
  const { guard, plan } = await collect({ repository, keepRecent });
  const report = {
    version: "teruisi-release-package-retention-v1",
    mode: dryRun ? "dry-run" : "execute",
    keepRecent,
    protected: { installed: guard.installed, rollbackAnchor: guard.previous },
    keep: plan.keep,
    removeDirectoryCount: plan.removeDirectories.length,
    removeDirectories: plan.removeDirectories.map((item) => item.name),
    staleWorktreeCount: plan.staleWorktrees.length,
    staleWorktrees: plan.staleWorktrees.map((row) => row.packageName),
    staleBranchCount: plan.staleBranches.length,
    staleBranches: plan.staleBranches,
  };
  if (execute) report.removed = await apply({ repository, plan });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
