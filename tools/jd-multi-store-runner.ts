import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadJdStores, type JdStore } from "../lib/jd/store-registry";
import { writeJsonAtomic } from "../lib/jackyun/json-file";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const auditDir = path.join(projectRoot, "outputs", "jd-multi-store-runner");
const baseUrl = (process.env.OPERATIONS_SYSTEM_URL ?? "http://localhost:3000").replace(/\/$/, "");
type Step = "jd_product_master" | "jd_sku_daily" | "spu_daily";
type AuditStatus = "planned" | "running" | "completed" | "failed";
export type AuditItem = { storeKey: string; shopName: string; step: Step; status: AuditStatus; savedPath?: string; batchId?: string; rowCount?: number; durationMs?: number; error?: string; stderr?: string };
export type RunnerAudit = { version: 1; baseUrl: string; startedAt: string; updatedAt: string; mode: string; dryRun: boolean; storeKeys: string[]; items: AuditItem[] };
export const JD_PIPELINE_RESULT_SENTINEL = "@@JD_PIPELINE_RESULT@@";

export function parseRunnerArgs(argv: string[]) {
  const value = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const has = (name: string) => argv.includes(name);
  const mode = (value("--mode") ?? "all").toLowerCase();
  if (!["all", "master", "sku-daily", "spu-daily"].includes(mode)) throw new Error("--mode 必须是 all/master/sku-daily/spu-daily");
  if (has("--dimension")) throw new Error("多店执行器不再使用 --dimension；请改用 --mode sku-daily 或 --mode spu-daily（all 会依次运行主数据、SKU、SPU）。");
  return { mode, startDate: value("--start-date"), endDate: value("--end-date"), storeKey: value("--store-key"), dryRun: has("--dry-run") };
}

function run(command: string, args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), shell: false, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); process.stdout.write(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); process.stderr.write(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Child scripts may log progress before the final machine-readable result. */
export function parseTrailingJson(stdout: string): Record<string, unknown> | null {
  let result: Record<string, unknown> | null = null;
  for (let index = 0; index < stdout.length; index += 1) {
    if (stdout[index] !== "{") continue;
    try {
      const candidate = JSON.parse(stdout.slice(index)) as unknown;
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) result = candidate as Record<string, unknown>;
    } catch { /* Try the next possible JSON object. */ }
  }
  return result;
}

