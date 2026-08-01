import type { SalesDatabase } from "@/lib/sales/database";

const PRODUCT_QUERY_LIMIT = 100;

/**
 * Parses pasted product filters without breaking Chinese product names that
 * legitimately contain spaces. ASCII-only chunks retain the existing
 * whitespace-separated multi-code behaviour.
 */
export function parseProductQueries(values: string | string[]): string[] {
  const queries = (Array.isArray(values) ? values : [values])
    .flatMap((value) => value.split(/[\r\n,，;；]+/))
    .flatMap((value) => {
      const trimmed = value.trim();
      if (!trimmed) return [];
      return /[\u3400-\u9fff]/.test(trimmed) ? [trimmed] : trimmed.split(/\s+/);
    })
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set(queries)].slice(0, PRODUCT_QUERY_LIMIT);
}

export async function resolveProductFilterCodes(db: SalesDatabase, productQueries: string[]) {
  if (productQueries.length === 0) return [];

  const result = await db.prepare(`
    SELECT product_name, product_code
    FROM sales_order_lines
    WHERE product_name IN (${productQueries.map(() => "?").join(", ")})
      AND NULLIF(TRIM(product_code), '') IS NOT NULL
    GROUP BY product_name, product_code
    ORDER BY product_name ASC, product_code ASC
    LIMIT 100
  `).bind(...productQueries).all<{ product_name: string; product_code: string }>();
  const codesByName = new Map<string, string[]>();
  for (const row of result.results) {
    const codes = codesByName.get(row.product_name) ?? [];
    if (!codes.includes(row.product_code)) codes.push(row.product_code);
    codesByName.set(row.product_name, codes);
  }

  return [...new Set(productQueries.flatMap((query) => codesByName.get(query) ?? [query]))].slice(0, PRODUCT_QUERY_LIMIT);
}
