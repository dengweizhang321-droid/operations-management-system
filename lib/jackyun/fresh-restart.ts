import path from "node:path";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readJsonDurableOr, writeJsonDurable } from "./json-file";
import { controlDigest, readRecoveryControl, appendRecoveryControl } from "./recovery-control";
import { collectionPublicationBaseline, importRecoveryQuery, importRecoveryScope, recoveryUploadFingerprint } from "./publication-baseline";
import { jackyunModuleOrder } from "./post-download";
import { jackyunExportOrder } from "./run-contract";
import { verifyJackyunModuleArtifact } from "./run-artifact-verification";
import { readN8nFreshRestartEvidence } from "./n8n-preflight-evidence";
import type { BoundHumanAuthority } from "./human-retry";
import type { JackyunExportFirstPlan } from "../../tools/jackyun-export-first-pipeline";

export type FreshRestartTarget = { logicalExecutionId: string; failedExecutionId: string; sourceExecutionId: string;
  sourceDigest: string; controlDigest: string; activeDigest: string };
const exact = (v: object, keys: string[]) => Object.keys(v).sort().join() === [...keys].sort().join();
const id = (v: unknown): v is string => typeof v === "string" && /^[1-9]\d{0,19}$/.test(v);
const sha = (v: Uint8Array | string) => createHash("sha256").update(v).digest("hex");
export function validFreshRestartTarget(v: unknown): v is FreshRestartTarget {
  if (!v || typeof v !== "object" || Array.isArray(v) || !exact(v, ["logicalExecutionId", "failedExecutionId", "sourceExecutionId", "sourceDigest", "controlDigest", "activeDigest"])) return false;
  const t = v as FreshRestartTarget;
  return [t.logicalExecutionId, t.failedExecutionId, t.sourceExecutionId].every(id)
    && BigInt(t.logicalExecutionId) <= BigInt(t.sourceExecutionId) && BigInt(t.sourceExecutionId) <= BigInt(t.failedExecutionId)
    && [t.sourceDigest, t.controlDigest, t.activeDigest].every(h => typeof h === "string" && /^[a-f0-9]{64}$/.test(h));
}
const base = (root: string) => path.join(root, "outputs/jackyun-export-first");
const directory = (root: string, logical: string) => path.join(base(root), "fresh-restarts", logical);
type Reservation = { version: "jackyun-fresh-restart-v1"; target: FreshRestartTarget; authorityDigest: string;
  authorizationId: string; successorId: string; plan: JackyunExportFirstPlan; proof: RestartProof; digest: string };
type RestartProof = { target: FreshRestartTarget; activeBytes: string; files: Record<string, string>; evidence: ReturnType<typeof readN8nFreshRestartEvidence>; results: unknown[] };
function syncRecord(file: string) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 512 * 1024) throw new Error("从头采集记录身份异常。");
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Reservation already freezes the predecessor. A crash or malformed record
 * never permits its old A-E, file repair, reclaim or dispatch to proceed. */
