import { spawn } from "node:child_process";
import path from "node:path";
import { readJsonFile } from "./json-file";
import { jackyunDpapiProgram } from "./dpapi-program";

export type JackyunLoginConfig = {
  version: 1;
  loginMode: "windows_dpapi_credentials";
  tenantId: string;
  profileDirectory: string;
  debuggingPort: number;
  initialWaitMs: number;
  afterSubmitWaitMs: number;
};
export type JackyunCredential = { username: string; password: string };
type CredentialLookup = { provider: boolean; file: boolean; directory: boolean; fileError?: number; directoryError?: number };
export type JackyunCredentialStatus = { ok: boolean; ready?: boolean; status: string; lookup?: CredentialLookup };

function credentialLookup(value: unknown): CredentialLookup | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (!["provider", "file", "directory"].every(key => typeof row[key] === "boolean")) return undefined;
  const result: CredentialLookup = { provider: row.provider as boolean, file: row.file as boolean, directory: row.directory as boolean };
  for (const key of ["fileError", "directoryError"] as const) {
    if (Number.isInteger(row[key]) && Number(row[key]) >= 0 && Number(row[key]) <= 65535) result[key] = Number(row[key]);
  }
  return result;
}

function lookupDescription(value: unknown) {
  const lookup = credentialLookup(value);
  if (!lookup) return "";
  const flags = ` / lookup=provider:${Number(lookup.provider)},file:${Number(lookup.file)},directory:${Number(lookup.directory)}`;
  return flags + (lookup.fileError !== undefined && lookup.directoryError !== undefined
    ? ` / win32=file:${lookup.fileError},directory:${lookup.directoryError}` : "");
}

export class JackyunCredentialProbeError extends Error {
  readonly diagnostic: string;
  constructor(diagnostic: string, message: string) {
    super(message);
    this.diagnostic = /^(?:initialize|binding(?:_input|_fields|_paths|_identity|_local_path|_vault_lookup)?|path_integrity|missing|setup_(?:acl|form|encrypt|verify)|read|transport|configuration|response_parse|response_shape|status=(?:ready|missing|stored|cancelled))(?: \/ lookup=provider:[01],file:[01],directory:[01](?: \/ win32=file:\d{1,5},directory:\d{1,5})?)?(?: \/ finish=(?:timeout|output_limit|spawn_error|stdin_error|close|cancelled),exit=(?:none|-?\d{1,10}),ms=\d{1,13},bytes=\d{1,9})?$/.test(diagnostic)
      ? diagnostic : "probe_error";
  }
}

export function credentialReadinessFailure(error: unknown) {
  const detail = error instanceof JackyunCredentialProbeError ? error.diagnostic : "probe_error";
  return new Error(`吉客云凭据仍未就绪（${detail}），需要人工处理；保留旧任务。`);
}

export async function requireJackyunCredentialReadiness(root: string) {
  let config: JackyunLoginConfig;
  try { config = await readJackyunLoginConfig(root); }
  catch { throw credentialReadinessFailure(new JackyunCredentialProbeError("configuration", "")); }
  let status: JackyunCredentialStatus;
  try { status = await manageJackyunCredential("status", config); }
  catch (error) { throw credentialReadinessFailure(error); }
  if (status.ok && status.ready && status.status === "ready") return true;
  throw credentialReadinessFailure(new JackyunCredentialProbeError(`status=${status.status}${lookupDescription(status.lookup)}`, ""));
}

export function windowsPowerShellEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === "psmodulepath") delete environment[key];
  }
  return environment;
}

export function assertJackyunLoginConfig(value: JackyunLoginConfig) {
  if (value?.version !== 1 || value.loginMode !== "windows_dpapi_credentials"
    || !/^\d{4,12}$/.test(value.tenantId) || !path.win32.isAbsolute(value.profileDirectory)
    || value.profileDirectory.startsWith("\\\\") || !Number.isInteger(value.debuggingPort)
    || value.debuggingPort < 1024 || value.debuggingPort > 65535
    || !Number.isInteger(value.initialWaitMs) || value.initialWaitMs < 1000 || value.initialWaitMs > 60000
    || !Number.isInteger(value.afterSubmitWaitMs) || value.afterSubmitWaitMs < 1000 || value.afterSubmitWaitMs > 60000) {
    throw new Error("吉客云 DPAPI 登录绑定配置无效。");
  }
  return value;
}

