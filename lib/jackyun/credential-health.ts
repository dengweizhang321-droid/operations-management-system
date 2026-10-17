import { Worker, parentPort, workerData } from "node:worker_threads";
import { JackyunCredentialProbeError, manageJackyunCredential, readJackyunLoginConfig } from "./windows-dpapi";

export const jackyunCredentialProbeProtocol = "jackyun-credential-probe-v1";
const reasons = ["ready", "missing", "configuration", "binding", "read", "transport", "unavailable"] as const;
type Reason = typeof reasons[number];
export type CredentialHealth = { state: "checking" | "ready" | "blocked"; reason: Reason;
  checkedAt: string | null; context: "isolated_worker" };
const blocked = (reason: Reason): CredentialHealth => ({ state: "blocked", reason,
  checkedAt: new Date().toISOString(), context: "isolated_worker" });

// This worker only verifies the local vault. It never opens a browser, allocates
// a workflow slot, changes recovery records, or returns a decrypted credential.
export async function probeJackyunCredential(root: string, signal?: AbortSignal): Promise<CredentialHealth> {
  let config;
  try { config = await readJackyunLoginConfig(root); } catch { return blocked("configuration"); }
  try {
    const status = await manageJackyunCredential("status", config, signal);
    return status.ok && status.ready && status.status === "ready"
      ? { state: "ready", reason: "ready", checkedAt: new Date().toISOString(), context: "isolated_worker" }
      : blocked(status.status === "missing" ? "missing" : "unavailable");
  } catch (error) {
    const stage = error instanceof JackyunCredentialProbeError ? error.diagnostic.split(" / ")[0] : "";
    return blocked(stage.startsWith("binding") ? "binding" : stage === "read" ? "read"
      : stage === "missing" ? "missing" : stage === "transport" ? "transport" : "unavailable");
  }
}

export async function runJackyunCredentialProbeWorker(root: string) {
  if (!parentPort || workerData?.protocol !== jackyunCredentialProbeProtocol
    || !Number.isSafeInteger(workerData.deadline)) throw new Error("invalid_credential_probe");
  const port = parentPort;
  const controller = new AbortController();
  let begin!: (allowed: boolean) => void;
  const authorized = new Promise<boolean>(resolve => { begin = resolve; });
  const receive = (message: unknown) => {
    const type = (message as { type?: string })?.type;
    if (type === "credential_probe_cancel") { controller.abort(); begin(false); }
    if (type === "credential_probe_start") begin(!controller.signal.aborted && Date.now() < workerData.deadline);
  };
  port.on("message", receive);
  port.postMessage({ type: "credential_probe_bootstrap_ready" });
  try {
    const result = await authorized && Date.now() < workerData.deadline
      ? await probeJackyunCredential(root, controller.signal) : blocked("unavailable");
    port.postMessage({ type: jackyunCredentialProbeProtocol, result });
  } finally { port.off("message", receive); }
}

function validHealth(value: unknown): value is CredentialHealth {
  if (!value || typeof value !== "object") return false;
  const row = value as CredentialHealth;
  return Object.keys(row).sort().join(",") === "checkedAt,context,reason,state"
    && row.context === "isolated_worker" && reasons.includes(row.reason)
    && (row.state === "ready" && row.reason === "ready" || row.state === "blocked" && row.reason !== "ready")
    && typeof row.checkedAt === "string" && Number.isFinite(Date.parse(row.checkedAt))
    && new Date(row.checkedAt).toISOString() === row.checkedAt;
}

export function createJackyunCredentialMonitor(entryFile: string, timeoutMs = 20_000) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000) throw new Error("invalid_probe_timeout");
  let snapshot: CredentialHealth = { state: "checking", reason: "unavailable", checkedAt: null, context: "isolated_worker" };
  let pending: Promise<void> | null = null;
  let lastAttempt = 0;
  const refresh = () => {
    if (pending) return pending;
    lastAttempt = Date.now();
    pending = new Promise<void>(resolve => {
      let result: CredentialHealth | undefined;
      let authorized = false;
      let timedOut = false;
      const deadline = Date.now() + timeoutMs;
      let worker: Worker;
      try { worker = new Worker(entryFile, { workerData: { protocol: jackyunCredentialProbeProtocol, deadline }, stdout: true, stderr: true }); }
      catch { snapshot = blocked("unavailable"); resolve(); return; }
      worker.stdout?.resume(); worker.stderr?.resume();
      const timer = setTimeout(() => {
        timedOut = true; result = undefined; snapshot = blocked("unavailable");
        // Before start authorization no subprocess can exist. Once authorized,
        // cancellation waits for the owned PowerShell close and worker exit.
        // Unknown cleanup keeps pending occupied and prevents another probe.
        if (authorized) worker.postMessage({ type: "credential_probe_cancel" });
        else void worker.terminate();
      }, timeoutMs);
      worker.on("message", message => {
        if (timedOut || Date.now() >= deadline) return;
        if (message?.type === "credential_probe_bootstrap_ready" && !authorized) {
          authorized = true; worker.postMessage({ type: "credential_probe_start" });
        }
        if (authorized && message?.type === jackyunCredentialProbeProtocol && validHealth(message.result)) result = message.result;
      });
      worker.once("error", () => { result = undefined; });
      worker.once("exit", code => {
        clearTimeout(timer);
        snapshot = !timedOut && Date.now() < deadline && code === 0 && result ? result : blocked("unavailable");
        resolve();
      });
    }).finally(() => { pending = null; });
    return pending;
  };
  return { refresh, snapshot: () => {
    // Health polling is cheap: at most one bounded check per five minutes.
    if (!pending && Date.now() - lastAttempt >= 300_000) void refresh();
    return { ...snapshot };
  } };
}
