import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { defaultJdChromiumRunLockDirectory } from "../lib/jd/chromium-run-lock";
import { assertLogisticsManifest, type JdLogisticsManifest } from "../lib/jd/logistics-manifest";
import { canonicalLogisticsJson, logisticsHash, parseJdLogisticsConfig, parseJdLogisticsSettings, selectJdLogisticsOperations } from "../lib/jd/logistics-policy";
import { validateJdStoreRegistry } from "../lib/jd/store-registry";
import { jdPreexportEvidence as io, preexportSha256 as sha, type PreexportOptions } from "./close-jd-logistics-preexport";
import { jdLogin9851Target } from "./jd-logistics-login-9851-target";

export type Login9851Target = { -readonly [K in keyof typeof jdLogin9851Target]: (typeof jdLogin9851Target)[K] extends number ? number : string };
type Options = Omit<PreexportOptions, "target"> & { target?: Login9851Target };
function fail(code: string): never { throw new Error(`JD_LOGIN_9851_${code}`); }
const same = (a: unknown, b: unknown) => canonicalLogisticsJson(a) === canonicalLogisticsJson(b);

export function read9851Execution(databasePath: string, t: Login9851Target) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN");
    const w = db.prepare("SELECT id,active,versionId,activeVersionId,nodes,connections,settings FROM workflow_entity WHERE id=?").get(t.workflowId);
    const e = db.prepare("SELECT id,workflowId,status,mode,startedAt,stoppedAt,retrySuccessId,deletedAt FROM execution_entity WHERE id=? AND workflowId=?").get(t.executionId, t.workflowId);
    const active = db.prepare("SELECT COUNT(*) AS n FROM execution_entity WHERE workflowId=? AND status NOT IN ('error','success','canceled','crashed')").get(t.workflowId);
    const data = db.prepare("SELECT data FROM execution_data WHERE executionId=? AND length(data)<=1048576").get(t.executionId)?.data;
    const history = db.prepare("SELECT nodes,connections FROM workflow_history WHERE workflowId=? AND versionId=?").get(t.workflowId, t.workflowVersionId);
    if (!w || w.active !== 0 || w.activeVersionId !== null || w.versionId !== t.workflowVersionId || !history
      || history.nodes !== w.nodes || history.connections !== w.connections || !e || e.status !== "error" || e.mode !== "trigger"
      || e.retrySuccessId !== null || e.deletedAt !== null || active?.n !== 0 || typeof data !== "string" || sha(data) !== t.executionDataSha256) fail("WORKFLOW_NOT_FROZEN_OR_EXECUTION_CHANGED");
    const shape = { nodes: JSON.parse(String(w.nodes)), connections: JSON.parse(String(w.connections)), settings: JSON.parse(String(w.settings)) };
    if (logisticsHash(shape) !== t.workflowShapeHash || shape.settings.timezone !== "Asia/Shanghai"
      || shape.settings.errorWorkflow || shape.nodes.filter((n: { type: string }) => n.type === "n8n-nodes-base.manualTrigger").length !== 1
      || shape.nodes.filter((n: { type: string }) => n.type === "n8n-nodes-base.scheduleTrigger").length !== 1
      || shape.nodes.some((n: { type: string }) => /webhook|errorTrigger|executeWorkflowTrigger/.test(n.type))) fail("PUBLISHED_GRAPH_CHANGED");
    const values = JSON.parse(data);
    if (!Array.isArray(values) || values.length > 10000) fail("EXECUTION_ENCODING_INVALID");
    const deref = (v: unknown): unknown => typeof v === "string" && /^\d+$/.test(v) ? values[Number(v)] : v;
    const obj = (v: unknown) => io.object(deref(v));
    const arr = (v: unknown): unknown[] => { const a = deref(v); if (!Array.isArray(a)) fail("EXECUTION_ARRAY_INVALID"); return a; };
    const result = obj(obj(values[0]).resultData), run = obj(result.runData);
    const aName = "A·冻结事业部来源与日期计划", bName = "B·串行下载全文件校验并导入", releaseName = "失败后释放原执行 helper";
    const names = ["每天08:00计划入口", "领取共享 helper", "已领取执行所有权？", aName, bName, releaseName, "保留证据并明确失败"];
    if (!same(Object.keys(run).sort(), names.sort()) || deref(result.lastNodeExecuted) !== "保留证据并明确失败") fail("EXECUTION_STAGE_CHANGED");
    const task = (name: string) => { const list = arr(run[name]); if (list.length !== 1) fail("EXECUTION_REPLAY_PRESENT"); return obj(list[0]); };
    const output = (task: Record<string, unknown>, branch: number) => {
      const branches = arr(obj(task.data).main), items = arr(branches[branch]);
      if (items.length !== 1 || branches.some((v, i) => i !== branch && arr(v).length)) fail("EXECUTION_OUTPUT_CHANGED");
      return obj(obj(items[0]).json);
    };
    const a = task(aName), b = task(bName), release = task(releaseName), final = task("保留证据并明确失败");
    const ap = output(a, 0), bp = output(b, 1), rp = output(release, 0), error = obj(bp.error);
    if ([a, b, release].some(x => deref(x.executionStatus) !== "success") || deref(final.executionStatus) !== "error"
      || !(Number(a.executionIndex) < Number(b.executionIndex) && Number(b.executionIndex) < Number(release.executionIndex) && Number(release.executionIndex) < Number(final.executionIndex))
      || deref(ap.runId) !== t.runId || deref(ap.stage) !== "planned" || deref(ap.operationCount) !== 4 || deref(bp.runId) !== t.runId
      || deref(error.status) !== 500 || !String(deref(error.message)).includes(t.failureCode)
      || deref(rp.ok) !== true || deref(rp.stage) !== "released" || deref(rp.workflow) !== "jd-logistics") fail("EXECUTION_FAILURE_OR_RELEASE_CHANGED");
    const startedAt = Date.parse(String(e.startedAt) + "Z"), stoppedAt = Date.parse(String(e.stoppedAt) + "Z");
    if (!Number.isFinite(startedAt) || !Number.isFinite(stoppedAt) || stoppedAt <= startedAt) fail("EXECUTION_TIME_INVALID");
    return { executionId: t.executionId, startedAt, stoppedAt, workflowVersionId: t.workflowVersionId, executionDataSha256: t.executionDataSha256 };
  } finally { db.close(); }
}

