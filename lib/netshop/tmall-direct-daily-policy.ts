// Interpretation is bound to the new code, so publishing source never changes
// the old helper's mutable registry before the coordinated cutover.
const approvedStores = new Set([
  "tmall-yijiu", "tmall-yiyong", "tmall-lili", "tmall-tuofeng", "tmall-cuizhiwang", "tmall-masitu",
]);

export function applyTmallDirectDailyPolicy<T extends {
  storeKey: string; enabled: boolean; productMasterExportMode?: string;
  productMasterCadence?: { intervalDays: number; initialDueDate: string };
}>(stores: readonly T[]): T[] {
  return stores.map(store => {
    if (!store.enabled || !approvedStores.has(store.storeKey)) return store;
    if (!store.productMasterCadence || ![1, 3].includes(store.productMasterCadence.intervalDays)
      || store.productMasterExportMode !== undefined
        && !["product_manager", "on_sale_pagewise_excel", "direct_mtop"].includes(store.productMasterExportMode)) {
      throw new Error("天猫每日直连策略拒绝未核验的原节奏或导出模式");
    }
    return { ...store, productMasterExportMode: "direct_mtop",
      productMasterCadence: { ...store.productMasterCadence, intervalDays: 1 } };
  });
}
