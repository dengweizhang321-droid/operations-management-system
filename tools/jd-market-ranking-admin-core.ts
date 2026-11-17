import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { link, lstat, mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";
import { promisify } from "node:util";

import { withJdChromiumRunLock } from "../lib/jd/chromium-run-lock";
import type { JdMarketRecoveryPlanShape } from "../lib/jd/market-ranking-import-contract";

/**
 * Operator-only controlled entry for a crashed JD market ranking plan left in stage "running".
 * claimRecoverableJdMarketPlan refuses a same-identity running plan forever; this moves exactly that
 * plan file (never edits it) into an evidence directory after proving the original run is gone.
 * Not imported by the runner or the helper bundle; the runner behaviour is unchanged.
 */
export const JD_MARKET_RANKING_ADMIN_ACTIONS = ["inspect", "abandon-running"] as const;
export type JdMarketRankingAdminAction = typeof JD_MARKET_RANKING_ADMIN_ACTIONS[number];

const execFileAsync = promisify(execFile);
const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const planNamePattern = /^plan-([A-Za-z0-9._-]+)\.json$/;
const runIdPattern = /^[A-Za-z0-9._-]{1,96}$/;
type Json = Record<string, unknown>;

export class JdMarketAdminRefusal extends Error {
  constructor(readonly reason: string, message: string) { super(message); }
}
function refuse(reason: string, message: string): never { throw new JdMarketAdminRefusal(reason, message); }

const windowsPowerShell = () => path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
/** Moves without ever replacing an existing destination. */
export async function moveNoReplace(from: string, to: string) {
  if (process.platform === "win32") {
    // .NET File.Move refuses to replace an existing destination; fs.rename may replace it.
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    await execFileAsync(windowsPowerShell(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      `$ErrorActionPreference='Stop';[System.IO.File]::Move(${quote(from)},${quote(to)})`], { timeout: 15000, windowsHide: true });
  } else { await link(from, to); await rm(from); }
}

/** GET /health only (read-only). Refuses on anything but a clear "no jd-market execution" answer. */
export async function probeHelperNoMarketExecution(fetcher: typeof fetch = fetch, port = 5791) {
  let response: Response;
  try {
    response = await fetcher(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code ?? (error as NodeJS.ErrnoException).code;
    if (code === "ECONNREFUSED") return "helper_not_running" as const;
    refuse("helper_probe_failed", `无法确认 helper 是否空闲（${code ?? (error as Error).message}），拒绝处理`);
  }
  if (!response.ok) refuse("helper_probe_failed", `helper /health 返回 HTTP ${response.status}，拒绝处理`);
  let health: { storeExecutions?: Array<{ workflow?: string }> };
  try { health = await response.json() as typeof health; } catch { refuse("helper_probe_failed", "helper /health 响应不是有效 JSON，拒绝处理"); }
  const executions = Array.isArray(health.storeExecutions) ? health.storeExecutions : null;
  if (!executions) refuse("helper_probe_failed", "helper /health 未返回 storeExecutions，无法确认空闲");
  if (executions.some((slot) => slot?.workflow === "jd-market")) refuse("helper_market_active", "helper 正在运行京东市场榜单执行，拒绝处理");
  return "helper_no_market_execution" as const;
}

/** Resolves when nothing listens on the port; refuses when it is listening or the state is unknown. */
export async function probeDebugPortClosed(port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) refuse("browser_port_invalid", "计划中的 Profile 调试端口无效，拒绝处理");
  await new Promise<void>((resolve, fail) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); fail(new JdMarketAdminRefusal("browser_port_listening", `榜单 Profile 调试端口 ${port} 仍在监听，原浏览器可能仍在运行，拒绝处理`)); });
    socket.once("timeout", () => { socket.destroy(); fail(new JdMarketAdminRefusal("browser_port_unknown", `无法确认调试端口 ${port} 已关闭（超时），拒绝处理`)); });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve();
      else fail(new JdMarketAdminRefusal("browser_port_unknown", `无法确认调试端口 ${port} 已关闭（${error.code ?? error.message}），拒绝处理`));
    });
  });
  return "port_closed" as const;
}

