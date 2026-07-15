import { createHash } from "node:crypto";
import { readFile, mkdir, readdir, copyFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import {
  parseXlsxFirstSheet,
  type XlsxCellValue,
  type XlsxFirstSheet,
  type XlsxRow,
} from "../lib/imports/xlsx";
import { normalizeSalesLedgerDate } from "../lib/imports/sales-ledger";

type Policy = {
  version: string;
  timeZone: string;
  download: { directory: string; fileNamePattern: string };
  dateRule: { type: "month_to_previous_day"; field: string; fallbackFields: string[] };
  excludedWarehouses: string[];
  approvedSalesChannels: string[];
  costSource: {
    searchRoot: string;
    folderPrefix: string;
    fileName: string;
    productCodeHeader: string;
    productNameHeader: string;
    unitCostHeader: string;
    zeroCostProductNames: string[];
  };
};

type CliOptions = {
  asOfDate: string;
  downloadPath?: string;
  costSourcePath?: string;
  baseUrl: string;
  dryRun: boolean;
};

type HeaderRow = {
  rowNumber: number;
  headers: string[];
  indexes: Map<string, number>;
};

type Period = {
  startDate: string;
  endDate: string;
  startDateTime: string;
  endExclusiveDateTime: string;
};

type CostEntry = {
  productName: string;
  costCents: Set<number>;
};

type OutputSheet = { name: string; rows: XlsxCellValue[][] };

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = path.join(projectRoot, "config", "sales-import-policy.json");
const auditRoot = path.join(projectRoot, "outputs", "sales-import-runs");
const salesRequiredHeaders = [
  "订单编号",
  "销售渠道",
  "发货仓库",
  "货品编号",
  "货品名称",
  "数量",
  "下单时间",
  "货品成本",
  "分摊后单价",
  "分摊后金额",
  "费用分摊",
  "毛利",
] as const;

function text(value: XlsxCellValue | undefined) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function normalizeHeader(value: XlsxCellValue | undefined) {
  return text(value)
    .replace(/^\uFEFF/, "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, "");
}

function isBlankRow(row: XlsxRow) {
  return !row.cells.some((cell) => text(cell) !== "");
}

function parseNumber(value: XlsxCellValue | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[￥¥,\s]/g, "");
  if (!normalized || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value: number) {
  return Math.round((value + Math.sign(value || 1) * Number.EPSILON) * 100) / 100;
}

function moneyToCents(value: number) {
  return Math.round((value + Math.sign(value || 1) * Number.EPSILON) * 100);
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function monthToPreviousDay(asOfDate: string): Period {
  if (!isIsoDate(asOfDate)) throw new Error("--as-of 必须是有效的 YYYY-MM-DD 日期。");
  const startDate = `${asOfDate.slice(0, 8)}01`;
  return {
    startDate,
    endDate: asOfDate,
    startDateTime: `${startDate} 00:00:00`,
    endExclusiveDateTime: `${addUtcDays(asOfDate, 1)} 00:00:00`,
  };
}

function defaultAsOfDate() {
  return addUtcDays(shanghaiToday(), -1);
}

function parseCli(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    asOfDate: defaultAsOfDate(),
    baseUrl: "http://localhost:3000",
    dryRun: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const next = args[index + 1];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (!next) throw new Error(`参数 ${argument} 缺少取值。`);
    if (argument === "--as-of") options.asOfDate = next;
    else if (argument === "--download") options.downloadPath = next;
    else if (argument === "--cost-source") options.costSourcePath = next;
    else if (argument === "--base-url") options.baseUrl = next.replace(/\/$/, "");
    else throw new Error(`不支持的参数：${argument}`);
    index += 1;
  }
  return options;
}

function findHeaderRow(sheet: XlsxFirstSheet, requiredHeaders: readonly string[], sourceName: string): HeaderRow {
  for (const row of sheet.rows.slice(0, 20)) {
    const indexes = new Map<string, number>();
    row.cells.forEach((value, index) => {
      const key = normalizeHeader(value);
      if (key && !indexes.has(key)) indexes.set(key, index);
    });
    if (requiredHeaders.every((header) => indexes.has(normalizeHeader(header)))) {
      return { rowNumber: row.rowNumber, headers: row.cells.map(text), indexes };
    }
  }
  throw new Error(`${sourceName} 未找到必需表头：${requiredHeaders.join("、")}`);
}

function requiredColumn(header: HeaderRow, name: string, sourceName: string) {
  const index = header.indexes.get(normalizeHeader(name));
  if (index === undefined) throw new Error(`${sourceName} 缺少必需列：${name}`);
  return index;
}

function optionalColumn(header: HeaderRow, name: string) {
  return header.indexes.get(normalizeHeader(name));
}

function cellAt(row: XlsxRow, column: number | undefined): XlsxCellValue {
  return column === undefined ? null : (row.cells[column] ?? null);
}

function effectiveShipTime(row: XlsxRow, date1904: boolean, columns: { ship: number; lineShip?: number; order: number }) {
  return normalizeSalesLedgerDate(cellAt(row, columns.ship), date1904)
    ?? normalizeSalesLedgerDate(cellAt(row, columns.lineShip), date1904)
    ?? normalizeSalesLedgerDate(cellAt(row, columns.order), date1904);
}

async function newestDownload(directory: string, fileNamePattern: string) {
  const matcher = new RegExp(fileNamePattern, "i");
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isFile() && matcher.test(entry.name))
    .map(async (entry) => {
      const filePath = path.join(directory, entry.name);
      return { filePath, modified: (await stat(filePath)).mtimeMs };
    }));
  if (!candidates.length) throw new Error(`下载目录未找到销售单明细账：${directory}`);
  return candidates.sort((left, right) => right.modified - left.modified)[0].filePath;
}