async function historyBatches(plan: JdLogisticsManifest, t: Login9851Target, request: typeof fetch) {
  const result = [];
  for (const op of plan.operations) {
    const items: Array<{ batchId: string; collectorEvidence?: { executionId?: unknown; runId?: unknown } }> = []; let total = 0;
    for (let page = 1; page <= 10; page++) {
      const q = new URLSearchParams({ operation: "batches", departmentId: t.departmentId, businessUnitCode: t.businessUnitCode, sourceKind: op.sourceKind, page: String(page), pageSize: "100" });
      const e = await io.readGet(`${plan.baseUrl}/api/inventory/jd-logistics?${q}`, request), d = e.data;
      if (e.success !== true || !d || !Array.isArray(d.items) || d.page !== page || d.pageSize !== 100 || !Number.isSafeInteger(d.total)
        || d.total < 0 || d.total > 1000 || page > 1 && total !== d.total) fail("BATCH_PAGINATION_INVALID");
      total = d.total; items.push(...d.items);
      if (items.length === total) break;
      if (!d.items.length || items.length > total || page === 10) fail("BATCH_TRUNCATED");
    }
    if (items.length !== total || items.some(x => typeof x.batchId !== "string") || new Set(items.map(x => x.batchId)).size !== total
      || items.some(x => x.collectorEvidence?.executionId === t.executionId || x.collectorEvidence?.runId === t.runId)) fail("NEW_BATCH_EFFECT_PRESENT");
    const details = [];
    for (const item of items) {
      const q = new URLSearchParams({ operation: "batches", batchId: item.batchId });
      const e = await io.readGet(`${plan.baseUrl}/api/inventory/jd-logistics?${q}`, request), d = e.data;
      if (e.success !== true || d?.total !== 1 || !Array.isArray(d.items) || d.items.length !== 1 || d.items[0]?.batchId !== item.batchId
        || d.items[0].sourceKind !== op.sourceKind || d.items[0].departmentId !== t.departmentId || d.items[0].businessUnitCode !== t.businessUnitCode
        || !d.items[0].currentSelection) fail("EXACT_BATCH_SELECTION_UNAVAILABLE");
      details.push(d.items[0]);
    }
    result.push({ sourceKind: op.sourceKind, total, items, details });
  }
  if (logisticsHash(result) !== t.batchesHash) fail("HISTORICAL_BATCH_STATE_CHANGED");
  return result.map(x => ({ sourceKind: x.sourceKind, total: x.total }));
}

