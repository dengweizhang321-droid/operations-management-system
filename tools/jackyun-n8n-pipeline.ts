import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isSafePreExportBlockedResume, type JackyunBrowserRunState } from "../lib/jackyun/browser-state-machine";
import { readJsonFile, writeJsonAtomic } from "../lib/jackyun/json-file";
import { jackyunModuleOrder, type JackyunModule } from "../lib/jackyun/post-download";
import { isValidJackyunSourceRowCountCorrection } from "../lib/jackyun/run-contract";
import { runJackyunAutomation, type JackyunAutomationOptions } from "./jackyun-automation-runner";
import { isExactFailedSourceRowCountRepair } from "./jackyun-download-runner";
import type { BrowserHandoff } from "./jackyun-daily-runner";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maximumRunDirectoriesToInspect = 365;

export type JackyunProfileStatus = "ready" | "missing" | "invalid";
export type JackyunN8nStage = "planned" | "running" | "executed" | "completed" | "failed";
export type JackyunHelperRoute = "/jackyun/plan" | "/jackyun/run" | "/jackyun/verify";

type JackyunN8nFailure = {
  code: string;
  message: string;
  at: string;
};

export type JackyunN8nPlan = {
  version: 1;
  runId: string;
  runDate: string;
  snapshotDate: string;
  asOfDate: string;
  generatedAt: string;
  updatedAt: string;
  baseUrl: string;
  policyVersion: string;
  stage: JackyunN8nStage;
  skipped: boolean;
  resume?: boolean;
  existingRunId?: string;
  failure?: JackyunN8nFailure;
};

type DailySummaryResult = {
  module?: JackyunModule;
  status?: string;
  batchId?: string | null;
  rowCount?: number | null;
  warningCount?: number | null;
  auditPath?: string;
};

type DailySummary = {
  status?: string;
  runId?: string;
  policyVersion?: string;
  salesAsOfDate?: string;
  results?: DailySummaryResult[];
};

type RunManifest = {
  runId?: string;
  strictOrder?: JackyunModule[];
  modules?: Partial<Record<JackyunModule, {
    module?: JackyunModule;
    status?: string;
    batchId?: string | null;
    sourcePath?: string;
    sourceSha256?: string;
    inputContractHash?: string;
    outputPath?: string;
    outputSha256?: string;
  }>>;
};

type RuntimePaths = {
  root: string;
  artifactDirectory: string;
  eventDirectory: string;
  outputRoot: string;
  policyPath: string;
};

type PlanOptions = {
  root?: string;
  now?: Date;
  baseUrl?: string;
  profileDirectory?: string;
  request?: typeof fetch;
  runIdFactory?: (now: Date) => string;
};

type RunOptions = {
  root?: string;
  profileDirectory?: string;
  runAutomation?: (options: JackyunAutomationOptions) => ReturnType<typeof runJackyunAutomation>;
  signal?: AbortSignal;
};

type VerifyOptions = {
  root?: string;
  request?: typeof fetch;
};

type VerifiedModuleEvidence = {
  module: JackyunModule;
  status: string;
  batchId: string;
  rowCount: number;
  warningCount: number;
  salesPolicyVersion?: string;
};

function pathsFor(root = projectRoot): RuntimePaths {
  const resolvedRoot = path.resolve(root);
  return {
    root: resolvedRoot,
    artifactDirectory: path.join(resolvedRoot, "outputs", "jackyun-n8n-pipeline"),
    eventDirectory: path.join(resolvedRoot, "outputs", "jackyun-browser-events"),
    outputRoot: path.join(resolvedRoot, "outputs", "jackyun-import-runs"),
    policyPath: path.join(resolvedRoot, "config", "jackyun-daily-policy.json"),
  };
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function validRunId(value: string) {
  return /^[A-Za-z0-9._-]{1,96}$/.test(value);
}

function inside(directory: string, filePath: string) {
  const relative = path.relative(directory, filePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function shanghaiDate(now = new Date(), offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const value = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

export function createJackyunN8nRunId(now = new Date()) {
  const timestamp = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now).replace(/[-: ]/g, "");
  return `n8n-${timestamp.slice(0, 8)}-${timestamp.slice(8)}-${randomUUID().slice(0, 8)}`;
}

export function normalizeJackyunLocalBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)
    || (url.pathname !== "/" && url.pathname !== "") || url.username || url.password) {
    throw new Error("吉客云 n8n 工作流只允许连接本机运营系统根地址");
  }
  return url.toString().replace(/\/$/, "");
}

