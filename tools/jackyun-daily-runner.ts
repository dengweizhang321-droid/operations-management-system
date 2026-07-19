import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JackyunBrowserStateMachine } from "../lib/jackyun/browser-state-machine";
import { jackyunModuleOrder, type JackyunModule } from "../lib/jackyun/post-download";
import { runJackyunDownload } from "./jackyun-download-runner";
import { readJsonFile, readJsonFileOr, writeJsonAtomic } from "../lib/jackyun/json-file";
import { assertDownloadProvenance, type JackyunDownloadProvenance } from "../lib/jackyun/download-provenance";

type DailyPolicy = {
  version: string;
  moduleOrder: JackyunModule[];
  browser: { downloadDirectory: string; eventTimeoutMs: number; pollIntervalMs: number; allowedDownloadHosts?: string[] };
  modules: Record<JackyunModule, {
    requiresQuery: boolean;
    exportConfirmation?: {
      required: boolean;
      promptIncludes: string[];
      button: string;
      maxRows: number;
    };
  }>;
};

export type BrowserExportConfirmation = {
  prompt: string;
  button: string;
  confirmedAt: string;
};

export type BrowserHandoff = {
  schemaVersion?: 1;
  module: JackyunModule;
  filePath: string;
  navigationIntentAt: string;
  queryIntentAt?: string;
  tableStableAt: string;
  exportIntentAt: string;
  exportConfirmation?: BrowserExportConfirmation;
  downloadEventAt: string;
  expectedSourceRows: number;
  downloadProvenance?: JackyunDownloadProvenance;
  fieldChecks?: Array<{ field: string; value: string; verifiedAt: string }>;
  evidence?: Record<string, unknown>;
};

type CliOptions = {
  runId: string;
  snapshotDate: string;
  asOfDate: string;
  eventDirectory: string;
  outputRoot: string;
  baseUrl: string;
  dryRun: boolean;
  resume: boolean;
  signal?: AbortSignal;
};

type RunManifestModule = {
  status: "prepared" | "completed" | "failed";
  outputPath?: string;
  salesCostSourcePath?: string;
  batchId?: string | null;
  completedAt?: string;
};

type RunManifest = {
  runId: string;
  updatedAt: string;
  strictOrder: readonly JackyunModule[];
  modules: Partial<Record<JackyunModule, RunManifestModule>>;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = path.join(projectRoot, "config", "jackyun-daily-policy.json");

function compactDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shanghaiYesterday() {
  const today = new Date(`${compactDate(new Date())}T00:00:00Z`);
  today.setUTCDate(today.getUTCDate() - 1);
  return today.toISOString().slice(0, 10);
}

function defaultRunId() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date()).replace(/[-: ]/g, "").replace(/^(\d{8})(\d{6})$/, "$1-$2");
}

function parseCli(): CliOptions {
  const yesterday = shanghaiYesterday();
  const values = new Map<string, string>();
  let dryRun = false;
  let resume = false;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (args[index] === "--resume") {
      resume = true;
      continue;
    }
    const next = args[index + 1];
    if (!next) throw new Error(`参数 ${args[index]} 缺少取值。`);
    values.set(args[index], next);
    index += 1;
  }
  return {
    runId: values.get("--run-id") ?? defaultRunId(),
    snapshotDate: values.get("--snapshot") ?? yesterday,
    asOfDate: values.get("--as-of") ?? yesterday,
    eventDirectory: path.resolve(values.get("--event-dir") ?? path.join(projectRoot, "outputs", "jackyun-browser-events")),
    outputRoot: path.resolve(values.get("--output-root") ?? path.join(projectRoot, "outputs", "jackyun-import-runs")),
    baseUrl: (values.get("--base-url") ?? "http://localhost:3000").replace(/\/$/, ""),
    dryRun,
    resume,
  };
}

function eventFileName(index: number, module: JackyunModule) {
  return `${String(index + 1).padStart(2, "0")}-${module}.json`;
}

