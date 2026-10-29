import path from "node:path";
import { link, lstat, readdir, readFile, rename, mkdir, unlink } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { controlDigest, readRecoveryControl } from "./recovery-control";
import { readJsonDurableOr, writeJsonDurable } from "./json-file";
import { readJackyunRecoveryTarget, readHumanRetryAuthority } from "./human-retry";
import { closedIndex, closeDirectory, closeRecord, readCloseIntent, type CloseIntent } from "./operator-close-fence";
import { validJackyunCloseIdentity, type JackyunCloseIdentity, type JackyunCloseTarget } from "./operator-close-contract";
import { readAcceptedJackyunHumanDispatch, readN8nJackyunCloseEvidence, readN8nJackyunOwnerState } from "./n8n-preflight-evidence";
import { defaultJackyunRunLockDirectory, inspectJackyunRunLock, retireExitedJackyunSlotLock, withJackyunRunLock } from "./run-lock";
import { assertJackyunCloseResourcesIdle } from "./operator-close-resources";
import { importRecoveryQuery, importRecoveryScope } from "./publication-baseline";
import { jackyunModuleOrder } from "./post-download";

type Plan = { runId: string; executionId: string; phase: string; runDate: string; asOfDate: string; salesStartDate?: string; baseUrl: string; createdAt: string };
type Authority = { ok: true; version: "jackyun-operator-close-authority-v1"; action: "close"; target: JackyunCloseIdentity;
  authorizationId: string; closeRequestId?: string; workflowId: string; createdAt: string; expiresAt: string };
