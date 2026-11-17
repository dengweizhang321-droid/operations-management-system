import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { link, lstat, mkdir, open, readFile, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assertLogisticsManifest, type JdLogisticsManifest } from "../lib/jd/logistics-manifest";
import { canonicalLogisticsJson } from "../lib/jd/logistics-policy";

/** Generic zero-effect closure of a failed JD logistics plan that never reached
 * a business page. It is invoked by the next plan (A) inside the plan lock. The
 * original failed manifest is never modified; only active.json is archived. */
export type ZeroEffectActive = { runId: string; executionId: string; planHash: string };
export type ZeroEffectVerdict = { verdict: "zero_effect" | "not_closable"; reasons: string[]; evidence?: ZeroEffectEvidence };
export type ZeroEffectEvidence = {
  whitelistVersion: number; runId: string; executionId: string; planHash: string; activeSha256: string; manifestSha256: string;
  failureCode: string; failureStage: string; failureAt: string; operations: Array<{ operationId: string; sourceKind: string; stage: string }>;
  notificationStage: string; downloads: "absent" | "directories_only";
};
export type ZeroEffectLock = { assertOwned: () => Promise<void> };

/** Failure codes thrown by createJdLogisticsSessionGuard before it returns a
 * business frame. The throw-site test pins that no other file raises them and
 * that the exporter only calls the guard before its first export manifest. */
export const JD_LOGISTICS_PRE_BUSINESS_THROW_SUFFIXES = [
  "LOGIN_REQUIRED", "LOGIN_CHALLENGE_MANUAL_ACTION", "LOGIN_CREDENTIAL_REJECTED_MANUAL_ACTION", "LOGIN_LOCKED_MANUAL_ACTION",
  "LOGIN_CONTROL_AMBIGUOUS", "BUSINESS_FRAME_AMBIGUOUS", "LOGIN_ORIGIN_REJECTED", "LOGIN_STORE_MISMATCH",
  "LOGIN_CREDENTIAL_UNAVAILABLE_MANUAL_ACTION", "LOGIN_SUBMISSION_UNKNOWN_MANUAL_ACTION", "LOGIN_FORM_NOT_READY_MANUAL_ACTION",
  "LOGIN_NOT_COMPLETED_MANUAL_ACTION", "BUSINESS_FRAME_NOT_READY",
] as const;
/** Pre-business too, but the code itself says a credential was rejected, the
 * account is locked, or a login submission has an unknown/incomplete outcome.
 * Automatically planning again would submit the credential again, so these stay
 * with a human even though no business effect exists. */
export const JD_LOGISTICS_CREDENTIAL_RISK_SUFFIXES = [
  "LOGIN_CREDENTIAL_REJECTED_MANUAL_ACTION", "LOGIN_LOCKED_MANUAL_ACTION", "LOGIN_SUBMISSION_UNKNOWN_MANUAL_ACTION", "LOGIN_NOT_COMPLETED_MANUAL_ACTION",
] as const;
export const JD_LOGISTICS_PRE_BUSINESS_FAILURE_CODES: readonly string[] = JD_LOGISTICS_PRE_BUSINESS_THROW_SUFFIXES
  .filter(suffix => !(JD_LOGISTICS_CREDENTIAL_RISK_SUFFIXES as readonly string[]).includes(suffix)).map(suffix => `JD_LOGISTICS_${suffix}`);
const whitelistVersion = 1;
const manifestKeys = new Set(["datePolicy", "timeZone", "protocolVersion", "workflowKey", "runId", "executionId", "createdAt", "updatedAt", "anchorAt", "baseUrl",
  "planHash", "stage", "outcome", "notificationPlan", "notification", "operations", "failure"]);