export type JdMarketAdminOptions = {
  planDirectory: string;
  runId?: string;
  reason?: string;
  expectSha256?: string;
  operatorConfirmed?: boolean;
  dryRun?: boolean;
  now?: Date;
  /** Test seams. Not exposed by the CLI. */
  helperProbe?: () => Promise<unknown>;
  portProbe?: (port: number) => Promise<unknown>;
  withLock?: <T>(purpose: string, operation: () => Promise<T>) => Promise<T>;
  move?: (from: string, to: string) => Promise<void>;
  hooks?: { afterEvidence?: () => Promise<void> };
};

async function lstatOrNull(target: string) {
  try { return await lstat(target); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function readRegular(file: string): Promise<Buffer | null> {
  const stat = await lstatOrNull(file);
  if (!stat) return null;
  if (!stat.isFile()) refuse("not_regular_file", `${file} 不是普通文件，拒绝处理`);
  return readFile(file);
}
async function assertPlainDirectoryIfPresent(directory: string) {
  const stat = await lstatOrNull(directory);
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) refuse("evidence_directory_linked", `${directory} 不是普通目录，拒绝处理`);
}

type PlanRecord = JdMarketRecoveryPlanShape & { updatedAt?: string };
type LoadedPlan = { file: string; sha256: string; bytes: Buffer; plan: PlanRecord };
type ProbeReport = { ok: boolean; result?: unknown; reason?: string; message?: string };

function parsePlan(bytes: Buffer): PlanRecord | null {
  try {
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray((value as { targets?: unknown }).targets)) return null;
    return value as PlanRecord;
  } catch { return null; }
}

async function loadPlan(planDirectory: string, runId: string): Promise<LoadedPlan | null> {
  const file = path.join(planDirectory, `plan-${runId}.json`);
  const bytes = await readRegular(file);
  if (!bytes) return null;
  const plan = parsePlan(bytes);
  if (!plan) refuse("plan_unreadable", "计划文件无法解析，拒绝处理");
  if (plan.runId !== runId) refuse("plan_identity", "计划文件内的 runId 与文件名不一致，拒绝处理");
  return { file, sha256: sha256(bytes), bytes, plan };
}

function identityKey(plan: PlanRecord) {
  return sha256(JSON.stringify([plan.version, plan.baseUrl, plan.silentNoWindow, plan.storeKey, plan.shopId, plan.shopName,
    plan.browserProfileName, plan.browserDebugPort, plan.startDate,
    plan.targets.map((target) => [target.key, target.categoryPath, target.identity])])).slice(0, 16);
}

// ---------------------------------------------------------------------------------------------------------
// inspect
// ---------------------------------------------------------------------------------------------------------
export async function inspectJdMarketPlans(options: Pick<JdMarketAdminOptions, "planDirectory">) {
  const planDirectory = path.resolve(options.planDirectory);
  const entries = await readdir(planDirectory, { withFileTypes: true }).catch(() => []);
  const rows: Array<{ plan: PlanRecord; sha256: string; file: string }> = [];
  const unreadable: Array<{ file: string; reason: string }> = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    // Same top-level-only rule as loadPersistedJdMarketPlans: subdirectories (operator-abandons) are never scanned.
    if (!entry.isFile() || !planNamePattern.test(entry.name)) continue;
    const bytes = await readFile(path.join(planDirectory, entry.name));
    const plan = parsePlan(bytes);
    if (!plan) { unreadable.push({ file: entry.name, reason: "plan_unreadable_or_no_targets" }); continue; }
    if (plan.stage === "completed") continue;
    rows.push({ plan, sha256: sha256(bytes), file: entry.name });
  }
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = identityKey(row.plan);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const plans = rows.map((row) => {
    const plan = row.plan;
    const siblings = groups.get(identityKey(plan))!;
    const blocking: string[] = [];
    if (plan.stage === "running") blocking.push("running_blocks_same_identity");
    else if (siblings.filter((item) => item.plan.stage !== "running").length > 1) blocking.push("multiple_unfinished_same_identity");
    if (plan.stage !== "running" && siblings.some((item) => item.plan.stage === "running")) blocking.push("blocked_by_running_sibling");
    return {
      runId: plan.runId, stage: plan.stage, storeKey: plan.storeKey, shopId: plan.shopId, startDate: plan.startDate, endDate: plan.endDate,
      identity: identityKey(plan), ownerExecutionId: plan.ownerExecutionId ?? null, browserDebugPort: plan.browserDebugPort ?? null,
      updatedAt: plan.updatedAt ?? null, sha256: row.sha256, file: row.file,
      blocksSameIdentity: blocking.length > 0, blocking,
      abandonable: plan.stage === "running",
    };
  });
  return { ok: true as const, action: "inspect" as const, planDirectory, plans, unreadable };
}

