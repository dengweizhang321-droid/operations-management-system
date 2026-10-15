import { createHash } from "node:crypto";
import type { JdLogisticsSource } from "../inventory/jd-logistics-contract";
import type { JdStore } from "./store-registry";

export const jdLogisticsProtocol = "jd-logistics-pipeline-v1";
export const jdLogisticsContractVersion = "jd-logistics-v1";
export const jdLogisticsWorkflowKey = "jd-logistics";
export const jdLogisticsSources = ["flow", "shop_products", "realtime_inventory", "inventory_snapshot"] as const;
export const jdLogisticsSourceUrls: Record<JdLogisticsSource, string> = {
  flow: "https://wl.jdl.com/bsc-inventory/flow", shop_products: "https://wl.jdl.com/supplychain-bbi/esg",
  realtime_inventory: "https://jh.jdl.com/#/storage/RealInventory", inventory_snapshot: "https://jh.jdl.com/#/OfflineInventorySmall",
};
export type JdLogisticsBinding = {
  sourceKind: JdLogisticsSource; departmentId: string; businessUnitCode: string;
  enabled: boolean; sourceVerified: boolean; contractVersion: string;
  collectorStoreKey: string; authorizedStoreKeys: string[]; warehouseCode: string;
  initialStartDate?: string; maxSpanDays?: number;
};
export type JdLogisticsConfig = { version: 1; bindings: JdLogisticsBinding[] };
export type JdLogisticsSettings = {
  contractVersion: string; departments: Array<{
    id: string; businessUnitCode: string; storeKeys: string[]; logisticsEnabled: boolean;
    capabilities: Record<JdLogisticsSource, boolean>; revision: number;
    monitorEnabled?: boolean; pushEnabled?: boolean; stockoutThresholdDays?: number | null;
  }>;
  scopeRevisions: Array<{ departmentId: string; sourceKind: JdLogisticsSource; revision: number }>;
  notification?: { implemented: true; enabled: boolean; configured: boolean; groupName: string; robotName: string; configDigest: string; reason?: string };
};
export type JdLogisticsNotificationPlan = {
  implemented: boolean; enabled: boolean; configured: boolean; groupName: string; robotName: string;
  configDigest: string; departmentIds: string[]; policyHash: string;
};
export type JdLogisticsScope = {
  sourceKind: JdLogisticsSource; departmentId: string; businessUnitCode: string;
  rangeStart: string; rangeEnd: string; warehouseCode: string;
};
export type JdLogisticsIdentityEvidence = { observedBusinessUnitCode: string; observedAt: string; sourceUrl: string; storeKey: string };
export type JdLogisticsExportOptions = JdLogisticsScope & {
  root: string; runId: string; executionId: string; operationId: string; store: JdStore;
  contractVersion: string; downloadDirectory: string; assertOwner: () => Promise<void>;
  sourceStatus?: "enabled";
};
export type JdLogisticsExportResult = {
  filePath: string; taskIdentity: string; complete: true; browserClosed: true;
  collectedAt: string; sourceAsOf?: string; identityEvidence: JdLogisticsIdentityEvidence;
  scope: JdLogisticsScope; contractVersion: string;
  sourceStatus?: "enabled";
};
export type JdLogisticsSelection = JdLogisticsScope & {
  operationId: string; collectorStoreKey: string; contractVersion: string; policyHash: string;
  initialScopeRevision: number; storeIdentityHash: string;
  sourceStatus: "enabled" | "source_default";
};
export function canonicalLogisticsJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalLogisticsJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort((left, right) => {
    const a = Array.from(left), b = Array.from(right);
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const difference = a[i].codePointAt(0)! - b[i].codePointAt(0)!;
      if (difference) return difference;
    }
    return a.length - b.length;
  }).map(key => `${JSON.stringify(key)}:${canonicalLogisticsJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  throw new Error("JD_LOGISTICS_INVALID_CANONICAL_VALUE");
}
export function logisticsHash(value: unknown) { return createHash("sha256").update(canonicalLogisticsJson(value)).digest("hex"); }
export function validLogisticsDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function logisticsDayAfter(day: string, offset = 1) {
  if (!validLogisticsDate(day)) throw new Error("JD_LOGISTICS_INVALID_DATE");
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}
export function logisticsShanghaiDay(now: Date) {
  if (!Number.isFinite(now.valueOf())) throw new Error("JD_LOGISTICS_INVALID_CLOCK");
  return new Date(now.valueOf() + 8 * 3_600_000).toISOString().slice(0, 10);
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function identifier(value: unknown) { return typeof value === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(value); }
export function parseJdLogisticsConfig(value: unknown): JdLogisticsConfig {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.bindings) || value.bindings.length > 800
    || Object.keys(value).some(key => !["version", "bindings"].includes(key))) throw new Error("JD_LOGISTICS_INVALID_CONFIG");
  const allowed = ["sourceKind", "departmentId", "businessUnitCode", "enabled", "sourceVerified", "contractVersion", "collectorStoreKey", "authorizedStoreKeys", "warehouseCode", "initialStartDate", "maxSpanDays"];
  const bindings = value.bindings.map(raw => {
    if (!object(raw) || Object.keys(raw).some(key => !allowed.includes(key))
      || !jdLogisticsSources.includes(raw.sourceKind as JdLogisticsSource)
      || !identifier(raw.departmentId) || !identifier(raw.businessUnitCode)
      || typeof raw.enabled !== "boolean" || typeof raw.sourceVerified !== "boolean"
      || typeof raw.contractVersion !== "string" || raw.contractVersion.length > 100
      || typeof raw.collectorStoreKey !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.collectorStoreKey)
      || !Array.isArray(raw.authorizedStoreKeys) || raw.authorizedStoreKeys.length > 200
      || !raw.authorizedStoreKeys.length || raw.authorizedStoreKeys.some(key => typeof key !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(key))
      || new Set(raw.authorizedStoreKeys).size !== raw.authorizedStoreKeys.length || !raw.authorizedStoreKeys.includes(raw.collectorStoreKey)
      || typeof raw.warehouseCode !== "string" || raw.warehouseCode.length > 100
      || raw.initialStartDate !== undefined && !validLogisticsDate(raw.initialStartDate)
      || raw.maxSpanDays !== undefined && (!Number.isSafeInteger(raw.maxSpanDays) || Number(raw.maxSpanDays) < 1 || Number(raw.maxSpanDays) > 366)) throw new Error("JD_LOGISTICS_INVALID_SOURCE_BINDING");
    return { ...raw, authorizedStoreKeys: [...raw.authorizedStoreKeys].sort() } as JdLogisticsBinding;
  });
  return { version: 1, bindings };
}
export function parseJdLogisticsSettings(value: unknown): JdLogisticsSettings {
  if (!object(value) || value.contractVersion !== jdLogisticsContractVersion || !Array.isArray(value.departments)
    || value.departments.length > 200 || !Array.isArray(value.scopeRevisions) || value.scopeRevisions.length > 800) throw new Error("JD_LOGISTICS_SETTINGS_UNAVAILABLE");
  const ids = new Set<string>(); const units = new Set<string>();
  for (const d of value.departments) {
    if (!object(d) || !identifier(d.id) || !identifier(d.businessUnitCode) || ids.has(String(d.id)) || units.has(String(d.businessUnitCode))
      || !Array.isArray(d.storeKeys) || d.storeKeys.some(key => typeof key !== "string") || new Set(d.storeKeys).size !== d.storeKeys.length
      || typeof d.logisticsEnabled !== "boolean" || !Number.isSafeInteger(d.revision) || Number(d.revision) < 0 || !object(d.capabilities)
      || d.monitorEnabled !== undefined && typeof d.monitorEnabled !== "boolean" || d.pushEnabled !== undefined && typeof d.pushEnabled !== "boolean"
      || d.stockoutThresholdDays !== undefined && d.stockoutThresholdDays !== null && (!Number.isSafeInteger(d.stockoutThresholdDays) || Number(d.stockoutThresholdDays) < 1 || Number(d.stockoutThresholdDays) > 3650)
      || jdLogisticsSources.some(kind => typeof (d.capabilities as Record<string, unknown>)[kind] !== "boolean")) throw new Error("JD_LOGISTICS_INVALID_SETTINGS");
    ids.add(String(d.id)); units.add(String(d.businessUnitCode));
  }
  const scopes = new Set<string>();
  for (const scope of value.scopeRevisions) {
    if (!object(scope) || !ids.has(String(scope.departmentId)) || !jdLogisticsSources.includes(scope.sourceKind as JdLogisticsSource)
      || !Number.isSafeInteger(scope.revision) || Number(scope.revision) < 0 || scopes.has(`${scope.departmentId}/${scope.sourceKind}`)) throw new Error("JD_LOGISTICS_INVALID_SCOPE_REVISION");
    scopes.add(`${scope.departmentId}/${scope.sourceKind}`);
  }
  const notification = value.notification;
  if (notification !== undefined && (!object(notification) || notification.implemented !== true || typeof notification.enabled !== "boolean"
    || typeof notification.configured !== "boolean" || typeof notification.groupName !== "string" || notification.groupName.length > 100
    || typeof notification.robotName !== "string" || notification.robotName.length > 100 || typeof notification.configDigest !== "string"
    || !(/^[a-f0-9]{64}$/.test(notification.configDigest) || notification.configured === false && notification.configDigest === ""))) throw new Error("JD_LOGISTICS_NOTIFICATION_POLICY_INVALID");
  return value as unknown as JdLogisticsSettings;
}
export function planJdLogisticsNotifications(settings: JdLogisticsSettings, operations: readonly JdLogisticsSelection[]): JdLogisticsNotificationPlan {
  const policy = settings.notification ?? { implemented: false, enabled: false, configured: false, groupName: "测试群聊", robotName: "志高助手", configDigest: "unavailable" };
  if (policy.enabled && policy.configured && (policy.groupName !== "测试群聊" || policy.robotName !== "志高助手")) throw new Error("JD_LOGISTICS_NOTIFICATION_TARGET_MISMATCH");
  const departments = settings.departments.filter(department => operations.some(op => op.departmentId === department.id)).map(department => ({
    departmentId: department.id, revision: department.revision, logisticsEnabled: department.logisticsEnabled,
    monitorEnabled: department.monitorEnabled === true, pushEnabled: department.pushEnabled === true,
    threshold: department.stockoutThresholdDays ?? null,
    sourceKinds: [...new Set(operations.filter(op => op.departmentId === department.id).map(op => op.sourceKind))].sort(),
  })).sort((a, b) => a.departmentId.localeCompare(b.departmentId));
  const departmentIds = departments.filter(department => department.logisticsEnabled && department.monitorEnabled && department.pushEnabled
    && department.threshold !== null && department.sourceKinds.includes("realtime_inventory") && department.sourceKinds.includes("inventory_snapshot")).map(department => department.departmentId);
  if (policy.enabled && policy.configured && departmentIds.length > 30) throw new Error("JD_LOGISTICS_NOTIFICATION_SCOPE_TOO_LARGE");
  const frozen = { implemented: policy.implemented, enabled: policy.enabled, configured: policy.configured,
    groupName: policy.groupName, robotName: policy.robotName, configDigest: policy.configDigest, departmentIds };
  return { ...frozen, policyHash: logisticsHash({ ...frozen, departments }) };
}
export function selectJdLogisticsOperations(config: JdLogisticsConfig, settings: JdLogisticsSettings, stores: readonly JdStore[], now: Date): JdLogisticsSelection[] {
  const today = logisticsShanghaiDay(now); const yesterday = logisticsDayAfter(today, -1);
  const selected = new Map<string, JdLogisticsSelection>();
  for (const b of config.bindings) {
    if (!b.enabled) continue;
    const d = settings.departments.find(item => item.id === b.departmentId);
    if (!d) throw new Error("JD_LOGISTICS_ENABLED_DEPARTMENT_MISSING");
    if (!d.logisticsEnabled || !d.capabilities[b.sourceKind]) continue;
    if (!b.sourceVerified || b.contractVersion !== jdLogisticsContractVersion || d.businessUnitCode !== b.businessUnitCode
      || b.authorizedStoreKeys.some(key => !d.storeKeys.includes(key))) throw new Error("JD_LOGISTICS_SOURCE_NOT_READY");
    const store = stores.find(item => item.storeKey === b.collectorStoreKey && item.enabled);
    if (!store || !d.storeKeys.includes(store.storeKey)) throw new Error("JD_LOGISTICS_COLLECTOR_UNAVAILABLE");
    if (b.sourceKind === "shop_products" && b.warehouseCode) throw new Error("JD_LOGISTICS_PRODUCT_SCOPE_MUST_BE_COMPLETE");
    let rangeStart = b.sourceKind === "inventory_snapshot" ? yesterday : today;
    let rangeEnd = logisticsDayAfter(rangeStart);
    if (b.sourceKind === "flow") {
      if (!b.initialStartDate || !b.maxSpanDays || b.initialStartDate > yesterday) throw new Error("JD_LOGISTICS_FLOW_RANGE_NOT_CONFIGURED");
      rangeStart = b.initialStartDate; rangeEnd = today;
      if ((Date.parse(rangeEnd) - Date.parse(rangeStart)) / 86_400_000 > b.maxSpanDays) throw new Error("JD_LOGISTICS_FLOW_RANGE_EXCEEDS_SOURCE_LIMIT");
    }
    const scope = { sourceKind: b.sourceKind, departmentId: d.id, businessUnitCode: b.businessUnitCode, rangeStart, rangeEnd, warehouseCode: b.warehouseCode };
    const key = logisticsHash(scope);
    const sourceStatus = b.sourceKind === "shop_products" ? "enabled" : "source_default";
    const policyHash = logisticsHash({ binding: b, sourceStatus, department: { id: d.id, businessUnitCode: d.businessUnitCode, storeKeys: [...d.storeKeys].sort(), logisticsEnabled: d.logisticsEnabled, capability: d.capabilities[b.sourceKind], revision: d.revision } });
    const item: JdLogisticsSelection = { ...scope, operationId: key.slice(0, 32), collectorStoreKey: store.storeKey,
      contractVersion: b.contractVersion, policyHash, storeIdentityHash: logisticsHash(store), sourceStatus,
      initialScopeRevision: settings.scopeRevisions.find(r => r.departmentId === d.id && r.sourceKind === b.sourceKind)?.revision ?? 0 };
    const previous = selected.get(key);
    if (previous) {
      // A shared business unit is one authoritative export. Conflicting collector
      // choices require an explicit policy correction, never an automatic switch.
      if (previous.collectorStoreKey !== item.collectorStoreKey || previous.policyHash !== item.policyHash) throw new Error("JD_LOGISTICS_AMBIGUOUS_SHARED_COLLECTOR");
      continue;
    }
    if ([...selected.values()].some(existing => existing.departmentId === item.departmentId && existing.sourceKind === item.sourceKind
      && (!existing.warehouseCode || !item.warehouseCode))) throw new Error("JD_LOGISTICS_OVERLAPPING_SOURCE_SCOPES");
    selected.set(key, item);
  }
  return [...selected.values()].sort((a, b) => a.businessUnitCode.localeCompare(b.businessUnitCode) || jdLogisticsSources.indexOf(a.sourceKind) - jdLogisticsSources.indexOf(b.sourceKind)
    || a.warehouseCode.localeCompare(b.warehouseCode));
}
