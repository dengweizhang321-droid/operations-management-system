import type { SalesSummaryResponse } from "@/app/module-view-shared";
import { record, finite, nullableNumber, strings, pagination, stringFields } from "./view-response";

export type SalesSummaryProjection = SalesSummaryResponse & { projection: "core" | "full" };

/** Validate each projection before showing its business regions. */
export function validSalesSummary(value: unknown, projection: "core" | "full"): value is SalesSummaryProjection {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  const stats = (input: unknown) => input && typeof input === "object" && ["grossSalesCents", "netSalesCents",
    "grossProfitCents", "refundAmountCents", "netQuantity", "orderCount", "lineCount", "costAmountCents",
    "averageOrderValueCents", "refundRate", "grossMarginRate"].every((key) =>
      typeof (input as Record<string, unknown>)[key] === "number" && Number.isFinite((input as Record<string, number>)[key]));
  if (payload.projection !== projection || !stats(payload.current) || !stats(payload.yearAgo)
    || (payload.previous !== undefined && !stats(payload.previous))
    || !stringFields(payload, ["startDate", "endDate", "requestedStartDate", "requestedEndDate", "yearAgoStartDate", "yearAgoEndDate"])
    || !record(payload.filters) || !strings(payload.filters.productCodes) || !strings(payload.filters.platforms)
    || !strings(payload.filters.categories) || !Array.isArray(payload.filters.outlets)) return false;
  if (projection === "core") return true;
  if (!["channels", "shops", "platforms", "outlets"].every((key) => Array.isArray(payload[key])
    && (payload[key] as unknown[]).every((item) => record(item) && stats(item) && stringFields(item, ["name", "groupKey", "platform"])
      && finite(item.shareRate) && finite(item.yearAgoNetSalesCents) && nullableNumber(item.salesYearOverYearRate)))) return false;
  if (!["daily", "previousDaily", "yearAgoDaily"].every((key) => Array.isArray(payload[key])
    && (payload[key] as unknown[]).every((item) => stats(item) && typeof (item as { date?: unknown }).date === "string"))) return false;
  const options = payload.filterOptions as SalesSummaryResponse["filterOptions"];
  if (!record(payload.groupPagination) || !["outlets", "shops", "platforms"].every((key) =>
    pagination((payload.groupPagination as Record<string, unknown>)[key], (payload[key] as unknown[]).length))
    || !stringFields(payload, ["trendStartDate", "trendEndDate"]) || !finite(payload.trendReturned)
    || payload.trendReturned !== (payload.daily as unknown[]).length || typeof payload.trendTruncated !== "boolean") return false;
  return !!options && Array.isArray(options.platforms) && options.platforms.every((item) => typeof item === "string")
    && Array.isArray(options.categories) && options.categories.every((item) => typeof item === "string")
    && Array.isArray(options.shops) && options.shops.every((item) => record(item) && typeof item.key === "string"
      && typeof item.name === "string" && typeof item.platform === "string");
}