async function waitForHandoff(filePath: string, notBeforeMs: number, timeoutMs: number, pollIntervalMs: number, signal?: AbortSignal) {
  const deadline = Date.now() + timeoutMs;
  let backoffMs = pollIntervalMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("每日 runner 已取消。");
    const info = await stat(filePath).catch(() => null);
    if (info?.isFile() && info.mtimeMs >= notBeforeMs) {
      return await readJsonFile<BrowserHandoff>(filePath);
    }
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    backoffMs = Math.min(Math.round(backoffMs * 1.5), 2_000);
  }
  throw new Error(`等待浏览器下载事件超时：${filePath}`);
}

function assertTimestamp(value: string | undefined, label: string) {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error(`${label} 缺少有效时间戳。`);
}

function isRecoverableResumeState(state: string) {
  return state === "BLOCKED" || state === "MODULE_DONE" || state === "WAIT_EVENT_AND_FILE" || state === "HANDOFF_EXACT_PATH";
}

export function validateHandoff(handoff: BrowserHandoff, module: JackyunModule, policy: DailyPolicy) {
  if (handoff.module !== module) throw new Error(`浏览器事件模块不一致：期望 ${module}，实际 ${handoff.module}。`);
  if (!Number.isSafeInteger(handoff.expectedSourceRows) || handoff.expectedSourceRows <= 0) throw new Error("expectedSourceRows 必须是正整数。");
  assertTimestamp(handoff.navigationIntentAt, "navigationIntentAt");
  if (policy.modules[module].requiresQuery) assertTimestamp(handoff.queryIntentAt, "queryIntentAt");
  assertTimestamp(handoff.tableStableAt, "tableStableAt");
  assertTimestamp(handoff.exportIntentAt, "exportIntentAt");
  const confirmationPolicy = policy.modules[module].exportConfirmation;
  const confirmation = handoff.exportConfirmation;
  if (confirmationPolicy?.required && !confirmation) {
    throw new Error(`${module} 必须记录导出确认框及“${confirmationPolicy.button}”按钮的单次确认。`);
  }
  if (confirmation) {
    assertTimestamp(confirmation.confirmedAt, "exportConfirmation.confirmedAt");
    if (Date.parse(confirmation.confirmedAt) < Date.parse(handoff.exportIntentAt)) {
      throw new Error("导出确认时间早于导出 intent。");
    }
    if (confirmationPolicy) {
      if (confirmation.button.trim() !== confirmationPolicy.button) {
        throw new Error(`导出确认按钮不一致：期望 ${confirmationPolicy.button}，实际 ${confirmation.button}。`);
      }
      for (const fragment of confirmationPolicy.promptIncludes) {
        if (!confirmation.prompt.includes(fragment)) {
          throw new Error(`导出确认提示缺少固定文本：${fragment}`);
        }
      }
    }
  }
  assertTimestamp(handoff.downloadEventAt, "downloadEventAt");
  if (handoff.downloadProvenance) {
    assertDownloadProvenance(handoff.downloadProvenance, policy.browser.allowedDownloadHosts);
    if (Date.parse(handoff.downloadProvenance.completedAt) < Date.parse(handoff.exportIntentAt)) {
      throw new Error("下载来源证据的完成时间早于导出 intent。");
    }
  }
  if (Date.parse(handoff.tableStableAt) < Date.parse(handoff.queryIntentAt ?? handoff.navigationIntentAt)) {
    throw new Error("表格稳定时间早于本轮查询或导航 intent。" );
  }
  if (Date.parse(handoff.downloadEventAt) < Date.parse(handoff.exportIntentAt)) {
    throw new Error("下载事件早于导出 intent。" );
  }
  if (confirmation && Date.parse(handoff.downloadEventAt) < Date.parse(confirmation.confirmedAt)) {
    throw new Error("下载事件早于导出确认。" );
  }
}

export function assertPolicyModuleOrder(policy: DailyPolicy) {
  if (policy.moduleOrder.length !== jackyunModuleOrder.length
    || policy.moduleOrder.some((module, index) => module !== jackyunModuleOrder[index])) {
    throw new Error(`策略模块顺序与代码不一致：期望 ${jackyunModuleOrder.join(" -> ")}。`);
  }
}

