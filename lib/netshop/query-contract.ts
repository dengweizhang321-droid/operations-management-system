export const NETSHOP_QUERY_MAX_DAYS = 730;
export const NETSHOP_QUERY_MAX_PAGE = 10_000;
export const NETSHOP_QUERY_MAX_PAGE_SIZE = 100;

export class NetshopQueryError extends Error {
  readonly status = 400;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NetshopQueryError";
    this.code = code;
  }
}

export type NetshopQueryPeriod = {
  startDate: string;
  endDate: string;
  endExclusive: string;
  days: number;
};

export function isNetshopIsoDate(value: string | undefined | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addIsoDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const result = date.toISOString().slice(0, 10);
  if (!isNetshopIsoDate(result)) {
    throw new NetshopQueryError("invalid_date_range", "endDate 超出支持范围");
  }
  return result;
}

export function resolveNetshopQueryPeriod(
  rawStartDate: string | undefined | null,
  rawEndDate: string | undefined | null,
  maximumDays = NETSHOP_QUERY_MAX_DAYS,
): NetshopQueryPeriod | null {
  const startDate = rawStartDate?.trim() ?? "";
  const endDate = rawEndDate?.trim() ?? "";
  if (!startDate && !endDate) return null;
  if (!startDate || !endDate) {
    throw new NetshopQueryError("invalid_date_range", "startDate 和 endDate 必须同时提供");
  }
  if (!isNetshopIsoDate(startDate) || !isNetshopIsoDate(endDate)) {
    throw new NetshopQueryError("invalid_date", "统计日期必须是有效的 YYYY-MM-DD 自然日");
  }
  if (startDate > endDate) {
    throw new NetshopQueryError("invalid_date_range", "startDate 不能晚于 endDate");
  }
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  const days = Math.round((endMs - startMs) / 86_400_000) + 1;
  if (!Number.isSafeInteger(maximumDays) || maximumDays < 1 || days > maximumDays) {
    throw new NetshopQueryError("date_range_too_large", `网店统计周期最多支持 ${maximumDays} 天`);
  }
  return { startDate, endDate, endExclusive: addIsoDays(endDate, 1), days };
}

export function boundedNetshopInteger(
  value: number | undefined,
  name: "page" | "pageSize",
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new NetshopQueryError("invalid_pagination", `${name} 必须是 ${minimum} 到 ${maximum} 的整数`);
  }
  return value;
}

export function readNetshopQueryInteger(
  value: string | null,
  name: "page" | "pageSize",
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === null || value === "") return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new NetshopQueryError("invalid_pagination", `${name} 必须是 ${minimum} 到 ${maximum} 的整数`);
  }
  const parsed = Number(value);
  return boundedNetshopInteger(parsed, name, fallback, minimum, maximum);
}

export function netshopQueryErrorPayload(error: unknown, fallback: string) {
  if (error instanceof NetshopQueryError) {
    return { body: { error: error.message, code: error.code }, status: error.status };
  }
  if (error instanceof PublicApiError) {
    return { body: { error: error.message, code: error.code }, status: error.status };
  }
  return { body: { error: fallback, code: "internal_error" }, status: 500 };
}
import { PublicApiError } from "@/lib/http/api-error";
