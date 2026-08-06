export type SalesPeriodRange = "today" | "yesterday" | "last7" | "last15" | "month" | "quarter" | "custom" | "all";

export type SalesSummaryPeriod = {
  startDate: string;
  endDate: string;
  previousStartDate?: string;
  previousEndDate?: string;
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function isIsoDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function dayDifference(start: string, end: string) {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}

export function alignSalesSummaryPeriodToDataCutoff(
  range: SalesPeriodRange,
  requestedPeriod: SalesSummaryPeriod,
  dataCutoffDate: string | null,
) {
  const supportsDataCutoffAlignment = range === "last7"
    || range === "last15"
    || range === "month"
    || range === "quarter"
    || range === "custom";
  if (!supportsDataCutoffAlignment
    || !isIsoDate(dataCutoffDate)
    || dataCutoffDate >= requestedPeriod.endDate
    || dataCutoffDate < requestedPeriod.startDate) {
    return { period: { ...requestedPeriod }, adjusted: false };
  }

  const rollingDays = range === "last7" ? 7 : range === "last15" ? 15 : null;
  const startDate = rollingDays === null
    ? requestedPeriod.startDate
    : addDays(dataCutoffDate, -(rollingDays - 1));
  const endDate = dataCutoffDate;
  const days = dayDifference(startDate, endDate) + 1;
  let previousStartDate: string | undefined;
  let previousEndDate: string | undefined;

  if ((range === "month" || range === "quarter") && requestedPeriod.previousStartDate) {
    previousStartDate = requestedPeriod.previousStartDate;
    previousEndDate = addDays(previousStartDate, days - 1);
  } else if (requestedPeriod.previousStartDate && requestedPeriod.previousEndDate) {
    previousEndDate = addDays(startDate, -1);
    previousStartDate = addDays(previousEndDate, -(days - 1));
  }

  return {
    period: {
      startDate,
      endDate,
      ...(previousStartDate && previousEndDate ? { previousStartDate, previousEndDate } : {}),
    },
    adjusted: true,
  };
}
