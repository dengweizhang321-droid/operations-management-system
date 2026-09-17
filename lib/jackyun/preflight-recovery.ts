import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { jackyunCaptureDate, jackyunExportFirstPolicyVersion } from "./run-contract";

export const jackyunWorkflowId = "J8kY2mQ5vR7sT4pN";
const failedNode = "1·分仓库存：筛选并导出所有页";
const expectedNodes = ["手动运行", "领取共享 helper", "helper 领取成功？", "A·固定采集日和销售日期", failedNode];
const loginFailure = "inventory 导出未完成：login_unknown";
const queryFailure = "TABLE_TIMEOUT [query_refresh]: inventory 未观测到本轮查询触发的包含目标日期 缺失 的模块网络请求完成；拒绝把旧表格当作新结果。";
const legacyMenuFailure = "未找到当前模块唯一的导出所有页菜单。";
// Audited historical exception, not a rule for arbitrary export_armed runs.
// In this exact deployed controller the named error is thrown only after
// menu lookup expires, before entering its final clickText branch. The old
// exportIntent was written too early, before right-click/menu preparation.
const audited843 = {
  executionId: "843", releaseId: "20260906T113045Z-e1a943dd272d5547",
  controllerSourceSha256: "8d64fafc73e815c94b7aa0f56020b2314b8dd3754a829863c5f15eedf4fb7677",
  executionDataSha256: "c72519e3ce9fca4069e28c3c309531744ffd3c1629727ff8ef87327802badb54",
  planSha256: "f7f871b06decd6aecde7becae70434d155d0d4b6a240428920b2b48bf3c36f59",
  controllerSha256: "fdfa4f7d58ba9517222c750aa45c20a8ee09760180358db8b639a7277ca2a56e",
} as const;
// Exact reviewed 897 failure: waitForModuleControls throws while state is
// navigated, before warehouse selection, querying or the final export POST.
const audited897 = {
  releaseId: "20260908T023322Z-d783739f19e43a9d",
  controllerSourceSha256: "35d006f60461f9ce7f8b6fcd4d224f10fd973202a88dd2c5c5bd84e9543dadae",
  planSha256: "4e64b64820dcc43faca1997df86ea363dc50a9bf99eedad7b94efd4d0256aeb7",
  controllerSha256: "17579899de469c2ecf4e57dc1eac895d436434a0f1b51e7a0d20ad3d71c7c28f",
  evidence: {
    executionId: "897", workflowId: jackyunWorkflowId, status: "error",
    startedAt: "2026-09-08T03:51:42.636Z", stoppedAt: "2026-09-08T03:52:12.107Z", retrySuccessId: null,
    lastNode: "B·网页校验后 HTTP 导出五表",
    runNodes: ["手动运行", "领取共享 helper", "helper 领取成功？", "A·固定采集日和销售日期", "B·网页校验后 HTTP 导出五表"],
    error: "模块页面控件尚未就绪：branch_stock_main / warehouseCom", httpCode: "500",
    requestUrl: "http://127.0.0.1:5791/jackyun/export-first/export-all",
    executionDataSha256: "87b51149300402e7dfbb642244985b1bc2beb13ff3d16f8c9b7f89d53d99c586", activeExecutions: 0,
  },
} as const;
export const recoverySha = (raw: string | Uint8Array) => createHash("sha256").update(raw).digest("hex");
// Audited 2621: session initialization failed before runApiExports entered its
// execute callback. No beforeModule intent, controller or downloaded file exists.
const audited2621 = {
  planSha256: "aaf9ffe080605d152213aab8e3225fc4b164fbd1d0f92c8ff2a31fa38d694b7c",
  evidence: {
    executionId: "2621", workflowId: jackyunWorkflowId, status: "error",
    startedAt: "2026-09-16T16:10:01.909Z", stoppedAt: "2026-09-16T16:10:12.384Z", retrySuccessId: null,
    lastNode: "B·接口校验与五表下载",
    runNodes: ["每天本机时间 00:10", "领取共享 helper", "helper 领取成功？", "A·固定采集日和销售日期", "B·接口校验与五表下载"],
    error: "waiting_login：吉客云 DPAPI 凭据配置或解密未完成（initialize）。", httpCode: "500",
    requestUrl: "http://127.0.0.1:5791/jackyun/export-first/export-all",
    executionDataSha256: "27aac9dd30454319f2158b7b9428549e026762f9701c9a0d98c9b6e71064f24f", activeExecutions: 0,
  },
} as const;
const apiDownloadNode = "B·接口校验与五表下载";
const apiLoginChallengeFailure = "waiting_login：吉客云登录已停止（challenge_present）。";
const apiPlanTriggers = new Set(["手动运行", "每天本机时间 00:10", "失败后每小时安全完整重跑"]);
export type PreflightEvidence = {
  executionId: string; workflowId: string; status: string; startedAt: string; stoppedAt: string;
  lastNode: string; runNodes: string[]; error: string; httpCode: string; requestUrl: string;
  executionDataSha256: string; activeExecutions: number; retrySuccessId: string | null;
};
type EmptyPlan = { version: number; protocol: string; executionId: string; runId: string; runDate: string;
  asOfDate: string; baseUrl: string; createdAt: string; phase: string; exports: Record<string, unknown>; exportIntent: string };
