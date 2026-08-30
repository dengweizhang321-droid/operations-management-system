export type ClassifiedInventoryWarehouseType = "owned" | "jd_rdc" | "other";

const JD_EXPLICIT_WAREHOUSE = /京东|rdc|dc仓|配送中心/i;
const JD_PLATFORM_WAREHOUSE = /(?:平台仓|中件(?:消费品)?)[^\r\n]*-chn$/i;

/**
 * Recognizes both explicit JD/RDC labels and the regional JD logistics names
 * exported by Jikexyun, for example "上海常温C平台仓9号库-CHN".
 */
export function isJdInboundWarehouseName(warehouse: string) {
  const normalized = warehouse.trim();
  return JD_EXPLICIT_WAREHOUSE.test(normalized) || JD_PLATFORM_WAREHOUSE.test(normalized);
}

export function inferInventoryWarehouseType(warehouse: string): ClassifiedInventoryWarehouseType {
  if (isJdInboundWarehouseName(warehouse)) return "jd_rdc";
  if (/仓|库/.test(warehouse)) return "owned";
  return "other";
}

/** SQL counterpart used to interpret old snapshots without rewriting facts. */
export function jdInboundWarehousePredicateSql(warehouseColumn: string, warehouseTypeColumn?: string) {
  const normalized = `LOWER(TRIM(${warehouseColumn}))`;
  const namePredicate = `(${normalized} LIKE '%京东%' OR ${normalized} LIKE '%rdc%' OR ${normalized} LIKE '%dc仓%' OR ${normalized} LIKE '%配送中心%' OR ((${normalized} LIKE '%平台仓%' OR ${normalized} LIKE '%中件%') AND ${normalized} LIKE '%-chn'))`;
  return warehouseTypeColumn
    ? `(LOWER(TRIM(${warehouseTypeColumn})) = 'jd_rdc' OR ${namePredicate})`
    : namePredicate;
}

export function resolvedWarehouseTypeSql(warehouseColumn: string, warehouseTypeColumn: string) {
  return `CASE
    WHEN ${jdInboundWarehousePredicateSql(warehouseColumn, warehouseTypeColumn)} THEN 'jd_rdc'
    WHEN LOWER(TRIM(${warehouseTypeColumn})) = 'owned' THEN 'owned'
    ELSE 'other'
  END`;
}

export function resolvedGroupedWarehouseTypeSql(warehouseColumn: string, warehouseTypeColumn: string) {
  return `CASE
    WHEN MAX(CASE WHEN ${jdInboundWarehousePredicateSql(warehouseColumn, warehouseTypeColumn)} THEN 1 ELSE 0 END) = 1 THEN 'jd_rdc'
    WHEN MAX(CASE WHEN LOWER(TRIM(${warehouseTypeColumn})) = 'owned' THEN 1 ELSE 0 END) = 1 THEN 'owned'
    ELSE 'other'
  END`;
}
