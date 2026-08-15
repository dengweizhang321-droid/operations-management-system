import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getJdProfilesStatus } from "./jd-n8n-pipeline";
import {
  normalizeLocalBaseUrl,
  runJdPromotionExport,
  shanghaiYesterday,
  verifyJdPromotionPublishedBatch,
  type JdPromotionExportOptions,
  type JdPromotionExportResult,
} from "./jd-promotion-export";
import { inspectJdPromotionCsv } from "../lib/jd/promotion-report";
import { getJdStore, type JdStore } from "../lib/jd/store-registry";
import { readJsonFile, writeJsonAtomic } from "../lib/jackyun/json-file";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const planDirectoryName = "jd-promotion-n8n-pipeline";
export const jdPromotionStartDateHeader = "x-teruisi-jd-promotion-start-date";
export const jdPromotionEndDateHeader = "x-teruisi-jd-promotion-end-date";
export const jdPromotionStoreKeyHeader = "x-teruisi-jd-promotion-store-key";
export const jdPromotionStoreKeys = ["jd-yiyong-director", "jd-maidehao-operator1"] as const;
export type JdPromotionStoreKey = typeof jdPromotionStoreKeys[number];

export type JdPromotionN8nStage = "planned" | "running" | "executed" | "completed" | "failed";
export type JdPromotionHelperRoute = "/jd-promotion/plan" | "/jd-promotion/run" | "/jd-promotion/verify";

export type JdPromotionN8nPlan = {
  version: 1;
  runId: string;
  generatedAt: string;
  updatedAt: string;
  baseUrl: string;
  ownerExecutionId: string;
  store: { storeKey: string; shopId: string; shopName: string; accountLabel: string };
  startDate: string;
  endDate: string;
  stage: JdPromotionN8nStage;
  result?: JdPromotionExportResult;
  failure?: { code: string; stage: "plan" | "run" | "verify"; message: string; at: string };
};

type PlanOptions = {
  root?: string;
  now?: Date;
  baseUrl?: string;
  executionId: string;
  startDate?: string;
  endDate?: string;
  storeKey?: string;
  store?: JdStore;
  request?: typeof fetch;
  profileStatus?: (stores: readonly JdStore[]) => Promise<"ready" | "missing" | "invalid">;
  runIdFactory?: () => string;
};

type RunOptions = {
  root?: string;
  store?: JdStore;
  run?: (options: JdPromotionExportOptions) => Promise<JdPromotionExportResult>;
};

type VerifyOptions = { root?: string; store?: JdStore; request?: typeof fetch };

function pathsFor(root = projectRoot) {
  const resolved = path.resolve(root);
  return { root: resolved, planDirectory: path.join(resolved, "outputs", planDirectoryName) };
}

function validExecutionId(value: string | undefined) {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function validRunId(value: string) {
  return /^[A-Za-z0-9._-]{1,96}$/.test(value);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/(cookie|token|password|secret)\s*[=:]\s*\S+/gi, (_match, key: string) => `${key}=<redacted>`)
    .slice(0, 1_000);
}

function storeIdentity(store: JdStore) {
  return { storeKey: store.storeKey, shopId: store.shopId, shopName: store.shopName, accountLabel: store.accountLabel };
}

function sameStore(left: JdPromotionN8nPlan["store"], right: JdPromotionN8nPlan["store"]) {
  return left.storeKey === right.storeKey && left.shopId === right.shopId && left.shopName === right.shopName && left.accountLabel === right.accountLabel;
}

function planPath(root: string, runId: string) {
  if (!validRunId(runId)) throw new Error("京准通 n8n 运行编号无效");
  return path.join(root, `plan-${runId}.json`);
}

async function persistPlan(directory: string, plan: JdPromotionN8nPlan) {
  plan.updatedAt = new Date().toISOString();
  await writeJsonAtomic(planPath(directory, plan.runId), plan);
}

async function findPriorPlan(directory: string, input: Pick<JdPromotionN8nPlan, "baseUrl" | "startDate" | "endDate" | "store">) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const plans = await Promise.all(entries.filter((entry) => entry.isFile() && /^plan-[A-Za-z0-9._-]+\.json$/.test(entry.name))
    .map((entry) => readJsonFile<JdPromotionN8nPlan>(path.join(directory, entry.name)).catch(() => null)));
  return plans.filter((plan): plan is JdPromotionN8nPlan => Boolean(plan))
    .filter((plan) => plan.version === 1 && plan.baseUrl === input.baseUrl && plan.startDate === input.startDate && plan.endDate === input.endDate && sameStore(plan.store, input.store))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export function parseJdPromotionDateHeader(value: string | string[] | undefined) {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !validDate(value)) throw new Error("京准通 n8n 日期请求头无效");
  return value;
}

