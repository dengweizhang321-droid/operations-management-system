import type { CustomerServicePeriod } from "./customer-service-workflow";

// Operator closure is independent from source recovery. Verification only
// finishes an executed plan; failed closure never marks a failed plan complete.
export type CustomerServiceCloseKind = "pre_export_zero_effect" | "downloaded_pair" | "downloaded_list_only" | "executed_verify";
export type CustomerServiceCloseIdentity = {
  storeKey: string; shopName: string; shopId: string;
  originalExecutionId: string; originalPlanSha256: string;
  failureCode: string; period: CustomerServicePeriod;
  kind: CustomerServiceCloseKind;
};
export type CustomerServiceCloseTarget = {
  ok: true; closeAllowed: boolean; reason: string;
  target?: CustomerServiceCloseIdentity;
};
export function validCustomerServiceCloseIdentity(value: unknown): value is CustomerServiceCloseIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as CustomerServiceCloseIdentity;
  const keys = ["storeKey", "shopName", "shopId", "originalExecutionId", "originalPlanSha256", "failureCode", "period", "kind"];
  return Object.keys(v).sort().join() === keys.sort().join()
    && typeof v.storeKey === "string" && typeof v.shopName === "string" && typeof v.shopId === "string"
    && typeof v.originalExecutionId === "string" && /^[A-Za-z0-9_-]{1,96}$/.test(v.originalExecutionId)
    && typeof v.originalPlanSha256 === "string" && /^[a-f0-9]{64}$/.test(v.originalPlanSha256)
    && typeof v.failureCode === "string" && ["pre_export_zero_effect", "downloaded_pair", "downloaded_list_only", "executed_verify"].includes(v.kind)
    && !!v.period && typeof v.period === "object";
}
