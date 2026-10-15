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
export type JdLogisticsTab = "flows" | "transfers" | "mappings" | "batches";
export type JdInboundMode = "pop" | "cwarehouse";
export type JdCwarehouseTab = "monitor" | "flows" | "transfers";
export type JdLogisticsFilters = { departmentId: string; warehouseCode: string; startDate: string; endDate: string; q: string; page: number };
export type JdLogisticsEnvelope<T> = { success: true; data: T };

export function readJdLogisticsLocation(input: string) {
  const url = new URL(canonicalizeJdLogisticsLocation(input), "http://localhost");
  const params = url.searchParams;
  const imported = params.get("module") === "import" && params.get("jdImport") === "logistics";
  const inbound: JdInboundMode = params.get("jdInbound") === "cwarehouse" ? "cwarehouse" : "pop";
  const cTab: JdCwarehouseTab = params.get("jdCTab") === "flows" ? "flows" : params.get("jdCTab") === "transfers" ? "transfers" : "monitor";
  return {
    pop: inbound === "pop", inbound, cTab,
    workspace: imported ? "import" as const : "inventory" as const,
    importView: params.get("view") === "history" ? "history" as const : "files" as const,
    tab: (imported ? "batches" : inbound === "cwarehouse" && cTab !== "monitor" ? cTab : "mappings") as JdLogisticsTab,
    filters: { departmentId: params.get("jdDepartment") ?? "", warehouseCode: params.get("jdWarehouse") ?? "",
      startDate: locationDate(params.get("jdStart")), endDate: locationDate(params.get("jdEnd")), q: (params.get("jdQuery") ?? "").slice(0, 100),
      page: /^[1-9]\d{0,5}$/.test(params.get("jdPage") ?? "") ? Number(params.get("jdPage")) : 1 },
  };
}

/** Legacy source links are normalized before any child data view is mounted. */
export function canonicalizeJdLogisticsLocation(input: string) {
  const url = new URL(input, "http://localhost");
  const p = url.searchParams;
  const inboundPage = p.get("module") === "inventory" && p.get("view") === "inbound";
  const importPage = p.get("module") === "import" && p.get("jdImport") === "logistics";
  if (!inboundPage && !importPage) return `${url.pathname}${url.search}${url.hash}`;
  const before = JSON.stringify([p.get("module"), p.get("view"), p.get("jdInbound"), p.get("jdPopTab"), p.get("jdCTab")]);
  if (importPage) {
    if (!["files", "history"].includes(p.get("view") ?? "")) p.set("view", "files");
    p.delete("jdInbound"); p.delete("jdPopTab"); p.delete("jdCTab");
  } else {
    const legacyTab = p.get("jdPopTab");
    if (p.get("jdInbound") === "cwarehouse") {
      p.set("jdCTab", p.get("jdCTab") === "flows" ? "flows" : p.get("jdCTab") === "transfers" ? "transfers" : "monitor");
      p.delete("jdPopTab"); p.delete("jdImport");
    } else if (p.get("jdInbound") !== "erp" && legacyTab === "batches") {
      p.set("module", "import"); p.set("view", "history"); p.set("jdImport", "logistics");
      p.delete("jdInbound"); p.delete("jdPopTab"); p.delete("jdCTab");
    } else if (p.get("jdInbound") !== "erp" && (legacyTab === "flows" || legacyTab === "transfers")) {
      p.set("jdInbound", "cwarehouse"); p.set("jdCTab", legacyTab); p.delete("jdPopTab"); p.delete("jdImport");
    } else {
      p.set("jdInbound", "pop"); p.set("jdPopTab", "mappings"); p.delete("jdCTab"); p.delete("jdImport");
      if (["jdWarehouse", "jdStart", "jdEnd"].some(key => p.has(key))) p.set("jdPage", "1");
      p.delete("jdWarehouse"); p.delete("jdStart"); p.delete("jdEnd");
    }
  }
  const after = JSON.stringify([p.get("module"), p.get("view"), p.get("jdInbound"), p.get("jdPopTab"), p.get("jdCTab")]);
  if (before !== after) p.set("jdPage", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

function locationDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : "";
}

export function buildJdLogisticsLocation(input: string, values: { pop?: boolean; inbound?: JdInboundMode; cTab?: JdCwarehouseTab; tab?: JdLogisticsTab; filters?: JdLogisticsFilters }) {
  const before = readJdLogisticsLocation(input);
  const url = new URL(canonicalizeJdLogisticsLocation(input), "http://localhost");
  const inbound = values.inbound ?? (values.pop === undefined ? undefined : values.pop ? "pop" : "cwarehouse");
  if (inbound) {
    url.searchParams.set("jdInbound", inbound);
    if (inbound === "pop") { url.searchParams.set("jdPopTab", "mappings"); url.searchParams.delete("jdCTab"); }
    else { url.searchParams.set("jdCTab", values.cTab ?? "monitor"); url.searchParams.delete("jdPopTab"); }
  }
  if (values.cTab) { url.searchParams.set("jdInbound", "cwarehouse"); url.searchParams.set("jdCTab", values.cTab); url.searchParams.delete("jdPopTab"); }
  if (values.tab) url.searchParams.set("jdPopTab", values.tab);
  if (values.filters) {
    const f = values.filters;
    for (const [key, value] of Object.entries({ jdDepartment: f.departmentId, jdWarehouse: f.warehouseCode, jdStart: f.startDate, jdEnd: f.endDate, jdQuery: f.q, jdPage: String(f.page) })) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
  }
  if (url.searchParams.get("jdInbound") === "pop") {
    for (const key of ["jdWarehouse", "jdStart", "jdEnd"]) url.searchParams.delete(key);
  }
  const result = new URL(canonicalizeJdLogisticsLocation(url.href), "http://localhost");
  const after = readJdLogisticsLocation(result.href);
  if (before.inbound !== after.inbound || before.cTab !== after.cTab || before.tab !== after.tab || before.workspace !== after.workspace) result.searchParams.set("jdPage", "1");
  if (before.inbound !== after.inbound || before.inbound === "cwarehouse" && after.inbound === "cwarehouse" && (before.cTab === "monitor") !== (after.cTab === "monitor")) {
    for (const key of ["jdWarehouse", "jdStart", "jdEnd", "jdQuery"]) result.searchParams.delete(key);
  }
  return `${result.pathname}${result.search}${result.hash}`;
}

export function writeJdLogisticsLocation(values: Parameters<typeof buildJdLogisticsLocation>[1], mode: "push" | "replace" = "push") {
  window.history[mode === "push" ? "pushState" : "replaceState"](window.history.state, "", buildJdLogisticsLocation(window.location.href, values));
}
