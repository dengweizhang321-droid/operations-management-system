import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJsonFile, writeJsonAtomic } from "../lib/jackyun/json-file";
import { loadJdStores, type JdStore } from "../lib/jd/store-registry";
import {
  auditCounts,
  runMultiStore,
  shanghaiDefaultRange,
  validateStepResult,
  type AuditItem,
  type RunnerAudit,
} from "./jd-multi-store-runner";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const planDirectoryName = "jd-n8n-pipeline";

export type JdN8nStage = "planned" | "running" | "executed" | "completed" | "failed";
export type JdHelperRoute = "/jd/plan" | "/jd/run" | "/jd/verify";
export type JdProfileStatus = "ready" | "missing" | "invalid";

export type JdN8nPlan = {
  version: 1;
  runId: string;
  generatedAt: string;
  updatedAt: string;
  baseUrl: string;
  startDate: string;
  endDate: string;
  ownerExecutionId: string;
  storeKeys: string[];
  stores: Array<{ storeKey: string; shopId: string; shopName: string }>;
  silentNoWindow?: boolean;
  stage: JdN8nStage;
  runnerAuditPath?: string;
  failure?: { code: string; stage: "plan" | "run" | "verify"; message: string; at: string };
};

type RuntimePaths = { root: string; planDirectory: string };
type PlanOptions = {
  root?: string;
  now?: Date;
  baseUrl?: string;
  stores?: JdStore[];
  request?: typeof fetch;
  runIdFactory?: () => string;
  profileStatus?: (stores: readonly JdStore[]) => Promise<JdProfileStatus>;
  executionId: string;
  silentNoWindow?: boolean;
};
type RunOptions = {
  root?: string;
  run?: typeof runMultiStore;
  stores?: JdStore[];
};
type VerifyOptions = { root?: string; stores?: JdStore[]; request?: typeof fetch };

function pathsFor(root = projectRoot): RuntimePaths {
  const resolvedRoot = path.resolve(root);
  return { root: resolvedRoot, planDirectory: path.join(resolvedRoot, "outputs", planDirectoryName) };
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function validRunId(value: string) {
  return /^[A-Za-z0-9._-]{1,96}$/.test(value);
}

function validExecutionId(value: string | undefined) {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function storeIdentity(stores: readonly JdStore[]) {
  return stores.map((store) => ({ storeKey: store.storeKey, shopId: store.shopId, shopName: store.shopName }));
}

function sameStoreIdentity(left: readonly { storeKey: string; shopId: string; shopName: string }[], right: readonly { storeKey: string; shopId: string; shopName: string }[]) {
  return left.length === right.length && left.every((store, index) => store.storeKey === right[index]?.storeKey
    && store.shopId === right[index]?.shopId && store.shopName === right[index]?.shopName);
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/(cookie|token|password|secret)\s*[=:]\s*\S+/gi, (_match, key: string) => `${key}=<redacted>`)
    .slice(0, 1_000);
}

export function normalizeJdLocalBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)
    || (url.pathname !== "/" && url.pathname !== "") || url.username || url.password) {
    throw new Error("京东 n8n 工作流只允许连接本机运营系统根地址");
  }
  return url.toString().replace(/\/$/, "");
}

export function createJdN8nRunId() {
  return `jd-n8n-${randomUUID()}`;
}

export function jdHelperRequestError(
  stage: "ready" | JdN8nStage,
  busy: boolean,
  route: JdHelperRoute,
  requestExecutionId: string | null,
  claimedExecutionId: string | null,
) {
  if (!requestExecutionId) return { error: "missing_or_invalid_execution_id" as const };
  if (claimedExecutionId && requestExecutionId !== claimedExecutionId) return { error: "execution_mismatch" as const };
  if (!claimedExecutionId && route !== "/jd/plan") return { error: "execution_not_claimed" as const, expected: "/jd/plan" as const };
  if (busy) return { error: "pipeline_busy" as const };
  if (route === "/jd/plan") {
    return stage === "ready" ? null : { error: "invalid_stage" as const, expected: "ready", actual: stage };
  }
  const expected = route === "/jd/run" ? "planned" : "executed";
  return stage === expected ? null : { error: "invalid_stage" as const, expected, actual: stage };
}

