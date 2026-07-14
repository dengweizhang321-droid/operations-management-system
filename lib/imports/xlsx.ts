import { strFromU8, unzipSync } from "fflate";

export type XlsxCellValue = string | number | boolean | null;

export interface XlsxRow {
  /** One-based row number from the worksheet. */
  rowNumber: number;
  /** Zero-based, sparse Excel columns materialized with nulls for missing cells. */
  cells: XlsxCellValue[];
}

export interface XlsxFirstSheet {
  sheetName: string;
  date1904: boolean;
  rows: XlsxRow[];
  maxColumns: number;
}

export interface XlsxParseOptions {
  /** Limit the uploaded ZIP itself. Defaults to 20 MiB. */
  maxCompressedBytes?: number;
  /** Limit the sum of XML bytes selected for inflation. Defaults to 32 MiB. */
  maxUncompressedBytes?: number;
  /** Limit a single worksheet XML part. Defaults to 24 MiB. */
  maxWorksheetBytes?: number;
  /** Defensive worksheet row limit. Defaults to 100,001 rows. */
  maxRows?: number;
}

export type XlsxParseErrorCode =
  | "INVALID_INPUT"
  | "COMPRESSED_SIZE_LIMIT"
  | "UNCOMPRESSED_SIZE_LIMIT"
  | "WORKSHEET_SIZE_LIMIT"
  | "ROW_LIMIT"
  | "INVALID_ZIP"
  | "INVALID_WORKBOOK"
  | "INVALID_WORKSHEET";

export class XlsxParseError extends Error {
  readonly code: XlsxParseErrorCode;

  constructor(code: XlsxParseErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "XlsxParseError";
    this.code = code;
  }
}

export const DEFAULT_XLSX_LIMITS = Object.freeze({
  // Sales exports are uploaded in chunks up to 128 MiB. These limits remain
  // bounded against ZIP bombs while allowing a full-year ERP ledger.
  maxCompressedBytes: 128 * 1024 * 1024,
  maxUncompressedBytes: 768 * 1024 * 1024,
  maxWorksheetBytes: 640 * 1024 * 1024,
  maxRows: 500_001,
});

const WORKBOOK_PATH = "xl/workbook.xml";
const WORKBOOK_RELS_PATH = "xl/_rels/workbook.xml.rels";
const METADATA_PART_LIMIT = 2 * 1024 * 1024;

interface InflateBudget {
  used: number;
  max: number;
}

interface WorkbookRelationship {
  id: string;
  target: string;
  type: string;
  external: boolean;
}

/** Decode XML text/attribute entities without depending on DOMParser. */
export function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-fA-F]+)|(amp|lt|gt|quot|apos));/g,
    (entity, decimal: string | undefined, hexadecimal: string | undefined, named: string | undefined) => {
      if (decimal !== undefined || hexadecimal !== undefined) {
        const codePoint = Number.parseInt(decimal ?? hexadecimal ?? "", hexadecimal === undefined ? 10 : 16);
        if (
          !Number.isFinite(codePoint) ||
          codePoint < 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return entity;
        }
        return String.fromCodePoint(codePoint);
      }

      switch (named) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        default:
          return entity;
      }
    },
  );
}

/**
 * Parse the preferred sales worksheet in an XLSX archive.
 *
 * The implementation intentionally uses only Uint8Array, fflate, and string
 * scanning so it can run unchanged in a Cloudflare Worker.
 */
