import { unzipSync } from "fflate";
import * as XLSX from "xlsx";

export const REPLENISHMENT_IMPORT_HEADERS = [
  "货品编码",
  "入库库房",
  "备货数量",
  "对应采购",
  "对应运营",
  "部门",
  "备货类型",
  "下单日期",
  "预计到货日",
  "预计消耗周期(天)",
  "计划状态",
  "是否验货",
  "备注",
] as const;

export const MAX_REPLENISHMENT_IMPORT_ROWS = 200;
export const MAX_REPLENISHMENT_IMPORT_BYTES = 4 * 1024 * 1024;

export type ReplenishmentImportRow = {
  productCode: string;
  warehouse: string;
  plannedQuantity: number;
  buyer: string;
  operatorName: string;
  department: string;
  planType: string;
  orderDate: string | null;
  expectedArrivalDate: string | null;
  expectedConsumptionDays: number | null;
  status: "draft" | "confirmed";
  requiresInspection: boolean;
  notes: string;
};

function text(value: unknown, rowNumber: number, label: string, maximum: number, required = false) {
  if (value === null || value === undefined) value = "";
  if (typeof value !== "string") throw new Error(`第${rowNumber}行“${label}”必须为文本`);
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`第${rowNumber}行“${label}”不能为空`);
  if (normalized.length > maximum) throw new Error(`第${rowNumber}行“${label}”不能超过${maximum}个字符`);
  return normalized;
}

function integer(value: unknown, rowNumber: number) {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) value = Number(value.trim());
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 10_000_000) {
    throw new Error(`第${rowNumber}行“备货数量”必须是1到10,000,000之间的整数`);
  }
  return Number(value);
}

function dateValue(value: unknown, rowNumber: number, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) throw new Error(`第${rowNumber}行“${label}”不是有效日期`);
    return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${value.getFullYear().toString().padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new Error(`第${rowNumber}行“${label}”必须使用YYYY-MM-DD日期格式`);
  }
  const normalized = value.trim();
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`第${rowNumber}行“${label}”不是有效日期`);
  }
  return normalized;
}

function consumptionDays(value: unknown, rowNumber: number) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && /^\d+(?:\.\d)?$/.test(value.trim())) value = Number(value.trim());
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
    || value > 3_650
    || Math.abs(value * 10 - Math.round(value * 10)) >= 1e-9
  ) {
    throw new Error(`第${rowNumber}行“预计消耗周期(天)”必须是0到3,650之间、最多一位小数的数字`);
  }
  return Math.round(value * 10) / 10;
}

export function parseReplenishmentGrid(grid: unknown[][]): ReplenishmentImportRow[] {
  const populated = grid.filter((row) => row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ""));
  if (populated.length < 2) throw new Error("请在模板中填写至少1行备货计划");
  if (populated.length > MAX_REPLENISHMENT_IMPORT_ROWS + 1) throw new Error(`单次最多导入${MAX_REPLENISHMENT_IMPORT_ROWS}行备货计划`);
  const headers = populated[0].map((value) => String(value ?? "").trim());
  if (headers.length !== REPLENISHMENT_IMPORT_HEADERS.length
    || headers.some((value, index) => value !== REPLENISHMENT_IMPORT_HEADERS[index])) {
    throw new Error(`表头必须依次为：${REPLENISHMENT_IMPORT_HEADERS.join("、")}`);
  }
  const seen = new Set<string>();
  return populated.slice(1).map((row, index) => {
    const rowNumber = index + 2;
    if (row.length > REPLENISHMENT_IMPORT_HEADERS.length
      && row.slice(REPLENISHMENT_IMPORT_HEADERS.length).some((cell) => String(cell ?? "").trim())) {
      throw new Error(`第${rowNumber}行包含模板外字段`);
    }
    const productCode = text(row[0], rowNumber, "货品编码", 100, true);
    const warehouse = text(row[1], rowNumber, "入库库房", 100, true);
    const key = `${warehouse}\u001f${productCode}`;
    if (seen.has(key)) throw new Error(`第${rowNumber}行与前面行重复：同一货品编码和入库库房只能出现一次`);
    seen.add(key);
    const statusLabel = text(row[10], rowNumber, "计划状态", 10);
    if (statusLabel && !["草稿", "已确认"].includes(statusLabel)) {
      throw new Error(`第${rowNumber}行“计划状态”只能填写草稿或已确认`);
    }
    const inspectionLabel = text(row[11], rowNumber, "是否验货", 10);
    if (inspectionLabel && !["是", "否"].includes(inspectionLabel)) {
      throw new Error(`第${rowNumber}行“是否验货”只能填写是或否`);
    }
    return {
      productCode,
      warehouse,
      plannedQuantity: integer(row[2], rowNumber),
      buyer: text(row[3], rowNumber, "对应采购", 200),
      operatorName: text(row[4], rowNumber, "对应运营", 200),
      department: text(row[5], rowNumber, "部门", 200) || "志高项目组",
      planType: text(row[6], rowNumber, "备货类型", 100),
      orderDate: dateValue(row[7], rowNumber, "下单日期"),
      expectedArrivalDate: dateValue(row[8], rowNumber, "预计到货日"),
      expectedConsumptionDays: consumptionDays(row[9], rowNumber),
      status: statusLabel === "草稿" ? "draft" : "confirmed",
      requiresInspection: inspectionLabel === "是",
      notes: text(row[12], rowNumber, "备注", 1_000),
    };
  });
}

