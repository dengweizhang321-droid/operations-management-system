export const TMALL_WAREHOUSE_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const TMALL_WAREHOUSE_MAX_ROWS = 20000;
export const tmallWarehouseQuantityKeys = ["availableQuantity", "onHandQuantity", "salesOccupiedQuantity", "goodAvailableQuantity", "goodOccupiedQuantity", "defectiveQuantity", "purchaseInTransitQuantity", "transferInTransitQuantity", "sales7dQuantity", "sales30dQuantity"] as const;
export type TmallWarehouseQuantityKey = typeof tmallWarehouseQuantityKeys[number];
export type TmallWarehouseRow = Record<TmallWarehouseQuantityKey, number | null> & {
  goodsId: string; goodsCode: string; goodsName: string; warehouse: string;
  warehouseCode: string; region: string; owner: string; brand: string;
  sourceAttributes: Record<string, string | null>; sourceRowNumber: number;
};
export type TmallWarehouseTotals = Record<TmallWarehouseQuantityKey, number | null>;
export const tmallWarehouseQuantityLabels: Record<TmallWarehouseQuantityKey, string> = {
  availableQuantity: "实仓可销", onHandQuantity: "实仓总量", salesOccupiedQuantity: "销售占用",
  goodAvailableQuantity: "良品可用", goodOccupiedQuantity: "良品占用", defectiveQuantity: "残次总量",
  purchaseInTransitQuantity: "采购在途", transferInTransitQuantity: "调拨在途",
  sales7dQuantity: "近7天销量", sales30dQuantity: "近30天销量",
};
