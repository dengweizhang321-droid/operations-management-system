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
  replenishmentCycleDays?: number;
  warehousePreferences?: JdWarehousePreference[];
  productOrder?: string[];
  unmonitoredProductCodes?: string[];
};
export type JdWarehousePreference = { warehouseKey: string; enabled: boolean; displayName: string };
export type JdMonitorWarehouse = { departmentId: string; key: string; code: string; name: string };
export type JdLogisticsOptions = { monitorWarehouses?: JdMonitorWarehouse[]; departments: JdLogisticsDepartment[]; warehouses: Array<{ code: string; name: string; key?: string; identityKind?: "code" | "name" }>; scopeRevisions: Array<{ departmentId: string; sourceKind: JdLogisticsSource; revision: number }>; notification?: { implemented: boolean; enabled: boolean; configured: boolean; groupName: string; robotName: string; configDigest: string; reason: string } };
export type JdLogisticsRow = Record<string, string | number | boolean | null | Record<string, string | null>>;
export type JdLogisticsItem = Record<string, unknown>;
export type JdLogisticsList = { items: JdLogisticsItem[]; total: number; page: number; pageSize: number; truncated?: boolean };
export type JdLogisticsTab = "flows" | "transfers" | "mappings" | "batches";
export type JdInboundTab = "monitor" | "mappings" | "flows" | "transfers";
export const jdInventoryHealthStates = ["stockout", "replenish", "insufficient_evidence", "in_transit_cover", "slow_turnover", "no_sales", "healthy"] as const;
export type JdInventoryHealthState = typeof jdInventoryHealthStates[number];
export type JdInventoryHealthFilter = "all" | JdInventoryHealthState;
export type JdInventoryHealthCounts = Record<JdInventoryHealthFilter, number>;
export const jdInventoryHealthLabels: Record<JdInventoryHealthFilter, string> = { all: "全部", stockout: "缺货", replenish: "补货", insufficient_evidence: "待补充依据", in_transit_cover: "在途可覆盖", slow_turnover: "低周转", no_sales: "无销量", healthy: "健康" };
function inventoryHealthFilter(value: string | null): JdInventoryHealthFilter {
  return jdInventoryHealthStates.includes(value as JdInventoryHealthState) ? value as JdInventoryHealthState : "all";
}
export type JdLogisticsFilters = { departmentId: string; warehouseCode: string; startDate: string; endDate: string; q: string; page: number };
export type JdLogisticsEnvelope<T> = { success: true; data: T };

export function readJdLogisticsLocation(input: string) {
  const url = new URL(canonicalizeJdLogisticsLocation(input), "http://localhost");
  const params = url.searchParams;
  const imported = params.get("module") === "import" && params.get("jdImport") === "logistics";
  const jdTab = inboundTab(params.get("jdTab")) ?? "monitor";
  return {
    jdTab,
    healthState: inventoryHealthFilter(params.get("jdHealth")),
    workspace: imported ? "import" as const : "inventory" as const,
    importView: params.get("view") === "history" ? "history" as const : "files" as const,
    tab: (imported ? "batches" : jdTab === "monitor" ? "mappings" : jdTab) as JdLogisticsTab,
    filters: { departmentId: params.get("jdDepartment") ?? "", warehouseCode: params.get("jdWarehouse") ?? "",
      startDate: locationDate(params.get("jdStart")), endDate: locationDate(params.get("jdEnd")), q: (params.get("jdQuery") ?? "").slice(0, 100),
      page: /^[1-9]\d{0,5}$/.test(params.get("jdPage") ?? "") ? Number(params.get("jdPage")) : 1 },
  };
}

function inboundTab(value: string | null): JdInboundTab | undefined {
  return value === "monitor" || value === "mappings" || value === "flows" || value === "transfers" ? value : undefined;
}

