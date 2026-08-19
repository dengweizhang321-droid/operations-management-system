export const SALES_CATEGORY_EXPRESSION =
  "COALESCE(NULLIF(TRIM(pm.category), ''), NULLIF(TRIM(s.category), ''), '未分类')";

export const SALES_CATEGORY_JOIN =
  "LEFT JOIN erp_product_master pm ON pm.product_code = s.product_code";
