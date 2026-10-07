import { jdCustomerServiceWorkflow as contract, JdCustomerServiceWorkflowError } from "../lib/jd/customer-service-workflow";
import type { CustomerServiceDailyFile } from "./jd-customer-service-daily-files";

export type CustomerServiceBatchProof = {
  date: string; batchId: string; fileHash: string; conversationCount: number;
  matchedCount: number; sessionOnlyCount: number; chatOnlyCount: number; ambiguousCount: number;
  warningTotalCount: number; status: "imported" | "duplicate";
};
function reject(code: string): never { throw new JdCustomerServiceWorkflowError(code); }
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
export function customerServiceLocalBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)
    || url.port !== "3000" || url.username || url.password || url.search || url.hash || url.pathname !== "/") reject("LOCAL_IMPORT_ORIGIN_INVALID");
  return url.origin;
}
async function json(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) reject("IMPORT_RESPONSE_INVALID");
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const value = await reader.read();
      if (value.done) break;
      total += value.value.length;
      if (total > 1024 * 1024) reject("IMPORT_RESPONSE_TOO_LARGE");
      chunks.push(value.value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch { return reject("IMPORT_RESPONSE_INVALID"); }
  finally { await reader.cancel().catch(() => undefined); }
}
function assertBatch(batch: JsonObject, expected: Omit<CustomerServiceBatchProof, "batchId" | "fileHash" | "status">) {
  if (batch.shopName !== contract.shopName || batch.status !== "completed" || typeof batch.completedAt !== "string"
    || !Number.isFinite(Date.parse(batch.completedAt)) || typeof batch.id !== "string" || !/^cs_[a-f0-9]{64}$/.test(batch.id)
    || typeof batch.fileHash !== "string" || !/^[a-f0-9]{64}$/.test(batch.fileHash)) reject("IMPORT_BATCH_IDENTITY_MISMATCH");
  for (const key of ["conversationCount", "matchedCount", "sessionOnlyCount", "chatOnlyCount", "ambiguousCount"] as const)
    if (batch[key] !== expected[key]) reject("IMPORT_BATCH_COUNTS_MISMATCH");
  if (!Number.isSafeInteger(batch.warningTotalCount) || Number(batch.warningTotalCount) < 0) reject("IMPORT_WARNINGS_INVALID");
}
export async function importCustomerServiceDay(day: CustomerServiceDailyFile, baseUrl: string, request: typeof fetch = fetch) {
  const origin = customerServiceLocalBaseUrl(baseUrl);
  const form = new FormData();
  form.set("shopName", contract.shopName);
  form.set("sessionFile", new File([new Uint8Array(day.sessionBytes)], `jd-customer-service-${day.date}.xlsx`));
  form.set("chatFile", new File([new Uint8Array(day.chatBytes)], `jd-customer-service-${day.date}.log`));
  // No HTTP retry: the caller persists importing before invoking this method.
  // Lost responses require independent receipt reconciliation, never re-export.
  const response = await request(`${origin}/api/customer-service/import`, {
    method: "POST", body: form, redirect: "error", signal: AbortSignal.timeout(120_000),
  });
  const payload = await json(response); const batch = object(payload.batch);
  if (payload.ok !== true || !(payload.status === "imported" && response.status === 201
    || payload.status === "duplicate" && response.status === 200)) reject("IMPORT_NOT_CONFIRMED_MANUAL_ACTION");
  const expected = { date: day.date, conversationCount: day.conversationCount,
    matchedCount: day.summary.matchedCount + day.summary.timeOnlyMatchedCount,
    sessionOnlyCount: day.summary.sessionOnlyCount, chatOnlyCount: day.summary.chatOnlyCount,
    ambiguousCount: day.summary.ambiguousCount, warningTotalCount: Number(batch.warningTotalCount) };
  assertBatch(batch, expected);
  return { ...expected, batchId: String(batch.id), fileHash: String(batch.fileHash), status: payload.status } as CustomerServiceBatchProof;
}
export async function verifyCustomerServiceBatch(proof: CustomerServiceBatchProof, baseUrl: string, request: typeof fetch = fetch) {
  const origin = customerServiceLocalBaseUrl(baseUrl);
  // Existing public API exposes paginated history. Never assume the newest
  // batch is this run's batch, and never treat truncated history as absence.
  for (let page = 1; page <= 100; page++) {
    const response = await request(`${origin}/api/customer-service/import-history?page=${page}&pageSize=100`, {
      redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) reject("BATCH_READBACK_FAILED");
    const payload = await json(response); const paging = object(payload.pagination);
    if (!Array.isArray(payload.items) || payload.items.length > 100 || paging.page !== page
      || paging.pageSize !== 100 || paging.returned !== payload.items.length || typeof paging.truncated !== "boolean"
      || !Number.isSafeInteger(paging.total) || Number(paging.total) < payload.items.length) reject("BATCH_READBACK_INVALID");
    const matches = payload.items.map(object).filter(batch => batch.id === proof.batchId);
    if (matches.length > 1) reject("BATCH_READBACK_AMBIGUOUS");
    if (matches.length === 1) {
      assertBatch(matches[0], proof);
      if (matches[0].fileHash !== proof.fileHash || matches[0].warningTotalCount !== proof.warningTotalCount) reject("BATCH_READBACK_MISMATCH");
      return;
    }
    if (!paging.truncated || !payload.items.length) break;
  }
  reject("EXACT_BATCH_NOT_FOUND_MANUAL_ACTION");
}