export function jackyunHelperRequestError(stage: string, busy: boolean, route: JackyunHelperRoute) {
  if (busy) return { error: "pipeline_busy" as const };
  if (route === "/jackyun/plan") {
    const allowed = ["ready", "planned", "executed", "failed"];
    return allowed.includes(stage)
      ? null
      : { error: "invalid_stage" as const, expected: "ready_or_recoverable", actual: stage };
  }
  const expected = route === "/jackyun/run" ? "planned" : "executed";
  return stage === expected ? null : { error: "invalid_stage" as const, expected, actual: stage };
}

async function readPolicy(paths: RuntimePaths) {
  const policy = JSON.parse(await readFile(paths.policyPath, "utf8")) as {
    version?: string;
    moduleOrder?: JackyunModule[];
    browser?: { controller?: { profileDirectory?: string } };
  };
  if (!policy.version || !Array.isArray(policy.moduleOrder)
    || policy.moduleOrder.length !== jackyunModuleOrder.length
    || policy.moduleOrder.some((moduleKey, index) => moduleKey !== jackyunModuleOrder[index])) {
    throw new Error("吉客云每日策略缺少版本或五类顺序不匹配");
  }
  return policy;
}

export async function getJackyunProfileStatus(profileDirectory?: string, root = projectRoot): Promise<JackyunProfileStatus> {
  const paths = pathsFor(root);
  const policy = await readPolicy(paths).catch(() => null);
  const configured = profileDirectory ?? policy?.browser?.controller?.profileDirectory;
  if (!configured) return "missing";
  const resolved = path.resolve(configured);
  const profile = await stat(resolved).catch(() => null);
  if (!profile) return "missing";
  if (!profile.isDirectory()) return "invalid";
  const [localState, defaultProfile] = await Promise.all([
    stat(path.join(resolved, "Local State")).catch(() => null),
    stat(path.join(resolved, "Default")).catch(() => null),
  ]);
  return localState?.isFile() && defaultProfile?.isDirectory() ? "ready" : "invalid";
}

function planPath(paths: RuntimePaths, runId: string) {
  if (!validRunId(runId)) throw new Error("吉客云 n8n 运行编号无效");
  return path.join(paths.artifactDirectory, `plan-${runId}.json`);
}

async function persistPlan(paths: RuntimePaths, plan: JackyunN8nPlan) {
  plan.updatedAt = new Date().toISOString();
  await writeJsonAtomic(planPath(paths, plan.runId), plan);
}

