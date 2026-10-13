import { lstat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { readJsonDurableOr as readJsonFileOr, writeJsonDurable } from "./json-file";
import { controlDigest } from "./recovery-control";
import { importRecoveryQuery, importRecoveryScope } from "./publication-baseline";
import type { JackyunModule } from "./post-download";

type ImportIdentity = { moduleKey: JackyunModule; runId: string; runDate: string; asOfDate: string; salesStartDate?: string;
  fileName: string; fileSizeBytes: number; rawFileHash: string; fingerprint: string };
type ImportCheckpoint = { version: "jackyun-import-checkpoint-v1"; identity: ImportIdentity; identityDigest: string;
  stage: "uploading" | "complete_intent" | "committed"; uploadId: string | null; batchId: string | null };
/** A checkpoint is a local POST intent/reference, not another business fact.
 * Reconciliation always reads the domain audit before resuming a failed POST. */
export async function coordinateWorkbookImport(options: {
  checkpointPath: string; module: JackyunModule; runId: string; runDate: string; asOfDate: string; salesStartDate?: string;
  fileName: string; fileSizeBytes: number; rawFileHash: string; fingerprint: string; baseUrl: string; isRecovery: boolean;
  assertOwned: () => Promise<void>; request?: typeof fetch;
  perform: (beforeComplete: (uploadId: string) => Promise<void>) => Promise<Record<string, unknown>>;
}): Promise<Record<string, unknown>> {
  await options.assertOwned();
  const { module: moduleKey, runId, runDate, asOfDate, salesStartDate, fileName, fileSizeBytes, rawFileHash, fingerprint } = options;
  const identity = { moduleKey, runId, runDate, asOfDate, ...(salesStartDate === undefined ? {} : { salesStartDate }), fileName, fileSizeBytes, rawFileHash, fingerprint };
  const identityDigest = controlDigest(identity);
  const info = await lstat(options.checkpointPath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 8192)) throw new Error("导入请求记录身份异常，需要人工核查。");
  let prior = await readJsonFileOr<ImportCheckpoint | null>(options.checkpointPath, null);
  if (prior && (prior.version !== "jackyun-import-checkpoint-v1" || prior.identityDigest !== identityDigest
    || controlDigest(prior.identity) !== identityDigest
    || !["uploading", "complete_intent", "committed"].includes(prior.stage)
    || prior.stage !== "uploading" && (!prior.uploadId || typeof prior.uploadId !== "string"))) throw new Error("原上传或文件身份变化，禁止覆盖导入记录。");
  const request = options.request ?? fetch;
  const query = importRecoveryQuery(moduleKey, options, "result");
  query.set("fileName", fileName); query.set("fileSizeBytes", String(fileSizeBytes)); query.set("rawFileHash", rawFileHash);
  const storedFingerprint = moduleKey === "inventory" || moduleKey === "inventory_age"
    ? `inventory:${moduleKey === "inventory" ? "stock" : "age"}:${runDate}:${fingerprint}`
    : moduleKey === "products" || moduleKey === "combos" ? `erp:${moduleKey}:${fingerprint}` : fingerprint;
  query.set("fingerprint", storedFingerprint);
  if (prior?.uploadId) query.set("uploadId", prior.uploadId.replace(/^inventory-age:/, ""));
  if (prior || options.isRecovery) {
    await options.assertOwned();
    const response = await request(`${options.baseUrl}/api/imports/recovery?${query}`, { cache: "no-store", signal: AbortSignal.timeout(30000) });
    const result = await response.json() as { ok?: boolean; version?: string; status?: string; scope?: unknown; batch?: Record<string, unknown>; uploadId?: string };
    await options.assertOwned();
    if (!response.ok || result.ok !== true || result.version !== "import-recovery-query-v1"
      || !isDeepStrictEqual(result.scope, importRecoveryScope(moduleKey, options))) throw new Error("导入结果查询未通过精确文件和范围核验，需要人工核查。");
    if (result.status === "waiting") throw new Error("JACKYUN_IMPORT_PROCESSING_WAIT");
    if (result.status === "committed_superseded") throw new Error("JACKYUN_RESULT_SUPERSEDED_MANUAL_ACTION：原文件历史导入成功，但已被后续批次替代；禁止旧数据重新覆盖，请核查当前批次。");
    if (result.status === "committed_current" && result.batch) {
      const finalized = await request(`${options.baseUrl}/api/imports/recovery/finish`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: query.toString() }), signal: AbortSignal.timeout(120000) });
      const body = await finalized.json() as Record<string, unknown>;
      await options.assertOwned();
      if (body.code === "adjunct_pending") throw new Error("JACKYUN_IMPORT_PROCESSING_WAIT");
      if (!finalized.ok || body.ok !== true || (body.batch as Record<string, unknown>)?.id !== result.batch.id) throw new Error("原批次已提交，附属处理或当前有效性核验尚未完成；保留原文件并等待。");
      return body;
    }
    if (result.status !== "uncommitted_upload" || !result.uploadId || prior?.stage === "committed" || prior?.uploadId && prior.uploadId !== result.uploadId) {
      throw new Error("JACKYUN_IMPORT_RESULT_MANUAL_ACTION：原提交结果无法确认，缺少精确持久审计或上传会话；禁止再次提交，请核查原请求。");
    }
  }
  prior = { version: "jackyun-import-checkpoint-v1", identity, identityDigest, stage: "uploading", uploadId: prior?.uploadId ?? null, batchId: null };
  await options.assertOwned(); await writeJsonDurable(options.checkpointPath, prior);
  const response = await options.perform(async uploadId => {
    await options.assertOwned();
    if (prior?.uploadId && prior.uploadId !== uploadId) throw new Error("原上传会话已丢失，禁止建立新的未决提交。");
    prior = { ...prior!, stage: "complete_intent", uploadId };
    await writeJsonDurable(options.checkpointPath, prior); await options.assertOwned();
  });
  await options.assertOwned();
  const batchId = (response.batch as Record<string, unknown>)?.id;
  if (typeof batchId !== "string" || !batchId) throw new Error("导入返回缺少精确批次，保留原提交未决状态。");
  await writeJsonDurable(options.checkpointPath, { ...prior, stage: "committed", batchId });
  if (moduleKey === "products" && (response.newProductLearning as { status?: string } | undefined)?.status === "deferred") {
    return verifyRecordedWorkbookPublication({ checkpointPath: options.checkpointPath, module: moduleKey, runId,
      outputSha256: rawFileHash, baseUrl: options.baseUrl, assertOwned: options.assertOwned });
  }
  return response;
}

export async function verifyRecordedWorkbookPublication(options: { checkpointPath: string; module: JackyunModule; runId: string;
  outputSha256: string; baseUrl: string; assertOwned: () => Promise<void> }) {
  const checkpoint = await readJsonFileOr<ImportCheckpoint | null>(options.checkpointPath, null);
  const identity = checkpoint?.identity;
  if (!identity || checkpoint?.version !== "jackyun-import-checkpoint-v1" || identity.moduleKey !== options.module || identity.runId !== options.runId
    || identity.rawFileHash !== options.outputSha256 || checkpoint.identityDigest !== controlDigest(identity)) throw new Error("原成功模块缺少精确发布身份，禁止猜测最近批次。");
  return coordinateWorkbookImport({ ...identity, module: identity.moduleKey, checkpointPath: options.checkpointPath,
    isRecovery: true, baseUrl: options.baseUrl, assertOwned: options.assertOwned,
    perform: async () => { throw new Error("已成功模块禁止再次发布。"); } });
}