export async function readJackyunLoginConfig(root: string) {
  return assertJackyunLoginConfig(await readJsonFile<JackyunLoginConfig>(path.join(root, "config", "jackyun-login.json")));
}

/** A fixed encoded program; arguments, stdin metadata and diagnostics contain no credential. */
export async function invokeJackyunVault(
  action: "setup" | "status" | "read", config: JackyunLoginConfig, vaultRoot?: string,
  signal?: AbortSignal,
): Promise<string> {
  assertJackyunLoginConfig(config);
  if (process.platform !== "win32" || !["setup", "status", "read"].includes(action)
    || vaultRoot !== undefined && (!path.win32.isAbsolute(vaultRoot) || vaultRoot.startsWith("\\\\"))) {
    throw new Error("吉客云凭据库操作无效。");
  }
  const program = Buffer.from(jackyunDpapiProgram, "utf16le").toString("base64");
  if (program.length > 30000) throw new Error("DPAPI 固定程序超出 Windows 命令长度预算。");
  // Resolve the default inside the CurrentUser DPAPI process. Do not inherit
  // a credential location from a long-lived launcher's environment. Explicit
  // roots remain an internal fixture seam, never a CLI/HTTP/config override.
  const request = JSON.stringify({ action, tenantId: config.tenantId, profileDirectory: config.profileDirectory,
    ...(vaultRoot === undefined ? { currentUserVault: true } : { vaultRoot }) });
  // A pwsh parent can pass its Core-only module search path to Windows
  // PowerShell, breaking Get-Acl/Set-Acl autoload. Let the child use its defaults.
  const environment = windowsPowerShellEnvironment();
  if (signal?.aborted) throw new JackyunCredentialProbeError("transport", "吉客云凭据检查已取消。");
  return new Promise<string>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", program], {
      windowsHide: action !== "setup", env: environment, stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let settled = false;
    let stopping: "timeout" | "output_limit" | "stdin_error" | "cancelled" | undefined;
    const startedAt = Date.now();
    // kill() is only a request. Keep ownership until close confirms that this
    // exact child and its pipes have exited, including cancellation by a probe.
    const stop = (reason: NonNullable<typeof stopping>) => {
      if (settled || stopping) return;
      stopping = reason;
      clearTimeout(timeout);
      child.kill();
    };
    const timeout = setTimeout(() => stop("timeout"), action === "setup" ? 15 * 60_000 : 15000);
    const cancel = () => stop("cancelled");
    const finish = (ok: boolean, reason: "timeout" | "output_limit" | "spawn_error" | "stdin_error" | "close" | "cancelled", exitCode: number | null = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      const result = stdout.trim();
      stdout = "";
      if (ok) resolve(result);
      else {
        let stage = "transport";
        let errorId = "";
        let lookup = "";
        try {
          const diagnostic = JSON.parse(result) as { stage?: string; errorId?: string; lookup?: Record<string, unknown> };
          if (["initialize", "binding", "binding_input", "binding_fields", "binding_paths", "binding_identity", "binding_local_path", "binding_vault_lookup", "path_integrity", "missing", "setup_acl", "setup_form", "setup_encrypt", "setup_verify", "read"].includes(diagnostic.stage ?? "")) stage = diagnostic.stage!;
          if (/^[A-Za-z][A-Za-z0-9.,_-]{0,159}$/.test(diagnostic.errorId ?? "")) errorId = diagnostic.errorId!;
          if (stage === "missing") lookup = lookupDescription(diagnostic.lookup);
        } catch { /* secret-bearing output and raw errors are never propagated */ }
        const message = `waiting_login：吉客云 DPAPI 凭据配置或解密未完成（${stage}${errorId ? ` / ${errorId}` : ""}${lookup}）。`;
        reject(new JackyunCredentialProbeError(`${stage}${lookup} / finish=${reason},exit=${exitCode ?? "none"},ms=${Date.now() - startedAt},bytes=${Buffer.byteLength(result)}`, message));
      }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => { if (!stopping) stdout += chunk; if (stdout.length > 32768) stop("output_limit"); });
    // Never propagate PowerShell diagnostics or child output in an error object.
    child.stderr.resume();
    child.once("error", () => {
      if (!child.pid) finish(false, "spawn_error");
      // A kill error on an existing process is not evidence of its exit.
      else { stopping ??= "stdin_error"; clearTimeout(timeout); }
    });
    child.stdin.on("error", () => stop("stdin_error"));
    child.once("close", code => finish(!stopping && code === 0, stopping ?? "close", code));
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    child.stdin.end(request);
  });
}