export function parsePipelineResult(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split(/\r?\n/).filter((line) => line.startsWith(JD_PIPELINE_RESULT_SENTINEL));
  if (lines.length !== 1) return null;
  try {
    const parsed = JSON.parse(lines[0]!.slice(JD_PIPELINE_RESULT_SENTINEL.length)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

export function shanghaiDefaultRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const yesterday = new Date(`${today}T00:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const endDate = yesterday.toISOString().slice(0, 10);
  return { startDate: `${endDate.slice(0, 8)}01`, endDate };
}

export function validateStepResult(step: Step, payload: Record<string, unknown>, store: Pick<JdStore, "shopName">, requested: { startDate?: string; endDate?: string } = {}) {
  const imported = payload.importResult;
  if (!imported || typeof imported !== "object" || Array.isArray(imported)) return "missing verified auto-import result";
  const result = imported as Record<string, unknown>;
  if ((result.status !== "imported" && result.status !== "duplicate") || typeof result.batchId !== "string" || !result.batchId
    || typeof result.rowCount !== "number" || !Number.isFinite(result.rowCount) || result.rowCount < 0
    || result.batchStatus !== "completed" || result.warningCount !== 0 || result.platform !== "京东" || result.shopName !== store.shopName) return "invalid import batch identity or status";
  const daily = step !== "jd_product_master";
  const expectedDataset = step === "jd_sku_daily" ? "sku_daily" : step === "spu_daily" ? "spu_daily" : "product_master";
  const expectedSource = daily ? "jd_sku_daily" : "jd_product_master";
  if (result.dataset !== expectedDataset || result.source !== expectedSource) return "unexpected import source or dataset";
  if (daily) {
    const defaults = shanghaiDefaultRange();
    const range = { startDate: requested.startDate ?? defaults.startDate, endDate: requested.endDate ?? defaults.endDate };
    if (result.dateMin !== range.startDate || result.dateMax !== range.endDate) return "unexpected daily import date range";
  }
  return null;
}

export function auditCounts(items: AuditItem[]) {
  return { planned: items.filter((item) => item.status === "planned").length, running: items.filter((item) => item.status === "running").length, completed: items.filter((item) => item.status === "completed").length, failed: items.filter((item) => item.status === "failed").length };
}

function stepsForMode(mode: string): Step[] {
  if (mode === "master") return ["jd_product_master"];
  if (mode === "sku-daily") return ["jd_sku_daily"];
  if (mode === "spu-daily") return ["spu_daily"];
  return ["jd_product_master", "jd_sku_daily", "spu_daily"];
}

function childArgs(store: JdStore, step: Step, options: ReturnType<typeof parseRunnerArgs>) {
  const args = ["--import", "tsx"];
  if (step === "jd_product_master") return [...args, "tools/jackyun-ware-export.ts", "--store-key", store.storeKey, "--base-url", baseUrl];
  const dimension = step === "jd_sku_daily" ? "SKU" : "SPU";
  const command = [...args, "tools/jdsz-product-detail-export.ts", "--store-key", store.storeKey, "--dimension", dimension, "--download-dir", store.browser.downloadDir, "--base-url", baseUrl];
  if (options.startDate) command.push("--start-date", options.startDate);
  if (options.endDate) command.push("--end-date", options.endDate);
  return command;
}

function stderrSummary(stderr: string) {
  return stderr.trim().slice(-2_000) || undefined;
}

export async function runMultiStore(options: ReturnType<typeof parseRunnerArgs>, stores?: JdStore[]) {
  const enabled = (stores ?? await loadJdStores()).filter((store) => store.enabled);
  const selected = options.storeKey ? enabled.filter((store) => store.storeKey === options.storeKey) : enabled;
  if (options.storeKey && selected.length !== 1) throw new Error(`未找到启用的京东店铺注册键: ${options.storeKey}`);
  await mkdir(auditDir, { recursive: true });
  const auditPath = path.join(auditDir, `run-${Date.now()}.json`);
  let audit: RunnerAudit = { version: 1, baseUrl, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mode: options.mode, dryRun: options.dryRun, storeKeys: selected.map((store) => store.storeKey), items: selected.flatMap((store) => stepsForMode(options.mode).map((step) => ({ storeKey: store.storeKey, shopName: store.shopName, step, status: "planned" as const }))) };
  const persist = async () => { audit = { ...audit, updatedAt: new Date().toISOString() }; await writeJsonAtomic(auditPath, audit); };
  await persist();

  for (const store of selected) {
    for (const step of stepsForMode(options.mode)) {
      const item = audit.items.find((candidate) => candidate.storeKey === store.storeKey && candidate.step === step)!;
      if (options.dryRun) continue; // Planned is intentional: nothing was executed.
      item.status = "running";
      await persist();
      const started = Date.now();
      let outcome: Awaited<ReturnType<typeof run>>;
      try {
        outcome = await run(process.execPath, childArgs(store, step, options));
      } catch (error) {
        item.status = "failed";
        item.durationMs = Date.now() - started;
        item.error = error instanceof Error ? error.message : String(error);
        await persist();
        return { ok: false, auditPath, audit };
      }
      const payload = parsePipelineResult(outcome.stdout);
      if (outcome.code !== 0 || !payload) {
        item.status = "failed";
        item.durationMs = Date.now() - started;
        item.error = outcome.code !== 0 ? `child exited with ${outcome.code}` : "child did not emit exactly one sentinel pipeline result";
        item.stderr = stderrSummary(outcome.stderr);
        await persist();
        return { ok: false, auditPath, audit };
      }
      const importResult = payload.importResult as Record<string, unknown> | undefined;
      const invalid = validateStepResult(step, payload, store, options);
      if (invalid) {
        item.status = "failed";
        item.durationMs = Date.now() - started;
        item.error = invalid;
        item.stderr = stderrSummary(outcome.stderr);
        await persist();
        return { ok: false, auditPath, audit };
      }
      item.status = "completed";
      item.durationMs = Date.now() - started;
      item.savedPath = typeof payload.savedPath === "string" ? payload.savedPath : typeof payload.downloadSavedPath === "string" ? payload.downloadSavedPath : undefined;
      item.batchId = typeof payload.batchId === "string" ? payload.batchId : typeof importResult?.batchId === "string" ? importResult.batchId : undefined;
      item.rowCount = typeof payload.rowCount === "number" ? payload.rowCount : typeof importResult?.rowCount === "number" ? importResult.rowCount : undefined;
      await persist();
    }
  }
  return { ok: true, auditPath, audit };
}

async function main() {
  const result = await runMultiStore(parseRunnerArgs(process.argv.slice(2)));
  console.log(JSON.stringify({ ok: result.ok, baseUrl, storeCount: result.audit.storeKeys.length, stepCounts: auditCounts(result.audit.items), auditPath: result.auditPath }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
}
