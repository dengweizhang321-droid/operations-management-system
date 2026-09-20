function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeHeader(value: unknown) {
  return normalizeText(value).replace(/\uFEFF/g, "");
}

function validIsoDate(value: string | undefined) {
  const normalized = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "";
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === normalized ? normalized : "";
}

/**
 * JD Business Intelligence daily exports identify their dimension by the
 * workbook contract. Download-center file names are intentionally ignored.
 */
export function detectJdDailyDataset(headers: readonly string[]) {
  const exactHeaders = new Set(headers.map(normalizeHeader));
  const hasTime = exactHeaders.has("时间");
  const hasSku = exactHeaders.has("SKU");
  const hasSkuName = exactHeaders.has("SKU名称");
  const hasSpu = exactHeaders.has("SPU");
  const hasSpuName = exactHeaders.has("SPU名称");
  if (hasTime && hasSku && hasSkuName && !hasSpu && !hasSpuName) return "sku_daily" as const;
  if (hasTime && hasSpu && hasSpuName && !hasSku && !hasSkuName) return "spu_daily" as const;
  throw new Error("商智分天文件表头必须且只能包含 时间 + SKU + SKU名称 或 时间 + SPU + SPU名称");
}

export function dailyRowKey(dataset: string, platform: string, shopName: string, businessDate: string, dimensionId: string) {
  return JSON.stringify([dataset, platform, shopName, businessDate, dimensionId]);
}

function datesInRange(startDate: string, endDate: string) {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function dailyDateCoverage(
  expectedStartDateValue: string | undefined,
  expectedEndDateValue: string | undefined,
  actualDateValues: Iterable<string>,
) {
  const expectedStartDate = validIsoDate(expectedStartDateValue);
  const expectedEndDate = validIsoDate(expectedEndDateValue);
  if (!expectedStartDate || !expectedEndDate || expectedStartDate > expectedEndDate) {
    return {
      validRange: false as const,
      expectedStartDate,
      expectedEndDate,
      missingDates: [] as string[],
      outOfRangeDates: [] as string[],
    };
  }
  const expectedDates = new Set(datesInRange(expectedStartDate, expectedEndDate));
  const actualDates = new Set([...actualDateValues].filter(Boolean));
  return {
    validRange: true as const,
    expectedStartDate,
    expectedEndDate,
    missingDates: [...expectedDates].filter((date) => !actualDates.has(date)),
    outOfRangeDates: [...actualDates].filter((date) => !expectedDates.has(date)),
  };
}
