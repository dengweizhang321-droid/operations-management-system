import {
  findLatestInventoryImportBatch,
  type InventoryDatabase,
} from "@/lib/inventory/database";
import { listErpReferenceBatches } from "@/lib/erp-reference/database";

export type InventoryAgeStatus = "healthy" | "aged" | "slow" | "stagnant" | "no_stock";

export type InventoryAgeItem = {
  key: string;
  productCode: string;
  productName: string;
  specification: string;
  category: string;
  warehouse: string;
  warehouseType: "owned" | "jd_rdc" | "other";
  availableQuantity: number;
  stockValueCents: number | null;
  inventoryAgeDays: number | null;
  sales7dQuantity: number | null;
  sales30dQuantity: number | null;
  status: InventoryAgeStatus;
  statusLabel: string;
  recommendation: string;
};

type AgeRow = {
  product_code: string;
  product_name: string | null;
  specification: string | null;
  category: string | null;
  warehouse: string;
  warehouse_type: string;
  available_quantity: number | null;
  stock_value_cents: number | null;
  inventory_age_days: number | null;
  sales_7d_quantity: number | null;
  sales_30d_quantity: number | null;
};

function normalizeWarehouseType(value: string): InventoryAgeItem["warehouseType"] {
  return value === "owned" || value === "jd_rdc" ? value : "other";
}

function classification(input: {
  availableQuantity: number;
  inventoryAgeDays: number | null;
  sales30dQuantity: number | null;
}) {
  if (input.availableQuantity <= 0) {
    return { status: "no_stock" as const, label: "无可用库存", recommendation: "无需纳入滞销清理，等待下一次库存快照确认。" };
  }
  if (input.inventoryAgeDays === null) {
    return { status: "healthy" as const, label: "待补库龄", recommendation: "当前报表未提供库龄，暂不参与库龄预警。" };
  }
  if (input.sales30dQuantity !== null && input.inventoryAgeDays >= 90 && input.sales30dQuantity <= 0) {
    return { status: "stagnant" as const, label: "滞销清理", recommendation: "停止补货，优先评估促销、渠道调拨或清退。" };
  }
  if (input.sales30dQuantity !== null && input.inventoryAgeDays >= 60 && input.sales30dQuantity <= 3) {
    return { status: "slow" as const, label: "低动销", recommendation: "控制补货，结合价格和渠道方案提升动销。" };
  }
  if (input.inventoryAgeDays >= 90) {
    return { status: "aged" as const, label: "高库龄", recommendation: "库龄超过 90 天，建议核查动销并制定处理计划。" };
  }
  return { status: "healthy" as const, label: "库龄健康", recommendation: "持续观察库存周转与近 30 日销量。" };
}

function priority(status: InventoryAgeStatus) {
  return { stagnant: 0, slow: 1, aged: 2, healthy: 3, no_stock: 4 }[status];
}

function hasAgeSales(totals: unknown) {
  if (!totals || typeof totals !== "object") return false;
  const coverage = (totals as { coverage?: { hasSales30dQuantity?: unknown } }).coverage;
  return coverage?.hasSales30dQuantity === true;
}

