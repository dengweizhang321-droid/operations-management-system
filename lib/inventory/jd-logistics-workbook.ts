import * as XLSX from "xlsx";
import { unzipSync } from "fflate";
import type { JdLogisticsRow, JdLogisticsSource } from "./jd-logistics-contract";

// Vite resolves the named ESM exports; Node's CJS namespace exposes SSF only
// through default. Reflective fallback avoids importing a nonexistent ESM default.
const spreadsheetFormats = XLSX.SSF ?? Reflect.get(Reflect.get(XLSX, "default") ?? {}, "SSF");

export const JD_LOGISTICS_MAX_FILE_BYTES = 40 * 1024 * 1024;
export const JD_LOGISTICS_MAX_ROWS = 20000;
export const JD_LOGISTICS_MAX_CSV_BYTES = 8 * 1024 * 1024;
export const JD_SHOP_PRODUCTS_CSV_HEADERS = ["店铺", "店铺商品编码", "平台商品编码", "事业部商品编码", "商品名称", "商家商品标识", "商品条码", "京配打标", "商品状态", "备注", "清关模式", "发货模式", "是否品牌自营"] as const;
export const JD_FLOW_CSV_HEADERS = ["序号", "业务发生时间", "事业部编码", "事业部名称", "仓库编码", "仓库名称", "商家商品编码", "事业部商品编号", "商家商品标识", "事业部商品名称", "商家单据编码", "京东单据编码", "关联单据编码", "业务类型", "库存状态", "商品等级编码", "商家商品等级名称", "商家商品等级编码", "库存类型", "实际原始库存", "实际库存加减数量", "实际库存结存", "可用原始库存", "可用库存加减数量", "可用库存结存", "款号", "颜色", "尺码", "计量单位", "库存渠道"] as const;
type Field = { key: string; headers: string[]; required?: boolean; number?: boolean; boolean?: boolean };
const text = (key: string, headers: string[], required = false): Field => ({ key, headers: [key, ...headers], required });
const numeric = (key: string, headers: string[], required = false): Field => ({ ...text(key, headers, required), number: true });
const common: Field[] = [text("businessUnitCode", ["事业部编码", "事业部编号"], true), text("goodsCode", ["事业部商品编号", "事业部商品编码"], true), text("goodsName", ["事业部商品名称", "商品名称"], true)];
const warehouse = [text("warehouseCode", ["仓库编码", "仓库编号"], true), text("warehouseName", ["仓库名称"])];
const attributes = [text("inventoryStatus", ["库存状态"]), text("inventoryType", ["库存类型"]), text("unit", ["计量单位", "单位"])];
export const jdLogisticsWorkbookFields: Record<JdLogisticsSource, Field[]> = {
  flow: [...common, ...warehouse, text("businessTime", ["业务发生时间"], true), text("documentNo", ["京东单据编码", "京东单据号"], true), text("businessType", ["业务类型"], true),
    numeric("actualBegin", ["实际原始库存"], true), numeric("actualChange", ["实际库存加减数量"], true), numeric("actualEnd", ["实际库存结存"], true),
    numeric("availableBegin", ["可用原始库存"], true), numeric("availableChange", ["可用库存加减数量"], true), numeric("availableEnd", ["可用库存结存"], true), ...attributes,
    text("channel", ["库存渠道"]), text("merchantDocumentNo", ["商家单据编码", "商家单据号"]), text("relatedDocumentNo", ["关联单据编码", "关联单据号"]),
    text("merchantGoodsCode", ["商家商品编码"]), text("merchantMark", ["商家商品标识"])],
  shop_products: [...common.map(field => field.key === "goodsCode" ? { ...field, required: false } : field), text("platform", ["所属平台", "销售平台", "平台"]), text("shopName", ["所属店铺", "店铺名称", "店铺"], true),
    text("productStatus", ["商品状态"], true),
    text("shopProductCode", ["店铺商品编码", "ESG商品编码", "ESG编码"], true), text("platformSku", ["销售平台商品编码", "销售平台店铺商品编码", "平台商品编码", "平台SKU", "SKU编码"]),
    text("isvCode", ["ISV商品编码", "ISV店铺商品编码", "ISV编码"]), text("merchantMark", ["商家商品标识"]), text("merchantGoodsCode", ["商家商品编码"]), text("unit", ["计量单位", "单位"]),
    { ...text("isCombo", ["是否组合商品", "是否组合套装", "是否组合装", "组合商品标识"]), boolean: true }],
  realtime_inventory: [], inventory_snapshot: [],
};
const inventoryFields = [text("businessUnitCode", ["事业部编码", "事业部编号"]), text("goodsCode", ["京东SKU", "京东sku", "事业部商品编号", "事业部商品编码"], true), text("goodsName", ["商品名称", "事业部商品名称"], true),
  text("warehouseCode", ["仓库编码", "仓库编号"]), text("warehouseName", ["仓库名称", "仓库"]), text("snapshotDate", ["快照日期", "库存日期", "日期"]), ...attributes,
  text("merchantGoodsCode", ["商家商品编码"]), text("merchantMark", ["商家商品标识"]),
  numeric("onHandQuantity", ["实时在库件数", "在库件数", "实物库存", "实际库存", "现有库存", "总库存"]), numeric("availableQuantity", ["实时可用库存件数", "可用在库件数", "可用库存", "可用库存数量"]),
  numeric("lockedQuantity", ["实时锁定库存件数", "锁定库存", "锁定库存数量"]), numeric("inTransitQuantity", ["在途库存", "在途库存数量"]),
  numeric("purchaseInTransitQuantity", ["实时采购在途件数", "采购在途数量", "采购在途库存"]), numeric("transferInTransitQuantity", ["实时调拨在途件数", "调拨在途数量", "调拨在途库存"]),
  numeric("sales7dQuantity", ["近7天销售出库件数", "近7天销量", "7天销量", "7日销量"]), numeric("sales30dQuantity", ["近30天销售出库件数", "近30天销量", "30天销量", "30日销量"]),
  text("regionCode", ["区域编码"]), text("regionName", ["区域名称", "区域"]), text("sourceProvinceCity", ["省市"])];