// Static plan fields only. Any progress field (export, receipt, hashes, row
// counts, parser version, or a future one) is an unknown key and blocks closure.
const operationKeys = new Set(["operationId", "departmentId", "businessUnitCode", "sourceKind", "rangeStart", "rangeEnd", "warehouseCode", "collectorStoreKey",
  "contractVersion", "policyHash", "initialScopeRevision", "storeIdentityHash", "sourceStatus", "stage"]);
const maxDownloadEntries = 2000;
const exec = promisify(execFile);
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const same = (a: unknown, b: unknown) => canonicalLogisticsJson(a) === canonicalLogisticsJson(b);
/** A consistency refusal. The caller maps it to the unchanged PREVIOUS_RUN_UNRESOLVED error. */
export class ZeroEffectRefusal extends Error { constructor(readonly reason: string) { super(`JD_LOGISTICS_ZERO_EFFECT_REFUSED:${reason}`); } }
function refuse(reason: string): never { throw new ZeroEffectRefusal(reason); }

function pipelinePaths(root: string, runId?: string) {
  if (!path.isAbsolute(root) || runId !== undefined && !/^[A-Za-z0-9._-]{1,96}$/.test(runId)) throw new Error("JD_LOGISTICS_INVALID_RUNTIME_ROOT");
  const directory = path.join(root, "outputs", "jd-logistics-pipeline");
  return { directory, active: path.join(directory, "active.json"), manifest: runId ? path.join(directory, `${runId}.json`) : "", downloads: runId ? path.join(directory, "downloads", runId) : "" };
}
/** Regular, single-link file; no ancestor may be a link. Returns null when absent. */
async function readControlFile(file: string, limit = 4 * 1024 * 1024): Promise<Buffer | null> {
  const info = await lstat(file).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; });
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > limit) refuse("control_file_identity");
  const data = await readFile(file);
  if (data.length !== info.size) refuse("control_file_changed");
  return data;
}
function parseObject(bytes: Buffer): Record<string, any> {
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8").replace(/^﻿/, "")); } catch { refuse("control_file_not_json"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse("control_file_not_object");
  return value as Record<string, any>;
}
const reasonOf = (error: unknown) => error instanceof ZeroEffectRefusal ? error.reason : null;

async function downloadState(downloads: string, operationIds: string[]): Promise<"absent" | "directories_only"> {
  const info = await lstat(downloads).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; });
  if (!info) return "absent";
  if (!info.isDirectory() || info.isSymbolicLink()) refuse("download_root_is_link_or_file");
  if (path.resolve(await realpath(downloads)).toLowerCase() !== path.resolve(downloads).toLowerCase()) refuse("download_root_is_link");
  let entries = 0;
  const walk = async (directory: string, depth: number) => {
    if (depth > 4) refuse("download_tree_too_deep");
    for (const name of await readdir(directory)) {
      if (++entries > maxDownloadEntries) refuse("download_tree_too_large");
      const child = path.join(directory, name), stat = await lstat(child);
      if (stat.isSymbolicLink()) refuse("download_contains_link");
      if (!stat.isDirectory()) refuse("download_contains_file");
      if (depth === 0 && !operationIds.includes(name)) refuse("download_unexpected_directory");
      await walk(child, depth + 1);
    }
  };
  await walk(downloads, 0);
  return "directories_only";
}