async function newestCostSource(policy: Policy) {
  const root = path.join(projectRoot, policy.costSource.searchRoot);
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(policy.costSource.folderPrefix))
    .map(async (entry) => {
      const filePath = path.join(root, entry.name, policy.costSource.fileName);
      try {
        return { filePath, modified: (await stat(filePath)).mtimeMs };
      } catch {
        return null;
      }
    }));
  const existing = candidates.filter((item): item is { filePath: string; modified: number } => item !== null);
  if (!existing.length) throw new Error("未找到已剔除刷刷仓的分仓库存成本源，请使用 --cost-source 指定文件。");
  return existing.sort((left, right) => right.modified - left.modified)[0].filePath;
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

function worksheetXml(rows: XlsxCellValue[][]) {
  const xmlRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      if (value === null || value === undefined || value === "") return "";
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}"><v>${value}</v></c>`;
      if (typeof value === "boolean") return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
      return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
    }).join("");
    return cells ? `<row r="${rowIndex + 1}">${cells}</row>` : "";
  }).filter(Boolean).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows}</sheetData></worksheet>`;
}

function workbookBytes(sheets: OutputSheet[]) {
  const sheetXml = sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const relationships = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const contentTypes = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${contentTypes}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetXml}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>`),
  };
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet.rows));
  });
  return zipSync(files, { level: 6 });
}

function outputRowsFor(row: XlsxRow, width: number) {
  const cells = [...row.cells];
  while (cells.length < width) cells.push(null);
  return cells;
}

async function readJson<T>(filePath: string, fallback: T) {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function uploadInChunks(baseUrl: string, bytes: Uint8Array, fileName: string, fingerprint: string) {
  const chunkSizeBytes = 2 * 1024 * 1024;
  const chunkCount = Math.ceil(bytes.byteLength / chunkSizeBytes);
  const init = await fetch(`${baseUrl}/api/imports/sales/chunks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "init", fileName, fileSizeBytes: bytes.byteLength, chunkCount, fingerprint }),
  });
  const initBody = await init.json() as { ok?: boolean; upload?: { id: string; receivedChunkIndexes: number[] }; message?: string };
  if (!init.ok || !initBody.ok || !initBody.upload) throw new Error(initBody.message ?? "无法创建销售导入分片会话。");
  const received = new Set(initBody.upload.receivedChunkIndexes);
  for (let index = 0; index < chunkCount; index += 1) {
    if (received.has(index)) continue;
    const start = index * chunkSizeBytes;
    const end = Math.min(start + chunkSizeBytes, bytes.byteLength);
    const response = await fetch(`${baseUrl}/api/imports/sales/chunks`, {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        "x-upload-id": initBody.upload.id,
        "x-chunk-index": String(index),
      },
      body: bytes.slice(start, end),
    });
    const body = await response.json() as { ok?: boolean; message?: string };
    if (!response.ok || !body.ok) throw new Error(body.message ?? `第 ${index + 1} 个分片上传失败。`);
  }
  const complete = await fetch(`${baseUrl}/api/imports/sales/chunks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "complete", uploadId: initBody.upload.id }),
  });
  const completeBody = await complete.json() as { ok?: boolean; status?: string; message?: string; batch?: { id: string; status: string; rowCount: number; totals: unknown } };
  if (!complete.ok || !completeBody.ok || !completeBody.batch) throw new Error(completeBody.message ?? "销售导入完成确认失败。");
  return completeBody as typeof completeBody & { batch: NonNullable<typeof completeBody.batch> };
}