export async function getInventoryAgeAnalysis(db: InventoryDatabase) {
  const [latestBatch, ageBatches] = await Promise.all([
    findLatestInventoryImportBatch(db),
    listErpReferenceBatches(db, "inventory_age", 1),
  ]);
  const latestAgeBatch = ageBatches.find((batch) => batch.status === "completed") ?? null;
  if (!latestBatch && !latestAgeBatch) {
    return {
      hasInventory: false,
      sync: { inventoryAsOf: null, latestInventoryBatchId: null, hasAgeSales: false },
      metrics: { skuWarehouseCount: 0, aged90Count: 0, aged90ValueCents: 0, stagnantCount: 0, stagnantValueCents: 0, zeroSalesCount: 0, cleanupCount: 0 },
      distribution: [] as Array<{ key: string; label: string; count: number; valueCents: number }>,
      pagination: { total: 0, limit: 300, truncated: false },
      items: [] as InventoryAgeItem[],
    };
  }

  let ageSalesAvailable = false;
  let result: { results: AgeRow[] };
  if (latestAgeBatch?.snapshotDate) {
    const [ageResult, salesCoverage] = await Promise.all([
      db.prepare(
        `SELECT
          product_code,
          NULLIF(product_name, '') AS product_name,
          NULLIF(specification, '') AS specification,
          NULLIF(category, '') AS category,
          warehouse,
          warehouse_type,
          available_quantity,
          stock_value_cents,
          inventory_age_days,
          sales_7d_quantity,
          sales_30d_quantity
        FROM erp_inventory_age_lines
        WHERE snapshot_date = ? AND TRIM(warehouse) <> '刷刷仓'
        ORDER BY product_code, warehouse`,
      ).bind(latestAgeBatch.snapshotDate).all<AgeRow>(),
      db.prepare(
        `SELECT COUNT(*) AS count
         FROM erp_inventory_age_lines
         WHERE snapshot_date = ? AND sales_30d_quantity IS NOT NULL AND TRIM(warehouse) <> '刷刷仓'`,
      ).bind(latestAgeBatch.snapshotDate).first<{ count: number }>(),
    ]);
    result = ageResult;
    ageSalesAvailable = Number(salesCoverage?.count ?? 0) > 0;
  } else {
    ageSalesAvailable = hasAgeSales(latestBatch!.totals);
    result = await db.prepare(
      `SELECT
      s.product_code,
      MAX(NULLIF(s.product_name, '')) AS product_name,
      MAX(NULLIF(s.specification, '')) AS specification,
      MAX(NULLIF(s.category, '')) AS category,
      s.warehouse,
      s.warehouse_type,
      COALESCE(SUM(s.available_quantity), 0) AS available_quantity,
      COALESCE(SUM(CASE WHEN s.unit_cost_cents > 0 THEN MAX(s.available_quantity, 0) * s.unit_cost_cents ELSE 0 END), 0) AS stock_value_cents,
      MAX(s.inventory_age_days) AS inventory_age_days,
      COALESCE(SUM(a.sales_7d_quantity), 0) AS sales_7d_quantity,
      COALESCE(SUM(a.sales_30d_quantity), 0) AS sales_30d_quantity
    FROM inventory_stock_lines s
    LEFT JOIN inventory_age_metrics a ON a.batch_id = s.batch_id AND a.row_key = s.row_key
    WHERE s.batch_id = ? AND TRIM(s.warehouse) <> '刷刷仓'
    GROUP BY s.product_code, s.warehouse, s.warehouse_type
    ORDER BY s.product_code, s.warehouse`,
    ).bind(latestBatch!.id).all<AgeRow>();
  }

  const items = result.results.map((row): InventoryAgeItem => {
    const availableQuantity = Number(row.available_quantity ?? 0);
    const inventoryAgeDays = row.inventory_age_days === null ? null : Number(row.inventory_age_days);
    const sales30dQuantity = ageSalesAvailable ? Number(row.sales_30d_quantity ?? 0) : null;
    const classificationResult = classification({ availableQuantity, inventoryAgeDays, sales30dQuantity });
    return {
      key: `${row.warehouse}\u001f${row.product_code}`,
      productCode: row.product_code,
      productName: row.product_name || row.product_code,
      specification: row.specification || "",
      category: row.category || "未分类",
      warehouse: row.warehouse,
      warehouseType: normalizeWarehouseType(row.warehouse_type),
      availableQuantity,
      stockValueCents: Number(row.stock_value_cents ?? 0),
      inventoryAgeDays,
      sales7dQuantity: ageSalesAvailable ? Number(row.sales_7d_quantity ?? 0) : null,
      sales30dQuantity,
      status: classificationResult.status,
      statusLabel: classificationResult.label,
      recommendation: classificationResult.recommendation,
    };
  });
  items.sort((left, right) => priority(left.status) - priority(right.status)
    || (right.inventoryAgeDays ?? -1) - (left.inventoryAgeDays ?? -1)
    || right.stockValueCents! - left.stockValueCents!);

  const buckets = [
    { key: "0-30", label: "0–30 天", test: (age: number) => age <= 30 },
    { key: "31-60", label: "31–60 天", test: (age: number) => age >= 31 && age <= 60 },
    { key: "61-90", label: "61–89 天", test: (age: number) => age >= 61 && age < 90 },
    { key: "90+", label: "90 天以上", test: (age: number) => age >= 90 },
  ];
  const distribution = buckets.map((bucket) => {
    const bucketItems = items.filter((item) => item.inventoryAgeDays !== null && bucket.test(item.inventoryAgeDays));
    return {
      key: bucket.key,
      label: bucket.label,
      count: bucketItems.length,
      valueCents: bucketItems.reduce((sum, item) => sum + (item.stockValueCents ?? 0), 0),
    };
  });
  const aged90 = items.filter((item) => (item.inventoryAgeDays ?? -1) >= 90 && item.availableQuantity > 0);
  const stagnant = items.filter((item) => item.status === "stagnant");
  const cleanupCount = items.filter((item) => item.status === "stagnant" || item.status === "slow" || item.status === "aged").length;
  const limit = 300;

  return {
    hasInventory: true,
    sync: {
      inventoryAsOf: latestAgeBatch?.snapshotDate ?? latestBatch!.snapshotDate,
      latestInventoryBatchId: latestAgeBatch?.id ?? latestBatch!.id,
      sourceKey: latestAgeBatch ? "inventory_age" : "inventory",
      hasAgeSales: ageSalesAvailable,
    },
    metrics: {
      skuWarehouseCount: items.length,
      aged90Count: aged90.length,
      aged90ValueCents: aged90.reduce((sum, item) => sum + (item.stockValueCents ?? 0), 0),
      stagnantCount: stagnant.length,
      stagnantValueCents: stagnant.reduce((sum, item) => sum + (item.stockValueCents ?? 0), 0),
      zeroSalesCount: ageSalesAvailable ? items.filter((item) => (item.sales30dQuantity ?? 0) <= 0 && item.availableQuantity > 0).length : 0,
      cleanupCount,
    },
    distribution,
    pagination: { total: items.length, limit, truncated: items.length > limit },
    items: items.slice(0, limit),
  };
}
