/** Presentation only. Never contains data, source tokens or authorization. */
import { readNetshopCatalogFilters, type NetshopCatalogFilters } from "@/lib/netshop/query-contract";
export const productsPresentationSorts = ["payment_desc", "payment_asc", "visitors_desc", "visitors_asc", "conversion_desc", "conversion_asc", "growth_desc", "decline_desc"] as const;
export type ProductsPresentationPrefs = {
  schemaVersion: "products-ui-v1";
  sort: typeof productsPresentationSorts[number];
  columns: { traffic: boolean; comparison: boolean; association: boolean; coverage: boolean };
  gallery: boolean;
  detailSource: "platform" | "promotion" | "erp";
  topic: "home" | "growth" | "traffic" | "list";
  catalogFilters?: NetshopCatalogFilters;
};
function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function decodeProductsPresentationPrefs(raw: string | null): ProductsPresentationPrefs | null {
  if (!raw || raw.length > 1500) return null;
  try {
    const v: unknown = JSON.parse(raw);
    const required = ["schemaVersion", "sort", "columns", "gallery", "detailSource", "topic"];
    if (!v || typeof v !== "object" || Array.isArray(v) || !required.every(key => Object.hasOwn(v, key)) || Object.keys(v).some(key => ![...required, "catalogFilters"].includes(key))) return null;
    const value = v as Record<string, unknown>;
    if (value.schemaVersion !== "products-ui-v1"
      || typeof value.sort !== "string" || !productsPresentationSorts.includes(value.sort as ProductsPresentationPrefs["sort"])
      || typeof value.gallery !== "boolean" || typeof value.detailSource !== "string" || !["platform", "promotion", "erp"].includes(value.detailSource)
      || typeof value.topic !== "string" || !["home", "growth", "traffic", "list"].includes(value.topic)
      || !exactObject(value.columns, ["traffic", "comparison", "association", "coverage"]) || Object.values(value.columns).some(v => typeof v !== "boolean")) return null;
    let catalogFilters: NetshopCatalogFilters | undefined;
    if (Object.hasOwn(value, "catalogFilters")) {
      if (!exactObject(value.catalogFilters, ["status", "quality", "mapping"]) || Object.values(value.catalogFilters).some(v => typeof v !== "string")) return null;
      catalogFilters = readNetshopCatalogFilters(new URLSearchParams(value.catalogFilters as Record<string, string>));
    }
    return { schemaVersion: "products-ui-v1", sort: value.sort as ProductsPresentationPrefs["sort"], columns: { traffic: value.columns.traffic as boolean, comparison: value.columns.comparison as boolean, association: value.columns.association as boolean, coverage: value.columns.coverage as boolean }, gallery: value.gallery, detailSource: value.detailSource as ProductsPresentationPrefs["detailSource"], topic: value.topic as ProductsPresentationPrefs["topic"], ...(catalogFilters ? { catalogFilters } : {}) };
  } catch { return null; }
}
