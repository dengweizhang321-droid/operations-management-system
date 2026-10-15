import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { readJsonDurableOr, writeJsonDurable } from "../lib/jackyun/json-file";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { validateJdStoreRegistry, type JdStore } from "../lib/jd/store-registry";
import { JD_LOGISTICS_MAX_FILE_BYTES, parseJdLogisticsWorkbook } from "../lib/inventory/jd-logistics-workbook";
import { JD_LOGISTICS_PATH } from "../lib/inventory/jd-logistics-contract";
import { assertLogisticsEnabledProducts, assertLogisticsExport, assertLogisticsManifest, assertLogisticsReceipt, logisticsContentHash, logisticsPlanHash, logisticsRawHash,
  type JdLogisticsManifest, type JdLogisticsNotificationResult, type JdLogisticsOperation, type JdLogisticsReceipt } from "../lib/jd/logistics-manifest";
import { canonicalLogisticsJson, jdLogisticsProtocol, logisticsHash, parseJdLogisticsConfig, parseJdLogisticsSettings, planJdLogisticsNotifications, selectJdLogisticsOperations, validLogisticsDate,
  type JdLogisticsConfig, type JdLogisticsExportOptions, type JdLogisticsExportResult } from "../lib/jd/logistics-policy";

export { jdLogisticsHelperRequestError } from "../lib/jd/logistics-manifest";
type Dependencies = {
  root: string; executionId: string; request?: typeof fetch; now?: Date;
  config?: JdLogisticsConfig; stores?: JdStore[];
};
type Active = { runId: string; executionId: string; planHash: string };
const parserVersion = "jd-logistics-workbook-v1";
function paths(root: string, runId?: string) {
  if (!path.isAbsolute(root) || runId !== undefined && !/^[A-Za-z0-9._-]{1,96}$/.test(runId)) throw new Error("JD_LOGISTICS_INVALID_RUNTIME_ROOT");
  const directory = path.join(root, "outputs", "jd-logistics-pipeline");
  return { directory, active: path.join(directory, "active.json"), lock: path.join(directory, "pipeline.lock"),
    manifest: runId ? path.join(directory, `${runId}.json`) : "" };
}
function execution(value: string) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error("JD_LOGISTICS_INVALID_EXECUTION_ID");
}
export function normalizeJdLogisticsBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) throw new Error("JD_LOGISTICS_LOCAL_API_REQUIRED");
  return url.toString().replace(/\/$/, "");
}
async function api(options: Dependencies, baseUrl: string, query: URLSearchParams, body?: unknown) {
  const notification = !!body && typeof body === "object" && (body as { operation?: unknown }).operation === "notify";
  const unknownResult = notification ? "JD_LOGISTICS_NOTIFICATION_RESULT_UNKNOWN" : "JD_LOGISTICS_IMPORT_RESULT_UNKNOWN";
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  if (serialized && Buffer.byteLength(serialized) > 24 * 1024 * 1024) throw new Error("JD_LOGISTICS_IMPORT_TOO_LARGE");
  let response: Response;
  try {
    response = await (options.request ?? fetch)(`${baseUrl}${JD_LOGISTICS_PATH}${query.size ? `?${query}` : ""}`, {
      method: body === undefined ? "GET" : "POST", redirect: "manual", signal: AbortSignal.timeout(120_000),
      headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json", origin: baseUrl }) }, body: serialized,
    });
  } catch { throw new Error(body === undefined ? "JD_LOGISTICS_API_READ_UNAVAILABLE" : unknownResult); }
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "JD_LOGISTICS_API_ACCESS_DENIED" : body === undefined ? "JD_LOGISTICS_API_READ_REJECTED"
    : response.status >= 500 || response.status >= 300 && response.status < 400 ? unknownResult : notification ? "JD_LOGISTICS_NOTIFICATION_REJECTED" : "JD_LOGISTICS_IMPORT_REJECTED");
  const reader = response.body?.getReader();
  if (!reader) throw new Error(body === undefined ? "JD_LOGISTICS_API_RESPONSE_INVALID" : unknownResult);
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > 2 * 1024 * 1024) { await reader.cancel(); throw new Error("JD_LOGISTICS_API_RESPONSE_TOO_LARGE"); }
      chunks.push(part.value);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!payload || payload.success !== true || !payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) throw new Error();
    return payload.data as Record<string, unknown>;
  } catch { throw new Error(body === undefined ? "JD_LOGISTICS_API_RESPONSE_INVALID" : unknownResult); }
  finally { reader.releaseLock(); }
}
async function currentInputs(options: Dependencies, baseUrl: string) {
  const config = parseJdLogisticsConfig(options.config ?? JSON.parse(await readFile(path.join(options.root, "config", "jd-logistics-sources.json"), "utf8")));
  const stores = options.stores ?? validateJdStoreRegistry(JSON.parse(await readFile(path.join(options.root, "config", "jd-store-accounts.json"), "utf8")), options.root);
  const settings = parseJdLogisticsSettings(await api(options, baseUrl, new URLSearchParams({ operation: "settings" })));
  return { config, stores, settings };
}
async function persist(root: string, plan: JdLogisticsManifest) {
  const active = await readJsonDurableOr<Active | null>(paths(root).active, null);
  if (!active || active.runId !== plan.runId || active.executionId !== plan.executionId || active.planHash !== plan.planHash) throw new Error("JD_LOGISTICS_EXECUTION_OWNER_MISMATCH");
  plan.updatedAt = new Date().toISOString();
  await writeJsonDurable(paths(root, plan.runId).manifest, plan);
}
async function loadOwned(options: Dependencies, plan: Pick<JdLogisticsManifest, "runId" | "planHash">) {
  execution(options.executionId);
  const files = paths(options.root, plan.runId);
  const active = await readJsonDurableOr<Active | null>(files.active, null);
  if (!active || active.runId !== plan.runId || active.executionId !== options.executionId || active.planHash !== plan.planHash) throw new Error("JD_LOGISTICS_EXECUTION_OWNER_MISMATCH");
  const stored = await readJsonDurableOr<JdLogisticsManifest | null>(files.manifest, null);
  if (!stored) throw new Error("JD_LOGISTICS_MANIFEST_MISSING_MANUAL_ACTION");
  assertLogisticsManifest(stored, options.executionId);
  if (stored.planHash !== active.planHash) throw new Error("JD_LOGISTICS_PLAN_HASH_MISMATCH");
  return stored;
}
async function assertPolicy(options: Dependencies, plan: JdLogisticsManifest, notification = false) {
  const current = await currentInputs(options, plan.baseUrl);
  const selections = selectJdLogisticsOperations(current.config, current.settings, current.stores, new Date(plan.anchorAt));
  if (selections.length !== plan.operations.length || selections.some((selection, index) => {
    const op = plan.operations[index];
    return selection.operationId !== op.operationId || selection.policyHash !== op.policyHash || selection.storeIdentityHash !== op.storeIdentityHash;
  })) throw new Error("JD_LOGISTICS_POLICY_CHANGED_OR_REVOKED");
  if (notification && canonicalLogisticsJson(planJdLogisticsNotifications(current.settings, selections)) !== canonicalLogisticsJson(plan.notificationPlan)) throw new Error("JD_LOGISTICS_NOTIFICATION_POLICY_CHANGED");
  return current;
}
export async function planJdLogisticsN8nRun(options: Dependencies & { baseUrl?: string; runIdFactory?: () => string }) {
  execution(options.executionId);
  const baseUrl = normalizeJdLogisticsBaseUrl(options.baseUrl ?? process.env.OPERATIONS_SYSTEM_URL ?? "http://localhost:3000");
  const files = paths(options.root); await mkdir(files.directory, { recursive: true });
  return withJackyunRunLock({ runId: `jdl-plan-${logisticsHash(options.executionId).slice(0, 24)}`, purpose: "jd-logistics-plan", lockDirectory: files.lock }, async lock => {
    const active = await readJsonDurableOr<Active | null>(files.active, null);
    if (active) {
      const previous = await loadOwned({ ...options, executionId: active.executionId }, active);
      if (previous.executionId === options.executionId) {
        if (previous.baseUrl !== baseUrl || previous.stage === "running" || previous.stage === "failed") throw new Error("JD_LOGISTICS_PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION");
        await assertPolicy(options, previous); return previous;
      }
      if (previous.stage !== "completed") throw new Error("JD_LOGISTICS_PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION");
    }
    const now = options.now ?? new Date();
    const input = await currentInputs(options, baseUrl);
    const operations = selectJdLogisticsOperations(input.config, input.settings, input.stores, now).map(selection => ({ ...selection, stage: "planned" as const }));
    const plan: JdLogisticsManifest = { protocolVersion: jdLogisticsProtocol, workflowKey: "jd-logistics", runId: options.runIdFactory?.() ?? `jdl-${randomUUID()}`,
      executionId: options.executionId, createdAt: now.toISOString(), updatedAt: now.toISOString(), anchorAt: now.toISOString(), baseUrl,
      planHash: "", stage: "planned", outcome: operations.length ? "pending" : "disabled", operations,
      notificationPlan: planJdLogisticsNotifications(input.settings, operations), notification: { stage: "pending" } };
    plan.planHash = logisticsPlanHash(plan); assertLogisticsManifest(plan, options.executionId); await lock.assertOwned();
    // Publish the owner before its plan. A crash between them is unresolved and
    // fails closed; it can never authorize an unindexed second export.
    await writeJsonDurable(files.active, { runId: plan.runId, executionId: plan.executionId, planHash: plan.planHash });
    await writeJsonDurable(paths(options.root, plan.runId).manifest, plan, true);
    return plan;
  });
}
async function controlledBytes(root: string, plan: JdLogisticsManifest, operation: JdLogisticsOperation, filePath: string) {
  const directory = path.join(root, "outputs", "jd-logistics-pipeline", "downloads", plan.runId, operation.operationId);
  const relative = path.relative(directory, path.resolve(filePath));
  const extensionAllowed = operation.sourceKind === "shop_products" || operation.sourceKind === "flow" ? /\.(?:xlsx|csv)$/i.test(relative) : /\.xlsx$/i.test(relative);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || path.dirname(relative) !== "." || !extensionAllowed) throw new Error("JD_LOGISTICS_DOWNLOAD_PATH_REJECTED");
  const [file, canonicalDirectory, canonicalFile] = await Promise.all([lstat(filePath), realpath(directory), realpath(filePath)]);
  if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || file.size < 1 || file.size > JD_LOGISTICS_MAX_FILE_BYTES
    || path.dirname(canonicalFile) !== canonicalDirectory || canonicalDirectory !== path.resolve(directory)) throw new Error("JD_LOGISTICS_DOWNLOAD_FILE_IDENTITY_REJECTED");
  const bytes = await readFile(filePath);
  if (bytes.length !== file.size) throw new Error("JD_LOGISTICS_DOWNLOAD_CHANGED");
  return { bytes, relativePath: path.relative(root, path.resolve(filePath)).split(path.sep).join("/") };
}
function fileFor(root: string, operation: JdLogisticsOperation) {
  if (!operation.export || path.isAbsolute(operation.export.relativePath) || operation.export.relativePath.includes("\\")) throw new Error("JD_LOGISTICS_DOWNLOAD_EVIDENCE_MISSING");
  return path.resolve(root, ...operation.export.relativePath.split("/"));
}
function code(error: unknown) { return error instanceof Error && /^JD_LOGISTICS_[A-Z_]+$/.test(error.message) ? error.message : "JD_LOGISTICS_PIPELINE_FAILED_MANUAL_ACTION"; }
function stableReceipt(value: Record<string, unknown>) {
  const keys = ["batchId", "departmentId", "businessUnitCode", "sourceKind", "rangeStart", "rangeEnd", "warehouseCode", "rawFileHash", "contentHash", "rowCount",
    "status", "referenceBatchId", "scopeRevision", "origin", "storeKey", "collectedAt", "sourceAsOf", "collectorEvidence", "warningCount", "warnings", "sourceStatus"];
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]])) as JdLogisticsReceipt;
}
export function publicJdLogisticsPlan(plan: JdLogisticsManifest) {
  return { ok: true, runId: plan.runId, protocolVersion: plan.protocolVersion, stage: plan.stage, status: plan.outcome,
    operationCount: plan.operations.length, importedCount: plan.operations.filter(op => op.receipt?.status === "imported").length,
    duplicateCount: plan.operations.filter(op => op.receipt?.status === "duplicate").length,
    verifiedCount: plan.operations.filter(op => op.stage === "verified").length,
    sourceStatuses: Object.fromEntries(plan.operations.map(op => [op.sourceKind, op.sourceStatus])),
    notification: { stage: plan.notification.stage, status: plan.notification.result?.status ?? (plan.notification.stage === "unknown" ? "unknown" : "pending"),
      riskCount: plan.notification.result?.riskCount ?? 0, unknownCount: plan.notification.result?.unknownCount ?? 0,
      ...(plan.notification.result?.reason ? { reason: plan.notification.result.reason } : {}) },
    businessUnitCount: new Set(plan.operations.map(op => op.businessUnitCode)).size };
}
export async function runJdLogisticsN8nPlan(reference: Pick<JdLogisticsManifest, "runId" | "planHash">, options: Dependencies & {
  exporter?: (options: JdLogisticsExportOptions) => Promise<JdLogisticsExportResult>;
}) {
  return withJackyunRunLock({ runId: reference.runId, purpose: "jd-logistics-run", lockDirectory: paths(options.root).lock }, async lock => {
    const plan = await loadOwned(options, reference);
    if (plan.stage === "executed") { await assertPolicy(options, plan); return publicJdLogisticsPlan(plan); }
    if (plan.stage !== "planned" || plan.operations.some(op => op.stage !== "planned")) throw new Error("JD_LOGISTICS_REPLAY_REQUIRES_MANUAL_ACTION");
    const rowsByOperation = new Map<string, ReturnType<typeof parseJdLogisticsWorkbook>>();
    const assertOwner = async () => { await lock.assertOwned(); await loadOwned(options, plan); await assertPolicy(options, plan); };
    try {
      await assertOwner(); plan.stage = "running"; await persist(options.root, plan);
      for (const operation of plan.operations) {
        const current = await assertPolicy(options, plan); await assertOwner();
        operation.stage = "exporting"; await persist(options.root, plan);
        const downloadDirectory = path.join(paths(options.root).directory, "downloads", plan.runId, operation.operationId);
        await mkdir(downloadDirectory, { recursive: true });
        const exporter = options.exporter ?? (await import("./jd-logistics-export")).exportJdLogistics;
        const result = await exporter({ root: options.root, runId: plan.runId, executionId: options.executionId,
          operationId: operation.operationId, store: current.stores.find(store => store.storeKey === operation.collectorStoreKey)!,
          sourceKind: operation.sourceKind, departmentId: operation.departmentId, businessUnitCode: operation.businessUnitCode,
          rangeStart: operation.rangeStart, rangeEnd: operation.rangeEnd, warehouseCode: operation.warehouseCode,
          ...(operation.sourceStatus === "enabled" ? { sourceStatus: "enabled" as const } : {}),
          contractVersion: operation.contractVersion, downloadDirectory, assertOwner });
        await assertOwner(); assertLogisticsExport(operation, result, options.now ?? new Date());
        const { bytes, relativePath } = await controlledBytes(options.root, plan, operation, result.filePath);
        const evidence = { taskIdentity: result.taskIdentity, complete: result.complete, browserClosed: result.browserClosed, collectedAt: result.collectedAt,
          ...(result.sourceAsOf ? { sourceAsOf: result.sourceAsOf } : {}), ...(result.sourceStatus ? { sourceStatus: result.sourceStatus } : {}),
          identityEvidence: result.identityEvidence, scope: result.scope, contractVersion: result.contractVersion };
        operation.export = { ...evidence, relativePath, rawFileHash: logisticsRawHash(bytes), bytes: bytes.length };
        operation.stage = "downloaded"; await persist(options.root, plan);
        const rows = parseJdLogisticsWorkbook(bytes, operation.sourceKind, operation.businessUnitCode,
          { collectedAt: result.collectedAt, allowDeclaredBusinessUnit: true });
        if (operation.sourceKind === "shop_products") assertLogisticsEnabledProducts(rows);
        rowsByOperation.set(operation.operationId, rows);
        operation.contentHash = logisticsContentHash(rows); operation.rowCount = rows.length; operation.parserVersion = parserVersion;
        operation.stage = "validated"; await persist(options.root, plan);
      }
      // No import begins until every required source has crossed the full-file barrier.
      for (const operation of plan.operations) {
        await assertOwner();
        const bytes = await controlledBytes(options.root, plan, operation, fileFor(options.root, operation));
        if (logisticsRawHash(bytes.bytes) !== operation.export!.rawFileHash) throw new Error("JD_LOGISTICS_DOWNLOAD_CHANGED");
        const rows = rowsByOperation.get(operation.operationId)!;
        if (logisticsContentHash(rows) !== operation.contentHash) throw new Error("JD_LOGISTICS_PARSED_CONTENT_CHANGED");
        operation.stage = "importing"; await persist(options.root, plan);
        const preceding = plan.operations.slice(0, plan.operations.indexOf(operation)).filter(op => op.departmentId === operation.departmentId && op.sourceKind === operation.sourceKind && op.receipt).at(-1);
        const payload = await api(options, plan.baseUrl, new URLSearchParams(), { operation: "import", departmentId: operation.departmentId,
          businessUnitCode: operation.businessUnitCode, sourceKind: operation.sourceKind, rangeStart: operation.rangeStart, rangeEnd: operation.rangeEnd,
          warehouseCode: operation.warehouseCode, rawFileHash: operation.export!.rawFileHash, fileName: path.basename(fileFor(options.root, operation)),
          complete: true, expectedScopeRevision: preceding?.receipt?.scopeRevision ?? operation.initialScopeRevision, origin: "workflow", storeKey: operation.collectorStoreKey,
          identityEvidence: operation.export!.identityEvidence, collectedAt: operation.export!.collectedAt,
          ...(operation.export!.sourceAsOf ? { sourceAsOf: operation.export!.sourceAsOf } : {}),
          collectorEvidence: { runId: plan.runId, executionId: plan.executionId, protocol: jdLogisticsProtocol }, rows });
        const receipt = stableReceipt(payload);
        assertLogisticsReceipt(operation, receipt); await assertOwner();
        if (receipt.collectedAt === undefined || Date.parse(receipt.collectedAt) !== Date.parse(operation.export!.collectedAt)
          || canonicalLogisticsJson(receipt.collectorEvidence) !== canonicalLogisticsJson({ runId: plan.runId, executionId: plan.executionId, protocol: jdLogisticsProtocol })
          || operation.export!.sourceAsOf !== undefined && receipt.sourceAsOf !== operation.export!.sourceAsOf) throw new Error("JD_LOGISTICS_COLLECTOR_RECEIPT_MISMATCH");
        operation.receipt = receipt; operation.stage = "imported"; await persist(options.root, plan);
      }
      plan.stage = "executed";
      const statuses = new Set(plan.operations.map(op => op.receipt!.status));
      plan.outcome = !plan.operations.length ? "disabled" : statuses.size > 1 ? "mixed" : statuses.has("imported") ? "imported" : "duplicate";
      await persist(options.root, plan); return publicJdLogisticsPlan(plan);
    } catch (error) {
      plan.stage = "failed"; plan.failure = { code: code(error), stage: "run", at: new Date().toISOString() };
      await persist(options.root, plan); throw new Error(plan.failure.code);
    }
  });
}
export async function verifyJdLogisticsN8nPlan(reference: Pick<JdLogisticsManifest, "runId" | "planHash">, options: Dependencies) {
  return withJackyunRunLock({ runId: reference.runId, purpose: "jd-logistics-verify", lockDirectory: paths(options.root).lock }, async lock => {
    const plan = await loadOwned(options, reference);
    if (!["executed", "verified", "completed"].includes(plan.stage)) throw new Error("JD_LOGISTICS_NOT_READY_FOR_VERIFICATION");
    try {
      const current = await assertPolicy(options, plan);
      for (const operation of plan.operations) {
        await lock.assertOwned(); await loadOwned(options, plan);
        if (!operation.receipt || !["imported", "verified"].includes(operation.stage) || operation.parserVersion !== parserVersion) throw new Error("JD_LOGISTICS_EXACT_RECEIPT_MISSING");
        assertLogisticsExport(operation, { ...operation.export!, filePath: fileFor(options.root, operation) }, new Date(operation.export!.collectedAt));
        const file = await controlledBytes(options.root, plan, operation, fileFor(options.root, operation));
        const rows = parseJdLogisticsWorkbook(file.bytes, operation.sourceKind, operation.businessUnitCode,
          { collectedAt: operation.export!.collectedAt, allowDeclaredBusinessUnit: true });
        if (operation.sourceKind === "shop_products") assertLogisticsEnabledProducts(rows);
        if (file.bytes.length !== operation.export!.bytes || logisticsRawHash(file.bytes) !== operation.export!.rawFileHash
          || rows.length !== operation.rowCount || logisticsContentHash(rows) !== operation.contentHash) throw new Error("JD_LOGISTICS_INDEPENDENT_FILE_CHECK_FAILED");
        const payload = await api(options, plan.baseUrl, new URLSearchParams({ operation: "batches", batchId: operation.receipt.batchId,
          departmentId: operation.departmentId, sourceKind: operation.sourceKind, pageSize: "1" }));
        const items = payload.items;
        if (!Array.isArray(items) || items.length !== 1 || payload.total !== 1 || payload.truncated === true) throw new Error("JD_LOGISTICS_EXACT_BATCH_MISSING");
        const batch = items[0] as Record<string, unknown> & { currentSelection?: { current: boolean; verifiedRowCount: number; contentHash: string; scopeRevision: number } };
        const receipt = stableReceipt(batch);
        assertLogisticsReceipt(operation, receipt);
        const selected = batch.currentSelection;
        if (canonicalLogisticsJson(operation.receipt) !== canonicalLogisticsJson(receipt)) throw new Error("JD_LOGISTICS_BATCH_RECEIPT_CHANGED");
        const expectedRevision = plan.operations.filter(op => op.departmentId === operation.departmentId && op.sourceKind === operation.sourceKind && op.receipt).at(-1)!.receipt!.scopeRevision;
        if (!selected || selected.current !== true || selected.verifiedRowCount !== operation.rowCount || selected.contentHash !== operation.contentHash
          || selected.scopeRevision !== expectedRevision
          || (current.settings.scopeRevisions.find(s => s.departmentId === operation.departmentId && s.sourceKind === operation.sourceKind)?.revision ?? 0) !== expectedRevision) throw new Error("JD_LOGISTICS_BATCH_NO_LONGER_CURRENT");
        if (receipt.status === "duplicate") {
          const referencePayload = await api(options, plan.baseUrl, new URLSearchParams({ operation: "batches", batchId: receipt.referenceBatchId,
            departmentId: operation.departmentId, sourceKind: operation.sourceKind, pageSize: "1" }));
          const referenceItems = referencePayload.items;
          if (!Array.isArray(referenceItems) || referenceItems.length !== 1 || referencePayload.total !== 1 || referencePayload.truncated === true) throw new Error("JD_LOGISTICS_DUPLICATE_REFERENCE_MISSING");
          const reference = referenceItems[0] as JdLogisticsReceipt & { currentSelection?: { current: boolean; verifiedRowCount: number; contentHash: string; scopeRevision: number } };
          if (reference.batchId !== receipt.referenceBatchId || reference.status !== "imported" || reference.sourceKind !== operation.sourceKind
            || reference.departmentId !== operation.departmentId || reference.businessUnitCode !== operation.businessUnitCode
            || reference.rangeStart !== operation.rangeStart || reference.rangeEnd !== operation.rangeEnd || reference.warehouseCode !== operation.warehouseCode
            || reference.contentHash !== operation.contentHash || reference.rowCount !== operation.rowCount || reference.currentSelection?.current !== true
            || reference.currentSelection.verifiedRowCount !== operation.rowCount || reference.currentSelection.contentHash !== operation.contentHash
            || reference.currentSelection.scopeRevision !== expectedRevision) throw new Error("JD_LOGISTICS_DUPLICATE_REFERENCE_MISMATCH");
        }
        operation.stage = "verified"; await persist(options.root, plan);
      }
      await lock.assertOwned(); await loadOwned(options, plan); await assertPolicy(options, plan);
      plan.stage = plan.notification.stage === "notified" ? "completed" : "verified"; await persist(options.root, plan); return publicJdLogisticsPlan(plan);
    } catch (error) {
      plan.stage = "failed"; plan.failure = { code: code(error), stage: "verify", at: new Date().toISOString() };
      await persist(options.root, plan); throw new Error(plan.failure.code);
    }
  });
}
const notificationStatuses = ["disabled", "not_configured", "empty", "sent", "duplicate", "unknown"] as const;
function safeNotificationReason(value: unknown) { return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,120}$/.test(value) ? value : undefined; }
function notificationResult(payload: Record<string, unknown>, plan: JdLogisticsManifest): JdLogisticsNotificationResult {
  const status = payload.status as JdLogisticsNotificationResult["status"];
  const departmentIds = plan.notificationPlan.departmentIds;
  if (!notificationStatuses.includes(status) || !Number.isSafeInteger(payload.riskCount) || Number(payload.riskCount) < 0 || Number(payload.riskCount) > 50000
    || !Number.isSafeInteger(payload.unknownCount) || Number(payload.unknownCount) < 0 || Number(payload.unknownCount) > 50000
    || typeof payload.notificationAvailable !== "boolean" || !Array.isArray(payload.departments) || payload.departments.length !== departmentIds.length) throw new Error("JD_LOGISTICS_NOTIFICATION_RECEIPT_INVALID");
  const departments = payload.departments.map(item => {
    const row = item as Record<string, unknown>;
    if (!row || typeof row.departmentId !== "string" || !departmentIds.includes(row.departmentId)
      || !notificationStatuses.includes(row.status as JdLogisticsNotificationResult["status"]) || !Number.isSafeInteger(row.riskCount)
      || Number(row.riskCount) < 0 || Number(row.riskCount) > 50000) throw new Error("JD_LOGISTICS_NOTIFICATION_RECEIPT_INVALID");
    const reason = safeNotificationReason(row.reason);
    return { departmentId: row.departmentId, status: String(row.status), riskCount: Number(row.riskCount), ...(reason ? { reason } : {}) };
  });
  if (new Set(departments.map(row => row.departmentId)).size !== departments.length
    || ["sent", "duplicate", "empty"].includes(status) && departments.reduce((sum, row) => sum + row.riskCount, 0) !== payload.riskCount
    || status === "empty" && payload.riskCount !== 0) throw new Error("JD_LOGISTICS_NOTIFICATION_RECEIPT_INVALID");
  const result: JdLogisticsNotificationResult = { status, riskCount: Number(payload.riskCount), unknownCount: Number(payload.unknownCount), notificationAvailable: payload.notificationAvailable, departments };
  const reason = safeNotificationReason(payload.reason); if (reason) result.reason = reason;
  for (const key of ["deliveryId", "receiptHash", "configDigest", "sourceDigest", "scopeDigest"] as const) {
    if (payload[key] !== undefined && payload[key] !== "") {
      if (typeof payload[key] !== "string" || !(key === "deliveryId" ? /^[A-Za-z0-9._:-]{1,100}$/ : /^[a-f0-9]{64}$/).test(payload[key] as string)) throw new Error("JD_LOGISTICS_NOTIFICATION_RECEIPT_INVALID");
      result[key] = payload[key] as string;
    }
  }
  if (["sent", "duplicate"].includes(status) && (!result.deliveryId || !result.receiptHash || !result.sourceDigest || !result.scopeDigest
    || result.configDigest !== plan.notificationPlan.configDigest || !result.notificationAvailable || !result.riskCount)) throw new Error("JD_LOGISTICS_NOTIFICATION_RECEIPT_INVALID");
  return result;
}
async function verifyNotificationLedger(options: Dependencies, plan: JdLogisticsManifest, result: JdLogisticsNotificationResult) {
  if (!result.deliveryId) throw new Error("JD_LOGISTICS_NOTIFICATION_RECEIPT_INVALID");
  const payload = await api(options, plan.baseUrl, new URLSearchParams({ operation: "notifications", deliveryId: result.deliveryId, pageSize: "1" }));
  if (!Array.isArray(payload.items) || payload.items.length !== 1 || payload.total !== 1 || payload.truncated === true) throw new Error("JD_LOGISTICS_NOTIFICATION_LEDGER_MISSING");
  const receipt = payload.items[0] as Record<string, unknown>;
  if (!receipt || receipt.deliveryId !== result.deliveryId || receipt.status !== "sent" || receipt.riskCount !== result.riskCount || receipt.unknownCount !== result.unknownCount
    || !Array.isArray(receipt.departmentIds) || canonicalLogisticsJson([...receipt.departmentIds].sort()) !== canonicalLogisticsJson([...plan.notificationPlan.departmentIds].sort())
    || !validLogisticsDate(receipt.businessDate) || !Number.isSafeInteger(receipt.displayedCount) || Number(receipt.displayedCount) < 1 || Number(receipt.displayedCount) > result.riskCount
    || typeof receipt.sentAt !== "string" || !Number.isFinite(Date.parse(receipt.sentAt))) throw new Error("JD_LOGISTICS_NOTIFICATION_LEDGER_MISMATCH");
  for (const key of ["receiptHash", "configDigest", "sourceDigest", "scopeDigest"] as const) {
    if (receipt[key] !== result[key]) throw new Error("JD_LOGISTICS_NOTIFICATION_LEDGER_MISMATCH");
  }
  for (const key of ["targetDigest", "messageHash"]) if (typeof receipt[key] !== "string" || !/^[a-f0-9]{64}$/.test(receipt[key] as string)) throw new Error("JD_LOGISTICS_NOTIFICATION_LEDGER_MISMATCH");
}
/** D never derives a message or recipient. Only Django can calculate current
 * qualified risks, resolve the fixed target and claim the durable send ledger. */
