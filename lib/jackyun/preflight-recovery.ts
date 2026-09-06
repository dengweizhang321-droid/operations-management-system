import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { jackyunCaptureDate, jackyunExportFirstPolicyVersion } from "./run-contract";

export const jackyunWorkflowId = "J8kY2mQ5vR7sT4pN";
const failedNode = "1·分仓库存：筛选并导出所有页";
const expectedNodes = ["手动运行", "领取共享 helper", "helper 领取成功？", "A·固定采集日和销售日期", failedNode];
export const recoverySha = (raw: string | Uint8Array) => createHash("sha256").update(raw).digest("hex");
export type PreflightEvidence = {
  executionId: string; workflowId: string; status: string; startedAt: string; stoppedAt: string;
  lastNode: string; runNodes: string[]; error: string; httpCode: string; requestUrl: string;
  executionDataSha256: string; activeExecutions: number; retrySuccessId: string | null;
};
type EmptyPlan = { version: number; protocol: string; executionId: string; runId: string; runDate: string;
  asOfDate: string; baseUrl: string; createdAt: string; phase: string; exports: Record<string, unknown>; exportIntent: string };
export type PreflightClosure = {
  version: 1; status: "closed_before_business"; executionId: string; runId: string; closedAt: string;
  root: string; downloadDirectory: string; policySha256: string; planSha256: string; activeSha256: string;
  evidence: PreflightEvidence; absentPaths: string[]; reason: "verified_login_failure_without_business_effects";
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
    || e.error !== "inventory 导出未完成：login_unknown"
    || e.requestUrl !== "http://127.0.0.1:5791/jackyun/export-first/export/inventory"
    || !/^[a-f0-9]{64}$/.test(e.executionDataSha256)
    || !Number.isFinite(Date.parse(e.startedAt)) || !Number.isFinite(Date.parse(e.stoppedAt))
    || Date.parse(e.startedAt) > Date.parse(plan.createdAt) || Date.parse(e.stoppedAt) < Date.parse(plan.createdAt)) {
    throw new Error("仅允许核实的首个库存节点登录失败，禁止恢复业务点击未决或已进入后续阶段的运行。");
  }
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
  assertEmptyPlan(plan, executionId); assertEvidence(evidence, plan);
  if (!isDeepStrictEqual(active, { runId: plan.runId, executionId }) || policy.version !== plan.protocol
    || !path.isAbsolute(policy.browser.downloadDirectory) || !Number.isFinite(Date.parse(closedAt))
    || Date.parse(closedAt) < Date.parse(evidence.stoppedAt)) throw new Error("活动运行、策略或恢复时间不一致。");
  const absentPaths = effectPaths(root, policy.browser.downloadDirectory, plan.runId);
  await assertAbsentEffects(absentPaths);
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
  return { status: "closed_before_business", runId: approved.runId, closureSha256: recoverySha(await readRegular(target)) };
}
export async function assertClosedPreflight(root: string, executionId: string) {
  const raw = await readRegular(preflightClosurePath(root, executionId));
  const receipt = parse<PreflightClosure>(raw);
  if (receipt.version !== 1 || receipt.status !== "closed_before_business" || receipt.executionId !== executionId
    || receipt.reason !== "verified_login_failure_without_business_effects") throw new Error("原运行未持有有效的登录前失败闭合证据。");
  const actual = await inspectPreflightClosure(root, executionId, receipt.evidence, receipt.closedAt);
  if (!isDeepStrictEqual(actual, receipt)) throw new Error("原运行的闭合证据已变化。");
}
