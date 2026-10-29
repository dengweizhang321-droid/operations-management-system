import path from "node:path";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { controlDigest } from "./recovery-control";
import { validJackyunCloseIdentity, type JackyunCloseIdentity } from "./operator-close-contract";

export const closeDirectory = (root: string, logical: string) => {
  if (!/^[1-9]\d{0,19}$/.test(logical)) throw new Error("闭合任务编号无效。");
  return path.join(root, "outputs/jackyun-export-first/operator-closures", logical);
};
export function closeRecord(file: string) {
  for (let cursor = path.dirname(file); ; cursor = path.dirname(cursor)) {
    try { const s = lstatSync(cursor); if (!s.isDirectory() || s.isSymbolicLink()) throw new Error("闭合索引目录身份异常。"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
    if (path.dirname(cursor) === cursor) break;
  }
  let info; try { info = lstatSync(file); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 512 * 1024) throw new Error("闭合记录身份异常。");
  return JSON.parse(readFileSync(file, "utf8"));
}
export type CloseIntent = { version: "jackyun-operator-close-intent-v1"; authorizationId: string; target: JackyunCloseIdentity;
  authority: Record<string, unknown>; activeBytes: string; files: Record<string, string>; modules: { module: string; status: string; batchId?: string }[]; at: string };
export function readCloseIntent(root: string, logical: string): CloseIntent | null {
  const value = closeRecord(path.join(closeDirectory(root, logical), "intent.json")) as CloseIntent | null;
  if (value && (value.version !== "jackyun-operator-close-intent-v1" || !validJackyunCloseIdentity(value.target) || value.target.logicalExecutionId !== logical
    || !/^[a-f0-9-]{36}$/.test(value.authorizationId) || controlDigest(JSON.parse(value.activeBytes)) !== value.target.activeDigest)) throw new Error("原闭合预约不完整，需要核查原记录。");
  return value;
}
export function closedIndex(root: string) {
  const dir = path.join(root, "outputs/jackyun-export-first/operator-closures");
  let names: string[]; try { names = readdirSync(dir); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  if (names.length > 4096 || names.some(n => !/^[1-9]\d{0,19}$/.test(n))) throw new Error("闭合索引无法安全核验。");
  return names.map(n => {
    const intent = readCloseIntent(root, n);
    if (!intent) throw new Error("闭合存在未决持久边界，请核查原请求。");
    const done = closeRecord(path.join(closeDirectory(root, n), "closed.json"));
    if (done && (done.version !== "jackyun-operator-closed-v1" || done.intentDigest !== controlDigest(intent) || done.authorizationId !== intent.authorizationId)) throw new Error("闭合完成回执不完整。");
    return { intent, done };
  });
}
/** Intent is the permanent deny boundary, including interrupted closes. */
export function assertNoOperatorClosure(root: string, ids: string[]) {
  for (const { intent, done } of closedIndex(root)) if (!done || ids.some(id => [intent.target.logicalExecutionId, intent.target.sourceExecutionId, intent.target.failedExecutionId].includes(id))) {
    throw new Error("JACKYUN_OPERATOR_CLOSED：旧任务已进入人工闭合，禁止恢复、派发或重放。");
  }
  for (const id of ids) {
    if (!/^[1-9]\d{0,19}$/.test(id)) throw new Error("闭合门禁任务编号无效。");
    const legacy = closeRecord(path.join(root, "outputs/jackyun-export-first/preflight-closures", `n8n-export-first-${id}.json`));
    if (legacy?.status === "operator_closed_partial") throw new Error("JACKYUN_OPERATOR_CLOSED：原任务已人工闭合，禁止重放。");
  }
}
export function readClosedRecoveryTarget(root: string, logical?: string) {
  const all = closedIndex(root).filter(v => !logical || v.intent.target.logicalExecutionId === logical);
  if (!all.length) {
    // Compatibility for the one-time operator close, whose real deny receipt
    // predates the regular index. Never upgrade its partial outcome to success.
    const dir = path.join(root, "outputs/jackyun-export-first/preflight-closures");
    let names: string[]; try { names = readdirSync(dir); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
    if (names.length > 4096) throw new Error("历史闭合索引超过上限。");
    const retired = names.flatMap(name => {
      const match = /^n8n-export-first-([1-9]\d{0,19})\.json$/.exec(name);
      if (!match || logical && match[1] !== logical) return [];
      const value = closeRecord(path.join(dir, name));
      if (value?.version !== "jackyun-operator-partial-retirement-v1" || value.status !== "operator_closed_partial") return [];
      if (value.executionId !== match[1] || value.runId !== `n8n-export-first-${match[1]}` || value.completedClaim !== false || value.zeroEffectClaim !== false
        || value.publishedBusinessDataPreserved !== true || !/^[a-f0-9]{64}$/.test(value.snapshotDigest)) throw new Error("历史人工闭合回执不完整。");
      return [match[1]];
    }).sort((a, b) => BigInt(a) < BigInt(b) ? 1 : -1);
    if (!retired.length) return null;
    if (!logical) assertNoNewerUnindexedPlan(root, retired[0]);
    return { ok: true as const, state: "closed", newCollectionAllowed: true, logicalExecutionId: retired[0], failedExecutionId: retired[0], sourceExecutionId: retired[0],
      freshRestartAllowed: false, freshRestartReason: "原任务已人工闭合，部分导入数据保持。可手动开始新的完整采集。" };
  }
  const item = all.sort((a, b) => BigInt(a.intent.target.logicalExecutionId) < BigInt(b.intent.target.logicalExecutionId) ? 1 : -1)[0];
  if (!logical && item.done) assertNoNewerUnindexedPlan(root, item.intent.target.failedExecutionId);
  return { ok: true as const, state: item.done ? "closed" : "closing", newCollectionAllowed: !!item.done,
    logicalExecutionId: item.intent.target.logicalExecutionId, failedExecutionId: item.intent.target.failedExecutionId,
    sourceExecutionId: item.intent.target.sourceExecutionId, freshRestartAllowed: false,
    freshRestartReason: item.done ? "原任务已闭合，已导入数据保留。可手动开始新的完整采集。" : "原任务正在闭合，请继续协调同一闭合请求。" };
}
function assertNoNewerUnindexedPlan(root: string, through: string) {
  const dir = path.join(root, "outputs/jackyun-export-first"), names = readdirSync(dir);
  if (names.length > 16384) throw new Error("原计划索引超过上限。");
  if (names.some(name => { const match = /^n8n-export-first-([1-9]\d{0,19})\.json$/.exec(name); return match && BigInt(match[1]) > BigInt(through); })) {
    throw new Error("闭合后存在更新的原计划但活动索引缺失，请核查该次任务。");
  }
}