export async function notifyJdLogisticsN8nPlan(reference: Pick<JdLogisticsManifest, "runId" | "planHash">, options: Dependencies) {
  return withJackyunRunLock({ runId: reference.runId, purpose: "jd-logistics-notify", lockDirectory: paths(options.root).lock }, async lock => {
    const plan = await loadOwned(options, reference);
    if (plan.notification.stage === "notified" && plan.stage === "completed") {
      if (plan.notification.result && ["sent", "duplicate"].includes(plan.notification.result.status)) await verifyNotificationLedger(options, plan, plan.notification.result);
      return publicJdLogisticsPlan(plan);
    }
    if (plan.notification.stage !== "pending") throw new Error("JD_LOGISTICS_NOTIFICATION_REPLAY_REQUIRES_MANUAL_ACTION");
    if (plan.stage !== "verified" || plan.operations.some(operation => operation.stage !== "verified" || !operation.receipt || operation.export?.browserClosed !== true)) throw new Error("JD_LOGISTICS_NOT_READY_FOR_NOTIFICATION");
    let attempted = false;
    try {
      await lock.assertOwned(); await assertPolicy(options, plan, true);
      const policy = plan.notificationPlan;
      let result: JdLogisticsNotificationResult;
      if (!plan.operations.length || !policy.enabled || !policy.configured || !policy.departmentIds.length) {
        const status = !policy.implemented ? "disabled" : !policy.configured ? "not_configured" : !policy.enabled ? "disabled" : "empty";
        const reason = !plan.operations.length ? "no_planned_operations" : !policy.configured ? "notification_target_not_configured"
          : !policy.enabled ? "global_notification_disabled" : "no_verified_inventory_departments";
        result = { status, reason, riskCount: 0, unknownCount: 0, notificationAvailable: policy.enabled && policy.configured,
          departments: policy.departmentIds.map(departmentId => ({ departmentId, status, riskCount: 0 })) };
      } else {
        const operations = plan.operations.filter(operation => policy.departmentIds.includes(operation.departmentId));
        for (const departmentId of policy.departmentIds) {
          if (!["realtime_inventory", "inventory_snapshot"].every(sourceKind => operations.some(operation => operation.departmentId === departmentId && operation.sourceKind === sourceKind && operation.stage === "verified"))) throw new Error("JD_LOGISTICS_NOTIFICATION_SOURCE_PAIR_MISSING");
        }
        const body = { operation: "notify", departmentIds: policy.departmentIds, runId: plan.runId, executionId: plan.executionId,
          protocol: jdLogisticsProtocol, planHash: plan.planHash, verifiedBatches: operations.map(operation => ({ departmentId: operation.departmentId,
            sourceKind: operation.sourceKind, batchId: operation.receipt!.batchId, scopeRevision: operation.receipt!.scopeRevision,
            contentHash: operation.receipt!.contentHash, rawFileHash: operation.receipt!.rawFileHash })) };
        plan.notification.stage = "notifying"; plan.notification.requestHash = logisticsHash(body); await persist(options.root, plan);
        await lock.assertOwned(); await loadOwned(options, plan); await assertPolicy(options, plan, true);
        attempted = true;
        const payload = await api(options, plan.baseUrl, new URLSearchParams(), body);
        result = notificationResult(payload, plan); plan.notification.response = result; await persist(options.root, plan);
        if (result.status === "unknown") throw new Error("JD_LOGISTICS_NOTIFICATION_RESULT_UNKNOWN");
        if (["disabled", "not_configured"].includes(result.status)) throw new Error("JD_LOGISTICS_NOTIFICATION_NOT_DELIVERED");
        if (result.status === "empty" && result.unknownCount !== 0) throw new Error("JD_LOGISTICS_NOTIFICATION_COVERAGE_UNCONFIRMED");
        if (["sent", "duplicate"].includes(result.status)) await verifyNotificationLedger(options, plan, result);
      }
      await lock.assertOwned(); await loadOwned(options, plan);
      plan.notification.result = result; plan.notification.stage = "notified"; plan.stage = "completed";
      await persist(options.root, plan); return publicJdLogisticsPlan(plan);
    } catch (error) {
      const failureCode = code(error);
      const unknown = attempted && !["JD_LOGISTICS_NOTIFICATION_REJECTED", "JD_LOGISTICS_API_ACCESS_DENIED", "JD_LOGISTICS_NOTIFICATION_NOT_DELIVERED", "JD_LOGISTICS_NOTIFICATION_COVERAGE_UNCONFIRMED"].includes(failureCode);
      plan.notification.stage = unknown ? "unknown" : "failed";
      if (unknown) plan.notification.result = { ...(plan.notification.response ?? { riskCount: 0, unknownCount: 0, notificationAvailable: false, departments: [] }), status: "unknown", reason: "delivery_receipt_unverified" };
      else if (plan.notification.response) plan.notification.result = plan.notification.response;
      plan.stage = "failed"; plan.failure = { code: failureCode, stage: "notify", at: new Date().toISOString() };
      await persist(options.root, plan); throw new Error(failureCode);
    }
  });
}
