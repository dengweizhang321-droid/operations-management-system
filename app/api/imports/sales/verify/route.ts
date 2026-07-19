import {
  ensureSalesSchema,
  findSalesImportBatchByHash,
  getSalesDatabase,
} from "@/lib/sales/database";
import { salesImportPolicy } from "@/lib/sales/import-policy";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
} from "@/lib/auth/authorization";

type PeriodStats = {
  row_count: number;
  min_ship_time: string | null;
  max_ship_time: string | null;
  brush_warehouse_rows: number;
};

type ShopRow = {
  channel: string;
  platform: string;
  shop_name: string;
  row_count: number;
  net_sales_cents: number;
};

function isIsoDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function addUtcDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const query = new URL(request.url).searchParams;
    if (query.get("policyOnly") === "1") {
      return Response.json({ policyVersion: salesImportPolicy.version });
    }
    const startDate = query.get("startDate");
    const endDate = query.get("endDate");
    const batchId = query.get("batchId")?.trim() || null;
    if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
      return Response.json({ error: "startDate 和 endDate 必须是有效的 YYYY-MM-DD，且开始日期不能晚于结束日期。" }, { status: 400 });
    }

    const db = getSalesDatabase();
    await ensureSalesSchema(db);
    const endExclusive = addUtcDays(endDate, 1);
    const excludedWarehousePlaceholders = salesImportPolicy.excludedWarehouses.map(() => "?").join(", ");
    const stats = await db.prepare(
      `SELECT
        COUNT(*) AS row_count,
        MIN(ship_time) AS min_ship_time,
        MAX(ship_time) AS max_ship_time,
        COALESCE(SUM(CASE WHEN TRIM(warehouse) IN (${excludedWarehousePlaceholders}) THEN 1 ELSE 0 END), 0) AS brush_warehouse_rows
       FROM sales_order_lines
       WHERE ship_time >= ? AND ship_time < ?`,
    ).bind(...salesImportPolicy.excludedWarehouses, startDate, endExclusive).first<PeriodStats>();

    const shopResult = await db.prepare(
      `SELECT
         channel,
         platform,
         shop_name,
         COUNT(*) AS row_count,
         COALESCE(SUM(allocated_amount_cents), 0) AS net_sales_cents
       FROM sales_order_lines
       WHERE ship_time >= ? AND ship_time < ?
       GROUP BY channel, platform, shop_name
       ORDER BY channel ASC, platform ASC, shop_name ASC`,
    ).bind(startDate, endExclusive).all<ShopRow>();
    const shops = shopResult.results ?? [];
    const actualChannels = new Set(shops.map((row) => row.channel.trim()));
    const nonWhitelistChannels = [...actualChannels].filter(
      (channel) => !salesImportPolicy.approvedSalesChannels.includes(channel),
    );

    const rowsNotOwnedByBatch = batchId
      ? Number((await db.prepare(
        `SELECT COUNT(*) AS row_count FROM sales_order_lines
         WHERE ship_time >= ? AND ship_time < ? AND last_import_batch_id <> ?`,
      ).bind(startDate, endExclusive, batchId).first<{ row_count: number }>())?.row_count ?? 0)
      : null;
    const batch = batchId ? await findSalesImportBatchByHash(db, batchId) : null;

    return Response.json({
      policyVersion: salesImportPolicy.version,
      period: { startDate, endDate, endExclusive },
      batch,
      stats: {
        rowCount: Number(stats?.row_count ?? 0),
        minShipTime: stats?.min_ship_time ?? null,
        maxShipTime: stats?.max_ship_time ?? null,
        excludedWarehouseRows: Number(stats?.brush_warehouse_rows ?? 0),
        rowsNotOwnedByBatch,
      },
      shops: shops.map((row) => ({
        channel: row.channel,
        platform: row.platform,
        shopName: row.shop_name,
        rowCount: Number(row.row_count),
        netSalesCents: Number(row.net_sales_cents),
      })),
      nonWhitelistChannels,
      whitelistWithNoData: salesImportPolicy.approvedSalesChannels.filter((channel) => !actualChannels.has(channel)),
    });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "销售导入校验读取失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
