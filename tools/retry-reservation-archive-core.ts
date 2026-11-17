import { execFile } from "node:child_process";
import { link, lstat, mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

/**
 * Operator-only monthly archive of retry dispatch reservations (outputs/n8n-retry-dispatch).
 * Not imported by the helper bundle. lib/jackyun/retry-dispatch-reservation.ts treats
 * archive/<YYYY-MM>/<same name> as "already reserved", so archiving never permits a second POST.
 */
export const RETRY_RESERVATION_ARCHIVE_ACTIONS = ["inspect", "archive"] as const;
export type RetryReservationArchiveAction = typeof RETRY_RESERVATION_ARCHIVE_ACTIONS[number];
export const RETRY_RESERVATION_MIN_OLDER_THAN_DAYS = 14;
export const RETRY_RESERVATION_DEFAULT_OLDER_THAN_DAYS = 30;

const execFileAsync = promisify(execFile);
const monthPattern = /^\d{4}-\d{2}$/;
const namePattern = /^([A-Za-z0-9]+)-([1-9]\d{0,19})\.json$/;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export class RetryReservationArchiveRefusal extends Error {
  constructor(readonly reason: string, message: string) { super(message); }
}
function refuse(reason: string, message: string): never { throw new RetryReservationArchiveRefusal(reason, message); }

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

async function lstatOrNull(target: string) {
  try { return await lstat(target); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

async function assertPlainDirectory(directory: string, reason: string) {
  const stat = await lstatOrNull(directory);
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isDirectory()) refuse(reason, `${directory} 不是普通目录（符号链接或文件），拒绝处理`);
  return true;
}

type ReservationRow = { name: string; createdAt: string | null; month: string | null; skip: string | null };

async function readTopLevel(directory: string): Promise<ReservationRow[]> {
  if (!await assertPlainDirectory(directory, "reservation_directory_linked")) refuse("reservation_directory_missing", "预留目录不存在");
  const rows: ReservationRow[] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.name.endsWith(".json")) continue;
    if (!entry.isFile()) { rows.push({ name: entry.name, createdAt: null, month: null, skip: "not_regular_file" }); continue; }
    rows.push(await classify(directory, entry.name));
  }
  return rows;
}

async function classify(directory: string, name: string): Promise<ReservationRow> {
  const bad = (skip: string): ReservationRow => ({ name, createdAt: null, month: null, skip });
  const match = namePattern.exec(name);
  if (!match) return bad("name_invalid");
  let value: unknown;
  try { value = JSON.parse((await readFile(path.join(directory, name))).toString("utf8")); } catch { return bad("json_invalid"); }
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!record) return bad("json_invalid");
  if (record.workflowId !== match[1] || record.failedExecutionId !== match[2]) return bad("name_content_mismatch");
  const createdAt = record.createdAt;
  if (typeof createdAt !== "string" || !isoPattern.test(createdAt) || Number.isNaN(Date.parse(createdAt))) return bad("createdAt_missing_or_invalid");
  return { name, createdAt, month: new Date(createdAt).toISOString().slice(0, 7), skip: null };
}

async function archivedMonths(directory: string) {
  const archive = path.join(directory, "archive");
  const months = new Map<string, string[]>();
  if (!await assertPlainDirectory(archive, "archive_directory_linked")) return months;
  for (const month of (await readdir(archive)).sort()) {
    if (!monthPattern.test(month)) continue;
    const monthDirectory = path.join(archive, month);
    if (!await assertPlainDirectory(monthDirectory, "archive_month_linked")) continue;
    months.set(month, (await readdir(monthDirectory)).filter((name) => name.endsWith(".json")));
  }
  return months;
}

export type RetryReservationArchiveOptions = {
  directory: string;
  olderThanDays?: number;
  dryRun?: boolean;
  operatorConfirmed?: boolean;
  reason?: string;
  now?: Date;
  /** Test seam. */
  move?: (from: string, to: string) => Promise<void>;
};

export async function inspectRetryReservations(options: Pick<RetryReservationArchiveOptions, "directory">) {
  const directory = path.resolve(options.directory);
  const rows = await readTopLevel(directory);
  const archived = await archivedMonths(directory);
  const byMonth = new Map<string, { topLevel: number; archived: number; oldestCreatedAt: string | null; newestCreatedAt: string | null }>();
  const bucket = (month: string) => {
    let value = byMonth.get(month);
    if (!value) byMonth.set(month, value = { topLevel: 0, archived: 0, oldestCreatedAt: null, newestCreatedAt: null });
    return value;
  };
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const row of rows) {
    if (row.skip || !row.createdAt || !row.month) { skipped.push({ name: row.name, reason: row.skip ?? "unknown" }); bucket("unknown").topLevel += 1; continue; }
    const value = bucket(row.month);
    value.topLevel += 1;
    if (!value.oldestCreatedAt || row.createdAt < value.oldestCreatedAt) value.oldestCreatedAt = row.createdAt;
    if (!value.newestCreatedAt || row.createdAt > value.newestCreatedAt) value.newestCreatedAt = row.createdAt;
  }
  for (const [month, names] of archived) bucket(month).archived = names.length;
  const dated = rows.filter((row) => row.createdAt).map((row) => row.createdAt!).sort();
  return {
    ok: true as const, action: "inspect" as const, directory,
    topLevelCount: rows.length, archivedCount: [...archived.values()].reduce((sum, names) => sum + names.length, 0),
    oldestCreatedAt: dated[0] ?? null, newestCreatedAt: dated.at(-1) ?? null,
    months: Object.fromEntries([...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))),
    skipped,
  };
}

