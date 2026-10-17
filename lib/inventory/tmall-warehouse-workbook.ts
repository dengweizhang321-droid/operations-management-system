import * as XLSX from "xlsx";
import { unzipSync, Unzip, UnzipInflate } from "fflate";
import { TMALL_WAREHOUSE_MAX_FILE_BYTES, TMALL_WAREHOUSE_MAX_ROWS, tmallWarehouseQuantityKeys, type TmallWarehouseRow } from "./tmall-warehouse-contract";

const aliases: Record<string, readonly string[]> = {
  goodsId: ["货品ID", "货品id"], goodsCode: ["货品编码"], goodsName: ["货品名称", "货品"],
  warehouse: ["仓名称", "仓库名称", "仓库"], warehouseCode: ["仓Code", "仓编码", "仓库编码"],
  region: ["区域"], owner: ["货主"], brand: ["品牌名称", "品牌"],
  availableQuantity: ["实仓可销", "可销库存"], onHandQuantity: ["实仓总数", "实仓总量", "总库存"],
  salesOccupiedQuantity: ["销售占用"], goodAvailableQuantity: ["良品可用"], goodOccupiedQuantity: ["良品占用"],
  defectiveQuantity: ["残次总量", "残次"], purchaseInTransitQuantity: ["采购在途", "采购在途库存"],
  transferInTransitQuantity: ["调拨在途", "调拨在途库存"],
  sales7dQuantity: ["近7天销量", "近7日销售出库", "近7天销售出库"],
  sales30dQuantity: ["近30天销量", "近30日销售出库", "近30天销售出库", "30天销量"],
};
const clean = (value: unknown) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
const unknown = new Set(["", "None", "null", "—", "-", "/"]);
/** Check actual inflated bytes before SheetJS may allocate from ZIP metadata. */
export function validateTmallWarehouseArchive(input: Uint8Array) {
  const maximumEntry = 32 * 1024 * 1024, maximumTotal = 64 * 1024 * 1024;
  const expected = new Map<string, number>(); let declared = 0;
  unzipSync(input, { filter(entry) {
    declared += entry.originalSize;
    if (expected.has(entry.name) || expected.size >= 500 || declared > maximumTotal || entry.originalSize > maximumEntry) throw new Error("工作簿解压内容超过上限或存在重复条目");
    expected.set(entry.name, entry.originalSize); return false;
  } });
  let actualTotal = 0; const completed = new Set<string>(), started = new Set<string>();
  const stream = new Unzip(file => {
    if (!expected.has(file.name) || started.has(file.name)) throw new Error("工作簿ZIP条目不一致");
    started.add(file.name); let size = 0;
    file.ondata = (error, data, final) => {
      if (error) throw new Error("工作簿ZIP解压失败");
      size += data.byteLength; actualTotal += data.byteLength;
      if (size > maximumEntry || actualTotal > maximumTotal || size > expected.get(file.name)!) { file.terminate(); throw new Error("工作簿实际解压内容超过上限或声明不符"); }
      if (final) { if (size !== expected.get(file.name)) throw new Error("工作簿实际解压长度与声明不符"); completed.add(file.name); }
    };
    file.start();
  });
  stream.register(UnzipInflate);
  // A small compressed input chunk bounds any one inflater callback allocation,
  // including ZIPs that lie about their uncompressed size.
  for (let offset = 0; offset < input.byteLength; offset += 1024) stream.push(input.subarray(offset, Math.min(offset + 1024, input.byteLength)), offset + 1024 >= input.byteLength);
  if (completed.size !== expected.size || started.size !== expected.size) throw new Error("工作簿ZIP不完整");
}
function identifier(value: unknown, label: string) {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0 || String(value).length > 15)) throw new Error(`${label}必须为精确文本编码，数字型编码不能超过15位`);
  return clean(value);
}
function sourceDate(grid: unknown[][], header: number) {
  const dates = new Set<string>();
  for (const row of grid.slice(0, header)) for (const value of row) {
    const match = clean(value).match(/^(?:数据更新时间[：:]?\s*)?(\d{4}-\d{2}-\d{2})$/);
    if (match) dates.add(match[1]);
  }
  if (dates.size > 1) throw new Error("工作表包含多个来源日期，不能确定快照日期");
  return [...dates][0];
}
export function parseTmallWarehouseGrid(grid: unknown[][]): { rows: TmallWarehouseRow[]; sourceDate?: string } {
  const candidates = grid.slice(0, 10).flatMap((row, index) => {
    const headers = row.map(clean);
    return aliases.goodsId.some(label => headers.includes(label)) && aliases.warehouse.some(label => headers.includes(label)) ? [index] : [];
  });
  if (candidates.length !== 1) throw new Error("未找到唯一的天猫库存表头（货品ID、仓名称/仓库名称）");
  const header = candidates[0], headers = grid[header].map(clean);
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) throw new Error("库存表头重复，无法确认数量口径");
  const positions = Object.fromEntries(Object.entries(aliases).map(([key, labels]) => {
    const found = headers.flatMap((label, index) => labels.includes(label) ? [index] : []);
    if (found.length > 1) throw new Error(`${key}存在多个同义表头，无法确认口径`);
    return [key, found[0] ?? -1];
  }));
  if (positions.goodsName < 0 || !tmallWarehouseQuantityKeys.some(key => positions[key] >= 0)) throw new Error("缺少货品名称或库存数量列");
  const mapped = new Set(Object.values(positions).filter(index => index >= 0));
  const rows: TmallWarehouseRow[] = [], identities = new Set<string>();
  for (let index = header + 1; index < grid.length; index++) {
    const values = grid[index];
    if (!values.some(value => !unknown.has(clean(value)))) continue;
    const row: Record<string, unknown> = { sourceRowNumber: index + 1 };
    for (const key of Object.keys(aliases)) {
      const value = positions[key] >= 0 ? values[positions[key]] : "";
      if ((tmallWarehouseQuantityKeys as readonly string[]).includes(key)) {
        if (unknown.has(clean(value))) row[key] = null;
        else {
          const number = typeof value === "number" ? value : /^-?\d+$/.test(clean(value)) ? Number(clean(value)) : NaN;
          if (!Number.isSafeInteger(number) || Math.abs(number) > 1e9) throw new Error(`第${index + 1}行 ${aliases[key][0]}须为范围内的整数`);
          row[key] = number;
        }
      } else row[key] = /Id$|Code$/.test(key) ? identifier(value, `第${index + 1}行${aliases[key][0]}`) : clean(value);
      if (typeof row[key] === "string" && (row[key] as string).length > 500) throw new Error(`第${index + 1}行文本字段过长`);
    }
    if (!row.goodsId || !row.goodsName || !row.warehouse) throw new Error(`第${index + 1}行缺少货品ID、名称或仓库`);
    if (tmallWarehouseQuantityKeys.every(key => row[key] === null)) throw new Error(`第${index + 1}行全部数量缺失`);
    const identity = JSON.stringify([row.owner, row.goodsId, row.warehouseCode ? `code:${row.warehouseCode}` : `name:${row.warehouse}`]);
    if (identities.has(identity)) throw new Error(`第${index + 1}行货品与仓库重复，请核实完整来源`);
    identities.add(identity);
    const attributes: Record<string, string | null> = Object.create(null);
    values.forEach((value, column) => {
      if (mapped.has(column)) return;
      const text = clean(value);
      if (!headers[column]) { if (!unknown.has(text)) throw new Error(`第${column + 1}列有内容但没有表头`); return; }
      if (text.length > 1000) throw new Error(`第${index + 1}行来源字段超过1000字`);
      attributes[headers[column]] = unknown.has(text) ? null : text;
    });
    row.sourceAttributes = attributes;
    rows.push(row as TmallWarehouseRow);
    if (rows.length > TMALL_WAREHOUSE_MAX_ROWS) throw new Error("库存明细超过20000行上限");
  }
  if (!rows.length) throw new Error("天猫库存表没有有效明细，不能清空现有库存");
  return { rows, sourceDate: sourceDate(grid, header) };
}
export function parseTmallWarehouseWorkbook(bytes: ArrayBuffer | Uint8Array) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!input.byteLength || input.byteLength > TMALL_WAREHOUSE_MAX_FILE_BYTES) throw new Error("请选择不超过20MiB的原始XLSX文件");
  if (input[0] !== 0x50 || input[1] !== 0x4b || input[2] !== 0x03 || input[3] !== 0x04) throw new Error("仅支持原始XLSX工作簿");
  validateTmallWarehouseArchive(input);
  const book = XLSX.read(input, { type: "array", cellFormula: true, sheetRows: TMALL_WAREHOUSE_MAX_ROWS + 12 });
  if (book.SheetNames.length > 20) throw new Error("工作簿工作表数量超过20张");
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name], range = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"] || "A1");
    if (range.s.r < 0 || range.s.c < 0 || range.e.r >= TMALL_WAREHOUSE_MAX_ROWS + 10 || range.e.c >= 120) throw new Error("工作表行列超过安全上限");
  }
  const matching = book.SheetNames.filter(name => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: "", raw: true, range: { s: { r: 0, c: 0 }, e: { r: 9, c: 119 } } });
    return rows.some(row => aliases.goodsId.some(label => row.map(clean).includes(label)) && aliases.warehouse.some(label => row.map(clean).includes(label)));
  });
  if (matching.length !== 1) throw new Error("工作簿须包含唯一的天猫库存来源工作表");
  const sheetName = matching[0], sheet = book.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"] || "A1");
  if (range.e.r >= TMALL_WAREHOUSE_MAX_ROWS + 10 || range.e.c >= 120) throw new Error("工作表行列超过安全上限");
  for (const [address, cell] of Object.entries(sheet)) if (!address.startsWith("!") && cell && typeof cell === "object" && "f" in cell) throw new Error("天猫来源明细不接受公式，请上传原始导出值");
  return { ...parseTmallWarehouseGrid(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true })), sheetName };
}