export function parseReplenishmentWorkbook(bytes: ArrayBuffer): ReplenishmentImportRow[] {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_REPLENISHMENT_IMPORT_BYTES) throw new Error("工作簿不能超过4MiB");
  let entries = 0;
  let expanded = 0;
  unzipSync(new Uint8Array(bytes), {
    filter(file) {
      entries += 1;
      expanded += file.originalSize;
      if (entries > 100 || expanded > 16 * 1024 * 1024 || file.originalSize > 8 * 1024 * 1024) {
        throw new Error("工作簿解压内容超过安全上限");
      }
      return false;
    },
  });
  const workbook = XLSX.read(bytes, { type: "array", cellFormula: true, cellDates: true, sheetRows: MAX_REPLENISHMENT_IMPORT_ROWS + 2 });
  const sheet = workbook.Sheets["备货计划导入"];
  if (!sheet) throw new Error("工作簿必须包含名为“备货计划导入”的工作表");
  const range = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"] || "A1");
  if (range.e.r > MAX_REPLENISHMENT_IMPORT_ROWS || range.e.c >= REPLENISHMENT_IMPORT_HEADERS.length) {
    throw new Error(`导入表超过${MAX_REPLENISHMENT_IMPORT_ROWS}行或包含模板外的列`);
  }
  for (const [key, cell] of Object.entries(sheet)) {
    if (!key.startsWith("!") && cell && typeof cell === "object" && "f" in cell) {
      throw new Error("备货计划导入不接受公式，请粘贴为值");
    }
  }
  return parseReplenishmentGrid(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true }));
}

export function replenishmentTemplateWorkbook(): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const importSheet = XLSX.utils.aoa_to_sheet([[...REPLENISHMENT_IMPORT_HEADERS]]);
  for (let row = 2; row <= MAX_REPLENISHMENT_IMPORT_ROWS + 1; row += 1) {
    importSheet[`A${row}`] = { t: "s", v: "", z: "@" };
  }
  importSheet["!ref"] = `A1:M${MAX_REPLENISHMENT_IMPORT_ROWS + 1}`;
  importSheet["!cols"] = REPLENISHMENT_IMPORT_HEADERS.map((header, index) => ({ wch: index === 0 ? 22 : Math.max(14, header.length * 2 + 2) }));
  importSheet["!autofilter"] = { ref: "A1:M1" };
  XLSX.utils.book_append_sheet(workbook, importSheet, "备货计划导入");
  const instructions = XLSX.utils.aoa_to_sheet([
    ["填写说明", "内容"],
    ["必填字段", "货品编码、入库库房、备货数量"],
    ["货品与仓库", "必须存在于系统最新库存快照，系统会回填货品名称、品牌、供应商、库存和近30天销量"],
    ["计划状态", "填写“草稿”或“已确认”；留空默认“已确认”。导入不会自动发送钉钉"],
    ["是否验货", "填写“是”或“否”；留空默认“否”"],
    ["日期", "使用YYYY-MM-DD格式，例如2026-09-10"],
    ["批量提交", "导入后勾选多条已确认计划，点击“批量提交钉钉表”"],
    ["安全限制", `单次最多${MAX_REPLENISHMENT_IMPORT_ROWS}行；不接受公式、重复货品与仓库组合或额外列`],
  ]);
  instructions["!cols"] = [{ wch: 18 }, { wch: 88 }];
  XLSX.utils.book_append_sheet(workbook, instructions, "填写说明");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}