async function originalCode(runtime: string, t: Login9851Target, execution: ReturnType<typeof read9851Execution>) {
  const original = path.join(runtime, "releases", t.originalReleaseId), current = path.join(runtime, "releases", t.releaseId);
  if (sha(await io.bytes(path.join(original, "deployment-manifest.json"))) !== t.originalManifestSha256
    || sha(await io.bytes(path.join(original, "audit/helper-build-receipt.json"))) !== t.originalHelperReceiptSha256) fail("ORIGINAL_RUNTIME_CHANGED");
  const oldReceipt = JSON.parse((await io.bytes(path.join(original, "audit/helper-build-receipt.json"))).toString("utf8"));
  if (oldReceipt.status !== "passed" || oldReceipt.helperTree?.sha256 !== t.helperTreeSha256 || oldReceipt.helperTree?.fileCount !== 4
    || !oldReceipt.evidence?.inputFiles?.some((x: { relativePath?: unknown; sha256?: unknown }) => x.relativePath === "tools/jd-logistics-export.ts" && x.sha256 === t.exporterSha256)) fail("ORIGINAL_HELPER_BINDING_CHANGED");
  const names = (await readdir(path.join(current, "helper"))).sort();
  if (!same((await readdir(path.join(original, "helper"))).sort(), names)) fail("ORIGINAL_HELPER_MEMBERS_CHANGED");
  for (const name of names) {
    if (sha(await io.bytes(path.join(original, "helper", name), 20 * 1024 * 1024)) !== sha(await io.bytes(path.join(current, "helper", name), 20 * 1024 * 1024))) fail("HELPER_BYTES_DIFFER");
  }
  const source = await io.bytes(path.join(original, "source-snapshot/tools/jd-logistics-export.ts"));
  if (sha(source) !== t.exporterSha256) fail("ORIGINAL_EXPORTER_CHANGED");
  const text = source.toString("utf8"), surface = text.slice(text.indexOf("async function businessSurface("), text.indexOf("export async function waitForJdLogisticsIdentity("));
  if ((text.match(/fail\("JD_LOGISTICS_LOGIN_REQUIRED"\)/g) ?? []).length !== 1 || !surface.includes('fail("JD_LOGISTICS_LOGIN_REQUIRED")')
    || !/const business = await navigate\(\);\s+await identity\(business, observedCodes, options.businessUnitCode\);/.test(text)
    || text.indexOf("const business = await navigate()") > text.indexOf("const exported = await exportFlowSource(page")) fail("PREEXPORT_FAILURE_NOT_PROVEN");
  const loadActivation = async (file: string, expected: string) => {
    if (path.basename(file) !== file || !/^[a-f0-9]{64}\.json$/.test(file)) fail("ACTIVATION_PATH_INVALID");
    const p = path.join(runtime, "state/worker-release-successors", file), data = await io.bytes(p);
    if (sha(data) !== expected || (await io.bytes(p + ".sha256")).toString("utf8").trim() !== expected) fail("ACTIVATION_RECORD_CHANGED");
    const record = JSON.parse(data.toString("utf8")), { payloadSha256, ...payload } = record;
    if (logisticsHash(payload) !== payloadSha256) fail("ACTIVATION_PAYLOAD_CHANGED");
    return record;
  };
  const before = await loadActivation(t.activationInFile, t.activationInSha256), after = await loadActivation(t.activationOutFile, t.activationOutSha256);
  if (before.sequence + 1 !== after.sequence || !same(before.successor, after.predecessor)
    || before.successor.releaseId !== t.originalReleaseId || before.successor.manifestSha256 !== t.originalManifestSha256
    || after.successor.releaseId !== t.releaseId || after.successor.manifestSha256 !== t.releaseManifestSha256
    || !(Date.parse(before.activatedAt) < execution.startedAt && execution.stoppedAt < Date.parse(after.activatedAt))) fail("ORIGINAL_EXECUTION_CODE_INTERVAL_CHANGED");
  return { releaseId: t.originalReleaseId, exporterSha256: t.exporterSha256, activationInSha256: t.activationInSha256, activationOutSha256: t.activationOutSha256 };
}

