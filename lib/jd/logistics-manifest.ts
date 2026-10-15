import { createHash } from "node:crypto";
import type { JdLogisticsRow } from "../inventory/jd-logistics-contract";
import { canonicalLogisticsJson, jdLogisticsContractVersion, jdLogisticsProtocol, jdLogisticsSourceUrls, logisticsHash, logisticsShanghaiDay,
  type JdLogisticsExportResult, type JdLogisticsNotificationPlan, type JdLogisticsSelection } from "./logistics-policy";

export type JdLogisticsReceipt = {
  batchId: string; departmentId: string; businessUnitCode: string; sourceKind: JdLogisticsSelection["sourceKind"];
  rangeStart: string; rangeEnd: string; warehouseCode: string; rawFileHash: string; contentHash: string; rowCount: number;
  status: "imported" | "duplicate"; referenceBatchId: string; scopeRevision: number; origin: "workflow"; storeKey: string;
  collectedAt?: string; sourceAsOf?: string; collectorEvidence?: { runId: string; executionId: string; protocol: string };
  warningCount?: number; warnings?: unknown[];
  sourceStatus?: "enabled";
};
export type JdLogisticsOperation = JdLogisticsSelection & {
  stage: "planned" | "exporting" | "downloaded" | "validated" | "importing" | "imported" | "verified";
  export?: Omit<JdLogisticsExportResult, "filePath"> & { relativePath: string; rawFileHash: string; bytes: number };
  parserVersion?: string; contentHash?: string; rowCount?: number; receipt?: JdLogisticsReceipt;
};
export type JdLogisticsManifest = {
  protocolVersion: typeof jdLogisticsProtocol; workflowKey: "jd-logistics"; runId: string; executionId: string;
  createdAt: string; updatedAt: string; anchorAt: string; baseUrl: string; planHash: string;
  stage: "planned" | "running" | "executed" | "verified" | "completed" | "failed";
  outcome: "pending" | "disabled" | "imported" | "duplicate" | "mixed";
  notificationPlan: JdLogisticsNotificationPlan;
  notification: { stage: "pending" | "notifying" | "notified" | "unknown" | "failed"; requestHash?: string; response?: JdLogisticsNotificationResult; result?: JdLogisticsNotificationResult };
  operations: JdLogisticsOperation[]; failure?: { code: string; stage: "run" | "verify" | "notify"; at: string };
};
export type JdLogisticsNotificationResult = {
  status: "disabled" | "not_configured" | "empty" | "sent" | "duplicate" | "unknown";
  deliveryId?: string; receiptHash?: string; riskCount: number; unknownCount: number; notificationAvailable: boolean; reason?: string;
  configDigest?: string; sourceDigest?: string; scopeDigest?: string;
  departments: Array<{ departmentId: string; status: string; riskCount: number; reason?: string }>;
};
export function logisticsPlanHash(plan: Pick<JdLogisticsManifest, "protocolVersion" | "workflowKey" | "runId" | "executionId" | "anchorAt" | "baseUrl" | "operations" | "notificationPlan">) {
  return logisticsHash({ protocolVersion: plan.protocolVersion, workflowKey: plan.workflowKey, runId: plan.runId,
    executionId: plan.executionId, anchorAt: plan.anchorAt, baseUrl: plan.baseUrl, notificationPlan: plan.notificationPlan,
    operations: plan.operations.map(({ operationId, departmentId, businessUnitCode, sourceKind, rangeStart, rangeEnd, warehouseCode,
      collectorStoreKey, contractVersion, policyHash, initialScopeRevision, storeIdentityHash, sourceStatus }) => ({ operationId, departmentId, businessUnitCode, sourceKind,
      rangeStart, rangeEnd, warehouseCode, collectorStoreKey, contractVersion, policyHash, initialScopeRevision, storeIdentityHash, sourceStatus })) });
}
export function assertLogisticsManifest(value: JdLogisticsManifest, executionId: string) {
  if (!value || value.protocolVersion !== jdLogisticsProtocol || value.workflowKey !== "jd-logistics"
    || !/^[A-Za-z0-9._-]{1,96}$/.test(value.runId) || value.executionId !== executionId
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(executionId) || !Array.isArray(value.operations) || value.operations.length > 800
    || !value.notificationPlan || !value.notification || !["pending", "notifying", "notified", "unknown", "failed"].includes(value.notification.stage)
    || new Set(value.operations.map(operation => operation.operationId)).size !== value.operations.length
    || value.planHash !== logisticsPlanHash(value)) throw new Error("JD_LOGISTICS_MANIFEST_IDENTITY_MISMATCH");
}
function codePointCompare(left: string, right: string) {
  const a = Array.from(left), b = Array.from(right);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const difference = a[i].codePointAt(0)! - b[i].codePointAt(0)!;
    if (difference) return difference;
  }
  return a.length - b.length;
}
/** Mirrors the Django wire normalization; row positions/order are not business
 * fields, and duplicate occurrences remain in the canonical sorted multiset. */