export function parseJdPromotionStoreKeyHeader(value: string | string[] | undefined): JdPromotionStoreKey {
  if (typeof value !== "string" || !jdPromotionStoreKeys.includes(value as JdPromotionStoreKey)) {
    throw new Error("京准通 n8n 店铺请求头无效或不在推广工作流白名单");
  }
  return value as JdPromotionStoreKey;
}

export function jdPromotionHelperRequestError(
  stage: "ready" | JdPromotionN8nStage,
  busy: boolean,
  route: JdPromotionHelperRoute,
  requestExecutionId: string | null,
  claimedExecutionId: string | null,
) {
  if (!requestExecutionId) return { error: "missing_or_invalid_execution_id" as const };
  if (claimedExecutionId && requestExecutionId !== claimedExecutionId) return { error: "execution_mismatch" as const };
  if (!claimedExecutionId && route !== "/jd-promotion/plan") return { error: "execution_not_claimed" as const, expected: "/jd-promotion/plan" as const };
  if (busy) return { error: "pipeline_busy" as const };
  if (route === "/jd-promotion/plan") return stage === "ready" ? null : { error: "invalid_stage" as const, expected: "ready", actual: stage };
  const expected = route === "/jd-promotion/run" ? "planned" : "executed";
  return stage === expected ? null : { error: "invalid_stage" as const, expected, actual: stage };
}

export async function planJdPromotionN8nRun(options: PlanOptions) {
  if (!validExecutionId(options.executionId)) throw new Error("京准通 n8n execution ID 无效");
  const paths = pathsFor(options.root);
  if (options.store && options.storeKey && options.store.storeKey !== options.storeKey) {
    throw new Error("京准通工作流店铺对象与受控请求头不一致");
  }
  const requestedStoreKey = parseJdPromotionStoreKeyHeader(options.storeKey ?? options.store?.storeKey);
  const store = options.store ?? await getJdStore(requestedStoreKey);
  if (!store.enabled || store.storeKey !== requestedStoreKey) throw new Error("京准通工作流店铺未启用或与受控请求头不一致");
  const yesterday = shanghaiYesterday(options.now ?? new Date());
  const startDate = options.startDate ?? yesterday;
  const endDate = options.endDate ?? startDate;
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate || startDate.slice(0, 7) !== endDate.slice(0, 7)) {
    throw new Error("京准通 n8n 计划要求同一自然月内的有效起止日期");
  }
  const baseUrl = normalizeLocalBaseUrl(options.baseUrl ?? process.env.OPERATIONS_SYSTEM_URL ?? "http://localhost:3000");
  const profiles = await (options.profileStatus ?? getJdProfilesStatus)([store]);
  if (profiles !== "ready") throw new Error(`京准通受控 Chromium 或 ${store.browser.profileName} 缺失、结构无效`);
  const response = await (options.request ?? fetch)(`${baseUrl}/`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`本机运营系统不可用 (HTTP ${response.status})`);
  await mkdir(paths.planDirectory, { recursive: true });
  const identity = storeIdentity(store);
  const prior = await findPriorPlan(paths.planDirectory, { baseUrl, startDate, endDate, store: identity });
  if (prior && (prior.ownerExecutionId === options.executionId || prior.stage !== "completed")) {
    if (prior.stage === "running" && prior.ownerExecutionId !== options.executionId) throw new Error("京准通同范围已有执行中的 n8n 运行，拒绝跨执行接管");
    prior.ownerExecutionId = options.executionId;
    if (prior.stage === "failed") prior.stage = prior.failure?.stage === "verify" ? "executed" : "planned";
    delete prior.failure;
    await persistPlan(paths.planDirectory, prior);
    return prior;
  }
  const plan: JdPromotionN8nPlan = {
    version: 1,
    runId: options.runIdFactory?.() ?? `jd-promotion-n8n-${randomUUID()}`,
    generatedAt: (options.now ?? new Date()).toISOString(),
    updatedAt: (options.now ?? new Date()).toISOString(),
    baseUrl,
    ownerExecutionId: options.executionId,
    store: identity,
    startDate,
    endDate,
    stage: "planned",
  };
  if (!validRunId(plan.runId)) throw new Error("京准通 n8n 运行编号无效");
  await persistPlan(paths.planDirectory, plan);
  return plan;
}