async function inspect(o: Options, t: Login9851Target, archive?: string) {
  const directory = path.join(o.root, "outputs/jd-logistics-pipeline"), activeBytes = await io.bytes(archive ?? path.join(directory, "active.json"));
  const manifestBytes = await io.bytes(path.join(directory, `${t.runId}.json`));
  if (sha(activeBytes) !== t.activeSha256 || sha(manifestBytes) !== t.manifestSha256) fail("ORIGINAL_BYTES_CHANGED");
  const active = JSON.parse(activeBytes.toString("utf8")), plan = JSON.parse(manifestBytes.toString("utf8")) as JdLogisticsManifest;
  assertLogisticsManifest(plan, t.executionId);
  if (!same(active, { runId: t.runId, executionId: t.executionId, planHash: t.planHash }) || plan.planHash !== t.planHash
    || plan.runId !== t.runId || plan.baseUrl !== "http://localhost:3000" || plan.stage !== "failed" || plan.outcome !== "pending"
    || plan.failure?.code !== t.failureCode || plan.failure.stage !== "run" || !same(plan.notification, { stage: "pending" })
    || plan.notificationPlan.enabled || plan.notificationPlan.departmentIds.length || plan.operations.length !== 4
    || !same(plan.operations.map(x => x.sourceKind), ["flow", "shop_products", "realtime_inventory", "inventory_snapshot"])
    || plan.operations.some((op, i) => op.stage !== (i === 0 ? "exporting" : "planned") || op.departmentId !== t.departmentId
      || op.businessUnitCode !== t.businessUnitCode || op.collectorStoreKey !== t.storeKey
      || [op.export, op.receipt, op.rowCount, op.contentHash, op.parserVersion].some(x => x !== undefined))) fail("PLAN_HAS_EFFECTS_OR_CHANGED");
  const runDir = path.join(directory, "downloads", t.runId), flowDir = path.join(runDir, plan.operations[0].operationId);
  await io.ordinary(runDir, true); await io.ordinary(flowDir, true);
  if (!same(await readdir(runDir), [plan.operations[0].operationId]) || (await readdir(flowDir)).length) fail("DOWNLOAD_EFFECT_PRESENT");
  const configBytes = await io.bytes(path.join(o.root, "config/jd-logistics-sources.json")), registryBytes = await io.bytes(path.join(o.root, "config/jd-store-accounts.json"));
  if (sha(configBytes) !== t.sourceConfigSha256 || sha(registryBytes) !== t.registrySha256) fail("SOURCE_CONFIGURATION_CHANGED");
  const stores = validateJdStoreRegistry(JSON.parse(registryBytes.toString("utf8")), o.root), store = stores.find(x => x.storeKey === t.storeKey);
  if (!store?.enabled || store.browser.debugPort !== t.debugPort) fail("PROFILE_CHANGED");
  const request = o.request ?? fetch, envelope = await io.readGet(`${plan.baseUrl}/api/inventory/jd-logistics?operation=settings`, request);
  if (envelope.success !== true || logisticsHash(envelope.data) !== t.settingsHash) fail("SETTINGS_CHANGED");
  const settings = parseJdLogisticsSettings(envelope.data), config = parseJdLogisticsConfig(JSON.parse(configBytes.toString("utf8")));
  const selected = selectJdLogisticsOperations(config, settings, stores, new Date(plan.anchorAt));
  if (selected.length !== 4 || selected.some((s, i) => !same(s, Object.fromEntries(Object.entries(plan.operations[i]).filter(([key]) => key !== "stage"))))) fail("POLICY_OR_SCOPE_REVISION_CHANGED");
  const batches = await historyBatches(plan, t, request); await io.ordinary(o.databasePath);
  const n8n = read9851Execution(o.databasePath, t);
  // The existing checker is used only for the separately pinned CURRENT
  // release/process. Historical code binding is independently proved above.
  const installed = await io.installedEvidence(o.runtime, t), originalExecutionCodeBinding = await originalCode(o.runtime, t, n8n);
  const p = await (o.processProbe ?? io.inspectHelperProcess)();
  const command = `"${path.win32.join("C:/Program Files/nodejs/node.exe")}" ${path.join(installed.release, "helper/tmall-workflow-helper.mjs")} serve --port 5791`;
  if (p.pid !== t.helperPid || p.parentPid !== t.supervisorPid || p.creationDate !== t.helperCreationDate
    || p.supervisorCreationDate !== t.supervisorCreationDate || p.commandLine.toLowerCase() !== command.toLowerCase()) fail("CURRENT_PROCESS_CHANGED");
  const health = await io.readGet("http://127.0.0.1:5791/health", request);
  if (health.ok !== true || health.stage !== "ready" || health.busy !== false || health.activeWorkflow !== null || health.drain !== null
    || !Array.isArray(health.storeExecutions) || health.storeExecutions.length || !await (o.portProbe ?? io.portClosed)(t.debugPort)) fail("CURRENT_HELPER_OR_PROFILE_BUSY");
  return { activeBytes, manifestBytes, process: p, n8n, originalExecutionCodeBinding, batches };
}

