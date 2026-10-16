import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath } from "node:fs/promises";
import { connect } from "node:net";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { defaultJdChromiumRunLockDirectory } from "../lib/jd/chromium-run-lock";
import { assertLogisticsManifest, logisticsPlanHash, type JdLogisticsManifest } from "../lib/jd/logistics-manifest";
import { canonicalLogisticsJson, parseJdLogisticsConfig, parseJdLogisticsSettings, selectJdLogisticsOperations } from "../lib/jd/logistics-policy";
import { validateJdStoreRegistry } from "../lib/jd/store-registry";

// A one-execution operator, deliberately outside helper/n8n routes. This does
// not authorize replay of 9542, mark it completed, or repair arbitrary runs.
export const jdPreexportTarget = Object.freeze({
  failureCode: "JD_LOGISTICS_BUSINESS_UNIT_MISMATCH",
  executionId: "9542", workflowId: "JdLogisticsDaily2026", runId: "jdl-774dfd3a-5597-4a3b-b1a3-8e876f55587f",
  planHash: "97eecd4f2528d2a4c40a290f2cbcccae27207b7b5a9bcf96734493dd04e460ac",
  activeSha256: "49621c19dfb1ec720b45d6bf517e0152e54fa7b89a4f820a81693c0642d5d656",
  manifestSha256: "6a33ffc67fa182acd068fa8c97e37d99b40fbca0f43dd1fd33ac025bb6bd7ac1",
  executionDataSha256: "50890c3235377dc012fe181ca8cb9f86fa467f9edd1f5f377f03fa3e85b7e98d",
  departmentId: "jd-yiyong-4418046540089", businessUnitCode: "EBU4418046540089", storeKey: "jd-yiyong-director", debugPort: 9224,
  releaseId: "20261015T152258Z-3ca63e8b9225fb87", releaseManifestSha256: "6eaa16affe9c9bcf60af8e4f0f811614fc239c3c05ba1ecb714382e58c46d932",
  helperReceiptSha256: "46b6a771b1951f9afc3493cede25799709b25cde6125563723cc5cc16b18fc54",
  helperTreeSha256: "14f4c98358fd0b332c2e974861fb67722fcd4afe48fd0565f4a5380ce5293084",
  exporterSha256: "10fbdc133abee4e19d342cb134c62dcf7531da99c9b1655542f8ee6614d0b742",
  supervisorPid: 25832, supervisorCreationDate: "2026-10-15T17:55:50.7274130Z",
  helperPid: 52200, helperCreationDate: "2026-10-15T17:55:58.5894940Z",
});
// Second exact pre-export failure; still no arbitrary run/root overrides in CLI.
export const jdDatePreexportTarget = Object.freeze({
  ...jdPreexportTarget, failureCode: "JD_LOGISTICS_DATE_CONTROL_AMBIGUOUS",
  executionId: "9556", runId: "jdl-de6e61c0-210b-4798-b259-fbfb80b2ac8c",
  planHash: "1ad57e11734aa5336e88165c5672e504e3465d75557a17d4e223ef3f68226097",
  activeSha256: "5fdb619a47ac2e56cfc9419cbbbfada8197d81242e1990920cbb35de9d7b7fd3",
  manifestSha256: "0fc728fcc3f80c82233e199d0739f0f9642a97e52df9325e56837c38797928f1",
  executionDataSha256: "f06f80a31411a57189e777638d3dab8c2fd2f1c557617e88d0264a2d9e035288",
  releaseId: "20261016T012126Z-dc89c4ec5bfabd85", releaseManifestSha256: "6d6bde6546ad9aa67b629962890bc7771ff26854abf2032d33ad7c2d3c7599fe",
  helperReceiptSha256: "03b24d97f66fac32935d35b1f45913a0a365cabf050b65ed75828e3eff0af847",
  helperTreeSha256: "ab9736c2f5992eb420b87060316a421eccb0c014bfa4ed87fa417af563db6583",
  exporterSha256: "cfa6ec5f0c7af04b9304534a1c2a1dfa3fcc7b969e37da85e308ba6d988e68c9",
  supervisorPid: 32688, supervisorCreationDate: "2026-10-16T02:00:32.2873450Z",
  helperPid: 51472, helperCreationDate: "2026-10-16T02:00:42.5925950Z",
});
export type PreexportTarget = { -readonly [K in keyof typeof jdPreexportTarget]: (typeof jdPreexportTarget)[K] extends number ? number : string };
export const preexportSha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const exec = promisify(execFile);
function fail(code: string): never { throw new Error(`JD_PREEXPORT_${code}`); }
const object = (v: unknown): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("OBJECT_INVALID");
  return v as Record<string, any>;
};
const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
async function ordinary(p: string, directory = false) {
  // Check every ancestor: do not traverse junctions before inspecting leaves.
  const absolute = path.resolve(p), base = path.parse(absolute).root;
  let current = base;
  for (const part of absolute.slice(base.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !samePath(await realpath(current), current)) fail("PATH_LINK_REJECTED");
  }
  const info = await lstat(absolute);
  if (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1) fail("FILE_IDENTITY_REJECTED");
  return info;
}
async function bytes(p: string, limit = 2 * 1024 * 1024) {
  const info = await ordinary(p);
  if (info.size > limit) fail("FILE_TOO_LARGE");
  const data = await readFile(p);
  if (data.length !== info.size) fail("FILE_CHANGED");
  return data;
}
async function absent(p: string) {
  try { await lstat(p); fail("PATH_ALREADY_EXISTS_MANUAL_RECONCILIATION"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
}
async function createOnly(p: string, data: string | Uint8Array) {
  const handle = await open(p, "wx");
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
}
const jsonBytes = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

export function readJdPreexportN8n(databasePath: string, target: PreexportTarget) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN");
    const workflow = db.prepare("SELECT id,active FROM workflow_entity WHERE id=?").get(target.workflowId);
    const execution = db.prepare("SELECT id,workflowId,status,mode,startedAt,stoppedAt,retrySuccessId,deletedAt FROM execution_entity WHERE id=? AND workflowId=?").get(target.executionId, target.workflowId);
    const active = db.prepare("SELECT COUNT(*) AS count FROM execution_entity WHERE workflowId=? AND status NOT IN ('error','success','canceled','crashed')").get(target.workflowId);
    const data = db.prepare("SELECT data FROM execution_data WHERE executionId=? AND length(data)<=1048576").get(target.executionId)?.data;
    if (!workflow || workflow.active !== 0 || !execution || execution.status !== "error" || execution.mode !== "manual"
      || execution.retrySuccessId !== null || execution.deletedAt !== null || typeof execution.startedAt !== "string"
      || typeof execution.stoppedAt !== "string" || Date.parse(execution.stoppedAt + "Z") <= Date.parse(execution.startedAt + "Z")
      || active?.count !== 0 || typeof data !== "string" || preexportSha256(data) !== target.executionDataSha256) fail("N8N_TERMINAL_EVIDENCE_REJECTED");
    const values = JSON.parse(data);
    if (!Array.isArray(values) || values.length > 10000) fail("N8N_DATA_INVALID");
    const deref = (v: unknown): any => typeof v === "string" && /^\d+$/.test(v) ? values[Number(v)] : v;
    const obj = (v: unknown) => object(deref(v));
    const arr = (v: unknown): any[] => { const a = deref(v); if (!Array.isArray(a)) fail("N8N_ARRAY_INVALID"); return a; };
    const result = obj(obj(values[0]).resultData), run = obj(result.runData);
    const aName = "A·冻结事业部来源与日期计划", bName = "B·串行下载全文件校验并导入", releaseName = "失败后释放原执行 helper";
    const expected = ["手动完整运行", "领取共享 helper", "已领取执行所有权？", aName, bName, releaseName, "保留证据并明确失败"];
    if (canonicalLogisticsJson(Object.keys(run).sort()) !== canonicalLogisticsJson(expected.sort()) || deref(result.lastNodeExecuted) !== "保留证据并明确失败") fail("N8N_STAGE_REJECTED");
    const task = (name: string) => { const tasks = arr(run[name]); if (tasks.length !== 1) fail("N8N_REPLAY_REJECTED"); return obj(tasks[0]); };
    const output = (t: Record<string, any>, branch: number) => {
      const main = arr(obj(t.data).main), items = arr(main[branch]);
      if (items.length !== 1 || main.some((v, i) => i !== branch && arr(v).length)) fail("N8N_OUTPUT_REJECTED");
      return obj(obj(items[0]).json);
    };
    const a = task(aName), b = task(bName), release = task(releaseName), final = task("保留证据并明确失败");
    const ap = output(a, 0), bp = output(b, 1), rp = output(release, 0);
    const bpError = obj(bp.error);
    if ([a, b, release].some(t => deref(t.executionStatus) !== "success") || deref(final.executionStatus) !== "error"
      || !(Number(a.executionIndex) < Number(b.executionIndex) && Number(b.executionIndex) < Number(release.executionIndex) && Number(release.executionIndex) < Number(final.executionIndex))
      || deref(ap.runId) !== target.runId || deref(ap.stage) !== "planned" || deref(ap.operationCount) !== 4
      || deref(bp.runId) !== target.runId || deref(bpError.status) !== 500 || !String(deref(bpError.message)).includes(target.failureCode)
      || deref(rp.ok) !== true || deref(rp.stage) !== "released" || deref(rp.workflow) !== "jd-logistics") fail("N8N_FAILURE_OR_RELEASE_REJECTED");
    return { executionId: target.executionId, workflowId: target.workflowId, status: "error", active: false, activeExecutions: 0,
      executionDataSha256: target.executionDataSha256, stoppedAt: execution.stoppedAt };
  } finally { db.close(); }
}