export function publicJdPromotionPlan(plan: JdPromotionN8nPlan) {
  return { ok: true, stage: "plan", runId: plan.runId, storeKey: plan.store.storeKey, startDate: plan.startDate, endDate: plan.endDate, verificationOnly: plan.stage === "executed" || plan.stage === "completed" };
}

export async function runJdPromotionN8nPlan(plan: JdPromotionN8nPlan, options: RunOptions = {}) {
  const paths = pathsFor(options.root);
  if (plan.stage === "executed" || plan.stage === "completed") return { ok: true, stage: "run", runId: plan.runId, verificationOnly: true };
  if (plan.stage !== "planned" || !validExecutionId(plan.ownerExecutionId) || !validRunId(plan.runId)) throw new Error("京准通 n8n 计划尚未进入可执行阶段或格式无效");
  const store = options.store ?? await getJdStore(plan.store.storeKey);
  if (!sameStore(plan.store, storeIdentity(store))) throw new Error("京准通店铺注册表身份已变化，拒绝用旧计划执行");
  plan.stage = "running";
  delete plan.failure;
  await persistPlan(paths.planDirectory, plan);
  try {
    plan.result = await (options.run ?? runJdPromotionExport)({
      storeKey: store.storeKey,
      startDate: plan.startDate,
      endDate: plan.endDate,
      baseUrl: plan.baseUrl,
      runId: plan.runId,
      visibleRecovery: false,
      interactiveLogin: false,
    });
    if (!plan.result.ok || plan.result.storeKey !== store.storeKey || plan.result.shopName !== store.shopName
      || plan.result.startDate !== plan.startDate || plan.result.endDate !== plan.endDate
      || plan.result.importResult.warningCount !== 0 || plan.result.importResult.rowCount !== plan.result.rowCount) {
      throw new Error("京准通 runner 未返回完整下载、导入和落库证明");
    }
    plan.stage = "executed";
    await persistPlan(paths.planDirectory, plan);
    return { ok: true, stage: "run", runId: plan.runId, verificationOnly: false, rowCount: plan.result.rowCount, batchId: plan.result.importResult.batchId };
  } catch (error) {
    plan.stage = "failed";
    plan.failure = { code: "JD_PROMOTION_N8N_RUN_FAILED", stage: "run", message: safeError(error), at: new Date().toISOString() };
    await persistPlan(paths.planDirectory, plan);
    throw error;
  }
}

export async function verifyJdPromotionN8nPlan(plan: JdPromotionN8nPlan, options: VerifyOptions = {}) {
  const paths = pathsFor(options.root);
  if ((plan.stage !== "executed" && plan.stage !== "completed") || !plan.result) throw new Error("京准通 n8n 运行尚未进入可核验阶段");
  const store = options.store ?? await getJdStore(plan.store.storeKey);
  if (!sameStore(plan.store, storeIdentity(store))) throw new Error("京准通 C 节点店铺身份与计划不一致");
  try {
    const bytes = new Uint8Array(await readFile(plan.result.savedPath));
    const inspection = inspectJdPromotionCsv(bytes, plan.startDate, plan.endDate);
    if (inspection.sha256 !== plan.result.sha256 || inspection.rowCount !== plan.result.rowCount
      || inspection.accountNicknames.join("\u001f") !== plan.result.accountNicknames.join("\u001f")) {
      throw new Error("京准通 C 节点重验的文件哈希、行数或账户集合与 B 节点不一致");
    }
    await verifyJdPromotionPublishedBatch({
      storeKey: store.storeKey,
      startDate: plan.startDate,
      endDate: plan.endDate,
      baseUrl: plan.baseUrl,
      runId: plan.runId,
      visibleRecovery: false,
      interactiveLogin: false,
    }, store, plan.result.importResult, options.request ?? fetch);
    plan.stage = "completed";
    await persistPlan(paths.planDirectory, plan);
    return { ok: true, stage: "verify", runId: plan.runId, startDate: plan.startDate, endDate: plan.endDate, rowCount: plan.result.rowCount, batchId: plan.result.importResult.batchId };
  } catch (error) {
    plan.stage = "failed";
    plan.failure = { code: "JD_PROMOTION_N8N_VERIFY_FAILED", stage: "verify", message: safeError(error), at: new Date().toISOString() };
    await persistPlan(paths.planDirectory, plan);
    throw error;
  }
}