/** Read-only. Never writes, creates, or moves anything. */
export async function assessJdLogisticsZeroEffect(root: string, active: ZeroEffectActive): Promise<ZeroEffectVerdict> {
  const reasons: string[] = [];
  try {
    if (!active || typeof active.runId !== "string" || typeof active.executionId !== "string" || typeof active.planHash !== "string") refuse("active_shape");
    const files = pipelinePaths(root, active.runId);
    const activeBytes = await readControlFile(files.active);
    if (!activeBytes) refuse("active_missing");
    if (!same(parseObject(activeBytes), { runId: active.runId, executionId: active.executionId, planHash: active.planHash })) refuse("active_differs_from_argument");
    const manifestBytes = await readControlFile(files.manifest);
    if (!manifestBytes) refuse("manifest_missing");
    const plan = parseObject(manifestBytes) as unknown as JdLogisticsManifest;
    try { assertLogisticsManifest(plan, active.executionId); } catch { refuse("manifest_identity_check_failed"); }
    if (plan.runId !== active.runId || plan.executionId !== active.executionId || plan.planHash !== active.planHash) refuse("manifest_not_bound_to_active");
    const unknownKeys = Object.keys(plan).filter(key => !manifestKeys.has(key));
    if (unknownKeys.length) refuse(`manifest_unknown_field:${unknownKeys.join(",")}`);
    if (plan.stage !== "failed") refuse(`manifest_stage_${String(plan.stage)}`);
    if (plan.outcome !== "pending") refuse(`manifest_outcome_${String(plan.outcome)}`);
    const failure = plan.failure;
    if (!failure || failure.stage !== "run" || typeof failure.code !== "string" || typeof failure.at !== "string") refuse("failure_missing_or_not_run_stage");
    if (!JD_LOGISTICS_PRE_BUSINESS_FAILURE_CODES.includes(failure.code)) refuse(`failure_code_not_whitelisted:${failure.code}`);
    if (!plan.operations.length) refuse("no_operations");
    plan.operations.forEach((operation, index) => {
      const extra = Object.keys(operation).filter(key => !operationKeys.has(key));
      if (extra.length) refuse(`operation_${index}_progress_or_unknown_field:${extra.join(",")}`);
      if (operation.stage === "exporting" ? index !== 0 : operation.stage !== "planned") refuse(`operation_${index}_stage_${String(operation.stage)}`);
    });
    const notification = plan.notification as Record<string, unknown>;
    if (notification.stage !== "pending" || Object.keys(notification).some(key => key !== "stage")) refuse("notification_not_pristine");
    const downloads = await downloadState(files.downloads, plan.operations.map(operation => operation.operationId));
    const evidence: ZeroEffectEvidence = { whitelistVersion, runId: plan.runId, executionId: plan.executionId, planHash: plan.planHash,
      activeSha256: sha(activeBytes), manifestSha256: sha(manifestBytes), failureCode: failure.code, failureStage: failure.stage, failureAt: failure.at,
      operations: plan.operations.map(operation => ({ operationId: operation.operationId, sourceKind: operation.sourceKind, stage: operation.stage })),
      notificationStage: "pending", downloads };
    return { verdict: "zero_effect", reasons: ["no_business_effect_evidence"], evidence };
  } catch (error) {
    const reason = reasonOf(error);
    if (reason === null) throw error;
    reasons.push(reason);
    return { verdict: "not_closable", reasons };
  }
}

async function createOnly(file: string, data: string | Uint8Array) {
  const handle = await open(file, "wx");
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
}
async function moveNoReplace(from: string, to: string) {
  if (process.platform === "win32") {
    // .NET File.Move refuses to replace an existing destination; fs.rename may replace it.
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    await exec("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop';[System.IO.File]::Move(${quote(from)},${quote(to)})`],
      { timeout: 15000, windowsHide: true });
  } else { await link(from, to); await rm(from); }
}
const safeName = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "_");
export function zeroEffectClosureDirectoryName(executionId: string, activeSha256: string) { return `zero-effect-${safeName(executionId)}-${activeSha256.slice(0, 16)}`; }
type Intent = { version: string; status: "intent"; at: string; closedBy: { executionId: string }; original: { runId: string; executionId: string; planHash: string; activeSha256: string; manifestSha256: string };
  evidence: ZeroEffectEvidence; archiveFile: "active.archived.json"; originalFailureRetained: true; oldExecutionReplayAllowed: false };
const intentVersion = "jd-logistics-zero-effect-closure-v1";
const names = { original: "active.original.json", manifest: "manifest.original.json", intent: "intent.json", archive: "active.archived.json", committed: "committed.json" };

