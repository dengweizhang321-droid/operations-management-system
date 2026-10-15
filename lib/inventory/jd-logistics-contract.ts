export const JD_LOGISTICS_PATH = "/api/inventory/jd-logistics";
export const jdLogisticsSources = ["flow", "shop_products", "realtime_inventory", "inventory_snapshot"] as const;
export type JdLogisticsSource = typeof jdLogisticsSources[number];
export const jdLogisticsSourceLabels: Record<JdLogisticsSource, string> = {
  flow: "库存流水", shop_products: "店铺商品（启用状态）", realtime_inventory: "实时库存", inventory_snapshot: "库存快照",
};
export type JdLogisticsDepartment = {
  id: string; name: string; businessUnitCode: string; storeKeys: string[];
  capabilities: Record<JdLogisticsSource, boolean>; logisticsEnabled: boolean; monitorEnabled: boolean;
  pushEnabled: boolean; revision: number;
  stockoutThresholdDays?: number | null;
};
export type JdLogisticsOptions = { departments: JdLogisticsDepartment[]; warehouses: Array<{ code: string; name: string; key?: string; identityKind?: "code" | "name" }>; scopeRevisions: Array<{ departmentId: string; sourceKind: JdLogisticsSource; revision: number }>; notification?: { implemented: boolean; enabled: boolean; configured: boolean; groupName: string; robotName: string; configDigest: string; reason: string } };
export type JdLogisticsRow = Record<string, string | number | boolean | null | Record<string, string | null>>;
export type JdLogisticsItem = Record<string, unknown>;
export type JdLogisticsList = { items: JdLogisticsItem[]; total: number; page: number; pageSize: number; truncated?: boolean };
export type JdLogisticsTab = "flows" | "transfers" | "mappings" | "batches" | "settings";
export type JdInboundMode = "erp" | "pop" | "cwarehouse";
export type JdLogisticsFilters = { departmentId: string; warehouseCode: string; startDate: string; endDate: string; q: string; page: number };
export type JdLogisticsEnvelope<T> = { success: true; data: T };

export function readJdLogisticsLocation(input: string) {
  const params = new URL(input, "http://localhost").searchParams;
  const tab = params.get("jdPopTab");
  return {
    pop: params.get("jdInbound") === "pop",
    inbound: (params.get("jdInbound") === "pop" ? "pop" : params.get("jdInbound") === "cwarehouse" ? "cwarehouse" : "erp") as JdInboundMode,
    tab: (["flows", "transfers", "mappings", "batches", "settings"] as const).find(value => value === tab) ?? "flows",
    filters: { departmentId: params.get("jdDepartment") ?? "", warehouseCode: params.get("jdWarehouse") ?? "",
      startDate: locationDate(params.get("jdStart")), endDate: locationDate(params.get("jdEnd")), q: (params.get("jdQuery") ?? "").slice(0, 100),
      page: /^[1-9]\d{0,5}$/.test(params.get("jdPage") ?? "") ? Number(params.get("jdPage")) : 1 },
  };
}

function locationDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : "";
}

export function writeJdLogisticsLocation(values: { pop?: boolean; inbound?: JdInboundMode; tab?: JdLogisticsTab; filters?: JdLogisticsFilters }, mode: "push" | "replace" = "push") {
  const url = new URL(window.location.href);
  if (values.pop !== undefined) url.searchParams.set("jdInbound", values.pop ? "pop" : "erp");
  if (values.inbound) url.searchParams.set("jdInbound", values.inbound);
  if (values.tab) url.searchParams.set("jdPopTab", values.tab);
  if (values.filters) {
    const f = values.filters;
    for (const [key, value] of Object.entries({ jdDepartment: f.departmentId, jdWarehouse: f.warehouseCode, jdStart: f.startDate, jdEnd: f.endDate, jdQuery: f.q, jdPage: String(f.page) })) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
  }
  window.history[mode === "push" ? "pushState" : "replaceState"](window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
