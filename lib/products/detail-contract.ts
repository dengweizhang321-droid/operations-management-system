import type { SalesSummaryResponse } from "../../app/module-view-shared";

/** Validate the existing sales DTO at the product detail consumer boundary. */
export function validateProductDetail(payload: SalesSummaryResponse, productCode: string, start: string, end: string) {
  const fail = () => { throw new Error("规格详情响应与当前统计周期不一致或字段无效"); };
  if (payload.startDate !== start || payload.endDate !== end
    || !Array.isArray(payload.filters?.productCodes) || payload.filters.productCodes.length !== 1 || payload.filters.productCodes[0] !== productCode
    || !Array.isArray(payload.daily) || !Array.isArray(payload.platforms) || !Array.isArray(payload.outlets)) fail();
  const stats = (value: unknown) => {
    if (!value || typeof value !== "object") return fail();
    const row = value as Record<string, unknown>;
    for (const key of ["grossSalesCents", "netSalesCents", "costAmountCents", "grossProfitCents", "refundAmountCents", "netQuantity", "orderCount", "lineCount"])
      if (!Number.isSafeInteger(row[key])) fail();
    for (const key of ["averageOrderValueCents", "grossMarginRate", "refundRate"])
      if (row[key] !== null && !Number.isFinite(row[key])) fail();
  };
  stats(payload.current);
  for (const day of payload.daily!) {
    if (!day || typeof day.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)
      || !Number.isFinite(Date.parse(day.date)) || new Date(day.date).toISOString().slice(0,10) !== day.date
      || day.date < start || day.date > end) fail();
    stats(day);
  }
  for (const row of [...payload.platforms!, ...payload.outlets!]) {
    if (!row || typeof row.name !== "string" || typeof row.groupKey !== "string" || typeof row.platform !== "string") fail();
    stats(row);
    if (!Number.isFinite(row.shareRate)) fail();
  }
  return payload;
}