export async function getJdProfilesStatus(stores: readonly JdStore[]): Promise<JdProfileStatus> {
  if (!stores.length) return "missing";
  const statuses = await Promise.all(stores.map(async (store) => {
    const [executable, userData, profile, localState] = await Promise.all([
      stat(store.browser.executablePath).catch(() => null),
      stat(store.browser.userDataDir).catch(() => null),
      stat(store.browser.profileDir).catch(() => null),
      stat(path.join(store.browser.userDataDir, "Local State")).catch(() => null),
    ]);
    if (!executable || !userData || !profile || !localState) return "missing" as const;
    return executable.isFile() && userData.isDirectory() && profile.isDirectory() && localState.isFile()
      ? "ready" as const
      : "invalid" as const;
  }));
  return statuses.includes("invalid") ? "invalid" : statuses.includes("missing") ? "missing" : "ready";
}

function planPath(paths: RuntimePaths, runId: string) {
  if (!validRunId(runId)) throw new Error("京东 n8n 运行编号无效");
  return path.join(paths.planDirectory, `plan-${runId}.json`);
}

function runnerAuditPath(paths: RuntimePaths, value: string) {
  const directory = path.join(paths.root, "outputs", "jd-multi-store-runner");
  const resolved = path.resolve(value);
  const relative = path.relative(directory, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !/^run-\d+\.json$/.test(path.basename(resolved))) {
    throw new Error("京东 runner 审计路径不属于受控输出目录");
  }
  return resolved;
}

async function persistPlan(paths: RuntimePaths, plan: JdN8nPlan) {
  plan.updatedAt = new Date().toISOString();
  await writeJsonAtomic(planPath(paths, plan.runId), plan);
}

