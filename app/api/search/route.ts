import { ensureSalesSchema, getSalesDatabase } from "@/lib/sales/database";

type ProductSearchRow = {
  product_code: string;
  product_name: string;
  specification: string;
  supplier: string;
  latest_ship_time: string;
  net_quantity: number;
  net_sales_cents: number;
};

type OrderSearchRow = {
  order_no: string;
  online_order_no: string;
  platform: string;
  shop_name: string;
  latest_ship_time: string;
  product_names: string | null;
  net_quantity: number;
  net_sales_cents: number;
};

const MAX_QUERY_LENGTH = 80;
const RESULT_LIMIT = 10;

export async function GET(request: Request) {
  try {
    const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
    if (!query) return Response.json({ query, products: [], orders: [] }, { headers: { "cache-control": "no-store" } });

    const db = getSalesDatabase();
    await ensureSalesSchema(db);
    const like = `%${query}%`;
    const [productsResult, ordersResult] = await Promise.all([
      db.prepare(`
        SELECT
          product_code,
          MAX(product_name) AS product_name,
          MAX(specification) AS specification,
          MAX(supplier) AS supplier,
          MAX(ship_time) AS latest_ship_time,
          COALESCE(SUM(quantity), 0) AS net_quantity,
          COALESCE(SUM(allocated_amount_cents), 0) AS net_sales_cents
        FROM sales_order_lines
        WHERE product_name LIKE ? COLLATE NOCASE
          OR product_code LIKE ? COLLATE NOCASE
          OR specification LIKE ? COLLATE NOCASE
        GROUP BY product_code, product_name, specification
        ORDER BY CASE WHEN product_code = ? THEN 0 WHEN product_name = ? THEN 1 ELSE 2 END, latest_ship_time DESC
        LIMIT ?
      `).bind(like, like, like, query, query, RESULT_LIMIT).all<ProductSearchRow>(),
      db.prepare(`
        SELECT
          order_no,
          online_order_no,
          MAX(platform) AS platform,
          MAX(shop_name) AS shop_name,
          MAX(ship_time) AS latest_ship_time,
          GROUP_CONCAT(DISTINCT product_name) AS product_names,
          COALESCE(SUM(quantity), 0) AS net_quantity,
          COALESCE(SUM(allocated_amount_cents), 0) AS net_sales_cents
        FROM sales_order_lines
        WHERE order_no LIKE ? COLLATE NOCASE OR online_order_no LIKE ? COLLATE NOCASE
        GROUP BY order_no, online_order_no
        ORDER BY MAX(ship_time) DESC
        LIMIT ?
      `).bind(like, like, RESULT_LIMIT).all<OrderSearchRow>(),
    ]);

    return Response.json({
      query,
      products: productsResult.results ?? [],
      orders: ordersResult.results ?? [],
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "搜索业务数据失败";
    return Response.json({ error: message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