async function ensureFile(file: string, expected: string | Uint8Array) {
  const existing = await readControlFile(file);
  if (existing === null) { await createOnly(file, expected); return; }
  if (sha(existing) !== sha(expected)) refuse("existing_closure_file_differs");
}
async function readIntent(directory: string): Promise<Intent | null> {
  const bytes = await readControlFile(path.join(directory, names.intent));
  if (!bytes) return null;
  const intent = parseObject(bytes) as unknown as Intent;
  const o = intent.original;
  if (intent.version !== intentVersion || intent.status !== "intent" || !o || !intent.evidence || intent.archiveFile !== names.archive
    || o.activeSha256 !== intent.evidence.activeSha256 || o.manifestSha256 !== intent.evidence.manifestSha256 || o.runId !== intent.evidence.runId
    || o.executionId !== intent.evidence.executionId || o.planHash !== intent.evidence.planHash) refuse("intent_inconsistent");
  return intent;
}
async function writeCommitted(directory: string, intent: Intent, resumedBy: string) {
  const intentBytes = await readControlFile(path.join(directory, names.intent));
  const committed = { ...intent, status: "committed", committedAt: new Date().toISOString(), intentSha256: sha(intentBytes!), committedBy: { executionId: resumedBy },
    nextAction: "Plan a new execution from A; the archived execution is permanently not replayable." };
  await ensureFile(path.join(directory, names.committed), jsonBytes(committed));
}
/** Verify archive-state closure: the archive is exactly the original active, the
 * original failed manifest is untouched, and the live active pointer is gone. */
async function verifyArchived(files: ReturnType<typeof pipelinePaths>, directory: string, intent: Intent) {
  const archive = await readControlFile(path.join(directory, names.archive)), original = await readControlFile(path.join(directory, names.original));
  const manifestCopy = await readControlFile(path.join(directory, names.manifest)), manifest = await readControlFile(path.join(files.directory, `${intent.original.runId}.json`));
  if (!archive || !original || !manifestCopy || !manifest) refuse("archive_state_file_missing");
  if (sha(archive) !== intent.original.activeSha256 || sha(original) !== intent.original.activeSha256
    || sha(manifestCopy) !== intent.original.manifestSha256 || sha(manifest) !== intent.original.manifestSha256) refuse("archive_state_digest_mismatch");
  if (await readControlFile(files.active) !== null) refuse("active_and_archive_both_present");
}

/** Finish or reject interrupted closures. Called first by A, inside the plan lock. */
export async function reconcileJdLogisticsZeroEffectClosures(root: string, executionId: string, lock: ZeroEffectLock) {
  const files = pipelinePaths(root);
  const entries = await readdir(files.directory).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; });
  const pending: string[] = [];
  for (const name of entries.filter(entry => entry.startsWith("zero-effect-"))) {
    const directory = path.join(files.directory, name), info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) refuse("closure_entry_not_directory");
    if (await readControlFile(path.join(directory, names.committed)) === null) pending.push(name);
  }
  if (!pending.length) return;
  if (pending.length > 1) refuse("multiple_pending_closures");
  const directory = path.join(files.directory, pending[0]), intent = await readIntent(directory);
  const live = await readControlFile(files.active), hasArchive = await readControlFile(path.join(directory, names.archive)) !== null;
  if (!intent) {
    // Crashed while creating the directory: nothing was archived. Resume only if the live pointer is still
    // the plan this directory was named for; the normal path then re-checks the evidence and fills the files.
    const parsed = live === null || hasArchive ? null : parseObject(live);
    if (!parsed || typeof parsed.executionId !== "string" || pending[0] !== zeroEffectClosureDirectoryName(parsed.executionId, sha(live!))) refuse("pending_closure_without_intent");
    return;
  }
  const expectedName = zeroEffectClosureDirectoryName(intent.original.executionId, intent.original.activeSha256);
  if (pending[0] !== expectedName) refuse("closure_directory_name_mismatch");
  if (live === null && hasArchive) {
    await verifyArchived(pipelinePaths(root, intent.original.runId), directory, intent);
    await lock.assertOwned(); await writeCommitted(directory, intent, executionId); return;
  }
  // Intent only: A resumes it through the normal path with the same evidence;
  // that requires the live pointer to still be the original one.
  if (live !== null && !hasArchive && sha(live) === intent.original.activeSha256) return;
  refuse("pending_closure_state_inconsistent");
}

