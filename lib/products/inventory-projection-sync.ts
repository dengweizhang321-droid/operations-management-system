import type { AppPrincipal } from "@/lib/auth/authorization";
import {
  createDjangoProductsService,
  PRODUCTS_INVENTORY_PROJECTION_PATH,
  type DjangoProductsServiceOptions,
} from "@/lib/django/products-service";
import {
  findLatestInventoryImportBatch,
  getInventoryDatabase,
  type InventoryDatabase,
} from "@/lib/inventory/database";
import { PublicApiError } from "@/lib/http/api-error";

const MAX_ROWS = 20_000;
const PAGE_SIZE = 1_000;

type ProjectionRow = {
  productCode: string;
  brand: string;
  availableQuantity: number;
  knownStockValueCents: number;
  pricedAvailableQuantity: number;
};

type ProjectionDatabaseRow = {
  product_code: string;
  brand: string | null;
  available_quantity: number;
  known_stock_value_cents: number;
  priced_available_quantity: number;
};

type ProductsProjectionWriter = ReturnType<typeof createDjangoProductsService>;

function unavailable(message: string) {
  return new PublicApiError(503, "service_unavailable", message);
}

function checkedInteger(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw unavailable(`库存投影 ${label} 超出安全数值范围`);
  }
  return number;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readProjectionRows(db: InventoryDatabase, batchId: string) {
  const result = await db.prepare(
    `SELECT
       TRIM(product_code) AS product_code,
       MAX(NULLIF(TRIM(brand), '')) AS brand,
       COALESCE(SUM(CASE WHEN available_quantity > 0 THEN available_quantity ELSE 0 END), 0) AS available_quantity,
       COALESCE(SUM(CASE WHEN unit_cost_cents > 0 AND available_quantity > 0
         THEN available_quantity * unit_cost_cents ELSE 0 END), 0) AS known_stock_value_cents,
       COALESCE(SUM(CASE WHEN unit_cost_cents > 0 AND available_quantity > 0
         THEN available_quantity ELSE 0 END), 0) AS priced_available_quantity
     FROM inventory_stock_lines
     WHERE batch_id = ? AND TRIM(warehouse) <> '刷刷仓' AND TRIM(product_code) <> ''
     GROUP BY TRIM(product_code)
     ORDER BY TRIM(product_code)
     LIMIT ?`,
  ).bind(batchId, MAX_ROWS + 1).all<ProjectionDatabaseRow>();
  if (result.results.length > MAX_ROWS) {
    throw unavailable("库存投影规格数量超过商品域安全上限");
  }
  return result.results.map((row): ProjectionRow => {
    const availableQuantity = checkedInteger(row.available_quantity, "可用数量");
    const pricedAvailableQuantity = checkedInteger(row.priced_available_quantity, "已知成本数量");
    if (pricedAvailableQuantity > availableQuantity) {
      throw unavailable("库存投影成本覆盖数量大于可用数量");
    }
    return {
      productCode: row.product_code.trim(),
      brand: row.brand?.trim() ?? "",
      availableQuantity,
      knownStockValueCents: checkedInteger(row.known_stock_value_cents, "已知库存金额"),
      pricedAvailableQuantity,
    };
  });
}

export async function syncLatestInventoryProjection(
  principal: AppPrincipal,
  options: Omit<DjangoProductsServiceOptions, "config"> & {
    db?: InventoryDatabase;
    writer?: ProductsProjectionWriter;
  } = {},
) {
  const { db = getInventoryDatabase(), writer = createDjangoProductsService(), ...requestOptions } = options;
  const batch = await findLatestInventoryImportBatch(db);
  if (!batch || batch.status !== "completed") {
    throw unavailable("没有可同步到商品域的已完成库存快照");
  }
  const rows = await readProjectionRows(db, batch.id);
  const projectionRevision = await sha256(
    `product-inventory-projection-v1\n${batch.id}\n${batch.snapshotDate}\n${JSON.stringify(rows)}`,
  );
  const ownerToken = await sha256(
    `product-inventory-projection-owner-v1\n${principal.email.trim().toLowerCase()}\n${projectionRevision}`,
  );
  const begin = await writer.requestJson<{
    status: "active" | "syncing";
    ownerToken?: string;
    control: { syncingOffset: number };
  }>(principal, {
    method: "POST",
    path: PRODUCTS_INVENTORY_PROJECTION_PATH,
    service: "writer",
    payload: {
      action: "begin_sync",
      projectionRevision,
      sourceBatchId: batch.id,
      snapshotDate: batch.snapshotDate,
      totalRows: rows.length,
      ownerToken,
    },
  }, requestOptions);
  if (begin.data.status === "active") {
    return { status: "active" as const, projectionRevision, rowCount: rows.length, sourceBatchId: batch.id };
  }
  let offset = Number(begin.data.control.syncingOffset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > rows.length) {
    throw unavailable("商品域返回的库存投影进度无效");
  }
  while (offset < rows.length) {
    const page = rows.slice(offset, offset + PAGE_SIZE);
    const staged = await writer.requestJson<{ control: { syncingOffset: number } }>(principal, {
      method: "POST",
      path: PRODUCTS_INVENTORY_PROJECTION_PATH,
      service: "writer",
      payload: {
        action: "stage_page",
        projectionRevision,
        ownerToken,
        offset,
        rows: page,
      },
    }, requestOptions);
    const next = Number(staged.data.control.syncingOffset);
    if (!Number.isSafeInteger(next) || next !== offset + page.length) {
      throw unavailable("商品域库存投影分页回读不一致");
    }
    offset = next;
  }
  const activated = await writer.requestJson<{ status: string; control: { activeRevision: string; activeTotal: number } }>(
    principal,
    {
      method: "POST",
      path: PRODUCTS_INVENTORY_PROJECTION_PATH,
      service: "writer",
      payload: { action: "activate_sync", projectionRevision, ownerToken },
    },
    requestOptions,
  );
  if (activated.data.status !== "active"
    || activated.data.control.activeRevision !== projectionRevision
    || activated.data.control.activeTotal !== rows.length) {
    throw unavailable("商品域库存投影激活回查不一致");
  }
  return { status: "active" as const, projectionRevision, rowCount: rows.length, sourceBatchId: batch.id };
}
