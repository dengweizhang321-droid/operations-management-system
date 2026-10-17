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
import { jdPreexportEvidence as io, preexportSha256 as sha, type PreexportOptions } from "./close-jd-logistics-preexport";


import { createHash } from "node:crypto";
import { jhLogisticsExportRequest, jhLogisticsQueryRequest } from "../lib/jd/logistics-source-tasks";
import { jdKnownThreeDownloads9896Target } from "./jd-logistics-known-three-downloads-9896-target";
import { closureSettingsHash } from "./close-jd-logistics-login-9851";

// This exact partial-download failure is nonzeroEffects. Old files are audit only.
export type DownloadPin = {
  sourceKind: "flow" | "shop_products" | "realtime_inventory"; operationId: string; exportManifestSha256: string;
  rawSha256: string; bytes: number; rows: number; contentHash: string; exportIdentity: string;
  fullScopeHash: string; requestHash: string; queryRequestHash: string; attachmentHash?: string;
  collectedAt: string; taskIdentity: string; directRequestId?: string;
  baseline: string[]; submittedAt: string; requestEvidence: unknown; queryEvidence: unknown;
  taskEvidence?: { id: number; taskBusinessUnitCode: string | null; bindingMode: string; immutableHash: string };
  productTaskEvidence?: { id: string; deptId: string; taskStatus: string; recordCount: number; successCount: number; createTime: string; shopSetHash: string; shopCount: number };
};
type ScalarPins = { -readonly [K in keyof typeof jdKnownThreeDownloads9896Target]: typeof jdKnownThreeDownloads9896Target[K] extends number ? number : typeof jdKnownThreeDownloads9896Target[K] extends string ? string : typeof jdKnownThreeDownloads9896Target[K] };
export type KnownThreeDownloads9896Target = Omit<ScalarPins, "downloads"> & { downloads: DownloadPin[] };
export type KnownThreeDownloads9896Options = Omit<PreexportOptions, "target"> & { target?: KnownThreeDownloads9896Target };
function fail(code: string): never { throw new Error(`JD_KNOWN_THREE_DOWNLOADS_9896_${code}`); }
const equal = (a: unknown, b: unknown) => canonicalLogisticsJson(a) === canonicalLogisticsJson(b);
const kinds = ["flow", "shop_products", "realtime_inventory", "inventory_snapshot"];
export function readJdKnownThreeDownloads9896N8n(databasePath: string, target: KnownThreeDownloads9896Target) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN");
    const workflow = db.prepare("SELECT id,active,versionId,activeVersionId,nodes,connections,settings FROM workflow_entity WHERE id=?").get(target.workflowId);
    const execution = db.prepare("SELECT id,workflowId,status,mode,startedAt,stoppedAt,retrySuccessId,deletedAt FROM execution_entity WHERE id=? AND workflowId=?").get(target.executionId, target.workflowId);
    const active = db.prepare("SELECT COUNT(*) AS count FROM execution_entity WHERE workflowId=? AND status NOT IN ('error','success','canceled','crashed')").get(target.workflowId);
    const data = db.prepare("SELECT data FROM execution_data WHERE executionId=? AND length(data)<=1048576").get(target.executionId)?.data;
    const history = db.prepare("SELECT nodes,connections FROM workflow_history WHERE workflowId=? AND versionId=?").get(target.workflowId, target.workflowVersionId);
    if (!workflow || workflow.active !== 0 || workflow.activeVersionId !== null || workflow.versionId !== target.workflowVersionId || !history
      || history.nodes !== workflow.nodes || history.connections !== workflow.connections) fail("WORKFLOW_NOT_FROZEN");
    const shape = { nodes: JSON.parse(String(workflow.nodes)), connections: JSON.parse(String(workflow.connections)), settings: JSON.parse(String(workflow.settings)) };
    if (logisticsHash(shape) !== target.workflowShapeHash || shape.settings.timezone !== "Asia/Shanghai" || shape.settings.errorWorkflow
      || shape.nodes.filter((n: { type: string }) => n.type === "n8n-nodes-base.manualTrigger").length !== 1
      || shape.nodes.filter((n: { type: string }) => n.type === "n8n-nodes-base.scheduleTrigger").length !== 1
      || shape.nodes.some((n: { type: string }) => /webhook|errorTrigger|executeWorkflowTrigger/.test(n.type))) fail("WORKFLOW_GRAPH_CHANGED");
    if (!workflow || workflow.active !== 0 || !execution || execution.status !== "error" || execution.mode !== "manual" || execution.retrySuccessId !== null || execution.deletedAt !== null
      || typeof execution.startedAt !== "string" || typeof execution.stoppedAt !== "string" || !Number.isFinite(Date.parse(execution.startedAt + "Z")) || !Number.isFinite(Date.parse(execution.stoppedAt + "Z"))
      || Date.parse(execution.stoppedAt + "Z") <= Date.parse(execution.startedAt + "Z") || active?.count !== 0 || typeof data !== "string" || sha(data) !== target.executionDataSha256) fail("N8N_TERMINAL_EVIDENCE_REJECTED");
    const values = JSON.parse(data);
    if (!Array.isArray(values) || values.length > 10000) fail("N8N_DATA_INVALID");
    const deref = (v: unknown): unknown => typeof v === "string" && /^\d+$/.test(v) ? values[Number(v)] : v;
    const obj = (v: unknown) => io.object(deref(v));
    const arr = (v: unknown): unknown[] => { const a = deref(v); if (!Array.isArray(a)) fail("N8N_ARRAY_INVALID"); return a; };
    const result = obj(obj(values[0]).resultData), run = obj(result.runData), aName = "A·冻结事业部来源与日期计划", bName = "B·串行下载全文件校验并导入", releaseName = "失败后释放原执行 helper";
    const expected = ["手动完整运行", "领取共享 helper", "已领取执行所有权？", "等待5分钟后重新领取", aName, bName, releaseName, "保留证据并明确失败"];
    if (!equal(Object.keys(run).sort(), expected.sort()) || deref(result.lastNodeExecuted) !== "保留证据并明确失败") fail("N8N_STAGE_REJECTED");
    const tasks = (name: string, count = 1) => { const a = arr(run[name]); if (a.length !== count) fail("N8N_REPLAY_REJECTED"); return a.map(obj); };
    const output = (t: Record<string, unknown>, branch: number) => {
      const main = arr(obj(t.data).main), items = arr(main[branch]);
      if (items.length !== 1 || main.some((v, i) => i !== branch && arr(v).length)) fail("N8N_OUTPUT_REJECTED");
      return obj(obj(items[0]).json);
    };
    // Exactly one original queue wait before A. A/B/release/final never replay.
    const claims = tasks("领取共享 helper", 2), decisions = tasks("已领取执行所有权？", 2), wait = tasks("等待5分钟后重新领取")[0];
    for (let i = 0; i < 2; i++) {
      const claim = output(claims[i], 0), decision = output(decisions[i], i === 0 ? 1 : 0);
      if (deref(claims[i].executionStatus) !== "success" || deref(decisions[i].executionStatus) !== "success" || !equal(claim, decision)
        || claims[i].executionIndex !== 1 || decisions[i].executionIndex !== 2 || deref(claim.ok) !== true || deref(claim.workflow) !== "jd-logistics"
        || deref(claim.coordinationStatus) !== (i === 0 ? "waiting" : "granted")) fail("N8N_COORDINATION_REJECTED");
    }
    if (deref(wait.executionStatus) !== "success" || wait.executionIndex !== 0 || !equal(output(wait, 0), output(claims[0], 0))) fail("N8N_WAIT_REJECTED");
    const manual = tasks("手动完整运行")[0], a = tasks(aName)[0], b = tasks(bName)[0], release = tasks(releaseName)[0], final = tasks("保留证据并明确失败")[0];
    const ap = output(a, 0), bp = output(b, 1), rp = output(release, 0), error = obj(bp.error);
    if (deref(manual.executionStatus) !== "success" || [a, b, release].some(t => deref(t.executionStatus) !== "success") || deref(final.executionStatus) !== "error"
      || !equal([a, b, release, final].map(t => t.executionIndex), [3, 4, 5, 6]) || deref(ap.runId) !== target.runId || deref(ap.stage) !== "planned" || deref(ap.operationCount) !== 4
      || deref(bp.runId) !== target.runId || deref(error.status) !== 500 || !String(deref(error.message)).includes(target.failureCode)
      || deref(rp.ok) !== true || deref(rp.stage) !== "released" || deref(rp.workflow) !== "jd-logistics") fail("N8N_FAILURE_OR_RELEASE_REJECTED");
    return { executionId: target.executionId, workflowId: target.workflowId, status: "error", active: false, activeExecutions: 0, preAWaits: 1,
      executionDataSha256: target.executionDataSha256, startedAt: Date.parse(execution.startedAt + "Z"), stoppedAt: Date.parse(execution.stoppedAt + "Z") };
  } finally { db.close(); }
}
function ordered(source: string, markers: string[]) {
  let cursor = 0;
  for (const marker of markers) { const at = source.indexOf(marker, cursor); if (at < cursor) fail("INSTALLED_ORDER_UNPROVEN"); cursor = at + marker.length; }
}
async function installedBarrier(runtime: string, target: KnownThreeDownloads9896Target) {
  const installed = await io.installedEvidence(runtime, target);
  await sourceInputs(installed.release, target.pipelineSha256, target.policySha256);
  return installed;
}
async function sourceInputs(release: string, pipelineSha: string, policySha: string) {
  const receipt = JSON.parse((await io.bytes(path.join(release, "audit/helper-build-receipt.json"))).toString("utf8"));
  for (const [name, expected] of [["tools/jd-logistics-n8n-pipeline.ts", pipelineSha], ["lib/jd/logistics-policy.ts", policySha]]) {
    if (sha(await io.bytes(path.join(release, "source-snapshot", name))) !== expected
      || !receipt.evidence?.inputFiles?.some((f: { relativePath: string; sha256: string }) => f.relativePath === name && f.sha256 === expected)) fail("SOURCE_INPUT_CHANGED");
  }
}
async function historyBatches(plan: JdLogisticsManifest, t: KnownThreeDownloads9896Target, request: typeof fetch) {
  const result = [];
  for (const op of plan.operations) {
    const items: Array<{ batchId: string; collectorEvidence?: { executionId?: unknown; runId?: unknown } }> = []; let total = 0;
    for (let page = 1; page <= 10; page++) {
      const q = new URLSearchParams({ operation: "batches", departmentId: t.departmentId, businessUnitCode: t.businessUnitCode, sourceKind: op.sourceKind, page: String(page), pageSize: "100" });
      const e = await io.readGet(`${plan.baseUrl}/api/inventory/jd-logistics?${q}`, request), d = e.data;
      if (e.success !== true || !d || d.truncated === true || !Array.isArray(d.items) || d.page !== page || d.pageSize !== 100 || !Number.isSafeInteger(d.total)
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
      if (e.success !== true || d?.truncated === true || d?.total !== 1 || !Array.isArray(d.items) || d.items.length !== 1 || d.items[0]?.batchId !== item.batchId
        || d.items[0].sourceKind !== op.sourceKind || d.items[0].departmentId !== t.departmentId || d.items[0].businessUnitCode !== t.businessUnitCode
        || !d.items[0].currentSelection) fail("EXACT_BATCH_SELECTION_UNAVAILABLE");
      details.push(d.items[0]);
    }
    result.push({ sourceKind: op.sourceKind, total, items, details });
  }
  if (logisticsHash(result) !== t.batchesHash) fail("HISTORICAL_BATCH_STATE_CHANGED");
  return result.map(x => ({ sourceKind: x.sourceKind, total: x.total }));
}

async function originalCode(runtime: string, t: KnownThreeDownloads9896Target, execution: ReturnType<typeof readJdKnownThreeDownloads9896N8n>) {
  const original = path.join(runtime, "releases", t.originalReleaseId);
  if (sha(await io.bytes(path.join(original, "deployment-manifest.json"))) !== t.originalReleaseManifestSha256
    || sha(await io.bytes(path.join(original, "audit/helper-build-receipt.json"))) !== t.originalHelperReceiptSha256) fail("ORIGINAL_RUNTIME_CHANGED");
  const receipt = JSON.parse((await io.bytes(path.join(original, "audit/helper-build-receipt.json"))).toString("utf8"));
  if (receipt.status !== "passed" || receipt.helperTree?.sha256 !== t.originalHelperTreeSha256 || receipt.helperTree?.fileCount !== 4
    || !receipt.evidence?.inputFiles?.some((x: { relativePath: string; sha256: string }) => x.relativePath === "tools/jd-logistics-export.ts" && x.sha256 === t.originalExporterSha256)) fail("ORIGINAL_RECEIPT_CHANGED");
  const names = ["jackyun-json-publish.ps1", "jd-credential-vault.ps1", "tmall-credential-vault.ps1", "tmall-workflow-helper.mjs"];
  if (!equal((await readdir(path.join(original, "helper"))).sort(), names)) fail("ORIGINAL_HELPER_MEMBERS_CHANGED");
  const tree = createHash("sha256");
  for (const name of names) {
    const bytes = await io.bytes(path.join(original, "helper", name), 32 * 1024 * 1024), nameBytes = Buffer.from(name), nl = Buffer.alloc(4), cl = Buffer.alloc(8);
    nl.writeUInt32BE(nameBytes.length); cl.writeBigUInt64BE(BigInt(bytes.length)); tree.update(nl).update(nameBytes).update(cl).update(bytes);
  }
  if (tree.digest("hex") !== t.originalHelperTreeSha256) fail("ORIGINAL_HELPER_TREE_CHANGED");
  await sourceInputs(original, t.originalPipelineSha256, t.originalPolicySha256);
  const source = await io.bytes(path.join(original, "source-snapshot/tools/jd-logistics-export.ts"));
  if (sha(source) !== t.originalExporterSha256) fail("ORIGINAL_EXPORTER_CHANGED");
  const text = source.toString("utf8"), begin = text.indexOf("async function stableSourceRows("), end = text.indexOf("export function assertJhExportRequest(", begin);
  const stable = text.slice(begin, end);
  if (begin < 0 || end < begin || text.split(t.failureCode).length !== 2 || !stable.includes(`fail("${t.failureCode}")`)) fail("ORIGINAL_FAILURE_LOCATION_UNPROVEN");
  ordered(text.slice(text.indexOf("async function exportJhSource("), text.indexOf("function productTaskQueue(")),
    ["await prepareJdLogisticsSourceScope(surface, options)", "await stableSourceRows(page, surface, options, count, fullScopeHash)", 'stage: "baseline"',
      "await writeJsonDurable(manifestPath, manifest)", 'manifest.stage = "submitting"', "await writeJsonDurable(manifestPath, manifest)", "await observedJhExport(page, surface, options)"]);
  for (const release of [original, path.join(runtime, "releases", t.releaseId)]) {
    const pipeline = (await io.bytes(path.join(release, "source-snapshot/tools/jd-logistics-n8n-pipeline.ts"))).toString("utf8");
    ordered(pipeline.slice(pipeline.indexOf("export async function runJdLogisticsN8nPlan(")),
      ["for (const operation of plan.operations)", "const result = await exporter(", 'operation.stage = "validated"', "for (const operation of plan.operations)", 'operation.stage = "importing"', 'operation: "import"']);
  }
  const currentText = (await io.bytes(path.join(runtime, "releases", t.releaseId, "source-snapshot/tools/jd-logistics-export.ts"))).toString("utf8");
  const readiness = currentText.slice(currentText.indexOf("export async function confirmLogisticsSourceReadiness("), currentText.indexOf("export function assertJhExportRequest("));
  if (!/if \(options.sourceKind === "inventory_snapshot"\)\s*\{[\s\S]*?fullScopeReadback\(surface, options\)[\s\S]*?return;/.test(readiness)) fail("CURRENT_SNAPSHOT_FIX_UNPROVEN");
  const activation = async (file: string, expected: string) => {
    if (!/^[a-f0-9]{64}\.json$/.test(file) || path.basename(file) !== file) fail("ACTIVATION_PATH_INVALID");
    const p = path.join(runtime, "state/worker-release-successors", file), data = await io.bytes(p);
    if (sha(data) !== expected || (await io.bytes(p + ".sha256")).toString("utf8").trim() !== expected) fail("ACTIVATION_RECORD_CHANGED");
    const record = JSON.parse(data.toString("utf8")), { payloadSha256, ...payload } = record;
    if (logisticsHash(payload) !== payloadSha256) fail("ACTIVATION_PAYLOAD_CHANGED");
    return record as { version: string; sequence: number; predecessor: unknown; successor: { releaseId: string; manifestSha256: string }; activatedAt: string };
  };
  const before = await activation(t.activationInFile, t.activationInSha256), after = await activation(t.activationOutFile, t.activationOutSha256), current = await activation(t.currentActivationFile, t.currentActivationSha256);
  if (before.sequence + 1 !== after.sequence || after.sequence + 1 !== current.sequence || !equal(before.successor, after.predecessor) || !equal(after.successor, current.predecessor)
    || before.successor.releaseId !== t.originalReleaseId || before.successor.manifestSha256 !== t.originalReleaseManifestSha256
    || current.successor.releaseId !== t.releaseId || current.successor.manifestSha256 !== t.releaseManifestSha256
    || !(Date.parse(before.activatedAt) < execution.startedAt && execution.stoppedAt < Date.parse(after.activatedAt) && Date.parse(after.activatedAt) < Date.parse(current.activatedAt))) fail("ORIGINAL_EXECUTION_CODE_INTERVAL_CHANGED");
  // A pinned old record and process receipt alone cannot prove the current
  // effective head. Reject later records, forks, gaps and orphan sidecars.
  const successorRoot = path.join(runtime, "state/worker-release-successors");
  await io.ordinary(successorRoot, true);
  const members = (await readdir(successorRoot)).sort(), records = members.filter(name => /^[a-f0-9]{64}\.json$/.test(name));
  if (!records.length || records.length > 256 || !equal(members, records.flatMap(name => [name, name + ".sha256"]).sort())) fail("SUCCESSOR_DIRECTORY_INVALID");
  const chain: Array<{ name: string; record: Awaited<ReturnType<typeof activation>> }> = [];
  for (const name of records) {
    const raw = await io.bytes(path.join(successorRoot, name));
    chain.push({ name, record: await activation(name, sha(raw)) });
  }
  chain.sort((a, b) => a.record.sequence - b.record.sequence);
  if (chain.some((entry, i) => !Number.isSafeInteger(entry.record.sequence) || entry.record.sequence < 1
    || entry.record.version !== "teruisi-local-worker-release-successor-v1"
    || i > 0 && (entry.record.sequence !== chain[i - 1].record.sequence + 1 || !equal(chain[i - 1].record.successor, entry.record.predecessor)))
    || chain.at(-1)?.name !== t.currentActivationFile) fail("CURRENT_EFFECTIVE_HEAD_CHANGED");
  return { releaseId: t.originalReleaseId, exporterSha256: t.originalExporterSha256, pipelineSha256: t.originalPipelineSha256, helperTreeSha256: t.originalHelperTreeSha256,
    activationInSha256: t.activationInSha256, activationOutSha256: t.activationOutSha256, currentActivationSha256: t.currentActivationSha256 };
}
async function inspect(options: KnownThreeDownloads9896Options, target: KnownThreeDownloads9896Target, archivedActivePath?: string) {
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
  if (target.downloads.length !== 3 || !equal(target.downloads.map(d => d.sourceKind), ["flow", "shop_products", "realtime_inventory"])
    || plan.operations.length !== 4 || plan.operations.some((op, i) => op.sourceKind !== kinds[i] || op.stage !== ["validated", "validated", "validated", "exporting"][i]
    || op.departmentId !== target.departmentId || op.businessUnitCode !== target.businessUnitCode || op.collectorStoreKey !== target.storeKey || op.initialScopeRevision !== target.initialScopeRevisions[i]
    || op.receipt !== undefined || i > 2 && [op.export, op.rowCount, op.contentHash, op.parserVersion].some(v => v !== undefined))) fail("OPERATION_EFFECTS_REJECTED");
  const sourceConfig = await io.bytes(path.join(options.root, "config/jd-logistics-sources.json")), registry = await io.bytes(path.join(options.root, "config/jd-store-accounts.json"));
  if (sha(sourceConfig) !== target.sourceConfigSha256 || sha(registry) !== target.registrySha256) fail("SOURCE_CONFIGURATION_CHANGED");
  const config = parseJdLogisticsConfig(JSON.parse(sourceConfig.toString("utf8"))), stores = validateJdStoreRegistry(JSON.parse(registry.toString("utf8")), options.root);
  const store = stores.find(s => s.storeKey === target.storeKey);
  if (!store || store.browser.debugPort !== target.debugPort || config.bindings.length !== 4 || config.bindings.some(b => !b.enabled || b.departmentId !== target.departmentId
    || b.businessUnitCode !== target.businessUnitCode || b.collectorStoreKey !== target.storeKey || !equal(b.authorizedStoreKeys, [target.storeKey]))) fail("CONFIG_SCOPE_CHANGED");
  const runDirectory = path.join(directory, "downloads", target.runId);
  await io.ordinary(runDirectory, true);
  if (!equal((await readdir(runDirectory)).sort(), plan.operations.map(op => op.operationId).sort())) fail("DOWNLOAD_LAYOUT_CHANGED");
  const realtimeDirectory = path.join(runDirectory, plan.operations[3].operationId);
  await io.ordinary(realtimeDirectory, true); if ((await readdir(realtimeDirectory)).length) fail("SNAPSHOT_FILES_PRESENT");
  const files: { relativePath: string; bytes: number; sha256: string }[] = [];
  for (let index = 0; index < 3; index++) {
    const op = plan.operations[index], pin = target.downloads[index], downloadDirectory = path.join(runDirectory, op.operationId);
    await io.ordinary(downloadDirectory, true);
    if (op.operationId !== pin.operationId || op.sourceKind !== pin.sourceKind || !equal((await readdir(downloadDirectory)).sort(), ["export-manifest.json", index === 2 ? "source.xlsx" : "source.csv"].sort())) fail("DOWNLOAD_FILES_CHANGED");
    const csvPath = path.join(downloadDirectory, index === 2 ? "source.xlsx" : "source.csv"), exportPath = path.join(downloadDirectory, "export-manifest.json");
    const csv = await io.bytes(csvPath, JD_LOGISTICS_MAX_FILE_BYTES), exportBytes = await io.bytes(exportPath), exported: LogisticsExportManifest = JSON.parse(exportBytes.toString("utf8"));
    const identity = logisticsExportIdentity({ ...op, sourceStatus: index === 1 ? "enabled" : undefined, root: options.root, runId: plan.runId, executionId: plan.executionId, store, downloadDirectory, assertOwner: async () => {} });
    const result = exported.result;
    if (sha(exportBytes) !== pin.exportManifestSha256 || exported.version !== 2 || exported.stage !== "downloaded" || exported.identity !== identity || identity !== pin.exportIdentity
      || exported.runId !== target.runId || exported.executionId !== target.executionId || exported.operationId !== pin.operationId || !equal(exported.baseline, pin.baseline)
      || exported.observedBusinessUnitCode !== target.businessUnitCode || exported.fullScopeHash !== pin.fullScopeHash || exported.expectedRowCount !== pin.rows
      || exported.requestEvidence?.requestHash !== pin.requestHash || exported.requestEvidence.attachmentHash !== pin.attachmentHash
      || exported.requestEvidence.observedBusinessUnitCode !== target.businessUnitCode || exported.requestEvidence.requestedAt !== pin.collectedAt
      || exported.queryEvidence?.requestHash !== pin.queryRequestHash || exported.queryEvidence.total !== pin.rows
      || !equal(exported.queryEvidence, pin.queryEvidence) || !equal(exported.requestEvidence, pin.requestEvidence) || exported.submittedAt !== pin.submittedAt
      || !result || !io.samePath(result.filePath, csvPath) || !io.samePath(exported.filePath ?? "", csvPath)
      || result.collectedAt !== pin.collectedAt || result.identityEvidence.observedAt !== pin.collectedAt || result.taskIdentity !== pin.taskIdentity || exported.taskIdentity !== pin.taskIdentity) fail("DOWNLOAD_BINDING_REJECTED");
    if (index === 0) {
      if (exported.directRequestId !== pin.directRequestId || exported.taskIdentity !== `direct:${logisticsHash({ requestId: pin.directRequestId, requestHash: pin.requestHash, attachmentHash: pin.attachmentHash })}`
        || exported.productTaskEvidence !== undefined) fail("FLOW_TASK_BINDING_REJECTED");
    } else if (index === 1) {
      if (op.sourceStatus !== "enabled" || exported.sourceStatus !== "enabled" || result.sourceStatus !== "enabled" || result.sourceAsOf !== op.rangeStart
        || !pin.productTaskEvidence || !equal(exported.productTaskEvidence, pin.productTaskEvidence) || exported.taskIdentity !== `products:${pin.productTaskEvidence.id}`
        || pin.productTaskEvidence.deptId !== target.businessUnitCode.slice(3) || pin.productTaskEvidence.recordCount !== pin.rows || exported.directRequestId !== undefined) fail("PRODUCT_TASK_BINDING_REJECTED");
    }
    if (index === 2) {
      const task = exported.taskEvidence;
      if (!task || !equal(task, pin.taskEvidence) || task.bindingMode !== "fresh_request_and_unique_task" || exported.taskIdentity !== `jh:${task.id}`
        || exported.baseline.includes(String(task.id)) || task.taskBusinessUnitCode !== null && task.taskBusinessUnitCode !== target.businessUnitCode
        || result.sourceAsOf !== op.rangeStart || exported.queryEvidence.requestHash !== logisticsHash(jhLogisticsQueryRequest(op))
        || exported.requestEvidence.requestHash !== logisticsHash(jhLogisticsExportRequest(op)) || exported.productTaskEvidence !== undefined || exported.directRequestId !== undefined) fail("JH_TASK_BINDING_REJECTED");
    }
    const times = [plan.createdAt, exported.queryEvidence.observedAt, exported.submittedAt, pin.collectedAt, plan.failure.at].map(v => Date.parse(v ?? ""));
    if (times.some(v => !Number.isFinite(v)) || times.some((v, i) => i > 0 && v < times[i - 1])) fail("DOWNLOAD_TIME_ORDER_REJECTED");
    assertLogisticsExport(op, result, new Date(pin.collectedAt));
    const evidence = Object.fromEntries(Object.entries(result).filter(([key]) => key !== "filePath"));
    if (!op.export || !equal(op.export, { ...evidence, relativePath: path.relative(options.root, csvPath).split(path.sep).join("/"), rawFileHash: pin.rawSha256, bytes: pin.bytes })
      || csv.length !== pin.bytes || sha(csv) !== pin.rawSha256 || exported.rawFileHash !== pin.rawSha256 || exported.byteSize !== pin.bytes
      || op.rowCount !== pin.rows || op.contentHash !== pin.contentHash || op.parserVersion !== "jd-logistics-workbook-v1") fail("DOWNLOAD_FILE_EVIDENCE_REJECTED");
    const rows = parseJdLogisticsWorkbook(csv, pin.sourceKind, target.businessUnitCode, { collectedAt: pin.collectedAt, allowDeclaredBusinessUnit: index !== 0 });
    if (index === 1) assertLogisticsEnabledProducts(rows);
    if (rows.length !== pin.rows || logisticsContentHash(rows) !== pin.contentHash) fail("DOWNLOAD_CONTENT_REJECTED");
    files.push({ relativePath: path.relative(options.root, csvPath), bytes: csv.length, sha256: sha(csv) }, { relativePath: path.relative(options.root, exportPath), bytes: exportBytes.length, sha256: sha(exportBytes) });
  }
  const request = options.request ?? fetch, envelope = await io.readGet(`${plan.baseUrl}/api/inventory/jd-logistics?operation=settings`, request);
  if (envelope.success !== true || closureSettingsHash(envelope.data) !== target.settingsHash) fail("SETTINGS_CHANGED");
  const settings = parseJdLogisticsSettings(envelope.data), department = settings.departments[0];
  if (settings.departments.length !== 1 || department?.id !== target.departmentId || department.revision !== target.departmentRevision
    || department.businessUnitCode !== target.businessUnitCode || !equal(department.storeKeys, [target.storeKey])
    || department.logisticsEnabled !== true || department.monitorEnabled !== false || department.pushEnabled !== false || settings.notification?.enabled !== false
    || Object.values(department.capabilities).some(v => v !== true)) fail("BUSINESS_SCOPE_HAS_EFFECTS_OR_CHANGED");
  // Rebuild directly from CURRENT rev4 settings. No historical revision rewrite.
  const selected = selectJdLogisticsOperations(config, settings, stores, new Date(plan.anchorAt));
  const selection = (op: JdLogisticsManifest["operations"][number]) => Object.fromEntries(Object.entries(op).filter(([key]) => !["stage", "export", "rowCount", "contentHash", "parserVersion"].includes(key)));
  if (selected.length !== 4 || selected.some((s, i) => !equal(s, selection(plan.operations[i])))) fail("POLICY_OR_SCOPE_REVISION_CHANGED");
  const batches = await historyBatches(plan, target, request);
  await io.ordinary(options.databasePath);
  const n8n = readJdKnownThreeDownloads9896N8n(options.databasePath, target), installed = await installedBarrier(options.runtime, target);
  const originalExecutionCodeBinding = await originalCode(options.runtime, target, n8n);
  const processEvidence = await (options.processProbe ?? io.inspectHelperProcess)();
  const expectedCommand = `"${path.win32.join("C:/Program Files/nodejs/node.exe")}" ${path.join(installed.release, "helper/tmall-workflow-helper.mjs")} serve --port 5791`;
  if (processEvidence.pid !== target.helperPid || processEvidence.creationDate !== target.helperCreationDate || processEvidence.parentPid !== target.supervisorPid
    || processEvidence.supervisorCreationDate !== target.supervisorCreationDate || processEvidence.commandLine.toLowerCase() !== expectedCommand.toLowerCase()) fail("HELPER_PROCESS_IDENTITY_REJECTED");
  const health = await io.readGet("http://127.0.0.1:5791/health", request);
  if (health.ok !== true || health.stage !== "ready" || health.busy !== false || health.activeWorkflow !== null || !equal(health.storeExecutions, []) || health.drain !== null) fail("HELPER_BUSY_OR_QUARANTINED");
  if (!await (options.portProbe ?? io.portClosed)(target.debugPort)) fail("BROWSER_PORT_OPEN_OR_UNKNOWN");
  return { activeBytes, manifestBytes, processEvidence, n8n, files, batches, originalExecutionCodeBinding,
    installed: { exporterSha256: target.exporterSha256, pipelineSha256: target.pipelineSha256, helperTreeSha256: target.helperTreeSha256, helperReceiptSha256: target.helperReceiptSha256 } };
}
export async function closeJdLogisticsKnownThreeDownloads9896(options: KnownThreeDownloads9896Options, action: "inspect" | "apply" = "inspect") {
  if (![options.root, options.runtime, options.databasePath].every(p => path.isAbsolute(p)) || !["inspect", "apply"].includes(action)) fail("ABSOLUTE_PATH_AND_ACTION_REQUIRED");
  const target = options.target ?? jdKnownThreeDownloads9896Target as KnownThreeDownloads9896Target, directory = path.join(options.root, "outputs/jd-logistics-pipeline");
  await io.ordinary(options.root, true); await io.ordinary(directory, true);
  return withJackyunRunLock({ runId: `jdl-known-close-${target.executionId}`, purpose: "jd-logistics-known-three-downloads-9896-closure", lockDirectory: path.join(directory, "pipeline.lock") }, pipeline =>
    withJackyunRunLock({ runId: `jdl-known-close-${target.executionId}`, purpose: "jd-chromium-known-three-downloads-9896-closure", lockDirectory: defaultJdChromiumRunLockDirectory(options.root) }, async chromium => {
      const recovery = path.join(directory, `known-three-downloads-9896-${target.executionId}-${target.activeSha256.slice(0, 16)}`);
      await io.absent(recovery); // No auto-resume, even after rename but before commit.
      const observed = await inspect(options, target);
      await pipeline.assertOwned(); await chromium.assertOwned();
      const intent = { version: "jd-logistics-known-three-downloads-9896-closure-v1", status: "eligible_intent", at: new Date().toISOString(), target,
        n8n: observed.n8n, helperProcess: { pid: observed.processEvidence.pid, creationDate: observed.processEvidence.creationDate }, installed: observed.installed,
        files: observed.files, historicalBatches: observed.batches, originalExecutionCodeBinding: observed.originalExecutionCodeBinding, nonzeroEffects: true, archivePath: path.join(recovery, "active.archived.json"), originalFailureRetained: true, oldExecutionReplayAllowed: false,
        effects: { completedDownloads: ["flow", "shop_products", "realtime_inventory"], businessImports: 0, remainingSourcesExportSubmitted: false },
        oldDownloadsDisposition: "audit_only_no_handoff_no_import_no_signed_url_reuse",
        nextAction: `Only a new complete n8n execution from A with four-source fresh acquisition; never retry ${target.executionId}. Fresh source requests are allowed; never reuse, relabel, hand off or import any old download or its signed URL.` };
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
  console.log(JSON.stringify(await closeJdLogisticsKnownThreeDownloads9896({ root: "D:/运营管理系统", runtime: "D:/teruisi-runtime/teruisi-worker-sales", databasePath: "C:/Users/86137/.n8n/database.sqlite" }, process.argv[2] as "inspect" | "apply")));
}
if (process.argv[1] && io.samePath(process.argv[1], fileURLToPath(import.meta.url))) main().catch(error => {
  console.error(error instanceof Error && /^(JD_KNOWN_THREE_DOWNLOADS_9896|JD_PREEXPORT)_[A-Z_]+$/.test(error.message) ? error.message : "JD_KNOWN_THREE_DOWNLOADS_9896_EVIDENCE_REJECTED");
  console.error("STOP: retain original intent/evidence. No replay or fresh execution is authorized by an uncommitted archive."); process.exitCode = 1;
});
