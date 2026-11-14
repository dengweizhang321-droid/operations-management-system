// Retention for D:\codex-isolated\main-release-packages.
//
// Each package there is a locked git worktree created by
// tools/publish-latest-main.mjs (prepareLatestMainOnce), which has no retention
// of its own. Deleting only the directory leaves a stale locked worktree
// registration plus its codex/manual-main-* branch behind, so cleanup must run
// unlock -> remove -> prune -> delete branch as one unit.
//
// The protected set is READ AT RUN TIME from production state and never from a
// stored list: the installed Django app, its rollback anchor, and everything the
// publisher re-reads on start (publication catalog source/receipt, the frontend
// live source, and the latest preparation pointer) plus every package the
// preparation queue still needs native evidence from (see queueProtectedPackages).
import { execFile } from "node:child_process";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireQueueLock, readPreparationQueueStructure, readQueueObject } from "./main-prebuild-queue.mjs";
import { artifactLossPacketId } from "./prepared-artifact-loss.mjs";

export const packagesRoot = "D:\\codex-isolated\\main-release-packages";
const djangoRuntimeRoot = "D:\\teruisi-runtime\\django-sales";
const defaultStateDirectory = "D:\\codex-isolated\\main-manual-release-20261016";
const defaultWorkerRuntimeRoot = "D:\\teruisi-runtime\\teruisi-worker-sales";
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

async function readJson(file, label) {
  let raw;
  try { raw = await readFile(file, "utf8"); }
  catch (error) { throw new Error(`${label} unreadable (${error.code ?? error.message}): ${file}`); }
  try { return JSON.parse(raw); }
  catch { throw new Error(`${label} is not valid JSON: ${file}`); }
}

// Segments of target below root, or null when target is not strictly inside root.
function segmentsBelow(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep);
}

