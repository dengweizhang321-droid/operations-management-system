import policy from "@/config/sales-import-policy.json";

type SalesImportPolicy = {
  version: string;
  timeZone: string;
  download: {
    directory: string;
    fileNamePattern: string;
  };
  dateRule: {
    type: "month_to_previous_day";
    field: string;
    fallbackFields: string[];
  };
  excludedWarehouses: string[];
  approvedSalesChannels: string[];
  costSource: {
    searchRoot: string;
    folderPrefix: string;
    fileName: string;
    productCodeHeader: string;
    productNameHeader: string;
    unitCostHeader: string;
    zeroCostProductNames: string[];
  };
};

export const salesImportPolicy = policy as SalesImportPolicy;
export const approvedSalesChannelSet = new Set(salesImportPolicy.approvedSalesChannels);
export const excludedWarehouseSet = new Set(salesImportPolicy.excludedWarehouses);
export const zeroCostProductNameSet = new Set(salesImportPolicy.costSource.zeroCostProductNames);

export function normalizeSalesImportText(value: string | null | undefined) {
  return (value ?? "").trim();
}

export function isApprovedSalesChannel(value: string | null | undefined) {
  return approvedSalesChannelSet.has(normalizeSalesImportText(value));
}

export function isExcludedSalesWarehouse(value: string | null | undefined) {
  return excludedWarehouseSet.has(normalizeSalesImportText(value));
}

export function isZeroCostProductName(value: string | null | undefined) {
  return zeroCostProductNameSet.has(normalizeSalesImportText(value));
}
