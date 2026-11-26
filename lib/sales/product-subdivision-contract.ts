import { numberFields, pagination, record, rows, strings, stringFields } from "./view-response";

export type ProductSubdivisionStatus = "mapped" | "unclassified" | "missing";

export function validProductSubdivisions(value: unknown, expected: { page: number; pageSize: number }): boolean {
  if (!record(value) || !record(value.mapping) || !strings(value.mapping.coveredCategories)
    || !rows(value.mapping.sources, (item) => stringFields(item, ["fileName", "sha256"]) && numberFields(item, ["rowCount"]))
    || !numberFields(value.totals, ["mapped", "unclassified", "missing", "entries", "subdivisions"])
    || !rows(value.subdivisions, (item) => stringFields(item, ["label"]) && numberFields(item, ["productCount"]))
    || !rows(value.items, (item) => record(item)
      && stringFields(item, ["specCode", "goodsCode", "productName", "specification", "erpCategory", "productStatus", "matchedBy"])
      && (item.subdivision === null || typeof item.subdivision === "string")
      && ["mapped", "unclassified", "missing"].includes(String(item.status))
      && ["code", "name", "none"].includes(String(item.matchedBy)))
    || !record(value.pagination) || !pagination(value.pagination, (value.items as unknown[]).length)
    || value.pagination.page !== expected.page || value.pagination.pageSize !== expected.pageSize) return false;
  return true;
}
