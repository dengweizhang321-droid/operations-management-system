import * as XLSX from "xlsx";
import { JdCustomerServiceWorkflowError } from "../lib/jd/customer-service-workflow";

export type CustomerServiceDurationAnomaly = { sourceRowNumber: number; sourceValue: number };
// The original export stays immutable. Only a derived workbook replaces a
// finite negative duration with missing; never zero, absolute value or a drop.
export function normalizeCustomerServiceDurations(bytes: Uint8Array) {
  const book = XLSX.read(bytes, { type: "array", cellDates: false });
  const sheetName = book.SheetNames[0];
  if (!sheetName) throw new JdCustomerServiceWorkflowError("PAIR_PARSE_REJECTED");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheetName], { header: 1, defval: "", raw: true });
  const headers = (matrix[0] ?? []).map(value => String(value).replace(/\s+/g, ""));
  const columns = headers.flatMap((name, index) => name === "会话时长(M)" ? [index] : []);
  if (columns.length > 1) throw new JdCustomerServiceWorkflowError("DURATION_COLUMN_AMBIGUOUS");
  const anomalies: CustomerServiceDurationAnomaly[] = [];
  if (columns.length) {
    const column = columns[0];
    for (let index = 1; index < matrix.length; index++) {
      const cell = matrix[index][column];
      const numeric = typeof cell === "number" || typeof cell === "string" && /^-\d+(?:\.\d+)?$/.test(cell.trim());
      const value = numeric ? Number(cell) : NaN;
      if (Number.isFinite(value) && value < 0) {
        anomalies.push({ sourceRowNumber: index + 1, sourceValue: value });
        matrix[index][column] = "";
      }
    }
  }
  if (!anomalies.length) return { bytes, anomalies };
  const normalized = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(normalized, XLSX.utils.aoa_to_sheet(matrix), sheetName);
  const derived = new Uint8Array(XLSX.write(normalized, { type: "array", bookType: "xlsx" }));
  if (derived.length > 25 * 1024 * 1024) throw new JdCustomerServiceWorkflowError("INVALID_FILE_SIZE");
  return { bytes: derived, anomalies };
}