async function directoryExists(root, name) {
  try { return (await stat(path.join(root, name))).isDirectory(); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

// Packages the preparation queue still reads natively. Queue normal consumption validates, for every
// dispatch group, PREPARED.json/main-release-request.json (prepared) or the invocations result file
// (failed with a native terminal) unless an artifact-loss record retires the whole packet. A deleted
// package therefore blocks the publisher's first step. Fail closed: any unreadable record throws.
const winKey = (file) => path.resolve(file).toLowerCase();
export async function queueProtectedPackages({ queueDirectory, packagesDirectory = packagesRoot }) {
  try { await stat(queueDirectory); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  let inventory;
  try { inventory = await readPreparationQueueStructure(queueDirectory); }
  catch (error) { throw new Error(`Preparation queue unreadable; refusing to plan retention: ${error.message}`); }
  const covered = new Set();
  const lossDirectory = path.join(queueDirectory, "artifact-losses");
  let lossNames = [];
  try { lossNames = await readdir(lossDirectory); }
  catch (error) { if (error.code !== "ENOENT") throw new Error(`Artifact loss records unreadable: ${error.message}`); }
  for (const lossName of lossNames) {
    if (!/^[a-f0-9]{64}\.json$/.test(lossName)) throw new Error(`Unknown artifact loss record name: ${lossName}`);
    let record;
    try { record = (await readQueueObject(path.join(lossDirectory, lossName))).value; }
    catch (error) { throw new Error(`Artifact loss record unreadable: ${lossName}: ${error.message}`); }
    if (typeof record?.packet !== "string" || !path.isAbsolute(record.packet) || artifactLossPacketId(record.packet) + ".json" !== lossName) {
      throw new Error(`Artifact loss record does not match its name: ${lossName}`);
    }
    covered.add(winKey(record.packet));
  }
  const needsNative = (terminal) => terminal?.status === "prepared"
    || (terminal?.status === "failed" && terminal.preparationTerminal?.kind === "native-preparation-failed");
  const names = new Set();
  for (const read of inventory.dispatches) {
    const packet = read.value.selection.packet;
    if (covered.has(winKey(packet))) continue;
    if (!read.value.tickets.some((ref) => needsNative(inventory.terminals.get(ref.requestId)))) continue;
    const segments = segmentsBelow(packagesDirectory, packet);
    if (!segments) continue; // not a package under this root; retention never deletes it
    const name = segments[0].toLowerCase();
    if (segments.length !== 1 || !packageName.test(name)) {
      throw new Error(`Queue dispatch packet is not a direct release package: ${packet}`);
    }
    names.add(name);
  }
  return [...names].sort();
}

// The root parameters are injection seams for tests; defaults are the production paths.
export async function resolveProtected({
  djangoRoot = djangoRuntimeRoot,
  stateDirectory = defaultStateDirectory,
  workerRoot = defaultWorkerRuntimeRoot,
  packagesDirectory = packagesRoot,
  queueDirectory = path.join(stateDirectory, "prebuild-queue-v2"),
} = {}) {
  const installed = await readSourceRoot(path.join(djangoRoot, "app", "deployment.json"));
  if (!installed) throw new Error("Installed Django manifest is missing; refusing to plan retention");
  const previous = await readSourceRoot(path.join(djangoRoot, "app.previous", "deployment.json"));

  // Publication catalog: the publisher re-reads catalog.source and catalog.receiptPath on every start.
  const catalogFile = path.join(stateDirectory, "PUBLISHED-MAIN.json");
  const catalog = await readJson(catalogFile, "Publication catalog");
  if (!catalog || typeof catalog !== "object" || typeof catalog.source !== "string" || !catalog.source) {
    throw new Error(`Publication catalog has no source: ${catalogFile}`);
  }
  const sourceSegments = segmentsBelow(packagesDirectory, catalog.source);
  if (!sourceSegments || !packageName.test(sourceSegments[0])) {
    throw new Error(`Publication catalog source is not inside a release package: ${catalog.source}`);
  }
  const catalogSource = sourceSegments[0];
  if (!await directoryExists(packagesDirectory, catalogSource)) {
    throw new Error(`Publication catalog source package is missing from the packages root: ${catalogSource}`);
  }

  if (typeof catalog.receiptPath !== "string" || !catalog.receiptPath) {
    throw new Error(`Publication catalog has no receiptPath: ${catalogFile}`);
  }
  if (!path.isAbsolute(catalog.receiptPath)) {
    throw new Error(`Publication catalog receiptPath is not an absolute path: ${catalog.receiptPath}`);
  }
  let catalogReceipt = null;
  const receiptSegments = segmentsBelow(packagesDirectory, catalog.receiptPath);
  if (receiptSegments) {
    // Normal publication shape: <package>\publish-<12 hex>\<file>. Adoption receipts live outside the root.
    if (receiptSegments.length !== 3 || !packageName.test(receiptSegments[0]) || !/^publish-[0-9a-f]{12}$/.test(receiptSegments[1])) {
      throw new Error(`Publication catalog receiptPath has an unexpected shape: ${catalog.receiptPath}`);
    }
    catalogReceipt = receiptSegments[0];
    if (!await directoryExists(packagesDirectory, catalogReceipt)) {
      throw new Error(`Publication catalog receipt package is missing from the packages root: ${catalogReceipt}`);
    }
  }

  // Frontend live source, resolved from the catalog's workerRelease the way the publisher does.
  const releaseId = catalog.workerRelease;
  if (typeof releaseId !== "string" || !/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(releaseId)) {
    throw new Error("Publication catalog workerRelease is missing or malformed");
  }
  const manifestFile = path.join(workerRoot, "releases", releaseId, "deployment-manifest.json");
  const manifest = await readJson(manifestFile, "Frontend deployment manifest");
  let frontendSourceRoot;
  try { frontendSourceRoot = JSON.parse(manifest.source.sourceBinding.raw).sourceRoot; }
  catch { throw new Error(`Frontend manifest has no parsable sourceRoot: ${manifestFile}`); }
  if (typeof frontendSourceRoot !== "string" || !frontendSourceRoot) throw new Error(`Frontend manifest has no sourceRoot: ${manifestFile}`);
  let frontendSource = null;
  const frontendSegments = segmentsBelow(packagesDirectory, frontendSourceRoot);
  if (frontendSegments) {
    if (!packageName.test(frontendSegments[0])) throw new Error(`Frontend sourceRoot is not a release package: ${frontendSourceRoot}`);
    frontendSource = frontendSegments[0];
  }
  // A package already gone is reported, not fatal: an earlier manual cleanup may have removed it.
  const frontendSourceExists = frontendSource ? await directoryExists(packagesDirectory, frontendSource) : false;

  // Preparation pointer: optional, but if present it must be sound.
  const pointerFile = path.join(stateDirectory, "LATEST-PREPARED.json");
  let pointerRaw = null;
  try { pointerRaw = await readFile(pointerFile, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw new Error(`Preparation pointer unreadable (${error.code ?? error.message}): ${pointerFile}`); }
  let preparedPacket = null;
  if (pointerRaw !== null) {
    let pointer;
    try { pointer = JSON.parse(pointerRaw); }
    catch { throw new Error(`Preparation pointer is not valid JSON: ${pointerFile}`); }
    const packetSegments = typeof pointer?.packet === "string" ? segmentsBelow(packagesDirectory, pointer.packet) : null;
    if (!packetSegments || packetSegments.length !== 1 || !packageName.test(packetSegments[0])) {
      throw new Error(`Preparation pointer packet is not a release package: ${pointer?.packet}`);
    }
    preparedPacket = packetSegments[0];
  }
  const preparedPacketExists = preparedPacket ? await directoryExists(packagesDirectory, preparedPacket) : false;

  const queueProtected = await queueProtectedPackages({ queueDirectory, packagesDirectory });
  const names = [...new Set([installed, previous, catalogSource, catalogReceipt, frontendSource, preparedPacket, ...queueProtected].filter(Boolean))];
  return { installed, previous, catalogSource, catalogReceipt, frontendSource, frontendSourceExists, preparedPacket, preparedPacketExists, queueProtected, names };
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

// Execute holds the queue lock across plan and apply so a drain or retirement cannot change the
// queue between the protected-set read and the deletes. A busy lock refuses; nothing is deleted.
export async function withQueueLock(queueDirectory, operation) {
  const unlock = await acquireQueueLock(queueDirectory);
  if (!unlock) throw new Error("Preparation queue lock is busy; refusing to plan or delete release packages");
  try { return await operation(); }
  finally { await unlock(); }
}

async function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const execute = argv.includes("--execute");
  if (dryRun === execute) throw new Error("Pass exactly one of --dry-run or --execute");
  const keepIndex = argv.indexOf("--keep-recent");
  const keepRecent = keepIndex === -1 ? 5 : Number(argv[keepIndex + 1]);
  const repository = process.cwd();
  const run = async () => {
    const { guard, plan } = await collect({ repository, keepRecent });
    return { guard, plan, removed: execute ? await apply({ repository, plan }) : undefined };
  };
  const { guard, plan, removed } = execute ? await withQueueLock(path.join(defaultStateDirectory, "prebuild-queue-v2"), run) : await run();
  const report = {
    version: "teruisi-release-package-retention-v1",
    mode: dryRun ? "dry-run" : "execute",
    keepRecent,
    protected: {
      installed: guard.installed,
      rollbackAnchor: guard.previous,
      catalogSource: guard.catalogSource,
      catalogReceipt: guard.catalogReceipt,
      frontendSource: guard.frontendSource,
      frontendSourceDirectoryExists: guard.frontendSourceExists,
      preparedPacket: guard.preparedPacket,
      preparedPacketDirectoryExists: guard.preparedPacketExists,
      queueReferenced: guard.queueProtected,
    },
    keep: plan.keep,
    removeDirectoryCount: plan.removeDirectories.length,
    removeDirectories: plan.removeDirectories.map((item) => item.name),
    staleWorktreeCount: plan.staleWorktrees.length,
    staleWorktrees: plan.staleWorktrees.map((row) => row.packageName),
    staleBranchCount: plan.staleBranches.length,
    staleBranches: plan.staleBranches,
  };
  if (execute) report.removed = removed;
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
