import type { CustomerServicePeriod } from "./customer-service-workflow";

// Mirrors lib/jackyun/operator-close-contract.ts's shape for the JD
// customer-service pre-submit closure. Unlike Jackyun's close target, there
// is no running-task lifecycle here: the target is a stuck "failed" plan on
// disk, and the only action is minting a human approval for the next
// planCustomerServiceRun() to consume (tools/jd-customer-service-source-recovery.ts).
export type CustomerServiceCloseIdentity = {
  storeKey: string; shopName: string; shopId: string;
  originalExecutionId: string; originalPlanSha256: string;
  failureCode: string; period: CustomerServicePeriod;
  kind: "pre_export_zero_effect" | "downloaded_pair";
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
    && typeof v.failureCode === "string" && (v.kind === "pre_export_zero_effect" || v.kind === "downloaded_pair")
    && !!v.period && typeof v.period === "object";
}