jdLogisticsWorkbookFields.realtime_inventory = inventoryFields;
jdLogisticsWorkbookFields.inventory_snapshot = inventoryFields;

function clean(value: unknown) { return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim(); }
function isoDate(value: unknown, dateOnly: boolean): string {
  if (typeof value === "number") {
    const parsed = spreadsheetFormats?.parse_date_code(value);
    if (!parsed) throw new Error("Excel日期无效");
    const day = `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    if (dateOnly) return day;
    // Excel stores fractional days as a double. SSF separates whole seconds
    // and u; round u to the service's microsecond precision, allowing carry.
    const microseconds = Math.round(Number(parsed.u ?? 0) * 1_000_000);
    if (!Number.isSafeInteger(microseconds) || microseconds < 0 || microseconds > 1_000_000) throw new Error("Excel日期小数秒无效");
    const base = new Date(`${day}T${String(parsed.H).padStart(2, "0")}:${String(parsed.M).padStart(2, "0")}:${String(Math.floor(parsed.S)).padStart(2, "0")}Z`);
    if (!Number.isFinite(base.valueOf()) || base.toISOString().slice(0, 10) !== day) throw new Error("Excel日期无效");
    const fraction = microseconds % 1_000_000;
    return `${new Date(base.valueOf() + Math.floor(microseconds / 1_000_000) * 1_000).toISOString().slice(0, 19)}${fraction ? `.${String(fraction).padStart(6, "0")}` : ""}+08:00`;
  }
  const raw = clean(value).replace(/\//g, "-").replace(" ", "T");
  const candidate = dateOnly ? raw : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw) ? `${raw.length === 16 ? `${raw}:00` : raw}+08:00` : raw;
  if (dateOnly ? !/^\d{4}-\d{2}-\d{2}$/.test(candidate) : !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:\+08:00|Z)$/.test(candidate)) throw new Error("日期格式无效");
  const date = new Date(dateOnly ? `${candidate}T00:00:00Z` : candidate);
  if (!Number.isFinite(date.valueOf()) || dateOnly && date.toISOString().slice(0, 10) !== candidate) throw new Error("日期无效");
  return candidate;
}

/** Pure normalization shared by the Worker and the controlled downloader. No deduplication. */
export type JdLogisticsWorkbookContext = { collectedAt?: string; allowDeclaredBusinessUnit?: boolean };
export function parseJdLogisticsGrid(grid: unknown[][], sourceKind: JdLogisticsSource, businessUnitCode: string, context: JdLogisticsWorkbookContext = {}): JdLogisticsRow[] {
  const fields = jdLogisticsWorkbookFields[sourceKind];
  if (!fields || !businessUnitCode.trim()) throw new Error("请选择有效来源和事业部");
  const nonempty = grid.map((row, index) => ({ row, index })).filter(({ row }) => row.some(cell => clean(cell)));
  if (nonempty.length < 2 || nonempty.length > JD_LOGISTICS_MAX_ROWS + 1) throw new Error("工作表必须有表头及1–20000行明细；空文件不作为完整覆盖导入");
  let headers = nonempty[0].row.map(clean);
  // The inspected source workbook repeats A:O in P:AD. Accept it only when
  // both complete blocks, including every source value, are identical.
  if (sourceKind === "realtime_inventory" && headers.length % 2 === 0) {
    const width = headers.length / 2;
    if (headers.slice(0, width).every((header, index) => header === headers[index + width])) {
      for (const entry of nonempty) {
        if (!entry.row.slice(0, width).every((value, index) => (value ?? "") === (entry.row[index + width] ?? ""))) throw new Error(`第${entry.index + 1}行重复库存区域内容不一致，不能合并或双计`);
        entry.row = entry.row.slice(0, width);
      }
      headers = headers.slice(0, width);
    }
  }
  const positions = fields.map(field => {
    const found = headers.flatMap((header, index) => field.headers.includes(header) ? [index] : []);
    if (found.length > 1) throw new Error(`表头重复或歧义：${field.headers[1] ?? field.key}`);
    if (!found.length && field.required && !(field.key === "businessUnitCode" && context.allowDeclaredBusinessUnit)) throw new Error(`缺少表头：${field.headers[1] ?? field.key}`);
    return found[0] ?? -1;
  });
  if ((sourceKind === "realtime_inventory" || sourceKind === "inventory_snapshot") && !fields.some((field, index) => field.number && positions[index] >= 0)) throw new Error("库存来源缺少可识别的数量表头");
  const mappedColumns = new Set(positions.filter(position => position >= 0));
  const attributes = headers.flatMap((header, position) => {
    if (mappedColumns.has(position) || ["序号", "sourceRowNumber"].includes(header)) return [];
    if (!header) {
      if (nonempty.slice(1).some(entry => clean(entry.row[position]))) throw new Error(`第${position + 1}列有业务值但没有表头，不能静默丢弃`);
      return [];
    }
    if (header.length > 100) throw new Error("源业务表头超过100字");
    return [{ header, position }];
  });
  if (attributes.length > 100 || new Set(attributes.map(attribute => attribute.header)).size !== attributes.length) throw new Error("额外业务表头重复或超过100列，无法完整识别");
  return nonempty.slice(1).map(({ row, index }) => {
    const sourceAttributes = Object.fromEntries(attributes.map(({ header, position }) => {
      const value = clean(row[position]);
      if (value.length > 1000) throw new Error(`第${index + 1}行源业务列${header}超过1000字`);
      return [header, value || null];
    }));
    const result: JdLogisticsRow = { sourceRowNumber: index + 1, sourceAttributes, goodsCodeKind: sourceKind === "flow" || sourceKind === "shop_products" ? "department_product" : "jd_sku" };
    fields.forEach((field, fieldIndex) => {
      let value = positions[fieldIndex] < 0 ? "" : row[positions[fieldIndex]];
      if (field.key === "businessUnitCode" && positions[fieldIndex] < 0 && context.allowDeclaredBusinessUnit) value = businessUnitCode;
      if (field.key === "snapshotDate" && sourceKind === "realtime_inventory" && !clean(value)) {
        if (!context.collectedAt) throw new Error("实时库存文件没有日期列，必须提供实际采集时刻，不能补填历史快照日期");
        const time = new Date(isoDate(context.collectedAt, false));
        value = new Date(time.valueOf() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      }
      const label = `第${index + 1}行 ${field.headers[1] ?? field.key}`;
      if (field.required && !clean(value)) throw new Error(`${label}不能为空`);
      if (field.number) {
        if (!clean(value)) result[field.key] = null;
        else {
          const number = typeof value === "number" ? value : /^-?\d+$/.test(clean(value)) ? Number(clean(value)) : NaN;
          if (!Number.isSafeInteger(number) || Math.abs(number) > 1e9) throw new Error(`${label}必须为范围内的整数`);
          result[field.key] = number;
        }
      } else if (field.boolean) {
        if (!clean(value)) result[field.key] = null;
        else if (["是", "1", "true", "组合装"].includes(clean(value).toLowerCase())) result[field.key] = true;
        else if (["否", "0", "false", "单品"].includes(clean(value).toLowerCase())) result[field.key] = false;
        else throw new Error(`${label}无法识别`);
      } else if (field.key === "businessTime" || field.key === "snapshotDate") result[field.key] = isoDate(value, field.key === "snapshotDate");
      else {
        if (typeof value === "number" && /Code$|Sku$|Mark$|No$/.test(field.key) && (!Number.isSafeInteger(value) || value < 0 || String(value).length > 15)) throw new Error(`${label}数字型编码必须为不超过15位的非负精确整数；无法恢复已丢失的编码位数`);
        result[field.key] = clean(value);
      }
    });
    if (result.businessUnitCode !== businessUnitCode) throw new Error(`第${index + 1}行事业部与所选账号不一致`);
    if (sourceKind === "shop_products" && result.productStatus !== "启用") throw new Error(`第${index + 1}行商品状态必须为启用；当前接口只接受事业部启用关系全集`);
    if (sourceKind !== "shop_products") {
      if (!result.warehouseCode && !result.warehouseName) throw new Error(`第${index + 1}行缺少可识别的仓库编码或名称`);
      result.warehouseIdentityKind = result.warehouseCode ? "code" : "name";
      result.warehouseKey = `${result.warehouseIdentityKind}:${result.warehouseCode || result.warehouseName}`;
    }
    if ((sourceKind === "realtime_inventory" || sourceKind === "inventory_snapshot") && fields.filter(field => field.number).every(field => result[field.key] === null)) throw new Error(`第${index + 1}行全部库存和销量数量缺失，不能作为有效库存明细导入`);
    return result;
  });
}

export function parseJdLogisticsWorkbook(bytes: ArrayBuffer | Uint8Array, sourceKind: JdLogisticsSource, businessUnitCode: string, context: JdLogisticsWorkbookContext = {}): JdLogisticsRow[] {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!input.byteLength || input.byteLength > JD_LOGISTICS_MAX_FILE_BYTES) throw new Error("工作簿必须为1字节至40MiB的XLSX文件");
  if (!(input[0] === 0x50 && input[1] === 0x4b && input[2] === 0x03 && input[3] === 0x04)) {
    if (sourceKind !== "shop_products" && sourceKind !== "flow") throw new Error("此来源只支持原始XLSX；CSV仅限已核验的流水和店铺商品来源");
    return parseJdLogisticsCsv(input, sourceKind, businessUnitCode, context);
  }
  let expanded = 0; let count = 0;
  unzipSync(input, { filter(entry) {
    expanded += entry.originalSize; count += 1;
    if (count > 500 || expanded > 64 * 1024 * 1024 || entry.originalSize > 32 * 1024 * 1024) throw new Error("工作簿解压内容超过安全上限");
    return false;
  } });
  const book = XLSX.read(input, { type: "array", cellFormula: true, sheetRows: JD_LOGISTICS_MAX_ROWS + 2 });
  const preferred = sourceKind === "flow" ? ["库存流水"] : sourceKind === "realtime_inventory" ? ["仓储-实时库存监控明细表"] : sourceKind === "inventory_snapshot" ? ["仓储监控-库存快照监控_分仓"] : [];
  const matched = preferred.filter(name => book.SheetNames.includes(name));
  const name = matched.length === 1 ? matched[0] : book.SheetNames.length === 1 ? book.SheetNames[0] : "";
  if (!name) throw new Error("请上传单一来源明细工作表；库存流水可使用包含“库存流水”的原始工作簿");
  const sheet = book.Sheets[name];
  const range = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"] || "A1");
  if (range.e.r > JD_LOGISTICS_MAX_ROWS || range.e.c > 150) throw new Error("工作表超过行列安全上限");
  for (const [address, cell] of Object.entries(sheet)) if (!address.startsWith("!") && cell && typeof cell === "object" && "f" in cell) throw new Error("来源明细不接受公式，请上传原始导出值");
  return parseJdLogisticsGrid(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true }), sourceKind, businessUnitCode, context);
}

/** Compatibility entry for the inspected shop-products CSV contract. */
export function parseJdShopProductsCsv(bytes: Uint8Array, businessUnitCode: string, context: JdLogisticsWorkbookContext = {}): JdLogisticsRow[] {
  return parseJdLogisticsCsv(bytes, "shop_products", businessUnitCode, context);
}

/** Only the two verified CSV datasets are admitted. Identifier literals stay text. */
export function parseJdLogisticsCsv(bytes: Uint8Array, sourceKind: "flow" | "shop_products", businessUnitCode: string, context: JdLogisticsWorkbookContext = {}): JdLogisticsRow[] {
  if (!bytes.byteLength || bytes.byteLength > JD_LOGISTICS_MAX_CSV_BYTES) throw new Error("CSV须为1字节至8MiB");
  const expectedHeaders: readonly string[] = sourceKind === "flow" ? JD_FLOW_CSV_HEADERS : JD_SHOP_PRODUCTS_CSV_HEADERS;
  const columnCount = expectedHeaders.length;
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error("UTF-8 BOM文件包含无效UTF-8内容");
    try { source = new TextDecoder("gb18030", { fatal: true }).decode(bytes); }
    catch { throw new Error("CSV不是有效UTF-8或GB18030编码"); }
  }
  source = source.replace(/^\uFEFF/, "");
  const grid: string[][] = []; let row: string[] = [], cell = "", quoted = false, closed = false;
  const pushCell = () => { if (cell.length > 1000) throw new Error("CSV字段超过1000字"); row.push(cell); if (row.length > columnCount) throw new Error(`CSV超过${columnCount}列`); cell = ""; closed = false; };
  const pushRow = () => { pushCell(); if (row.some(value => clean(value))) { if (row.length !== columnCount) throw new Error(`CSV每行必须为${columnCount}列`); grid.push(row); if (grid.length > JD_LOGISTICS_MAX_ROWS + 1) throw new Error("CSV超过20000行"); } row = []; };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') { if (source[index + 1] === '"') { cell += '"'; index += 1; } else { quoted = false; closed = true; } }
      else cell += char;
    } else if (char === ",") pushCell();
    else if (char === "\n" || char === "\r") { if (char === "\r" && source[index + 1] === "\n") index += 1; pushRow(); }
    else if (char === '"' && cell === "" && !closed) quoted = true;
    // The verified export writes a trailing tab after quoted identifiers.
    // Only horizontal whitespace may occur between a closing quote and delimiter.
    else if (closed && (char === "\t" || char === " ")) continue;
    else { if (closed || char === '"') throw new Error("CSV引号格式无效"); cell += char; }
    if (cell.length > 1000) throw new Error("CSV字段超过1000字");
  }
  if (quoted) throw new Error("CSV引号未闭合");
  if (cell || row.length || closed) pushRow();
  const headers = grid[0]?.map(clean) ?? [];
  if (headers.length !== columnCount || new Set(headers).size !== columnCount || expectedHeaders.some(header => !headers.includes(header))) throw new Error(`CSV表头必须匹配当前来源已核验的${columnCount}列中文合同`);
  const signedQuantityColumns = new Set(jdLogisticsWorkbookFields[sourceKind].filter(field => field.number).flatMap(field => headers.flatMap((header, index) => field.headers.includes(header) ? [index] : [])));
  for (const record of grid.slice(1)) record.forEach((value, index) => {
    const literal = clean(value);
    if (/^[=+\-@]/.test(literal) && !(sourceKind === "flow" && signedQuantityColumns.has(index) && /^-\d+$/.test(literal))) throw new Error("CSV不接受公式型文本；仅流水数量列允许负整数字面量");
  });
  return parseJdLogisticsGrid(grid, sourceKind, businessUnitCode, context);
}