async function writeCompactResult(filePath: string, value: unknown) {
  await writeJsonAtomic(filePath, value, false);
}

function assertManifestOrder(manifest: RunManifest) {
  if (manifest.strictOrder.length !== jackyunModuleOrder.length
    || manifest.strictOrder.some((module, index) => module !== jackyunModuleOrder[index])) {
    throw new Error(`运行清单模块顺序与当前代码不一致：${manifest.strictOrder.join(" -> ")}。`);
  }
}

export function firstIncompleteModuleIndex(manifest: RunManifest | null) {
  if (!manifest) return 0;
  const firstIncomplete = jackyunModuleOrder.findIndex((module) => manifest.modules[module]?.status !== "completed");
  if (firstIncomplete < 0) return jackyunModuleOrder.length;
  for (const later of jackyunModuleOrder.slice(firstIncomplete + 1)) {
    if (manifest.modules[later]?.status === "completed") {
      throw new Error("运行清单存在非连续的已完成模块，不能自动续跑。");
    }
  }
  return firstIncomplete;
}

async function compactCompletedResult(
  eventPath: string,
  module: JackyunModule,
  runDirectory: string,
  manifestModule: RunManifestModule,
) {
  const saved = await readJsonFileOr<Record<string, unknown> | null>(`${eventPath}.result.json`, null);
  if (saved) return saved;
  const auditPath = path.join(runDirectory, "audit", `${module}.json`);
  const audit = await readJsonFileOr<Record<string, unknown> | null>(auditPath, null);
  const imported = audit?.import as Record<string, unknown> | undefined;
  const batch = imported?.batch as Record<string, unknown> | undefined;
  const timings = audit?.timings as Record<string, unknown> | undefined;
  return {
    module,
    status: "completed",
    outputPath: manifestModule.outputPath ?? null,
    batchId: manifestModule.batchId ?? null,
    rowCount: typeof batch?.rowCount === "number" ? batch.rowCount : null,
    warningCount: typeof batch?.warningCount === "number" ? batch.warningCount : null,
    auditPath,
    runnerElapsedMs: typeof timings?.elapsedMs === "number" ? timings.elapsedMs : null,
  };
}

async function readRunnerTiming(auditPath: string) {
  const audit = await readJsonFileOr<Record<string, unknown> | null>(auditPath, null);
  const timings = audit?.timings as Record<string, unknown> | undefined;
  return {
    runnerElapsedMs: typeof timings?.elapsedMs === "number" ? timings.elapsedMs : null,
    stageElapsedMs: timings?.stageElapsedMs && typeof timings.stageElapsedMs === "object" ? timings.stageElapsedMs : null,
  };
}

