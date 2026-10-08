import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { parseChatLog, parseCustomerServiceImport, parseSessionWorkbook, type CustomerServiceParseResult } from "../lib/customer-service/import-service";
import { customerServiceStore } from "../lib/jd/customer-service-stores";
import { assertCustomerServicePeriod, JdCustomerServiceWorkflowError, type CustomerServicePeriod } from "../lib/jd/customer-service-workflow";

import { normalizeCustomerServiceDurations } from "./jd-customer-service-duration-normalization";

const separator = "/*****************以下为一通会话************************************/\n";
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function reject(code: string): never { throw new JdCustomerServiceWorkflowError(code); }
function fingerprints(parsed: CustomerServiceParseResult) {
  return parsed.conversations.map(row => {
    // The daily workbook resets row numbers. These are not business values.
    const business = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "sourceRowNumber"));
    return sha256(JSON.stringify(business));
  }).sort();
}
export type CustomerServiceDailyFile = {
  date: string; sessionBytes: Uint8Array; chatBytes: Uint8Array;
  sessionSha256: string; chatSha256: string; contentSha256: string;
  summary: CustomerServiceParseResult["summary"]; conversationCount: number; normalizedBytes: number;
};

// Split only existing source material. Reparse every derived pair, then prove
// that its complete business values equal the full-range parse. A midnight
// match that changes under partitioning fails closed rather than being lost.
export function buildCustomerServiceDailyFiles(sessionBytes: Uint8Array, chatBytes: Uint8Array, period: CustomerServicePeriod, storeKey?: string, options: { negativeDurationToMissing?: boolean } = {}) {
  if (storeKey !== undefined) customerServiceStore(storeKey);
  assertCustomerServicePeriod(period);
  if ([sessionBytes, chatBytes].some(bytes => !bytes.length || bytes.length > 25 * 1024 * 1024)) reject("INVALID_FILE_SIZE");
  const normalized = options.negativeDurationToMissing ? normalizeCustomerServiceDurations(sessionBytes) : { bytes: sessionBytes, anomalies: [] };
  const parsingBytes = normalized.bytes;
  let chatText: string;
  let full: CustomerServiceParseResult;
  try {
    chatText = new TextDecoder("utf-8", { fatal: true }).decode(chatBytes);
    full = parseCustomerServiceImport(parsingBytes, chatText);
  } catch { return reject("PAIR_PARSE_REJECTED"); }
  const sessions = parseSessionWorkbook(parsingBytes);
  const sourceBook = XLSX.read(parsingBytes, { type: "array", cellDates: false });
  const sourceSheet = sourceBook.SheetNames[0];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sourceBook.Sheets[sourceSheet], { header: 1, defval: "", raw: true });
  const rowsByDate = new Map<string, unknown[][]>();
  for (const session of sessions) {
    const day = session.consultedAt.slice(0, 10);
    if (day < period.startDate || day > period.endDate) reject("FILE_DATE_OUT_OF_SCOPE");
    if (storeKey === undefined && session.agent.startsWith("志高厨电")) reject("IMPORT_SHOP_REWRITE_REJECTED");
    const group = rowsByDate.get(day) ?? [];
    group.push(matrix[session.sourceRowNumber - 1]); rowsByDate.set(day, group);
  }
  const logsByDate = new Map<string, string[]>();
  for (const block of chatText.replace(/^\uFEFF/, "").split(/\/\*+\s*以下为一通会话\s*\*+\/\s*/g)) {
    if (!block.trim()) continue;
    let parsed;
    try { parsed = parseChatLog(separator + block); } catch { return reject("UNRECOGNIZED_LOG_BLOCK"); }
    if (parsed.length !== 1) reject("INVALID_LOG_BLOCK");
    const day = parsed[0].startedAt.slice(0, 10);
    if (day < period.startDate || day > period.endDate) reject("FILE_DATE_OUT_OF_SCOPE");
    const group = logsByDate.get(day) ?? [];
    group.push(separator + block); logsByDate.set(day, group);
  }
  const dates = [...new Set([...rowsByDate.keys(), ...logsByDate.keys()])].sort();
  if (!dates.length || dates.length > 30) reject("EMPTY_PAIR");
  const results: CustomerServiceDailyFile[] = [];
  const derivedFingerprints: string[] = [];
  for (const date of dates) {
    const rows = rowsByDate.get(date); const logs = logsByDate.get(date);
    if (!rows?.length || !logs?.length) reject("UNPAIRED_SOURCE_DAY");
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([matrix[0], ...rows]), sourceSheet);
    const daySessionBytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
    const dayChatBytes = new TextEncoder().encode(logs.join("\n"));
    const parsed = parseCustomerServiceImport(daySessionBytes, new TextDecoder().decode(dayChatBytes));
    const normalizedBytes = Buffer.byteLength(JSON.stringify(parsed.conversations));
    if (normalizedBytes > 16 * 1024 * 1024 || daySessionBytes.length > 25 * 1024 * 1024 || dayChatBytes.length > 25 * 1024 * 1024)
      reject("DAILY_PAYLOAD_TOO_LARGE");
    const values = fingerprints(parsed); derivedFingerprints.push(...values);
    results.push({ date, sessionBytes: daySessionBytes, chatBytes: dayChatBytes,
      sessionSha256: sha256(daySessionBytes), chatSha256: sha256(dayChatBytes),
      contentSha256: sha256(JSON.stringify(values)), summary: parsed.summary,
      conversationCount: parsed.conversations.length, normalizedBytes });
  }
  if (JSON.stringify(derivedFingerprints.sort()) !== JSON.stringify(fingerprints(full))) reject("DAILY_PARTITION_CHANGED_BUSINESS_VALUES");
  return { files: results, durationAnomalies: normalized.anomalies, normalizedSessionSha256: sha256(parsingBytes), sourceSessionSha256: sha256(sessionBytes), sourceChatSha256: sha256(chatBytes),
    summary: full.summary, conversationCount: full.conversations.length };
}