function safeError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/(cookie|token|password|secret)\s*[=:]\s*\S+/gi, (_match, key: string) => `${key}=<redacted>`)
    .slice(0, 1_000);
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyRunArtifacts(paths: RuntimePaths, runId: string, asOfDate: string, expectedPolicyVersion?: string) {
  if (!validRunId(runId) || !validDate(asOfDate)) throw new Error("吉客云运行结果身份无效");
  const runDirectory = path.join(paths.outputRoot, runId);
  if (!inside(paths.outputRoot, runDirectory)) throw new Error("吉客云运行目录越界");
  const [summary, manifest] = await Promise.all([
    readJsonFile<DailySummary>(path.join(runDirectory, "daily-summary.json")),
    readJsonFile<RunManifest>(path.join(runDirectory, "run-manifest.json")),
  ]);
  if (summary.status !== "completed" || summary.runId !== runId || summary.salesAsOfDate !== asOfDate
    || (expectedPolicyVersion && summary.policyVersion !== expectedPolicyVersion)) {
    throw new Error("吉客云日汇总未完成，或运行编号、截止日期、策略版本不匹配");
  }
  if (manifest.runId !== runId || !Array.isArray(manifest.strictOrder)
    || manifest.strictOrder.length !== jackyunModuleOrder.length
    || manifest.strictOrder.some((moduleKey, index) => moduleKey !== jackyunModuleOrder[index])) {
    throw new Error("吉客云运行清单身份或五类顺序无效");
  }
  if (!Array.isArray(summary.results) || summary.results.length !== jackyunModuleOrder.length) {
    throw new Error("吉客云日汇总不是完整五类结果");
  }
  const modules: VerifiedModuleEvidence[] = [];
  for (let index = 0; index < jackyunModuleOrder.length; index += 1) {
    const moduleKey = jackyunModuleOrder[index]!;
    const result = summary.results[index]!;
    const manifestModule = manifest.modules?.[moduleKey];
    if (result.module !== moduleKey || !["completed", "duplicate_ignored"].includes(String(result.status))
      || manifestModule?.module !== moduleKey || manifestModule.status !== "completed"
      || typeof result.batchId !== "string" || !result.batchId.trim()) {
      throw new Error(`吉客云 ${moduleKey} 缺少完成状态或精确批次号`);
    }
    const expectedAuditPath = path.join(runDirectory, "audit", `${moduleKey}.json`);
    if (typeof result.auditPath !== "string" || path.resolve(result.auditPath) !== path.resolve(expectedAuditPath)
      || !(await stat(expectedAuditPath).catch(() => null))?.isFile()) {
      throw new Error(`吉客云 ${moduleKey} 审计文件缺失、越界或不是规范路径`);
    }
    const audit = await readJsonFile<Record<string, unknown>>(expectedAuditPath);
    const source = audit.source && typeof audit.source === "object" ? audit.source as Record<string, unknown> : null;
    const output = audit.output && typeof audit.output === "object" ? audit.output as Record<string, unknown> : null;
    const imported = audit.import && typeof audit.import === "object" ? audit.import as Record<string, unknown> : null;
    const importResult = imported?.result && typeof imported.result === "object"
      ? imported.result as Record<string, unknown>
      : null;
    const auditBatch = imported?.batch && typeof imported.batch === "object"
      ? imported.batch as Record<string, unknown>
      : null;
    const auditSourcePath = typeof source?.path === "string" ? path.resolve(source.path) : "";
    const copiedSourcePath = typeof source?.copiedPath === "string" ? path.resolve(source.copiedPath) : "";
    const manifestSourcePath = typeof manifestModule.sourcePath === "string" ? path.resolve(manifestModule.sourcePath) : "";
    const auditOutputPath = typeof output?.path === "string" ? path.resolve(output.path) : "";
    const manifestOutputPath = typeof manifestModule.outputPath === "string" ? path.resolve(manifestModule.outputPath) : "";
    const batchRowCount = Number(auditBatch?.rowCount);
    const batchWarningCount = typeof auditBatch?.warningCount === "number"
      ? auditBatch.warningCount
      : Array.isArray(auditBatch?.warnings) ? auditBatch.warnings.length : 0;
    if (audit.version !== 1 || audit.runId !== runId || audit.module !== moduleKey || audit.status !== "completed") {
      throw new Error(`吉客云 ${moduleKey} 审计身份或完成状态无效`);
    }
    if (!auditSourcePath || auditSourcePath !== manifestSourcePath
      || !copiedSourcePath || !inside(runDirectory, copiedSourcePath)
      || !(await stat(copiedSourcePath).catch(() => null))?.isFile()
      || typeof source?.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(source.sha256)
      || source.sha256 !== manifestModule.sourceSha256
      || typeof source.inputContractHash !== "string" || !/^[a-f0-9]{64}$/i.test(source.inputContractHash)
      || source.inputContractHash !== manifestModule.inputContractHash) {
      throw new Error(`吉客云 ${moduleKey} 源文件或输入契约证据不一致`);
    }
    if (await sha256File(copiedSourcePath) !== source.sha256) {
      throw new Error(`吉客云 ${moduleKey} 归档源文件的实际哈希与审计不一致`);
    }
    if (!auditOutputPath || !inside(runDirectory, auditOutputPath) || auditOutputPath !== manifestOutputPath
      || !(await stat(auditOutputPath).catch(() => null))?.isFile()
      || typeof output?.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(output.sha256)
      || output.sha256 !== manifestModule.outputSha256) {
      throw new Error(`吉客云 ${moduleKey} 输出文件或哈希证据不一致`);
    }
    if (await sha256File(auditOutputPath) !== output.sha256) {
      throw new Error(`吉客云 ${moduleKey} 输出文件的实际哈希与审计不一致`);
    }
    if (!auditBatch || auditBatch.id !== result.batchId || manifestModule.batchId !== result.batchId
      || auditBatch.status !== "completed" || !Number.isSafeInteger(batchRowCount) || batchRowCount <= 0
      || result.rowCount !== batchRowCount || result.warningCount !== batchWarningCount) {
      throw new Error(`吉客云 ${moduleKey} 汇总、清单与审计中的批次或行数不一致`);
    }
    const snapshotDate = auditBatch.snapshotDate;
    if ((moduleKey === "inventory" || moduleKey === "inventory_age") && snapshotDate !== asOfDate) {
      throw new Error(`吉客云 ${moduleKey} 快照日期不是 ${asOfDate}`);
    }
    if ((moduleKey === "products" || moduleKey === "combos") && snapshotDate !== null) {
      throw new Error(`吉客云 ${moduleKey} 不应携带快照日期`);
    }
    modules.push({
      module: moduleKey,
      status: String(result.status),
      batchId: result.batchId,
      rowCount: batchRowCount,
      warningCount: batchWarningCount,
      ...(moduleKey === "sales" && typeof importResult?.salesPolicyVersion === "string"
        ? { salesPolicyVersion: importResult.salesPolicyVersion }
        : {}),
    });
  }
  return { summary, modules };
}