export function parseXlsxFirstSheet(
  input: ArrayBuffer | Uint8Array,
  options: XlsxParseOptions = {},
): XlsxFirstSheet {
  const bytes = toUint8Array(input);
  const limits = {
    maxCompressedBytes: positiveInteger(options.maxCompressedBytes, DEFAULT_XLSX_LIMITS.maxCompressedBytes),
    maxUncompressedBytes: positiveInteger(
      options.maxUncompressedBytes,
      DEFAULT_XLSX_LIMITS.maxUncompressedBytes,
    ),
    maxWorksheetBytes: positiveInteger(options.maxWorksheetBytes, DEFAULT_XLSX_LIMITS.maxWorksheetBytes),
    maxRows: positiveInteger(options.maxRows, DEFAULT_XLSX_LIMITS.maxRows),
  };

  if (bytes.byteLength === 0) {
    throw new XlsxParseError("INVALID_INPUT", "XLSX 文件为空");
  }
  if (bytes.byteLength > limits.maxCompressedBytes) {
    throw new XlsxParseError(
      "COMPRESSED_SIZE_LIMIT",
      `XLSX 压缩文件超过 ${limits.maxCompressedBytes} 字节限制`,
    );
  }

  const budget: InflateBudget = { used: 0, max: limits.maxUncompressedBytes };
  const metadata = extractZipParts(
    bytes,
    new Set([WORKBOOK_PATH, WORKBOOK_RELS_PATH]),
    METADATA_PART_LIMIT,
    budget,
  );
  const workbookBytes = metadata[WORKBOOK_PATH];
  const relationshipsBytes = metadata[WORKBOOK_RELS_PATH];
  if (!workbookBytes || !relationshipsBytes) {
    throw new XlsxParseError("INVALID_WORKBOOK", "XLSX 缺少工作簿或工作簿关系文件");
  }

  const workbookXml = decodeXmlPart(workbookBytes);
  const relationshipsXml = decodeXmlPart(relationshipsBytes);
  const selectedSheetTag = findPreferredSheetTag(workbookXml);
  if (!selectedSheetTag) {
    throw new XlsxParseError("INVALID_WORKBOOK", "工作簿中没有工作表");
  }

  const sheetName = xmlAttribute(selectedSheetTag, "name") ?? "Sheet1";
  const relationshipId = xmlAttribute(selectedSheetTag, "id");
  if (!relationshipId) {
    throw new XlsxParseError("INVALID_WORKBOOK", "首个工作表缺少关系 ID");
  }

  const relationships = parseRelationships(relationshipsXml);
  const worksheetRelationship = relationships.find((item) => item.id === relationshipId && !item.external);
  if (!worksheetRelationship) {
    throw new XlsxParseError("INVALID_WORKBOOK", "无法定位首个工作表文件");
  }

  const worksheetPath = resolveZipTarget(WORKBOOK_PATH, worksheetRelationship.target);
  const sharedStringsRelationship = relationships.find(
    (item) => !item.external && item.type.toLowerCase().endsWith("/sharedstrings"),
  );
  const sharedStringsPath = sharedStringsRelationship
    ? resolveZipTarget(WORKBOOK_PATH, sharedStringsRelationship.target)
    : null;

  const selectedPaths = new Set([worksheetPath]);
  if (sharedStringsPath) selectedPaths.add(sharedStringsPath);
  const parts = extractZipParts(bytes, selectedPaths, limits.maxWorksheetBytes, budget, worksheetPath);
  let worksheetBytes: Uint8Array | undefined = parts[worksheetPath];
  if (!worksheetBytes) {
    throw new XlsxParseError("INVALID_WORKBOOK", "XLSX 缺少首个工作表内容");
  }

  let sharedStringsBytes = sharedStringsPath ? parts[sharedStringsPath] : undefined;
  const sharedStrings = sharedStringsBytes ? parseSharedStrings(decodeXmlPart(sharedStringsBytes)) : [];
  if (sharedStringsPath) delete parts[sharedStringsPath];
  sharedStringsBytes = undefined;
  const worksheetXml = decodeXmlPart(worksheetBytes);
  delete parts[worksheetPath];
  worksheetBytes = undefined;
  const parsed = parseWorksheet(worksheetXml, sharedStrings, limits.maxRows);
  const workbookPrTag = findFirstStartTag(workbookXml, "workbookPr");
  const date1904Value = workbookPrTag ? xmlAttribute(workbookPrTag, "date1904") : null;

  return {
    sheetName,
    date1904: date1904Value === "1" || date1904Value?.toLowerCase() === "true",
    rows: parsed.rows,
    maxColumns: parsed.maxColumns,
  };
}

function toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new XlsxParseError("INVALID_INPUT", "XLSX 输入必须是 ArrayBuffer 或 Uint8Array");
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new XlsxParseError("INVALID_INPUT", "XLSX 解析限制必须是正整数");
  }
  return value;
}

function extractZipParts(
  input: Uint8Array,
  selectedPaths: Set<string>,
  perPartLimit: number,
  budget: InflateBudget,
  worksheetPath?: string,
): Record<string, Uint8Array> {
  const normalizedSelected = new Set([...selectedPaths].map(normalizeZipPath));
  const budgetBefore = budget.used;
  let advertisedBytes = 0;
  let extracted: Record<string, Uint8Array>;

  try {
    extracted = unzipSync(input, {
      filter(file) {
        const path = normalizeZipPath(file.name);
        if (!normalizedSelected.has(path)) return false;
        const isWorksheet = worksheetPath !== undefined && path === normalizeZipPath(worksheetPath);
        if (file.originalSize > perPartLimit) {
          throw new XlsxParseError(
            isWorksheet ? "WORKSHEET_SIZE_LIMIT" : "UNCOMPRESSED_SIZE_LIMIT",
            `${path} 解压后超过 ${perPartLimit} 字节限制`,
          );
        }
        if (budgetBefore + advertisedBytes + file.originalSize > budget.max) {
          throw new XlsxParseError(
            "UNCOMPRESSED_SIZE_LIMIT",
            `XLSX 选定内容解压后超过 ${budget.max} 字节限制`,
          );
        }
        advertisedBytes += file.originalSize;
        return true;
      },
    });
  } catch (error) {
    if (error instanceof XlsxParseError) throw error;
    throw new XlsxParseError("INVALID_ZIP", "无法解压 XLSX 文件", { cause: error });
  }

  const normalized: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  let actualBytes = 0;
  for (const [name, data] of Object.entries(extracted)) {
    const path = normalizeZipPath(name);
    if (!normalizedSelected.has(path)) continue;
    if (data.byteLength > perPartLimit) {
      const isWorksheet = worksheetPath !== undefined && path === normalizeZipPath(worksheetPath);
      throw new XlsxParseError(
        isWorksheet ? "WORKSHEET_SIZE_LIMIT" : "UNCOMPRESSED_SIZE_LIMIT",
        `${path} 解压后超过 ${perPartLimit} 字节限制`,
      );
    }
    actualBytes += data.byteLength;
    normalized[path] = data;
  }

  if (budgetBefore + actualBytes > budget.max) {
    throw new XlsxParseError(
      "UNCOMPRESSED_SIZE_LIMIT",
      `XLSX 选定内容解压后超过 ${budget.max} 字节限制`,
    );
  }
  budget.used = budgetBefore + actualBytes;
  return normalized;
}

function normalizeZipPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function resolveZipTarget(sourcePath: string, target: string): string {
  const normalizedTarget = target.replace(/\\/g, "/");
  const rawParts = normalizedTarget.startsWith("/")
    ? normalizedTarget.slice(1).split("/")
    : `${sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1)}${normalizedTarget}`.split("/");
  const resolved: string[] = [];

  for (const part of rawParts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (resolved.length === 0) {
        throw new XlsxParseError("INVALID_WORKBOOK", "工作簿关系路径越界");
      }
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }

  const path = resolved.join("/");
  if (!path) throw new XlsxParseError("INVALID_WORKBOOK", "工作簿关系路径为空");
  return path;
}

function decodeXmlPart(bytes: Uint8Array): string {
  // Large ERP worksheets can exceed a runtime's single TextDecoder input size.
  // Decode in bounded slices while preserving UTF-8 character boundaries.
  if (bytes.byteLength <= 16 * 1024 * 1024) return strFromU8(bytes).replace(/^\uFEFF/, "");
  const decoder = new TextDecoder("utf-8");
  const chunkSize = 4 * 1024 * 1024;
  let xml = "";
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    xml += decoder.decode(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength)), { stream: true });
  }
  return (xml + decoder.decode()).replace(/^\uFEFF/, "");
}

