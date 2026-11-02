import { applyTmallDirectDailyPolicy as applySharedPolicy } from "./tmall-direct-daily-policy-runtime.mjs";

export function applyTmallDirectDailyPolicy<T extends {
  storeKey: string; enabled: boolean; productMasterExportMode?: string;
  productMasterCadence?: { intervalDays: number; initialDueDate: string };
}>(stores: readonly T[]): T[] {
  return applySharedPolicy(stores);
}
