import { resolveNetshopQueryPeriod } from "@/lib/netshop/query-contract";

/** Shared presentation only; A's owning reader validates these sorts as well. */
export const promotionPresentationSorts = ["spend_desc", "attributedPayment_desc", "roas_desc", "spend_change_desc", "spend_change_asc"] as const;
export type PromotionPresentationPrefs = { schemaVersion: "promotion-ui-v1"; sort: typeof promotionPresentationSorts[number]; objectDateFocus: { startDate: string; endDate: string } | null };
export function decodePromotionPresentationPrefs(raw: string | null): PromotionPresentationPrefs | null {
  if (!raw || raw.length > 1000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    if (Object.keys(v).length !== 3 || !["schemaVersion", "sort", "objectDateFocus"].every(key => Object.hasOwn(v, key)) || v.schemaVersion !== "promotion-ui-v1" || typeof v.sort !== "string" || !promotionPresentationSorts.includes(v.sort as PromotionPresentationPrefs["sort"])) return null;
    let objectDateFocus: PromotionPresentationPrefs["objectDateFocus"] = null;
    if (v.objectDateFocus !== null) {
      if (!v.objectDateFocus || typeof v.objectDateFocus !== "object" || Array.isArray(v.objectDateFocus)) return null;
      const f = v.objectDateFocus as Record<string, unknown>;
      if (Object.keys(f).length !== 2 || !Object.hasOwn(f, "startDate") || !Object.hasOwn(f, "endDate") || typeof f.startDate !== "string" || typeof f.endDate !== "string") return null;
      try { if (resolveNetshopQueryPeriod(f.startDate, f.endDate, 366)) objectDateFocus = { startDate: f.startDate, endDate: f.endDate }; } catch { /* Invalid date focus resets without changing a valid sort. */ }
    }
    return { schemaVersion: "promotion-ui-v1", sort: v.sort as PromotionPresentationPrefs["sort"], objectDateFocus };
  } catch { return null; }
}
