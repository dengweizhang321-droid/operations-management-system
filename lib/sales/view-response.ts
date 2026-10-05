/** Sales-owned view guards. These do not fetch, retry, cache or grant access. */
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const nullableNumber = (value: unknown) => value === null || finite(value);
export const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
export const numberFields = (value: unknown, fields: string[]) => record(value) && fields.every((key) => finite(value[key]));
export const stringFields = (value: unknown, fields: string[]) => record(value) && fields.every((key) => typeof value[key] === "string");
export const rows = (value: unknown, guard: (item: unknown) => boolean) => Array.isArray(value) && value.every(guard);
export const pagination = (value: unknown, count?: number) => record(value)
  && ["total", "returned"].every((key) => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0)
  && typeof value.truncated === "boolean" && Number(value.returned) <= Number(value.total)
  && (count === undefined || value.returned === count);

const actualFields = ["grossSalesCents", "returnAmountCents", "netSalesCents", "netCostCents", "grossProfitCents",
  "grossMarginBps", "returnRateBps", "sellingExpenseCents", "smallProfitCents", "smallMarginBps", "otherExpenseCents",
  "profitCents", "profitMarginBps", "promotionExpenseCents", "promotionFeeRatioBps"];
const goalFields = ["salesTargetCents", "profitTargetCents", "smallMarginBps", "inventoryCleanupTargetCents",
  "promotionFeeRatioBps", "stagnantInventoryTargetCents", "targetCount"];
const progress = (value: unknown) => record(value) && ["sales", "profit", "smallMarginGapBps", "promotionFeeGapBps"].every((key) => nullableNumber(value[key]));
const shopOption = (value: unknown) => stringFields(value, ["key", "name", "platform"]);

export function validFinanceAnalysis(value: unknown): boolean {
  if (!record(value) || typeof value.hasData !== "boolean" || !(value.selectedMonth === null || typeof value.selectedMonth === "string")
    || !rows(value.months, (item) => stringFields(item, ["month", "fileName", "importedAt"]) && numberFields(item, ["shopCount", "subjectCount"]))
    || !rows(value.timeline, (item) => stringFields(item, ["month"]) && numberFields(item, actualFields))
    || !rows(value.expenses, (item) => record(item) && typeof item.name === "string" && typeof item.abnormal === "boolean"
      && numberFields(item, ["current", "feeRateBps"]) && ["previous", "yearAgo", "yearAgoFeeRateBps", "momRate", "yoyRate"].every((key) => nullableNumber(item[key])))
    || !rows(value.shops, (item) => record(item) && stringFields(item, ["key", "name", "groupName", "manager"])
      && numberFields(item.actual, actualFields) && numberFields(item.target, goalFields) && progress(item.progress))
    || !rows(value.anomalies, (item) => record(item) && stringFields(item, ["title", "detail"]) && ["critical", "warning", "info"].includes(String(item.level)))) return false;
  if (value.filters !== undefined && (!record(value.filters) || !strings(value.filters.platforms) || !rows(value.filters.shops, shopOption))) return false;
  if (value.selectedMonths !== undefined && !strings(value.selectedMonths)) return false;
  if (value.hasData) {
    if (!numberFields(value.current, actualFields) || !numberFields(value.yearToDate, actualFields)
      || (value.previous !== null && !numberFields(value.previous, actualFields)) || (value.yearAgo !== null && !numberFields(value.yearAgo, actualFields))
      || !record(value.targets) || !numberFields(value.targets.month, goalFields) || !numberFields(value.targets.year, goalFields)
      || !rows(value.targets.projects, validFinanceTarget) || !record(value.progress) || !progress(value.progress.month) || !progress(value.progress.year)
      || !record(value.selection) || !strings(value.selection.months) || !strings(value.selection.platforms) || !strings(value.selection.shops)
      || typeof value.selection.allMonths !== "boolean" || typeof value.selection.truncated !== "boolean" || !finite(value.selection.availableMonthCount)) return false;
  }
  return true;
}

export function validFinanceTarget(value: unknown): boolean {
  return record(value) && stringFields(value, ["id", "periodKey", "platform", "shopName", "category", "manager", "createdAt", "updatedAt"])
    && ["month", "year", "project"].includes(String(value.periodType)) && Number.isSafeInteger(value.version) && Number(value.version) > 0
    && numberFields(value, ["salesTargetCents", "profitTargetCents", "grossMarginBps", "smallMarginBps", "inventoryCleanupTargetCents",
      "promotionFeeRatioBps", "stagnantInventoryTargetCents"]);
}

export function validTargetList(value: unknown, year: string, page: number): boolean {
  return record(value) && rows(value.items, (item) => record(item) && validFinanceTarget(item) && item.periodType === "year" && item.periodKey === year)
    && pagination(value.pagination, (value.items as unknown[]).length) && record(value.pagination)
    && value.pagination.page === page && value.pagination.pageSize === 100;
}

export function validTargetOptions(value: unknown): boolean {
  return record(value) && rows(value.shops, shopOption) && strings(value.categories) && strings(value.projects)
    && (value.pagination === undefined || (record(value.pagination) && pagination(value.pagination.shops)));
}

export function validAnnualProgress(value: unknown, year: string, page: number): boolean {
  return record(value) && value.year === year && (value.cutoffMonth === null || typeof value.cutoffMonth === "string")
    && strings(value.missingMonths) && rows(value.items, (item) => record(item) && stringFields(item, ["key", "platform", "shopName", "manager"])
      && (item.target === null || validFinanceTarget(item.target)) && ["netSalesCents", "profitCents", "salesProgress", "profitProgress", "grossMarginBps",
        "grossMarginGapBps", "promotionFeeRatioBps", "promotionFeeGapBps"].every((key) => nullableNumber(item[key]))
      && strings(item.availableMonths) && strings(item.missingMonths) && strings(item.missingGrossMarginMonths))
    && pagination(value.pagination, (value.items as unknown[]).length) && record(value.pagination)
    && value.pagination.page === page && value.pagination.pageSize === 100;
}