export async function verifyCompletedJackyunRunArtifacts(options: {
  runId: string;
  asOfDate: string;
  expectedPolicyVersion?: string;
  root?: string;
}) {
  return verifyRunArtifacts(pathsFor(options.root), options.runId, options.asOfDate, options.expectedPolicyVersion);
}

async function readPublishedItems(request: typeof fetch, url: string) {
  const response = await request(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => null) as { items?: unknown[]; error?: string } | null;
  if (!response.ok || !Array.isArray(body?.items)) {
    throw new Error(body?.error ?? `吉客云落库批次回查失败：HTTP ${response.status}`);
  }
  return body.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
}

export async function verifyPublishedJackyunBatches(options: {
  baseUrl: string;
  asOfDate: string;
  modules: readonly VerifiedModuleEvidence[];
  request?: typeof fetch;
}) {
  const baseUrl = normalizeJackyunLocalBaseUrl(options.baseUrl);
  const request = options.request ?? fetch;
  const byModule = new Map(options.modules.map((item) => [item.module, item]));
  if (byModule.size !== jackyunModuleOrder.length || jackyunModuleOrder.some((moduleKey) => !byModule.has(moduleKey))) {
    throw new Error("吉客云落库回查缺少完整五类批次。");
  }
  const [products, inventory, inventoryAge, combos, salesResponse] = await Promise.all([
    readPublishedItems(request, `${baseUrl}/api/imports/erp?${new URLSearchParams({
      source: "products", batchId: byModule.get("products")!.batchId,
    })}`),
    readPublishedItems(request, `${baseUrl}/api/imports/inventory?${new URLSearchParams({
      batchId: byModule.get("inventory")!.batchId,
    })}`),
    readPublishedItems(request, `${baseUrl}/api/imports/erp?${new URLSearchParams({
      source: "inventory_age", batchId: byModule.get("inventory_age")!.batchId,
    })}`),
    readPublishedItems(request, `${baseUrl}/api/imports/erp?${new URLSearchParams({
      source: "combos", batchId: byModule.get("combos")!.batchId,
    })}`),
    request(`${baseUrl}/api/imports/sales/verify?${new URLSearchParams({
      startDate: `${options.asOfDate.slice(0, 8)}01`,
      endDate: options.asOfDate,
      batchId: byModule.get("sales")!.batchId,
    })}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) }),
  ]);
  const publishedLists: Partial<Record<JackyunModule, Record<string, unknown>[]>> = {
    products,
    inventory,
    inventory_age: inventoryAge,
    combos,
  };
  for (const moduleKey of ["products", "inventory", "inventory_age", "combos"] as const) {
    const expected = byModule.get(moduleKey)!;
    const batch = publishedLists[moduleKey]!.find((item) => item.id === expected.batchId);
    if (!batch || batch.status !== "completed" || Number(batch.rowCount) !== expected.rowCount) {
      throw new Error(`吉客云 ${moduleKey} 精确批次未在运营系统落库历史中完成。`);
    }
    const snapshotDate = batch.snapshotDate;
    if ((moduleKey === "inventory" || moduleKey === "inventory_age") && snapshotDate !== options.asOfDate) {
      throw new Error(`吉客云 ${moduleKey} 落库批次快照日期不一致。`);
    }
    if ((moduleKey === "products" || moduleKey === "combos") && snapshotDate !== null) {
      throw new Error(`吉客云 ${moduleKey} 落库批次不应携带快照日期。`);
    }
  }

  const sales = await salesResponse.json().catch(() => null) as {
    policyVersion?: string;
    period?: { startDate?: string; endDate?: string };
    batch?: { id?: string; status?: string; rowCount?: number } | null;
    stats?: { rowCount?: number; excludedWarehouseRows?: number; rowsNotOwnedByBatch?: number | null };
    nonWhitelistChannels?: unknown;
    error?: string;
  } | null;
  const expectedSales = byModule.get("sales")!;
  if (!salesResponse.ok || !sales || typeof sales.policyVersion !== "string" || !sales.policyVersion
    || (expectedSales.salesPolicyVersion !== undefined && sales.policyVersion !== expectedSales.salesPolicyVersion)
    || sales.period?.startDate !== `${options.asOfDate.slice(0, 8)}01` || sales.period.endDate !== options.asOfDate
    || sales.batch?.id !== expectedSales.batchId || sales.batch.status !== "completed"
    || sales.batch.rowCount !== expectedSales.rowCount || sales.stats?.rowCount !== expectedSales.rowCount
    || sales.stats.excludedWarehouseRows !== 0 || sales.stats.rowsNotOwnedByBatch !== 0
    || !Array.isArray(sales.nonWhitelistChannels) || sales.nonWhitelistChannels.length > 0) {
    throw new Error(sales?.error ?? "吉客云 sales 精确批次或期间数据未通过独立落库回查。");
  }
  return { ok: true, modules: jackyunModuleOrder.map((moduleKey) => byModule.get(moduleKey)!) };
}

async function findCompletedRun(paths: RuntimePaths, asOfDate: string, policyVersion: string) {
  const directoryEntries = (await readdir(paths.outputRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory());
  const directories = (await Promise.all(directoryEntries.map(async (entry) => ({
    entry,
    mtimeMs: (await stat(path.join(paths.outputRoot, entry.name)).catch(() => null))?.mtimeMs ?? 0,
  }))))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, maximumRunDirectoriesToInspect)
    .map(({ entry }) => entry);
  for (const entry of directories) {
    const summaryPath = path.join(paths.outputRoot, entry.name, "daily-summary.json");
    const summary = await readJsonFile<DailySummary>(summaryPath).catch(() => null);
    if (summary?.status !== "completed" || summary.salesAsOfDate !== asOfDate || summary.policyVersion !== policyVersion) continue;
    try {
      const verified = await verifyRunArtifacts(paths, entry.name, asOfDate, policyVersion);
      return { runId: entry.name, modules: verified.modules };
    } catch {
      // 损坏或不完整的历史运行不得成为“今日已完成”的证据。
    }
  }
  return null;
}

async function findUnclosedPlan(paths: RuntimePaths, runDate: string) {
  const files = (await readdir(paths.artifactDirectory, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && /^plan-[A-Za-z0-9._-]+\.json$/.test(entry.name));
  const plans = (await Promise.all(files.map((entry) => (
    readJsonFile<JackyunN8nPlan>(path.join(paths.artifactDirectory, entry.name)).catch(() => null)
  ))))
    .filter((plan): plan is JackyunN8nPlan => Boolean(plan?.version === 1 && plan.runDate === runDate && plan.stage !== "completed"))
    .sort((left, right) => Date.parse(right.updatedAt || right.generatedAt) - Date.parse(left.updatedAt || left.generatedAt));
  return plans[0] ?? null;
}

async function isExactResumableFailedPlan(
  paths: RuntimePaths,
  plan: JackyunN8nPlan,
  expected: { runDate: string; asOfDate: string; baseUrl: string; policyVersion: string },
) {
  if (plan.stage !== "failed" || plan.skipped || plan.failure?.code !== "JACKYUN_N8N_RUN_FAILED"
    || plan.runDate !== expected.runDate || plan.snapshotDate !== expected.asOfDate || plan.asOfDate !== expected.asOfDate
    || plan.baseUrl !== expected.baseUrl || plan.policyVersion !== expected.policyVersion || !validRunId(plan.runId)) return false;
  const runDirectory = path.join(paths.outputRoot, plan.runId);
  const manifest = await readJsonFile<RunManifest>(path.join(runDirectory, "run-manifest.json")).catch(() => null);
  if (manifest && (manifest.runId !== plan.runId || manifest.strictOrder?.length !== jackyunModuleOrder.length
    || manifest.strictOrder.some((moduleKey, index) => moduleKey !== jackyunModuleOrder[index]))) return false;

  let completedPrefix = 0;
  let sawIncomplete = false;
  let failedCurrent = false;
  for (let index = 0; index < jackyunModuleOrder.length; index += 1) {
    const moduleKey = jackyunModuleOrder[index]!;
    const manifestModule = manifest?.modules?.[moduleKey];
    if (manifestModule?.status === "completed") {
      if (sawIncomplete || typeof manifestModule.batchId !== "string" || !manifestModule.batchId.trim()) return false;
      const resultPath = path.join(paths.eventDirectory, plan.runId, `${String(index + 1).padStart(2, "0")}-${moduleKey}.json.result.json`);
      const result = await readJsonFile<{ status?: string }>(resultPath).catch(() => null);
      if (!result || !["completed", "duplicate_ignored"].includes(String(result.status))) return false;
      completedPrefix += 1;
    } else {
      sawIncomplete = true;
      if (manifestModule?.status === "failed") {
        if (index !== completedPrefix || failedCurrent) return false;
        failedCurrent = true;
      } else if (manifestModule) {
        return false;
      }
    }
  }
  if (completedPrefix >= jackyunModuleOrder.length) return false;
  const currentModule = jackyunModuleOrder[completedPrefix]!;
  const state = await readJsonFile<JackyunBrowserRunState>(path.join(runDirectory, "browser-state.json")).catch(() => null);
  const controller = await readJsonFile<{
    runId?: string;
    policyVersion?: string;
    modules?: Partial<Record<JackyunModule, Record<string, unknown>>>;
  }>(path.join(runDirectory, "browser-controller-state.json")).catch(() => null);
  if (!state || !Array.isArray(state.events) || state.runId !== plan.runId || state.policyVersion !== expected.policyVersion
    || state.status !== "blocked" || state.currentState !== "BLOCKED" || state.currentModule !== currentModule
    || !controller || controller.runId !== plan.runId || controller.policyVersion !== expected.policyVersion) return false;

  const currentEventPath = path.join(
    paths.eventDirectory,
    plan.runId,
    `${String(completedPrefix + 1).padStart(2, "0")}-${currentModule}.json`,
  );
  const currentHandoff = await readJsonFile<BrowserHandoff>(currentEventPath).catch(() => null);
  const currentManifest = manifest?.modules?.[currentModule];
  const failedAudit = await readJsonFile<Record<string, unknown>>(
    path.join(runDirectory, "audit", `${currentModule}.json`),
  ).catch(() => null);
  const correction = currentHandoff?.sourceRowCountCorrection;
  const controllerModule = controller.modules?.[currentModule];
  const repairsExactRowCount = Boolean(failedCurrent
    && currentHandoff
    && currentHandoff.module === currentModule
    && isValidJackyunSourceRowCountCorrection(correction, currentHandoff.expectedSourceRows)
    && controllerModule?.status === "handed_off"
    && path.resolve(String(controllerModule.filePath ?? "")) === path.resolve(currentHandoff.filePath)
    && Number(controllerModule.expectedSourceRows) === currentHandoff.expectedSourceRows
    && isExactFailedSourceRowCountRepair({
      runId: plan.runId,
      module: currentModule,
      filePath: currentHandoff.filePath,
      rawSha256: currentManifest?.sourceSha256 ?? "",
      expectedSourceRows: currentHandoff.expectedSourceRows,
      correction,
      priorModule: currentManifest as unknown as Record<string, unknown>,
      failedAudit,
    }));
  const resumesBeforeSideEffects = !failedCurrent
    && isSafePreExportBlockedResume(state, currentModule, controllerModule);
  if (!resumesBeforeSideEffects && !repairsExactRowCount) return false;

  for (let index = 0; index < completedPrefix; index += 1) {
    if (controller.modules?.[jackyunModuleOrder[index]!]?.status !== "completed") return false;
  }
  for (let index = completedPrefix + 1; index < jackyunModuleOrder.length; index += 1) {
    if (controller.modules?.[jackyunModuleOrder[index]!]) return false;
  }

  const eventFiles = (await readdir(path.join(paths.eventDirectory, plan.runId), { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  for (let index = completedPrefix; index < jackyunModuleOrder.length; index += 1) {
    const prefix = `${String(index + 1).padStart(2, "0")}-${jackyunModuleOrder[index]}`;
    const matching = eventFiles.filter((name) => name === prefix || name.startsWith(`${prefix}.`));
    if (repairsExactRowCount && index === completedPrefix) {
      if (matching.length !== 1 || matching[0] !== `${prefix}.json`) return false;
    } else if (matching.length) {
      return false;
    }
  }
  const auditFiles = (await readdir(path.join(runDirectory, "audit"), { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  for (const moduleKey of jackyunModuleOrder.slice(completedPrefix)) {
    const matching = auditFiles.filter((name) => name === `${moduleKey}.json` || name.startsWith(`${moduleKey}.`));
    if (repairsExactRowCount && moduleKey === currentModule) {
      if (matching.length !== 1 || matching[0] !== `${moduleKey}.json`) return false;
    } else if (matching.length) {
      return false;
    }
  }
  if (await stat(path.join(runDirectory, "daily-summary.json")).catch(() => null)) return false;
  return true;
}

export async function planJackyunN8nRun(options: PlanOptions = {}) {
  const paths = pathsFor(options.root);
  const now = options.now ?? new Date();
  const runDate = shanghaiDate(now, 0);
  const yesterday = shanghaiDate(now, -1);
  const baseUrl = normalizeJackyunLocalBaseUrl(options.baseUrl ?? process.env.OPERATIONS_SYSTEM_URL ?? "http://localhost:3000");
  const policy = await readPolicy(paths);
  const profileStatus = await getJackyunProfileStatus(options.profileDirectory, paths.root);
  if (profileStatus !== "ready") throw new Error("吉客云专用 Chrome profile 缺失或结构无效，请先执行 npm run jackyun:login");

  const request = options.request ?? fetch;
  const response = await request(`${baseUrl}/`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`本机运营系统不可用 (HTTP ${response.status})`);

  const existing = await findCompletedRun(paths, yesterday, policy.version!);
  const generatedAt = now.toISOString();
  const runId = existing?.runId ?? (options.runIdFactory ?? createJackyunN8nRunId)(now);
  if (!validRunId(runId)) throw new Error("吉客云 n8n 运行编号无效");

  if (!existing) {
    const unclosed = await findUnclosedPlan(paths, runDate);
    if (unclosed) {
      const samePlanIdentity = unclosed.runDate === runDate
        && unclosed.snapshotDate === yesterday
        && unclosed.asOfDate === yesterday
        && unclosed.baseUrl === baseUrl
        && unclosed.policyVersion === policy.version
        && validRunId(unclosed.runId);
      if (unclosed.stage === "planned" && !unclosed.skipped && samePlanIdentity) {
        return unclosed;
      }
      if (await isExactResumableFailedPlan(paths, unclosed, {
        runDate,
        asOfDate: yesterday,
        baseUrl,
        policyVersion: policy.version!,
      })) {
        unclosed.stage = "planned";
        unclosed.resume = true;
        delete unclosed.failure;
        await persistPlan(paths, unclosed);
        return unclosed;
      }
      throw new Error(`今日已有未闭环的吉客云 n8n 运行 ${unclosed.runId} (${unclosed.stage})；禁止自动新建运行，请先核验原 RUN_ID`);
    }
  }

  const plan: JackyunN8nPlan = {
    version: 1,
    runId,
    runDate,
    snapshotDate: yesterday,
    asOfDate: yesterday,
    generatedAt,
    updatedAt: generatedAt,
    baseUrl,
    policyVersion: policy.version!,
    stage: "planned",
    skipped: Boolean(existing),
    ...(existing ? { existingRunId: existing.runId } : {}),
  };
  await persistPlan(paths, plan);
  return plan;
}

export function publicJackyunPlan(plan: JackyunN8nPlan) {
  return {
    ok: true,
    stage: "plan",
    runId: plan.runId,
    runDate: plan.runDate,
    snapshotDate: plan.snapshotDate,
    asOfDate: plan.asOfDate,
    skipped: plan.skipped,
    resume: Boolean(plan.resume),
    moduleOrder: jackyunModuleOrder,
  };
}

export async function runJackyunN8nPlan(plan: JackyunN8nPlan, options: RunOptions = {}) {
  const paths = pathsFor(options.root);
  if (plan.version !== 1 || plan.stage !== "planned" || !validRunId(plan.runId)
    || !validDate(plan.snapshotDate) || plan.snapshotDate !== plan.asOfDate
    || plan.baseUrl !== normalizeJackyunLocalBaseUrl(plan.baseUrl)) {
    throw new Error("吉客云 n8n 计划格式或阶段无效");
  }
  if (plan.skipped) {
    plan.stage = "executed";
    await persistPlan(paths, plan);
    return { ok: true, stage: "run", runId: plan.runId, skipped: true, reason: "already_completed_today" };
  }

  plan.stage = "running";
  delete plan.failure;
  await persistPlan(paths, plan);
  try {
    const runAutomation = options.runAutomation ?? runJackyunAutomation;
    const result = await runAutomation({
      runId: plan.runId,
      snapshotDate: plan.snapshotDate,
      asOfDate: plan.asOfDate,
      eventDirectory: paths.eventDirectory,
      outputRoot: paths.outputRoot,
      baseUrl: plan.baseUrl,
      profileDirectory: options.profileDirectory,
      resume: Boolean(plan.resume),
      dryRun: false,
      headless: true,
      signal: options.signal,
    });
    if (result.browserResult.status !== "completed" || result.dailyResult.status !== "completed") {
      throw new Error("吉客云五类串行下载与导入未全部完成");
    }
    plan.stage = "executed";
    await persistPlan(paths, plan);
    return {
      ok: true,
      stage: "run",
      runId: plan.runId,
      skipped: false,
      completedModules: result.dailyResult.results.map((item) => item.module),
    };
  } catch (error) {
    plan.stage = "failed";
    plan.failure = { code: "JACKYUN_N8N_RUN_FAILED", message: safeError(error), at: new Date().toISOString() };
    await persistPlan(paths, plan);
    throw error;
  }
}

export async function verifyJackyunN8nPlan(plan: JackyunN8nPlan, options: VerifyOptions = {}) {
  const paths = pathsFor(options.root);
  if (plan.stage !== "executed" || !validRunId(plan.runId)) throw new Error("吉客云 n8n 运行尚未进入可核验阶段");
  try {
    const verified = await verifyRunArtifacts(paths, plan.existingRunId ?? plan.runId, plan.asOfDate, plan.policyVersion);
    await verifyPublishedJackyunBatches({
      baseUrl: plan.baseUrl,
      asOfDate: plan.asOfDate,
      modules: verified.modules,
      request: options.request,
    });
    plan.stage = "completed";
    await persistPlan(paths, plan);
    return {
      ok: true,
      stage: "verify",
      runId: plan.runId,
      verifiedRunId: plan.existingRunId ?? plan.runId,
      skipped: plan.skipped,
      asOfDate: plan.asOfDate,
      modules: verified.modules,
    };
  } catch (error) {
    plan.stage = "failed";
    plan.failure = { code: "JACKYUN_N8N_VERIFY_FAILED", message: safeError(error), at: new Date().toISOString() };
    await persistPlan(paths, plan);
    throw error;
  }
}