export async function archiveRetryReservations(options: RetryReservationArchiveOptions) {
  const dryRun = options.dryRun === true;
  if (dryRun && options.operatorConfirmed) refuse("mode_conflict", "--dry-run 与 --confirm 不能同时使用");
  if (!dryRun && options.operatorConfirmed !== true) refuse("not_confirmed", "必须取得操作者明确确认（--confirm），或仅检查时使用 --dry-run");
  const days = options.olderThanDays ?? RETRY_RESERVATION_DEFAULT_OLDER_THAN_DAYS;
  if (!Number.isInteger(days) || days < RETRY_RESERVATION_MIN_OLDER_THAN_DAYS) {
    refuse("older_than_days_invalid", `--older-than-days 必须是不小于 ${RETRY_RESERVATION_MIN_OLDER_THAN_DAYS} 的整数`);
  }
  const reason = String(options.reason ?? "").replace(/\s+/g, " ").trim();
  if (!dryRun && (reason.length < 4 || reason.length > 300)) refuse("reason_length", "原因必须为 4 至 300 个字符");

  const directory = path.resolve(options.directory);
  const now = options.now ?? new Date();
  const threshold = new Date(now.getTime() - days * 86_400_000).toISOString();
  const rows = await readTopLevel(directory);
  const skipped = rows.filter((row) => row.skip).map((row) => ({ name: row.name, reason: row.skip! }));
  const eligible = rows.filter((row) => !row.skip && row.createdAt! < threshold);
  const archiveRoot = path.join(directory, "archive");
  // Validate the existing archive layout before any write, in dry-run as well.
  await archivedMonths(directory);
  const plan = eligible.map((row) => ({ name: row.name, createdAt: row.createdAt!, month: row.month!, target: path.join(archiveRoot, row.month!, row.name) }));
  if (dryRun) {
    return { ok: true as const, action: "archive" as const, stage: "dry_run" as const, directory, threshold, olderThanDays: days,
      wouldMove: plan.map(({ name, createdAt, month }) => ({ name, createdAt, month })), skipped };
  }

  const move = options.move ?? moveNoReplace;
  const moved: string[] = [];
  const alreadyArchived: string[] = [];
  let conflict: { name: string; reason: string } | null = null;
  for (const item of plan) {
    const source = path.join(directory, item.name);
    const monthDirectory = path.dirname(item.target);
    await mkdir(archiveRoot, { recursive: true });
    if (!await assertPlainDirectory(archiveRoot, "archive_directory_linked")) refuse("archive_directory_linked", "归档目录创建失败");
    await mkdir(monthDirectory, { recursive: true });
    await assertPlainDirectory(monthDirectory, "archive_month_linked");
    const sourceBytes = await readFile(source);
    if (await lstatOrNull(item.target)) {
      const targetStat = await lstat(item.target);
      if (targetStat.isFile() && Buffer.compare(await readFile(item.target), sourceBytes) === 0) {
        // Already archived (e.g. a previous run stopped between link and remove): the archived copy keeps blocking a second POST.
        await rm(source);
        alreadyArchived.push(item.name);
        continue;
      }
      conflict = { name: item.name, reason: "archive_target_exists_different" };
      break;
    }
    await move(source, item.target);
    if (Buffer.compare(await readFile(item.target), sourceBytes) !== 0) refuse("archive_verify_failed", `${item.name} 归档后字节与原预留不一致`);
    if (await lstatOrNull(source)) refuse("source_reappeared", `${item.name} 归档后顶层文件仍存在，请核对`);
    moved.push(item.name);
  }

  if (moved.length || alreadyArchived.length) {
    await mkdir(archiveRoot, { recursive: true });
    const handle = await open(path.join(archiveRoot, "archive-log.jsonl"), "a");
    try {
      await handle.writeFile(`${JSON.stringify({ at: now.toISOString(), reason, olderThanDays: days, threshold, moved: moved.length, alreadyArchived: alreadyArchived.length, stopped: conflict })}\n`);
      await handle.sync();
    } finally { await handle.close(); }
  }
  return {
    ok: conflict === null, action: "archive" as const, stage: conflict ? "stopped" as const : "archived" as const, directory, threshold, olderThanDays: days,
    moved: moved.length, alreadyArchived: alreadyArchived.length, conflict, skipped,
  };
}
