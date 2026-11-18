import { parseJdLogisticsWorkbook } from "../lib/inventory/jd-logistics-workbook";

/** Terminal by name: the hourly retry classifier treats *_MANUAL_ACTION as final. */
export const JD_LOGISTICS_SOURCE_FILE_REJECTED_CODE = "JD_LOGISTICS_SOURCE_FILE_REJECTED_MANUAL_ACTION";

/** Parses a downloaded source file. A parser refusal becomes one readable failure code,
 * and the parser's own message (row numbers and header names only) goes to stderr once. */
export function parseJdLogisticsSourceFile(...args: Parameters<typeof parseJdLogisticsWorkbook>): ReturnType<typeof parseJdLogisticsWorkbook> {
  try { return parseJdLogisticsWorkbook(...args); }
  catch (error) {
    const message = error instanceof Error ? error.message : "unknown parser failure";
    console.error(`[jd-logistics] source file rejected: ${message.replace(/[\r\n\u0000-\u001f]+/g, " ").slice(0, 300)}`);
    throw new Error(JD_LOGISTICS_SOURCE_FILE_REJECTED_CODE);
  }
}
