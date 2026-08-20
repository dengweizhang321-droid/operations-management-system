import {
  ensureSalesSchema,
  findSalesImportBatchByHash,
  getSalesDatabase,
} from "@/lib/sales/database";
import { salesImportPolicy } from "@/lib/sales/import-policy";
import { validateSalesImportDateRange } from "@/lib/sales/import-service";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { safeApiErrorResponse } from "@/lib/http/api-error";

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

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "销售导入校验");
    const query = new URL(request.url).searchParams;
    if (query.get("policyOnly") === "1") {
      return Response.json({ policyVersion: salesImportPolicy.version }, { headers: { "cache-control": "no-store" } });
    }
    const requestedStartDate = query.get("startDate");
    const requestedEndDate = query.get("endDate");
    const batchId = query.get("batchId")?.trim() || null;
    const dateRange = validateSalesImportDateRange(requestedStartDate ?? "", requestedEndDate ?? "");
    if (!dateRange.ok) {
      return Response.json({ error: "startDate 和 endDate 必须是有效的 YYYY-MM-DD，且开始日期不能晚于结束日期。" }, { status: 400, headers: { "cache-control": "no-store" } });
    }

    const db = getSalesDatabase();
    await ensureSalesSchema(db);
    const { startDate, endDate, endExclusive } = dateRange;
    const excludedWarehouseFilter = JSON.stringify(salesImportPolicy.excludedWarehouses);
    const stats = await db.prepare(
      `SELECT
        COUNT(*) AS row_count,
        MIN(ship_time) AS min_ship_time,
        MAX(ship_time) AS max_ship_time,
        COALESCE(SUM(CASE WHEN TRIM(warehouse) IN (SELECT CAST(value AS TEXT) FROM json_each(?)) THEN 1 ELSE 0 END), 0) AS brush_warehouse_rows
       FROM sales_order_lines
       WHERE ship_time >= ? AND ship_time < ?`,
    ).bind(excludedWarehouseFilter, startDate, endExclusive).first<PeriodStats>();

    const [shopResult, shopCount, approvedChannelResult, nonWhitelistChannelResult] = await Promise.all([db.prepare(
      `SELECT
         channel,
         platform,
         shop_name,
         COUNT(*) AS row_count,
         COALESCE(SUM(allocated_amount_cents), 0) AS net_sales_cents
       FROM sales_order_lines
       WHERE ship_time >= ? AND ship_time < ?
       GROUP BY channel, platform, shop_name
       ORDER BY channel ASC, platform ASC, shop_name ASC
       LIMIT 501`,
    ).bind(startDate, endExclusive).all<ShopRow>(), db.prepare(`SELECT COUNT(*) AS total FROM (
      SELECT 1 FROM sales_order_lines
      WHERE ship_time >= ? AND ship_time < ?
      GROUP BY channel, platform, shop_name
    )`).bind(startDate, endExclusive).first<{ total: number }>(), db.prepare(`SELECT DISTINCT TRIM(channel) AS channel
      FROM sales_order_lines
      WHERE ship_time >= ? AND ship_time < ?
        AND TRIM(channel) IN (SELECT CAST(value AS TEXT) FROM json_each(?))`)
      .bind(startDate, endExclusive, JSON.stringify(salesImportPolicy.approvedSalesChannels))
      .all<{ channel: string }>(), db.prepare(`SELECT DISTINCT TRIM(channel) AS channel
      FROM sales_order_lines
      WHERE ship_time >= ? AND ship_time < ?
        AND TRIM(channel) NOT IN (SELECT CAST(value AS TEXT) FROM json_each(?))
      ORDER BY channel COLLATE NOCASE LIMIT 501`)
      .bind(startDate, endExclusive, JSON.stringify(salesImportPolicy.approvedSalesChannels))
      .all<{ channel: string }>()]);
    const shops = (shopResult.results ?? []).slice(0, 500);
    const approvedChannelsWithData = new Set(approvedChannelResult.results.map((row) => row.channel));
    const nonWhitelistChannels = nonWhitelistChannelResult.results.slice(0, 500).map((row) => row.channel);

    const rowsNotOwnedByBatch = batchId
      ? Number((await db.prepare(
        `SELECT COUNT(*) AS row_count FROM sales_order_lines
         WHERE ship_time >= ? AND ship_time < ?
           AND (last_import_batch_id IS NULL OR last_import_batch_id <> ?)`,
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
      shopPagination: {
        total: Number(shopCount?.total ?? 0),
        returned: shops.length,
        truncated: (shopResult.results?.length ?? 0) > 500,
      },
      nonWhitelistChannels,
      nonWhitelistChannelPagination: {
        returned: nonWhitelistChannels.length,
        truncated: nonWhitelistChannelResult.results.length > 500,
      },
      whitelistWithNoData: salesImportPolicy.approvedSalesChannels.filter((channel) => !approvedChannelsWithData.has(channel)),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "销售导入校验读取失败。", { headers: { "cache-control": "no-store" } });
  }
}
