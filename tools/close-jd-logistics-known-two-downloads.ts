import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { defaultJdChromiumRunLockDirectory } from "../lib/jd/chromium-run-lock";
import { assertLogisticsEnabledProducts, assertLogisticsExport, assertLogisticsManifest, logisticsContentHash, logisticsPlanHash, type JdLogisticsManifest } from "../lib/jd/logistics-manifest";
import { canonicalLogisticsJson, logisticsHash, parseJdLogisticsConfig, parseJdLogisticsSettings, selectJdLogisticsOperations } from "../lib/jd/logistics-policy";
import { validateJdStoreRegistry } from "../lib/jd/store-registry";
import { JD_LOGISTICS_MAX_FILE_BYTES, parseJdLogisticsWorkbook } from "../lib/inventory/jd-logistics-workbook";
import { logisticsExportIdentity, type LogisticsExportManifest } from "./jd-logistics-export";
import { jdPreexportEvidence as io, preexportSha256 as sha, type PreexportOptions, type PreexportTarget } from "./close-jd-logistics-preexport";


// Only 9607: two fully downloaded sources, then an exact pre-export realtime
// scope failure. This grants neither reuse/import of old files nor replay.
export const jdKnownTwoDownloadsTarget = Object.freeze<KnownTwoDownloadsTarget>({
  "failureCode": "JD_LOGISTICS_REALTIME_GRANULARITY_MISMATCH",
  "executionId": "9607",
  "workflowId": "JdLogisticsDaily2026",
  "runId": "jdl-ce4d594f-d110-4309-b10e-e899e06ae0be",
  "planHash": "4366f356bd2a2e878cecc0d0ced9dc0e4b308f7573db9abe1f61b91768af55e2",
  "activeSha256": "3965e4a4f63ad38625b5a6b743c2b7ee59d31c7c8a338eb4f50b36e68c36e462",
  "manifestSha256": "99c23c7417dd072ec4d569d5ae30b326071702b6e7140d0fe121cdae0665607a",
  "executionDataSha256": "666a238889f1c80187c4a79839e12125b9aac0cf0c4c9491fbbb55fe1fd871b9",
  "departmentId": "jd-yiyong-4418046540089",
  "businessUnitCode": "EBU4418046540089",
  "storeKey": "jd-yiyong-director",
  "debugPort": 9224,
  "releaseId": "20261016T042259Z-480b1bb8ae3f6605",
  "releaseManifestSha256": "12454c6d5727b590d7aa70680340781d56726c2da58bc4448515114235edee8e",
  "helperReceiptSha256": "a45fa686494d36aea9fa9a4d4f16e3a059500c11f633a94b57a3a9e50ccb7356",
  "helperTreeSha256": "fef18e9980ce5862a5fd2a542a2ff4e80a4d24640937bfd4ba38b3693346761e",
  "exporterSha256": "30d15ccc3064a342f02ecef803829d58dc64c70d0af9397214d7d31fed343a39",
  "pipelineSha256": "f0a3424db715bec7588b332cd0dd8bd3e1d5526f34eb3cee333332127ecbd0d5",
  "sourceConfigSha256": "34a9497443a509080f20911c6a6db56511dc95c651258f3da3994bd4bcf50a6d",
  "registrySha256": "fdaaaa1cef550ec34fb58e84cb09df4edb77e1fddc446225d20e0031dd5be332",
  "supervisorPid": 35280,
  "supervisorCreationDate": "2026-10-16T05:02:18.4302460Z",
  "helperPid": 55468,
  "helperCreationDate": "2026-10-16T05:02:26.6391030Z",
  "downloads": [
    {
      "sourceKind": "flow",
      "operationId": "33f89d5e0f620ea4cf8d10041b865346",
      "exportManifestSha256": "e84c03ff258517800757e72919b2f65bd7f8dd5a3ec15262b239577635e6f36a",
      "rawSha256": "b5d5b0f1f140dd8d0e7633482d88f56657e4d8f4908428780b350cadd24107f8",
      "bytes": 110097,
      "rows": 215,
      "contentHash": "48eddcbaba7995f50ca6968099aa9d0d771df078adcbc709f94bb4d22ba74e3e",
      "exportIdentity": "ac4d9bdb0c46f0e9da1bdec3d6695268d46e9ff0e4ed2b788b662b698b269ee5",
      "fullScopeHash": "701a254285d78f6ac1f8794d6f73eaf7dd8df325d30c6a5ef1004d23c57b6e5a",
      "requestHash": "b99839c51cd6c08187d9b5ed4f84f85ca28c8edd6289bd6f6b861472c6e52d2c",
      "queryRequestHash": "b99839c51cd6c08187d9b5ed4f84f85ca28c8edd6289bd6f6b861472c6e52d2c",
      "attachmentHash": "6d05617fc2d6ed081e6672c200af672d68c3dd43d8dc06c5e912e611d1811501",
      "collectedAt": "2026-10-16T05:05:08.950Z",
      "taskIdentity": "direct:2d16e6bdae66d0993679fc8f8df86c90ab3e7f155b3a88e90b8b4c0ae2237e3a",
      "directRequestId": "750e677f-f525-4163-8de8-46008c95a9a2"
    },
    {
      "sourceKind": "shop_products",
      "operationId": "75544bfae0f660f514d8a364eb61f9f2",
      "exportManifestSha256": "dfd798b27ac797d03cf60a4a9a38cee224040aae040003a8d64f6d3a33eb6a55",
      "rawSha256": "ebde8b0e7f7329f91f23e77e9f4a1e944f3dd25e2e730d42fbd874b706eb0175",
      "bytes": 211808,
      "rows": 906,
      "contentHash": "c23933fe03a84957cd8e2cb1c1417c81dee071568f65859a24d7a72d56e20a86",
      "exportIdentity": "f54ad135936f0a6afcbf9386a1b35f523c4c4907f4af32a8b7e0c86f556268be",
      "fullScopeHash": "1c2344fbf05394d2f7976ddf94a54b798895f185a8d4d6e77a55e25ae4018ae8",
      "requestHash": "d99705a269c0b1884564605cf7c09cd00479d047698c9bbaa6dd5aaf96bb591d",
      "queryRequestHash": "d8f6cf261a0fec592dd6dc3c754304ae388e1eb1bf44ad452b6c2e8b8ac1a7d6",
      "attachmentHash": "0b0599487330280eecf224a4eb72ca948e703adccc6531e870495aeaf7840c99",
      "collectedAt": "2026-10-16T05:05:18.953Z",
      "taskIdentity": "products:4418060962074",
      "productTaskEvidence": {
        "id": "4418060962074",
        "deptId": "4418046540089",
        "taskStatus": "3",
        "recordCount": 906,
        "successCount": 0,
        "createTime": "2026-10-16T13:05:19.0+08:00",
        "shopSetHash": "77913b0b7754756a40e59ce7a0441101626527debc54330f6a5c1ffa9d7cca9c",
        "shopCount": 5
      }
    }
  ]
});
export type DownloadPin = {
  sourceKind: "flow" | "shop_products"; operationId: string; exportManifestSha256: string;
  rawSha256: string; bytes: number; rows: number; contentHash: string; exportIdentity: string;
  fullScopeHash: string; requestHash: string; queryRequestHash: string; attachmentHash: string;
  collectedAt: string; taskIdentity: string; directRequestId?: string;
  productTaskEvidence?: { id: string; deptId: string; taskStatus: string; recordCount: number; successCount: number; createTime: string; shopSetHash: string; shopCount: number };
};
export type KnownTwoDownloadsTarget = PreexportTarget & { pipelineSha256: string; sourceConfigSha256: string; registrySha256: string; downloads: DownloadPin[] };
export type KnownTwoDownloadsOptions = Omit<PreexportOptions, "target"> & { target?: KnownTwoDownloadsTarget };
function fail(code: string): never { throw new Error(`JD_KNOWN_TWO_DOWNLOADS_${code}`); }
const equal = (a: unknown, b: unknown) => canonicalLogisticsJson(a) === canonicalLogisticsJson(b);
const kinds = ["flow", "shop_products", "realtime_inventory", "inventory_snapshot"];
export function readJdKnownTwoDownloadsN8n(databasePath: string, target: KnownTwoDownloadsTarget) {
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
    const expected = ["手动完整运行", "领取共享 helper", "已领取执行所有权？", aName, bName, releaseName, "保留证据并明确失败"];
    if (!equal(Object.keys(run).sort(), expected.sort()) || deref(result.lastNodeExecuted) !== "保留证据并明确失败") fail("N8N_STAGE_REJECTED");
    const tasks = (name: string, count = 1) => { const a = arr(run[name]); if (a.length !== count) fail("N8N_REPLAY_REJECTED"); return a.map(obj); };
    const output = (t: Record<string, any>, branch: number) => {
      const main = arr(obj(t.data).main), items = arr(main[branch]);
      if (items.length !== 1 || main.some((v, i) => i !== branch && arr(v).length)) fail("N8N_OUTPUT_REJECTED");
      return obj(obj(items[0]).json);
    };
    const claimTask = tasks("领取共享 helper")[0], decisionTask = tasks("已领取执行所有权？")[0];
    const claim = output(claimTask, 0), decision = output(decisionTask, 0);
    if (deref(claimTask.executionStatus) !== "success" || deref(decisionTask.executionStatus) !== "success" || !equal(claim, decision)
      || claimTask.executionIndex !== 1 || decisionTask.executionIndex !== 2 || deref(claim.ok) !== true || deref(claim.workflow) !== "jd-logistics"
      || deref(claim.coordinationStatus) !== "granted") fail("N8N_COORDINATION_REJECTED");
    const manual = tasks("手动完整运行")[0], a = tasks(aName)[0], b = tasks(bName)[0], release = tasks(releaseName)[0], final = tasks("保留证据并明确失败")[0];
    const ap = output(a, 0), bp = output(b, 1), rp = output(release, 0), error = obj(bp.error);
    if (deref(manual.executionStatus) !== "success" || [a, b, release].some(t => deref(t.executionStatus) !== "success") || deref(final.executionStatus) !== "error"
      || !equal([a, b, release, final].map(t => t.executionIndex), [3, 4, 5, 6]) || deref(ap.runId) !== target.runId || deref(ap.stage) !== "planned" || deref(ap.operationCount) !== 4
      || deref(bp.runId) !== target.runId || deref(error.status) !== 500 || !String(deref(error.message)).includes(target.failureCode)
      || deref(rp.ok) !== true || deref(rp.stage) !== "released" || deref(rp.workflow) !== "jd-logistics") fail("N8N_FAILURE_OR_RELEASE_REJECTED");
    return { executionId: target.executionId, workflowId: target.workflowId, status: "error", active: false, activeExecutions: 0, preAWaits: 0,
      executionDataSha256: target.executionDataSha256, stoppedAt: execution.stoppedAt };
  } finally { db.close(); }
}
function ordered(source: string, markers: string[]) {
  let cursor = 0;
  for (const marker of markers) { const at = source.indexOf(marker, cursor); if (at < cursor) fail("INSTALLED_ORDER_UNPROVEN"); cursor = at + marker.length; }
}
async function installedBarrier(runtime: string, target: KnownTwoDownloadsTarget) {
  const installed = await io.installedEvidence(runtime, target);
  const pipeline = await io.bytes(path.join(installed.release, "source-snapshot/tools/jd-logistics-n8n-pipeline.ts"));
  const receipt = JSON.parse((await io.bytes(path.join(installed.release, "audit/helper-build-receipt.json"))).toString("utf8"));
  if (sha(pipeline) !== target.pipelineSha256 || !receipt.evidence?.inputFiles?.some((f: any) => f.relativePath === "tools/jd-logistics-n8n-pipeline.ts" && f.sha256 === target.pipelineSha256)) fail("INSTALLED_PIPELINE_CHANGED");
  const exporter = (await io.bytes(path.join(installed.release, "source-snapshot/tools/jd-logistics-export.ts"))).toString("utf8");
  const scopeStart = exporter.indexOf("async function setScope("), scopeEnd = exporter.indexOf("export type LogisticsScopeReadback", scopeStart);
  const scopeSource = exporter.slice(scopeStart, scopeEnd);
  if (scopeStart < 0 || scopeEnd < scopeStart || exporter.split(target.failureCode).length - 1 !== scopeSource.split(target.failureCode).length - 1
    || !scopeSource.includes(target.failureCode)) fail("REALTIME_ERROR_LOCATION_UNPROVEN");
  ordered(exporter.slice(exporter.indexOf("export async function prepareJdLogisticsSourceScope("), exporter.indexOf("async function sourceRowCount(")),
    ["await setScope(surface, options)", "await selectAllWarehouseStatus(surface, options)"]);
  // Read-only download-center baseline queries and initial source reads may
  // precede the error. The export intent and export submission cannot.
  ordered(exporter.slice(exporter.indexOf("async function exportJhSource("), exporter.indexOf("function productTaskQueue(")),
    ["await prepareJdLogisticsSourceScope(surface, options)", 'stage: "baseline"', "await writeJsonDurable(manifestPath, manifest)",
      'manifest.stage = "submitting"', "await writeJsonDurable(manifestPath, manifest)", "await observedJhExport(page, surface, options)"]);
  ordered(pipeline.toString("utf8").slice(pipeline.toString("utf8").indexOf("export async function runJdLogisticsN8nPlan(")),
    ["for (const operation of plan.operations)", "const result = await exporter(", 'operation.stage = "validated"', "for (const operation of plan.operations)", 'operation.stage = "importing"', 'operation: "import"']);
  return installed;
}
async function inspect(options: KnownTwoDownloadsOptions, target: KnownTwoDownloadsTarget, archivedActivePath?: string) {
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
  if (target.downloads.length !== 2 || !equal(target.downloads.map(d => d.sourceKind), ["flow", "shop_products"])
    || plan.operations.length !== 4 || plan.operations.some((op, i) => op.sourceKind !== kinds[i] || op.stage !== ["validated", "validated", "exporting", "planned"][i]
    || op.departmentId !== target.departmentId || op.businessUnitCode !== target.businessUnitCode || op.collectorStoreKey !== target.storeKey || op.initialScopeRevision !== 0
    || op.receipt !== undefined || i > 1 && [op.export, op.rowCount, op.contentHash, op.parserVersion].some(v => v !== undefined))) fail("OPERATION_EFFECTS_REJECTED");
  const sourceConfig = await io.bytes(path.join(options.root, "config/jd-logistics-sources.json")), registry = await io.bytes(path.join(options.root, "config/jd-store-accounts.json"));
  if (sha(sourceConfig) !== target.sourceConfigSha256 || sha(registry) !== target.registrySha256) fail("SOURCE_CONFIGURATION_CHANGED");
  const config = parseJdLogisticsConfig(JSON.parse(sourceConfig.toString("utf8"))), stores = validateJdStoreRegistry(JSON.parse(registry.toString("utf8")), options.root);
  const store = stores.find(s => s.storeKey === target.storeKey);
  if (!store || store.browser.debugPort !== target.debugPort || config.bindings.length !== 4 || config.bindings.some(b => !b.enabled || b.departmentId !== target.departmentId
    || b.businessUnitCode !== target.businessUnitCode || b.collectorStoreKey !== target.storeKey || !equal(b.authorizedStoreKeys, [target.storeKey]))) fail("CONFIG_SCOPE_CHANGED");
  const runDirectory = path.join(directory, "downloads", target.runId);
  await io.ordinary(runDirectory, true);
  if (!equal((await readdir(runDirectory)).sort(), plan.operations.slice(0, 3).map(op => op.operationId).sort())) fail("DOWNLOAD_LAYOUT_CHANGED");
  const realtimeDirectory = path.join(runDirectory, plan.operations[2].operationId);
  await io.ordinary(realtimeDirectory, true); if ((await readdir(realtimeDirectory)).length) fail("REALTIME_FILES_PRESENT");
  const files: { relativePath: string; bytes: number; sha256: string }[] = [];
  for (let index = 0; index < 2; index++) {
    const op = plan.operations[index], pin = target.downloads[index], downloadDirectory = path.join(runDirectory, op.operationId);
    await io.ordinary(downloadDirectory, true);
    if (op.operationId !== pin.operationId || op.sourceKind !== pin.sourceKind || !equal((await readdir(downloadDirectory)).sort(), ["export-manifest.json", "source.csv"])) fail("DOWNLOAD_FILES_CHANGED");
    const csvPath = path.join(downloadDirectory, "source.csv"), exportPath = path.join(downloadDirectory, "export-manifest.json");
    const csv = await io.bytes(csvPath, JD_LOGISTICS_MAX_FILE_BYTES), exportBytes = await io.bytes(exportPath), exported: LogisticsExportManifest = JSON.parse(exportBytes.toString("utf8"));
    const identity = logisticsExportIdentity({ ...op, sourceStatus: index === 1 ? "enabled" : undefined, root: options.root, runId: plan.runId, executionId: plan.executionId, store, downloadDirectory, assertOwner: async () => {} });
    const result = exported.result;
    if (sha(exportBytes) !== pin.exportManifestSha256 || exported.version !== 2 || exported.stage !== "downloaded" || exported.identity !== identity || identity !== pin.exportIdentity
      || exported.runId !== target.runId || exported.executionId !== target.executionId || exported.operationId !== pin.operationId || !equal(exported.baseline, [])
      || exported.observedBusinessUnitCode !== target.businessUnitCode || exported.fullScopeHash !== pin.fullScopeHash || exported.expectedRowCount !== pin.rows
      || exported.requestEvidence?.requestHash !== pin.requestHash || exported.requestEvidence.attachmentHash !== pin.attachmentHash
      || exported.requestEvidence.observedBusinessUnitCode !== target.businessUnitCode || exported.requestEvidence.requestedAt !== pin.collectedAt
      || exported.queryEvidence?.requestHash !== pin.queryRequestHash || exported.queryEvidence.total !== pin.rows
      || !result || !io.samePath(result.filePath, csvPath) || !io.samePath(exported.filePath ?? "", csvPath)
      || result.collectedAt !== pin.collectedAt || result.identityEvidence.observedAt !== pin.collectedAt || result.taskIdentity !== pin.taskIdentity || exported.taskIdentity !== pin.taskIdentity) fail("DOWNLOAD_BINDING_REJECTED");
    if (index === 0) {
      if (exported.directRequestId !== pin.directRequestId || exported.taskIdentity !== `direct:${logisticsHash({ requestId: pin.directRequestId, requestHash: pin.requestHash, attachmentHash: pin.attachmentHash })}`
        || exported.productTaskEvidence !== undefined) fail("FLOW_TASK_BINDING_REJECTED");
    } else {
      if (op.sourceStatus !== "enabled" || exported.sourceStatus !== "enabled" || result.sourceStatus !== "enabled" || result.sourceAsOf !== op.rangeStart
        || !pin.productTaskEvidence || !equal(exported.productTaskEvidence, pin.productTaskEvidence) || exported.taskIdentity !== `products:${pin.productTaskEvidence.id}`
        || pin.productTaskEvidence.deptId !== target.businessUnitCode.slice(3) || pin.productTaskEvidence.recordCount !== pin.rows || exported.directRequestId !== undefined) fail("PRODUCT_TASK_BINDING_REJECTED");
    }
    const times = [plan.createdAt, exported.queryEvidence.observedAt, exported.submittedAt, pin.collectedAt, plan.failure.at].map(v => Date.parse(v ?? ""));
    if (times.some(v => !Number.isFinite(v)) || times.some((v, i) => i > 0 && v < times[i - 1])) fail("DOWNLOAD_TIME_ORDER_REJECTED");
    assertLogisticsExport(op, result, new Date(pin.collectedAt));
    const { filePath: _filePath, ...evidence } = result;
    if (!op.export || !equal(op.export, { ...evidence, relativePath: path.relative(options.root, csvPath).split(path.sep).join("/"), rawFileHash: pin.rawSha256, bytes: pin.bytes })
      || csv.length !== pin.bytes || sha(csv) !== pin.rawSha256 || exported.rawFileHash !== pin.rawSha256 || exported.byteSize !== pin.bytes
      || op.rowCount !== pin.rows || op.contentHash !== pin.contentHash || op.parserVersion !== "jd-logistics-workbook-v1") fail("DOWNLOAD_FILE_EVIDENCE_REJECTED");
    const rows = parseJdLogisticsWorkbook(csv, pin.sourceKind, target.businessUnitCode, { collectedAt: pin.collectedAt, allowDeclaredBusinessUnit: index === 1 });
    if (index === 1) assertLogisticsEnabledProducts(rows);
    if (rows.length !== pin.rows || logisticsContentHash(rows) !== pin.contentHash) fail("DOWNLOAD_CONTENT_REJECTED");
    files.push({ relativePath: path.relative(options.root, csvPath), bytes: csv.length, sha256: sha(csv) }, { relativePath: path.relative(options.root, exportPath), bytes: exportBytes.length, sha256: sha(exportBytes) });
  }
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
  const n8n = readJdKnownTwoDownloadsN8n(options.databasePath, target), installed = await installedBarrier(options.runtime, target);
  const processEvidence = await (options.processProbe ?? io.inspectHelperProcess)();
  const expectedCommand = `"C:\\Program Files\\nodejs\\node.exe" ${path.join(installed.release, "helper/tmall-workflow-helper.mjs")} serve --port 5791`;
  if (processEvidence.pid !== target.helperPid || processEvidence.creationDate !== target.helperCreationDate || processEvidence.parentPid !== target.supervisorPid
    || processEvidence.supervisorCreationDate !== target.supervisorCreationDate || processEvidence.commandLine.toLowerCase() !== expectedCommand.toLowerCase()) fail("HELPER_PROCESS_IDENTITY_REJECTED");
  const health = await io.readGet("http://127.0.0.1:5791/health", request);
  if (health.ok !== true || health.stage !== "ready" || health.busy !== false || health.activeWorkflow !== null || !equal(health.storeExecutions, []) || health.drain !== null) fail("HELPER_BUSY_OR_QUARANTINED");
  if (!await (options.portProbe ?? io.portClosed)(target.debugPort)) fail("BROWSER_PORT_OPEN_OR_UNKNOWN");
  return { activeBytes, manifestBytes, processEvidence, n8n, files,
    installed: { exporterSha256: target.exporterSha256, pipelineSha256: target.pipelineSha256, helperTreeSha256: target.helperTreeSha256, helperReceiptSha256: target.helperReceiptSha256 } };
}
export async function closeJdLogisticsKnownTwoDownloads(options: KnownTwoDownloadsOptions, action: "inspect" | "apply" = "inspect") {
  if (![options.root, options.runtime, options.databasePath].every(p => path.isAbsolute(p)) || !["inspect", "apply"].includes(action)) fail("ABSOLUTE_PATH_AND_ACTION_REQUIRED");
  const target = options.target ?? jdKnownTwoDownloadsTarget, directory = path.join(options.root, "outputs/jd-logistics-pipeline");
  await io.ordinary(options.root, true); await io.ordinary(directory, true);
  return withJackyunRunLock({ runId: `jdl-known-close-${target.executionId}`, purpose: "jd-logistics-known-two-downloads-closure", lockDirectory: path.join(directory, "pipeline.lock") }, pipeline =>
    withJackyunRunLock({ runId: `jdl-known-close-${target.executionId}`, purpose: "jd-chromium-known-two-downloads-closure", lockDirectory: defaultJdChromiumRunLockDirectory(options.root) }, async chromium => {
      const recovery = path.join(directory, `known-two-downloads-${target.executionId}-${target.activeSha256.slice(0, 16)}`);
      await io.absent(recovery); // No auto-resume, even after rename but before commit.
      const observed = await inspect(options, target);
      await pipeline.assertOwned(); await chromium.assertOwned();
      const intent = { version: "jd-logistics-known-two-downloads-closure-v1", status: "eligible_intent", at: new Date().toISOString(), target,
        n8n: observed.n8n, helperProcess: { pid: observed.processEvidence.pid, creationDate: observed.processEvidence.creationDate }, installed: observed.installed,
        files: observed.files, archivePath: path.join(recovery, "active.archived.json"), originalFailureRetained: true, oldExecutionReplayAllowed: false,
        effects: { completedDownloads: ["flow", "shop_products"], businessImports: 0, remainingSourcesExportSubmitted: false },
        oldDownloadsDisposition: "audit_only_no_handoff_no_import_no_signed_url_reuse",
        nextAction: `Only a new complete n8n execution from A with four-source fresh acquisition; never retry ${target.executionId}. Fresh source requests are allowed; never reuse, relabel, hand off or import either old download or its signed URL.` };
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
  console.log(JSON.stringify(await closeJdLogisticsKnownTwoDownloads({ root: "D:/运营管理系统", runtime: "D:/teruisi-runtime/teruisi-worker-sales", databasePath: "C:/Users/86137/.n8n/database.sqlite" }, process.argv[2] as "inspect" | "apply")));
}
if (process.argv[1] && io.samePath(process.argv[1], fileURLToPath(import.meta.url))) main().catch(error => {
  console.error(error instanceof Error && /^(JD_KNOWN_TWO_DOWNLOADS|JD_PREEXPORT)_[A-Z_]+$/.test(error.message) ? error.message : "JD_KNOWN_TWO_DOWNLOADS_EVIDENCE_REJECTED");
  console.error("STOP: retain original intent/evidence. No replay or fresh execution is authorized by an uncommitted archive."); process.exitCode = 1;
});