async function main() {
  const options = parseCli();
  const policy = await readJson<Policy>(policyPath, {} as Policy);
  if (!policy.version || policy.dateRule.type !== "month_to_previous_day") throw new Error("销售导入策略文件无效。");
  const period = monthToPreviousDay(options.asOfDate);
  const downloadPath = options.downloadPath ? path.resolve(options.downloadPath) : await newestDownload(policy.download.directory, policy.download.fileNamePattern);
  const costSourcePath = options.costSourcePath ? path.resolve(options.costSourcePath) : await newestCostSource(policy);
  const rawBytes = new Uint8Array(await readFile(downloadPath));
  const rawHash = sha256(rawBytes);
  const runId = `${period.startDate}_${period.endDate}_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const runDir = path.join(auditRoot, runId);
  const registryPath = path.join(auditRoot, "processed-downloads.json");
  const registry = await readJson<{ runs: Array<{ rawSha256: string; status: string; runId: string }> }>(registryPath, { runs: [] });
  if (registry.runs.some((run) => run.rawSha256 === rawHash && run.status === "imported")) {
    throw new Error("该下载文件已完成过导入。请先在吉客云重新导出，再运行一键任务。");
  }
  await mkdir(path.join(runDir, "raw"), { recursive: true });
  await copyFile(downloadPath, path.join(runDir, "raw", path.basename(downloadPath)));

  const salesWorkbook = parseXlsxFirstSheet(rawBytes);
  const salesHeader = findHeaderRow(salesWorkbook, salesRequiredHeaders, "销售明细文件");
  const columns = {
    warehouse: requiredColumn(salesHeader, "发货仓库", "销售明细文件"),
    channel: requiredColumn(salesHeader, "销售渠道", "销售明细文件"),
    productCode: requiredColumn(salesHeader, "货品编号", "销售明细文件"),
    productName: requiredColumn(salesHeader, "货品名称", "销售明细文件"),
    quantity: requiredColumn(salesHeader, "数量", "销售明细文件"),
    cost: requiredColumn(salesHeader, "货品成本", "销售明细文件"),
    allocatedAmount: requiredColumn(salesHeader, "分摊后金额", "销售明细文件"),
    fee: requiredColumn(salesHeader, "费用分摊", "销售明细文件"),
    gross: requiredColumn(salesHeader, "毛利", "销售明细文件"),
    grossMargin: optionalColumn(salesHeader, "毛利率"),
    untaxedGross: optionalColumn(salesHeader, "未税毛利"),
    untaxedGrossMargin: optionalColumn(salesHeader, "未税毛利率(%)"),
    ship: requiredColumn(salesHeader, policy.dateRule.field, "销售明细文件"),
    lineShip: optionalColumn(salesHeader, policy.dateRule.fallbackFields[0]),
    order: requiredColumn(salesHeader, policy.dateRule.fallbackFields[1], "销售明细文件"),
  };
  const sourceRows = salesWorkbook.rows.filter((row) => row.rowNumber > salesHeader.rowNumber && !isBlankRow(row));
  const brushRows = sourceRows.filter((row) => policy.excludedWarehouses.includes(text(cellAt(row, columns.warehouse))));
  const nonBrushRows = sourceRows.filter((row) => !policy.excludedWarehouses.includes(text(cellAt(row, columns.warehouse))));
  const excludedShopRows = nonBrushRows.filter((row) => !policy.approvedSalesChannels.includes(text(cellAt(row, columns.channel))));
  const retainedRows = nonBrushRows.filter((row) => policy.approvedSalesChannels.includes(text(cellAt(row, columns.channel))));

  const costBytes = new Uint8Array(await readFile(costSourcePath));
  const costWorkbook = parseXlsxFirstSheet(costBytes);
  const costHeader = findHeaderRow(costWorkbook, [policy.costSource.productCodeHeader, policy.costSource.productNameHeader, policy.costSource.unitCostHeader], "成本源文件");
  const costCodeColumn = requiredColumn(costHeader, policy.costSource.productCodeHeader, "成本源文件");
  const costNameColumn = requiredColumn(costHeader, policy.costSource.productNameHeader, "成本源文件");
  const unitCostColumn = requiredColumn(costHeader, policy.costSource.unitCostHeader, "成本源文件");
  const costEntries = new Map<string, CostEntry>();
  for (const row of costWorkbook.rows.filter((item) => item.rowNumber > costHeader.rowNumber && !isBlankRow(item))) {
    const code = text(cellAt(row, costCodeColumn));
    const unitCost = parseNumber(cellAt(row, unitCostColumn));
    if (!code || unitCost === null) continue;
    const entry = costEntries.get(code) ?? { productName: text(cellAt(row, costNameColumn)), costCents: new Set<number>() };
    entry.costCents.add(moneyToCents(unitCost));
    if (!entry.productName) entry.productName = text(cellAt(row, costNameColumn));
    costEntries.set(code, entry);
  }
  const costConflicts = [...costEntries.entries()]
    .filter(([, entry]) => entry.costCents.size > 1)
    .map(([code, entry]) => ({ code, costs: [...entry.costCents].sort((a, b) => a - b).map((value) => value / 100) }));
  const costMap = new Map([...costEntries.entries()]
    .filter(([, entry]) => entry.costCents.size === 1)
    .map(([code, entry]) => [code, [...entry.costCents][0] / 100]));

  const dateProblems: Array<{ row: number; value: string | null }> = [];
  const numericProblems: Array<{ row: number; field: string }> = [];
  const unmatchedCosts = new Map<string, { productName: string; rows: number[] }>();
  const outputRows: XlsxCellValue[][] = [];
  let minDate = "";
  let maxDate = "";
  let allocatedTotal = 0;
  let costTotal = 0;
  let feeTotal = 0;
  let grossTotal = 0;
  for (const sourceRow of retainedRows) {
    const effectiveDate = effectiveShipTime(sourceRow, salesWorkbook.date1904, columns);
    const date = effectiveDate?.slice(0, 10) ?? "";
    if (!effectiveDate || date < period.startDate || date > period.endDate) {
      dateProblems.push({ row: sourceRow.rowNumber, value: effectiveDate });
      continue;
    }
    minDate = !minDate || date < minDate ? date : minDate;
    maxDate = !maxDate || date > maxDate ? date : maxDate;
    const code = text(cellAt(sourceRow, columns.productCode));
    const productName = text(cellAt(sourceRow, columns.productName));
    const quantity = parseNumber(cellAt(sourceRow, columns.quantity));
    const allocated = parseNumber(cellAt(sourceRow, columns.allocatedAmount));
    const fee = parseNumber(cellAt(sourceRow, columns.fee));
    if (quantity === null || quantity === 0) numericProblems.push({ row: sourceRow.rowNumber, field: "数量" });
    if (allocated === null) numericProblems.push({ row: sourceRow.rowNumber, field: "分摊后金额" });
    if (fee === null) numericProblems.push({ row: sourceRow.rowNumber, field: "费用分摊" });
    if (quantity === null || quantity === 0 || allocated === null || fee === null) continue;
    const isZeroCost = policy.costSource.zeroCostProductNames.includes(productName);
    const unitCost = isZeroCost ? 0 : costMap.get(code);
    if (unitCost === undefined) {
      const current = unmatchedCosts.get(code) ?? { productName, rows: [] };
      if (current.rows.length < 10) current.rows.push(sourceRow.rowNumber);
      unmatchedCosts.set(code, current);
      continue;
    }
    const lineCost = roundMoney(unitCost * quantity);
    const grossProfit = roundMoney(allocated - lineCost - fee);
    const grossMargin = allocated === 0 ? "" : `${(grossProfit / allocated * 100).toFixed(2)}%`;
    const row = outputRowsFor(sourceRow, salesHeader.headers.length);
    row[columns.cost] = lineCost;
    row[columns.gross] = grossProfit;
    if (columns.grossMargin !== undefined) row[columns.grossMargin] = grossMargin;
    if (columns.untaxedGross !== undefined) row[columns.untaxedGross] = grossProfit;
    if (columns.untaxedGrossMargin !== undefined) row[columns.untaxedGrossMargin] = grossMargin;
    outputRows.push(row);
    allocatedTotal = roundMoney(allocatedTotal + allocated);
    costTotal = roundMoney(costTotal + lineCost);
    feeTotal = roundMoney(feeTotal + fee);
    grossTotal = roundMoney(grossTotal + grossProfit);
  }

  if (costConflicts.length || unmatchedCosts.size || dateProblems.length || numericProblems.length || minDate !== period.startDate || maxDate !== period.endDate) {
    const failedAudit = {
      ok: false,
      period,
      validation: {
        minDate,
        maxDate,
        dateProblems,
        numericProblems,
        costConflicts,
        unmatchedCosts: [...unmatchedCosts.entries()].map(([code, value]) => ({ code, ...value })),
      },
    };
    await writeJson(path.join(runDir, "audit.json"), failedAudit);
    throw new Error("导入前自动校验未通过，详见本次运行目录 audit.json。");
  }

  const retainedShopCounts = new Map<string, number>();
  for (const row of retainedRows) {
    const channel = text(cellAt(row, columns.channel));
    retainedShopCounts.set(channel, (retainedShopCounts.get(channel) ?? 0) + 1);
  }
  const excludedShopCounts = new Map<string, number>();
  for (const row of excludedShopRows) {
    const channel = text(cellAt(row, columns.channel)) || "（空销售渠道）";
    excludedShopCounts.set(channel, (excludedShopCounts.get(channel) ?? 0) + 1);
  }
  const usedCodes = [...new Set(outputRows
    .filter((row) => !policy.costSource.zeroCostProductNames.includes(text(row[columns.productName])))
    .map((row) => text(row[columns.productCode]))
    .filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN"));
  const costSheetRows: XlsxCellValue[][] = [
    ["货品编号", "固定成本价", "货品名称", "成本来源"],
    ...usedCodes.map((code) => [code, costMap.get(code) ?? null, costEntries.get(code)?.productName ?? "", path.basename(costSourcePath)]),
  ];
  const whitelistRows: XlsxCellValue[][] = [["保留店铺（销售渠道精确匹配）", "保留行数", "状态", "被剔除店铺", "剔除行数"]];
  const excludedShopEntries = [...excludedShopCounts.entries()].sort((left, right) => right[1] - left[1]);
  const auditRowCount = Math.max(policy.approvedSalesChannels.length, excludedShopEntries.length);
  for (let index = 0; index < auditRowCount; index += 1) {
    const approved = policy.approvedSalesChannels[index] ?? "";
    const excluded = excludedShopEntries[index];
    whitelistRows.push([
      approved,
      approved ? retainedShopCounts.get(approved) ?? 0 : null,
      approved ? "保留" : "",
      excluded?.[0] ?? "",
      excluded?.[1] ?? null,
    ]);
  }
  const processedBytes = workbookBytes([
    { name: salesWorkbook.sheetName || "sheetTitle", rows: [salesHeader.headers, ...outputRows] },
    { name: "成本匹配", rows: costSheetRows },
    { name: "店铺白名单", rows: whitelistRows },
  ]);
  const processedHash = sha256(processedBytes);
  const outputPath = path.join(runDir, `销售单明细账_${period.startDate}_${period.endDate}_已筛选并匹配成本.xlsx`);
  await writeFile(outputPath, processedBytes);

  const processedWorkbook = parseXlsxFirstSheet(processedBytes);
  const processedHeader = findHeaderRow(processedWorkbook, salesRequiredHeaders, "处理后的销售明细文件");
  const processedColumns = {
    warehouse: requiredColumn(processedHeader, "发货仓库", "处理后的销售明细文件"),
    channel: requiredColumn(processedHeader, "销售渠道", "处理后的销售明细文件"),
    cost: requiredColumn(processedHeader, "货品成本", "处理后的销售明细文件"),
    ship: requiredColumn(processedHeader, policy.dateRule.field, "处理后的销售明细文件"),
    lineShip: optionalColumn(processedHeader, policy.dateRule.fallbackFields[0]),
    order: requiredColumn(processedHeader, policy.dateRule.fallbackFields[1], "处理后的销售明细文件"),
  };
  const processedRows = processedWorkbook.rows.filter((row) => row.rowNumber > processedHeader.rowNumber && !isBlankRow(row));
  const processedChecks = {
    rowCount: processedRows.length,
    excludedWarehouseRows: processedRows.filter((row) => policy.excludedWarehouses.includes(text(cellAt(row, processedColumns.warehouse)))).length,
    nonWhitelistRows: processedRows.filter((row) => !policy.approvedSalesChannels.includes(text(cellAt(row, processedColumns.channel)))).length,
    missingCostRows: processedRows.filter((row) => parseNumber(cellAt(row, processedColumns.cost)) === null).length,
    dateProblemRows: processedRows.filter((row) => {
      const value = effectiveShipTime(row, processedWorkbook.date1904, { ship: processedColumns.ship, lineShip: processedColumns.lineShip, order: processedColumns.order });
      const date = value?.slice(0, 10) ?? "";
      return !date || date < period.startDate || date > period.endDate;
    }).length,
  };
  if (processedChecks.rowCount !== outputRows.length || processedChecks.excludedWarehouseRows || processedChecks.nonWhitelistRows || processedChecks.missingCostRows || processedChecks.dateProblemRows) {
    throw new Error("处理后的 Excel 复核失败，未执行导入。");
  }

  const audit: Record<string, unknown> = {
    ok: true,
    runId,
    policyVersion: policy.version,
    period,
    sources: {
      rawDownload: { path: downloadPath, sha256: rawHash, bytes: rawBytes.byteLength },
      costSource: { path: costSourcePath, sha256: sha256(costBytes), bytes: costBytes.byteLength, uniqueCosts: costMap.size },
    },
    filtering: {
      sourceRows: sourceRows.length,
      excludedWarehouseRows: brushRows.length,
      nonWhitelistRows: excludedShopRows.length,
      retainedRows: retainedRows.length,
      retainedShopCounts: Object.fromEntries(retainedShopCounts),
      whitelistWithNoData: policy.approvedSalesChannels.filter((channel) => !retainedShopCounts.has(channel)),
    },
    validation: { costConflicts, unmatchedCosts: [], dateProblems, numericProblems, processedChecks },
    totals: {
      netSalesCents: moneyToCents(allocatedTotal),
      costAmountCents: moneyToCents(costTotal),
      feeAllocationCents: moneyToCents(feeTotal),
      grossProfitCents: moneyToCents(grossTotal),
    },
    output: { path: outputPath, sha256: processedHash, bytes: processedBytes.byteLength },
    import: null,
    postImportVerification: null,
  };
  await writeJson(path.join(runDir, "audit.json"), audit);
  if (options.dryRun) {
    console.log(JSON.stringify({ status: "prepared", dryRun: true, audit }, null, 2));
    return;
  }

  const imported = await uploadInChunks(options.baseUrl, processedBytes, path.basename(outputPath), processedHash);
  const verifyResponse = await fetch(`${options.baseUrl}/api/imports/sales/verify?${new URLSearchParams({ startDate: period.startDate, endDate: period.endDate, batchId: processedHash })}`);
  const verification = await verifyResponse.json() as {
    batch?: { id: string; status: string; rowCount: number } | null;
    stats?: { rowCount: number; minShipTime: string | null; maxShipTime: string | null; excludedWarehouseRows: number; rowsNotOwnedByBatch: number | null };
    nonWhitelistChannels?: string[];
  };
  if (!verifyResponse.ok
    || imported.batch.id !== processedHash
    || verification.batch?.status !== "completed"
    || verification.batch.rowCount !== outputRows.length
    || verification.stats?.rowCount !== outputRows.length
    || verification.stats.excludedWarehouseRows !== 0
    || verification.stats.rowsNotOwnedByBatch !== 0
    || verification.stats.minShipTime?.slice(0, 10) !== period.startDate
    || verification.stats.maxShipTime?.slice(0, 10) !== period.endDate
    || (verification.nonWhitelistChannels?.length ?? 0) !== 0) {
    audit.import = imported;
    audit.postImportVerification = verification;
    await writeJson(path.join(runDir, "audit.json"), audit);
    throw new Error("导入后的系统复核未通过，已保留 audit.json 供排查。");
  }
  audit.import = imported;
  audit.postImportVerification = verification;
  await writeJson(path.join(runDir, "audit.json"), audit);
  registry.runs.push({ rawSha256: rawHash, status: "imported", runId });
  await mkdir(auditRoot, { recursive: true });
  await writeJson(registryPath, registry);
  console.log(JSON.stringify({ status: "imported", audit }, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