async function findPlanForRange(paths: RuntimePaths, identity: Pick<JdN8nPlan, "baseUrl" | "startDate" | "endDate" | "stores"> & { silentNoWindow: boolean }) {
  const entries = await readdir(paths.planDirectory, { withFileTypes: true }).catch(() => []);
  const plans = await Promise.all(entries.filter((entry) => entry.isFile() && /^plan-[A-Za-z0-9._-]+\.json$/.test(entry.name))
    .map((entry) => readJsonFile<JdN8nPlan>(path.join(paths.planDirectory, entry.name)).catch(() => null)));
  return plans.filter((plan): plan is JdN8nPlan => Boolean(plan))
    .filter((plan) => plan.version === 1 && plan.baseUrl === identity.baseUrl && plan.startDate === identity.startDate && plan.endDate === identity.endDate
      && Boolean(plan.silentNoWindow) === identity.silentNoWindow
      && Array.isArray(plan.stores) && sameStoreIdentity(plan.stores, identity.stores))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export async function planJdN8nRun(options: PlanOptions) {
  const paths = pathsFor(options.root);
  const now = options.now ?? new Date();
  const baseUrl = normalizeJdLocalBaseUrl(options.baseUrl ?? process.env.OPERATIONS_SYSTEM_URL ?? "http://localhost:3000");
  const range = shanghaiDefaultRange(now);
  const executionId = options.executionId;
  if (!validExecutionId(executionId)) throw new Error("京东 n8n execution ID 无效");
  const stores = (options.stores ?? await loadJdStores()).filter((store) => store.enabled);
  if (!stores.length) throw new Error("没有启用的京东店铺注册项，拒绝启动工作流");
  const profiles = await (options.profileStatus ?? getJdProfilesStatus)(stores);
  if (profiles !== "ready") throw new Error("京东店铺受控 Chromium 或对应 profile 缺失、结构无效；请先恢复对应店铺会话");
  const response = await (options.request ?? fetch)(`${baseUrl}/`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`本机运营系统不可用 (HTTP ${response.status})`);
  await mkdir(paths.planDirectory, { recursive: true });
  const storesIdentity = storeIdentity(stores);
  const silentNoWindow = options.silentNoWindow === true;
  const prior = await findPlanForRange(paths, { baseUrl, ...range, stores: storesIdentity, silentNoWindow });
  if (prior) {
    if (!validExecutionId(prior.ownerExecutionId)) throw new Error("京东 n8n 既有计划缺少有效执行所有者");
    if (prior.ownerExecutionId !== executionId && prior.stage === "completed") {
      // A later manual/scheduled execution must perform a fresh export so new
      // store SKUs can enter the system; only the original execution is idempotent.
    } else {
      if (prior.stage === "running") {
        throw new Error(`当前范围已有执行中的京东 n8n 运行 ${prior.runId}；拒绝跨执行接管`);
      }
      if (prior.ownerExecutionId !== executionId) prior.ownerExecutionId = executionId;
      if (prior.stage === "failed" && prior.failure?.stage === "verify") {
        prior.stage = "executed";
      } else if (prior.stage === "failed") {
        prior.stage = "planned";
      }
      delete prior.failure;
      await persistPlan(paths, prior);
      return prior;
    }
  }
  const plan: JdN8nPlan = {
    version: 1,
    runId: options.runIdFactory?.() ?? createJdN8nRunId(),
    generatedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    baseUrl,
    startDate: range.startDate,
    endDate: range.endDate,
    ownerExecutionId: executionId,
    storeKeys: stores.map((store) => store.storeKey),
    stores: storesIdentity,
    silentNoWindow,
    stage: "planned",
  };
  if (!validRunId(plan.runId)) throw new Error("京东 n8n 运行编号无效");
  await persistPlan(paths, plan);
  return plan;
}

export function publicJdPlan(plan: JdN8nPlan) {
  return {
    ok: true,
    stage: "plan",
    runId: plan.runId,
    startDate: plan.startDate,
    endDate: plan.endDate,
    storeCount: plan.storeKeys.length,
    verificationOnly: plan.stage === "executed" || plan.stage === "completed",
    silentNoWindow: Boolean(plan.silentNoWindow),
  };
}

export async function runJdN8nPlan(plan: JdN8nPlan, options: RunOptions = {}) {
  const paths = pathsFor(options.root);
  if (plan.version !== 1 || !validRunId(plan.runId) || !validDate(plan.startDate) || !validDate(plan.endDate)
    || plan.startDate > plan.endDate || plan.baseUrl !== normalizeJdLocalBaseUrl(plan.baseUrl)
    || !validExecutionId(plan.ownerExecutionId) || !Array.isArray(plan.stores)
    || (plan.silentNoWindow !== undefined && typeof plan.silentNoWindow !== "boolean")
    || plan.stores.some((store) => !store.storeKey || !store.shopId || !store.shopName)
    || plan.storeKeys.length !== plan.stores.length || plan.storeKeys.some((storeKey, index) => storeKey !== plan.stores[index]?.storeKey)) {
    throw new Error("京东 n8n 计划格式无效");
  }
  if (plan.stage === "executed" || plan.stage === "completed") {
    return { ok: true, stage: "run", runId: plan.runId, verificationOnly: true };
  }
  if (plan.stage !== "planned") throw new Error("京东 n8n 计划尚未进入可执行阶段");
  const stores = (options.stores ?? await loadJdStores()).filter((store) => store.enabled);
  if (!sameStoreIdentity(plan.stores, storeIdentity(stores)) || plan.storeKeys.length !== stores.length
    || plan.storeKeys.some((storeKey, index) => storeKey !== stores[index]?.storeKey)) {
    throw new Error("京东店铺注册表身份或顺序已变化，拒绝用旧计划执行");
  }
  plan.stage = "running";
  delete plan.failure;
  await persistPlan(paths, plan);
  try {
    const result = await (options.run ?? runMultiStore)({
      mode: "all", startDate: plan.startDate, endDate: plan.endDate, storeKey: undefined, dryRun: false,
      silentNoWindow: Boolean(plan.silentNoWindow),
      baseUrl: plan.baseUrl,
      ...(plan.runnerAuditPath ? { resumeAuditPath: runnerAuditPath(paths, plan.runnerAuditPath) } : {}),
    }, stores);
    plan.runnerAuditPath = result.auditPath;
    const counts = auditCounts(result.audit.items);
    if (!result.ok || counts.failed !== 0 || counts.completed !== result.audit.items.length) {
      throw new Error("京东多店铺 runner 未完成全部店铺和数据集");
    }
    plan.stage = "executed";
    await persistPlan(paths, plan);
    return { ok: true, stage: "run", runId: plan.runId, verificationOnly: false, storeCount: plan.storeKeys.length };
  } catch (error) {
    plan.stage = "failed";
    plan.failure = { code: "JD_N8N_RUN_FAILED", stage: "run", message: safeError(error), at: new Date().toISOString() };
    await persistPlan(paths, plan);
    throw error;
  }
}

export async function verifyJdN8nPlan(plan: JdN8nPlan, options: VerifyOptions = {}) {
  const paths = pathsFor(options.root);
  if ((plan.stage !== "executed" && plan.stage !== "completed") || !plan.runnerAuditPath) {
    throw new Error("京东 n8n 运行尚未进入可核验阶段");
  }
  try {
    const audit = await readJsonFile<RunnerAudit>(runnerAuditPath(paths, plan.runnerAuditPath));
    const stores = (options.stores ?? await loadJdStores()).filter((store) => plan.storeKeys.includes(store.storeKey));
    if (!sameStoreIdentity(plan.stores, storeIdentity(stores)) || stores.length !== plan.storeKeys.length
      || audit.baseUrl !== plan.baseUrl || audit.mode !== "all" || audit.dryRun || audit.startDate !== plan.startDate || audit.endDate !== plan.endDate
      || Boolean(audit.silentNoWindow) !== Boolean(plan.silentNoWindow)
      || audit.storeKeys.length !== plan.storeKeys.length || audit.storeKeys.some((storeKey, index) => storeKey !== plan.storeKeys[index])) {
      throw new Error("京东 runner 审计的店铺、地址、模式或日期范围不匹配");
    }
    const expectedSteps = ["jd_product_master", "jd_sku_daily", "spu_daily"] as const;
    if (audit.items.length !== stores.length * expectedSteps.length || auditCounts(audit.items).completed !== audit.items.length) {
      throw new Error("京东 runner 审计不是完整成功集合");
    }
    for (const [storeIndex, store] of stores.entries()) {
      for (const [stepIndex, step] of expectedSteps.entries()) {
        const item = audit.items[storeIndex * expectedSteps.length + stepIndex];
        if (!item || item.storeKey !== store.storeKey || item.shopName !== store.shopName || item.step !== step || item.status !== "completed"
          || !item.batchId || typeof item.rowCount !== "number" || !item.importResult) {
          throw new Error(`京东 ${store.storeKey}/${step} 审计缺少完成批次或导入证据`);
        }
        const invalid = validateStepResult(step, { importResult: item.importResult }, store, { startDate: plan.startDate, endDate: plan.endDate });
        if (invalid) throw new Error(`京东 ${store.storeKey}/${step} 导入复核失败: ${invalid}`);
        await verifyPublishedBatch({
          baseUrl: plan.baseUrl,
          store,
          step,
          item,
          startDate: plan.startDate,
          endDate: plan.endDate,
          request: options.request ?? fetch,
        });
      }
    }
    plan.stage = "completed";
    await persistPlan(paths, plan);
    return { ok: true, stage: "verify", runId: plan.runId, startDate: plan.startDate, endDate: plan.endDate, stores: stores.map((store) => store.storeKey) };
  } catch (error) {
    plan.stage = "failed";
    plan.failure = { code: "JD_N8N_VERIFY_FAILED", stage: "verify", message: safeError(error), at: new Date().toISOString() };
    await persistPlan(paths, plan);
    throw error;
  }
}

async function verifyPublishedBatch({
  baseUrl,
  store,
  step,
  item,
  startDate,
  endDate,
  request,
}: {
  baseUrl: string;
  store: JdStore;
  step: "jd_product_master" | "jd_sku_daily" | "spu_daily";
  item: AuditItem;
  startDate: string;
  endDate: string;
  request: typeof fetch;
}) {
  const source = step === "jd_product_master" ? "jd_product_master" : "jd_sku_daily";
  const params = new URLSearchParams({ limit: "1", batchId: item.batchId!, source, platform: "京东", shop: store.shopName });
  const response = await request(`${baseUrl}/api/netshop/import?${params}`, { signal: AbortSignal.timeout(30_000) });
  const payload = await response.json().catch(() => null) as { items?: unknown } | null;
  const batches = Array.isArray(payload?.items) ? payload.items : [];
  if (!response.ok || batches.length !== 1 || !batches[0] || typeof batches[0] !== "object") {
    throw new Error(`京东 ${store.storeKey}/${step} 无法读取精确导入批次`);
  }
  const batch = batches[0] as Record<string, unknown>;
  const dataset = step === "jd_product_master" ? "product_master" : step === "jd_sku_daily" ? "sku_daily" : "spu_daily";
  if (batch.id !== item.batchId || batch.status !== "completed" || batch.source !== source || batch.dataset !== dataset
    || batch.platform !== "京东" || batch.shopName !== store.shopName || batch.warningCount !== 0 || batch.rowCount !== item.rowCount
    || (step !== "jd_product_master" && (batch.dateMin !== startDate || batch.dateMax !== endDate))) {
    throw new Error(`京东 ${store.storeKey}/${step} 已发布批次与审计不一致`);
  }
}