export function logisticsContentHash(rows: readonly JdLogisticsRow[]) {
  const normalized = rows.map(source => {
    const row = Object.fromEntries(Object.entries(source).filter(([key]) => key !== "sourceRowNumber"));
    if (typeof row.businessTime === "string") {
      const parts = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|\+08:00)$/.exec(row.businessTime);
      const time = parts ? Date.parse(`${parts[1]}${parts[3]}`) : NaN;
      if (!parts || !Number.isFinite(time)) throw new Error("JD_LOGISTICS_INVALID_BUSINESS_TIME");
      const micros = (parts[2] ?? "").padEnd(6, "0");
      const fraction = /^0+$/.test(micros) ? "" : `.${micros}`;
      row.businessTime = `${new Date(time + 8 * 3_600_000).toISOString().slice(0, 19)}${fraction}+08:00`;
    }
    return canonicalLogisticsJson(row);
  }).sort(codePointCompare);
  return logisticsHash(normalized);
}
export function logisticsRawHash(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
export function assertLogisticsEnabledProducts(rows: readonly JdLogisticsRow[]) {
  if (!rows.length || rows.some(row => row.productStatus !== "启用")) throw new Error("JD_LOGISTICS_ENABLED_PRODUCT_SCOPE_MISMATCH");
}
export function assertLogisticsExport(operation: JdLogisticsSelection, result: JdLogisticsExportResult, now: Date) {
  const scope = { sourceKind: operation.sourceKind, departmentId: operation.departmentId, businessUnitCode: operation.businessUnitCode,
    rangeStart: operation.rangeStart, rangeEnd: operation.rangeEnd, warehouseCode: operation.warehouseCode };
  const observed = Date.parse(result.identityEvidence?.observedAt), collected = Date.parse(result.collectedAt);
  if (result.complete !== true || result.browserClosed !== true || result.contractVersion !== jdLogisticsContractVersion
    || operation.sourceKind === "shop_products" && (operation.sourceStatus !== "enabled" || result.sourceStatus !== "enabled")
    || canonicalLogisticsJson(result.scope) !== canonicalLogisticsJson(scope)
    || typeof result.taskIdentity !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/.test(result.taskIdentity)
    || result.identityEvidence?.observedBusinessUnitCode !== operation.businessUnitCode
    || result.identityEvidence?.storeKey !== operation.collectorStoreKey || result.identityEvidence?.sourceUrl !== jdLogisticsSourceUrls[operation.sourceKind]
    || !Number.isFinite(observed) || !Number.isFinite(collected) || Math.abs(now.valueOf() - observed) > 86_400_000
    || Math.abs(now.valueOf() - collected) > 86_400_000) throw new Error("JD_LOGISTICS_EXPORT_EVIDENCE_MISMATCH");
  if (operation.sourceKind === "inventory_snapshot" && (!result.sourceAsOf || !Number.isFinite(Date.parse(result.sourceAsOf))
    || logisticsShanghaiDay(new Date(result.sourceAsOf)) !== operation.rangeStart)) throw new Error("JD_LOGISTICS_SNAPSHOT_DATE_UNPROVEN");
  if (operation.sourceKind === "realtime_inventory" && logisticsShanghaiDay(new Date(result.collectedAt)) !== operation.rangeStart) throw new Error("JD_LOGISTICS_REALTIME_DATE_MISMATCH");
}
export function assertLogisticsReceipt(operation: JdLogisticsOperation, receipt: JdLogisticsReceipt) {
  if (!operation.export || !operation.contentHash || !operation.rowCount || !receipt || !/^[A-Za-z0-9._:-]{1,100}$/.test(receipt.batchId)
    || !["imported", "duplicate"].includes(receipt.status) || receipt.sourceKind !== operation.sourceKind
    || receipt.departmentId !== operation.departmentId || receipt.businessUnitCode !== operation.businessUnitCode
    || receipt.rangeStart !== operation.rangeStart || receipt.rangeEnd !== operation.rangeEnd || receipt.warehouseCode !== operation.warehouseCode
    || receipt.rawFileHash !== operation.export.rawFileHash || receipt.contentHash !== operation.contentHash || receipt.rowCount !== operation.rowCount
    || receipt.origin !== "workflow" || receipt.storeKey !== operation.collectorStoreKey || !Number.isSafeInteger(receipt.scopeRevision) || receipt.scopeRevision < 0
    || operation.sourceKind === "shop_products" && receipt.sourceStatus !== "enabled"
    || receipt.warningCount !== undefined && receipt.warningCount !== 0 || receipt.warnings !== undefined && (!Array.isArray(receipt.warnings) || receipt.warnings.length > 0)
    || receipt.status === "duplicate" && !/^[A-Za-z0-9._:-]{1,100}$/.test(receipt.referenceBatchId)) throw new Error("JD_LOGISTICS_IMPORT_RECEIPT_MISMATCH");
}
export function jdLogisticsHelperRequestError(stage: string, busy: boolean, route: string, executionId: string | null, owner: string | null) {
  if (!executionId || !/^[A-Za-z0-9._:-]{1,128}$/.test(executionId)) return { error: "missing_or_invalid_execution_id" };
  if (!owner) return { error: "execution_not_claimed", expected: "/coordination/claim" };
  if (executionId !== owner) return { error: "execution_mismatch" };
  if (busy) return { error: "pipeline_busy" };
  if (route === "/jd-logistics/release") return null;
  if (route === "/jd-logistics/plan" && ["ready", "planned", "executed", "verified", "completed"].includes(stage)) return null;
  if (route === "/jd-logistics/run" && ["planned", "executed"].includes(stage)) return null;
  if (route === "/jd-logistics/verify" && ["executed", "verified", "completed"].includes(stage)) return null;
  if (route === "/jd-logistics/notify" && ["verified", "completed"].includes(stage)) return null;
  return { error: "jd_logistics_stage_mismatch" };
}