/** Legacy source links are normalized before any child data view is mounted. */
export function canonicalizeJdLogisticsLocation(input: string) {
  const url = new URL(input, "http://localhost");
  const p = url.searchParams;
  const inboundPage = p.get("module") === "inventory" && p.get("view") === "inbound";
  const importPage = p.get("module") === "import" && p.get("jdImport") === "logistics";
  if (!inboundPage && !importPage) return `${url.pathname}${url.search}${url.hash}`;
  const route = () => JSON.stringify([p.get("module"), p.get("view"), p.get("jdTab"), p.get("jdInbound"), p.get("jdPopTab"), p.get("jdCTab")]);
  const before = route();
  if (importPage) {
    if (!["files", "history"].includes(p.get("view") ?? "")) p.set("view", "files");
    p.delete("jdTab");
  } else {
    const legacyTab = p.get("jdPopTab");
    const explicitTab = inboundTab(p.get("jdTab"));
    if (!explicitTab && legacyTab === "batches" && p.get("jdInbound") !== "cwarehouse" && p.get("jdInbound") !== "erp") {
      p.set("module", "import"); p.set("view", "history"); p.set("jdImport", "logistics");
      p.delete("jdTab");
    } else {
      const cTab = p.get("jdCTab");
      const tab = explicitTab ?? (p.get("jdInbound") === "cwarehouse" ? cTab === "flows" || cTab === "transfers" ? cTab : "monitor"
        : p.get("jdInbound") === "erp" ? "monitor"
          : legacyTab === "settings" ? "mappings" : inboundTab(legacyTab) ?? (p.get("jdInbound") === "pop" ? "mappings" : "monitor"));
      p.set("jdTab", tab); p.delete("jdImport");
      if (tab === "mappings") {
        if (["jdWarehouse", "jdStart", "jdEnd"].some(key => p.has(key))) p.set("jdPage", "1");
        p.delete("jdWarehouse"); p.delete("jdStart"); p.delete("jdEnd");
      }
    }
  }
  p.delete("jdInbound"); p.delete("jdPopTab"); p.delete("jdCTab");
  if (p.get("module") !== "inventory" || p.get("jdTab") !== "monitor") p.delete("jdHealth");
  else if (p.has("jdHealth") && p.get("jdHealth") !== inventoryHealthFilter(p.get("jdHealth"))) { p.delete("jdHealth"); p.set("jdPage", "1"); }
  if (before !== route()) p.set("jdPage", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

function locationDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : "";
}

export function buildJdLogisticsLocation(input: string, values: { jdTab?: JdInboundTab; healthState?: JdInventoryHealthFilter; filters?: JdLogisticsFilters }) {
  const before = readJdLogisticsLocation(input);
  const url = new URL(canonicalizeJdLogisticsLocation(input), "http://localhost");
  if (values.jdTab) url.searchParams.set("jdTab", values.jdTab);
  if (values.healthState) { if (values.healthState === "all") url.searchParams.delete("jdHealth"); else url.searchParams.set("jdHealth", values.healthState); }
  if (values.filters) {
    const f = values.filters;
    for (const [key, value] of Object.entries({ jdDepartment: f.departmentId, jdWarehouse: f.warehouseCode, jdStart: f.startDate, jdEnd: f.endDate, jdQuery: f.q, jdPage: String(f.page) })) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
  }
  if (url.searchParams.get("jdTab") === "mappings") {
    for (const key of ["jdWarehouse", "jdStart", "jdEnd"]) url.searchParams.delete(key);
  }
  const result = new URL(canonicalizeJdLogisticsLocation(url.href), "http://localhost");
  const after = readJdLogisticsLocation(result.href);
  if (before.jdTab !== after.jdTab || before.workspace !== after.workspace || before.healthState !== after.healthState) result.searchParams.set("jdPage", "1");
  const family = (tab: JdInboundTab) => tab === "flows" || tab === "transfers" ? "ledger" : tab;
  if (before.workspace !== after.workspace || family(before.jdTab) !== family(after.jdTab)) {
    for (const key of ["jdWarehouse", "jdStart", "jdEnd", "jdQuery"]) result.searchParams.delete(key);
  }
  return `${result.pathname}${result.search}${result.hash}`;
}

export function writeJdLogisticsLocation(values: Parameters<typeof buildJdLogisticsLocation>[1], mode: "push" | "replace" = "push") {
  window.history[mode === "push" ? "pushState" : "replaceState"](window.history.state, "", buildJdLogisticsLocation(window.location.href, values));
}
