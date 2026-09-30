/** Presentation only. Never contains data, source tokens or authorization. */
export const productsPresentationSorts = ["payment_desc", "payment_asc", "visitors_desc", "visitors_asc", "conversion_desc", "conversion_asc", "growth_desc", "decline_desc"] as const;
export type ProductsPresentationPrefs = {
  schemaVersion: "products-ui-v1";
  sort: typeof productsPresentationSorts[number];
  columns: { traffic: boolean; comparison: boolean; association: boolean; coverage: boolean };
  gallery: boolean;
  detailSource: "platform" | "promotion" | "erp";
  topic: "home" | "growth" | "traffic" | "list";
};
function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function decodeProductsPresentationPrefs(raw: string | null): ProductsPresentationPrefs | null {
  if (!raw || raw.length > 1500) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!exactObject(v, ["schemaVersion", "sort", "columns", "gallery", "detailSource", "topic"]) || v.schemaVersion !== "products-ui-v1"
      || typeof v.sort !== "string" || !productsPresentationSorts.includes(v.sort as ProductsPresentationPrefs["sort"])
      || typeof v.gallery !== "boolean" || typeof v.detailSource !== "string" || !["platform", "promotion", "erp"].includes(v.detailSource)
      || typeof v.topic !== "string" || !["home", "growth", "traffic", "list"].includes(v.topic)
      || !exactObject(v.columns, ["traffic", "comparison", "association", "coverage"]) || Object.values(v.columns).some(value => typeof value !== "boolean")) return null;
    return { schemaVersion: "products-ui-v1", sort: v.sort as ProductsPresentationPrefs["sort"], columns: { traffic: v.columns.traffic as boolean, comparison: v.columns.comparison as boolean, association: v.columns.association as boolean, coverage: v.columns.coverage as boolean }, gallery: v.gallery, detailSource: v.detailSource as ProductsPresentationPrefs["detailSource"], topic: v.topic as ProductsPresentationPrefs["topic"] };
  } catch { return null; }
}