export function assertNoFreshRestart(root: string, ids: string[]) {
  const dir = path.join(base(root), "fresh-restarts");
  for (let cursor = dir; ; cursor = path.dirname(cursor)) {
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error("从头采集索引路径异常。"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    if (path.dirname(cursor) === cursor) break;
  }
  let names: string[];
  try { names = readdirSync(dir); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
  if (names.length > 4096 || names.some(n => !id(n))) throw new Error("从头采集索引存在未决证据，需要人工协调。");
  for (const logical of names) {
    const folder = path.join(dir, logical), info = lstatSync(folder);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("从头采集记录目录异常。");
    const entries = readdirSync(folder);
    if (!entries.includes("reservation.json") || entries.some(n => !["reservation.json", "superseded.json", "activated.json"].includes(n))) throw new Error("从头采集存在未决持久边界，需要协调原 successor。");
    const value = syncRecord(path.join(folder, "reservation.json")) as Reservation, { digest, ...payload } = value;
    if (value.version !== "jackyun-fresh-restart-v1" || !validFreshRestartTarget(value.target) || value.target.logicalExecutionId !== logical || !id(value.successorId)
      || digest !== controlDigest(payload)) throw new Error("从头采集预约摘要无效。");
    if (entries.includes("activated.json")) {
      const activated = syncRecord(path.join(folder, "activated.json"));
      if (!entries.includes("superseded.json") || activated.version !== "jackyun-fresh-activated-v1" || activated.reservationDigest !== digest) throw new Error("从头采集激活回执不完整。");
    }
    if (entries.includes("superseded.json")) {
      const seal = syncRecord(path.join(folder, "superseded.json"));
      if (seal.version !== "jackyun-fresh-superseded-v1" || seal.reservationDigest !== digest || seal.successorId !== value.successorId
        || seal.oldActiveBytes !== value.proof.activeBytes || !isDeepStrictEqual(seal.target, value.target)
        || !/^[a-f0-9]{64}$/.test(seal.baselineDigest)) throw new Error("从头采集永久封禁回执不完整。");
    }
    if (ids.some(candidate => [logical, value.target.sourceExecutionId, value.target.failedExecutionId].includes(candidate))) throw new Error("JACKYUN_SUPERSEDED_MANUAL_ACTION：旧运行已冻结并由新的完整采集替代，禁止恢复、重放或派发旧运行。");
    if (!entries.includes("activated.json") && !ids.includes(value.successorId)) throw new Error("从头采集预约尚未协调完成，只能由原 successor 完成 A；禁止新 ID 绕过。");
  }
}

export async function assertFreshRestartSuccessor(root: string, executionId: string, bound?: BoundHumanAuthority) {
  const dir = path.join(base(root), "fresh-restarts"), names = await readdir(dir).catch(error => { if (error.code === "ENOENT") return []; throw error; });
  for (const name of names) {
    const reservation = await readJsonDurableOr<Reservation | null>(path.join(dir, name, "reservation.json"), null);
    if (reservation?.successorId !== executionId) continue;
    if (!bound || bound.executionId !== executionId || bound.authority.kind !== "new" || !isDeepStrictEqual(bound.authority.supersedes, reservation.target)
      || bound.proofDigest !== reservation.authorityDigest || controlDigest(bound.authority) !== reservation.authorityDigest) throw new Error("预约 successor 必须携带原持久人工授权，禁止降级绕过激活。");
  }
}

async function bytes(file: string) {
  for (let cursor = path.dirname(file); ; cursor = path.dirname(cursor)) {
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("旧证据目录身份异常。");
    if (path.dirname(cursor) === cursor) break;
  }
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 512 * 1024 * 1024) throw new Error("旧证据文件身份异常。");
  return readFile(file);
}
export type FreshRestartOptions = { request?: typeof fetch; readEvidence?: typeof readN8nFreshRestartEvidence; admittedId?: string;
  assertOwned?: () => Promise<void>; expectedActiveBytes?: string };

/** Intentionally supports one audited serial prefix only. Unknown itself is
 * never evidence that an import was not called. This function performs GETs. */
export async function inspectFreshRestart(root: string, target: FreshRestartTarget, options: FreshRestartOptions = {}): Promise<RestartProof> {
  if (!validFreshRestartTarget(target)) throw new Error("从头采集目标字段无效。");
  const activeRaw = options.expectedActiveBytes ?? (await bytes(path.join(base(root), "active.json"))).toString("utf8");
  const active = JSON.parse(activeRaw), control = await readRecoveryControl(root, target.logicalExecutionId);
  const plan = JSON.parse((await bytes(path.join(base(root), `n8n-export-first-${target.sourceExecutionId}.json`))).toString("utf8")) as JackyunExportFirstPlan;
  if (!control || control.digest !== target.controlDigest || control.record.sourceExecutionId !== target.sourceExecutionId
    || control.record.attemptExecutionId !== target.failedExecutionId || control.record.decision !== "resume"
    || controlDigest(active) !== target.activeDigest || active.executionId !== target.sourceExecutionId || active.runId !== plan.runId
    || controlDigest(plan) !== target.sourceDigest || plan.executionId !== target.sourceExecutionId || plan.runId !== `n8n-export-first-${target.sourceExecutionId}`
    || plan.phase !== "importing" || plan.exportTransport !== "session_api_v1" || plan.version !== 2 || plan.exportIntent
    || jackyunExportOrder.some(m => !plan.exports[m])) throw new Error("从头采集原 active、control 或 importing 计划已变化。");
  const evidence = (options.readEvidence ?? readN8nFreshRestartEvidence)(target.sourceExecutionId, target.failedExecutionId, options.admittedId);
  if ([evidence.source, evidence.latest].some(e => e.status !== "error" || e.retrySuccessId !== null || e.activeExecutions !== 0)
    || evidence.source.executionId !== target.sourceExecutionId || evidence.latest.executionId !== target.failedExecutionId
    || evidence.source.lastNode !== "D·统一导入运营管理系统" || evidence.source.requestUrl !== "http://127.0.0.1:5791/jackyun/export-first/import"
    || evidence.source.runNodes.some(n => n.startsWith("E·"))
    || target.failedExecutionId !== target.sourceExecutionId && (evidence.latest.lastNode !== "A·固定采集日和销售日期"
      || evidence.latest.runNodes.some(n => /^[BCDE]·/.test(n)) || !evidence.latest.error.includes("JACKYUN_RULES_CHANGED_MANUAL_ACTION"))) throw new Error("从头采集缺少 D 拒绝和最新 A 失败的终态证明。");
  const run = path.join(root, "outputs/jackyun-import-runs", plan.runId), files: Record<string, string> = {};
  const bind = async (file: string) => { const raw = await bytes(file); files[path.relative(root, file)] = sha(raw); return JSON.parse(raw.toString("utf8")); };
  await bind(path.join(base(root), `${plan.runId}.json`));
  const manifest = await bind(path.join(run, "run-manifest.json"));
  if (manifest.runId !== plan.runId || !isDeepStrictEqual(manifest.strictOrder, jackyunModuleOrder)
    || !manifest.modules || Object.keys(manifest.modules).sort().join() !== "inventory,products"
    || manifest.modules.products.status !== "completed" || manifest.modules.inventory.status !== "failed") throw new Error("从头采集仅支持货品完成、库存拒绝的严格导入前缀。");
  const controller = await bind(path.join(run, "api-controller-state.json"));
  if (controller.runId !== plan.runId || controller.runDate !== plan.runDate || controller.asOfDate !== plan.asOfDate || controller.salesStartDate !== plan.salesStartDate
    || controller.transport !== plan.exportTransport || !controller.modules || Object.keys(controller.modules).length !== 5) throw new Error("旧平台导出 controller 身份不完整。");
  // Reuse the production handoff parser (including task/date/scope/file SHA).
  const { verifyFreshRestartHandoff } = await import("../../tools/jackyun-export-first-pipeline");
  for (const m of jackyunExportOrder) {
    const handoff = await verifyFreshRestartHandoff(root, plan, m);
    const event = path.join(root, "outputs/jackyun-browser-events", plan.runId, `${String(jackyunModuleOrder.indexOf(m) + 1).padStart(2, "0")}-${m}.json`);
    await bind(event); files[path.relative(root, handoff.filePath)] = sha(await bytes(handoff.filePath));
    const entry = controller.modules[m];
    if (entry?.status !== "handed_off" || entry.handoffSha256 !== plan.exports[m]!.handoffSha256 || entry.filePath !== handoff.filePath
      || !isDeepStrictEqual(entry.binding, handoff.evidence?.exportTaskBinding)) throw new Error("旧平台存在未闭合导出 intent 或 handoff 变化。");
  }
  const policy = JSON.parse((await bytes(path.join(root, "config/jackyun-export-first-policy.json"))).toString("utf8"));
  await verifyJackyunModuleArtifact({ runDirectory: run, runId: plan.runId, module: "products", snapshotDate: plan.runDate,
    policyVersion: plan.protocol, allowedDownloadHosts: policy.browser.allowedDownloadHosts,
    manifestModule: manifest.modules.products, handoffPath: path.join(root, "outputs/jackyun-browser-events", plan.runId, "01-products.json"), requireAtomicHandoff: true });
  const productsAudit = await bind(path.join(run, "audit/products.json")), rejected = await bind(path.join(run, "audit/inventory.json"));
  if (rejected.runId !== plan.runId || rejected.module !== "inventory" || rejected.status !== "failed" || rejected.import
    || rejected.error?.stage !== "chunk_upload_and_import" || rejected.error?.details?.httpStatus !== 400 || rejected.error.details.status !== "rejected"
    || typeof rejected.error.message !== "string" || !evidence.source.error.includes(rejected.error.message)
    || rejected.source?.sha256 !== manifest.modules.inventory.sourceSha256 || rejected.source.path !== manifest.modules.inventory.sourcePath
    || rejected.source.sha256 !== plan.exports.inventory!.fileSha256) throw new Error("旧库存缺少与原 n8n D 一致的明确 HTTP400 拒绝审计。");
  for (const folder of ["import-checkpoints", "audit"]) {
    const names = await readdir(path.join(run, folder));
    if (names.some(n => /^(inventory_age|sales|combos)(\.|$)/.test(n))) throw new Error("后三表出现调用或审计证据，不能证明未导入。");
  }
  const results: unknown[] = [];
  const baseline = await bind(path.join(base(root), "publication-baselines", `${plan.runId}.json`));
  for (const m of ["products", "inventory"] as const) {
    const checkpoint = await bind(path.join(run, "import-checkpoints", `${m}.json`)), identity = checkpoint.identity;
    if (checkpoint.version !== "jackyun-import-checkpoint-v1" || !identity || checkpoint.identityDigest !== controlDigest(identity)
      || identity.moduleKey !== m || identity.runId !== plan.runId || identity.runDate !== plan.runDate || identity.asOfDate !== plan.asOfDate
      || identity.salesStartDate !== undefined || !/^[a-f0-9]{64}$/.test(identity.rawFileHash) || !/^[a-f0-9-]{36}$/.test(checkpoint.uploadId ?? "")
      || typeof identity.fileName !== "string" || path.basename(identity.fileName) !== identity.fileName
      || identity.fingerprint !== recoveryUploadFingerprint(plan.runId, m, identity.rawFileHash, baseline.tokens?.[m])
      || checkpoint.stage !== (m === "products" ? "committed" : "complete_intent") || m === "inventory" && checkpoint.batchId !== null) throw new Error("旧上传 checkpoint、文件或日期范围不一致。");
    const prepared = m === "products" ? manifest.modules.products.outputPath : path.join(run, "processed", identity.fileName);
    const relative = typeof prepared === "string" ? path.relative(run, prepared) : "..";
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("旧归档输出路径不属于原运行。");
    const raw = await bytes(prepared);
    files[path.relative(root, prepared)] = sha(raw);
    if (raw.length !== identity.fileSizeBytes || sha(raw) !== identity.rawFileHash) throw new Error("旧处理文件已变化。");
    const query = importRecoveryQuery(m, plan, "result");
    for (const k of ["fileName", "fileSizeBytes", "rawFileHash"]) query.set(k, String(identity[k]));
    query.set("uploadId", checkpoint.uploadId); query.set("fingerprint", m === "products" ? `erp:products:${identity.fingerprint}` : `inventory:stock:${plan.runDate}:${identity.fingerprint}`);
    await options.assertOwned?.();
    const response = await (options.request ?? fetch)(`${plan.baseUrl}/api/imports/recovery?${query}`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30000) });
    const result = await response.json(); await options.assertOwned?.();
    if (!response.ok || result.ok !== true || result.version !== "import-recovery-query-v1" || !isDeepStrictEqual(result.scope, importRecoveryScope(m, plan))) throw new Error("旧导入精确查询范围无法确认。");
    if (m === "products") {
      const batch = result.batch, receipt = productsAudit.import?.result?.djangoReceipt;
      if (result.status !== "committed_current" || !batch || batch.id !== checkpoint.batchId || batch.id !== manifest.modules.products.batchId
        || batch.status !== "completed" || batch.sourceKey !== "products" || batch.rowCount <= 0 || batch.ownedRowCount !== batch.rowCount
        || !receipt || batch.totals?.contentHash !== receipt.contentHash || batch.totals?.rawFileHash !== receipt.rawFileHash
        || identity.rawFileHash !== manifest.modules.products.outputSha256 || receipt.inputSha256 !== identity.rawFileHash || receipt.batchId !== batch.id) throw new Error("旧货品提交批次、内容或当前所有权无法精确证明。");
    } else if (result.status !== "uncommitted_upload" || result.uploadStatus !== "ready" || result.uploadId !== checkpoint.uploadId) throw new Error("旧库存存在未知提交或 processing，禁止从头采集。");
    results.push(result);
  }
  return { target, activeBytes: activeRaw, files, evidence, results };
}

