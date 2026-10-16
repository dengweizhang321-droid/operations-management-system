import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { defaultJdChromiumRunLockDirectory } from "../lib/jd/chromium-run-lock";
import { assertLogisticsExport, assertLogisticsManifest, logisticsContentHash, logisticsPlanHash, type JdLogisticsManifest } from "../lib/jd/logistics-manifest";
import { canonicalLogisticsJson, logisticsHash, parseJdLogisticsConfig, parseJdLogisticsSettings, selectJdLogisticsOperations } from "../lib/jd/logistics-policy";
import { validateJdStoreRegistry } from "../lib/jd/store-registry";
import { JD_LOGISTICS_MAX_FILE_BYTES, parseJdLogisticsWorkbook } from "../lib/inventory/jd-logistics-workbook";
import { logisticsExportIdentity, type LogisticsExportManifest } from "./jd-logistics-export";
import { jdPreexportEvidence as io, preexportSha256 as sha, type PreexportOptions, type PreexportTarget } from "./close-jd-logistics-preexport";

// A separate, exact profile. 9581 has a completed download, so the old
// pre-export/no-download operator cannot and must not accept this failure.
export const jdKnownFlowTarget = Object.freeze({
  failureCode: "JD_LOGISTICS_PRODUCT_STATUS_CONTROL_AMBIGUOUS", executionId: "9581", workflowId: "JdLogisticsDaily2026",
  runId: "jdl-4a3c1b66-daa8-433a-9842-1ac636c62e0f", planHash: "1cded6bc5e8c643a21069976350cf841a78d5644e03a6badd292a1590500ed0e",
  activeSha256: "d2cdbf2404298f3327f4d962fb250885de728d93b2da5e1923c5cc865906d4ff", manifestSha256: "c845d7e45030032ac77c07ea6b97025643e8981f96062ead53b6ff16c4f1c59b",
  executionDataSha256: "92961fd9f8cb93e4be6ed39317ae76f558d0abb14b6fcb1e7a5742cc8924b5a4",
  departmentId: "jd-yiyong-4418046540089", businessUnitCode: "EBU4418046540089", storeKey: "jd-yiyong-director", debugPort: 9224,
  releaseId: "20261016T021943Z-228f5e3dc3956a5c", releaseManifestSha256: "cbcb6dfc214b7402e16cdd4e8b784eb4fa276680dc9c706243f2d36af87a26bc",
  helperReceiptSha256: "ae910a126c514a62e6596003a73a646e6e28fb9f102ff7846ab55b2da906353d", helperTreeSha256: "e9a37a41a923dbf0278fe92140fd7ac807a0e04f0ebe28f815f2be29636c6720",
  exporterSha256: "914a477115b29d3cbb3fa9744dc0ffcdeec8c838539a6f77a1561ee0b78324bc", pipelineSha256: "f0a3424db715bec7588b332cd0dd8bd3e1d5526f34eb3cee333332127ecbd0d5",
  sourceConfigSha256: "34a9497443a509080f20911c6a6db56511dc95c651258f3da3994bd4bcf50a6d", registrySha256: "fdaaaa1cef550ec34fb58e84cb09df4edb77e1fddc446225d20e0031dd5be332",
  exportManifestSha256: "8ea7b7289e2df65bf8adc6c5d910552a1c28b6082bd3bd09eb586a06ced6f8b7", flowRawSha256: "5c2082e8ebf0f28e0b5bcaac282f239dabf2abf9abc4c21c701ae39727c68cb8",
  flowBytes: 110097, flowRows: 215, flowContentHash: "48eddcbaba7995f50ca6968099aa9d0d771df078adcbc709f94bb4d22ba74e3e",
  flowExportIdentity: "2f2c744feef9d378557373a607d6d005c0b93ee727e3b0524887f22c767f3c28", flowFullScopeHash: "701a254285d78f6ac1f8794d6f73eaf7dd8df325d30c6a5ef1004d23c57b6e5a",
  flowRequestHash: "b99839c51cd6c08187d9b5ed4f84f85ca28c8edd6289bd6f6b861472c6e52d2c", flowAttachmentHash: "21fd4bf53946d1db3725ea225b7074994e06ee1f6aa2155f686389e5461870da",
  flowDirectRequestId: "e3991dc4-a653-499b-a3b5-8dff73935ff2", flowCollectedAt: "2026-10-16T03:35:50.025Z",
  supervisorPid: 48332, supervisorCreationDate: "2026-10-16T03:22:17.7098970Z", helperPid: 59092, helperCreationDate: "2026-10-16T03:22:26.8892900Z",
});
export type KnownFlowTarget = PreexportTarget & { -readonly [K in keyof typeof jdKnownFlowTarget]: typeof jdKnownFlowTarget[K] extends number ? number : string };
export type KnownFlowOptions = Omit<PreexportOptions, "target"> & { target?: KnownFlowTarget };
function fail(code: string): never { throw new Error(`JD_KNOWN_FLOW_${code}`); }
const equal = (a: unknown, b: unknown) => canonicalLogisticsJson(a) === canonicalLogisticsJson(b);
const kinds = ["flow", "shop_products", "realtime_inventory", "inventory_snapshot"];
export function readJdKnownFlowN8n(databasePath: string, target: KnownFlowTarget) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN");
    const workflow = db.prepare("SELECT id,active FROM workflow_entity WHERE id=?").get(target.workflowId);
    const execution = db.prepare("SELECT id,workflowId,status,mode,startedAt,stoppedAt,retrySuccessId,deletedAt FROM execution_entity WHERE id=? AND workflowId=?").get(target.executionId, target.workflowId);
    const active = db.prepare("SELECT COUNT(*) AS count FROM execution_entity WHERE workflowId=? AND status NOT IN ('error','success','canceled','crashed')").get(target.workflowId);
    const data = db.prepare("SELECT data FROM execution_data WHERE executionId=? AND length(data)<=1048576").get(target.executionId)?.data;
    if (!workflow || workflow.active !== 0 || !execution || execution.status !== "error" || execution.mode !== "manual" || execution.retrySuccessId !== null || execution.deletedAt !== null
      || typeof execution.startedAt !== "string" || typeof execution.stoppedAt !== "string" || !Number.isFinite(Date.parse(execution.startedAt + "Z")) || !Number.isFinite(Date.parse(execution.stoppedAt + "Z"))
      || Date.parse(execution.stoppedAt + "Z") <= Date.parse(execution.startedAt + "Z") || active?.count !== 0 || typeof data !== "string" || sha(data) !== target.executionDataSha256) fail("N8N_TERMINAL_EVIDENCE_REJECTED");
    const values = JSON.parse(data);
    if (!Array.isArray(values) || values.length > 10000) fail("N8N_DATA_INVALID");
    const deref = (v: unknown): any => typeof v === "string" && /^\d+$/.test(v) ? values[Number(v)] : v;
    const obj = (v: unknown) => io.object(deref(v));
    const arr = (v: unknown): any[] => { const a = deref(v); if (!Array.isArray(a)) fail("N8N_ARRAY_INVALID"); return a; };
    const result = obj(obj(values[0]).resultData), run = obj(result.runData), aName = "A·冻结事业部来源与日期计划", bName = "B·串行下载全文件校验并导入", releaseName = "失败后释放原执行 helper";
    const expected = ["手动完整运行", "领取共享 helper", "已领取执行所有权？", "等待5分钟后重新领取", aName, bName, releaseName, "保留证据并明确失败"];
    if (!equal(Object.keys(run).sort(), expected.sort()) || deref(result.lastNodeExecuted) !== "保留证据并明确失败") fail("N8N_STAGE_REJECTED");
    const tasks = (name: string, count = 1) => { const a = arr(run[name]); if (a.length !== count) fail("N8N_REPLAY_REJECTED"); return a.map(obj); };
    const output = (t: Record<string, any>, branch: number) => {
      const main = arr(obj(t.data).main), items = arr(main[branch]);
      if (items.length !== 1 || main.some((v, i) => i !== branch && arr(v).length)) fail("N8N_OUTPUT_REJECTED");
      return obj(obj(items[0]).json);
    };
    // Original 9581 waited twice for an unrelated helper owner before A.
    // Those waits are not business retries; no A/B node may repeat.
    const claims = tasks("领取共享 helper", 3), decisions = tasks("已领取执行所有权？", 3), waits = tasks("等待5分钟后重新领取", 2);
    for (let i = 0; i < 3; i++) {
      const claim = output(claims[i], 0), decision = output(decisions[i], i < 2 ? 1 : 0);
      if (deref(claims[i].executionStatus) !== "success" || deref(decisions[i].executionStatus) !== "success" || !equal(claim, decision)
        || deref(claim.ok) !== true || deref(claim.workflow) !== "jd-logistics" || deref(claim.coordinationStatus) !== (i < 2 ? "waiting" : "granted")
        || i < 2 && (deref(waits[i].executionStatus) !== "success" || !equal(output(waits[i], 0), claim))) fail("N8N_COORDINATION_REJECTED");
    }
    const manual = tasks("手动完整运行")[0], a = tasks(aName)[0], b = tasks(bName)[0], release = tasks(releaseName)[0], final = tasks("保留证据并明确失败")[0];
    const ap = output(a, 0), bp = output(b, 1), rp = output(release, 0), error = obj(bp.error);
    if (deref(manual.executionStatus) !== "success" || [a, b, release].some(t => deref(t.executionStatus) !== "success") || deref(final.executionStatus) !== "error"
      || !equal([a, b, release, final].map(t => t.executionIndex), [3, 4, 5, 6]) || deref(ap.runId) !== target.runId || deref(ap.stage) !== "planned" || deref(ap.operationCount) !== 4
      || deref(bp.runId) !== target.runId || deref(error.status) !== 500 || !String(deref(error.message)).includes(target.failureCode)
      || deref(rp.ok) !== true || deref(rp.stage) !== "released" || deref(rp.workflow) !== "jd-logistics") fail("N8N_FAILURE_OR_RELEASE_REJECTED");
    return { executionId: target.executionId, workflowId: target.workflowId, status: "error", active: false, activeExecutions: 0, preAWaits: 2,
      executionDataSha256: target.executionDataSha256, stoppedAt: execution.stoppedAt };
  } finally { db.close(); }
}
function ordered(source: string, markers: string[]) {
  let cursor = 0;
  for (const marker of markers) { const at = source.indexOf(marker, cursor); if (at < cursor) fail("INSTALLED_ORDER_UNPROVEN"); cursor = at + marker.length; }
}
async function installedBarrier(runtime: string, target: KnownFlowTarget) {
  const installed = await io.installedEvidence(runtime, target);
  const pipeline = await io.bytes(path.join(installed.release, "source-snapshot/tools/jd-logistics-n8n-pipeline.ts"));
  const receipt = JSON.parse((await io.bytes(path.join(installed.release, "audit/helper-build-receipt.json"))).toString("utf8"));
  if (sha(pipeline) !== target.pipelineSha256 || !receipt.evidence?.inputFiles?.some((f: any) => f.relativePath === "tools/jd-logistics-n8n-pipeline.ts" && f.sha256 === target.pipelineSha256)) fail("INSTALLED_PIPELINE_CHANGED");
  const exporter = (await io.bytes(path.join(installed.release, "source-snapshot/tools/jd-logistics-export.ts"))).toString("utf8");
  const statusStart = exporter.indexOf("async function selectEnabledProductStatus("), statusEnd = exporter.indexOf("async function sourceRowCount(", statusStart);
  const statusSource = exporter.slice(statusStart, statusEnd);
  if (statusStart < 0 || statusEnd < statusStart || exporter.split(target.failureCode).length - 1 !== statusSource.split(target.failureCode).length - 1
    || !statusSource.includes(target.failureCode)) fail("PRODUCT_ERROR_LOCATION_UNPROVEN");
  ordered(exporter.slice(exporter.indexOf("async function exportEnabledProducts("), exporter.indexOf("async function exportFlowSource(")),
    ["await selectEnabledProductStatus(surface)", 'uniqueButton(surface, "查询")', 'stage: "baseline"', "await writeJsonDurable(manifestPath, manifest)", 'manifest.stage = "submitting"', "await clickExport(surface, options)"]);
  ordered(pipeline.toString("utf8").slice(pipeline.toString("utf8").indexOf("export async function runJdLogisticsN8nPlan(")),
    ["for (const operation of plan.operations)", "const result = await exporter(", 'operation.stage = "validated"', "for (const operation of plan.operations)", 'operation.stage = "importing"', 'operation: "import"']);
  return installed;
}
async function inspect(options: KnownFlowOptions, target: KnownFlowTarget, archivedActivePath?: string) {
  const directory = path.join(options.root, "outputs/jd-logistics-pipeline"), activePath = path.join(directory, "active.json");
  if (archivedActivePath) await io.absent(activePath);
  const activeBytes = await io.bytes(archivedActivePath ?? activePath), manifestBytes = await io.bytes(path.join(directory, `${target.runId}.json`));
  if (sha(activeBytes) !== target.activeSha256 || sha(manifestBytes) !== target.manifestSha256) fail("ORIGINAL_SHA_CHANGED");
  const active = JSON.parse(activeBytes.toString("utf8")), plan: JdLogisticsManifest = JSON.parse(manifestBytes.toString("utf8"));
  if (!equal(active, { runId: target.runId, executionId: target.executionId, planHash: target.planHash })) fail("ACTIVE_IDENTITY_REJECTED");
  assertLogisticsManifest(plan, target.executionId);
  if (plan.runId !== target.runId || logisticsPlanHash(plan) !== target.planHash || plan.stage !== "failed" || plan.outcome !== "pending"
    || plan.failure?.code !== target.failureCode || plan.failure.stage !== "run" || !equal(plan.notification, { stage: "pending" })
    || plan.notificationPlan.enabled !== false || plan.notificationPlan.departmentIds.length || plan.baseUrl !== "http://localhost:3000") fail("FAILED_STAGE_REJECTED");
  if (plan.operations.length !== 4 || plan.operations.some((op, i) => op.sourceKind !== kinds[i] || op.stage !== ["validated", "exporting", "planned", "planned"][i]
    || op.departmentId !== target.departmentId || op.businessUnitCode !== target.businessUnitCode || op.collectorStoreKey !== target.storeKey || op.initialScopeRevision !== 0
    || op.receipt !== undefined || i > 0 && [op.export, op.rowCount, op.contentHash, op.parserVersion].some(v => v !== undefined))) fail("OPERATION_EFFECTS_REJECTED");
  const flow = plan.operations[0], runDirectory = path.join(directory, "downloads", target.runId), flowDirectory = path.join(runDirectory, flow.operationId);
  await io.ordinary(runDirectory, true);
  if (!equal((await readdir(runDirectory)).sort(), plan.operations.slice(0, 2).map(op => op.operationId).sort())) fail("DOWNLOAD_LAYOUT_CHANGED");
  await io.ordinary(flowDirectory, true); await io.ordinary(path.join(runDirectory, plan.operations[1].operationId), true);
  if (!equal((await readdir(flowDirectory)).sort(), ["export-manifest.json", "source.csv"]) || (await readdir(path.join(runDirectory, plan.operations[1].operationId))).length) fail("DOWNLOAD_FILES_CHANGED");
  const csvPath = path.join(flowDirectory, "source.csv"), exportManifestPath = path.join(flowDirectory, "export-manifest.json");
  const csv = await io.bytes(csvPath, JD_LOGISTICS_MAX_FILE_BYTES), exportBytes = await io.bytes(exportManifestPath), exported: LogisticsExportManifest = JSON.parse(exportBytes.toString("utf8"));
  const sourceConfig = await io.bytes(path.join(options.root, "config/jd-logistics-sources.json")), registry = await io.bytes(path.join(options.root, "config/jd-store-accounts.json"));
  if (sha(sourceConfig) !== target.sourceConfigSha256 || sha(registry) !== target.registrySha256) fail("SOURCE_CONFIGURATION_CHANGED");
  const config = parseJdLogisticsConfig(JSON.parse(sourceConfig.toString("utf8"))), stores = validateJdStoreRegistry(JSON.parse(registry.toString("utf8")), options.root);
  const store = stores.find(s => s.storeKey === target.storeKey);
  if (!store || store.browser.debugPort !== target.debugPort || config.bindings.length !== 4 || config.bindings.some(b => !b.enabled || b.departmentId !== target.departmentId
    || b.businessUnitCode !== target.businessUnitCode || b.collectorStoreKey !== target.storeKey || !equal(b.authorizedStoreKeys, [target.storeKey]))) fail("CONFIG_SCOPE_CHANGED");
  const identity = logisticsExportIdentity({ ...flow, sourceStatus: undefined, root: options.root, runId: plan.runId, executionId: plan.executionId, store, downloadDirectory: flowDirectory, assertOwner: async () => {} });
  const result = exported.result;
  if (sha(exportBytes) !== target.exportManifestSha256 || exported.version !== 2 || exported.stage !== "downloaded" || exported.identity !== identity || identity !== target.flowExportIdentity
    || exported.runId !== target.runId || exported.executionId !== target.executionId || exported.operationId !== flow.operationId || !equal(exported.baseline, [])
    || exported.observedBusinessUnitCode !== target.businessUnitCode || exported.fullScopeHash !== target.flowFullScopeHash || exported.expectedRowCount !== target.flowRows
    || exported.directRequestId !== target.flowDirectRequestId || exported.requestEvidence?.requestHash !== target.flowRequestHash || exported.requestEvidence.attachmentHash !== target.flowAttachmentHash
    || exported.requestEvidence.observedBusinessUnitCode !== target.businessUnitCode || exported.requestEvidence.requestedAt !== target.flowCollectedAt
    || exported.queryEvidence?.requestHash !== target.flowRequestHash || exported.queryEvidence.total !== target.flowRows
    || !result || !io.samePath(result.filePath, csvPath) || !io.samePath(exported.filePath ?? "", csvPath)
    || result.collectedAt !== target.flowCollectedAt || result.identityEvidence.observedAt !== target.flowCollectedAt
    || result.taskIdentity !== exported.taskIdentity || result.taskIdentity !== `direct:${logisticsHash({ requestId: exported.directRequestId, requestHash: target.flowRequestHash, attachmentHash: target.flowAttachmentHash })}`) fail("FLOW_EXPORT_BINDING_REJECTED");
  const times = [plan.createdAt, exported.queryEvidence.observedAt, exported.submittedAt, target.flowCollectedAt, plan.failure.at].map(v => Date.parse(v ?? ""));
  if (times.some(v => !Number.isFinite(v)) || times.some((v, i) => i > 0 && v < times[i - 1])) fail("FLOW_TIME_ORDER_REJECTED");
  assertLogisticsExport(flow, result, new Date(target.flowCollectedAt));
  const { filePath: _filePath, ...resultEvidence } = result;
  if (!flow.export || !equal(flow.export, { ...resultEvidence, relativePath: path.relative(options.root, csvPath).split(path.sep).join("/"), rawFileHash: target.flowRawSha256, bytes: target.flowBytes })
    || csv.length !== target.flowBytes || sha(csv) !== target.flowRawSha256 || exported.rawFileHash !== target.flowRawSha256 || exported.byteSize !== target.flowBytes
    || flow.rowCount !== target.flowRows || flow.contentHash !== target.flowContentHash || flow.parserVersion !== "jd-logistics-workbook-v1") fail("FLOW_FILE_EVIDENCE_REJECTED");
  const rows = parseJdLogisticsWorkbook(csv, "flow", target.businessUnitCode, { collectedAt: target.flowCollectedAt });
  if (rows.length !== target.flowRows || logisticsContentHash(rows) !== target.flowContentHash) fail("FLOW_CONTENT_REJECTED");
  const request = options.request ?? fetch, envelope = await io.readGet(`${plan.baseUrl}/api/inventory/jd-logistics?operation=settings`, request);
  if (envelope.success !== true) fail("SETTINGS_UNAVAILABLE");
  const settings = parseJdLogisticsSettings(envelope.data), department = settings.departments[0];
  if (settings.departments.length !== 1 || department?.id !== target.departmentId || department.businessUnitCode !== target.businessUnitCode || !equal(department.storeKeys, [target.storeKey])
    || department.logisticsEnabled !== true || department.monitorEnabled !== false || department.pushEnabled !== false || settings.notification?.enabled !== false
    || settings.scopeRevisions.length || Object.values(department.capabilities).some(v => v !== true)) fail("BUSINESS_SCOPE_HAS_EFFECTS_OR_CHANGED");
  const selected = selectJdLogisticsOperations(config, settings, stores, new Date(plan.anchorAt));
  if (selected.length !== 4 || selected.some((s, i) => s.operationId !== plan.operations[i].operationId || s.policyHash !== plan.operations[i].policyHash || s.storeIdentityHash !== plan.operations[i].storeIdentityHash)) fail("POLICY_CHANGED");
  for (const op of plan.operations) {
    const query = new URLSearchParams({ operation: "batches", departmentId: target.departmentId, businessUnitCode: target.businessUnitCode, sourceKind: op.sourceKind, page: "1", pageSize: "1" });
    const response = await io.readGet(`${plan.baseUrl}/api/inventory/jd-logistics?${query}`, request), data = io.object(response.data);
    if (response.success !== true || data.total !== 0 || !equal(data.items, []) || data.page !== 1 || data.pageSize !== 1 || data.truncated === true) fail("BATCH_EFFECTS_OR_UNKNOWN");
  }
  await io.ordinary(options.databasePath);
  const n8n = readJdKnownFlowN8n(options.databasePath, target), installed = await installedBarrier(options.runtime, target);
  const processEvidence = await (options.processProbe ?? io.inspectHelperProcess)();
  const expectedCommand = `"C:\\Program Files\\nodejs\\node.exe" ${path.join(installed.release, "helper/tmall-workflow-helper.mjs")} serve --port 5791`;
  if (processEvidence.pid !== target.helperPid || processEvidence.creationDate !== target.helperCreationDate || processEvidence.parentPid !== target.supervisorPid
    || processEvidence.supervisorCreationDate !== target.supervisorCreationDate || processEvidence.commandLine.toLowerCase() !== expectedCommand.toLowerCase()) fail("HELPER_PROCESS_IDENTITY_REJECTED");
  const health = await io.readGet("http://127.0.0.1:5791/health", request);
  if (health.ok !== true || health.stage !== "ready" || health.busy !== false || health.activeWorkflow !== null || !equal(health.storeExecutions, []) || health.drain !== null) fail("HELPER_BUSY_OR_QUARANTINED");
  if (!await (options.portProbe ?? io.portClosed)(target.debugPort)) fail("BROWSER_PORT_OPEN_OR_UNKNOWN");
  return { activeBytes, manifestBytes, processEvidence, n8n, files: [
    { relativePath: path.relative(options.root, csvPath), bytes: csv.length, sha256: sha(csv) },
    { relativePath: path.relative(options.root, exportManifestPath), bytes: exportBytes.length, sha256: sha(exportBytes) }],
    installed: { exporterSha256: target.exporterSha256, pipelineSha256: target.pipelineSha256, helperTreeSha256: target.helperTreeSha256, helperReceiptSha256: target.helperReceiptSha256 } };
}
export async function closeJdLogisticsKnownFlow(options: KnownFlowOptions, action: "inspect" | "apply" = "inspect") {
  if (![options.root, options.runtime, options.databasePath].every(p => path.isAbsolute(p)) || !["inspect", "apply"].includes(action)) fail("ABSOLUTE_PATH_AND_ACTION_REQUIRED");
  const target = options.target ?? jdKnownFlowTarget, directory = path.join(options.root, "outputs/jd-logistics-pipeline");
  await io.ordinary(options.root, true); await io.ordinary(directory, true);
  return withJackyunRunLock({ runId: `jdl-known-close-${target.executionId}`, purpose: "jd-logistics-known-flow-closure", lockDirectory: path.join(directory, "pipeline.lock") }, pipeline =>
    withJackyunRunLock({ runId: `jdl-known-close-${target.executionId}`, purpose: "jd-chromium-known-flow-closure", lockDirectory: defaultJdChromiumRunLockDirectory(options.root) }, async chromium => {
      const recovery = path.join(directory, `known-flow-${target.executionId}-${target.activeSha256.slice(0, 16)}`);
      await io.absent(recovery); // No auto-resume, even after rename but before commit.
      const observed = await inspect(options, target);
      await pipeline.assertOwned(); await chromium.assertOwned();
      const intent = { version: "jd-logistics-known-flow-closure-v1", status: "eligible_intent", at: new Date().toISOString(), target,
        n8n: observed.n8n, helperProcess: { pid: observed.processEvidence.pid, creationDate: observed.processEvidence.creationDate }, installed: observed.installed,
        files: observed.files, archivePath: path.join(recovery, "active.archived.json"), originalFailureRetained: true, oldExecutionReplayAllowed: false,
        effects: { completedFlowDownload: true, businessImports: 0, remainingSourcesSubmitted: false },
        oldFlowDisposition: "audit_only_no_handoff_no_import_no_signed_url_reuse",
        nextAction: `Only a new complete n8n execution from A with four-source fresh acquisition; never retry ${target.executionId}. A fresh flow request is allowed; never reuse or relabel the old direct attachment.` };
      if (action === "inspect") return intent;
      await mkdir(recovery); await io.ordinary(recovery, true);
      await io.createOnly(path.join(recovery, "intent.json"), io.jsonBytes(intent));
      await io.createOnly(path.join(recovery, "active.original.json"), observed.activeBytes);
      await io.createOnly(path.join(recovery, "manifest.original.json"), observed.manifestBytes);
      await io.createOnly(path.join(recovery, "files.original.json"), io.jsonBytes(observed.files));
      const assertRecovery = async (moved: boolean) => {
        await io.ordinary(recovery, true);
        const expected = ["intent.json", "active.original.json", "manifest.original.json", "files.original.json", ...(moved ? ["active.archived.json"] : [])].sort();
        if (!equal((await readdir(recovery)).sort(), expected)
          || sha(await io.bytes(path.join(recovery, "intent.json"))) !== sha(io.jsonBytes(intent))
          || sha(await io.bytes(path.join(recovery, "active.original.json"))) !== target.activeSha256
          || sha(await io.bytes(path.join(recovery, "manifest.original.json"))) !== target.manifestSha256
          || sha(await io.bytes(path.join(recovery, "files.original.json"))) !== sha(io.jsonBytes(observed.files))) fail("RECOVERY_EVIDENCE_CHANGED");
      };
      await options.checkpoint?.("intent_written");
      const final = await inspect(options, target);
      if (!equal(final.processEvidence, observed.processEvidence)) fail("HELPER_PROCESS_CHANGED");
      await pipeline.assertOwned(); await chromium.assertOwned(); await options.checkpoint?.("before_move");
      await io.ordinary(recovery, true); await io.absent(intent.archivePath);
      // Full predicates, not just active SHA, must hold at the move boundary.
      const boundary = await inspect(options, target);
      if (!equal(boundary.processEvidence, observed.processEvidence)) fail("HELPER_PROCESS_CHANGED");
      await assertRecovery(false);
      await pipeline.assertOwned(); await chromium.assertOwned();
      await io.moveNoReplace(path.join(directory, "active.json"), intent.archivePath);
      await options.checkpoint?.("after_move");
      const after = await inspect(options, target, intent.archivePath);
      if (!equal(after.processEvidence, observed.processEvidence)) fail("HELPER_PROCESS_CHANGED");
      await pipeline.assertOwned(); await chromium.assertOwned(); await options.checkpoint?.("before_committed");
      const commitBoundary = await inspect(options, target, intent.archivePath);
      if (!equal(commitBoundary.processEvidence, observed.processEvidence)) fail("HELPER_PROCESS_CHANGED");
      await assertRecovery(true);
      await pipeline.assertOwned(); await chromium.assertOwned();
      const committed = { ...intent, status: "committed", committedAt: new Date().toISOString(), intentSha256: sha(io.jsonBytes(intent)) };
      await io.createOnly(path.join(recovery, "committed.json"), io.jsonBytes(committed));
      return committed;
    }));
}
async function main() {
  if (process.argv.length !== 3 || !["inspect", "apply"].includes(process.argv[2])) fail("USAGE_INSPECT_OR_APPLY_ONLY");
  console.log(JSON.stringify(await closeJdLogisticsKnownFlow({ root: "D:/运营管理系统", runtime: "D:/teruisi-runtime/teruisi-worker-sales", databasePath: "C:/Users/86137/.n8n/database.sqlite" }, process.argv[2] as "inspect" | "apply")));
}
if (process.argv[1] && io.samePath(process.argv[1], fileURLToPath(import.meta.url))) main().catch(error => {
  console.error(error instanceof Error && /^(JD_KNOWN_FLOW|JD_PREEXPORT)_[A-Z_]+$/.test(error.message) ? error.message : "JD_KNOWN_FLOW_EVIDENCE_REJECTED");
  console.error("STOP: retain original intent/evidence. No replay or fresh execution is authorized by an uncommitted archive."); process.exitCode = 1;
});