function findFirstStartTag(xml: string, localName: string): string | null {
  const escapedName = escapeRegExp(localName);
  const expression = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${escapedName}\\b([^>]*)>`, "i");
  return expression.exec(xml)?.[1] ?? null;
}

/** Prefer the 吉客云 sales detail sheet when a workbook also has pivot sheets. */
function findPreferredSheetTag(xml: string): string | null {
  const expression = /<(?:[A-Za-z_][\w.-]*:)?sheet\b([^>]*)\/?\s*>/gi;
  let first: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(xml)) !== null) {
    const attributes = match[1];
    first ??= attributes;
    if (xmlAttribute(attributes, "name")?.trim().toLowerCase() === "sheettitle") {
      return attributes;
    }
  }
  return first;
}

function xmlAttribute(attributes: string, localName: string): string | null {
  const expression = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(attributes)) !== null) {
    const qualifiedName = match[1];
    const candidateLocalName = qualifiedName.slice(qualifiedName.lastIndexOf(":") + 1);
    if (qualifiedName === localName || candidateLocalName === localName) {
      return decodeXmlEntities(match[2] ?? match[3] ?? "");
    }
  }
  return null;
}

function parseRelationships(xml: string): WorkbookRelationship[] {
  const relationships: WorkbookRelationship[] = [];
  const expression = /<(?:[A-Za-z_][\w.-]*:)?Relationship\b([^>]*)\/?\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(xml)) !== null) {
    const id = xmlAttribute(match[1], "Id");
    const target = xmlAttribute(match[1], "Target");
    const type = xmlAttribute(match[1], "Type");
    if (!id || !target || !type) continue;
    relationships.push({
      id,
      target,
      type,
      external: xmlAttribute(match[1], "TargetMode")?.toLowerCase() === "external",
    });
  }
  return relationships;
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const expression = /<(?:[A-Za-z_][\w.-]*:)?si\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(xml)) !== null) {
    strings.push(readTextNodes(match[1]));
  }
  return strings;
}

function readTextNodes(xml: string): string {
  const withoutPhonetics = xml.replace(
    /<(?:[A-Za-z_][\w.-]*:)?rPh\b[^>]*>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?rPh\s*>/gi,
    "",
  );
  const expression = /<(?:[A-Za-z_][\w.-]*:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t\s*>/gi;
  let result = "";
  let match: RegExpExecArray | null;
  while ((match = expression.exec(withoutPhonetics)) !== null) {
    result += decodeXmlEntities(unwrapCdata(match[1]));
  }
  return result;
}

function unwrapCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function parseWorksheet(
  xml: string,
  sharedStrings: string[],
  maxRows: number,
): { rows: XlsxRow[]; maxColumns: number } {
  const sheetDataStart = findOpeningElementEnd(xml, "sheetData");
  if (sheetDataStart === -1) return { rows: [], maxColumns: 0 };
  const sheetDataEnd = findClosingElementStart(xml, "sheetData", sheetDataStart);
  if (sheetDataEnd === -1) {
    throw new XlsxParseError("INVALID_WORKSHEET", "工作表 sheetData 标签未闭合");
  }
  const rowExpression = /<(?:[A-Za-z_][\w.-]*:)?row\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?row\s*>|<(?:[A-Za-z_][\w.-]*:)?row\b([^>]*)\/>/gi;
  const rows: XlsxRow[] = [];
  let maxColumns = 0;
  let previousRowNumber = 0;
  let rowMatch: RegExpExecArray | null;
  rowExpression.lastIndex = sheetDataStart;

  while ((rowMatch = rowExpression.exec(xml)) !== null && rowMatch.index < sheetDataEnd) {
    if (rows.length >= maxRows) {
      throw new XlsxParseError("ROW_LIMIT", `工作表超过 ${maxRows} 行限制`);
    }
    const attributes = rowMatch[1] ?? rowMatch[3] ?? "";
    const explicitRowNumber = parsePositiveInteger(xmlAttribute(attributes, "r"));
    const rowNumber = explicitRowNumber ?? previousRowNumber + 1;
    previousRowNumber = rowNumber;
    const cells = parseCells(rowMatch[2] ?? "", sharedStrings);
    maxColumns = Math.max(maxColumns, cells.length);
    rows.push({ rowNumber, cells });
  }

  return { rows, maxColumns };
}

function parseCells(rowXml: string, sharedStrings: string[]): XlsxCellValue[] {
  const expression = /<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c\s*>|<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*)\/>/gi;
  const cells: XlsxCellValue[] = [];
  let nextColumnIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(rowXml)) !== null) {
    const attributes = match[1] ?? match[3] ?? "";
    const reference = xmlAttribute(attributes, "r");
    const columnIndex = reference === null ? nextColumnIndex : columnIndexFromReference(reference);
    if (columnIndex < 0 || columnIndex >= 16_384) {
      throw new XlsxParseError("INVALID_WORKSHEET", `无效单元格引用: ${reference ?? "(缺失)"}`);
    }
    while (cells.length < columnIndex) cells.push(null);
    cells[columnIndex] = parseCellValue(match[2] ?? "", xmlAttribute(attributes, "t"), sharedStrings);
    nextColumnIndex = columnIndex + 1;
  }

  return cells;
}

function parseCellValue(
  cellXml: string,
  type: string | null,
  sharedStrings: string[],
): XlsxCellValue {
  if (type === "inlineStr") return readTextNodes(cellXml);
  const rawValue = readElementText(cellXml, "v");
  if (rawValue === null || rawValue === "") return null;

  switch (type) {
    case "s": {
      const index = Number(rawValue);
      if (!Number.isSafeInteger(index) || index < 0 || index >= sharedStrings.length) {
        throw new XlsxParseError("INVALID_WORKSHEET", `共享字符串索引无效: ${rawValue}`);
      }
      return sharedStrings[index];
    }
    case "b":
      return rawValue === "1" || rawValue.toLowerCase() === "true";
    case "str":
    case "e":
    case "d":
      return rawValue;
    case "n":
    case null: {
      const number = Number(rawValue);
      if (!Number.isFinite(number)) {
        throw new XlsxParseError("INVALID_WORKSHEET", `数值单元格内容无效: ${rawValue}`);
      }
      return number;
    }
    default:
      return rawValue;
  }
}

function readElementText(xml: string, localName: string): string | null {
  const escapedName = escapeRegExp(localName);
  const expression = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${escapedName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${escapedName}\\s*>`,
    "i",
  );
  const match = expression.exec(xml);
  return match ? decodeXmlEntities(unwrapCdata(match[1])) : null;
}

function columnIndexFromReference(reference: string): number {
  const match = /^([A-Za-z]+)\d+$/.exec(reference);
  if (!match) return -1;
  let index = 0;
  for (const character of match[1].toUpperCase()) {
    index = index * 26 + character.charCodeAt(0) - 64;
  }
  return index - 1;
}

function parsePositiveInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function findOpeningElementEnd(xml: string, localName: string): number {
  const escapedName = escapeRegExp(localName);
  const match = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${escapedName}\\b[^>]*>`, "i").exec(xml);
  return match ? match.index + match[0].length : -1;
}

function findClosingElementStart(xml: string, localName: string, fromIndex: number): number {
  const escapedName = escapeRegExp(localName);
  const expression = new RegExp(`<\\/(?:[A-Za-z_][\\w.-]*:)?${escapedName}\\s*>`, "ig");
  expression.lastIndex = fromIndex;
  const match = expression.exec(xml);
  return match?.index ?? -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