export type PreflightClosure = {
  version: 1; status: "closed_before_business" | "closed_before_export"; executionId: string; runId: string; closedAt: string;
  root: string; downloadDirectory: string; policySha256: string; planSha256: string; activeSha256: string;
  evidence: PreflightEvidence; absentPaths: string[];
  reason: "verified_login_failure_without_business_effects" | "verified_api_login_challenge_without_business_effects" | "verified_query_failure_before_export_intent" | "audited_843_menu_lookup_before_export_click" | "audited_897_controls_before_query_and_export" | "audited_2621_dpapi_before_api_exports";
  controllerEvidence?: { path: string; sha256: string };
  historicalCodeEvidence?: { releaseId: string; controllerSourceSha256: string };
};
const canonical = (value: unknown): string => JSON.stringify(value);
export function preflightClosurePath(root: string, executionId: string) {
  if (!/^[1-9]\d{0,19}$/.test(executionId)) throw new Error("恢复 execution ID 无效。");
  return path.join(root, "outputs", "jackyun-export-first", "preflight-closures", `n8n-export-first-${executionId}.json`);
}
async function assertEntityPath(target: string, allowMissing = false) {
  const absolute = path.resolve(target);
  const parent = path.dirname(absolute);
  if (parent !== absolute) await assertEntityPath(parent);
  try {
    const info = await lstat(absolute);
    if (info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))
      || path.resolve(await realpath(absolute)).toLowerCase() !== absolute.toLowerCase()) throw new Error("恢复路径身份异常。");
    return info;
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function readRegular(target: string) {
  if (!(await assertEntityPath(target))?.isFile()) throw new Error("恢复证据不是普通文件。");
  const raw = await readFile(target);
  if (raw.length > 64 * 1024) throw new Error("恢复证据超过大小限制。");
  return raw;
}
function parse<T>(raw: Uint8Array): T { return JSON.parse(Buffer.from(raw).toString("utf8").replace(/^\uFEFF/, "")) as T; }
function assertEvidence(e: PreflightEvidence, plan: EmptyPlan) {
  if (e.executionId !== plan.executionId || e.workflowId !== jackyunWorkflowId || e.status !== "error"
    || e.retrySuccessId !== null || e.activeExecutions !== 0 || e.lastNode !== failedNode
    || !isDeepStrictEqual(e.runNodes, expectedNodes) || e.httpCode !== "500"
    || (e.error !== loginFailure && e.error !== queryFailure && e.error !== legacyMenuFailure)
    || e.requestUrl !== "http://127.0.0.1:5791/jackyun/export-first/export/inventory"
    || !/^[a-f0-9]{64}$/.test(e.executionDataSha256)
    || !Number.isFinite(Date.parse(e.startedAt)) || !Number.isFinite(Date.parse(e.stoppedAt))
    || Date.parse(e.startedAt) > Date.parse(plan.createdAt) || Date.parse(e.stoppedAt) < Date.parse(plan.createdAt)) {
    throw new Error("仅允许核实的首个库存节点登录或指定查询验证失败，禁止恢复导出点击未决或已进入后续阶段的运行。");
  }
}
async function inspectAudited843(directory: string, planRaw: Uint8Array, evidence: PreflightEvidence) {
  if (evidence.executionId !== audited843.executionId || evidence.executionDataSha256 !== audited843.executionDataSha256
    || evidence.startedAt !== "2026-09-06T11:37:04.545Z" || evidence.stoppedAt !== "2026-09-06T11:37:26.934Z"
    || recoverySha(planRaw) !== audited843.planSha256 || !(await assertEntityPath(directory))?.isDirectory()
    || !isDeepStrictEqual((await readdir(directory)).sort(), ["browser-controller-state.json"])) {
    throw new Error("该运行不属于已审计的 843 菜单查找失败，禁止闭合导出意图。");
  }
  const target = path.join(directory, "browser-controller-state.json"), raw = await readRegular(target);
  if (recoverySha(raw) !== audited843.controllerSha256) throw new Error("843 原控制状态已变化，禁止闭合。");
  return { path: target, sha256: recoverySha(raw) };
}
async function inspectQueryFailure(directory: string, plan: EmptyPlan, evidence: PreflightEvidence) {
  if (!(await assertEntityPath(directory))?.isDirectory()
    || !isDeepStrictEqual((await readdir(directory)).sort(), ["browser-controller-state.json"])) {
    throw new Error("查询失败目录只能保留唯一控制状态，禁止含有导出或导入文件。");
  }
  const target = path.join(directory, "browser-controller-state.json"), raw = await readRegular(target);
  const state = parse<Record<string, unknown>>(raw);
  const exactKeys = (value: unknown, keys: string[]): value is Record<string, unknown> => value !== null
    && typeof value === "object" && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
  if (!exactKeys(state, ["version", "runId", "policyVersion", "updatedAt", "modules"])
    || state.version !== 1 || state.runId !== plan.runId || state.policyVersion !== plan.protocol
    || !exactKeys(state.modules, ["inventory"])) throw new Error("查询失败控制身份不匹配。");
  const inventory = state.modules.inventory;
  if (!exactKeys(inventory, ["status", "navigationIntentAt", "timings", "fieldChecks", "queryIntentAt", "tableReadbackFailure"])
    || inventory.status !== "queried" || !exactKeys(inventory.timings, ["enterModuleMs"])
    || !Number.isFinite(inventory.timings.enterModuleMs) || Number(inventory.timings.enterModuleMs) < 0
    || !exactKeys(inventory.tableReadbackFailure, ["code", "observedAt"]) || inventory.tableReadbackFailure.code !== "table_timeout"
    || !Array.isArray(inventory.fieldChecks) || inventory.fieldChecks.length !== 1
    || !exactKeys(inventory.fieldChecks[0], ["field", "value", "verifiedAt"])
    || inventory.fieldChecks[0].field !== "仓库" || !/^已勾选:[1-9]\d*条$/.test(String(inventory.fieldChecks[0].value))) {
    throw new Error("控制状态不能证明在导出意图之前停止。");
  }
  const times = [evidence.startedAt, plan.createdAt, inventory.navigationIntentAt, inventory.fieldChecks[0].verifiedAt,
    inventory.queryIntentAt, inventory.tableReadbackFailure.observedAt, state.updatedAt, evidence.stoppedAt].map(value => Date.parse(String(value)));
  if (times.some((time, index) => !Number.isFinite(time) || (index > 0 && time < times[index - 1]))) {
    throw new Error("查询失败时间证据顺序不成立。");
  }
  return { path: target, sha256: recoverySha(raw) };
}
function assertEmptyPlan(plan: EmptyPlan, executionId: string) {
  const date = new Date(`${plan.runDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 1);
  if (plan.version !== 1 || plan.protocol !== jackyunExportFirstPolicyVersion || plan.executionId !== executionId
    || plan.runId !== `n8n-export-first-${executionId}` || plan.phase !== "exporting" || plan.exportIntent !== "inventory"
    || !plan.exports || Array.isArray(plan.exports) || Object.keys(plan.exports).length !== 0
    || Object.keys(plan).some(key => !["version", "protocol", "executionId", "runId", "runDate", "asOfDate", "baseUrl", "createdAt", "phase", "exports", "exportIntent"].includes(key))
    || plan.baseUrl !== "http://localhost:3000" || plan.runDate !== jackyunCaptureDate(plan.createdAt)
    || plan.asOfDate !== date.toISOString().slice(0, 10)) throw new Error("原计划不属于无业务结果的首次登录失败。");
}
function assertEmptyApiChallengePlan(plan: EmptyPlan & { exportTransport?: string }, executionId: string, evidence: PreflightEvidence) {
  const date = new Date(`${plan.runDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 1);
  const expectedRunNodes = [evidence.runNodes[0], "领取共享 helper", "helper 领取成功？", "A·固定采集日和销售日期", apiDownloadNode];
  if (plan.version !== 1 || plan.protocol !== jackyunExportFirstPolicyVersion || plan.executionId !== executionId
    || plan.runId !== `n8n-export-first-${executionId}` || plan.phase !== "exporting" || plan.exportTransport !== "session_api_v1"
    || !plan.exports || Array.isArray(plan.exports) || Object.keys(plan.exports).length !== 0
    || Object.prototype.hasOwnProperty.call(plan, "exportIntent")
    || Object.keys(plan).some(key => !["version", "protocol", "executionId", "runId", "runDate", "asOfDate", "baseUrl", "createdAt", "phase", "exports", "exportTransport"].includes(key))
    || plan.baseUrl !== "http://localhost:3000" || plan.runDate !== jackyunCaptureDate(plan.createdAt)
    || plan.asOfDate !== date.toISOString().slice(0, 10)
    || evidence.executionId !== executionId || evidence.workflowId !== jackyunWorkflowId || evidence.status !== "error"
    || evidence.retrySuccessId !== null || evidence.activeExecutions !== 0 || evidence.lastNode !== apiDownloadNode
    || !apiPlanTriggers.has(evidence.runNodes[0] ?? "") || !isDeepStrictEqual(evidence.runNodes, expectedRunNodes)
    || evidence.error !== apiLoginChallengeFailure || evidence.httpCode !== "500"
    || evidence.requestUrl !== "http://127.0.0.1:5791/jackyun/export-first/export-all"
    || !/^[a-f0-9]{64}$/.test(evidence.executionDataSha256)
    || !Number.isFinite(Date.parse(evidence.startedAt)) || !Number.isFinite(Date.parse(evidence.stoppedAt))
    || Date.parse(evidence.startedAt) > Date.parse(plan.createdAt) || Date.parse(evidence.stoppedAt) < Date.parse(plan.createdAt)) {
    throw new Error("仅允许闭合 API 五表下载前、没有导出意图或业务产物的精确登录安全验证失败。");
  }
}
function effectPaths(root: string, downloadDirectory: string, runId: string) {
  return [path.join(root, "outputs", "jackyun-browser-events", runId),
    path.join(root, "outputs", "jackyun-import-runs", runId),
    path.join(root, "outputs", "jackyun-export-first-validation", runId), path.join(downloadDirectory, "jackyun", runId)];
}
async function assertAbsentEffects(targets: string[]) {
  for (const target of targets) {
    // Existing ancestors must be real entities. Missing ancestors are also
    // evidence of absence, never an excuse to follow a junction elsewhere.
    let ancestor = path.resolve(target);
    while (true) {
      try { await lstat(ancestor); break; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const parent = path.dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent;
      }
    }
    await assertEntityPath(ancestor);
    try { await lstat(target); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    throw new Error("原运行已存在浏览器、下载、演练或导入证据，禁止按无业务操作闭合。");
  }
}
export async function inspectPreflightClosure(root: string, executionId: string, evidence: PreflightEvidence, closedAt: string): Promise<PreflightClosure> {
  preflightClosurePath(root, executionId);
  root = path.resolve(root);
  const directory = path.join(root, "outputs", "jackyun-export-first");
  const planRaw = await readRegular(path.join(directory, `n8n-export-first-${executionId}.json`));
  const activeRaw = await readRegular(path.join(directory, "active.json"));
  const policyRaw = await readRegular(path.join(root, "config", "jackyun-export-first-policy.json"));
  const plan = parse<EmptyPlan>(planRaw), active = parse<{ runId: string; executionId: string }>(activeRaw);
  const policy = parse<{ version: string; browser: { downloadDirectory: string } }>(policyRaw);
  const controlsOnly = executionId === "897";
  const apiLoginOnly = executionId === "2621";
  const apiChallengeOnly = (plan as EmptyPlan & { exportTransport?: string }).exportTransport === "session_api_v1"
    && evidence.error === apiLoginChallengeFailure;
  if (apiLoginOnly) {
    if (recoverySha(planRaw) !== audited2621.planSha256 || !isDeepStrictEqual(evidence, audited2621.evidence)) throw new Error("2621 原失败运行身份或证据已变化。");
  } else if (controlsOnly) {
    if (recoverySha(planRaw) !== audited897.planSha256 || !isDeepStrictEqual(evidence, audited897.evidence)) throw new Error("897 原失败运行身份或证据已变化。");
  } else if (apiChallengeOnly) assertEmptyApiChallengePlan(plan, executionId, evidence);
  else { assertEmptyPlan(plan, executionId); assertEvidence(evidence, plan); }
  if (!isDeepStrictEqual(active, { runId: plan.runId, executionId }) || policy.version !== plan.protocol
    || !path.isAbsolute(policy.browser.downloadDirectory) || !Number.isFinite(Date.parse(closedAt))
    || Date.parse(closedAt) < Date.parse(evidence.stoppedAt)) throw new Error("活动运行、策略或恢复时间不一致。");
  const effects = effectPaths(root, policy.browser.downloadDirectory, plan.runId);
  const queryOnly = evidence.error === queryFailure;
  const legacyMenuOnly = evidence.error === legacyMenuFailure;
  let controllerEvidence = queryOnly ? await inspectQueryFailure(effects[1], plan, evidence)
    : legacyMenuOnly ? await inspectAudited843(effects[1], planRaw, evidence) : undefined;
  if (controlsOnly) {
    if (!(await assertEntityPath(effects[1]))?.isDirectory() || !isDeepStrictEqual((await readdir(effects[1])).sort(), ["browser-controller-state.json"])) throw new Error("897 存在额外运行文件，拒绝闭合。");
    const target = path.join(effects[1], "browser-controller-state.json"), raw = await readRegular(target);
    if (recoverySha(raw) !== audited897.controllerSha256) throw new Error("897 原控制状态已变化。");
    controllerEvidence = { path: target, sha256: recoverySha(raw) };
  }
  const absentPaths = queryOnly || legacyMenuOnly || controlsOnly ? effects.filter((_, index) => index !== 1) : effects;
  await assertAbsentEffects(absentPaths);
  if (apiLoginOnly) return { version: 1, status: "closed_before_business", executionId, runId: plan.runId, closedAt, root,
    downloadDirectory: policy.browser.downloadDirectory, policySha256: recoverySha(policyRaw), planSha256: recoverySha(planRaw),
    activeSha256: recoverySha(activeRaw), evidence, absentPaths, reason: "audited_2621_dpapi_before_api_exports" };
  if (controlsOnly) return { version: 1, status: "closed_before_export", executionId, runId: plan.runId, closedAt, root,
    downloadDirectory: policy.browser.downloadDirectory, policySha256: recoverySha(policyRaw), planSha256: recoverySha(planRaw),
    activeSha256: recoverySha(activeRaw), evidence, absentPaths, reason: "audited_897_controls_before_query_and_export", controllerEvidence,
    historicalCodeEvidence: { releaseId: audited897.releaseId, controllerSourceSha256: audited897.controllerSourceSha256 } };
  if (apiChallengeOnly) return { version: 1, status: "closed_before_business", executionId, runId: plan.runId, closedAt, root,
    downloadDirectory: policy.browser.downloadDirectory, policySha256: recoverySha(policyRaw), planSha256: recoverySha(planRaw),
    activeSha256: recoverySha(activeRaw), evidence, absentPaths, reason: "verified_api_login_challenge_without_business_effects" };
  if (legacyMenuOnly) return { version: 1, status: "closed_before_export", executionId, runId: plan.runId, closedAt, root,
    downloadDirectory: policy.browser.downloadDirectory, policySha256: recoverySha(policyRaw), planSha256: recoverySha(planRaw),
    activeSha256: recoverySha(activeRaw), evidence, absentPaths, reason: "audited_843_menu_lookup_before_export_click", controllerEvidence,
    historicalCodeEvidence: { releaseId: audited843.releaseId, controllerSourceSha256: audited843.controllerSourceSha256 } };
  if (queryOnly) return { version: 1, status: "closed_before_export", executionId, runId: plan.runId, closedAt, root,
    downloadDirectory: policy.browser.downloadDirectory, policySha256: recoverySha(policyRaw), planSha256: recoverySha(planRaw),
    activeSha256: recoverySha(activeRaw), evidence, absentPaths, reason: "verified_query_failure_before_export_intent", controllerEvidence };
  return { version: 1, status: "closed_before_business", executionId, runId: plan.runId, closedAt, root,
    downloadDirectory: policy.browser.downloadDirectory, policySha256: recoverySha(policyRaw), planSha256: recoverySha(planRaw),
    activeSha256: recoverySha(activeRaw), evidence, absentPaths, reason: "verified_login_failure_without_business_effects" };
}
export async function publishPreflightClosure(root: string, approved: PreflightClosure, freshEvidence: PreflightEvidence, expectedSha256: string) {
  if (recoverySha(canonical(approved)) !== expectedSha256) throw new Error("恢复计划摘要未获精确匹配。");
  const actual = await inspectPreflightClosure(root, approved.executionId, freshEvidence, approved.closedAt);
  if (!isDeepStrictEqual(actual, approved)) throw new Error("恢复证据已变化，拒绝使用旧批准计划。");
  const target = preflightClosurePath(root, approved.executionId);
  await mkdir(path.dirname(target), { recursive: true }); await assertEntityPath(path.dirname(target));
  // Original plan and active pointer stay byte-for-byte intact. Only the next
  // complete n8n execution may advance the active pointer under its run lock.
  await writeFile(target, `${canonical(approved)}\n`, { encoding: "utf8", flag: "wx" });
  return { status: approved.status, runId: approved.runId, closureSha256: recoverySha(await readRegular(target)) };
}
export async function assertClosedPreflight(root: string, executionId: string) {
  const raw = await readRegular(preflightClosurePath(root, executionId));
  const receipt = parse<PreflightClosure>(raw);
  const loginClosed = receipt.status === "closed_before_business" && receipt.reason === "verified_login_failure_without_business_effects";
  const apiChallengeClosed = receipt.status === "closed_before_business" && receipt.reason === "verified_api_login_challenge_without_business_effects";
  const queryClosed = receipt.status === "closed_before_export" && receipt.reason === "verified_query_failure_before_export_intent";
  const menuClosed = receipt.status === "closed_before_export" && receipt.reason === "audited_843_menu_lookup_before_export_click";
  const controlsClosed = receipt.status === "closed_before_export" && receipt.reason === "audited_897_controls_before_query_and_export";
  const apiLoginClosed = receipt.status === "closed_before_business" && receipt.reason === "audited_2621_dpapi_before_api_exports";
  if (receipt.version !== 1 || receipt.executionId !== executionId || (!loginClosed && !apiChallengeClosed && !queryClosed && !menuClosed && !controlsClosed && !apiLoginClosed)) {
    throw new Error("原运行未持有有效的导出前失败闭合证据。");
  }
  const actual = await inspectPreflightClosure(root, executionId, receipt.evidence, receipt.closedAt);
  if (!isDeepStrictEqual(actual, receipt)) throw new Error("原运行的闭合证据已变化。");
}
