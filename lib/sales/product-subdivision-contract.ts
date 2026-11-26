import { numberFields, pagination, record, rows, strings, stringFields } from "./view-response";

export type ProductSubdivisionStatus = "mapped" | "unclassified" | "missing";

export const SUBDIVISION_MATCH_LABELS: Record<string, string> = {
  manual: "手动归类",
  code: "规格代码",
  name_to_code: "名称转代码",
  name: "名称兜底（吉客云未找到）",
  none: "未匹配",
};

export const validMajorCategories = (value: unknown) => rows(value, (item) => record(item)
  && stringFields(item, ["name"]) && strings(item.coveredCategories)
  && rows(item.labels, (label) => stringFields(label, ["name", "source"]) && numberFields(label, ["sortOrder"])));

export function validProductSubdivisions(value: unknown, expected: { page: number; pageSize: number }): boolean {
  if (!record(value) || !record(value.mapping) || !strings(value.mapping.coveredCategories)
    || !rows(value.mapping.sources, (item) => stringFields(item, ["fileName", "sha256"]) && numberFields(item, ["rowCount"]))
    || !validMajorCategories(value.mapping.majorCategories)
    || !numberFields(value.totals, ["mapped", "unclassified", "missing", "entries", "subdivisions"])
    || !rows(value.subdivisions, (item) => stringFields(item, ["label", "majorCategory"]) && numberFields(item, ["productCount"]))
    || !rows(value.items, (item) => record(item)
      && stringFields(item, ["specCode", "productName", "specification", "supplier", "erpCategory", "productStatus", "matchedBy", "sourceName"])
      && (item.subdivision === null || typeof item.subdivision === "string")
      && (item.defaultSubdivision === null || typeof item.defaultSubdivision === "string")
      && (item.majorCategory === null || typeof item.majorCategory === "string")
      && typeof item.overridden === "boolean"
      && ["mapped", "unclassified", "missing"].includes(String(item.status))
      && String(item.matchedBy) in SUBDIVISION_MATCH_LABELS)
    || !record(value.pagination) || !pagination(value.pagination, (value.items as unknown[]).length)
    || value.pagination.page !== expected.page || value.pagination.pageSize !== expected.pageSize) return false;
  return true;
}
