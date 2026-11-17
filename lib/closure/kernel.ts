import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { link, lstat, open, readFile, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";
import { promisify } from "node:util";

/**
 * Shared protocol pieces of the controlled-closure entries (JD logistics zero-effect closure,
 * direct master abandon, direct promotion admin). Judgement stays in each pipeline; this file
 * only holds the byte/identity/move/probe/confirmation primitives. It is reachable from the
 * helper bundle closure, so it must stay free of module-URL metadata and of heavy imports.
 */
const exec = promisify(execFile);

export type Refuse = (reason: string, message: string) => never;
export class ClosureRefusal extends Error {
  constructor(readonly reason: string, message?: string) { super(message ?? reason); }
}
export const refuseClosure: Refuse = (reason, message) => { throw new ClosureRefusal(reason, message); };

export const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Regular, single-link file; no ancestor may be a link. Returns null when absent. */
export async function readControlFile(file: string, limit: number, refuse: (reason: string) => never): Promise<Buffer | null> {
  const info = await lstat(file).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; });
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > limit) refuse("control_file_identity");
  const data = await readFile(file);
  if (data.length !== info.size) refuse("control_file_changed");
  return data;
}

export async function createOnly(file: string, data: string | Uint8Array) {
  const handle = await open(file, "wx");
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
}

/** Same absolute PowerShell path as lib/jackyun/json-file.ts: never resolved through PATH or the cwd. */
export const windowsPowerShellPath = () => path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
/** Moves without ever replacing an existing destination. */
export async function moveNoReplace(from: string, to: string) {
  if (process.platform === "win32") {
    // .NET File.Move refuses to replace an existing destination; fs.rename may replace it.
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    await exec(windowsPowerShellPath(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop';[System.IO.File]::Move(${quote(from)},${quote(to)})`],
      { timeout: 15000, windowsHide: true });
  } else { await link(from, to); await rm(from); }
}

export type HelperSlot = { storeKey?: string | null; workflow?: string };
/** Best-effort guard against a running helper slot: GET /health only (read-only). */
export async function probeHelperIdle(
  predicate: (slot: HelperSlot) => boolean,
  options: { fetcher?: typeof fetch; port?: number; refuse?: Refuse; verb?: string; activeMessage?: string } = {},
) {
  const { fetcher = fetch, port = 5791, verb = "处理" } = options;
  const refuse: Refuse = options.refuse ?? refuseClosure;
  let response: Response;
  try {
    response = await fetcher(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code ?? (error as NodeJS.ErrnoException).code;
    if (code === "ECONNREFUSED") return "helper_not_running" as const;
    refuse("helper_probe_failed", `无法确认 helper 是否空闲（${code ?? (error as Error).message}），拒绝${verb}`);
  }
  if (!response.ok) refuse("helper_probe_failed", `helper /health 返回 HTTP ${response.status}，拒绝${verb}`);
  const health = await response.json() as { storeExecutions?: HelperSlot[] };
  const executions = Array.isArray(health.storeExecutions) ? health.storeExecutions : null;
  if (!executions) refuse("helper_probe_failed", "helper /health 未返回 storeExecutions，无法确认空闲");
  if (executions.some(predicate)) refuse("helper_store_active", options.activeMessage ?? `helper 正在运行目标执行，拒绝${verb}`);
  return "helper_store_idle" as const;
}

/** The debug port must refuse connections: anything that connects (or times out) means a browser may still be open. */
export async function assertPortAbsent(port: number, host = "127.0.0.1") {
  await new Promise<void>((resolve, fail) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); fail(new ClosureRefusal("port_in_use", `端口 ${port} 仍可连接`)); });
    socket.once("timeout", () => { socket.destroy(); fail(new ClosureRefusal("port_state_unknown", `端口 ${port} 状态未知`)); });
    socket.once("error", (error: NodeJS.ErrnoException) => { socket.destroy(); if (error.code === "ECONNREFUSED") resolve(); else fail(error); });
  });
}

export function normalizeReason(reason: string | undefined, required: boolean, refuse: Refuse = refuseClosure) {
  const text = String(reason ?? "").replace(/\s+/g, " ").trim();
  if ((required || text) && (text.length < 4 || text.length > 300)) refuse("reason_length", "原因必须为 4 至 300 个字符");
  return text;
}

/** dry-run and confirm are mutually exclusive; confirm needs a 64-hex expect-sha256 (unless waived) and a 4-300 char reason. */
export function assertConfirmMode(input: {
  dryRun: boolean; confirmed: boolean; expectSha256?: string; reason?: string;
  requireExpect?: boolean; reasonRequiredInDryRun?: boolean; refuse?: Refuse;
}) {
  const refuse = input.refuse ?? refuseClosure;
  if (input.dryRun && input.confirmed) refuse("mode_conflict", "--dry-run 与 --confirm 不能同时使用");
  if (!input.dryRun && !input.confirmed) refuse("not_confirmed", "必须取得操作者明确确认（--confirm），或仅检查时使用 --dry-run");
  const reason = normalizeReason(input.reason, !input.dryRun || input.reasonRequiredInDryRun === true, refuse);
  const expect = String(input.expectSha256 ?? "");
  if (!input.dryRun && input.requireExpect !== false && !/^[a-f0-9]{64}$/.test(expect)) {
    refuse("expect_sha256_missing", "--confirm 必须提供 --expect-sha256（来自 --dry-run 输出的 64 位十六进制）");
  }
  return { mode: input.dryRun ? "dry-run" as const : "confirm" as const, reason, expectSha256: expect };
}
