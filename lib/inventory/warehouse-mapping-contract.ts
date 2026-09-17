import {
  inventoryWarehouseCategoryLabels,
  type InventoryWarehouseCategory,
  type InventoryWarehouseMapping,
} from "@/lib/inventory/warehouse-classification";

export type WarehouseMappingRow = {
  warehouse: string;
  category: Exclude<InventoryWarehouseCategory, "selfOperated">;
  label: string;
  includeInInventory: boolean;
};

export type WarehouseMappingPayload = {
  rows: WarehouseMappingRow[];
  mappingRevision: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

const categories = new Set(
  Object.keys(inventoryWarehouseCategoryLabels).filter((category) => category !== "selfOperated"),
);

export function parseWarehouseMappingPayload(value: unknown): WarehouseMappingPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("仓库映射响应无效");
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.rows) || payload.rows.length < 1 || payload.rows.length > 2_000
    || typeof payload.mappingRevision !== "string" || !/^[a-f0-9]{64}$/.test(payload.mappingRevision)) {
    throw new Error("仓库映射响应无效");
  }
  const seen = new Set<string>();
  const rows = payload.rows.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("仓库映射响应无效");
    const row = item as Record<string, unknown>;
    const warehouse = typeof row.warehouse === "string" ? row.warehouse : "";
    const category = typeof row.category === "string" ? row.category : "";
    if (!warehouse || warehouse !== warehouse.trim() || seen.has(warehouse) || !categories.has(category)
      || row.label !== inventoryWarehouseCategoryLabels[category as InventoryWarehouseCategory]
      || typeof row.includeInInventory !== "boolean") {
      throw new Error("仓库映射响应无效");
    }
    seen.add(warehouse);
    return {
      warehouse,
      category: category as WarehouseMappingRow["category"],
      label: row.label as string,
      includeInInventory: row.includeInInventory,
    };
  });
  return {
    rows,
    mappingRevision: payload.mappingRevision,
    updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
    updatedBy: typeof payload.updatedBy === "string" ? payload.updatedBy : null,
  };
}

export function warehouseMappingRecord(rows: readonly WarehouseMappingRow[]): InventoryWarehouseMapping {
  return Object.fromEntries(rows.map((row) => [row.warehouse, {
    category: row.category,
    label: row.label,
    includeInInventory: row.includeInInventory,
  }]));
}