export async function runJackyunDaily(options: CliOptions) {
  const policy = JSON.parse(await readFile(policyPath, "utf8")) as DailyPolicy;
  assertPolicyModuleOrder(policy);
  const startedAtMs = Date.now();
  const runDirectory = path.join(options.outputRoot, options.runId);
  const eventRunDirectory = path.join(options.eventDirectory, options.runId);
  await Promise.all([mkdir(runDirectory, { recursive: true }), mkdir(eventRunDirectory, { recursive: true })]);
  const manifestPath = path.join(runDirectory, "run-manifest.json");
  const manifest = await readJsonFileOr<RunManifest | null>(manifestPath, null);
  if (manifest) {
    if (manifest.runId !== options.runId) throw new Error("运行清单中的 run id 与续跑参数不一致。");
    assertManifestOrder(manifest);
    if (!options.resume && Object.keys(manifest.modules).length) {
      throw new Error(`运行编号 ${options.runId} 已经存在；继续该批次必须显式使用 --resume。`);
    }
  }
  const startIndex = firstIncompleteModuleIndex(manifest);
  if (options.resume && startIndex < jackyunModuleOrder.length) {
    const incompleteModule = jackyunModuleOrder[startIndex];
    if (manifest?.modules[incompleteModule]?.status === "failed") {
      throw new Error(`${incompleteModule} 已产生下载后处理失败清单；该类失败不能自动重导或覆盖，请先核验失败审计。`);
    }
  }
  const statePath = path.join(runDirectory, "browser-state.json");
  const stateExists = Boolean(await stat(statePath).catch(() => null));
  const stateMachine = options.resume && stateExists
    ? await JackyunBrowserStateMachine.load(statePath)
    : await JackyunBrowserStateMachine.create({ statePath, runId: options.runId, policyVersion: policy.version });
  const resumedFromState = options.resume && stateExists ? stateMachine.snapshot().currentState : null;
  if (startIndex < jackyunModuleOrder.length) {
    const startModule = jackyunModuleOrder[startIndex];
    if (options.resume && stateExists) {
      if (resumedFromState === "BLOCKED") {
        throw new Error(`当前浏览器状态 ${resumedFromState} 不适合自动续跑，请先人工确认后再继续。`);
      }
      await stateMachine.reconcileForResume(startModule, { resumedAt: new Date(startedAtMs).toISOString(), manifestPath, policyVersion: policy.version });
    } else if (startModule === "products") {
      await stateMachine.transition("products", "ENTER_MODULE", { baseUrl: options.baseUrl, startedAt: new Date(startedAtMs).toISOString() });
    } else {
      await stateMachine.reconcileForResume(startModule, { reconstructedFromManifest: true, manifestPath, policyVersion: policy.version });
    }
  }

  const results: Array<Record<string, unknown>> = [];
  for (let index = 0; index < startIndex; index += 1) {
    const completedModule = jackyunModuleOrder[index];
    const completedManifest = manifest?.modules[completedModule];
    if (!completedManifest) throw new Error(`续跑缺少 ${completedModule} 清单记录。`);
    results.push(await compactCompletedResult(
      path.join(eventRunDirectory, eventFileName(index, completedModule)),
      completedModule,
      runDirectory,
      completedManifest,
    ));
  }
  let inventoryCostSource = manifest?.modules.inventory?.salesCostSourcePath;
  const resumeNotBeforeMs = manifest?.updatedAt ? Date.parse(manifest.updatedAt) - 5_000 : startedAtMs;
  for (let index = startIndex; index < jackyunModuleOrder.length; index += 1) {
    const moduleKey = jackyunModuleOrder[index];
    try {
      const eventPath = path.join(eventRunDirectory, eventFileName(index, moduleKey));
      const handoff = await waitForHandoff(eventPath, index === startIndex ? resumeNotBeforeMs : startedAtMs, policy.browser.eventTimeoutMs, policy.browser.pollIntervalMs, options.signal);
      validateHandoff(handoff, moduleKey, policy);
      if (handoff.fieldChecks?.length) await stateMachine.transition(moduleKey, "VERIFY_FIELD", { checks: handoff.fieldChecks });
      if (policy.modules[moduleKey].requiresQuery) await stateMachine.transition(moduleKey, "QUERY_ONCE", { queryIntentAt: handoff.queryIntentAt });
      await stateMachine.transition(moduleKey, "WAIT_TABLE_STABLE", { tableStableAt: handoff.tableStableAt, expectedSourceRows: handoff.expectedSourceRows });
      await stateMachine.transition(moduleKey, "ARM_DOWNLOAD", { exportIntentAt: handoff.exportIntentAt });
      await stateMachine.transition(moduleKey, "EXPORT_ONCE", { exportIntentAt: handoff.exportIntentAt });
      if (handoff.exportConfirmation) {
        await stateMachine.transition(moduleKey, "CONFIRM_EXPORT_DIALOG", handoff.exportConfirmation);
      }
      await stateMachine.transition(moduleKey, "WAIT_EVENT_AND_FILE", { downloadEventAt: handoff.downloadEventAt, filePath: handoff.filePath });
      await stateMachine.transition(moduleKey, "HANDOFF_EXACT_PATH", { filePath: handoff.filePath, ...handoff.evidence });

      const result = await runJackyunDownload({
        module: moduleKey,
        filePath: path.resolve(handoff.filePath),
        runId: options.runId,
        snapshotDate: moduleKey === "inventory" || moduleKey === "inventory_age" ? options.snapshotDate : undefined,
        asOfDate: moduleKey === "sales" ? options.asOfDate : undefined,
        costSourcePath: moduleKey === "sales" ? inventoryCostSource : undefined,
        exportStart: handoff.exportIntentAt,
        expectedSourceRows: handoff.expectedSourceRows,
        baseUrl: options.baseUrl,
        outputRoot: options.outputRoot,
        downloadDirectory: policy.browser.downloadDirectory,
        downloadProvenance: handoff.downloadProvenance,
        allowedDownloadHosts: policy.browser.allowedDownloadHosts,
        dryRun: options.dryRun,
      });
      if (moduleKey === "inventory") {
        inventoryCostSource = "salesCostSourcePath" in result
          ? result.salesCostSourcePath
          : result.existing.salesCostSourcePath;
        if (!inventoryCostSource) throw new Error("库存模块未返回本轮销售成本源副本。");
      }
      await stateMachine.transition(moduleKey, "RUNNER_VERIFIED", { status: result.status, auditPath: result.auditPath });
      await stateMachine.transition(moduleKey, "MODULE_DONE", { batchId: "batch" in result ? result.batch?.id ?? null : result.existing.batchId ?? null });
      const compact = {
        module: moduleKey,
        status: result.status,
        outputPath: "outputPath" in result ? result.outputPath : result.existing.outputPath ?? null,
        batchId: "batch" in result ? result.batch?.id ?? null : result.existing.batchId ?? null,
        rowCount: "batch" in result ? result.batch?.rowCount ?? null : null,
        warningCount: "batch" in result ? result.batch?.warningCount ?? 0 : null,
        auditPath: result.auditPath,
        resumedFrom: index === startIndex ? resumedFromState : null,
        ...await readRunnerTiming(result.auditPath),
      };
      results.push(compact);
      await writeCompactResult(`${eventPath}.result.json`, compact);
      console.log(JSON.stringify({ type: "module_completed", runId: options.runId, ...compact }));
      if (index < jackyunModuleOrder.length - 1) await stateMachine.startNextModule();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await stateMachine.block("DAILY_RUNNER_FAILED", message, { module: moduleKey });
      throw error;
    }
  }
  const stateSnapshot = stateMachine.snapshot();
  const browserElapsedByModule = Object.fromEntries(jackyunModuleOrder.map((moduleKey) => [
    moduleKey,
    stateSnapshot.events
      .filter((event) => event.module === moduleKey && !["HANDOFF_EXACT_PATH", "RUNNER_VERIFIED"].includes(event.state))
      .reduce((total, event) => total + event.elapsedMs, 0),
  ]));
  const moduleTimings = Object.fromEntries(results.map((result) => {
    const moduleKey = result.module as JackyunModule;
    const runnerMs = typeof result.runnerElapsedMs === "number" ? result.runnerElapsedMs : null;
    const browserMs = browserElapsedByModule[moduleKey] ?? 0;
    return [moduleKey, {
      browserMs,
      runnerMs,
      totalMs: runnerMs === null ? browserMs : browserMs + runnerMs,
      stageElapsedMs: result.stageElapsedMs ?? null,
    }];
  }));
  const summary = {
    status: "completed",
    runId: options.runId,
    policyVersion: policy.version,
    elapsedMs: Date.now() - startedAtMs,
    resumed: options.resume,
    salesAsOfDate: options.asOfDate,
    moduleTimings,
    results,
  };
  await writeCompactResult(path.join(runDirectory, "daily-summary.json"), summary);
  return summary;
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  runJackyunDaily(parseCli())
    .then((result) => console.log(JSON.stringify({ type: "daily_completed", ...result })))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