export type CloseSlotCoordinator = { observe: (ids: string[]) => { exited: boolean; blocked: boolean };
  freeze: (ids: string[]) => { assertExited: () => void; complete: () => void; release: () => void } };
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const base = (root: string) => path.join(root, "outputs/jackyun-export-first");
const ids = (t: JackyunCloseIdentity) => [t.logicalExecutionId, t.sourceExecutionId, t.failedExecutionId];
async function metadata(root: string, sourceId: string) {
  const files: Record<string, string> = {};
  const run = path.join(root, "outputs/jackyun-import-runs", `n8n-export-first-${sourceId}`);
  for (const folder of [run, path.join(run, "import-checkpoints"), path.join(run, "audit")]) {
    const names = await readdir(folder, { withFileTypes: true }).catch(e => { if (e.code === "ENOENT") return []; throw e; });
    if (names.length > 256) throw new Error("原任务证据超过安全核验范围。");
    for (const name of names) {
      if (name.isSymbolicLink()) throw new Error("原任务证据目录身份异常。");
      if (!name.name.endsWith(".json") || !name.isFile()) continue;
      const file = path.join(folder, name.name), info = await lstat(file);
      if (info.nlink !== 1 || info.size > 4 * 1024 * 1024) throw new Error("原任务证据文件身份异常。");
      files[path.relative(root, file)] = sha(await readFile(file));
    }
  }
  return files;
}
async function importStates(root: string, plan: Plan, request: typeof fetch) {
  if (plan.baseUrl !== "http://localhost:3000") throw new Error("原任务业务服务归属无法核实。");
  const modules: NonNullable<JackyunCloseTarget["modules"]> = [];
  for (const module of jackyunModuleOrder) {
    const query = importRecoveryQuery(module, plan, "scope");
    const scope = await request(`${plan.baseUrl}/api/imports/recovery?${query}`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
    const head = await scope.json();
    if (!scope.ok || head.ok !== true || head.version !== "import-recovery-query-v1" || !isDeepStrictEqual(head.scope, importRecoveryScope(module, plan)) || head.status !== "ready") throw new Error(`${module} 仍在提交或提交者状态未确认，暂不能闭合。`);
    const checkpoint = await readJsonDurableOr<Record<string, any> | null>(path.join(root, "outputs/jackyun-import-runs", plan.runId, "import-checkpoints", `${module}.json`), null);
    if (!checkpoint) { modules.push({ module, status: "not_started" }); continue; }
    const i = checkpoint.identity;
    if (checkpoint.version !== "jackyun-import-checkpoint-v1" || !i || checkpoint.identityDigest !== controlDigest(i)
      || i.moduleKey !== module || i.runId !== plan.runId || i.runDate !== plan.runDate || i.asOfDate !== plan.asOfDate
      || !["uploading", "complete_intent", "committed"].includes(checkpoint.stage)) throw new Error(`${module} 原导入证据无法核实。`);
    const q = importRecoveryQuery(module, plan, "result");
    for (const key of ["fileName", "fileSizeBytes", "rawFileHash"]) q.set(key, String(i[key]));
    q.set("fingerprint", module === "products" || module === "combos" ? `erp:${module}:${i.fingerprint}` : module === "inventory" || module === "inventory_age" ? `inventory:${module === "inventory" ? "stock" : "age"}:${plan.runDate}:${i.fingerprint}` : i.fingerprint);
    if (checkpoint.uploadId) q.set("uploadId", String(checkpoint.uploadId).replace(/^inventory-age:/, ""));
    const response = await request(`${plan.baseUrl}/api/imports/recovery?${q}`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok || result.ok !== true || result.version !== "import-recovery-query-v1" || !isDeepStrictEqual(result.scope, importRecoveryScope(module, plan)) || result.status === "waiting") throw new Error(`${module} 原提交仍在处理或结果无法核实，暂不能闭合。`);
    const committed = ["committed_current", "committed_superseded"].includes(result.status);
    // An uncommitted complete intent can still be an accepted remote POST.
    // It is never made safe by thread exit or a momentary idle scope.
    if (checkpoint.stage !== "uploading" && !committed) throw new Error(`${module} 已发出提交请求但终态未确认，请先核对该次提交后再闭合。`);
    if (committed && (typeof result.batch?.id !== "string" || result.batch.status !== "completed" || checkpoint.batchId && checkpoint.batchId !== result.batch.id)) throw new Error(`${module} 已提交批次归属无法核实。`);
    modules.push({ module, status: committed ? result.status : result.status === "uncommitted_upload" ? "uncommitted_upload" : "unknown", ...(committed ? { batchId: result.batch.id } : {}) });
  }
  return modules;
}
async function inspect(root: string, request: typeof fetch) {
  const recovery = await readJackyunRecoveryTarget(root);
  if (!["failed", "blocked"].includes(recovery.state) || !recovery.logicalExecutionId || !recovery.sourceExecutionId || !recovery.failedExecutionId) throw new Error(recovery.state === "waiting" ? "原任务仍在运行，请待任务停止后闭合。" : "当前没有需要闭合的失败任务。");
  const logical = recovery.logicalExecutionId, sourceId = recovery.sourceExecutionId, failed = recovery.failedExecutionId;
  const n8n = readN8nJackyunCloseEvidence([logical, sourceId, failed]);
  const plan = await readJsonDurableOr<Plan | null>(path.join(base(root), `n8n-export-first-${sourceId}.json`), null);
  const activeBytes = await readFile(path.join(base(root), "active.json"), "utf8"), active = JSON.parse(activeBytes);
  if (!plan || plan.executionId !== sourceId || plan.runId !== `n8n-export-first-${sourceId}` || active.executionId !== sourceId || active.runId !== plan.runId) throw new Error("原活动任务与计划不一致，暂不能闭合。");
  const control = await readRecoveryControl(root, logical), files = await metadata(root, sourceId);
  const target: JackyunCloseIdentity = { logicalExecutionId: logical, failedExecutionId: failed, sourceExecutionId: sourceId,
    planDigest: controlDigest(plan), controlDigest: control?.digest ?? controlDigest(null), activeDigest: controlDigest(active), evidenceDigest: controlDigest({ files, n8n }) };
  return { target, files, activeBytes, modules: await importStates(root, plan, request), plan };
}
export async function readJackyunCloseTarget(root: string, coordinator: CloseSlotCoordinator, requestId?: string): Promise<JackyunCloseTarget> {
  let shown: Pick<JackyunCloseTarget, "logicalExecutionId" | "modules"> = {};
  try {
    const closures = closedIndex(root);
    if (requestId) {
      const item = closures.find(v => v.intent.authorizationId === requestId);
      if (item) return { ok: true, state: item.done ? "closed" : "closing", closeAllowed: !item.done,
        target: item.intent.target, logicalExecutionId: item.intent.target.logicalExecutionId, modules: item.intent.modules, authorizationId: requestId,
        authorizationExpiresAt: String(item.intent.authority.expiresAt), reason: item.done ? "已闭合。已导入数据保留，可手动开始新的完整运行。" : "原闭合尚未完成，可继续同一闭合请求。" };
    }
    const pending = closures.find(v => !v.done);
    if (pending) return { ok: true, state: "closing", closeAllowed: true, target: pending.intent.target, modules: pending.intent.modules,
      logicalExecutionId: pending.intent.target.logicalExecutionId, authorizationId: pending.intent.authorizationId, authorizationExpiresAt: String(pending.intent.authority.expiresAt), reason: "原任务已停止接收旧派发，继续完成该次闭合。" };
    const active = await readJsonDurableOr<{ executionId: string } | null>(path.join(base(root), "active.json"), null);
    if (!active && closures.length) {
      const latest = closures.sort((a, b) => BigInt(a.intent.target.logicalExecutionId) < BigInt(b.intent.target.logicalExecutionId) ? 1 : -1)[0];
      return { ok: true, state: "closed", closeAllowed: false, logicalExecutionId: latest.intent.target.logicalExecutionId, modules: latest.intent.modules, reason: "已闭合。已导入数据保留，可手动开始新的完整运行。" };
    }
    const recovery = await readJackyunRecoveryTarget(root);
    if (recovery.logicalExecutionId) {
      shown = { logicalExecutionId: recovery.logicalExecutionId, modules: [] };
      if (recovery.sourceExecutionId) for (const module of jackyunModuleOrder) {
        const checkpoint = await readJsonDurableOr<{ stage: string; batchId?: string } | null>(path.join(root, "outputs/jackyun-import-runs", `n8n-export-first-${recovery.sourceExecutionId}`, "import-checkpoints", `${module}.json`), null);
        if (checkpoint) shown.modules!.push({ module, status: checkpoint.stage === "committed" ? "committed_recorded" : "unknown", ...(checkpoint.batchId ? { batchId: checkpoint.batchId } : {}) });
      }
    }
    const value = await inspect(root, fetch);
    const slot = coordinator.observe(ids(value.target));
    if (slot.blocked) throw new Error("原任务执行资源尚未退出，暂不能闭合。");
    const owner = await inspectJackyunRunLock(root);
    if (owner && owner.pid === process.pid && !slot.exited) throw new Error("原运行锁没有对应的线程退出见证，暂不能闭合。");
    await assertJackyunCloseResourcesIdle(root, owner?.pid);
    return { ok: true, state: "closable", closeAllowed: true, target: value.target, logicalExecutionId: value.target.logicalExecutionId, modules: value.modules, reason: "保留已导入数据，结束未完成任务。闭合后可手动重新运行。" };
  } catch (error) { return { ok: true, state: "blocked", closeAllowed: false, ...shown, reason: error instanceof Error ? error.message : "原任务状态无法核实，暂不能闭合。" }; }
}

async function authority(id: string, request: typeof fetch): Promise<Authority> {
  if (!uuid(id)) throw new Error("闭合授权编号无效。");
  const response = await request(`http://localhost:3000/api/imports/recovery/close?authorizationId=${id}`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
  const raw = await response.text();
  if (!response.ok || Buffer.byteLength(raw) > 8192) throw new Error("闭合授权无法核实，请从系统页面继续该次闭合。");
  const value = JSON.parse(raw) as Authority;
  if (value.ok !== true || value.version !== "jackyun-operator-close-authority-v1" || value.authorizationId !== id || value.action !== "close"
    || value.workflowId !== "J8kY2mQ5vR7sT4pN" || !validJackyunCloseIdentity(value.target) || value.closeRequestId !== undefined && !uuid(value.closeRequestId)
    || !Number.isFinite(Date.parse(value.createdAt)) || Date.parse(value.createdAt) > Date.now() || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) throw new Error("闭合授权范围或有效期不符。");
  return value;
}
async function revokeHumanDispatches(root: string, intent: CloseIntent, request: typeof fetch) {
  for (const folder of ["human-dispatch", "human-authorizations"]) {
    const dir = path.join(base(root), folder), names = await readdir(dir).catch(e => { if (e.code === "ENOENT") return []; throw e; });
    if (names.length > 4096) throw new Error("原人工派发索引超限，请核查原闭合请求。");
    for (const name of names) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) throw new Error("原人工派发索引异常。");
      const record = await readJsonDurableOr<any>(path.join(dir, name), null);
      if (record?.status === "revoked") continue;
      // Historical intents did not persist their target. Expired permissions
      // cannot dispatch; modern intents retain the exact authority for audit.
      let permission = record?.authority;
      if (!permission && folder === "human-dispatch") {
        const created = Date.parse(record?.createdAt);
        if (!Number.isFinite(created) || created > Date.now()) throw new Error("原人工派发时间证据不完整，闭合已冻结，需核对原请求。");
        if (created + 7 * 86400000 <= Date.now()) {
          const file = path.join(closeDirectory(root, intent.target.logicalExecutionId), `unresolved-${name}`);
          const unresolved = { version: "jackyun-expired-unresolved-dispatch-v1", authorizationId: name.slice(0, -5), originalIntentDigest: controlDigest(record),
            reason: "original_permission_lifetime_elapsed_target_unresolved", revokedClaim: false, at: intent.at };
          if (!closeRecord(file)) await writeJsonDurable(file, unresolved, true);
          else if (!isDeepStrictEqual(closeRecord(file), unresolved)) throw new Error("原过期派发保留记录已变化。");
          continue;
        }
        try { permission = await readHumanRetryAuthority(name.slice(0, -5), request); }
        catch { throw new Error("原人工派发授权结果尚未确认，闭合已冻结，需继续核对原请求。"); }
      }
      if (!permission || permission.version !== "jackyun-human-retry-authority-v1" || permission.authorizationId !== name.slice(0, -5)
        || record.authorityDigest && record.authorityDigest !== controlDigest(permission) || record.proofDigest && record.proofDigest !== controlDigest(permission)
        || !Number.isFinite(Date.parse(permission.createdAt)) || !Number.isFinite(Date.parse(permission.expiresAt)) || Date.parse(permission.expiresAt) <= Date.parse(permission.createdAt)) throw new Error("原人工授权持久证据无法核实。");
      let relevant = permission.kind === "retry" && (ids(intent.target).includes(permission.logicalExecutionId) || ids(intent.target).includes(permission.failedExecutionId));
      if (permission.kind === "new") {
        relevant = !!permission.supersedes && [permission.supersedes.logicalExecutionId, permission.supersedes.sourceExecutionId, permission.supersedes.failedExecutionId].some(id => ids(intent.target).includes(id));
        const consumer = record.executionId ? { executionId: String(record.executionId), status: readN8nJackyunOwnerState(String(record.executionId)) }
          : readAcceptedJackyunHumanDispatch(name.slice(0, -5), record.createdAt ?? permission.createdAt);
        if (consumer) {
          if (!["error", "success", "canceled", "crashed"].includes(consumer.status)) throw new Error("原人工新采集仍有在途执行，暂不能完成闭合。");
          relevant ||= ids(intent.target).includes(consumer.executionId);
        } else if (Date.parse(permission.expiresAt) > Date.now()) throw new Error("原人工新采集派发尚未有终态消费证明，暂不能完成闭合。");
      }
      if (!relevant) continue;
      const file = path.join(base(root), "human-authorizations", name);
      const previous = await readJsonDurableOr<any>(file, null);
      if (previous?.status === "revoked") continue;
      if (previous) {
        const archived = path.join(closeDirectory(root, intent.target.logicalExecutionId), `human-${name}`);
        if (!await lstat(archived).catch(e => { if (e.code === "ENOENT") return null; throw e; })) await rename(file, archived);
        else throw new Error("原授权归档需要核对，不能覆盖。");
      }
      await writeJsonDurable(file, { version: "jackyun-human-authorization-revoked-v1", status: "revoked", authorizationId: name.slice(0, -5),
        closeRequestId: intent.authorizationId, target: intent.target, at: intent.at, reason: "operator_closed_preserve_business_facts" }, true);
    }
  }
}
async function publishIntent(root: string, value: Awaited<ReturnType<typeof inspect>>, approved: Authority) {
  const staging = path.join(base(root), "operator-closure-staging", approved.authorizationId), dir = closeDirectory(root, value.target.logicalExecutionId);
  await mkdir(staging, { recursive: true });
  let intent = await readJsonDurableOr<CloseIntent | null>(path.join(staging, "intent.json"), null);
  if (intent && (intent.authorizationId !== approved.authorizationId || !isDeepStrictEqual(intent.target, value.target) || !isDeepStrictEqual(intent.files, value.files)
    || intent.activeBytes !== value.activeBytes || !isDeepStrictEqual(intent.authority, approved))) throw new Error("原闭合准备记录已变化，需核对原请求。");
  if (!intent) {
    intent = { version: "jackyun-operator-close-intent-v1", authorizationId: approved.authorizationId, authority: approved as unknown as Record<string, unknown>, target: value.target,
      activeBytes: value.activeBytes, files: value.files, modules: value.modules, at: new Date().toISOString() };
    await writeJsonDurable(path.join(staging, "intent.json"), intent, true);
  }
  await mkdir(path.dirname(dir), { recursive: true });
  await rename(staging, dir); // complete intent directory, same volume, no overwrite
  return readCloseIntent(root, value.target.logicalExecutionId)!;
}
export async function closeJackyunExecution(root: string, authorizationId: string, coordinator: CloseSlotCoordinator, request: typeof fetch = fetch) {
  // A finished old request is independent of whichever new workflow now owns
  // the shared helper. This read does not require an unexpired permission.
  const finished = closedIndex(root).find(v => v.done && (v.intent.authorizationId === authorizationId || closeRecord(path.join(closeDirectory(root, v.intent.target.logicalExecutionId), `authorization-${authorizationId}.json`))));
  if (finished) return { ok: true, state: "closed", authorizationId: finished.intent.authorizationId };
  const approved = await authority(authorizationId, request), target = approved.target;
  const dir = closeDirectory(root, target.logicalExecutionId);
  const prior = readCloseIntent(root, target.logicalExecutionId);
  if (!prior && approved.closeRequestId) throw new Error("继续闭合必须对应已持久化的原请求。");
  if (prior && (!isDeepStrictEqual(prior.target, target) || (approved.closeRequestId ?? authorizationId) !== prior.authorizationId)) throw new Error("旧任务已有另一闭合请求，必须继续原请求。");
  const frozen = coordinator.freeze(ids(target));
  try {
    let value = prior ? null : await inspect(root, request);
    if (value && !isDeepStrictEqual(value.target, target)) throw new Error("目标已变化，请刷新后闭合当前任务。");
    frozen.assertExited();
    const owner = await inspectJackyunRunLock(root);
    await assertJackyunCloseResourcesIdle(root, owner?.pid);
    if (owner?.pid === process.pid) {
      if (!coordinator.observe(ids(target)).exited) throw new Error("原运行锁缺少精确线程退出见证。");
      if (owner.purpose !== "n8n_export_first" || !ids(target).some(id => owner.runId === `n8n-export-first-${id}`)) throw new Error("原运行锁不属于当前失败任务。");
      await retireExitedJackyunSlotLock(root, owner, async () => { frozen.assertExited(); await assertJackyunCloseResourcesIdle(root, owner.pid); }, dir, async () => {
        if (!readCloseIntent(root, target.logicalExecutionId)) {
          const checked = await inspect(root, request);
          if (!isDeepStrictEqual(checked.target, target)) throw new Error("原任务证据已变化，请刷新后闭合。");
          await publishIntent(root, checked, approved);
        }
      });
    }
    const result = await withJackyunRunLock({ runId: `close-${prior?.authorizationId ?? authorizationId}`, purpose: "operator_close", lockDirectory: defaultJackyunRunLockDirectory(root) }, async lock => {
      const current = readCloseIntent(root, target.logicalExecutionId);
      if (current && (!isDeepStrictEqual(current.target, target) || current.authorizationId !== (approved.closeRequestId ?? authorizationId))) throw new Error("原闭合预约身份已变化。");
      let intent = current;
      if (!intent) {
        value = await inspect(root, request);
        if (!isDeepStrictEqual(value.target, target)) throw new Error("原任务证据已变化，请刷新后闭合。");
        await lock.assertOwned(); intent = await publishIntent(root, value, approved);
      }
      const done = closeRecord(path.join(dir, "closed.json"));
      if (done) { closedIndex(root); return { ok: true, state: "closed", authorizationId: intent.authorizationId }; }
      readN8nJackyunCloseEvidence(ids(target)); frozen.assertExited();
      const plan = await readJsonDurableOr<Plan | null>(path.join(base(root), `n8n-export-first-${target.sourceExecutionId}.json`), null);
      if (!plan || controlDigest(plan) !== target.planDigest || !isDeepStrictEqual(await metadata(root, target.sourceExecutionId), intent.files)
        || (await readRecoveryControl(root, target.logicalExecutionId))?.digest !== (target.controlDigest === controlDigest(null) ? undefined : target.controlDigest)) throw new Error("原闭合证据已变化，保留冻结状态，需核查原任务。");
      await importStates(root, plan, request);
      await lock.assertOwned();
      await writeJsonDurable(path.join(dir, `authorization-${authorizationId}.json`), approved, true).catch(async error => {
        if (!isDeepStrictEqual(closeRecord(path.join(dir, `authorization-${authorizationId}.json`)), approved)) throw error;
      });
      await revokeHumanDispatches(root, intent, request);
      const activePath = path.join(base(root), "active.json"), archive = path.join(dir, "active.original.json");
      const archived = await readFile(archive, "utf8").catch(e => { if (e.code === "ENOENT") return null; throw e; });
      const active = await readFile(activePath, "utf8").catch(e => { if (e.code === "ENOENT") return null; throw e; });
      if (archived !== null) {
        if (archived !== intent.activeBytes || active !== null && active !== intent.activeBytes) throw new Error("活动索引归档后出现变化，需要核查原闭合。");
        if (active !== null) {
          const [a, b] = await Promise.all([lstat(activePath), lstat(archive)]);
          if (!a.isFile() || a.isSymbolicLink() || b.isSymbolicLink() || a.dev !== b.dev || a.ino !== b.ino || a.nlink !== 2 || b.nlink !== 2) throw new Error("活动索引双名不是同一原始文件，不能继续归档。");
          await lock.assertOwned(); await unlink(activePath);
        }
      }
      else {
        if (active !== intent.activeBytes) throw new Error("活动任务已变化，不能闭合另一任务。");
        const original = await lstat(activePath);
        if (!original.isFile() || original.isSymbolicLink() || original.nlink !== 1) throw new Error("活动索引文件身份异常。");
        await lock.assertOwned(); await link(activePath, archive); // atomic no-overwrite, same-volume exact bytes
        const archivedInfo = await lstat(archive);
        if (archivedInfo.dev !== original.dev || archivedInfo.ino !== original.ino || archivedInfo.nlink !== 2 || await readFile(activePath, "utf8") !== intent.activeBytes) throw new Error("活动索引归档身份已变化。");
        await lock.assertOwned(); await unlink(activePath);
        if (await readFile(archive, "utf8") !== intent.activeBytes) throw new Error("活动索引归档不一致。");
      }
      const archiveInfo = await lstat(archive);
      if (!archiveInfo.isFile() || archiveInfo.isSymbolicLink() || archiveInfo.nlink !== 1) throw new Error("活动索引归档尚未收敛。");
      await lock.assertOwned();
      await writeJsonDurable(path.join(dir, "closed.json"), { version: "jackyun-operator-closed-v1", authorizationId: intent.authorizationId,
        intentDigest: controlDigest(intent), status: "operator_closed_preserve_facts", at: new Date().toISOString(), completedClaim: false, zeroEffectClaim: false }, true);
      return { ok: true, state: "closed", authorizationId: intent.authorizationId };
    });
    frozen.complete(); return result;
  } finally { frozen.release(); }
}