export async function activateFreshRestart(root: string, bound: BoundHumanAuthority, fresh: JackyunExportFirstPlan, options: FreshRestartOptions & {
  assertOwned: () => Promise<void>; ownerToken: string; at: string; boundary?: (name: string) => Promise<void>;
}) {
  const authority = bound.authority;
  if (authority.kind !== "new" || !authority.supersedes || bound.executionId !== fresh.executionId || bound.proofDigest !== controlDigest(authority)
    || Date.parse(authority.expiresAt) <= Date.now()) throw new Error("从头采集缺少本次持久人工授权。");
  const target = authority.supersedes, dir = directory(root, target.logicalExecutionId), reservationPath = path.join(dir, "reservation.json");
  let reservation = await readJsonDurableOr<Reservation | null>(reservationPath, null);
  const reservationPayload = reservation ? { ...reservation } : null;
  if (reservationPayload) delete (reservationPayload as Partial<Reservation>).digest;
  if (reservation && (reservation.authorityDigest !== bound.proofDigest || reservation.successorId !== bound.executionId
    || reservation.digest !== controlDigest(reservationPayload))) throw new Error("旧逻辑运行已有唯一 successor 预约，禁止另一个授权或新 ID 绕过。");
  const activated = await readJsonDurableOr<{ reservationDigest: string } | null>(path.join(dir, "activated.json"), null);
  if (activated) {
    if (!reservation || activated.reservationDigest !== reservation.digest) throw new Error("从头采集激活回执损坏。");
    return reservation.plan;
  }
  const activePath = path.join(base(root), "active.json"), activeBytes = (await bytes(activePath)).toString("utf8");
  const successorActive = JSON.stringify({ runId: fresh.runId, executionId: fresh.executionId });
  const alreadyMoved = reservation && controlDigest(JSON.parse(activeBytes)) === controlDigest(JSON.parse(successorActive));
  if (alreadyMoved && !await readJsonDurableOr(path.join(dir, "superseded.json"), null)) throw new Error("active 已推进但缺少永久封禁回执，需人工协调。");
  const proof = await inspectFreshRestart(root, target, { ...options, admittedId: bound.executionId,
    ...(alreadyMoved ? { expectedActiveBytes: reservation!.proof.activeBytes } : {}) });
  if (reservation && !isDeepStrictEqual(reservation.proof, proof)) throw new Error("预约后的旧证据已变化，保留未决 successor，禁止覆盖。");
  if (!reservation) {
    assertNoFreshRestart(root, [target.logicalExecutionId, target.sourceExecutionId]);
    const payload = { version: "jackyun-fresh-restart-v1" as const, target, authorityDigest: bound.proofDigest, authorizationId: authority.authorizationId,
      successorId: bound.executionId, plan: fresh, proof };
    reservation = { ...payload, digest: controlDigest(payload) };
    await options.assertOwned(); await writeJsonDurable(reservationPath, reservation, true); await options.boundary?.("reservation");
  }
  const plan = reservation.plan, planPath = path.join(base(root), `${plan.runId}.json`);
  const saved = await readJsonDurableOr<JackyunExportFirstPlan | null>(planPath, null);
  if (saved && !isDeepStrictEqual(saved, plan)) throw new Error("预约新计划已变化，禁止覆盖。");
  if (!saved) { await options.assertOwned(); await writeJsonDurable(planPath, plan, true); }
  await options.boundary?.("plan");
  const control = await readRecoveryControl(root, plan.executionId);
  if (control && (control.record.proofDigest !== reservation.digest || control.record.sourceExecutionId !== plan.executionId
    || control.record.attemptExecutionId !== plan.executionId || control.record.decision !== "collect")) throw new Error("新采集 control 身份不一致。");
  if (!control) await appendRecoveryControl(root, { version: "jackyun-recovery-control-v1", logicalExecutionId: plan.executionId,
    sourceExecutionId: plan.executionId, attemptExecutionId: plan.executionId, ownerToken: options.ownerToken, generation: 1, decision: "collect",
    proofDigest: reservation.digest, at: plan.createdAt, failureAttempts: 0, nextAllowedAt: null }, null, options.assertOwned);
  await options.boundary?.("control");
  const baseline = await collectionPublicationBaseline(root, plan, { allowCapture: true, request: options.request ?? fetch,
    baseUrl: plan.baseUrl, assertOwned: options.assertOwned, at: plan.createdAt });
  await options.boundary?.("baseline");
  const lastProof = await inspectFreshRestart(root, target, { ...options, admittedId: bound.executionId,
    ...(alreadyMoved ? { expectedActiveBytes: reservation.proof.activeBytes } : {}) });
  if (!isDeepStrictEqual(proof, lastProof)) throw new Error("生效前旧证据变化，保留预约并停止。");
  const superseded = { version: "jackyun-fresh-superseded-v1", reservationDigest: reservation.digest, baselineDigest: controlDigest(baseline),
    oldActiveBytes: reservation.proof.activeBytes, target, successorId: plan.executionId };
  const sealPath = path.join(dir, "superseded.json"), seal = await readJsonDurableOr(sealPath, null);
  if (seal && !isDeepStrictEqual(seal, superseded)) throw new Error("旧封禁回执变化。");
  if (!seal) { await options.assertOwned(); await writeJsonDurable(sealPath, superseded, true); }
  await options.boundary?.("superseded");
  await options.assertOwned();
  if (!alreadyMoved) {
    if ((await bytes(activePath)).toString("utf8") !== reservation.proof.activeBytes) throw new Error("active CAS 前驱字节变化，禁止推进。");
    await writeJsonDurable(activePath, { runId: plan.runId, executionId: plan.executionId });
  }
  await options.boundary?.("active"); await options.assertOwned();
  await writeJsonDurable(path.join(dir, "activated.json"), { version: "jackyun-fresh-activated-v1", reservationDigest: reservation.digest }, true);
  return plan;
}