// ---------------------------------------------------------------------------------------------------------
// abandon-running
// ---------------------------------------------------------------------------------------------------------
const serialize = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

async function createOnly(target: string, content: Uint8Array | string): Promise<"created" | "existing"> {
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temp, "wx");
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  try { await link(temp, target); return "created"; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return "existing"; throw error; }
  finally { await rm(temp, { force: true }); }
}

export async function abandonRunningJdMarketPlan(options: JdMarketAdminOptions) {
  const dryRun = options.dryRun === true;
  if (dryRun && options.operatorConfirmed) refuse("mode_conflict", "--dry-run 与 --confirm 不能同时使用");
  if (!dryRun && options.operatorConfirmed !== true) refuse("not_confirmed", "必须取得操作者明确确认（--confirm），或仅检查时使用 --dry-run");
  const runId = String(options.runId ?? "");
  if (!runIdPattern.test(runId)) refuse("run_id_invalid", "--run-id 无效");
  const reason = String(options.reason ?? "").replace(/\s+/g, " ").trim();
  if (!dryRun && (reason.length < 4 || reason.length > 300)) refuse("reason_length", "原因必须为 4 至 300 个字符");
  const expect = String(options.expectSha256 ?? "");
  if (!dryRun && !/^[a-f0-9]{64}$/.test(expect)) refuse("expect_sha256_missing", "--confirm 必须提供 --expect-sha256（来自 --dry-run 或 inspect 输出的 64 位十六进制）");

  const planDirectory = path.resolve(options.planDirectory);
  const helperProbe = options.helperProbe ?? (() => probeHelperNoMarketExecution());
  const portProbe = options.portProbe ?? probeDebugPortClosed;
  const withLock = options.withLock ?? (<T>(purpose: string, operation: () => Promise<T>) => withJdChromiumRunLock(purpose, operation));
  const move = options.move ?? moveNoReplace;

  const first = await loadPlan(planDirectory, runId);
  if (!first) {
    // Resume: a previous confirm may have moved the file already.
    if (!dryRun) {
      const moved = path.join(planDirectory, "operator-abandons", `${runId}-${expect.slice(0, 16)}`, `plan-${runId}.json`);
      const bytes = await readRegular(moved);
      if (bytes && sha256(bytes) === expect) {
        return { ok: true as const, action: "abandon-running" as const, stage: "already_abandoned" as const, runId, originalSha256: expect, archivedFile: moved };
      }
    }
    refuse("plan_not_found", "计划文件不存在");
  }
  if (first.plan.stage !== "running") {
    refuse("stage_not_running", `计划阶段为 ${String(first.plan.stage)}，只接受 running；其他阶段会被执行器自动接管，无需作废`);
  }
  if (!dryRun && first.sha256 !== expect) refuse("sha256_mismatch", "计划文件字节与 --expect-sha256 不一致（已变化），拒绝处理，请重新 inspect/--dry-run");

  const port = first.plan.browserDebugPort;
  const evidenceDir = path.join(planDirectory, "operator-abandons", `${runId}-${first.sha256.slice(0, 16)}`);
  const archivedFile = path.join(evidenceDir, `plan-${runId}.json`);

  if (dryRun) {
    const probes: Record<string, ProbeReport> = {};
    for (const [name, probe] of [["helper", () => helperProbe()], ["port", () => portProbe(port)]] as const) {
      try { probes[name] = { ok: true, result: await probe() }; }
      catch (error) { probes[name] = { ok: false, reason: (error as { reason?: string }).reason ?? "probe_failed", message: (error as Error).message.slice(0, 300) }; }
    }
    return {
      ok: true as const, action: "abandon-running" as const, stage: "dry_run" as const, runId, sha256: first.sha256,
      ownerExecutionId: first.plan.ownerExecutionId ?? null, updatedAt: first.plan.updatedAt ?? null, browserDebugPort: port, probes,
      wouldAbandon: Object.values(probes).every((probe) => probe.ok),
      wouldWrite: [evidenceDir, path.join(evidenceDir, "original.json"), path.join(evidenceDir, "record.json"), archivedFile], wouldRemove: [first.file],
    };
  }

  let lockOutcome: Awaited<ReturnType<typeof mutate>>;
  try {
    lockOutcome = await withLock("jd-market-ranking-abandon-running", () => mutate());
  } catch (error) {
    if (error instanceof JdMarketAdminRefusal) throw error;
    refuse("chromium_lock_unavailable", `无法取得京东 Chromium 全局锁（${(error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 200)}），拒绝处理`);
  }
  return lockOutcome;

  async function mutate() {
    // Re-read under the lock: the plan must be unchanged and still running.
    const locked = await loadPlan(planDirectory, runId);
    if (!locked || locked.sha256 !== first!.sha256) refuse("active_changed", "取得锁后计划文件已变化或消失，失败关闭");
    const helper = await helperProbe();
    const portResult = await portProbe(port);

    await mkdir(path.join(planDirectory, "operator-abandons"), { recursive: true });
    await assertPlainDirectoryIfPresent(path.join(planDirectory, "operator-abandons"));
    await mkdir(evidenceDir, { recursive: true });
    await assertPlainDirectoryIfPresent(evidenceDir);
    const originalPath = path.join(evidenceDir, "original.json");
    const recordPath = path.join(evidenceDir, "record.json");
    if (await createOnly(originalPath, first!.bytes) === "existing") {
      const prior = await readRegular(originalPath);
      if (!prior || sha256(prior) !== first!.sha256) refuse("evidence_conflict", "证据目录已存在 original.json 且与当前计划不同，拒绝覆盖");
    }
    const record = {
      version: 1, action: "abandon-running", runId, reason, originalSha256: first!.sha256, planFile: path.basename(first!.file),
      ownerExecutionId: first!.plan.ownerExecutionId ?? null, planUpdatedAt: first!.plan.updatedAt ?? null, browserDebugPort: port,
      probes: { helper, port: portResult }, operatorConfirmedAt: (options.now ?? new Date()).toISOString(),
    };
    let resumed = false;
    if (await createOnly(recordPath, serialize(record)) === "existing") {
      const priorBytes = await readRegular(recordPath);
      let prior: Json;
      try { prior = JSON.parse(priorBytes!.toString("utf8")); } catch { refuse("evidence_conflict", "已存在的 record.json 无法解析，失败关闭"); }
      const stable = (value: Json) => JSON.stringify([value.version, value.action, value.runId, value.reason, value.originalSha256, value.planFile]);
      if (stable(prior) !== stable(record)) refuse("evidence_conflict", "证据目录已存在 record.json 且内容与本次不同，拒绝覆盖");
      resumed = true;
    }
    await options.hooks?.afterEvidence?.();

    // CAS right before the move.
    const again = await readRegular(first!.file);
    if (!again || sha256(again) !== first!.sha256) refuse("active_changed", "移动前计划文件字节已变化，失败关闭");
    if (await lstatOrNull(archivedFile)) refuse("archive_target_exists", "归档目标已存在，拒绝覆盖");
    await move(first!.file, archivedFile);
    const archived = await readRegular(archivedFile);
    if (!archived || sha256(archived) !== first!.sha256) refuse("archive_verify_failed", "移动后字节与原计划不一致");
    if (await lstatOrNull(first!.file)) refuse("plan_reappeared", "移动后顶层计划文件被重新写出，请核对是否仍有执行在写入");
    return {
      ok: true as const, action: "abandon-running" as const, stage: "abandoned" as const, resumed, runId,
      originalSha256: first!.sha256, evidenceDir, archivedFile,
    };
  }
}