/** Close a zero-effect previous plan. Returns false when the previous plan is not closable. */
export async function closeJdLogisticsZeroEffectPlan(root: string, active: ZeroEffectActive, executionId: string, lock: ZeroEffectLock, now = new Date()) {
  const verdict = await assessJdLogisticsZeroEffect(root, active);
  if (verdict.verdict !== "zero_effect" || !verdict.evidence) return false;
  const evidence = verdict.evidence, files = pipelinePaths(root, active.runId);
  const directory = path.join(files.directory, zeroEffectClosureDirectoryName(evidence.executionId, evidence.activeSha256));
  const activeBytes = (await readControlFile(files.active))!, manifestBytes = (await readControlFile(files.manifest))!;
  try {
    await mkdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) refuse("closure_directory_identity");
  }
  const existingIntent = await readIntent(directory);
  if (existingIntent && (!same(existingIntent.evidence, evidence) || existingIntent.original.activeSha256 !== evidence.activeSha256)) refuse("resume_evidence_differs");
  if (await readControlFile(path.join(directory, names.committed)) !== null) refuse("closure_already_committed_but_active_present");
  await ensureFile(path.join(directory, names.original), activeBytes);
  await ensureFile(path.join(directory, names.manifest), manifestBytes);
  const intent: Intent = existingIntent ?? { version: intentVersion, status: "intent", at: now.toISOString(), closedBy: { executionId },
    original: { runId: evidence.runId, executionId: evidence.executionId, planHash: evidence.planHash, activeSha256: evidence.activeSha256, manifestSha256: evidence.manifestSha256 },
    evidence, archiveFile: "active.archived.json", originalFailureRetained: true, oldExecutionReplayAllowed: false };
  if (!existingIntent) await createOnly(path.join(directory, names.intent), jsonBytes(intent));
  // Re-verify nothing moved while the intent was being written.
  await lock.assertOwned();
  const again = await assessJdLogisticsZeroEffect(root, active);
  if (again.verdict !== "zero_effect" || !same(again.evidence, evidence)) refuse("evidence_changed_before_archive");
  await moveNoReplace(files.active, path.join(directory, names.archive));
  await verifyArchived(files, directory, intent);
  await lock.assertOwned();
  await writeCommitted(directory, intent, executionId);
  return true;
}

/** Read-only operator view of the current active pointer. Writes nothing. */
export async function inspectJdLogisticsZeroEffect(root: string) {
  try {
    const bytes = await readControlFile(pipelinePaths(root).active);
    if (!bytes) return { active: null, verdict: "not_closable" as const, reasons: ["no_active_pointer"] };
    const active = parseObject(bytes) as ZeroEffectActive;
    return { active, ...(await assessJdLogisticsZeroEffect(root, active)) };
  } catch (error) {
    const reason = reasonOf(error);
    if (reason === null) throw error;
    return { active: null, verdict: "not_closable" as const, reasons: [reason] };
  }
}
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const [command, root] = process.argv.slice(2);
  if (command !== "inspect" || !root || process.argv.length !== 4) { console.error("usage: jd-logistics-zero-effect-closure.ts inspect <absolute-root>"); process.exitCode = 2; }
  else inspectJdLogisticsZeroEffect(root).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error instanceof Error ? error.message : "JD_LOGISTICS_ZERO_EFFECT_INSPECT_FAILED"); process.exitCode = 1; });
}
