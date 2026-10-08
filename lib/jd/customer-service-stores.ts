// Customer-service automation accepts only the four registered JD identities.
// Browser settings continue to come from the existing store registry.
export const jdCustomerServiceStores = Object.freeze([
  Object.freeze({ storeKey: "jd-yiyong-director", shopId: "701455", shopName: "志高商用设备旗舰店", workflowId: "JdCustomerService2026", fileStem: "jd-customer-service-daily" }),
  Object.freeze({ storeKey: "jd-maidehao-operator1", shopId: "745866", shopName: "志高切肉机旗舰店", workflowId: "JdCustomerServiceCutMeat2026", fileStem: "jd-customer-service-cut-meat-daily" }),
  Object.freeze({ storeKey: "jd-chudian-weizhang", shopId: "941935", shopName: "志高商用厨电旗舰店", workflowId: "JdCustomerServiceChudian2026", fileStem: "jd-customer-service-chudian-daily" }),
  Object.freeze({ storeKey: "jd-cuizhiwang-dengweizhang", shopId: "711743", shopName: "志高商用洗碗机旗舰店", workflowId: "JdCustomerServiceDishwasher2026", fileStem: "jd-customer-service-dishwasher-daily" }),
] as const);
export type CustomerServiceStore = (typeof jdCustomerServiceStores)[number];
export const customerServiceStoreHeader = "x-teruisi-jd-customer-service-store-key";

export function customerServiceStore(value: unknown = jdCustomerServiceStores[0].storeKey): CustomerServiceStore {
  const store = jdCustomerServiceStores.find(item => item.storeKey === value);
  if (!store) throw new Error("CUSTOMER_SERVICE_STORE_INVALID_MANUAL_ACTION");
  return store;
}
export function customerServiceStoreContextError(value: unknown, expectedKey?: string) {
  try {
    const store = customerServiceStore(value);
    return (expectedKey === undefined || store.storeKey === expectedKey) ? null : { error: "customer_service_store_mismatch" };
  } catch { return { error: "customer_service_store_invalid" }; }
}

// Shared agents are not shop identity. Both interactive and automated imports
// must explicitly bind the registered key and its canonical name.
export function resolveCustomerServiceImportShop(shopName: string, storeKey: unknown) {
  if (typeof storeKey !== "string" || !storeKey) throw new Error("CUSTOMER_SERVICE_IMPORT_STORE_REQUIRED");
  if (customerServiceStore(storeKey).shopName !== shopName) throw new Error("CUSTOMER_SERVICE_IMPORT_STORE_MISMATCH");
  return shopName;
}