class VerifiedCredentialLookupFailure extends Error {}

export function isRetryableJackyunCredentialPreparationFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error instanceof VerifiedCredentialLookupFailure) return true;
  return /^waiting_login：吉客云 DPAPI 凭据配置或解密未完成（(?:binding(?:[ /）]|_(?:input|identity|local_path|vault_lookup)[ /）]))/.test(error.message);
}

export async function readJackyunRuntimeCredential(config: JackyunLoginConfig, deps: {
  invoke?: typeof invokeJackyunVault;
  sleep?: (ms: number) => Promise<void>;
} = {}): Promise<JackyunCredential> {
  const invoke = deps.invoke ?? invokeJackyunVault;
  const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  // This stage only reads the local credential; no browser field, login
  // submission, or export request has happened. Bound retries are safe here.
  let stdout = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try { stdout = await invoke("read", config); break; }
    catch (error) {
      // A missing-file report alone is terminal. Only a fresh successful status
      // probe for the same binding can prove a transient lookup inconsistency.
      if (error instanceof Error && /^waiting_login：吉客云 DPAPI 凭据配置或解密未完成（missing(?:[ /）])/.test(error.message)) {
        let ready = false;
        try {
          const status = JSON.parse(await invoke("status", config)) as JackyunCredentialStatus;
          ready = status.ok === true && status.ready === true && status.status === "ready";
        } catch { /* Keep the original redacted failure; never expose probe output. */ }
        if (!ready) throw error;
        if (attempt === 2) throw new VerifiedCredentialLookupFailure(error.message);
        await sleep(500 * (attempt + 1));
        continue;
      }
      if (attempt === 2 || !isRetryableJackyunCredentialPreparationFailure(error)) throw error;
      await sleep(500 * (attempt + 1));
    }
  }
  try {
    const value = JSON.parse(stdout) as JackyunCredential;
    if (typeof value.username !== "string" || !value.username.trim() || value.username.length > 256
      || typeof value.password !== "string" || !value.password || value.password.length > 1024) throw new Error("invalid");
    return value;
  } catch {
    throw new Error("waiting_login：吉客云 DPAPI 凭据响应无效。");
  } finally { stdout = ""; }
}

export async function manageJackyunCredential(action: "setup" | "status", config: JackyunLoginConfig, signal?: AbortSignal) {
  const raw = await invokeJackyunVault(action, config, undefined, signal);
  let status: JackyunCredentialStatus;
  try { status = JSON.parse(raw) as JackyunCredentialStatus; }
  catch { throw new JackyunCredentialProbeError("response_parse", "吉客云凭据状态响应无效。"); }
  if (!status || !["ready", "missing", "stored", "cancelled"].includes(status.status)) {
    throw new JackyunCredentialProbeError("response_shape", "吉客云凭据状态响应无效。");
  }
  const lookup = status.status === "missing" ? credentialLookup(status.lookup) : undefined;
  return { ok: status.ok === true, ready: status.ready === true, status: status.status, ...(lookup ? { lookup } : {}) };
}