type ProcessEvidence = { pid: number; parentPid: number; creationDate: string; commandLine: string; supervisorCreationDate: string };
async function inspectHelperProcess(): Promise<ProcessEvidence> {
  const script = "$ErrorActionPreference='Stop';$pids=@(Get-NetTCPConnection -LocalPort 5791 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique);if($pids.Count -ne 1){throw 'listener ambiguous'};$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$pids[0]);$s=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p.ParentProcessId);@{pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;creationDate=$p.CreationDate.ToUniversalTime().ToString('o');commandLine=$p.CommandLine;supervisorCreationDate=$s.CreationDate.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress";
  const { stdout } = await exec("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 15000, windowsHide: true });
  return object(JSON.parse(stdout)) as ProcessEvidence;
}
async function portClosed(port: number) {
  return new Promise<boolean>(resolve => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (closed: boolean) => { socket.destroy(); resolve(closed); };
    socket.setTimeout(1500, () => finish(false)); socket.once("connect", () => finish(false));
    socket.once("error", (e: NodeJS.ErrnoException) => finish(e.code === "ECONNREFUSED"));
  });
}
async function readGet(url: string, request: typeof fetch) {
  const response = await request(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10000), headers: { accept: "application/json" } });
  if (!response.ok || !response.body) fail("GET_UNAVAILABLE");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2 * 1024 * 1024) { await reader.cancel(); fail("GET_TOO_LARGE"); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
async function installedEvidence(runtime: string, target: PreexportTarget) {
  const release = path.join(runtime, "releases", target.releaseId);
  const manifest = await bytes(path.join(release, "deployment-manifest.json"));
  const receiptBytes = await bytes(path.join(release, "audit/helper-build-receipt.json"));
  if (preexportSha256(manifest) !== target.releaseManifestSha256 || preexportSha256(receiptBytes) !== target.helperReceiptSha256) fail("INSTALLED_RECEIPT_CHANGED");
  const receipt = object(JSON.parse(receiptBytes.toString("utf8")));
  if (receipt.status !== "passed" || receipt.helperTree?.fileCount !== 4 || receipt.helperTree?.sha256 !== target.helperTreeSha256) fail("INSTALLED_HELPER_RECEIPT_REJECTED");
  const files = (await readdir(path.join(release, "helper"))).sort();
  if (canonicalLogisticsJson(files) !== canonicalLogisticsJson(["jackyun-json-publish.ps1", "jd-credential-vault.ps1", "tmall-credential-vault.ps1", "tmall-workflow-helper.mjs"])) fail("INSTALLED_HELPER_FILES_CHANGED");
  const hash = createHash("sha256");
  for (const name of files) {
    const content = await bytes(path.join(release, "helper", name), 32 * 1024 * 1024), nameBytes = Buffer.from(name);
    const nameLength = Buffer.alloc(4), contentLength = Buffer.alloc(8);
    nameLength.writeUInt32BE(nameBytes.length); contentLength.writeBigUInt64BE(BigInt(content.length));
    hash.update(nameLength).update(nameBytes).update(contentLength).update(content);
  }
  if (hash.digest("hex") !== target.helperTreeSha256) fail("INSTALLED_HELPER_TREE_CHANGED");
  const source = await bytes(path.join(release, "source-snapshot/tools/jd-logistics-export.ts"));
  if (preexportSha256(source) !== target.exporterSha256 || !receipt.evidence?.inputFiles?.some((f: any) => f.relativePath === "tools/jd-logistics-export.ts" && f.sha256 === target.exporterSha256)) fail("INSTALLED_EXPORTER_CHANGED");
  // The pinned source proves the first identity gate precedes flow export;
  // flow baseline + submitting are durable before its single export click.
  const sourceText = source.toString("utf8"), flow = sourceText.slice(sourceText.indexOf("async function exportFlowSource("), sourceText.indexOf("export async function exportJdLogistics("));
  const markers = ['stage: "baseline"', 'await writeJsonDurable(manifestPath, manifest)', 'manifest.stage = "submitting"', 'await writeJsonDurable(manifestPath, manifest)', 'uniqueButton(surface, "导出")'];
  let cursor = 0;
  for (const marker of markers) { const index = flow.indexOf(marker, cursor); if (index < cursor) fail("EXPORT_ORDER_UNPROVEN"); cursor = index + marker.length; }
  const processReceipt = object(JSON.parse((await bytes(path.join(runtime, "state/worker-process.json"))).toString("utf8")));
  if (processReceipt.releaseId !== target.releaseId || processReceipt.manifestSha256 !== target.releaseManifestSha256
    || processReceipt.supervisorPid !== target.supervisorPid || processReceipt.supervisorCreationDate !== target.supervisorCreationDate) fail("SUPERVISOR_RECEIPT_REJECTED");
  return { release, processReceipt, helperTreeSha256: target.helperTreeSha256, helperReceiptSha256: target.helperReceiptSha256, exporterSha256: target.exporterSha256 };
}
export type PreexportOptions = {
  root: string; runtime: string; databasePath: string;
  // Test seams are programmatic only. The CLI has no target/root overrides.
  target?: PreexportTarget; request?: typeof fetch; processProbe?: () => Promise<ProcessEvidence>; portProbe?: (port: number) => Promise<boolean>;
  checkpoint?: (stage: "intent_written" | "before_move" | "after_move" | "before_committed") => Promise<void>;
};
async function inspect(options: PreexportOptions, target: PreexportTarget, archivedActivePath?: string) {
  const directory = path.join(options.root, "outputs/jd-logistics-pipeline");
  const activeBytes = await bytes(archivedActivePath ?? path.join(directory, "active.json"));
  const manifestBytes = await bytes(path.join(directory, `${target.runId}.json`));
  if (preexportSha256(activeBytes) !== target.activeSha256 || preexportSha256(manifestBytes) !== target.manifestSha256) fail("ORIGINAL_SHA_CHANGED");
  const active = object(JSON.parse(activeBytes.toString("utf8"))), plan = JSON.parse(manifestBytes.toString("utf8")) as JdLogisticsManifest;
  if (canonicalLogisticsJson(active) !== canonicalLogisticsJson({ runId: target.runId, executionId: target.executionId, planHash: target.planHash })) fail("ACTIVE_IDENTITY_REJECTED");
  assertLogisticsManifest(plan, target.executionId);
  if (plan.runId !== target.runId || logisticsPlanHash(plan) !== target.planHash || plan.stage !== "failed" || plan.outcome !== "pending"
    || plan.failure?.code !== target.failureCode || plan.failure.stage !== "run"
    || canonicalLogisticsJson(plan.notification) !== canonicalLogisticsJson({ stage: "pending" }) || plan.notificationPlan.enabled !== false || plan.notificationPlan.departmentIds.length) fail("FAILED_STAGE_REJECTED");
  if (plan.operations.length !== 4 || plan.operations.some((op, i) => op.stage !== (i === 0 ? "exporting" : "planned") || op.departmentId !== target.departmentId
    || op.businessUnitCode !== target.businessUnitCode || op.collectorStoreKey !== target.storeKey || op.initialScopeRevision !== 0
    || [op.export, op.receipt, op.rowCount, op.contentHash, op.parserVersion].some(v => v !== undefined))
    || plan.operations[0].sourceKind !== "flow") fail("OPERATIONS_HAVE_EFFECTS");
  const runDir = path.join(directory, "downloads", target.runId); await ordinary(runDir, true);
  const children = await readdir(runDir);
  if (children.length !== 1 || children[0] !== plan.operations[0].operationId) fail("DOWNLOAD_LAYOUT_CHANGED");
  const flowDir = path.join(runDir, children[0]); await ordinary(flowDir, true);
  if ((await readdir(flowDir)).length) fail("DOWNLOAD_SIDE_EFFECTS_PRESENT");
  const config = parseJdLogisticsConfig(JSON.parse((await bytes(path.join(options.root, "config/jd-logistics-sources.json"))).toString("utf8")));
  if (config.bindings.length !== 4 || config.bindings.some(b => !b.enabled || b.departmentId !== target.departmentId || b.businessUnitCode !== target.businessUnitCode
    || b.collectorStoreKey !== target.storeKey || canonicalLogisticsJson(b.authorizedStoreKeys) !== canonicalLogisticsJson([target.storeKey]))) fail("CONFIG_SCOPE_CHANGED");
  const stores = validateJdStoreRegistry(JSON.parse((await bytes(path.join(options.root, "config/jd-store-accounts.json"))).toString("utf8")), options.root);
  if (stores.find(s => s.storeKey === target.storeKey)?.browser.debugPort !== target.debugPort) fail("PROFILE_PORT_CHANGED");
  const request = options.request ?? fetch;
  if (plan.baseUrl !== "http://localhost:3000") fail("API_ROOT_CHANGED");
  const settingsEnvelope = await readGet(`${plan.baseUrl}/api/inventory/jd-logistics?operation=settings`, request);
  if (settingsEnvelope.success !== true) fail("SETTINGS_UNAVAILABLE");
  const settings = parseJdLogisticsSettings(settingsEnvelope.data), department = settings.departments.find(d => d.id === target.departmentId);
  if (settings.departments.length !== 1 || !department || !department.logisticsEnabled || department.monitorEnabled !== false || department.pushEnabled !== false
    || settings.scopeRevisions.length || settings.notification?.enabled !== false || Object.values(department.capabilities).some(v => v !== true)) fail("BUSINESS_SCOPE_HAS_EFFECTS_OR_CHANGED");
  const selected = selectJdLogisticsOperations(config, settings, stores, new Date(plan.anchorAt));
  if (selected.length !== 4 || selected.some((s, i) => s.operationId !== plan.operations[i].operationId || s.policyHash !== plan.operations[i].policyHash || s.storeIdentityHash !== plan.operations[i].storeIdentityHash)) fail("POLICY_CHANGED");
  for (const op of plan.operations) {
    const query = new URLSearchParams({ operation: "batches", departmentId: target.departmentId, businessUnitCode: target.businessUnitCode, sourceKind: op.sourceKind, page: "1", pageSize: "1" });
    const envelope = await readGet(`${plan.baseUrl}/api/inventory/jd-logistics?${query}`, request), data = object(envelope.data);
    if (envelope.success !== true || data.total !== 0 || !Array.isArray(data.items) || data.items.length || data.page !== 1 || data.pageSize !== 1) fail("BATCH_EFFECTS_OR_UNKNOWN");
  }
  await ordinary(options.databasePath);
  const n8n = readJdPreexportN8n(options.databasePath, target), installed = await installedEvidence(options.runtime, target);
  const processEvidence = await (options.processProbe ?? inspectHelperProcess)();
  const expectedCommand = `"C:\\Program Files\\nodejs\\node.exe" ${path.join(installed.release, "helper/tmall-workflow-helper.mjs")} serve --port 5791`;
  if (processEvidence.parentPid !== installed.processReceipt.supervisorPid || processEvidence.supervisorCreationDate !== installed.processReceipt.supervisorCreationDate
    || processEvidence.commandLine.toLowerCase() !== expectedCommand.toLowerCase() || processEvidence.pid !== target.helperPid
    || processEvidence.creationDate !== target.helperCreationDate) fail("HELPER_PROCESS_IDENTITY_REJECTED");
  const health = await readGet("http://127.0.0.1:5791/health", request);
  if (health.ok !== true || health.stage !== "ready" || health.busy !== false || health.activeWorkflow !== null
    || !Array.isArray(health.storeExecutions) || health.storeExecutions.length || health.drain !== null) fail("HELPER_BUSY_OR_QUARANTINED");
  if (!await (options.portProbe ?? portClosed)(target.debugPort)) fail("BROWSER_PORT_OPEN_OR_UNKNOWN");
  return { activeBytes, manifestBytes, processEvidence, n8n, installed: { helperTreeSha256: installed.helperTreeSha256, helperReceiptSha256: installed.helperReceiptSha256, exporterSha256: installed.exporterSha256 } };
}
async function moveNoReplace(from: string, to: string) {
  // .NET File.Move uses the same-volume no-replace primitive on Windows.
  // fs.rename can replace an existing file and is therefore unsuitable here.
  if (process.platform !== "win32" || path.parse(from).root.toLowerCase() !== path.parse(to).root.toLowerCase()) fail("SAME_VOLUME_WINDOWS_REQUIRED");
  const quote = (v: string) => `'${v.replaceAll("'", "''")}'`;
  await exec("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop';[System.IO.File]::Move(${quote(from)},${quote(to)})`], { timeout: 10000, windowsHide: true });
}
export async function closeJdLogisticsPreexport(options: PreexportOptions, action: "inspect" | "apply" = "inspect") {
  const target = options.target ?? jdPreexportTarget, root = path.resolve(options.root), directory = path.join(root, "outputs/jd-logistics-pipeline");
  if (!path.isAbsolute(options.root) || !path.isAbsolute(options.runtime) || !path.isAbsolute(options.databasePath)) fail("ABSOLUTE_PATH_REQUIRED");
  await ordinary(directory, true); await ordinary(root, true);
  // Both are the existing pipeline/browser locks, in pipeline -> global order.
  return withJackyunRunLock({ runId: `jdl-close-${target.executionId}`, purpose: "jd-logistics-preexport-closure", lockDirectory: path.join(directory, "pipeline.lock") }, pipeline =>
    withJackyunRunLock({ runId: `jdl-close-${target.executionId}`, purpose: "jd-chromium-preexport-closure", lockDirectory: defaultJdChromiumRunLockDirectory(root) }, async chromium => {
      const recovery = path.join(directory, `preexport-${target.executionId}-${target.activeSha256.slice(0, 16)}`);
      await absent(recovery); // Any interrupted attempt requires manual reconciliation.
      const observed = await inspect(options, target);
      await pipeline.assertOwned(); await chromium.assertOwned();
      const intent = { version: "jd-logistics-preexport-closure-v1", status: "eligible_intent", at: new Date().toISOString(), target,
        n8n: observed.n8n, helperProcess: { pid: observed.processEvidence.pid, creationDate: observed.processEvidence.creationDate }, installed: observed.installed,
        archivePath: path.join(recovery, "active.archived.json"), originalFailureRetained: true, oldExecutionReplayAllowed: false };
      if (action === "inspect") return intent;
      await mkdir(recovery); await ordinary(recovery, true);
      await createOnly(path.join(recovery, "active.original.json"), observed.activeBytes);
      await createOnly(path.join(recovery, "manifest.original.json"), observed.manifestBytes);
      await createOnly(path.join(recovery, "intent.json"), jsonBytes(intent));
      await options.checkpoint?.("intent_written");
      // Recheck every predicate while BOTH locks remain held. No blind retry.
      const final = await inspect(options, target);
      if (canonicalLogisticsJson(final.processEvidence) !== canonicalLogisticsJson(observed.processEvidence)) fail("HELPER_PROCESS_CHANGED");
      await pipeline.assertOwned(); await chromium.assertOwned();
      await options.checkpoint?.("before_move");
      await ordinary(recovery, true); await absent(intent.archivePath);
      const activePath = path.join(directory, "active.json"), manifestPath = path.join(directory, `${target.runId}.json`);
      if (preexportSha256(await bytes(activePath)) !== target.activeSha256 || preexportSha256(await bytes(manifestPath)) !== target.manifestSha256) fail("FINAL_SHA_CHANGED");
      await moveNoReplace(activePath, intent.archivePath);
      await options.checkpoint?.("after_move");
      await absent(activePath);
      if (preexportSha256(await bytes(intent.archivePath)) !== target.activeSha256 || preexportSha256(await bytes(manifestPath)) !== target.manifestSha256) fail("ARCHIVE_POSTCONDITION_FAILED_MANUAL_RECONCILIATION");
      const afterMove = await inspect(options, target, intent.archivePath);
      if (canonicalLogisticsJson(afterMove.processEvidence) !== canonicalLogisticsJson(observed.processEvidence)) fail("HELPER_PROCESS_CHANGED");
      await pipeline.assertOwned(); await chromium.assertOwned();
      await options.checkpoint?.("before_committed");
      await absent(activePath);
      const committed = { ...intent, status: "committed", committedAt: new Date().toISOString(), intentSha256: preexportSha256(jsonBytes(intent)),
        nextAction: `A new full n8n execution only after operator review; never retry ${target.executionId}` };
      await createOnly(path.join(recovery, "committed.json"), jsonBytes(committed));
      return committed;
    }));
}
async function main() {
  const action = process.argv[2];
  if (!["inspect", "apply"].includes(action) || ![3, 4].includes(process.argv.length) || process.argv.length === 4 && process.argv[3] !== "9556") fail("USAGE_INSPECT_OR_APPLY_ONLY");
  const target = process.argv[3] === "9556" ? jdDatePreexportTarget : jdPreexportTarget;
  const result = await closeJdLogisticsPreexport({ root: "D:/运营管理系统", runtime: "D:/teruisi-runtime/teruisi-worker-sales", databasePath: "C:/Users/86137/.n8n/database.sqlite", target }, action as "inspect" | "apply");
  console.log(JSON.stringify(result));
}
if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) main().catch(error => {
  console.error(error instanceof Error && /^JD_PREEXPORT_[A-Z_]+$/.test(error.message) ? error.message : "JD_PREEXPORT_EVIDENCE_REJECTED");
  console.error("STOP: retain original evidence. If an intent directory exists, manually reconcile that same intent; an archive without committed.json MUST NOT authorize n8n continuation.");
  process.exitCode = 1;
});