/** Exact one-execution operator. Caller freezes the original n8n workflow
 * using its official UI and exclusively owns its manual entry during closure.
 * Never restore its schedule after an unknown/incomplete archival outcome. */
export async function closeJdLogisticsLogin9851(o: Options, action: "inspect" | "apply" = "inspect") {
  const t = o.target ?? jdLogin9851Target;
  if (![o.root, o.runtime, o.databasePath].every(path.isAbsolute) || !["inspect", "apply"].includes(action)) fail("OPTIONS_INVALID");
  const directory = path.join(o.root, "outputs/jd-logistics-pipeline"); await io.ordinary(directory, true); await io.ordinary(o.root, true);
  return withJackyunRunLock({ runId: "close-9851", purpose: "jd-logistics-login-9851", lockDirectory: path.join(directory, "pipeline.lock") }, pipeline =>
    withJackyunRunLock({ runId: "close-9851", purpose: "jd-logistics-login-9851", lockDirectory: defaultJdChromiumRunLockDirectory(o.root) }, async chromium => {
      const recovery = path.join(directory, `login-9851-${t.activeSha256.slice(0, 16)}`); await io.absent(recovery);
      const first = await inspect(o, t); await pipeline.assertOwned(); await chromium.assertOwned();
      const intent = { version: "jd-logistics-login-9851-closure-v1", status: "eligible_intent", at: new Date().toISOString(), target: t,
        originalFailureRetained: true, oldExecutionReplayAllowed: false, originalExecutionCodeBinding: first.originalExecutionCodeBinding,
        historicalBatches: first.batches, archivePath: path.join(recovery, "active.archived.json") };
      if (action === "inspect") return intent;
      await mkdir(recovery); await io.ordinary(recovery, true);
      await io.createOnly(path.join(recovery, "active.original.json"), first.activeBytes);
      await io.createOnly(path.join(recovery, "manifest.original.json"), first.manifestBytes);
      await io.createOnly(path.join(recovery, "intent.json"), io.jsonBytes(intent));
      await o.checkpoint?.("intent_written");
      const final = await inspect(o, t); if (!same(final.process, first.process)) fail("PROCESS_CHANGED_DURING_CLOSURE");
      await pipeline.assertOwned(); await chromium.assertOwned(); await o.checkpoint?.("before_move");
      const active = path.join(directory, "active.json"), manifest = path.join(directory, `${t.runId}.json`);
      read9851Execution(o.databasePath, t); await pipeline.assertOwned(); await chromium.assertOwned();
      if (sha(await io.bytes(active)) !== t.activeSha256 || sha(await io.bytes(manifest)) !== t.manifestSha256) fail("FINAL_BYTES_CHANGED");
      await io.ordinary(recovery, true); await io.absent(intent.archivePath); await io.moveNoReplace(active, intent.archivePath);
      await o.checkpoint?.("after_move"); await io.absent(active);
      const after = await inspect(o, t, intent.archivePath); if (!same(after.process, first.process)) fail("PROCESS_CHANGED_AFTER_ARCHIVE");
      await pipeline.assertOwned(); await chromium.assertOwned(); await o.checkpoint?.("before_committed"); await io.absent(active);
      const terminal = await inspect(o, t, intent.archivePath); if (!same(terminal.process, first.process)) fail("PROCESS_CHANGED_BEFORE_COMMIT");
      await pipeline.assertOwned(); await chromium.assertOwned();
      const committed = { ...intent, status: "committed", committedAt: new Date().toISOString(), intentSha256: sha(io.jsonBytes(intent)),
        nextAction: "Restore only the frozen original published version, then one new complete n8n execution from A; never retry 9851." };
      await io.createOnly(path.join(recovery, "committed.json"), io.jsonBytes(committed));
      return committed;
    }));
}
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const action = process.argv[2];
  if (process.argv.length !== 3 || !["inspect", "apply"].includes(action)) throw new Error("JD_LOGIN_9851_USAGE_INSPECT_OR_APPLY");
  closeJdLogisticsLogin9851({ root: "D:/运营管理系统", runtime: "D:/teruisi-runtime/teruisi-worker-sales", databasePath: "C:/Users/86137/.n8n/database.sqlite" }, action as "inspect" | "apply")
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error instanceof Error && /^JD_(?:LOGIN_9851|PREEXPORT)_[A-Z_]+$/.test(error.message) ? error.message : "JD_LOGIN_9851_EVIDENCE_UNKNOWN"); process.exitCode = 1; });
}
